"""
Per-stroke AI insight generation using Claude Vision.

For each detected stroke, sends video frames + metrics to Claude to get:
1. Verified/corrected forehand/backhand classification
2. Detailed 2-4 sentence coaching insight

Insights are written to stroke_analytics rows one-by-one for progressive display.
"""

from __future__ import annotations

import json
import math
import os
import random
import re
from datetime import datetime, timezone
from time import perf_counter
from typing import Any, Callable, Dict, List, Optional, Tuple

import cv2

from .stroke_event_service import (
    _encode_frame_for_claude,
    _extract_first_json_object,
    _extract_json_like_fields,
    _extract_text_from_anthropic_response,
)
from ..utils.video_utils import cleanup_temp_file, download_video_from_storage, extract_video_path_from_url


def _read_env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return float(raw.strip())
    except (TypeError, ValueError):
        return default


def _estimate_session_duration_seconds(
    trajectory_data: Optional[Dict[str, Any]],
    strokes: List[Dict[str, Any]],
) -> float:
    duration = 0.0
    fps = 30.0

    if isinstance(trajectory_data, dict):
        video_info = trajectory_data.get("video_info", {})
        if isinstance(video_info, dict):
            try:
                duration = float(video_info.get("duration", 0.0) or 0.0)
            except (TypeError, ValueError):
                duration = 0.0
            try:
                fps = float(video_info.get("fps", fps) or fps)
            except (TypeError, ValueError):
                fps = 30.0
            if duration <= 0:
                try:
                    total_frames = int(video_info.get("total_frames", 0) or 0)
                except (TypeError, ValueError):
                    total_frames = 0
                if total_frames > 0 and fps > 0:
                    duration = total_frames / fps

    if duration <= 0 and strokes:
        max_frame = max(int(s.get("end_frame", 0) or 0) for s in strokes)
        duration = max_frame / max(1.0, fps)

    return max(0.1, duration)


def _stroke_metrics(stroke_row: Dict[str, Any]) -> Dict[str, Any]:
    metrics = stroke_row.get("metrics")
    return metrics if isinstance(metrics, dict) else {}


def _stroke_ai_insight_data(stroke_row: Dict[str, Any]) -> Dict[str, Any]:
    payload = stroke_row.get("ai_insight_data")
    return payload if isinstance(payload, dict) else {}


def _stroke_owner_fields(stroke_row: Dict[str, Any]) -> Tuple[str, float, str, str]:
    metrics = _stroke_metrics(stroke_row)
    ai_data = _stroke_ai_insight_data(stroke_row)

    hitter = str(ai_data.get("shot_owner") or metrics.get("event_hitter") or "").strip().lower()
    if hitter not in {"player", "opponent"}:
        hitter = "unknown"

    confidence_raw = ai_data.get("shot_owner_confidence", metrics.get("event_hitter_confidence", 0.0))
    try:
        confidence = max(0.0, min(1.0, float(confidence_raw)))
    except (TypeError, ValueError):
        confidence = 0.0

    method = str(ai_data.get("shot_owner_method") or metrics.get("event_hitter_method") or "").strip().lower()
    reason = str(ai_data.get("shot_owner_reason") or metrics.get("event_hitter_reason") or "").strip().lower()
    return hitter, confidence, method, reason


def _stroke_hitter(stroke_row: Dict[str, Any]) -> str:
    """
    Returns one of: "player", "opponent", "unknown".
    """
    hitter, _, _, _ = _stroke_owner_fields(stroke_row)
    return hitter


def _stroke_hitter_confidence(stroke_row: Dict[str, Any]) -> float:
    _, confidence, _, _ = _stroke_owner_fields(stroke_row)
    return confidence


def _is_reliable_opponent_stroke(stroke_row: Dict[str, Any]) -> bool:
    hitter, confidence, method, reason = _stroke_owner_fields(stroke_row)
    if hitter != "opponent":
        return False

    if method == "proximity_10_percent" and reason.startswith("player_outside_"):
        # Legacy ownership rule was too aggressive; don't trust it.
        return False

    return confidence >= 0.75


def _is_player_stroke_for_insights(stroke_row: Dict[str, Any]) -> bool:
    hitter, confidence, _, _ = _stroke_owner_fields(stroke_row)
    if hitter == "player":
        # Player labels from hitter inference are meaningful even in single-player tracking runs.
        return confidence >= 0.55
    if hitter == "opponent":
        return False
    # Unknown ownership is common when ball/pose attribution is noisy.
    # Keep unknown events eligible so timeline tips do not collapse to
    # generic Rally Snapshot fillers when opponent evidence is inconclusive.
    return True


def _is_player_stroke(stroke_row: Dict[str, Any]) -> bool:
    # Backward compatibility: unknown/missing ownership stays player-owned.
    return not _is_reliable_opponent_stroke(stroke_row)


def _generate_timeline_tips_from_insights(
    *,
    session_id: str,
    strokes: List[Dict[str, Any]],
    trajectory_data: Optional[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """
    Build one timeline tip per actual stroke, anchored to the stroke's real
    timestamp in the video. Each tip shows the AI insight for that specific
    stroke, synced to when it happens on screen.
    
    This replaces the old bucket-based approach that randomly sampled from a
    pool and caused repetitive, out-of-sync tips.
    """
    duration_sec = _estimate_session_duration_seconds(trajectory_data, strokes)
    
    # Derive FPS from trajectory data for frame-to-time conversion
    fps = 30.0
    if isinstance(trajectory_data, dict):
        video_info = trajectory_data.get("video_info", {})
        if isinstance(video_info, dict):
            try:
                fps = max(1.0, float(video_info.get("fps", 30.0) or 30.0))
            except (TypeError, ValueError):
                fps = 30.0

    def _normalize_tip_message(raw: str) -> str:
        """Extract first 2-3 sentences for variety."""
        cleaned = " ".join(str(raw or "").split())
        if not cleaned:
            return "Recover to neutral quickly and prepare your next contact point."
        parts = re.split(r"(?<=[.!?])\s+", cleaned, maxsplit=3)
        if len(parts) >= 2:
            message = " ".join(parts[:2]).strip()
        else:
            message = parts[0].strip() if parts else cleaned
        return message[:220]

    def _stroke_title(stroke_type: str, form_score: float) -> str:
        if stroke_type == "forehand":
            if form_score >= 85:
                return "Strong Forehand"
            elif form_score >= 70:
                return "Forehand Form"
            else:
                return "Forehand Tip"
        elif stroke_type == "backhand":
            if form_score >= 85:
                return "Strong Backhand"
            elif form_score >= 70:
                return "Backhand Form"
            else:
                return "Backhand Tip"
        return "Form Tip"

    out: List[Dict[str, Any]] = []
    
    for s in strokes:
        # Include all non-opponent strokes (use the broader _is_player_stroke check
        # instead of _is_player_stroke_for_insights which has a confidence threshold
        # that can exclude legitimate player strokes)
        if _is_reliable_opponent_stroke(s):
            continue
        
        ai_insight = str(s.get("ai_insight") or "").strip()
        # Skip strokes that are explicitly marked as opponent in their insight text
        if ai_insight and "opponent stroke" in ai_insight.lower():
            continue
        
        stroke_type = str(s.get("stroke_type") or "").strip().lower()
        form_score = s.get("form_score", 0)
        peak_frame = int(s.get("peak_frame", 0) or 0)
        start_frame = int(s.get("start_frame", 0) or 0)
        
        # Convert frame numbers to timestamps using actual FPS
        peak_time = round(peak_frame / fps, 3)
        start_time = round(start_frame / fps, 3)
        
        # Tip duration: show for 2.5 seconds (shorter to avoid overlap with next stroke)
        tip_duration = 2.5
        
        # Use AI insight if available, otherwise generate a basic tip from metrics
        if ai_insight:
            message = _normalize_tip_message(ai_insight)
        else:
            message = f"{stroke_type.title()} stroke detected at frame {peak_frame}."
        
        out.append(
            {
                "id": f"stroke-{s.get('id', peak_frame)}",
                "timestamp": peak_time,
                "duration": tip_duration,
                "seek_time": start_time,
                "title": _stroke_title(stroke_type, form_score)[:64],
                "message": message,
                "source_stroke_id": s.get("id"),
            }
        )

    # Sort by timestamp — no spacing filter so every stroke gets a tip
    out.sort(key=lambda t: t["timestamp"])
    
    return out


def _extract_frames_for_insight(
    cap: Any,
    start_frame: int,
    end_frame: int,
    trajectory_by_frame: Dict[int, Dict[str, Any]],
    max_frames: int = 15,
) -> List[Tuple[int, str]]:
    """
    Extract every-other-frame from start_frame to end_frame, capped at max_frames.
    Returns list of (frame_number, base64_encoded_jpeg).
    """
    total_frames = end_frame - start_frame + 1
    if total_frames <= 0:
        return []

    # Compute step to stay within max_frames
    step = max(2, total_frames // max_frames) if total_frames > max_frames else 2
    frame_numbers = list(range(start_frame, end_frame + 1, step))
    # Always include end_frame if not already
    if frame_numbers and frame_numbers[-1] != end_frame:
        frame_numbers.append(end_frame)
    # Cap
    if len(frame_numbers) > max_frames:
        frame_numbers = frame_numbers[:max_frames]

    results: List[Tuple[int, str]] = []
    for fn in frame_numbers:
        cap.set(cv2.CAP_PROP_POS_FRAMES, fn)
        ok, frame_img = cap.read()
        if not ok:
            continue

        # Get ball bbox for this frame
        ball_bbox: Optional[Tuple[float, float, float, float]] = None
        traj_point = trajectory_by_frame.get(fn)
        if traj_point:
            bbox = traj_point.get("bbox")
            if isinstance(bbox, (list, tuple)) and len(bbox) == 4:
                try:
                    ball_bbox = (float(bbox[0]), float(bbox[1]), float(bbox[2]), float(bbox[3]))
                except (ValueError, TypeError):
                    pass

        b64 = _encode_frame_for_claude(frame_img, fn, ball_bbox=ball_bbox)
        if b64:
            results.append((fn, b64))

    return results


def generate_insight_for_stroke(
    client: Any,
    model: str,
    cap: Any,
    stroke_row: Dict[str, Any],
    trajectory_by_frame: Dict[int, Dict[str, Any]],
    handedness: str,
    camera_facing: str,
) -> Dict[str, Any]:
    """
    Generate AI insight for a single stroke using Claude Vision.

    Returns dict with: stroke_type_correct, corrected_stroke_type,
    classification_confidence, classification_reasoning, insight
    """
    start_frame = int(stroke_row.get("start_frame", 0))
    end_frame = int(stroke_row.get("end_frame", 0))
    peak_frame = int(stroke_row.get("peak_frame", 0))
    stroke_type = str(stroke_row.get("stroke_type", "unknown"))
    metrics = stroke_row.get("metrics") or {}

    # Extract frames
    frames = _extract_frames_for_insight(
        cap, start_frame, end_frame, trajectory_by_frame, max_frames=15
    )

    if not frames:
        return {
            "stroke_type_correct": True,
            "corrected_stroke_type": None,
            "classification_confidence": 0.0,
            "classification_reasoning": "no_frames_available",
            "insight": "Unable to analyze — no video frames available for this stroke.",
        }

    # Build image blocks
    image_blocks: List[Dict[str, Any]] = []
    sent_frames: List[int] = []
    for fn, b64 in frames:
        sent_frames.append(fn)
        image_blocks.append({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": "image/jpeg",
                "data": b64,
            },
        })

    # Build metrics summary for context
    metrics_summary = {
        "stroke_type": stroke_type,
        "start_frame": start_frame,
        "end_frame": end_frame,
        "peak_frame": peak_frame,
        "duration": stroke_row.get("duration"),
        "max_velocity": stroke_row.get("max_velocity"),
        "form_score": stroke_row.get("form_score"),
    }
    # Include key metrics if present
    for key in ["elbow_angle", "shoulder_angle", "knee_angle", "hip_rotation",
                 "elbow_range", "hip_rotation_range", "shoulder_rotation_range",
                 "spine_lean", "classifier_source", "classifier_confidence",
                 "classifier_reason", "classifier_elbow_delta_deg",
                 "classifier_elbow_reason", "classifier_elbow_frame_window",
                 "classifier_elbow_hint", "event_sources"]:
        if key in metrics:
            metrics_summary[key] = metrics[key]

    system_prompt = (
        "You are a strict table-tennis stroke analyst.\n"
        "Return valid JSON only.\n"
        "When evaluating stroke type, resolve to forehand or backhand; if evidence is weak, keep existing label."
    )

    prompt = (
        "You are analyzing a table tennis stroke from video frames to provide coaching insights.\n\n"
        "Analyze ONLY the selected primary athlete (the user-selected player tracked as person_id=0).\n"
        "If frames mainly show opponent contact, treat this as out-of-scope and avoid opponent coaching.\n\n"
        f"Current classification: {stroke_type} (from elbow-trend heuristic)\n"
        f"Player handedness: {handedness}\n"
        f"Camera facing: {camera_facing}\n"
        f"Frame range: {start_frame}-{end_frame} (peak at {peak_frame})\n"
        f"Frames provided: {sent_frames}\n\n"
        f"Stroke metrics:\n{json.dumps(metrics_summary, indent=2, default=str)}\n\n"
        "The ball is marked with a GREEN bounding box labeled 'BALL' when detected.\n\n"
        "Temporal reasoning requirement:\n"
        "- Reconstruct the stroke as a time sequence using FRAME NUMBERS (and any frame labels in-image),\n"
        "  not just the order the images appear in the prompt.\n"
        "- Build a holistic motion picture of the hitting arm over time: backswing -> contact -> follow-through.\n"
        "- Classify forehand/backhand only after this temporal reconstruction.\n\n"
        "Heuristic weighting requirement:\n"
        "- The metrics include elbow-trend diagnostics (delta, sampled frames, and reason).\n"
        "- Give those diagnostics SOME weight as a secondary signal, but resolve conflicts using visual motion evidence.\n\n"
        "Your tasks:\n"
        "1. VERIFY or CORRECT the forehand/backhand classification. The heuristic may be wrong.\n"
        "   If visual evidence is inconclusive, keep the current classification instead of guessing a third category.\n"
        "   - FOREHAND: Racket on dominant-hand side (right for right-hander)\n"
        "   - BACKHAND: Racket crosses to non-dominant side, arm across body\n"
        "2. Provide a 1-3 sentence coaching insight about the player's form on this specific stroke.\n"
        "   IMPORTANT: Be specific and varied. Analyze what's actually visible in the frames:\n"
        "   - Body position: stance width, knee bend, weight distribution, spine lean/posture\n"
        "   - Arm mechanics: elbow angle at contact, arm extension, wrist position, follow-through path\n"
        "   - Rotation: hip rotation, shoulder rotation, torso coil\n"
        "   - Footwork: ready position, step timing, balance\n"
        "   - Contact point: height, distance from body, racket angle\n"
        "   DO NOT use generic advice. Describe what you SEE and how it affects the stroke.\n"
        "   Example: Instead of 'Extend your arm more', say 'Your elbow is bent at 110° at contact — \n"
        "   extending to 140-150° would increase racket-head speed and ball spin.'\n\n"
        "Return ONLY valid JSON:\n"
        "{\n"
        '  "stroke_type_correct": true/false,\n'
        '  "corrected_stroke_type": "forehand" or "backhand" or null (if correct),\n'
        '  "classification_confidence": 0.0-1.0,\n'
        '  "classification_reasoning": "brief explanation of why this is FH/BH",\n'
        '  "insight": "2-4 sentence coaching feedback about form on this specific stroke"\n'
        "}"
    )

    user_content: List[Dict[str, Any]] = [{"type": "text", "text": prompt}]
    user_content.extend(image_blocks)

    try:
        response = client.messages.create(
            model=model,
            max_tokens=350,  # Reduced for faster, more concise responses
            temperature=0,
            system=system_prompt,
            messages=[{"role": "user", "content": user_content}],
        )
        raw_text = _extract_text_from_anthropic_response(response)
        parsed = _extract_first_json_object(raw_text) or {}

        # Recover fields from raw text if JSON parse was incomplete
        fallback_fields = _extract_json_like_fields(raw_text)
        if fallback_fields:
            merged = dict(fallback_fields)
            merged.update(parsed)
            parsed = merged

        # Extract insight from text if not in JSON (Claude sometimes writes it outside)
        insight = str(parsed.get("insight", "")).strip()
        if not insight and raw_text:
            # Try to extract from raw text
            insight = raw_text[:500].strip()

        stroke_type_correct = parsed.get("stroke_type_correct", True)
        if isinstance(stroke_type_correct, str):
            stroke_type_correct = stroke_type_correct.lower() in ("true", "1", "yes")

        corrected = parsed.get("corrected_stroke_type")
        if corrected and isinstance(corrected, str):
            corrected = corrected.strip().lower()
            if corrected not in ("forehand", "backhand"):
                corrected = None
        else:
            corrected = None

        confidence = 0.0
        try:
            confidence = max(0.0, min(1.0, float(parsed.get("classification_confidence", 0.0))))
        except (ValueError, TypeError):
            pass

        reasoning = str(parsed.get("classification_reasoning", "")).strip()[:300]

        return {
            "stroke_type_correct": bool(stroke_type_correct),
            "corrected_stroke_type": corrected,
            "classification_confidence": round(confidence, 3),
            "classification_reasoning": reasoning,
            "insight": insight[:1000],
        }

    except Exception as exc:
        print(f"[StrokeInsight] Claude API error for stroke at frame {peak_frame}: {exc}")
        return {
            "stroke_type_correct": True,
            "corrected_stroke_type": None,
            "classification_confidence": 0.0,
            "classification_reasoning": f"api_error: {exc}",
            "insight": "Unable to generate insight for this stroke.",
        }


def generate_insights_for_session(
    supabase: Any,
    session_id: str,
    video_url: Optional[str],
    trajectory_data: Optional[Dict[str, Any]],
    handedness: str,
    camera_facing: str,
    progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
) -> Dict[str, Any]:
    """
    Generate AI insights for all strokes in a session.

    Downloads video once, processes each stroke sequentially, writes results
    to DB one-by-one for progressive display. Checks for cancellation before
    each stroke.

    Returns summary dict with counts.
    """
    anthropic_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if not anthropic_key:
        print("[StrokeInsight] No ANTHROPIC_API_KEY — skipping insight generation")
        return {"skipped": True, "reason": "no_api_key", "completed": 0, "total": 0}

    if not video_url:
        print("[StrokeInsight] No video URL — skipping insight generation")
        return {"skipped": True, "reason": "no_video_url", "completed": 0, "total": 0}

    # Fetch all strokes for session
    strokes_result = (
        supabase.table("stroke_analytics")
        .select("*")
        .eq("session_id", session_id)
        .order("start_frame")
        .execute()
    )
    strokes = strokes_result.data or []
    if not strokes:
        print("[StrokeInsight] No strokes found — skipping")
        return {"skipped": True, "reason": "no_strokes", "completed": 0, "total": 0}

    total = len(strokes)
    print(f"[StrokeInsight] Generating insights for {total} strokes in session {session_id}")

    # Build trajectory lookup
    trajectory_by_frame: Dict[int, Dict[str, Any]] = {}
    if isinstance(trajectory_data, dict):
        for point in trajectory_data.get("frames", []):
            frame = point.get("frame")
            if isinstance(frame, int):
                trajectory_by_frame[frame] = point

    local_video_path: Optional[str] = None
    cap = None
    completed = 0
    classifications_changed = False
    timeline_tips_count = 0
    min_conf_fh_to_bh = _read_env_float("STROKE_INSIGHT_MIN_CONFIDENCE_FH_TO_BH", 0.75)

    try:
        import anthropic

        model = os.getenv("STROKE_CLAUDE_MODEL", "claude-3-5-haiku-20241022")
        client = anthropic.Anthropic(api_key=anthropic_key)

        storage_path = extract_video_path_from_url(video_url)
        local_video_path = download_video_from_storage(storage_path)
        cap = cv2.VideoCapture(local_video_path)
        if not cap.isOpened():
            raise RuntimeError("Failed to open video for insight generation")

        for i, stroke_row in enumerate(strokes):
            # Check for cancellation before each stroke
            try:
                cancel_check = (
                    supabase.table("sessions")
                    .select("insight_generation_status")
                    .eq("id", session_id)
                    .single()
                    .execute()
                )
                if cancel_check.data and cancel_check.data.get("insight_generation_status") == "cancelled":
                    print(f"[StrokeInsight] Cancelled at stroke {i+1}/{total}")
                    break
            except Exception:
                pass

            # Emit progress
            if progress_callback:
                try:
                    progress_callback({
                        "stage_id": "generate_insights",
                        "status": "running",
                        "insights_progress": {
                            "current": i + 1,
                            "total": total,
                            "completed": completed,
                        },
                    })
                except Exception:
                    pass

            stroke_id = stroke_row.get("id")
            peak_frame = stroke_row.get("peak_frame", 0)
            print(f"[StrokeInsight] Processing stroke {i+1}/{total} (peak frame {peak_frame})")

            insight_start = perf_counter()
            try:
                hitter = _stroke_hitter(stroke_row)
                hitter_confidence = _stroke_hitter_confidence(stroke_row)
                _, _, owner_method, owner_reason = _stroke_owner_fields(stroke_row)

                if _is_reliable_opponent_stroke(stroke_row):
                    ai_insight_data = {
                        "shot_owner": "opponent",
                        "shot_owner_confidence": round(hitter_confidence, 3),
                        "shot_owner_reason": owner_reason,
                        "shot_owner_method": owner_method,
                        "model": "rule_based_hitter_inference",
                        "generated_at": datetime.now(timezone.utc).isoformat(),
                    }
                    supabase.table("stroke_analytics").update(
                        {
                            "ai_insight": "Opponent stroke detected. Excluded from your forehand/backhand breakdown.",
                            "ai_insight_data": ai_insight_data,
                        }
                    ).eq("id", stroke_id).execute()
                    completed += 1
                    elapsed = (perf_counter() - insight_start) * 1000
                    print(f"[StrokeInsight]   Marked as opponent stroke in {elapsed:.0f}ms")
                    continue

                if not _is_player_stroke_for_insights(stroke_row):
                    ai_insight_data = {
                        "shot_owner": hitter,
                        "shot_owner_confidence": round(hitter_confidence, 3),
                        "shot_owner_reason": owner_reason,
                        "shot_owner_method": owner_method,
                        "model": "rule_based_hitter_inference",
                        "generated_at": datetime.now(timezone.utc).isoformat(),
                    }
                    supabase.table("stroke_analytics").update(
                        {
                            "ai_insight": "Unattributed contact event. Excluded from player-only insight timeline.",
                            "ai_insight_data": ai_insight_data,
                        }
                    ).eq("id", stroke_id).execute()
                    completed += 1
                    elapsed = (perf_counter() - insight_start) * 1000
                    print(f"[StrokeInsight]   Marked as non-player event in {elapsed:.0f}ms")
                    continue

                result = generate_insight_for_stroke(
                    client=client,
                    model=model,
                    cap=cap,
                    stroke_row=stroke_row,
                    trajectory_by_frame=trajectory_by_frame,
                    handedness=handedness,
                    camera_facing=camera_facing,
                )

                original_type = str(stroke_row.get("stroke_type") or "").strip().lower()
                suggested_corrected_type = result.get("corrected_stroke_type")
                effective_corrected_type = suggested_corrected_type
                reclassification_blocked_reason: Optional[str] = None
                confidence = result.get("classification_confidence", 0.0)
                try:
                    confidence = float(confidence)
                except (TypeError, ValueError):
                    confidence = 0.0

                apply_reclassification = bool(
                    not result.get("stroke_type_correct", True) and effective_corrected_type
                )
                if (
                    apply_reclassification
                    and original_type == "forehand"
                    and effective_corrected_type == "backhand"
                    and confidence < min_conf_fh_to_bh
                ):
                    apply_reclassification = False
                    effective_corrected_type = None
                    reclassification_blocked_reason = (
                        f"fh_to_bh_confidence_below_{min_conf_fh_to_bh:.2f}"
                    )
                    print(
                        "[StrokeInsight]   Ignoring low-confidence forehand->backhand "
                        f"reclassification (confidence={confidence:.3f}, threshold={min_conf_fh_to_bh:.3f})"
                    )

                # Build ai_insight_data
                ai_insight_data = {
                    "stroke_type_correct": (
                        result.get("stroke_type_correct", True)
                        if reclassification_blocked_reason is None
                        else True
                    ),
                    "corrected_stroke_type": effective_corrected_type,
                    "original_stroke_type": stroke_row.get("stroke_type"),
                    "classification_confidence": result.get("classification_confidence", 0.0),
                    "classification_reasoning": result.get("classification_reasoning", ""),
                    "suggested_corrected_stroke_type": suggested_corrected_type,
                    "reclassification_applied": apply_reclassification,
                    "reclassification_blocked_reason": reclassification_blocked_reason,
                    "shot_owner": "player",
                    "shot_owner_confidence": round(hitter_confidence, 3),
                    "shot_owner_reason": owner_reason,
                    "shot_owner_method": owner_method,
                    "model": model,
                    "generated_at": datetime.now(timezone.utc).isoformat(),
                }

                # Update stroke row with insight
                update_data: Dict[str, Any] = {
                    "ai_insight": result.get("insight", ""),
                    "ai_insight_data": ai_insight_data,
                }

                # If classification was corrected, update stroke_type
                if apply_reclassification and effective_corrected_type:
                    update_data["stroke_type"] = effective_corrected_type
                    classifications_changed = True
                    print(
                        "[StrokeInsight]   Reclassified: "
                        f"{stroke_row.get('stroke_type')} -> {effective_corrected_type}"
                    )

                supabase.table("stroke_analytics").update(update_data).eq("id", stroke_id).execute()
                completed += 1

                elapsed = (perf_counter() - insight_start) * 1000
                print(f"[StrokeInsight]   Done in {elapsed:.0f}ms")

            except Exception as exc:
                print(f"[StrokeInsight]   Error on stroke {stroke_id}: {exc}")
                # Continue to next stroke
                continue

        # If any classifications changed, recalculate stroke_summary
        if classifications_changed:
            print("[StrokeInsight] Recalculating stroke summary after reclassifications...")
            try:
                updated_strokes = (
                    supabase.table("stroke_analytics")
                    .select("stroke_type, form_score, metrics")
                    .eq("session_id", session_id)
                    .execute()
                )
                rows = updated_strokes.data or []
                player_rows = [r for r in rows if _is_player_stroke(r)]
                forehand_count = sum(1 for r in player_rows if r.get("stroke_type") == "forehand")
                backhand_count = sum(1 for r in player_rows if r.get("stroke_type") == "backhand")
                scores = [r.get("form_score", 0) for r in player_rows if isinstance(r.get("form_score"), (int, float))]
                total_strokes = len(player_rows)
                avg_score = sum(scores) / len(scores) if scores else 0
                best_score = max(scores) if scores else 0

                supabase.table("sessions").update({
                    "stroke_summary": {
                        "average_form_score": round(avg_score, 1),
                        "best_form_score": round(best_score, 1),
                        "consistency_score": 0,
                        "total_strokes": total_strokes,
                        "forehand_count": forehand_count,
                        "backhand_count": backhand_count,
                    }
                }).eq("id", session_id).execute()
                print(f"[StrokeInsight] Updated summary: FH={forehand_count}, BH={backhand_count}")
            except Exception as exc:
                print(f"[StrokeInsight] Failed to update stroke summary: {exc}")

        # Build timeline-level tips from all stroke insights (one per time bucket),
        # then store them on session.stroke_summary for the top video overlay card.
        try:
            refreshed = (
                supabase.table("stroke_analytics")
                .select("id,start_frame,peak_frame,end_frame,stroke_type,form_score,ai_insight,ai_insight_data")
                .eq("session_id", session_id)
                .order("start_frame")
                .execute()
            )
            refreshed_strokes = refreshed.data or []
            timeline_tips = _generate_timeline_tips_from_insights(
                session_id=session_id,
                strokes=refreshed_strokes,
                trajectory_data=trajectory_data,
            )
            timeline_tips_count = len(timeline_tips)

            session_row = (
                supabase.table("sessions")
                .select("stroke_summary")
                .eq("id", session_id)
                .single()
                .execute()
            )
            summary = session_row.data.get("stroke_summary") if session_row.data and isinstance(session_row.data.get("stroke_summary"), dict) else {}
            summary.update(
                {
                    "timeline_tips": timeline_tips,
                    "timeline_tip_interval_sec": (
                        float(timeline_tips[0].get("duration"))
                        if timeline_tips and isinstance(timeline_tips[0], dict)
                        else max(0.5, min(5.0, _read_env_float("STROKE_TIMELINE_TIP_INTERVAL_SEC", 1.5)))
                    ),
                    "timeline_tips_generated_at": datetime.now(timezone.utc).isoformat(),
                }
            )
            supabase.table("sessions").update({"stroke_summary": summary}).eq("id", session_id).execute()
            print(
                "[StrokeInsight] Generated "
                f"{timeline_tips_count} timeline tips ({summary.get('timeline_tip_interval_sec')}s buckets)"
            )
        except Exception as exc:
            print(f"[StrokeInsight] Timeline tips generation failed: {exc}")

    except Exception as exc:
        print(f"[StrokeInsight] Pipeline error: {exc}")
        return {
            "skipped": False,
            "reason": f"pipeline_error: {exc}",
            "completed": completed,
            "total": total,
            "classifications_changed": classifications_changed,
            "timeline_tips_count": timeline_tips_count,
        }
    finally:
        try:
            if cap is not None:
                cap.release()
        except Exception:
            pass
        if local_video_path:
            cleanup_temp_file(local_video_path)

    return {
        "skipped": False,
        "reason": "ok",
        "completed": completed,
        "total": total,
        "classifications_changed": classifications_changed,
        "timeline_tips_count": timeline_tips_count,
    }
