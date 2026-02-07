"""
Hybrid stroke event detection and classification.

Pipeline:
1. Pose-based stroke proposals from StrokeDetector.
2. Trajectory direction-change proposals (flicker-robust).
3. Pose/ball contact proposals from wrist proximity.
4. Merge proposals into candidate detection events.
5. Classify each event:
   - Claude vision (optional): forehand | backhand | no_hit | uncertain.
   - Fallback heuristic: dominant-arm elbow-angle trend.
6. Build final Stroke objects for storage.
"""

from __future__ import annotations

import base64
import json
import math
import os
import re
import statistics
import uuid
from bisect import bisect_left
from dataclasses import dataclass
from datetime import datetime
from time import perf_counter
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

import cv2

# Debug logging directory for saving Claude analysis artifacts
DEBUG_STROKE_LOGGING_ENABLED = os.getenv("DEBUG_STROKE_LOGGING", "true").lower() in ("1", "true", "yes")
DEBUG_STROKE_LOGGING_DIR = os.getenv("DEBUG_STROKE_LOGGING_DIR", "/tmp/stroke_debug")

from .stroke_detector import Stroke, StrokeDetector
from ..utils.video_utils import cleanup_temp_file, download_video_from_storage, extract_video_path_from_url
from .stroke_debug_utils import (
    debug_header, debug_info, debug_section_start, debug_section_end,
    debug_timer, debug_pipeline_start, debug_pipeline_end
)


@dataclass
class DetectionEvent:
    frame: int
    start_frame: int
    end_frame: int
    pre_frames: int
    post_frames: int
    sources: List[str]
    local_ball_speed: float
    matched_stroke_idx: Optional[int] = None


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return default


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return default


def _median(values: Sequence[float], default: float = 0.0) -> float:
    vals = [float(v) for v in values if isinstance(v, (int, float))]
    if not vals:
        return default
    return float(statistics.median(vals))


def _moving_average(values: Sequence[float], window: int = 3) -> List[float]:
    if not values:
        return []
    window = max(1, int(window))
    if window == 1:
        return [float(v) for v in values]

    out: List[float] = []
    half = window // 2
    for i in range(len(values)):
        lo = max(0, i - half)
        hi = min(len(values), i + half + 1)
        out.append(sum(values[lo:hi]) / max(1, (hi - lo)))
    return out


def _extract_first_json_object(text: str) -> Optional[Dict[str, Any]]:
    text = (text or "").strip()
    if not text:
        return None
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass

    # Prefer the LAST valid JSON object, since models often include
    # an earlier draft/example before the final answer.
    candidates = re.findall(r"\{[\s\S]*?\}", text)
    for candidate in reversed(candidates):
        try:
            parsed = json.loads(candidate)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            continue
    return None


def _normalize_label(value: Any) -> str:
    label = str(value or "").strip().lower()
    if label in {"forehand", "backhand", "no_hit", "uncertain"}:
        return label
    if label in {"none", "nohit", "no-hit", "no hit", "not_a_shot", "not-a-shot"}:
        return "no_hit"
    return "uncertain"


def _extract_json_like_fields(text: str) -> Dict[str, Any]:
    """
    Extract label/confidence/contact_frame/reason from raw JSON-like text.
    Uses the last occurrence of each key to track the model's final answer.
    """
    out: Dict[str, Any] = {}
    if not text:
        return out

    label_matches = re.findall(r'"label"\s*:\s*"([^"]+)"', text, flags=re.IGNORECASE)
    if label_matches:
        out["label"] = label_matches[-1]

    conf_matches = re.findall(r'"confidence"\s*:\s*([0-9]*\.?[0-9]+)', text, flags=re.IGNORECASE)
    if conf_matches:
        out["confidence"] = _safe_float(conf_matches[-1], 0.0)

    contact_matches = re.findall(r'"contact_frame"\s*:\s*(null|-?\d+)', text, flags=re.IGNORECASE)
    if contact_matches:
        raw = contact_matches[-1].strip().lower()
        out["contact_frame"] = None if raw == "null" else _safe_int(raw, 0)

    reason_matches = re.findall(r'"reason"\s*:\s*"([^"]*)"', text, flags=re.IGNORECASE)
    if reason_matches:
        out["reason"] = reason_matches[-1]

    return out


def _sanitize_trajectory_points(trajectory_frames: Any) -> List[Dict[str, Any]]:
    if not isinstance(trajectory_frames, list):
        return []

    points: List[Dict[str, Any]] = []
    for raw in trajectory_frames:
        if not isinstance(raw, dict):
            continue
        frame = raw.get("frame")
        if not isinstance(frame, int):
            continue
        points.append(
            {
                "frame": frame,
                "x": _safe_float(raw.get("x")),
                "y": _safe_float(raw.get("y")),
                "confidence": _safe_float(raw.get("confidence"), 0.0),
                "bbox": raw.get("bbox"),
            }
        )

    points.sort(key=lambda p: p["frame"])
    return points


def _extract_ball_xy(
    point: Dict[str, Any],
    video_width: int,
    video_height: int,
) -> Optional[Tuple[float, float]]:
    bbox = point.get("bbox")
    if isinstance(bbox, (list, tuple)) and len(bbox) == 4:
        x1 = _safe_float(bbox[0], default=float("nan"))
        y1 = _safe_float(bbox[1], default=float("nan"))
        x2 = _safe_float(bbox[2], default=float("nan"))
        y2 = _safe_float(bbox[3], default=float("nan"))
        if not (math.isnan(x1) or math.isnan(y1) or math.isnan(x2) or math.isnan(y2)):
            if x2 >= x1 and y2 >= y1:
                return (x1 + x2) / 2.0, (y1 + y2) / 2.0

    x = _safe_float(point.get("x"), default=float("nan"))
    y = _safe_float(point.get("y"), default=float("nan"))
    if math.isnan(x) or math.isnan(y):
        return None
    if abs(x) <= 2.0 and abs(y) <= 2.0:
        x *= max(1, video_width)
        y *= max(1, video_height)
    return x, y


def _build_speed_by_frame(points: List[Dict[str, Any]]) -> Dict[int, float]:
    if len(points) < 2:
        return {}

    speed_by_frame: Dict[int, float] = {}
    prev = points[0]
    for curr in points[1:]:
        frame_gap = max(1, curr["frame"] - prev["frame"])
        dist = math.hypot(curr["x"] - prev["x"], curr["y"] - prev["y"])
        speed_by_frame[curr["frame"]] = dist / frame_gap
        prev = curr
    return speed_by_frame


def _build_velocity_series(points: List[Dict[str, Any]]) -> List[float]:
    if len(points) < 2:
        return []
    velocities: List[float] = []
    prev = points[0]
    for curr in points[1:]:
        frame_gap = max(1, curr["frame"] - prev["frame"])
        dist = math.hypot(curr["x"] - prev["x"], curr["y"] - prev["y"])
        velocities.append(dist / frame_gap)
        prev = curr
    return velocities


def _average_x_direction(
    xs: Sequence[float],
    frames: Sequence[int],
    start_idx: int,
    end_idx: int,
) -> float:
    if end_idx - start_idx < 1:
        return 0.0
    direction_samples: List[float] = []
    for idx in range(start_idx + 1, end_idx + 1):
        dt = max(1, frames[idx] - frames[idx - 1])
        direction_samples.append((xs[idx] - xs[idx - 1]) / dt)
    return _median(direction_samples, default=0.0)


def _detect_direction_change_events(
    points: List[Dict[str, Any]],
    video_width: int,
    video_height: int,
    min_confidence: float = 0.10,  # Lowered to over-detect
    min_delta_px: float = 3.0,     # Minimum avg x-direction magnitude (px/frame)
    min_span_px: float = 12.0,     # Minimum x-span across before+after windows
    min_gap_frames: int = 5,       # Lowered to catch rapid exchanges
    hit_frame_offset: int = 0,     # 0 = hit is at the direction-flip moment
    direction_window_frames: int = 30,  # Compare avg direction over +/- this many samples
) -> List[int]:
    """
    Detect hit events by comparing average X-direction before vs after each frame.

    A hit candidate occurs when:
    - avg X-direction over the previous window and next window have opposite signs
    - both windows have sufficient directional magnitude
    - combined X-span across both windows is large enough
    """
    if len(points) < 7:
        return []

    centers: List[Tuple[float, float]] = []
    for p in points:
        xy = _extract_ball_xy(p, video_width, video_height)
        if xy is None:
            centers.append((_safe_float(p.get("x"), 0.0), _safe_float(p.get("y"), 0.0)))
        else:
            centers.append(xy)

    xs = [c[0] for c in centers]
    confs = [p["confidence"] for p in points]
    frames = [p["frame"] for p in points]

    # Light smoothing before windowed direction estimation.
    sx = _moving_average(xs, window=3)

    max_window = max(3, (len(points) - 1) // 2)
    window = min(max(3, int(direction_window_frames)), max_window)
    if window < 3:
        return []

    # Store (frame, strength) and keep strongest event inside short clusters.
    events: List[Tuple[int, float]] = []

    for i in range(window, len(points) - window):
        local_conf = _median(confs[max(0, i - 2): min(len(confs), i + 3)], default=0.0)
        if local_conf < min_confidence:
            continue

        before_dir = _average_x_direction(sx, frames, i - window, i)
        after_dir = _average_x_direction(sx, frames, i, i + window)

        if abs(before_dir) < min_delta_px or abs(after_dir) < min_delta_px:
            continue
        if before_dir * after_dir >= 0:
            continue

        x_span = abs(sx[i] - sx[i - window]) + abs(sx[i + window] - sx[i])
        if x_span < min_span_px:
            continue

        hit_frame_idx = max(0, min(len(frames) - 1, i - hit_frame_offset))
        hit_frame = frames[hit_frame_idx]
        flip_strength = abs(before_dir - after_dir)

        if events and hit_frame - events[-1][0] < min_gap_frames:
            if flip_strength > events[-1][1]:
                events[-1] = (hit_frame, flip_strength)
            continue

        events.append((hit_frame, flip_strength))

    return [frame for frame, _ in events]


def _as_keypoint_map(keypoints: Any) -> Dict[str, Dict[str, float]]:
    if isinstance(keypoints, dict):
        return keypoints
    if isinstance(keypoints, list):
        out: Dict[str, Dict[str, float]] = {}
        for kp in keypoints:
            if not isinstance(kp, dict):
                continue
            name = kp.get("name")
            if not name:
                continue
            out[name] = kp
        return out
    return {}


def _extract_keypoint_xy(
    pose_frame: Dict[str, Any],
    keypoint_name: str,
    video_width: int,
    video_height: int,
) -> Optional[Tuple[float, float]]:
    kp_map = _as_keypoint_map(pose_frame.get("keypoints", {}))
    kp = kp_map.get(keypoint_name)
    if not isinstance(kp, dict):
        return None

    x = _safe_float(kp.get("x"), default=float("nan"))
    y = _safe_float(kp.get("y"), default=float("nan"))
    if math.isnan(x) or math.isnan(y):
        return None

    # Some pipelines store normalized coordinates in [0,1], others store pixels.
    if abs(x) <= 2.0 and abs(y) <= 2.0:
        x *= max(1, video_width)
        y *= max(1, video_height)

    return x, y


def _joint_angle_degrees(
    a: Tuple[float, float],
    b: Tuple[float, float],
    c: Tuple[float, float],
) -> Optional[float]:
    bax = float(a[0] - b[0])
    bay = float(a[1] - b[1])
    bcx = float(c[0] - b[0])
    bcy = float(c[1] - b[1])
    norm_ba = math.hypot(bax, bay)
    norm_bc = math.hypot(bcx, bcy)
    if norm_ba < 1e-6 or norm_bc < 1e-6:
        return None
    cos_theta = (bax * bcx + bay * bcy) / (norm_ba * norm_bc)
    cos_theta = max(-1.0, min(1.0, cos_theta))
    return float(math.degrees(math.acos(cos_theta)))


def _extract_elbow_angle_deg(
    pose_frame: Dict[str, Any],
    arm_side: str,
    video_width: int,
    video_height: int,
) -> Optional[float]:
    side = "left" if str(arm_side).lower() == "left" else "right"
    shoulder = _extract_keypoint_xy(pose_frame, f"{side}_shoulder", video_width, video_height)
    elbow = _extract_keypoint_xy(pose_frame, f"{side}_elbow", video_width, video_height)
    wrist = _extract_keypoint_xy(pose_frame, f"{side}_wrist", video_width, video_height)
    if shoulder is None or elbow is None or wrist is None:
        return None
    return _joint_angle_degrees(shoulder, elbow, wrist)


def _nearest_pose_frame_number(
    sorted_frames: List[int],
    target_frame: int,
    max_delta: int = 2,
) -> Optional[int]:
    if not sorted_frames:
        return None
    idx = bisect_left(sorted_frames, target_frame)
    candidates: List[int] = []
    if idx < len(sorted_frames):
        candidates.append(sorted_frames[idx])
    if idx > 0:
        candidates.append(sorted_frames[idx - 1])
    if not candidates:
        return None
    best = min(candidates, key=lambda f: abs(f - target_frame))
    if abs(best - target_frame) > max_delta:
        return None
    return best


def _detect_contact_frames(
    points: List[Dict[str, Any]],
    pose_frames: List[Dict[str, Any]],
    video_info: Dict[str, Any],
) -> List[int]:
    if not points or not pose_frames:
        return []

    width = max(1, _safe_int(video_info.get("width"), 1280))
    height = max(1, _safe_int(video_info.get("height"), 720))
    distance_threshold = max(58.0, min(width, height) * 0.085)

    pose_by_frame: Dict[int, List[Dict[str, Any]]] = {}
    for frame in pose_frames:
        fn = frame.get("frame_number")
        if isinstance(fn, int):
            pose_by_frame.setdefault(fn, []).append(frame)
    pose_numbers = sorted(pose_by_frame.keys())
    if not pose_numbers:
        return []

    contacts: List[int] = []
    last_added = -10_000

    for point in points:
        frame = point["frame"]
        if point["confidence"] < 0.16:
            continue

        pose_frame_list = pose_by_frame.get(frame)
        if pose_frame_list is None:
            nearest = _nearest_pose_frame_number(pose_numbers, frame, max_delta=2)
            if nearest is None:
                continue
            pose_frame_list = pose_by_frame.get(nearest)
            if not pose_frame_list:
                continue

        wrist_points = []
        for pose_frame in pose_frame_list:
            for name in ("left_wrist", "right_wrist"):
                xy = _extract_keypoint_xy(pose_frame, name, width, height)
                if xy is not None:
                    wrist_points.append(xy)
        if not wrist_points:
            continue

        ball_xy = _extract_ball_xy(point, width, height)
        if ball_xy is None:
            continue
        ball_x, ball_y = ball_xy
        min_dist = min(math.hypot(ball_x - wx, ball_y - wy) for wx, wy in wrist_points)
        if min_dist <= distance_threshold and frame - last_added >= 4:
            contacts.append(frame)
            last_added = frame

    return contacts


def _extract_pose_center_x(
    pose_frame: Dict[str, Any],
    video_width: int,
    video_height: int,
) -> Optional[float]:
    body_metrics = pose_frame.get("body_metrics")
    if isinstance(body_metrics, dict):
        cx = _safe_float(body_metrics.get("center_of_mass_x"), default=float("nan"))
        cy = _safe_float(body_metrics.get("center_of_mass_y"), default=float("nan"))
        if not math.isnan(cx):
            if abs(cx) <= 2.0 and (math.isnan(cy) or abs(cy) <= 2.0):
                cx *= max(1, video_width)
            return cx

    xs: List[float] = []
    for name in ("left_hip", "right_hip", "left_shoulder", "right_shoulder"):
        xy = _extract_keypoint_xy(pose_frame, name, video_width, video_height)
        if xy is not None:
            xs.append(xy[0])
    if xs:
        return float(sum(xs) / len(xs))
    return None


def _build_pose_center_maps(
    pose_frames: List[Dict[str, Any]],
    video_width: int,
    video_height: int,
) -> Tuple[Dict[int, float], Dict[int, float]]:
    player_centers: Dict[int, float] = {}
    opponent_centers: Dict[int, float] = {}

    for pose_frame in pose_frames:
        frame_number = pose_frame.get("frame_number")
        if not isinstance(frame_number, int):
            continue
        person_id = _safe_int(pose_frame.get("person_id"), 0)
        center_x = _extract_pose_center_x(pose_frame, video_width, video_height)
        if center_x is None:
            continue

        if person_id == 0:
            if frame_number in player_centers:
                player_centers[frame_number] = (player_centers[frame_number] + center_x) / 2.0
            else:
                player_centers[frame_number] = center_x
        elif person_id == 1:
            if frame_number in opponent_centers:
                opponent_centers[frame_number] = (opponent_centers[frame_number] + center_x) / 2.0
            else:
                opponent_centers[frame_number] = center_x

    return player_centers, opponent_centers


def _nearest_value_by_frame(
    values_by_frame: Dict[int, float],
    target_frame: int,
    max_delta: int = 3,
) -> Tuple[Optional[int], Optional[float]]:
    if not values_by_frame:
        return None, None
    frame_numbers = sorted(values_by_frame.keys())
    nearest_frame = _nearest_pose_frame_number(frame_numbers, target_frame, max_delta=max_delta)
    if nearest_frame is None:
        return None, None
    return nearest_frame, values_by_frame.get(nearest_frame)


def _screen_side(x: Optional[float], video_width: int) -> Optional[str]:
    if not isinstance(x, (int, float)):
        return None
    midpoint = max(1.0, float(video_width)) / 2.0
    return "left" if float(x) < midpoint else "right"


def _infer_hitter_for_event(
    frame: int,
    ball_centers: Dict[int, float],
    player_centers: Dict[int, float],
    opponent_centers: Dict[int, float],
    video_width: int,
    proximity_threshold: float = 0.14,
    separation_margin: float = 0.035,
) -> Dict[str, Any]:
    """
    Infer hitter ownership from ball/player/opponent horizontal proximity.

    Conservative behavior:
    - Only mark "opponent" when opponent is decisively closer than player.
    - If data is missing or ambiguous, return "unknown" (not opponent).
    """
    ball_frame, ball_x = _nearest_value_by_frame(ball_centers, frame, max_delta=3)
    player_frame, player_x = _nearest_value_by_frame(player_centers, frame, max_delta=3)
    opponent_frame, opponent_x = _nearest_value_by_frame(opponent_centers, frame, max_delta=3)

    proximity_px = max(1.0, float(video_width)) * proximity_threshold
    separation_px = max(1.0, float(video_width)) * separation_margin

    ball_side = _screen_side(ball_x, video_width)
    player_side = _screen_side(player_x, video_width)
    opponent_side = _screen_side(opponent_x, video_width)

    result: Dict[str, Any] = {
        "method": "dual_proximity_v2",
        "hitter": "unknown",
        "confidence": 0.0,
        "reason": "insufficient_data",
        "ball_frame": ball_frame,
        "ball_x": round(ball_x, 2) if isinstance(ball_x, (int, float)) else None,
        "ball_side": ball_side,
        "player_frame": player_frame,
        "player_x": round(player_x, 2) if isinstance(player_x, (int, float)) else None,
        "player_side": player_side,
        "opponent_frame": opponent_frame,
        "opponent_x": round(opponent_x, 2) if isinstance(opponent_x, (int, float)) else None,
        "opponent_side": opponent_side,
        "proximity_threshold_px": round(proximity_px, 2),
        "separation_margin_px": round(separation_px, 2),
    }

    if ball_x is None:
        result["reason"] = "ball_position_unavailable"
        return result

    player_ball_dist: Optional[float] = None
    opponent_ball_dist: Optional[float] = None
    if player_x is not None:
        player_ball_dist = abs(float(ball_x) - float(player_x))
        result["player_ball_distance"] = round(player_ball_dist, 2)
    if opponent_x is not None:
        opponent_ball_dist = abs(float(ball_x) - float(opponent_x))
        result["opponent_ball_distance"] = round(opponent_ball_dist, 2)

    # Both anchors available: require decisive winner to mark opponent.
    if player_ball_dist is not None and opponent_ball_dist is not None:
        if (
            player_ball_dist <= proximity_px
            and player_ball_dist + separation_px <= opponent_ball_dist
        ):
            result["hitter"] = "player"
            result["confidence"] = 0.92
            result["reason"] = "player_decisively_closer"
            return result
        if (
            opponent_ball_dist <= proximity_px
            and opponent_ball_dist + separation_px <= player_ball_dist
        ):
            result["hitter"] = "opponent"
            result["confidence"] = 0.9
            result["reason"] = "opponent_decisively_closer"
            return result

        if player_ball_dist <= proximity_px and player_ball_dist <= opponent_ball_dist:
            result["hitter"] = "player"
            result["confidence"] = 0.7
            result["reason"] = "player_closer_but_ambiguous"
            return result

        if opponent_ball_dist <= proximity_px and opponent_ball_dist < player_ball_dist:
            result["reason"] = "opponent_closer_but_ambiguous"
            result["confidence"] = 0.35
            return result

        result["reason"] = "both_outside_proximity"
        return result

    # Only player anchor available: still allow player assignment when reasonably close.
    if player_ball_dist is not None:
        if player_ball_dist <= proximity_px:
            result["hitter"] = "player"
            result["confidence"] = 0.62
            result["reason"] = "player_only_within_proximity"
        else:
            result["reason"] = "player_only_outside_proximity"
        return result

    # Only opponent anchor available: never force opponent with weak context.
    if opponent_ball_dist is not None:
        if opponent_ball_dist <= proximity_px and ball_side is not None and ball_side == opponent_side:
            result["reason"] = "opponent_only_same_side_low_confidence"
            result["confidence"] = 0.3
        else:
            result["reason"] = "opponent_only_insufficient_context"
        return result

    # No usable player anchors.
    result["reason"] = "no_player_or_opponent_position"
    return result


def _pre_merge_same_source(
    frames: List[int],
    fps: float,
    time_threshold: float = 0.01,
) -> List[int]:
    """
    Pre-merge events from the same source that are within time_threshold seconds.
    Returns deduplicated frame list with close events merged to their median.
    """
    if not frames or fps <= 0:
        return frames

    frame_threshold = max(1, int(fps * time_threshold))
    sorted_frames = sorted(frames)

    clusters: List[List[int]] = [[sorted_frames[0]]]
    for frame in sorted_frames[1:]:
        if frame - clusters[-1][-1] <= frame_threshold:
            clusters[-1].append(frame)
        else:
            clusters.append([frame])

    # Return median of each cluster
    return [int(round(_median(c, default=float(c[len(c) // 2])))) for c in clusters]


def _merge_event_frames_with_sources(
    pose_event_frames: List[int],
    trajectory_event_frames: List[int],
    contact_event_frames: List[int],
    merge_gap: int = 8,
    fps: float = 30.0,
) -> List[Tuple[int, List[str]]]:
    """
    Merge events from all sources:
    1. First pre-merge same-source events within 0.01s
    2. Then OR all sources together with merge_gap tolerance
    """
    # Step 1: Pre-merge same-source events within 0.01s
    pose_merged = _pre_merge_same_source(pose_event_frames, fps, time_threshold=0.01)
    trajectory_merged = _pre_merge_same_source(trajectory_event_frames, fps, time_threshold=0.01)
    contact_merged = _pre_merge_same_source(contact_event_frames, fps, time_threshold=0.01)

    # Step 2: Tag and combine all sources
    tagged: List[Tuple[int, str]] = []
    tagged.extend((int(f), "pose") for f in pose_merged)
    tagged.extend((int(f), "trajectory") for f in trajectory_merged)
    tagged.extend((int(f), "contact") for f in contact_merged)
    if not tagged:
        return []

    tagged.sort(key=lambda x: x[0])
    clusters: List[List[Tuple[int, str]]] = [[tagged[0]]]
    for item in tagged[1:]:
        if item[0] - clusters[-1][-1][0] <= merge_gap:
            clusters[-1].append(item)
        else:
            clusters.append([item])

    merged: List[Tuple[int, List[str]]] = []
    for cluster in clusters:
        frames = sorted(f for f, _ in cluster)
        center = int(round(_median(frames, default=float(frames[len(frames) // 2]))))
        sources = sorted({source for _, source in cluster})
        merged.append((center, sources))
    return merged


def _nearest_stroke_idx(frame: int, strokes: List[Stroke], tolerance: int = 14) -> Optional[int]:
    if not strokes:
        return None
    best_idx: Optional[int] = None
    best_delta = 1_000_000
    for idx, stroke in enumerate(strokes):
        delta = abs(stroke.peak_frame - frame)
        if delta < best_delta:
            best_delta = delta
            best_idx = idx
    if best_idx is None or best_delta > tolerance:
        return None
    return best_idx


def _adaptive_window(frame: int, speed_by_frame: Dict[int, float]) -> Tuple[int, int, float]:
    local = [speed_by_frame[f] for f in range(frame - 2, frame + 3) if f in speed_by_frame]
    speed = _median(local, default=0.0)
    if speed >= 28:
        return 6, 6, speed
    if speed >= 18:
        return 5, 5, speed
    return 3, 4, speed


def _build_detection_events(
    pose_strokes: List[Stroke],
    trajectory_event_frames: List[int],
    contact_event_frames: List[int],
    speed_by_frame: Dict[int, float],
    max_frame: int,
    fps: float = 30.0,
) -> List[DetectionEvent]:
    pose_event_frames = [int(stroke.peak_frame) for stroke in pose_strokes]
    merged = _merge_event_frames_with_sources(
        pose_event_frames=pose_event_frames,
        trajectory_event_frames=trajectory_event_frames,
        contact_event_frames=contact_event_frames,
        merge_gap=8,
        fps=fps,
    )

    events: List[DetectionEvent] = []
    for center, sources in merged:
        pre, post, speed = _adaptive_window(center, speed_by_frame)
        matched_idx = _nearest_stroke_idx(center, pose_strokes, tolerance=14)

        start_frame = center - pre
        end_frame = center + post
        if matched_idx is not None:
            matched = pose_strokes[matched_idx]
            start_frame = min(start_frame, matched.start_frame)
            end_frame = max(end_frame, matched.end_frame)

        start_frame = max(0, start_frame)
        end_frame = min(max_frame, end_frame)
        center = max(0, min(max_frame, center))

        events.append(
            DetectionEvent(
                frame=center,
                start_frame=start_frame,
                end_frame=end_frame,
                pre_frames=pre,
                post_frames=post,
                sources=sources,
                local_ball_speed=round(speed, 3),
                matched_stroke_idx=matched_idx,
            )
        )

    events.sort(key=lambda e: e.frame)
    return events


def _sample_event_frames(event: DetectionEvent, max_frame: int, num_frames: int = 6) -> List[int]:
    """
    Sample only pre-contact context plus contact frame.
    Default 6 frames: [-10, -8, -6, -4, -2, 0] relative to event frame.
    """
    center = event.frame

    frames: List[int] = []
    for offset in (-10, -8, -6, -4, -2, 0):
        frame = center + offset
        if 0 <= frame <= max_frame:
            frames.append(frame)

    return frames


def _save_debug_artifacts(
    session_id: str,
    event_frame: int,
    frames_data: List[Tuple[int, Any]],  # List of (frame_number, frame_img)
    label: str,
    confidence: float,
    reason: str,
    raw_response: str,
) -> Optional[str]:
    """
    Save debug artifacts for a Claude stroke classification call.

    Creates a folder with:
    - result.txt: Contains the label (forehand/backhand), confidence, and reason
    - frame_*.jpg: The images sent to Claude

    Returns the path to the debug folder, or None if saving failed.
    """
    if not DEBUG_STROKE_LOGGING_ENABLED:
        return None

    try:
        # Create unique folder for this analysis
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        folder_name = f"{timestamp}_session_{session_id}_frame_{event_frame}_{uuid.uuid4().hex[:8]}"
        debug_folder = os.path.join(DEBUG_STROKE_LOGGING_DIR, folder_name)
        os.makedirs(debug_folder, exist_ok=True)

        # Save result text file
        result_path = os.path.join(debug_folder, "result.txt")
        with open(result_path, "w") as f:
            f.write(f"Session ID: {session_id}\n")
            f.write(f"Event Frame: {event_frame}\n")
            f.write(f"Timestamp: {timestamp}\n")
            f.write(f"\n--- CLASSIFICATION RESULT ---\n")
            f.write(f"Label: {label}\n")
            f.write(f"Confidence: {confidence}\n")
            f.write(f"Reason: {reason}\n")
            f.write(f"\n--- RAW RESPONSE ---\n")
            f.write(raw_response)

        # Save each frame image
        for frame_number, frame_img in frames_data:
            if frame_img is not None:
                img_path = os.path.join(debug_folder, f"frame_{frame_number:06d}.jpg")
                cv2.imwrite(img_path, frame_img)

        return debug_folder
    except Exception as e:
        # Don't let debug logging failures break the main pipeline
        print(f"[DEBUG] Failed to save stroke debug artifacts: {e}")
        return None


def _encode_frame_for_claude(
    frame_img: Any,
    frame_number: int,
    ball_bbox: Optional[Tuple[float, float, float, float]] = None,
) -> Optional[str]:
    """
    Encode a video frame for Claude vision analysis.

    Args:
        frame_img: Raw video frame (no pose overlay)
        frame_number: Frame number for annotation
        ball_bbox: Optional (x1, y1, x2, y2) bounding box for the ball
    """
    if frame_img is None:
        return None

    try:
        h, w = frame_img.shape[:2]
    except Exception:
        return None

    max_width = 640
    scale = 1.0
    if w > max_width and w > 0:
        scale = max_width / float(w)
        frame_img = cv2.resize(frame_img, (max_width, max(1, int(round(h * scale)))))

    annotated = frame_img.copy()

    # Draw ball bounding box if available (bright green for visibility)
    if ball_bbox is not None:
        x1, y1, x2, y2 = ball_bbox
        # Scale bbox coordinates if frame was resized
        x1, y1, x2, y2 = int(x1 * scale), int(y1 * scale), int(x2 * scale), int(y2 * scale)
        cv2.rectangle(annotated, (x1, y1), (x2, y2), (0, 255, 0), 2)
        # Add "BALL" label above the box
        cv2.putText(
            annotated,
            "BALL",
            (x1, max(y1 - 5, 12)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.4,
            (0, 255, 0),
            1,
            cv2.LINE_AA,
        )

    # Frame number annotation
    cv2.putText(
        annotated,
        f"Frame {frame_number}",
        (16, 28),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.8,
        (255, 255, 255),
        2,
        cv2.LINE_AA,
    )
    ok, encoded = cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, 80])
    if not ok:
        return None
    return base64.b64encode(encoded.tobytes()).decode("ascii")


def _extract_text_from_anthropic_response(response: Any) -> str:
    chunks: List[str] = []
    content = getattr(response, "content", None)
    if isinstance(content, list):
        for block in content:
            block_type = getattr(block, "type", None)
            if block_type == "text":
                text = getattr(block, "text", "")
                if text:
                    chunks.append(str(text))
            elif isinstance(block, dict) and block.get("type") == "text":
                chunks.append(str(block.get("text", "")))
    return "\n".join(chunks).strip()


def _classify_single_event_with_claude(
    client: Any,
    model: str,
    cap: Any,
    event: DetectionEvent,
    max_frame: int,
    handedness: str,
    camera_facing: str,
    trajectory_by_frame: Optional[Dict[str, Any]] = None,
    session_id: str = "",
    elbow_context: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    debug_info(f"🎬 EXTRACTING FRAMES FOR EVENT at frame {event.frame}")
    frame_extract_start = perf_counter()

    frame_numbers = _sample_event_frames(event, max_frame=max_frame)
    image_blocks: List[Dict[str, Any]] = []
    sent_frames: List[int] = []
    debug_frames: List[Tuple[int, Any]] = []  # For debug logging: (frame_number, raw_frame_img)
    trajectory_by_frame = trajectory_by_frame or {}

    for frame_number in frame_numbers:
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_number)
        ok, frame_img = cap.read()
        if not ok:
            continue

        # Get ball bounding box for this frame if available
        ball_bbox: Optional[Tuple[float, float, float, float]] = None
        traj_point = trajectory_by_frame.get(frame_number)
        if traj_point:
            bbox = traj_point.get("bbox")
            if isinstance(bbox, (list, tuple)) and len(bbox) == 4:
                try:
                    ball_bbox = (float(bbox[0]), float(bbox[1]), float(bbox[2]), float(bbox[3]))
                except (ValueError, TypeError):
                    pass

        b64 = _encode_frame_for_claude(frame_img, frame_number, ball_bbox=ball_bbox)
        if not b64:
            continue
        sent_frames.append(frame_number)
        debug_frames.append((frame_number, frame_img.copy()))  # Store copy for debug logging
        image_blocks.append(
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": "image/jpeg",
                    "data": b64,
                },
            }
        )

    frame_extract_elapsed = (perf_counter() - frame_extract_start) * 1000
    debug_section_end(f"EXTRACTED {len(sent_frames)} FRAMES", elapsed_ms=frame_extract_elapsed)

    if not image_blocks:
        print(f"[STROKE DEBUG] ⚠️ NO FRAMES AVAILABLE FOR EVENT at frame {event.frame}")
        return {
            "label": "uncertain",
            "confidence": 0.0,
            "contact_frame": None,
            "reason": "no_frames_available_for_event",
            "frame_numbers": frame_numbers,
            "raw": "",
        }

    elbow_context_block = ""
    if isinstance(elbow_context, dict) and elbow_context:
        elbow_context_payload = {
            "label": elbow_context.get("label"),
            "confidence": elbow_context.get("confidence"),
            "reason": elbow_context.get("reason"),
            "frame_numbers": elbow_context.get("frame_numbers"),
            "elbow_debug": elbow_context.get("elbow_debug"),
        }
        elbow_context_block = (
            "Heuristic elbow-trend context (SECONDARY signal, use with moderate weight):\n"
            f"{json.dumps(elbow_context_payload, ensure_ascii=True)}\n"
            "Use this as a prior, but confirm classification from the visual motion in frames.\n\n"
        )

    prompt = (
        "You are analyzing a table tennis video to classify a hit.\n\n"
        f"Candidate hit frame: {event.frame}\n"
        f"Frames provided (pre-contact + contact): {sent_frames}\n"
        f"Player handedness: {handedness}\n"
        f"Camera facing: {camera_facing}\n"
        f"Detection sources: {', '.join(event.sources)}\n\n"
        "The ball is marked with a GREEN bounding box labeled 'BALL' when detected.\n\n"
        f"{elbow_context_block}"
        "Your task: Classify this event as FOREHAND, BACKHAND, or NO_HIT.\n\n"
        "CRITICAL RULES:\n"
        "1. Use 'no_hit' if this is not even close to a real shot/contact event.\n"
        "2. Otherwise classify as 'forehand' or 'backhand'.\n"
        "3. Keep response strictly JSON only.\n\n"
        "Analyze the player's form:\n"
        "- RACKET POSITION: Which side of the body is the racket on?\n"
        "- ARM POSITION: Extended across body (backhand) or on dominant side (forehand)?\n"
        "- STANCE & BODY ROTATION: How are shoulders/hips oriented?\n\n"
        "Classification guide:\n"
        "- FOREHAND: Racket on dominant-hand side (right for right-hander, left for left-hander)\n"
        "- BACKHAND: Racket crosses to non-dominant side, arm across body\n\n"
        "Return ONLY valid JSON:\n"
        "{\n"
        '  "label": "forehand" | "backhand" | "no_hit",\n'
        '  "confidence": 0.0-1.0,\n'
        '  "contact_frame": integer or null,\n'
        '  "reason": "brief explanation"\n'
        "}\n\n"
        "If uncertain and no clear shot action is visible, return no_hit."
    )

    user_content: List[Dict[str, Any]] = [{"type": "text", "text": prompt}]
    user_content.extend(image_blocks)

    debug_info(f"🤖 CALLING CLAUDE VISION API",
               Model=model,
               Event_Frame=event.frame,
               Frames_Sent=str(sent_frames))

    claude_api_start = perf_counter()
    try:
        response = client.messages.create(
            model=model,
            max_tokens=220,
            temperature=0,
            messages=[{"role": "user", "content": user_content}],
        )
        claude_api_elapsed = (perf_counter() - claude_api_start) * 1000
        raw_text = _extract_text_from_anthropic_response(response)
        parsed = _extract_first_json_object(raw_text) or {}
        # If JSON parse missed fields (or JSON was truncated), recover from raw text.
        fallback_fields = _extract_json_like_fields(raw_text)
        if fallback_fields:
            merged = dict(fallback_fields)
            merged.update(parsed)
            parsed = merged

        debug_section_end(f"CLAUDE API RESPONSE",
                         elapsed_ms=claude_api_elapsed,
                         Label=parsed.get('label', 'N/A'))

    except Exception as exc:
        debug_header(f"❌ CLAUDE API ERROR: {exc}")
        return {
            "label": "uncertain",
            "confidence": 0.0,
            "contact_frame": None,
            "reason": f"claude_error:{exc}",
            "frame_numbers": sent_frames,
            "raw": "",
        }

    label = _normalize_label(parsed.get("label"))
    confidence = _safe_float(parsed.get("confidence"), 0.0)
    confidence = max(0.0, min(1.0, confidence))
    contact_frame_raw = parsed.get("contact_frame")
    contact_frame = contact_frame_raw if isinstance(contact_frame_raw, int) else None
    reason = str(parsed.get("reason") or "").strip()[:220]

    debug_info(f"🏓 CLASSIFICATION RESULT",
               Frame=event.frame,
               Label=label.upper(),
               Confidence=f"{confidence:.2%}",
               Reason=reason[:60])

    # Save debug artifacts (images + result) for analysis
    debug_path = _save_debug_artifacts(
        session_id=session_id,
        event_frame=event.frame,
        frames_data=debug_frames,
        label=label,
        confidence=confidence,
        reason=reason or "no_reason_provided",
        raw_response=raw_text,
    )
    if debug_path:
        print(f"[DEBUG] Stroke analysis artifacts saved to: {debug_path}")

    return {
        "label": label,
        "confidence": round(confidence, 3),
        "contact_frame": contact_frame,
        "reason": reason or "no_reason_provided",
        "frame_numbers": sent_frames,
        "elbow_context": elbow_context if isinstance(elbow_context, dict) else None,
        "raw": raw_text[:1200],
        "debug_path": debug_path,
    }


def _classify_single_event_with_elbow_trend(
    event: DetectionEvent,
    player_pose_by_frame: Dict[int, Dict[str, Any]],
    player_frame_numbers: List[int],
    video_width: int,
    video_height: int,
    handedness: str,
) -> Dict[str, Any]:
    dominant_arm = "left" if str(handedness).lower() == "left" else "right"
    lookback_frames = max(4, _safe_int(os.getenv("STROKE_ELBOW_LOOKBACK_FRAMES", 10), 10))
    lookahead_frames = max(1, _safe_int(os.getenv("STROKE_ELBOW_LOOKAHEAD_FRAMES", lookback_frames), lookback_frames))
    min_delta_deg = max(1.0, _safe_float(os.getenv("STROKE_ELBOW_MIN_DELTA_DEG", 5.0), 5.0))

    sampled_frames: List[int] = []
    sampled_angles: List[float] = []

    max_pose_frame = player_frame_numbers[-1] if player_frame_numbers else event.frame
    start = max(0, event.frame - lookback_frames)
    end = min(max_pose_frame, event.frame + lookahead_frames)

    for target_frame in range(start, end + 1):
        nearest = _nearest_pose_frame_number(player_frame_numbers, target_frame, max_delta=2)
        if nearest is None:
            continue
        if nearest in sampled_frames:
            continue
        pose_frame = player_pose_by_frame.get(nearest)
        if not isinstance(pose_frame, dict):
            continue
        angle = _extract_elbow_angle_deg(pose_frame, dominant_arm, video_width, video_height)
        if angle is None:
            continue
        sampled_frames.append(nearest)
        sampled_angles.append(angle)

    if len(sampled_angles) < 3:
        return {
            "label": "uncertain",
            "confidence": 0.0,
            "contact_frame": event.frame,
            "reason": f"insufficient_{dominant_arm}_elbow_samples",
            "frame_numbers": sampled_frames,
            "elbow_debug": {
                "dominant_arm": dominant_arm,
                "lookback_frames": lookback_frames,
                "lookahead_frames": lookahead_frames,
                "min_delta_deg": round(min_delta_deg, 3),
                "sampled_frames": sampled_frames,
                "sampled_angles_deg": [round(float(a), 3) for a in sampled_angles],
                "smoothed_angles_deg": [],
                "delta_deg": None,
                "classification_rule": "increasing_backhand_decreasing_forehand",
            },
            "raw": "",
        }

    smoothed = _moving_average(sampled_angles, window=3)
    delta = float(smoothed[-1] - smoothed[0])

    # User-specified heuristic: increasing elbow angle => backhand, decreasing => forehand.
    if delta >= min_delta_deg:
        label = "backhand"
    elif delta <= -min_delta_deg:
        label = "forehand"
    else:
        label = "uncertain"

    if label in {"forehand", "backhand"}:
        confidence = min(0.95, 0.55 + abs(delta) / (min_delta_deg * 5.0))
    else:
        confidence = min(0.49, abs(delta) / min_delta_deg * 0.4)

    return {
        "label": label,
        "confidence": round(max(0.0, min(1.0, confidence)), 3),
        "contact_frame": event.frame,
        "reason": (
            f"{dominant_arm}_elbow_delta_deg={delta:.2f}; "
            f"threshold={min_delta_deg:.2f}; lookback={lookback_frames}; "
            f"lookahead={lookahead_frames}; rule=increasing_backhand"
        ),
        "frame_numbers": sampled_frames,
        "elbow_debug": {
            "dominant_arm": dominant_arm,
            "lookback_frames": lookback_frames,
            "lookahead_frames": lookahead_frames,
            "min_delta_deg": round(min_delta_deg, 3),
            "sampled_frames": sampled_frames,
            "sampled_angles_deg": [round(float(a), 3) for a in sampled_angles],
            "smoothed_angles_deg": [round(float(a), 3) for a in smoothed],
            "delta_deg": round(delta, 3),
            "classification_rule": "increasing_backhand_decreasing_forehand",
        },
        "raw": "",
    }


def _classify_events_with_elbow_trend(
    events: List[DetectionEvent],
    all_pose_frames: List[Dict[str, Any]],
    video_width: int,
    video_height: int,
    handedness: str,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    debug_header(f"💪 STARTING ELBOW TREND CLASSIFICATION - {len(events)} events")

    if not events:
        print(f"[STROKE DEBUG] ⚠️ NO EVENTS TO CLASSIFY")
        return [], {"enabled": False, "reason": "no_events", "source": "pose_elbow_trend"}

    player_pose_by_frame: Dict[int, Dict[str, Any]] = {}
    for pose_frame in all_pose_frames:
        frame_number = pose_frame.get("frame_number")
        if not isinstance(frame_number, int):
            continue
        if _safe_int(pose_frame.get("person_id"), 0) != 0:
            continue
        if frame_number not in player_pose_by_frame:
            player_pose_by_frame[frame_number] = pose_frame

    player_frame_numbers = sorted(player_pose_by_frame.keys())
    if not player_frame_numbers:
        fallback = [
            {
                "label": "uncertain",
                "confidence": 0.0,
                "contact_frame": event.frame,
                "reason": "player_pose_unavailable",
                "frame_numbers": [],
                "raw": "",
            }
            for event in events
        ]
        return fallback, {
            "enabled": True,
            "reason": "player_pose_unavailable",
            "source": "pose_elbow_trend",
        }

    elbow_start = perf_counter()
    results = [
        _classify_single_event_with_elbow_trend(
            event=event,
            player_pose_by_frame=player_pose_by_frame,
            player_frame_numbers=player_frame_numbers,
            video_width=video_width,
            video_height=video_height,
            handedness=handedness,
        )
        for event in events
    ]
    elbow_elapsed = (perf_counter() - elbow_start) * 1000

    debug_section_end(f"ELBOW TREND CLASSIFICATION COMPLETE",
                     elapsed_ms=elbow_elapsed,
                     Avg_Per_Event_ms=f"{elbow_elapsed/len(events):.1f}")

    return results, {
        "enabled": True,
        "reason": "ok",
        "source": "pose_elbow_trend",
        "lookback_frames": max(4, _safe_int(os.getenv("STROKE_ELBOW_LOOKBACK_FRAMES", 10), 10)),
        "lookahead_frames": max(
            1,
            _safe_int(
                os.getenv(
                    "STROKE_ELBOW_LOOKAHEAD_FRAMES",
                    str(max(4, _safe_int(os.getenv("STROKE_ELBOW_LOOKBACK_FRAMES", 10), 10))),
                ),
                max(4, _safe_int(os.getenv("STROKE_ELBOW_LOOKBACK_FRAMES", 10), 10)),
            ),
        ),
        "min_delta_deg": max(1.0, _safe_float(os.getenv("STROKE_ELBOW_MIN_DELTA_DEG", 5.0), 5.0)),
    }


def _compute_elbow_context_for_events(
    events: List[DetectionEvent],
    all_pose_frames: List[Dict[str, Any]],
    video_width: int,
    video_height: int,
    handedness: str,
) -> List[Dict[str, Any]]:
    player_pose_by_frame: Dict[int, Dict[str, Any]] = {}
    for pose_frame in all_pose_frames:
        frame_number = pose_frame.get("frame_number")
        if not isinstance(frame_number, int):
            continue
        if _safe_int(pose_frame.get("person_id"), 0) != 0:
            continue
        if frame_number not in player_pose_by_frame:
            player_pose_by_frame[frame_number] = pose_frame

    player_frame_numbers = sorted(player_pose_by_frame.keys())
    if not player_frame_numbers:
        return [{} for _ in events]

    contexts: List[Dict[str, Any]] = []
    for event in events:
        classification = _classify_single_event_with_elbow_trend(
            event=event,
            player_pose_by_frame=player_pose_by_frame,
            player_frame_numbers=player_frame_numbers,
            video_width=video_width,
            video_height=video_height,
            handedness=handedness,
        )
        elbow_debug = classification.get("elbow_debug") if isinstance(classification.get("elbow_debug"), dict) else None
        contexts.append(
            {
                "label": _normalize_label(classification.get("label")),
                "confidence": round(max(0.0, min(1.0, _safe_float(classification.get("confidence"), 0.0))), 3),
                "reason": str(classification.get("reason") or "")[:240],
                "frame_numbers": classification.get("frame_numbers", []),
                "elbow_debug": elbow_debug,
            }
        )
    return contexts


def _classify_events_with_claude(
    events: List[DetectionEvent],
    video_url: Optional[str],
    max_frame: int,
    handedness: str,
    camera_facing: str,
    trajectory_points: Optional[List[Dict[str, Any]]] = None,
    session_id: str = "",
    all_pose_frames: Optional[List[Dict[str, Any]]] = None,
    video_width: int = 0,
    video_height: int = 0,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    debug_header(f"🎯 STARTING CLAUDE CLASSIFICATION - {len(events)} events")

    if not events:
        print(f"[STROKE DEBUG] ⚠️ NO EVENTS TO CLASSIFY")
        return [], {"enabled": False, "reason": "no_events", "source": "claude_vision"}

    anthropic_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if not anthropic_key:
        fallback = [
            {
                "label": "uncertain",
                "confidence": 0.0,
                "contact_frame": None,
                "reason": "anthropic_key_missing",
                "frame_numbers": [],
                "raw": "",
            }
            for _ in events
        ]
        return fallback, {"enabled": False, "reason": "anthropic_key_missing", "source": "claude_vision"}

    if not video_url:
        fallback = [
            {
                "label": "uncertain",
                "confidence": 0.0,
                "contact_frame": None,
                "reason": "video_url_missing",
                "frame_numbers": [],
                "raw": "",
            }
            for _ in events
        ]
        return fallback, {"enabled": False, "reason": "video_url_missing", "source": "claude_vision"}

    # Build trajectory lookup by frame for ball bounding box overlay
    trajectory_by_frame: Dict[int, Dict[str, Any]] = {}
    if trajectory_points:
        for point in trajectory_points:
            frame = point.get("frame")
            if isinstance(frame, int):
                trajectory_by_frame[frame] = point

    local_video_path: Optional[str] = None
    cap = None
    try:
        import anthropic

        model = os.getenv("STROKE_CLAUDE_MODEL", "claude-sonnet-4-20250514")
        client = anthropic.Anthropic(api_key=anthropic_key)

        storage_path = extract_video_path_from_url(video_url)
        local_video_path = download_video_from_storage(storage_path)
        cap = cv2.VideoCapture(local_video_path)
        if not cap.isOpened():
            raise RuntimeError("failed_to_open_local_video")

        elbow_contexts = _compute_elbow_context_for_events(
            events=events,
            all_pose_frames=all_pose_frames or [],
            video_width=video_width,
            video_height=video_height,
            handedness=handedness,
        )

        results: List[Dict[str, Any]] = []
        total_claude_start = perf_counter()

        for idx, event in enumerate(events, 1):
            debug_info(f"📊 PROCESSING EVENT {idx}/{len(events)} at frame {event.frame}")
            results.append(
                _classify_single_event_with_claude(
                    client=client,
                    model=model,
                    cap=cap,
                    event=event,
                    max_frame=max_frame,
                    handedness=handedness,
                    camera_facing=camera_facing,
                    trajectory_by_frame=trajectory_by_frame,
                    session_id=session_id,
                    elbow_context=elbow_contexts[idx - 1] if (idx - 1) < len(elbow_contexts) else None,
                )
            )

        total_claude_elapsed = (perf_counter() - total_claude_start) * 1000
        debug_section_end(f"ALL CLAUDE CLASSIFICATIONS COMPLETE",
                         elapsed_ms=total_claude_elapsed,
                         Total_Time_s=f"{total_claude_elapsed/1000:.1f}",
                         Avg_Per_Event_ms=f"{total_claude_elapsed/len(events):.1f}")

        return results, {"enabled": True, "reason": "ok", "model": model, "source": "claude_vision"}
    except Exception as exc:
        fallback = [
            {
                "label": "uncertain",
                "confidence": 0.0,
                "contact_frame": None,
                "reason": f"claude_pipeline_error:{exc}",
                "frame_numbers": [],
                "raw": "",
            }
            for _ in events
        ]
        return fallback, {
            "enabled": False,
            "reason": f"claude_pipeline_error:{exc}",
            "source": "claude_vision",
        }
    finally:
        try:
            if cap is not None:
                cap.release()
        except Exception:
            pass
        if local_video_path:
            cleanup_temp_file(local_video_path)


def _apply_hitter_inference_to_metrics(metrics: Dict[str, Any], hitter_info: Dict[str, Any]) -> None:
    if not isinstance(hitter_info, dict):
        return
    metrics.update(
        {
            "event_hitter": str(hitter_info.get("hitter") or "unknown"),
            "event_hitter_confidence": round(_safe_float(hitter_info.get("confidence"), 0.0), 3),
            "event_hitter_reason": str(hitter_info.get("reason") or ""),
            "event_hitter_method": str(hitter_info.get("method") or ""),
            "event_ball_side": hitter_info.get("ball_side"),
            "event_player_side": hitter_info.get("player_side"),
            "event_opponent_side": hitter_info.get("opponent_side"),
            "event_ball_x": hitter_info.get("ball_x"),
            "event_player_x": hitter_info.get("player_x"),
            "event_opponent_x": hitter_info.get("opponent_x"),
        }
    )


def _build_final_strokes(
    events: List[DetectionEvent],
    classification_results: List[Dict[str, Any]],
    pose_strokes: List[Stroke],
    fps: float,
    classifier_source: str,
    hitter_by_event: Optional[List[Dict[str, Any]]] = None,
) -> List[Stroke]:
    """
    Build final stroke objects from detection events and classifications.

    Key principles:
    - Over-detect: keep events unless classifier explicitly says "no_hit"
    - Classifier result is the source of truth for forehand/backhand classification
    - Pose data is only used for timing/velocity, NOT for stroke type
    """
    final: List[Stroke] = []

    for idx, event in enumerate(events):
        classification = classification_results[idx] if idx < len(classification_results) else {}
        hitter_info = hitter_by_event[idx] if hitter_by_event and idx < len(hitter_by_event) else {}
        label = _normalize_label(classification.get("label"))
        confidence = _safe_float(classification.get("confidence"), 0.0)
        reason = str(classification.get("reason") or "")[:240]
        elbow_context = classification.get("elbow_context") if isinstance(classification.get("elbow_context"), dict) else None

        if label == "no_hit":
            continue

        # Classifier label is the source for stroke type.
        # If uncertain, keep as "unknown" (over-detect).
        if label in {"forehand", "backhand"}:
            stroke_type = label
        else:
            stroke_type = "unknown"

        matched_idx = event.matched_stroke_idx
        matched: Optional[Stroke] = None
        if matched_idx is not None and 0 <= matched_idx < len(pose_strokes):
            matched = pose_strokes[matched_idx]

        if matched is not None:
            # Use pose data for timing/velocity, classifier for stroke type
            metrics = dict(matched.metrics or {})
            metrics.update(
                {
                    "classifier_source": classifier_source,
                    "classifier_label": label,
                    "classifier_confidence": round(confidence, 3),
                    "classifier_reason": reason,
                    "classifier_contact_frame": classification.get("contact_frame"),
                    "classifier_frame_window": classification.get("frame_numbers", []),
                    "event_frame": event.frame,
                    "event_sources": event.sources,
                    "event_local_ball_speed": event.local_ball_speed,
                    "event_matched_pose_stroke": True,
                }
            )
            if classifier_source == "claude_vision":
                metrics.update(
                    {
                        "claude_label": label,
                        "claude_confidence": round(confidence, 3),
                        "claude_reason": reason,
                        "claude_contact_frame": classification.get("contact_frame"),
                        "claude_frame_window": classification.get("frame_numbers", []),
                    }
                )
            if elbow_context:
                elbow_debug = elbow_context.get("elbow_debug") if isinstance(elbow_context.get("elbow_debug"), dict) else {}
                metrics["classifier_elbow_hint"] = elbow_context
                metrics["classifier_elbow_frame_window"] = elbow_context.get("frame_numbers", [])
                metrics["classifier_elbow_reason"] = str(elbow_context.get("reason") or "")[:240]
                delta = elbow_debug.get("delta_deg")
                if isinstance(delta, (int, float)):
                    metrics["classifier_elbow_delta_deg"] = round(float(delta), 3)
            _apply_hitter_inference_to_metrics(metrics, hitter_info)

            final.append(
                Stroke(
                    start_frame=matched.start_frame,
                    end_frame=matched.end_frame,
                    peak_frame=matched.peak_frame,
                    stroke_type=stroke_type,  # Always from classifier
                    duration=matched.duration,
                    max_velocity=matched.max_velocity,
                    form_score=matched.form_score,
                    metrics=metrics,
                )
            )
            continue

        # Trajectory-based event without pose match - still keep it (over-detect)
        duration = max((event.end_frame - event.start_frame) / max(1.0, fps), 0.05)
        synthetic_form_score = max(45.0, min(95.0, 60.0 + confidence * 30.0))
        metrics = {
            "classifier_source": classifier_source,
            "classifier_label": label,
            "classifier_confidence": round(confidence, 3),
            "classifier_reason": reason,
            "classifier_contact_frame": classification.get("contact_frame"),
            "classifier_frame_window": classification.get("frame_numbers", []),
            "event_frame": event.frame,
            "event_sources": event.sources,
            "event_local_ball_speed": event.local_ball_speed,
            "event_matched_pose_stroke": False,
            "synthetic_event": True,
        }
        if classifier_source == "claude_vision":
            metrics.update(
                {
                    "claude_label": label,
                    "claude_confidence": round(confidence, 3),
                    "claude_reason": reason,
                    "claude_contact_frame": classification.get("contact_frame"),
                    "claude_frame_window": classification.get("frame_numbers", []),
                }
            )
        if elbow_context:
            elbow_debug = elbow_context.get("elbow_debug") if isinstance(elbow_context.get("elbow_debug"), dict) else {}
            metrics["classifier_elbow_hint"] = elbow_context
            metrics["classifier_elbow_frame_window"] = elbow_context.get("frame_numbers", [])
            metrics["classifier_elbow_reason"] = str(elbow_context.get("reason") or "")[:240]
            delta = elbow_debug.get("delta_deg")
            if isinstance(delta, (int, float)):
                metrics["classifier_elbow_delta_deg"] = round(float(delta), 3)
        _apply_hitter_inference_to_metrics(metrics, hitter_info)
        final.append(
            Stroke(
                start_frame=event.start_frame,
                end_frame=event.end_frame,
                peak_frame=event.frame,
                stroke_type=stroke_type,  # Always from Claude
                duration=duration,
                max_velocity=event.local_ball_speed,
                form_score=round(synthetic_form_score, 1),
                metrics=metrics,
            )
        )

    final.sort(key=lambda s: s.peak_frame)
    return final


def detect_strokes_hybrid(
    *,
    session_id: str,
    pose_frames: List[Dict[str, Any]],
    all_pose_frames: Optional[List[Dict[str, Any]]] = None,
    trajectory_data: Optional[Dict[str, Any]],
    video_url: Optional[str],
    handedness: str,
    camera_facing: str,
    use_claude_classifier: bool = True,
    progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
) -> Tuple[List[Stroke], Dict[str, Any], StrokeDetector, Dict[str, Any]]:
    """
    Run hybrid stroke detection + event classification.

    Returns:
        (final_strokes, debug_stats, detector_for_summary, debug_payload)
    """
    debug_pipeline_start(
        session_id,
        Handedness=handedness,
        Camera_Facing=camera_facing,
        Use_Claude=use_claude_classifier,
        Pose_Frames_Player=len(pose_frames)
    )

    trajectory_data = trajectory_data if isinstance(trajectory_data, dict) else {}
    all_pose_frames = all_pose_frames if isinstance(all_pose_frames, list) and all_pose_frames else pose_frames
    trajectory_points = _sanitize_trajectory_points(trajectory_data.get("frames", []))
    video_info = trajectory_data.get("video_info", {}) if isinstance(trajectory_data.get("video_info"), dict) else {}
    video_width = max(1, _safe_int(video_info.get("width"), 1280))
    video_height = max(1, _safe_int(video_info.get("height"), 720))
    fps = _safe_float(video_info.get("fps"), 30.0)
    if fps <= 0:
        fps = 30.0
    max_pose_frame = max((f.get("frame_number", 0) for f in all_pose_frames if isinstance(f.get("frame_number"), int)), default=0)
    max_traj_frame = max((p.get("frame", 0) for p in trajectory_points), default=0)
    max_frame_from_video = _safe_int(video_info.get("total_frames"), 0) - 1
    max_frame = max(max_pose_frame, max_traj_frame, max(0, max_frame_from_video))

    detector = StrokeDetector(
        # Slightly lower threshold to tolerate flickery trajectory/pose while Claude filters false hits.
        velocity_threshold=_safe_float(os.getenv("STROKE_VELOCITY_THRESHOLD", "42.0"), 42.0),
        min_stroke_duration=_safe_int(os.getenv("STROKE_MIN_DURATION_FRAMES", 4), 4),
        max_stroke_duration=_safe_int(os.getenv("STROKE_MAX_DURATION_FRAMES", 70), 70),
        handedness=handedness,
        camera_facing=camera_facing,
    )

    pipeline_stage_order = [
        "detect_pose_strokes",
        "detect_trajectory_reversals",
        "detect_contacts",
        "merge_detection_events",
        "classify_events_claude" if use_claude_classifier else "classify_events_elbow",
        "infer_hitter",
        "build_final_strokes",
    ]
    pipeline_stage_timings_ms: Dict[str, float] = {}
    pipeline_started = perf_counter()

    def _emit_stage(stage_id: str, status: str, duration_ms: Optional[float] = None) -> None:
        if progress_callback is None:
            return
        payload: Dict[str, Any] = {
            "stage_id": stage_id,
            "status": status,
            "stage_timings_ms": dict(pipeline_stage_timings_ms),
            "stage_order": list(pipeline_stage_order),
        }
        if isinstance(duration_ms, (int, float)):
            payload["duration_ms"] = round(float(duration_ms), 1)
        try:
            progress_callback(payload)
        except Exception:
            pass

    def _run_stage(stage_id: str, fn: Callable[[], Any]) -> Any:
        _emit_stage(stage_id, "running")
        started = perf_counter()
        result = fn()
        duration_ms = (perf_counter() - started) * 1000.0
        pipeline_stage_timings_ms[stage_id] = round(duration_ms, 1)
        _emit_stage(stage_id, "completed", duration_ms=duration_ms)
        return result

    raw_pose_strokes = _run_stage("detect_pose_strokes", lambda: detector.detect_strokes(pose_frames))
    debug_info(f"🎯 POSE STROKE PROPOSALS: {len(raw_pose_strokes)} strokes detected")

    speed_by_frame = _build_speed_by_frame(trajectory_points)
    trajectory_events = _run_stage(
        "detect_trajectory_reversals",
        lambda: _detect_direction_change_events(
            trajectory_points,
            video_width=video_width,
            video_height=video_height,
            min_confidence=_safe_float(os.getenv("STROKE_TRAJ_MIN_CONFIDENCE", "0.10"), 0.10),
            min_delta_px=_safe_float(os.getenv("STROKE_TRAJ_MIN_DELTA_PX", "3.0"), 3.0),
            min_span_px=_safe_float(os.getenv("STROKE_TRAJ_MIN_SPAN_PX", "12.0"), 12.0),
            min_gap_frames=_safe_int(os.getenv("STROKE_TRAJ_MIN_GAP_FRAMES", 5), 5),
            hit_frame_offset=_safe_int(os.getenv("STROKE_HIT_FRAME_OFFSET", 0), 0),
            direction_window_frames=_safe_int(os.getenv("STROKE_TRAJ_DIRECTION_WINDOW_FRAMES", 30), 30),
        ),
    )
    debug_info(f"🔄 TRAJECTORY DIRECTION CHANGES: {len(trajectory_events)} events")

    contact_frames = _run_stage(
        "detect_contacts",
        lambda: _detect_contact_frames(trajectory_points, all_pose_frames, video_info),
    )
    debug_info(f"🤝 WRIST-BALL CONTACTS: {len(contact_frames)} contacts")

    events = _run_stage(
        "merge_detection_events",
        lambda: _build_detection_events(
            pose_strokes=raw_pose_strokes,
            trajectory_event_frames=trajectory_events,
            contact_event_frames=contact_frames,
            speed_by_frame=speed_by_frame,
            max_frame=max_frame,
            fps=fps,
        ),
    )
    debug_info(f"🔗 MERGED DETECTION EVENTS: {len(events)} candidate events")
    for idx, event in enumerate(events, 1):
        print(f"[STROKE DEBUG]    Event {idx}: frame {event.frame}, sources={event.sources}, speed={event.local_ball_speed:.1f}")

    classify_stage_id = "classify_events_claude" if use_claude_classifier else "classify_events_elbow"
    if use_claude_classifier:
        classification_results, classifier_meta = _run_stage(
            classify_stage_id,
            lambda: _classify_events_with_claude(
                events=events,
                video_url=video_url,
                max_frame=max_frame,
                handedness=handedness,
                camera_facing=camera_facing,
                trajectory_points=trajectory_points,
                session_id=session_id,
                all_pose_frames=all_pose_frames,
                video_width=video_width,
                video_height=video_height,
            ),
        )
    else:
        classification_results, classifier_meta = _run_stage(
            classify_stage_id,
            lambda: _classify_events_with_elbow_trend(
                events=events,
                all_pose_frames=all_pose_frames,
                video_width=video_width,
                video_height=video_height,
                handedness=handedness,
            ),
        )

    def _infer_hitter_stage() -> List[Dict[str, Any]]:
        ball_center_by_frame: Dict[int, float] = {}
        for point in trajectory_points:
            frame = point.get("frame")
            if not isinstance(frame, int):
                continue
            ball_xy = _extract_ball_xy(point, video_width, video_height)
            if ball_xy is None:
                continue
            ball_center_by_frame[frame] = ball_xy[0]

        player_center_by_frame, opponent_center_by_frame = _build_pose_center_maps(
            all_pose_frames,
            video_width=video_width,
            video_height=video_height,
        )
        return [
            _infer_hitter_for_event(
                frame=event.frame,
                ball_centers=ball_center_by_frame,
                player_centers=player_center_by_frame,
                opponent_centers=opponent_center_by_frame,
                video_width=video_width,
                proximity_threshold=_safe_float(
                    os.getenv("STROKE_HITTER_PROXIMITY_THRESHOLD", "0.14"),
                    0.14,
                ),
                separation_margin=_safe_float(
                    os.getenv("STROKE_HITTER_SEPARATION_MARGIN", "0.035"),
                    0.035,
                ),
            )
            for event in events
        ]

    hitter_by_event = _run_stage("infer_hitter", _infer_hitter_stage)
    player_hits = sum(1 for h in hitter_by_event if h.get("hitter") == "player")
    opponent_hits = sum(1 for h in hitter_by_event if h.get("hitter") == "opponent")
    debug_info(f"👤 HITTER INFERENCE COMPLETE",
               Player_Hits=player_hits,
               Opponent_Hits=opponent_hits)

    final_strokes = _run_stage(
        "build_final_strokes",
        lambda: _build_final_strokes(
            events=events,
            classification_results=classification_results,
            pose_strokes=raw_pose_strokes,
            fps=fps,
            classifier_source=str(classifier_meta.get("source") or "unknown_classifier"),
            hitter_by_event=hitter_by_event,
        ),
    )

    # If Claude pipeline was unavailable, keep pose strokes as fallback so UX doesn't regress.
    if (
        not final_strokes
        and str(classifier_meta.get("source")) == "claude_vision"
        and not classifier_meta.get("enabled", False)
    ):
        fallback_strokes: List[Stroke] = []
        for stroke in raw_pose_strokes:
            metrics = dict(stroke.metrics or {})
            metrics["classifier_source"] = "pose_heuristic_fallback"
            metrics["claude_status"] = classifier_meta.get("reason")
            fallback_strokes.append(
                Stroke(
                    start_frame=stroke.start_frame,
                    end_frame=stroke.end_frame,
                    peak_frame=stroke.peak_frame,
                    stroke_type=stroke.stroke_type,
                    duration=stroke.duration,
                    max_velocity=stroke.max_velocity,
                    form_score=stroke.form_score,
                    metrics=metrics,
                )
            )
        final_strokes = fallback_strokes

    total_pipeline_elapsed = (perf_counter() - pipeline_started) * 1000.0
    forehand_count = sum(1 for s in final_strokes if s.stroke_type == "forehand")
    backhand_count = sum(1 for s in final_strokes if s.stroke_type == "backhand")
    unknown_count = sum(1 for s in final_strokes if s.stroke_type == "unknown")
    debug_pipeline_end(
        len(final_strokes),
        total_pipeline_elapsed,
        Forehand=forehand_count,
        Backhand=backhand_count,
        Unknown=unknown_count
    )

    debug_stats = {
        "session_id": session_id,
        "pose_frames": len(pose_frames),
        "pose_frames_player": len(pose_frames),
        "pose_frames_all": len(all_pose_frames),
        "pose_frames_opponent": sum(1 for f in all_pose_frames if _safe_int(f.get("person_id"), 0) == 1),
        "trajectory_points": len(trajectory_points),
        "raw_pose_strokes": len(raw_pose_strokes),
        "trajectory_events": len(trajectory_events),
        "contact_events": len(contact_frames),
        "merged_events": len(events),
        "final_strokes": len(final_strokes),
        "classifier": classifier_meta,
        "claude": classifier_meta if str(classifier_meta.get("source")) == "claude_vision" else {
            "enabled": False,
            "reason": "disabled_by_setting",
        },
        "pipeline_stage_order": pipeline_stage_order,
        "pipeline_stage_timings_ms": pipeline_stage_timings_ms,
        "pipeline_elapsed_ms": round((perf_counter() - pipeline_started) * 1000.0, 1),
    }

    event_logs: List[Dict[str, Any]] = []
    for idx, event in enumerate(events):
        classification = classification_results[idx] if idx < len(classification_results) else {}
        hitter_info = hitter_by_event[idx] if idx < len(hitter_by_event) else {}
        matched_stroke = None
        if event.matched_stroke_idx is not None and 0 <= event.matched_stroke_idx < len(raw_pose_strokes):
            matched_stroke = raw_pose_strokes[event.matched_stroke_idx]

        event_logs.append(
            {
                "event_index": idx,
                "frame": event.frame,
                "start_frame": event.start_frame,
                "end_frame": event.end_frame,
                "pre_frames": event.pre_frames,
                "post_frames": event.post_frames,
                "sources": event.sources,
                "local_ball_speed": event.local_ball_speed,
                "matched_pose_stroke_idx": event.matched_stroke_idx,
                "matched_pose_stroke_peak_frame": matched_stroke.peak_frame if matched_stroke else None,
                "matched_pose_stroke_type": matched_stroke.stroke_type if matched_stroke else None,
                "matched_pose_stroke_window": (
                    {"start_frame": matched_stroke.start_frame, "end_frame": matched_stroke.end_frame}
                    if matched_stroke
                    else None
                ),
                "classification": classification,
                "claude": classification,
                "hitter_inference": hitter_info,
            }
        )

    debug_payload = {
        "session_id": session_id,
        "settings": {
            "handedness": handedness,
            "camera_facing": camera_facing,
            "use_claude_classifier": bool(use_claude_classifier),
            "velocity_threshold": _safe_float(os.getenv("STROKE_VELOCITY_THRESHOLD", "42.0"), 42.0),
            "min_duration_frames": _safe_int(os.getenv("STROKE_MIN_DURATION_FRAMES", 4), 4),
            "max_duration_frames": _safe_int(os.getenv("STROKE_MAX_DURATION_FRAMES", 70), 70),
            "traj_min_confidence": _safe_float(os.getenv("STROKE_TRAJ_MIN_CONFIDENCE", "0.10"), 0.10),
            "traj_min_delta_px": _safe_float(os.getenv("STROKE_TRAJ_MIN_DELTA_PX", "3.0"), 3.0),
            "traj_min_span_px": _safe_float(os.getenv("STROKE_TRAJ_MIN_SPAN_PX", "12.0"), 12.0),
            "traj_min_gap_frames": _safe_int(os.getenv("STROKE_TRAJ_MIN_GAP_FRAMES", 5), 5),
            "hit_frame_offset": _safe_int(os.getenv("STROKE_HIT_FRAME_OFFSET", 0), 0),
            "traj_direction_window_frames": _safe_int(os.getenv("STROKE_TRAJ_DIRECTION_WINDOW_FRAMES", 30), 30),
            "elbow_lookback_frames": max(4, _safe_int(os.getenv("STROKE_ELBOW_LOOKBACK_FRAMES", 10), 10)),
            "elbow_lookahead_frames": max(
                1,
                _safe_int(
                    os.getenv(
                        "STROKE_ELBOW_LOOKAHEAD_FRAMES",
                        str(max(4, _safe_int(os.getenv("STROKE_ELBOW_LOOKBACK_FRAMES", 10), 10))),
                    ),
                    max(4, _safe_int(os.getenv("STROKE_ELBOW_LOOKBACK_FRAMES", 10), 10)),
                ),
            ),
            "elbow_min_delta_deg": max(1.0, _safe_float(os.getenv("STROKE_ELBOW_MIN_DELTA_DEG", 5.0), 5.0)),
        },
        "classifier_meta": classifier_meta,
        "claude_meta": classifier_meta if str(classifier_meta.get("source")) == "claude_vision" else {
            "enabled": False,
            "reason": "disabled_by_setting",
        },
        "debug_stats": debug_stats,
        "events": event_logs,
        "trajectory_event_frames": trajectory_events,
        "contact_frames": contact_frames,
        "hitter_inference": hitter_by_event,
    }
    return final_strokes, debug_stats, detector, debug_payload
