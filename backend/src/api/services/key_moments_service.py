"""
Key Moments Service
Detects activity regions (rallies, points) from existing stroke and trajectory data.
Produces discrete highlight blocks for the video timeline scrubber.
"""

import uuid
import logging
from typing import List, Dict, Any, Optional
from dataclasses import dataclass, asdict

logger = logging.getLogger(__name__)

# Rally merging: strokes within this many frames are grouped into one rally
RALLY_GAP_THRESHOLD = 90  # ~3 seconds at 30fps

# Padding around rally boundaries for wind-up / recovery
RALLY_PADDING_FRAMES = 15  # ~0.5 seconds at 30fps

# If a point event is within this many frames after a rally's last stroke, extend the rally
POINT_EXTENSION_FRAMES = 60  # ~2 seconds at 30fps


@dataclass
class KeyMoment:
    """A detected activity region in the video."""
    start_frame: int
    end_frame: int
    start_time: float
    end_time: float
    moment_type: str  # 'rally', 'point'
    intensity: float  # 0.0-1.0
    label: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


def compute_key_moments(
    stroke_rows: List[Dict[str, Any]],
    point_events: List[Dict[str, Any]],
    fps: float = 30.0,
    total_frames: int = 0,
) -> List[KeyMoment]:
    """
    Compute key moment regions from stroke analytics and point events.

    Args:
        stroke_rows: List of stroke_analytics rows, each with
            start_frame, end_frame, peak_frame, stroke_type, form_score, id.
        point_events: List of point event dicts, each with
            frame, timestamp, reason.
        fps: Video frames per second.
        total_frames: Total frames in the video (for clamping).

    Returns:
        List of KeyMoment objects representing activity regions.
    """
    if not stroke_rows and not point_events:
        return []

    # Sort strokes by start_frame
    strokes = sorted(stroke_rows, key=lambda s: s.get("start_frame", 0))

    # Step 1: Merge nearby strokes into rally groups
    rallies = _merge_strokes_into_rallies(strokes)

    # Step 2: Extend rallies to include nearby point events
    point_events_sorted = sorted(point_events, key=lambda e: e.get("frame", 0))
    _extend_rallies_to_points(rallies, point_events_sorted)

    # Step 3: Add padding and clamp
    max_frame = total_frames if total_frames > 0 else (
        max((r["end_frame"] for r in rallies), default=0) + RALLY_PADDING_FRAMES * 2
    )
    for rally in rallies:
        rally["start_frame"] = max(0, rally["start_frame"] - RALLY_PADDING_FRAMES)
        rally["end_frame"] = min(max_frame, rally["end_frame"] + RALLY_PADDING_FRAMES)

    # Step 4: Convert to KeyMoment objects with intensity and labels
    moments: List[KeyMoment] = []
    for i, rally in enumerate(rallies, 1):
        stroke_count = len(rally["stroke_ids"])
        has_point = rally.get("point_event") is not None
        form_scores = rally.get("form_scores", [])
        avg_form = sum(form_scores) / len(form_scores) if form_scores else 50.0

        # Intensity formula: more strokes, point ending, and higher form = higher intensity
        intensity = min(1.0, max(0.0,
            0.3
            + 0.15 * min(stroke_count, 4)  # cap contribution at 4 strokes
            + (0.1 if has_point else 0.0)
            + 0.1 * (avg_form / 100.0)
        ))

        # Build label
        stroke_types = rally.get("stroke_types", [])
        type_abbrevs = [_abbrev(t) for t in stroke_types]
        type_str = "-".join(type_abbrevs) if type_abbrevs else ""
        label_parts = [f"Rally {i}"]
        if stroke_count > 0:
            label_parts.append(f"{stroke_count} stroke{'s' if stroke_count != 1 else ''}")
        if type_str:
            label_parts.append(type_str)
        if has_point:
            reason = rally["point_event"].get("reason", "").replace("_", " ")
            label_parts.append(f"point ({reason})")

        label = " — ".join(label_parts)

        start_time = rally["start_frame"] / fps if fps > 0 else 0.0
        end_time = rally["end_frame"] / fps if fps > 0 else 0.0

        metadata = {
            "stroke_ids": rally["stroke_ids"],
            "stroke_count": stroke_count,
            "stroke_types": stroke_types,
            "avg_form_score": round(avg_form, 1),
            "rally_index": i,
        }
        if has_point:
            metadata["point_reason"] = rally["point_event"].get("reason")
            metadata["point_frame"] = rally["point_event"].get("frame")

        moments.append(KeyMoment(
            start_frame=rally["start_frame"],
            end_frame=rally["end_frame"],
            start_time=round(start_time, 3),
            end_time=round(end_time, 3),
            moment_type="rally",
            intensity=round(intensity, 2),
            label=label,
            metadata=metadata,
        ))

    # Step 5: Add standalone point events that aren't inside any rally
    used_point_frames = {
        r.get("point_event", {}).get("frame")
        for r in rallies
        if r.get("point_event")
    }
    for evt in point_events_sorted:
        frame = evt.get("frame", 0)
        if frame in used_point_frames:
            continue
        # Check if this point is inside an existing rally moment
        inside = any(
            m.start_frame <= frame <= m.end_frame
            for m in moments
        )
        if inside:
            continue

        reason = evt.get("reason", "").replace("_", " ")
        start_f = max(0, frame - RALLY_PADDING_FRAMES)
        end_f = min(max_frame, frame + RALLY_PADDING_FRAMES) if max_frame > 0 else frame + RALLY_PADDING_FRAMES

        moments.append(KeyMoment(
            start_frame=start_f,
            end_frame=end_f,
            start_time=round(start_f / fps, 3) if fps > 0 else 0.0,
            end_time=round(end_f / fps, 3) if fps > 0 else 0.0,
            moment_type="point",
            intensity=0.4,
            label=f"Point — {reason}" if reason else "Point",
            metadata={
                "point_reason": evt.get("reason"),
                "point_frame": frame,
            },
        ))

    # Sort all moments by start_frame
    moments.sort(key=lambda m: m.start_frame)
    return moments


def _merge_strokes_into_rallies(strokes: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Group nearby strokes into rally clusters."""
    if not strokes:
        return []

    rallies: List[Dict[str, Any]] = []
    current_rally = {
        "start_frame": strokes[0].get("start_frame", 0),
        "end_frame": strokes[0].get("end_frame", 0),
        "stroke_ids": [strokes[0].get("id", "")],
        "stroke_types": [strokes[0].get("stroke_type", "unknown")],
        "form_scores": [strokes[0].get("form_score", 50.0)],
        "point_event": None,
    }

    for stroke in strokes[1:]:
        s_start = stroke.get("start_frame", 0)
        gap = s_start - current_rally["end_frame"]

        if gap <= RALLY_GAP_THRESHOLD:
            # Merge into current rally
            current_rally["end_frame"] = max(
                current_rally["end_frame"],
                stroke.get("end_frame", 0),
            )
            current_rally["stroke_ids"].append(stroke.get("id", ""))
            current_rally["stroke_types"].append(stroke.get("stroke_type", "unknown"))
            current_rally["form_scores"].append(stroke.get("form_score", 50.0))
        else:
            # Finalize current rally and start a new one
            rallies.append(current_rally)
            current_rally = {
                "start_frame": stroke.get("start_frame", 0),
                "end_frame": stroke.get("end_frame", 0),
                "stroke_ids": [stroke.get("id", "")],
                "stroke_types": [stroke.get("stroke_type", "unknown")],
                "form_scores": [stroke.get("form_score", 50.0)],
                "point_event": None,
            }

    rallies.append(current_rally)
    return rallies


def _extend_rallies_to_points(
    rallies: List[Dict[str, Any]],
    point_events: List[Dict[str, Any]],
) -> None:
    """Extend rally end_frame to include a nearby point event (mutates rallies in place)."""
    if not rallies or not point_events:
        return

    used_indices: set = set()

    for rally in rallies:
        rally_end = rally["end_frame"]

        for idx, evt in enumerate(point_events):
            if idx in used_indices:
                continue

            pt_frame = evt.get("frame", 0)
            # Point must be after rally start and within extension range of rally end
            if rally["start_frame"] <= pt_frame <= rally_end + POINT_EXTENSION_FRAMES:
                rally["end_frame"] = max(rally["end_frame"], pt_frame)
                rally["point_event"] = evt
                used_indices.add(idx)
                break  # One point per rally


def _abbrev(stroke_type: str) -> str:
    """Abbreviate stroke type for labels."""
    abbrevs = {
        "forehand": "FH",
        "backhand": "BH",
        "serve": "SV",
        "unknown": "??",
    }
    return abbrevs.get(stroke_type, stroke_type[:2].upper())


def store_key_moments(
    supabase,
    session_id: str,
    moments: List[KeyMoment],
) -> List[Dict[str, Any]]:
    """
    Store computed key moments in the database.
    Deletes existing moments for the session first (idempotent recompute).

    Returns:
        The inserted rows as dicts.
    """
    # Delete existing moments for this session
    try:
        supabase.table("key_moments").delete().eq("session_id", session_id).execute()
    except Exception as e:
        logger.warning(f"Failed to delete existing key_moments for {session_id}: {e}")

    if not moments:
        return []

    rows = []
    for m in moments:
        rows.append({
            "id": str(uuid.uuid4()),
            "session_id": session_id,
            "start_frame": m.start_frame,
            "end_frame": m.end_frame,
            "start_time": m.start_time,
            "end_time": m.end_time,
            "moment_type": m.moment_type,
            "intensity": m.intensity,
            "label": m.label,
            "metadata": m.metadata or {},
        })

    inserted: List[Dict[str, Any]] = []
    # Insert in batches of 50
    for i in range(0, len(rows), 50):
        batch = rows[i:i + 50]
        try:
            result = supabase.table("key_moments").insert(batch).execute()
            inserted.extend(result.data or [])
        except Exception as e:
            logger.error(f"Failed to insert key_moments batch for {session_id}: {e}")

    logger.info(f"Stored {len(inserted)} key moments for session {session_id}")
    return inserted


def compute_and_store_key_moments(
    supabase,
    session_id: str,
) -> List[Dict[str, Any]]:
    """
    Full pipeline: load data from DB, compute key moments, store results.
    Called on-demand when the frontend first requests key moments.

    Returns:
        List of key moment dicts as stored in DB.
    """
    # Load stroke analytics
    try:
        stroke_result = (
            supabase.table("stroke_analytics")
            .select("id, start_frame, end_frame, peak_frame, stroke_type, form_score")
            .eq("session_id", session_id)
            .order("start_frame")
            .execute()
        )
        stroke_rows = stroke_result.data or []
    except Exception as e:
        logger.warning(f"Failed to load stroke_analytics for {session_id}: {e}")
        stroke_rows = []

    # Load point events from cached analytics
    point_events: List[Dict[str, Any]] = []
    try:
        analytics_result = (
            supabase.table("session_analytics")
            .select("analytics")
            .eq("session_id", session_id)
            .limit(1)
            .execute()
        )
        if analytics_result.data:
            analytics = analytics_result.data[0].get("analytics", {})
            ball = analytics.get("ball_analytics") or {}
            points_section = ball.get("points") or {}
            point_events = points_section.get("events", [])
    except Exception as e:
        logger.warning(f"Failed to load analytics point events for {session_id}: {e}")

    # Load FPS and total_frames from session trajectory data
    fps = 30.0
    total_frames = 0
    try:
        session_result = (
            supabase.table("sessions")
            .select("trajectory_data")
            .eq("id", session_id)
            .single()
            .execute()
        )
        if session_result.data:
            traj = session_result.data.get("trajectory_data") or {}
            video_info = traj.get("video_info") or {}
            fps = video_info.get("fps", 30.0)
            total_frames = video_info.get("total_frames", 0)
    except Exception as e:
        logger.warning(f"Failed to load session video_info for {session_id}: {e}")

    # Compute moments
    moments = compute_key_moments(
        stroke_rows=stroke_rows,
        point_events=point_events,
        fps=fps,
        total_frames=total_frames,
    )

    # Store and return
    return store_key_moments(supabase, session_id, moments)
