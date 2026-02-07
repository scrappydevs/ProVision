"""
Per-stroke AI insight generation using Claude Vision.

For each detected stroke, sends video frames + metrics to Claude to get:
1. Verified/corrected forehand/backhand classification
2. Detailed 2-4 sentence coaching insight

Insights are written to stroke_analytics rows one-by-one for progressive display.
"""

from __future__ import annotations

import json
import os
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
                 "classifier_reason", "event_sources"]:
        if key in metrics:
            metrics_summary[key] = metrics[key]

    prompt = (
        "You are analyzing a table tennis stroke from video frames to provide coaching insights.\n\n"
        f"Current classification: {stroke_type} (from elbow-trend heuristic)\n"
        f"Player handedness: {handedness}\n"
        f"Camera facing: {camera_facing}\n"
        f"Frame range: {start_frame}-{end_frame} (peak at {peak_frame})\n"
        f"Frames provided: {sent_frames}\n\n"
        f"Stroke metrics:\n{json.dumps(metrics_summary, indent=2, default=str)}\n\n"
        "The ball is marked with a GREEN bounding box labeled 'BALL' when detected.\n\n"
        "Your tasks:\n"
        "1. VERIFY or CORRECT the forehand/backhand classification. The heuristic may be wrong.\n"
        "   - FOREHAND: Racket on dominant-hand side (right for right-hander)\n"
        "   - BACKHAND: Racket crosses to non-dominant side, arm across body\n"
        "2. Provide a 2-4 sentence coaching insight about the player's form on this specific stroke.\n"
        "   Focus on: racket angle, footwork, weight transfer, follow-through, body rotation.\n"
        "   Be specific and actionable — reference what you see in the frames.\n\n"
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
            max_tokens=500,
            temperature=0,
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

    try:
        import anthropic

        model = os.getenv("STROKE_CLAUDE_MODEL", "claude-sonnet-4-20250514")
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
                result = generate_insight_for_stroke(
                    client=client,
                    model=model,
                    cap=cap,
                    stroke_row=stroke_row,
                    trajectory_by_frame=trajectory_by_frame,
                    handedness=handedness,
                    camera_facing=camera_facing,
                )

                # Build ai_insight_data
                ai_insight_data = {
                    "stroke_type_correct": result.get("stroke_type_correct", True),
                    "corrected_stroke_type": result.get("corrected_stroke_type"),
                    "original_stroke_type": stroke_row.get("stroke_type"),
                    "classification_confidence": result.get("classification_confidence", 0.0),
                    "classification_reasoning": result.get("classification_reasoning", ""),
                    "model": model,
                    "generated_at": datetime.now(timezone.utc).isoformat(),
                }

                # Update stroke row with insight
                update_data: Dict[str, Any] = {
                    "ai_insight": result.get("insight", ""),
                    "ai_insight_data": ai_insight_data,
                }

                # If classification was corrected, update stroke_type
                corrected_type = result.get("corrected_stroke_type")
                if not result.get("stroke_type_correct", True) and corrected_type:
                    update_data["stroke_type"] = corrected_type
                    classifications_changed = True
                    print(f"[StrokeInsight]   Reclassified: {stroke_row.get('stroke_type')} -> {corrected_type}")

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
                    .select("stroke_type, form_score")
                    .eq("session_id", session_id)
                    .execute()
                )
                rows = updated_strokes.data or []
                forehand_count = sum(1 for r in rows if r.get("stroke_type") == "forehand")
                backhand_count = sum(1 for r in rows if r.get("stroke_type") == "backhand")
                scores = [r.get("form_score", 0) for r in rows if isinstance(r.get("form_score"), (int, float))]
                total_strokes = len(rows)
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

    except Exception as exc:
        print(f"[StrokeInsight] Pipeline error: {exc}")
        return {
            "skipped": False,
            "reason": f"pipeline_error: {exc}",
            "completed": completed,
            "total": total,
            "classifications_changed": classifications_changed,
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
    }
