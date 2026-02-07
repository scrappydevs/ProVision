"""
Stroke classifier for ping pong.
Detects forehand vs backhand strokes from pose analysis keypoint data.

Uses multi-signal approach:
1. Elbow angle velocity (rapid extension = stroke)
2. Shoulder rotation change (torso turn direction = FH vs BH indicator)
3. Wrist trajectory relative to body midline
4. Shoulder angle change (arm raise pattern)

Camera facing correction:
When a player faces away from the camera, pose estimators swap left/right
keypoints (the model's "left_wrist" is actually the player's right wrist).
We detect this via nose visibility and swap keypoint names accordingly.
"""
from typing import List


def _get_kp(frame: dict, name: str) -> dict:
    """Safely get a keypoint dict from a frame."""
    kp = frame.get("keypoints", {})
    return kp.get(name, {})


def _visible(kp: dict, threshold: float = 0.3) -> bool:
    return kp.get("visibility", 0) >= threshold


def _body_width(frame: dict) -> float:
    """Shoulder-to-shoulder distance as a normalizing factor."""
    ls = _get_kp(frame, "left_shoulder")
    rs = _get_kp(frame, "right_shoulder")
    if not ls or not rs:
        return 100.0  # fallback
    dx = rs.get("x", 0) - ls.get("x", 0)
    dy = rs.get("y", 0) - ls.get("y", 0)
    return max((dx**2 + dy**2) ** 0.5, 20.0)


def _normalize_angle_delta(delta: float) -> float:
    """Normalize an angle delta to [-180, 180] to handle ±180° wrapping."""
    if delta > 180:
        delta -= 360
    elif delta < -180:
        delta += 360
    return delta


def _flip_side(name: str) -> str:
    """Swap 'left' <-> 'right' in a keypoint name."""
    if name.startswith("left_"):
        return "right_" + name[5:]
    if name.startswith("right_"):
        return "left_" + name[6:]
    return name


def detect_camera_facing(pose_frames: List[dict], sample_count: int = 30) -> str:
    """
    Auto-detect whether the player faces toward or away from the camera.

    Uses nose visibility as the primary signal:
    - Nose clearly visible → facing toward camera
    - Nose not visible but shoulders/ears present → facing away

    Returns 'toward' or 'away'.
    """
    if not pose_frames:
        return "toward"

    # Sample evenly spaced frames
    step = max(1, len(pose_frames) // sample_count)
    sampled = pose_frames[::step][:sample_count]

    toward_votes = 0
    away_votes = 0

    for frame in sampled:
        nose = _get_kp(frame, "nose")
        left_ear = _get_kp(frame, "left_ear")
        right_ear = _get_kp(frame, "right_ear")
        left_shoulder = _get_kp(frame, "left_shoulder")
        right_shoulder = _get_kp(frame, "right_shoulder")

        nose_vis = nose.get("visibility", 0) if nose else 0
        lear_vis = left_ear.get("visibility", 0) if left_ear else 0
        rear_vis = right_ear.get("visibility", 0) if right_ear else 0
        ls_vis = left_shoulder.get("visibility", 0) if left_shoulder else 0
        rs_vis = right_shoulder.get("visibility", 0) if right_shoulder else 0

        has_body = (ls_vis > 0.3 or rs_vis > 0.3)
        if not has_body:
            continue

        if nose_vis > 0.5:
            toward_votes += 1
        elif nose_vis < 0.2 and (lear_vis > 0.3 or rear_vis > 0.3):
            away_votes += 1
        elif nose_vis < 0.3:
            away_votes += 0.5
        else:
            toward_votes += 0.5

    if toward_votes + away_votes == 0:
        return "toward"

    return "toward" if toward_votes >= away_votes else "away"


def _resolve_facing(camera_facing: str, pose_frames: List[dict]) -> str:
    """Resolve 'auto' to a concrete facing direction."""
    if camera_facing in ("toward", "away"):
        return camera_facing
    return detect_camera_facing(pose_frames)


def classify_strokes(pose_frames: List[dict], handedness: str = "right", camera_facing: str = "auto") -> List[dict]:
    """
    Classify strokes from pose analysis frames.

    Args:
        pose_frames: List of pose analysis frame dicts from database
        handedness: 'right' or 'left' — the player's dominant hand
        camera_facing: 'auto', 'toward', or 'away' — camera orientation relative to player

    When camera_facing is 'away', pose estimators swap left/right keypoints.
    We correct for this by flipping the keypoint names we look up.
    """
    if len(pose_frames) < 4:
        return []

    facing = _resolve_facing(camera_facing, pose_frames)

    # actual_hand = the player's real dominant hand (for FH/BH classification logic)
    actual_hand = handedness  # "right" or "left"

    # model_dom / model_off = keypoint name prefixes to read from the pose model
    # When facing away, model's "left" = player's "right", so we flip
    if facing == "away":
        model_dom = "left" if actual_hand == "right" else "right"
        model_off = "right" if actual_hand == "right" else "left"
    else:
        model_dom = actual_hand
        model_off = "left" if actual_hand == "right" else "right"

    # For keypoint lookups we use model_dom/model_off
    # For classification (FH vs BH direction) we use actual_hand
    dominant = model_dom
    off_hand = model_off

    strokes = []
    cooldown = 0

    # Sliding window for smoothing
    for i in range(2, len(pose_frames)):
        if cooldown > 0:
            cooldown -= 1
            continue

        curr = pose_frames[i]
        prev = pose_frames[i - 1]
        prev2 = pose_frames[i - 2]

        curr_angles = curr.get("joint_angles", {})
        prev_angles = prev.get("joint_angles", {})
        prev2_angles = prev2.get("joint_angles", {})

        curr_metrics = curr.get("body_metrics", {})
        prev_metrics = prev.get("body_metrics", {})

        bw = _body_width(curr)

        # Check dominant arm first, then off-hand as fallback
        for side in [dominant, off_hand]:

            wrist = _get_kp(curr, f"{side}_wrist")
            prev_wrist = _get_kp(prev, f"{side}_wrist")
            elbow_kp = _get_kp(curr, f"{side}_elbow")

            if not _visible(wrist) or not _visible(elbow_kp):
                continue

            # --- Signal 1: Elbow angle velocity ---
            elbow_now = curr_angles.get(f"{side}_elbow", 0)
            elbow_prev = prev_angles.get(f"{side}_elbow", 0)
            elbow_prev2 = prev2_angles.get(f"{side}_elbow", 0)
            elbow_vel = abs(elbow_now - elbow_prev)
            elbow_accel = abs((elbow_now - elbow_prev) - (elbow_prev - elbow_prev2))

            # --- Elbow extension check ---
            # Real strokes involve elbow EXTENDING (angle increasing) at contact.
            # Wind-ups are flexion (angle decreasing). Reject pure flexion peaks.
            elbow_delta = elbow_now - elbow_prev2  # positive = extension over 2 frames
            if elbow_delta < -5:
                continue  # elbow flexing hard — this is a wind-up, skip

            # --- Signal 2: Shoulder angle velocity ---
            shoulder_now = curr_angles.get(f"{side}_shoulder", 0)
            shoulder_prev = prev_angles.get(f"{side}_shoulder", 0)
            shoulder_vel = abs(shoulder_now - shoulder_prev)

            # --- Signal 3: Wrist displacement (normalized by body width) ---
            wx = wrist.get("x", 0)
            wy = wrist.get("y", 0)
            prev_wx = prev_wrist.get("x", 0)
            prev_wy = prev_wrist.get("y", 0)
            dx = abs(wx - prev_wx) / bw
            dy = abs(wy - prev_wy) / bw
            wrist_speed = (dx**2 + dy**2) ** 0.5

            # --- Combined stroke detection threshold ---
            elbow_strong = elbow_vel > 8
            shoulder_active = shoulder_vel > 4
            wrist_fast = wrist_speed > 0.12

            signals = sum([elbow_strong, shoulder_active, wrist_fast])
            # Require at least 2 signals AND elbow must be involved.
            # shoulder+wrist alone (no elbow) produces too many false positives.
            if signals < 2 or not elbow_strong:
                continue

            # --- Forehand vs Backhand classification using handedness ---
            # Key insight: classification is relative to the DOMINANT hand,
            # not the arm that moved. Even if the off-hand arm triggers a stroke
            # (two-handed backhand), we classify based on body orientation.

            # 1. Shoulder rotation direction (normalized for ±180° wrapping)
            shoulder_rot = curr_metrics.get("shoulder_rotation", 0)
            prev_shoulder_rot = prev_metrics.get("shoulder_rotation", 0)
            rot_delta = _normalize_angle_delta(shoulder_rot - prev_shoulder_rot)

            # 2. Dominant wrist position relative to body midline
            dom_wrist = _get_kp(curr, f"{dominant}_wrist")
            ls = _get_kp(curr, "left_shoulder")
            rs = _get_kp(curr, "right_shoulder")
            mid_x = (ls.get("x", 0) + rs.get("x", 0)) / 2
            dom_wx = dom_wrist.get("x", 0) if _visible(dom_wrist) else wx
            wrist_relative = (dom_wx - mid_x) / bw

            # 3. Hip rotation (normalized for ±180° wrapping)
            hip_rot = curr_metrics.get("hip_rotation", 0)
            prev_hip_rot = prev_metrics.get("hip_rotation", 0)
            hip_delta = _normalize_angle_delta(hip_rot - prev_hip_rot)

            # Voting based on ACTUAL handedness (not model keypoint names)
            fh_score = 0.0
            bh_score = 0.0

            # Shoulder rotation: for right-hander, FH = rotating left (negative delta)
            # Note: when facing away, shoulder_rotation from the model is also mirrored,
            # so we flip rot_delta interpretation too
            effective_rot = rot_delta if facing == "toward" else -rot_delta
            effective_hip = hip_delta if facing == "toward" else -hip_delta

            if actual_hand == "right":
                if effective_rot < -1:
                    fh_score += min(abs(effective_rot) / 5, 1.0)
                elif effective_rot > 1:
                    bh_score += min(abs(effective_rot) / 5, 1.0)
            else:  # left-handed: FH = rotating right (positive delta)
                if effective_rot > 1:
                    fh_score += min(abs(effective_rot) / 5, 1.0)
                elif effective_rot < -1:
                    bh_score += min(abs(effective_rot) / 5, 1.0)

            # Wrist position: FH = dominant wrist on same side, BH = crossed
            # When facing away, wrist_relative is also mirrored
            effective_wrist_rel = wrist_relative if facing == "toward" else -wrist_relative

            if actual_hand == "right":
                if effective_wrist_rel > 0.1:
                    fh_score += 0.5
                elif effective_wrist_rel < -0.1:
                    bh_score += 0.5
            else:  # left-handed
                if effective_wrist_rel < -0.1:
                    fh_score += 0.5
                elif effective_wrist_rel > 0.1:
                    bh_score += 0.5

            # Hip rotation supports the same direction as shoulder
            if actual_hand == "right":
                if effective_hip < -0.5:
                    fh_score += 0.3
                elif effective_hip > 0.5:
                    bh_score += 0.3
            else:
                if effective_hip > 0.5:
                    fh_score += 0.3
                elif effective_hip < -0.5:
                    bh_score += 0.3

            # If this was detected on the off-hand arm, slightly boost backhand
            if side != dominant:
                bh_score += 0.2

            stroke_type = "forehand" if fh_score >= bh_score else "backhand"

            # --- Confidence ---
            vis = wrist.get("visibility", 0)
            signal_strength = min(1.0, (elbow_vel / 15 + wrist_speed / 0.2 + shoulder_vel / 8) / 3)
            classification_margin = abs(fh_score - bh_score) / max(fh_score + bh_score, 0.01)
            confidence = round(min(1.0, signal_strength * 0.6 + vis * 0.2 + classification_margin * 0.2), 2)

            if confidence < 0.2:
                continue

            strokes.append({
                "frame": curr.get("frame_number", i),
                "timestamp": curr.get("timestamp", 0),
                "type": stroke_type,
                "hand": side,
                "dominant_hand": actual_hand,
                "camera_facing": facing,
                "elbow_angle": round(elbow_now, 1),
                "shoulder_angle": round(shoulder_now, 1),
                "confidence": confidence,
                "wrist_velocity": round(wrist_speed * bw, 1),
                "elbow_velocity": round(elbow_vel, 1),
                "shoulder_rotation_delta": round(rot_delta, 1),
            })

            cooldown = 6
            break

    return strokes


def detect_dominant_hand(strokes: List[dict]) -> str:
    """Determine dominant hand from stroke history."""
    if not strokes:
        return "unknown"
    right = sum(1 for s in strokes if s["hand"] == "right")
    left = sum(1 for s in strokes if s["hand"] == "left")
    if right == left:
        return "ambidextrous"
    return "right" if right > left else "left"


def analyze_weaknesses(strokes: List[dict]) -> dict:
    """Analyze player weaknesses based on stroke patterns."""
    if not strokes:
        return {"summary": "No stroke data available"}

    forehand = [s for s in strokes if s["type"] == "forehand"]
    backhand = [s for s in strokes if s["type"] == "backhand"]

    fh_count = len(forehand)
    bh_count = len(backhand)
    total = fh_count + bh_count

    fh_avg_elbow = sum(s["elbow_angle"] for s in forehand) / fh_count if fh_count else 0
    bh_avg_elbow = sum(s["elbow_angle"] for s in backhand) / bh_count if bh_count else 0
    fh_avg_conf = sum(s["confidence"] for s in forehand) / fh_count if fh_count else 0
    bh_avg_conf = sum(s["confidence"] for s in backhand) / bh_count if bh_count else 0
    fh_avg_shoulder_rot = sum(abs(s.get("shoulder_rotation_delta", 0)) for s in forehand) / fh_count if fh_count else 0
    bh_avg_shoulder_rot = sum(abs(s.get("shoulder_rotation_delta", 0)) for s in backhand) / bh_count if bh_count else 0

    # Determine weaker side
    weaker_side = None
    if total > 3:
        fh_ratio = fh_count / total
        if fh_ratio < 0.3:
            weaker_side = "forehand"
        elif fh_ratio > 0.7:
            weaker_side = "backhand"
        elif fh_avg_conf < bh_avg_conf - 0.1:
            weaker_side = "forehand"
        elif bh_avg_conf < fh_avg_conf - 0.1:
            weaker_side = "backhand"

    return {
        "forehand": {
            "count": fh_count,
            "percentage": round(fh_count / total * 100, 1) if total else 0,
            "avg_elbow_angle": round(fh_avg_elbow, 1),
            "avg_confidence": round(fh_avg_conf, 2),
            "avg_shoulder_rotation": round(fh_avg_shoulder_rot, 1),
        },
        "backhand": {
            "count": bh_count,
            "percentage": round(bh_count / total * 100, 1) if total else 0,
            "avg_elbow_angle": round(bh_avg_elbow, 1),
            "avg_confidence": round(bh_avg_conf, 2),
            "avg_shoulder_rotation": round(bh_avg_shoulder_rot, 1),
        },
        "weaker_side": weaker_side,
        "total_strokes": total,
    }


def build_match_analytics(pose_frames: List[dict], handedness: str = "right", camera_facing: str = "auto") -> dict:
    """Build complete match analytics from pose data."""
    strokes = classify_strokes(pose_frames, handedness=handedness, camera_facing=camera_facing)
    weakness = analyze_weaknesses(strokes)

    facing = _resolve_facing(camera_facing, pose_frames) if camera_facing == "auto" else camera_facing

    return {
        "strokes": strokes,
        "stroke_count": len(strokes),
        "dominant_hand": handedness,
        "camera_facing": facing,
        "weakness_analysis": weakness,
    }
