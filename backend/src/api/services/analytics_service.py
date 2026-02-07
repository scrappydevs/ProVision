"""
Analytics Service
Computes comprehensive performance metrics from ball trajectory and pose data.
"""

import json
import math
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass
import logging

logger = logging.getLogger(__name__)


def _to_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return default


def _normalize_keypoints(keypoints_data: Any) -> Dict[str, Dict[str, float]]:
    """Normalize keypoints into {name: {x, y, z, visibility}}."""
    if not keypoints_data:
        return {}

    if isinstance(keypoints_data, str):
        try:
            keypoints_data = json.loads(keypoints_data)
        except Exception:
            return {}

    # List of keypoint dicts (e.g., pose model output)
    if isinstance(keypoints_data, list):
        kp_map: Dict[str, Dict[str, float]] = {}
        for kp in keypoints_data:
            if isinstance(kp, str):
                try:
                    kp = json.loads(kp)
                except Exception:
                    continue
            if not isinstance(kp, dict):
                continue
            name = kp.get("name")
            if not name:
                continue
            
            # Get visibility with fallbacks (avoid nested .get() on non-dict)
            vis_val = kp.get("visibility")
            if vis_val is None:
                vis_val = kp.get("conf")
            if vis_val is None:
                vis_val = kp.get("score", 0)
            visibility = _to_float(vis_val)
            
            kp_map[name] = {
                "x": _to_float(kp.get("x", 0)),
                "y": _to_float(kp.get("y", 0)),
                "z": _to_float(kp.get("z", 0)),
                "visibility": visibility,
            }
        return kp_map

    # Dict of name -> keypoint
    if isinstance(keypoints_data, dict):
        kp_map = {}
        for name, kp in keypoints_data.items():
            if isinstance(kp, str):
                try:
                    kp = json.loads(kp)
                except Exception:
                    # Failed to parse, skip this keypoint
                    continue
            if isinstance(kp, list) and len(kp) >= 3:
                x = _to_float(kp[0])
                y = _to_float(kp[1])
                if len(kp) >= 4:
                    z = _to_float(kp[2])
                    visibility = _to_float(kp[3])
                else:
                    z = 0.0
                    visibility = _to_float(kp[2])
                kp_map[name] = {"x": x, "y": y, "z": z, "visibility": visibility}
                continue
            if isinstance(kp, dict):
                # Get visibility with fallbacks (handle different schemas)
                vis_val = kp.get("visibility")
                if vis_val is None:
                    vis_val = kp.get("conf")
                if vis_val is None:
                    vis_val = kp.get("score", 0)
                visibility = _to_float(vis_val)
                
                kp_map[name] = {
                    "x": _to_float(kp.get("x", 0)),
                    "y": _to_float(kp.get("y", 0)),
                    "z": _to_float(kp.get("z", 0)),
                    "visibility": visibility,
                }
            # If kp is neither list nor dict after parsing, skip it
        return kp_map

    return {}


@dataclass
class SpeedStats:
    """Speed statistics."""
    max: float
    min: float
    avg: float
    median: float
    stddev: float
    timeline: List[Dict[str, Any]]  # [{frame, speed, timestamp}]
    distribution: Dict[str, int]  # {slow, medium, fast} counts


@dataclass
class TrajectoryStats:
    """Trajectory statistics."""
    total_distance: float
    bounce_count: int
    bounces: List[int]  # frame numbers
    rallies: List[Dict[str, Any]]  # [{start_frame, end_frame, length, avg_speed}]
    direction_changes: int
    arc_heights: List[float]


@dataclass
class PoseMovementStats:
    """Pose movement statistics."""
    stance_width_timeline: List[Dict[str, Any]]  # [{frame, width}]
    arm_extension_timeline: List[Dict[str, Any]]  # [{frame, left_ext, right_ext}]
    velocity_timeline: List[Dict[str, Any]]  # [{frame, velocity}]
    avg_stance_width: float
    avg_velocity: float


@dataclass
class ContactAnalysis:
    """Ball contact analysis."""
    contact_moments: List[Dict[str, Any]]  # [{frame, wrist_x, wrist_y, ball_speed, height}]
    avg_contact_height: float
    contact_height_distribution: List[Dict[str, Any]]  # [{height_range, count}]


def compute_ball_speed_analytics(trajectory_data: Dict[str, Any], fps: float = 30.0) -> SpeedStats:
    """
    Compute comprehensive speed analytics from trajectory data.
    
    Args:
        trajectory_data: Dictionary with 'frames' and 'velocity' arrays
        fps: Video frames per second
        
    Returns:
        SpeedStats with timeline, distribution, and statistics
    """
    frames = trajectory_data.get("frames", [])
    velocity_px_per_frame = trajectory_data.get("velocity", [])
    
    if not frames or not velocity_px_per_frame:
        return SpeedStats(0, 0, 0, 0, 0, [], {"slow": 0, "medium": 0, "fast": 0})
    
    # Convert px/frame to km/h
    # Assumption: Table is ~2.74m wide, typical frame width ~1280px
    # So 1 pixel ≈ 2.74 / 1280 ≈ 0.00214 meters
    # Speed (m/s) = velocity_px_per_frame * pixels_to_meters * fps
    # Speed (km/h) = speed_m_s * 3.6
    
    video_info = trajectory_data.get("video_info", {})
    frame_width = video_info.get("width", 1280)
    
    # For ping pong: table width 1.525m, but ball moves beyond table
    # Use conservative estimate: frame_width maps to ~3m
    pixels_to_meters = 3.0 / frame_width
    
    speeds_kmh = []
    timeline = []
    
    for i, vel_px in enumerate(velocity_px_per_frame):
        if i < len(frames):
            frame_num = frames[i].get("frame", i)
            speed_m_s = vel_px * pixels_to_meters * fps
            speed_kmh = speed_m_s * 3.6
            speeds_kmh.append(speed_kmh)
            timeline.append({
                "frame": frame_num,
                "speed": round(speed_kmh, 1),
                "timestamp": round(frame_num / fps, 2)
            })
    
    if not speeds_kmh:
        return SpeedStats(0, 0, 0, 0, 0, [], {"slow": 0, "medium": 0, "fast": 0})
    
    # Statistics
    max_speed = max(speeds_kmh)
    min_speed = min(speeds_kmh)
    avg_speed = sum(speeds_kmh) / len(speeds_kmh)
    
    sorted_speeds = sorted(speeds_kmh)
    median_speed = sorted_speeds[len(sorted_speeds) // 2]
    
    variance = sum((s - avg_speed) ** 2 for s in speeds_kmh) / len(speeds_kmh)
    stddev = math.sqrt(variance)
    
    # Distribution (speed zones)
    slow_count = sum(1 for s in speeds_kmh if s < avg_speed * 0.7)
    fast_count = sum(1 for s in speeds_kmh if s > avg_speed * 1.3)
    medium_count = len(speeds_kmh) - slow_count - fast_count
    
    return SpeedStats(
        max=round(max_speed, 1),
        min=round(min_speed, 1),
        avg=round(avg_speed, 1),
        median=round(median_speed, 1),
        stddev=round(stddev, 1),
        timeline=timeline,
        distribution={"slow": slow_count, "medium": medium_count, "fast": fast_count}
    )


def detect_bounces(frames: List[Dict[str, Any]], velocity: List[float]) -> Tuple[List[int], List[Dict[str, Any]]]:
    """
    Detect ball bounces and segment into rallies.
    
    Bounce detection logic:
    - Y-velocity reversal (going down → going up)
    - Y-position local minimum
    - Confidence > 0.3
    
    Returns:
        (bounce_frames, rallies)
    """
    if len(frames) < 10:
        return [], []
    
    bounces = []
    
    # Compute y-velocity (change in y position)
    y_velocities = []
    for i in range(1, len(frames)):
        dy = frames[i].get("y", 0) - frames[i - 1].get("y", 0)
        y_velocities.append(dy)
    
    # Find local minima in y (ball at lowest point) with velocity reversal
    for i in range(2, len(frames) - 2):
        y_curr = frames[i].get("y", 0)
        y_prev = frames[i - 1].get("y", 0)
        y_next = frames[i + 1].get("y", 0)
        conf = frames[i].get("confidence", 0)
        
        # Local minimum in y position
        if y_curr > y_prev and y_curr > y_next and conf > 0.3:
            # Check if velocity reversed (was going down, now going up)
            if i - 1 < len(y_velocities) and i < len(y_velocities):
                if y_velocities[i - 1] > 0 and y_velocities[i] < 0:
                    bounces.append(frames[i].get("frame", i))
    
    # Segment into rallies (bounce to bounce)
    rallies = []
    if bounces:
        # First rally: start to first bounce
        if bounces[0] > 5:
            rally_frames = frames[0:bounces[0]]
            rally_velocities = velocity[0:bounces[0]] if bounces[0] <= len(velocity) else []
            if rally_velocities:
                rallies.append({
                    "start_frame": frames[0].get("frame", 0),
                    "end_frame": bounces[0],
                    "length": bounces[0],
                    "avg_speed": round(sum(rally_velocities) / len(rally_velocities), 1)
                })
        
        # Middle rallies: bounce to bounce
        for i in range(len(bounces) - 1):
            start_idx = bounces[i]
            end_idx = bounces[i + 1]
            if end_idx - start_idx > 2:
                rally_velocities = velocity[start_idx:end_idx] if end_idx <= len(velocity) else []
                if rally_velocities:
                    rallies.append({
                        "start_frame": bounces[i],
                        "end_frame": bounces[i + 1],
                        "length": end_idx - start_idx,
                        "avg_speed": round(sum(rally_velocities) / len(rally_velocities), 1)
                    })
        
        # Last rally: last bounce to end
        last_bounce_idx = bounces[-1]
        if last_bounce_idx < len(frames) - 5:
            rally_velocities = velocity[last_bounce_idx:] if last_bounce_idx < len(velocity) else []
            if rally_velocities:
                rallies.append({
                    "start_frame": bounces[-1],
                    "end_frame": frames[-1].get("frame", len(frames)),
                    "length": len(frames) - last_bounce_idx,
                    "avg_speed": round(sum(rally_velocities) / len(rally_velocities), 1)
                })
    
    return bounces, rallies


def compute_trajectory_analytics(trajectory_data: Dict[str, Any]) -> TrajectoryStats:
    """
    Compute trajectory analytics including bounces, rallies, and patterns.
    """
    frames = trajectory_data.get("frames", [])
    velocity = trajectory_data.get("velocity", [])
    
    # Defensive: if frames contains strings, parse them
    parsed_frames = []
    for frame in frames:
        if isinstance(frame, str):
            try:
                parsed_frames.append(json.loads(frame))
            except Exception:
                continue
        elif isinstance(frame, dict):
            parsed_frames.append(frame)
    frames = parsed_frames
    
    if not frames:
        return TrajectoryStats(0, 0, [], [], 0, [])
    
    # Total distance
    total_distance = 0.0
    for i in range(1, len(frames)):
        x1, y1 = frames[i - 1].get("x", 0), frames[i - 1].get("y", 0)
        x2, y2 = frames[i].get("x", 0), frames[i].get("y", 0)
        dist = math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)
        total_distance += dist
    
    # Detect bounces and rallies
    bounces, rallies = detect_bounces(frames, velocity)
    
    # Direction changes (x-velocity sign changes)
    direction_changes = 0
    for i in range(1, len(frames) - 1):
        dx_prev = frames[i].get("x", 0) - frames[i - 1].get("x", 0)
        dx_next = frames[i + 1].get("x", 0) - frames[i].get("x", 0)
        if (dx_prev > 0 and dx_next < 0) or (dx_prev < 0 and dx_next > 0):
            direction_changes += 1
    
    # Arc heights per rally
    arc_heights = []
    for rally in rallies:
        start = rally["start_frame"]
        end = rally["end_frame"]
        rally_frames = [f for f in frames if start <= f.get("frame", 0) <= end]
        if rally_frames:
            y_positions = [f.get("y", 0) for f in rally_frames]
            arc_height = max(y_positions) - min(y_positions)
            arc_heights.append(round(arc_height, 1))
    
    return TrajectoryStats(
        total_distance=round(total_distance, 1),
        bounce_count=len(bounces),
        bounces=bounces,
        rallies=rallies,
        direction_changes=direction_changes,
        arc_heights=arc_heights
    )


def compute_pose_movement_analytics(pose_data: List[Dict[str, Any]], fps: float = 30.0) -> PoseMovementStats:
    """
    Compute movement analytics from pose data.
    
    Args:
        pose_data: List of pose frames with keypoints
        fps: Video FPS
    """
    if not pose_data:
        return PoseMovementStats([], [], [], 0, 0)
    
    stance_timeline = []
    extension_timeline = []
    velocity_timeline = []
    
    prev_com_x, prev_com_y = None, None
    
    for frame_data in pose_data:
        frame_num = frame_data.get("frame_number", 0)
        keypoints_data = frame_data.get("keypoints", {})

        # Normalize keypoints to dict {name: {x, y, z, visibility}}
        # Filter by visibility/confidence threshold
        try:
            normalized = _normalize_keypoints(keypoints_data)
        except Exception as e:
            # Log the error and continue with next frame
            import logging
            logging.error(f"Failed to normalize keypoints for frame {frame_num}: {e}, data type: {type(keypoints_data)}")
            normalized = {}

        kp_map = {}
        for name, kp in normalized.items():
            # Defensive: ensure kp is a dict (handle malformed data)
            if not isinstance(kp, dict):
                import logging
                logging.warning(f"Skipping malformed keypoint '{name}': expected dict, got {type(kp)}")
                continue
            if not isinstance(kp.get("visibility"), (int, float)):
                import logging
                logging.warning(f"Skipping keypoint '{name}' with invalid visibility: {kp.get('visibility')}")
                continue
            if kp.get("visibility", 0) > 0.5:
                kp_map[name] = kp
        
        # Stance width (ankle distance)
        if "left_ankle" in kp_map and "right_ankle" in kp_map:
            left_ankle = kp_map["left_ankle"]
            right_ankle = kp_map["right_ankle"]
            width = math.sqrt(
                (right_ankle["x"] - left_ankle["x"]) ** 2 +
                (right_ankle["y"] - left_ankle["y"]) ** 2
            )
            stance_timeline.append({"frame": frame_num, "width": round(width, 3)})
        
        # Arm extension (shoulder to wrist distance for both arms)
        left_ext, right_ext = None, None
        
        if "left_shoulder" in kp_map and "left_wrist" in kp_map:
            ls = kp_map["left_shoulder"]
            lw = kp_map["left_wrist"]
            left_ext = math.sqrt((lw["x"] - ls["x"]) ** 2 + (lw["y"] - ls["y"]) ** 2)
        
        if "right_shoulder" in kp_map and "right_wrist" in kp_map:
            rs = kp_map["right_shoulder"]
            rw = kp_map["right_wrist"]
            right_ext = math.sqrt((rw["x"] - rs["x"]) ** 2 + (rw["y"] - rs["y"]) ** 2)
        
        if left_ext is not None or right_ext is not None:
            extension_timeline.append({
                "frame": frame_num,
                "left": round(left_ext, 3) if left_ext else None,
                "right": round(right_ext, 3) if right_ext else None
            })
        
        # Player velocity (center of mass movement)
        if "left_hip" in kp_map and "right_hip" in kp_map:
            lh = kp_map["left_hip"]
            rh = kp_map["right_hip"]
            com_x = (lh["x"] + rh["x"]) / 2
            com_y = (lh["y"] + rh["y"]) / 2
            
            if prev_com_x is not None and prev_com_y is not None:
                displacement = math.sqrt((com_x - prev_com_x) ** 2 + (com_y - prev_com_y) ** 2)
                velocity = displacement * fps  # pixels per second
                velocity_timeline.append({"frame": frame_num, "velocity": round(velocity, 1)})
            
            prev_com_x, prev_com_y = com_x, com_y
    
    # Averages
    avg_stance = sum(s["width"] for s in stance_timeline) / len(stance_timeline) if stance_timeline else 0
    avg_velocity = sum(v["velocity"] for v in velocity_timeline) / len(velocity_timeline) if velocity_timeline else 0
    
    return PoseMovementStats(
        stance_width_timeline=stance_timeline,
        arm_extension_timeline=extension_timeline,
        velocity_timeline=velocity_timeline,
        avg_stance_width=round(avg_stance, 3),
        avg_velocity=round(avg_velocity, 1)
    )


def detect_ball_contacts(
    trajectory_frames: List[Dict[str, Any]],
    pose_data: List[Dict[str, Any]],
    velocity: List[float],
    contact_threshold: float = 100.0
) -> ContactAnalysis:
    """
    Detect moments when ball contacts racket (wrist proximity).
    
    Args:
        trajectory_frames: Ball trajectory points
        pose_data: Pose keypoints per frame
        velocity: Ball velocity array
        contact_threshold: Distance threshold in pixels for contact
    """
    contact_moments = []
    
    # Build pose frame map for quick lookup
    pose_map = {p.get("frame_number"): p for p in pose_data}
    
    for i, traj_point in enumerate(trajectory_frames):
        frame_num = traj_point.get("frame", 0)
        ball_x = traj_point.get("x", 0)
        ball_y = traj_point.get("y", 0)
        
        # Look up pose for this frame
        pose_frame = pose_map.get(frame_num)
        if not pose_frame:
            continue
        
        keypoints = pose_frame.get("keypoints", {})
        # keypoints is a dict or list; normalize to {name: {x, y, z, visibility}}
        kp_map = {
            name: kp
            for name, kp in _normalize_keypoints(keypoints).items()
            if kp.get("visibility", 0) > 0.5
        }
        
        # Check both wrists
        for wrist_name in ["left_wrist", "right_wrist"]:
            if wrist_name in kp_map:
                wrist = kp_map[wrist_name]
                wrist_x = wrist["x"]
                wrist_y = wrist["y"]
                
                # Distance from wrist to ball
                distance = math.sqrt((ball_x - wrist_x) ** 2 + (ball_y - wrist_y) ** 2)
                
                if distance < contact_threshold:
                    ball_speed = velocity[i] if i < len(velocity) else 0
                    contact_moments.append({
                        "frame": frame_num,
                        "wrist": wrist_name,
                        "wrist_x": round(wrist_x, 1),
                        "wrist_y": round(wrist_y, 1),
                        "ball_x": round(ball_x, 1),
                        "ball_y": round(ball_y, 1),
                        "distance": round(distance, 1),
                        "ball_speed": round(ball_speed, 1),
                        "height": round(wrist_y, 1)
                    })
                    break  # Only record one contact per frame
    
    # Contact height distribution
    if contact_moments:
        heights = [c["height"] for c in contact_moments]
        avg_height = sum(heights) / len(heights)
        
        # Buckets: high, mid, low
        height_min = min(heights)
        height_max = max(heights)
        height_range = height_max - height_min
        
        if height_range > 0:
            high_count = sum(1 for h in heights if h < height_min + height_range * 0.33)
            low_count = sum(1 for h in heights if h > height_min + height_range * 0.67)
            mid_count = len(heights) - high_count - low_count
            
            distribution = [
                {"range": "high", "count": high_count},
                {"range": "mid", "count": mid_count},
                {"range": "low", "count": low_count}
            ]
        else:
            distribution = [{"range": "mid", "count": len(heights)}]
    else:
        avg_height = 0
        distribution = []
    
    return ContactAnalysis(
        contact_moments=contact_moments,
        avg_contact_height=round(avg_height, 1),
        contact_height_distribution=distribution
    )


def compute_correlations(
    speed_timeline: List[Dict[str, Any]],
    stance_timeline: List[Dict[str, Any]],
    extension_timeline: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """
    Compute correlations between ball performance and body mechanics.
    
    Returns scatter plot data for visualizations.
    """
    # Speed vs Stance Width
    speed_stance_data = []
    for speed_point in speed_timeline:
        frame = speed_point["frame"]
        # Find closest stance measurement
        stance_point = min(stance_timeline, key=lambda s: abs(s["frame"] - frame), default=None)
        if stance_point and abs(stance_point["frame"] - frame) < 10:
            speed_stance_data.append({
                "speed": speed_point["speed"],
                "stance": stance_point["width"],
                "frame": frame
            })
    
    # Speed vs Arm Extension
    speed_extension_data = []
    for speed_point in speed_timeline:
        frame = speed_point["frame"]
        ext_point = min(extension_timeline, key=lambda e: abs(e["frame"] - frame), default=None)
        if ext_point and abs(ext_point["frame"] - frame) < 10:
            # Use max extension (dominant arm)
            left = ext_point.get("left") or 0
            right = ext_point.get("right") or 0
            max_ext = max(left, right)
            if max_ext > 0:
                speed_extension_data.append({
                    "speed": speed_point["speed"],
                    "extension": max_ext,
                    "frame": frame
                })
    
    return {
        "speed_vs_stance": speed_stance_data,
        "speed_vs_extension": speed_extension_data
    }


async def compute_session_analytics(
    session_id: str,
    trajectory_data: Dict[str, Any],
    pose_data: List[Dict[str, Any]],
    fps: float = 30.0
) -> Dict[str, Any]:
    """
    Compute comprehensive analytics for a session.
    
    Args:
        session_id: Session ID
        trajectory_data: Ball trajectory data from sessions table
        pose_data: Pose keypoints from pose_analysis table
        fps: Video FPS
        
    Returns:
        Complete analytics dictionary
    """
    logger.info(f"Computing analytics for session {session_id}")
    
    # Ball analytics
    speed_stats = compute_ball_speed_analytics(trajectory_data, fps)
    trajectory_stats = compute_trajectory_analytics(trajectory_data)
    
    # Pose analytics
    movement_stats = compute_pose_movement_analytics(pose_data, fps)
    
    # Contact analysis
    frames = trajectory_data.get("frames", [])
    velocity = trajectory_data.get("velocity", [])
    contact_stats = detect_ball_contacts(frames, pose_data, velocity)
    
    # Correlations
    correlations = compute_correlations(
        speed_stats.timeline,
        movement_stats.stance_width_timeline,
        movement_stats.arm_extension_timeline
    )
    
    logger.info(f"Analytics computed: {len(speed_stats.timeline)} speed points, "
                f"{trajectory_stats.bounce_count} bounces, "
                f"{len(contact_stats.contact_moments)} contacts")
    
    return {
        "session_id": session_id,
        "ball_analytics": {
            "speed": {
                "max": speed_stats.max,
                "min": speed_stats.min,
                "avg": speed_stats.avg,
                "median": speed_stats.median,
                "stddev": speed_stats.stddev,
                "timeline": speed_stats.timeline,
                "distribution": speed_stats.distribution
            },
            "trajectory": {
                "total_distance": trajectory_stats.total_distance,
                "bounce_count": trajectory_stats.bounce_count,
                "bounces": trajectory_stats.bounces,
                "rallies": trajectory_stats.rallies,
                "direction_changes": trajectory_stats.direction_changes,
                "arc_heights": trajectory_stats.arc_heights
            },
            "spin": {
                "estimate": trajectory_data.get("spin_estimate", "unknown"),
                "distribution": {}  # Future: detailed spin analysis
            }
        },
        "pose_analytics": {
            "movement": {
                "stance_width_timeline": movement_stats.stance_width_timeline,
                "arm_extension_timeline": movement_stats.arm_extension_timeline,
                "velocity_timeline": movement_stats.velocity_timeline,
                "avg_stance_width": movement_stats.avg_stance_width,
                "avg_velocity": movement_stats.avg_velocity
            },
            "contact": {
                "contact_moments": contact_stats.contact_moments,
                "avg_contact_height": contact_stats.avg_contact_height,
                "height_distribution": contact_stats.contact_height_distribution
            }
        },
        "correlations": correlations
    }
