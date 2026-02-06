"""
Stroke classifier for ping pong.
Detects forehand vs backhand strokes from pose analysis keypoint data.

Uses multi-signal approach:
1. Elbow angle velocity (rapid extension = stroke)
2. Shoulder rotation change (torso turn direction = FH vs BH indicator)
3. Wrist trajectory relative to body midline
4. Shoulder angle change (arm raise pattern)
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


def classify_strokes(pose_frames: List[dict], handedness: str = "right") -> List[dict]:
    """
    Classify strokes from pose analysis frames.

    Args:
        pose_frames: List of pose analysis frame dicts from database
        handedness: 'right' or 'left' — the player's dominant hand

    Multi-signal detection:
    - Primary: elbow angle velocity (rapid extension/flexion > threshold)
    - Secondary: shoulder rotation delta (positive = rotating right, negative = left)
    - Tertiary: wrist position relative to shoulder midline
    - Confidence: combination of keypoint visibility and signal strength

    Handedness determines:
    - Which arm is primary for stroke detection (dominant arm checked first)
    - Forehand = dominant wrist on same side as dominant hand relative to body midline
    - Backhand = dominant wrist crosses to opposite side
    """
    if len(pose_frames) < 4:
        return []

    dominant = handedness  # "right" or "left"
    off_hand = "left" if dominant == "right" else "right"

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
            if signals < 2:
                continue

            # --- Forehand vs Backhand classification using handedness ---
            # Key insight: classification is relative to the DOMINANT hand,
            # not the arm that moved. Even if the off-hand arm triggers a stroke
            # (two-handed backhand), we classify based on body orientation.

            # 1. Shoulder rotation direction
            shoulder_rot = curr_metrics.get("shoulder_rotation", 0)
            prev_shoulder_rot = prev_metrics.get("shoulder_rotation", 0)
            rot_delta = shoulder_rot - prev_shoulder_rot

            # 2. Dominant wrist position relative to body midline
            dom_wrist = _get_kp(curr, f"{dominant}_wrist")
            ls = _get_kp(curr, "left_shoulder")
            rs = _get_kp(curr, "right_shoulder")
            mid_x = (ls.get("x", 0) + rs.get("x", 0)) / 2
            dom_wx = dom_wrist.get("x", 0) if _visible(dom_wrist) else wx
            wrist_relative = (dom_wx - mid_x) / bw

            # 3. Hip rotation
            hip_rot = curr_metrics.get("hip_rotation", 0)
            prev_hip_rot = prev_metrics.get("hip_rotation", 0)
            hip_delta = hip_rot - prev_hip_rot

            # Voting based on handedness
            fh_score = 0.0
            bh_score = 0.0

            # Shoulder rotation: for right-hander, FH = rotating left (negative delta)
            if dominant == "right":
                if rot_delta < -1:
                    fh_score += min(abs(rot_delta) / 5, 1.0)
                elif rot_delta > 1:
                    bh_score += min(abs(rot_delta) / 5, 1.0)
            else:  # left-handed: FH = rotating right (positive delta)
                if rot_delta > 1:
                    fh_score += min(abs(rot_delta) / 5, 1.0)
                elif rot_delta < -1:
                    bh_score += min(abs(rot_delta) / 5, 1.0)

            # Wrist position: FH = dominant wrist on same side, BH = crossed
            if dominant == "right":
                if wrist_relative > 0.1:
                    fh_score += 0.5
                elif wrist_relative < -0.1:
                    bh_score += 0.5
            else:  # left-handed
                if wrist_relative < -0.1:
                    fh_score += 0.5
                elif wrist_relative > 0.1:
                    bh_score += 0.5

            # Hip rotation supports the same direction as shoulder
            if dominant == "right":
                if hip_delta < -0.5:
                    fh_score += 0.3
                elif hip_delta > 0.5:
                    bh_score += 0.3
            else:
                if hip_delta > 0.5:
                    fh_score += 0.3
                elif hip_delta < -0.5:
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
                "dominant_hand": dominant,
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


def build_match_analytics(pose_frames: List[dict], handedness: str = "right") -> dict:
    """Build complete match analytics from pose data."""
    strokes = classify_strokes(pose_frames, handedness=handedness)
    weakness = analyze_weaknesses(strokes)

    return {
        "strokes": strokes,
        "stroke_count": len(strokes),
        "dominant_hand": handedness,
        "weakness_analysis": weakness,
    }
