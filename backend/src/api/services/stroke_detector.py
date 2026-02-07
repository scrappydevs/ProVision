"""
Stroke detection and form scoring service.
Analyzes pose data to detect strokes and score technique quality.
"""

import numpy as np
from typing import List, Dict, Tuple, Optional
from dataclasses import dataclass
import math

from .stroke_classifier import detect_camera_facing, _normalize_angle_delta


@dataclass
class Stroke:
    """Represents a detected stroke."""
    start_frame: int
    end_frame: int
    peak_frame: int
    stroke_type: str  # 'forehand', 'backhand', 'unknown'
    duration: float
    max_velocity: float
    form_score: float
    metrics: Dict[str, float]


class StrokeDetector:
    """
    Detects strokes from pose analysis data and scores form quality.
    Supports camera facing correction for back-facing players.
    """

    def __init__(self,
                 velocity_threshold: float = 50.0,
                 min_stroke_duration: int = 5,
                 max_stroke_duration: int = 60,
                 handedness: str = "right",
                 camera_facing: str = "auto"):
        """
        Initialize stroke detector.

        Args:
            velocity_threshold: Minimum wrist velocity to consider as stroke
            min_stroke_duration: Minimum frames for a valid stroke
            max_stroke_duration: Maximum frames for a valid stroke
            handedness: 'right' or 'left' — the player's dominant hand
            camera_facing: 'auto', 'toward', or 'away' — camera orientation
        """
        self.velocity_threshold = velocity_threshold
        self.min_stroke_duration = min_stroke_duration
        self.max_stroke_duration = max_stroke_duration
        self.handedness = handedness
        self.camera_facing = camera_facing
        self._resolved_facing: Optional[str] = None

    def _resolve_facing(self, pose_frames: List[Dict]) -> str:
        """Resolve camera_facing to 'toward' or 'away'."""
        if self._resolved_facing:
            return self._resolved_facing
        if self.camera_facing in ("toward", "away"):
            self._resolved_facing = self.camera_facing
        else:
            self._resolved_facing = detect_camera_facing(pose_frames)
        return self._resolved_facing

    def _model_sides(self, pose_frames: List[Dict]) -> Tuple[str, str]:
        """
        Return (model_dom, model_off) keypoint prefixes accounting for camera facing.
        When facing away, model's 'left' = player's 'right' and vice versa.
        """
        facing = self._resolve_facing(pose_frames)
        if facing == "away":
            model_dom = "left" if self.handedness == "right" else "right"
            model_off = "right" if self.handedness == "right" else "left"
        else:
            model_dom = self.handedness
            model_off = "left" if self.handedness == "right" else "right"
        return model_dom, model_off

    def detect_strokes(self, pose_frames: List[Dict]) -> List[Stroke]:
        """
        Detect all strokes in the pose analysis data.

        Args:
            pose_frames: List of pose analysis frames from database

        Returns:
            List of detected Stroke objects
        """
        if len(pose_frames) < 2:
            return []

        # Resolve facing once for the whole video
        self._resolve_facing(pose_frames)

        # Calculate wrist velocities
        velocities = self._calculate_wrist_velocities(pose_frames)

        # Find velocity peaks (potential strokes)
        peaks = self._find_velocity_peaks(velocities)

        # Analyze each peak to determine stroke boundaries
        strokes = []
        for peak_idx in peaks:
            stroke = self._analyze_stroke(pose_frames, velocities, peak_idx)
            if stroke:
                strokes.append(stroke)

        return strokes

    def _calculate_wrist_velocities(self, pose_frames: List[Dict]) -> List[float]:
        """Calculate dominant wrist velocity for each frame (camera-facing corrected)."""
        dom, off = self._model_sides(pose_frames)
        velocities = [0.0]

        for i in range(1, len(pose_frames)):
            prev_frame = pose_frames[i - 1]
            curr_frame = pose_frames[i]

            prev_keypoints = prev_frame.get('keypoints', {})
            curr_keypoints = curr_frame.get('keypoints', {})

            # Use dominant wrist, fall back to off-hand
            prev_wrist = prev_keypoints.get(f'{dom}_wrist', prev_keypoints.get(f'{off}_wrist'))
            curr_wrist = curr_keypoints.get(f'{dom}_wrist', curr_keypoints.get(f'{off}_wrist'))

            if prev_wrist and curr_wrist:
                dx = curr_wrist['x'] - prev_wrist['x']
                dy = curr_wrist['y'] - prev_wrist['y']
                distance = math.sqrt(dx**2 + dy**2)

                dt = curr_frame['timestamp'] - prev_frame['timestamp']
                if dt > 0:
                    velocity = distance / dt
                else:
                    velocity = 0.0
            else:
                velocity = 0.0

            velocities.append(velocity)

        return velocities

    def _find_velocity_peaks(self, velocities: List[float]) -> List[int]:
        """Find peaks in velocity that exceed threshold."""
        peaks = []

        for i in range(1, len(velocities) - 1):
            # Check if this is a local maximum above threshold
            if (velocities[i] > self.velocity_threshold and
                velocities[i] > velocities[i - 1] and
                velocities[i] > velocities[i + 1]):

                # Ensure peaks are not too close together (at least 10 frames apart)
                if not peaks or (i - peaks[-1]) > 10:
                    peaks.append(i)

        return peaks

    def _analyze_stroke(self,
                       pose_frames: List[Dict],
                       velocities: List[float],
                       peak_idx: int) -> Optional[Stroke]:
        """
        Analyze a velocity peak to determine stroke boundaries and characteristics.
        Requires elbow extension (angle increasing) around the peak to filter wind-ups.
        """
        dom, off = self._model_sides(pose_frames)

        # --- Elbow extension check ---
        # A real hit has the elbow extending (angle increasing) leading into the peak.
        # A wind-up has the elbow flexing (angle decreasing). Reject flexion-only peaks.
        if peak_idx >= 2:
            peak_angles = pose_frames[peak_idx].get('joint_angles', {})
            pre_angles = pose_frames[peak_idx - 2].get('joint_angles', {})
            elbow_at_peak = peak_angles.get(f'{dom}_elbow', peak_angles.get(f'{off}_elbow', 0))
            elbow_before = pre_angles.get(f'{dom}_elbow', pre_angles.get(f'{off}_elbow', 0))
            elbow_delta = elbow_at_peak - elbow_before  # positive = extension

            # Reject if elbow is purely flexing (wind-up), allow neutral or extending
            if elbow_delta < -5:
                return None

        # Find stroke start (velocity rises above 30% of peak)
        threshold_vel = velocities[peak_idx] * 0.3
        start_idx = peak_idx
        for i in range(peak_idx - 1, max(0, peak_idx - self.max_stroke_duration), -1):
            if velocities[i] < threshold_vel:
                start_idx = i
                break

        # Find stroke end (velocity drops below 30% of peak)
        end_idx = peak_idx
        for i in range(peak_idx + 1, min(len(velocities), peak_idx + self.max_stroke_duration)):
            if velocities[i] < threshold_vel:
                end_idx = i
                break

        # Check if stroke duration is valid
        duration_frames = end_idx - start_idx
        if duration_frames < self.min_stroke_duration or duration_frames > self.max_stroke_duration:
            return None

        # Extract stroke frames
        stroke_frames = pose_frames[start_idx:end_idx + 1]

        # Calculate stroke metrics
        metrics = self._calculate_stroke_metrics(stroke_frames, peak_idx - start_idx)

        # Determine stroke type
        stroke_type = self._classify_stroke_type(stroke_frames, metrics)

        # Calculate form score
        form_score = self._calculate_form_score(metrics, stroke_type)

        # Calculate duration in seconds
        duration = pose_frames[end_idx]['timestamp'] - pose_frames[start_idx]['timestamp']

        return Stroke(
            start_frame=pose_frames[start_idx]['frame_number'],
            end_frame=pose_frames[end_idx]['frame_number'],
            peak_frame=pose_frames[peak_idx]['frame_number'],
            stroke_type=stroke_type,
            duration=duration,
            max_velocity=velocities[peak_idx],
            form_score=form_score,
            metrics=metrics
        )

    def _calculate_stroke_metrics(self, stroke_frames: List[Dict], peak_idx: int) -> Dict[str, float]:
        """Calculate metrics for a stroke using the dominant hand's joints (camera-corrected)."""
        metrics = {}
        dom, off = self._model_sides(stroke_frames)

        if not stroke_frames:
            return metrics

        peak_frame = stroke_frames[peak_idx] if peak_idx < len(stroke_frames) else stroke_frames[-1]

        joint_angles = peak_frame.get('joint_angles', {})
        body_metrics = peak_frame.get('body_metrics', {})

        # Use dominant side joints, fall back to off-hand
        metrics['elbow_angle'] = joint_angles.get(f'{dom}_elbow', joint_angles.get(f'{off}_elbow', 0))
        metrics['shoulder_angle'] = joint_angles.get(f'{dom}_shoulder', joint_angles.get(f'{off}_shoulder', 0))
        metrics['knee_angle'] = joint_angles.get(f'{dom}_knee', joint_angles.get(f'{off}_knee', 0))
        metrics['hip_angle'] = joint_angles.get(f'{dom}_hip', joint_angles.get(f'{off}_hip', 0))

        metrics['hip_rotation'] = body_metrics.get('hip_rotation', 0)
        metrics['shoulder_rotation'] = body_metrics.get('shoulder_rotation', 0)
        metrics['spine_lean'] = body_metrics.get('spine_lean', 0)

        # Angle ranges during stroke (dominant arm)
        elbow_angles = [f.get('joint_angles', {}).get(f'{dom}_elbow', 0) for f in stroke_frames]
        metrics['elbow_range'] = max(elbow_angles) - min(elbow_angles) if elbow_angles else 0

        hip_rotations = [f.get('body_metrics', {}).get('hip_rotation', 0) for f in stroke_frames]
        if hip_rotations:
            raw_range = max(hip_rotations) - min(hip_rotations)
            metrics['hip_rotation_range'] = min(raw_range, 360 - raw_range) if raw_range > 180 else raw_range
        else:
            metrics['hip_rotation_range'] = 0

        shoulder_rotations = [f.get('body_metrics', {}).get('shoulder_rotation', 0) for f in stroke_frames]
        if shoulder_rotations:
            raw_range = max(shoulder_rotations) - min(shoulder_rotations)
            metrics['shoulder_rotation_range'] = min(raw_range, 360 - raw_range) if raw_range > 180 else raw_range
        else:
            metrics['shoulder_rotation_range'] = 0

        return metrics

    def _classify_stroke_type(self, stroke_frames: List[Dict], metrics: Dict[str, float]) -> str:
        """
        Classify the stroke type using multi-signal voting:
        1. Shoulder rotation direction (strongest signal)
        2. Shoulder rotation change during stroke (direction of torso turn)
        3. Dominant wrist position relative to body midline
        4. Hip rotation direction
        """
        facing = self._resolved_facing or "toward"
        dom, off = self._model_sides(stroke_frames)

        fh_score = 0.0
        bh_score = 0.0

        # --- Signal 1: Shoulder rotation at peak (absolute position) ---
        shoulder_rotation = metrics.get('shoulder_rotation', 0)
        effective_rotation = shoulder_rotation if facing == "toward" else -shoulder_rotation

        if self.handedness == "right":
            if effective_rotation > 3:
                fh_score += min(abs(effective_rotation) / 10, 1.0)
            elif effective_rotation < -3:
                bh_score += min(abs(effective_rotation) / 10, 1.0)
        else:
            if effective_rotation < -3:
                fh_score += min(abs(effective_rotation) / 10, 1.0)
            elif effective_rotation > 3:
                bh_score += min(abs(effective_rotation) / 10, 1.0)

        # --- Signal 2: Shoulder rotation CHANGE during stroke (direction of turn) ---
        if len(stroke_frames) >= 3:
            start_rot = stroke_frames[0].get('body_metrics', {}).get('shoulder_rotation', 0)
            end_rot = stroke_frames[-1].get('body_metrics', {}).get('shoulder_rotation', 0)
            rot_delta = end_rot - start_rot
            if abs(rot_delta) > 180:
                rot_delta = rot_delta - 360 if rot_delta > 0 else rot_delta + 360
            effective_delta = rot_delta if facing == "toward" else -rot_delta

            if self.handedness == "right":
                if effective_delta < -2:
                    fh_score += min(abs(effective_delta) / 8, 1.0)
                elif effective_delta > 2:
                    bh_score += min(abs(effective_delta) / 8, 1.0)
            else:
                if effective_delta > 2:
                    fh_score += min(abs(effective_delta) / 8, 1.0)
                elif effective_delta < -2:
                    bh_score += min(abs(effective_delta) / 8, 1.0)

        # --- Signal 3: Dominant wrist position relative to body midline ---
        peak_frame = stroke_frames[len(stroke_frames) // 2] if stroke_frames else {}
        kps = peak_frame.get('keypoints', {})
        dom_wrist = kps.get(f'{dom}_wrist', {})
        ls = kps.get('left_shoulder', {})
        rs = kps.get('right_shoulder', {})

        if dom_wrist and ls and rs:
            mid_x = (ls.get('x', 0) + rs.get('x', 0)) / 2
            body_w = max(abs(rs.get('x', 0) - ls.get('x', 0)), 20)
            wrist_relative = (dom_wrist.get('x', 0) - mid_x) / body_w
            effective_wrist = wrist_relative if facing == "toward" else -wrist_relative

            if self.handedness == "right":
                if effective_wrist > 0.1:
                    fh_score += 0.5
                elif effective_wrist < -0.1:
                    bh_score += 0.5
            else:
                if effective_wrist < -0.1:
                    fh_score += 0.5
                elif effective_wrist > 0.1:
                    bh_score += 0.5

        # --- Signal 4: Hip rotation direction ---
        hip_rotation = metrics.get('hip_rotation', 0)
        effective_hip = hip_rotation if facing == "toward" else -hip_rotation

        if self.handedness == "right":
            if effective_hip > 3:
                fh_score += 0.3
            elif effective_hip < -3:
                bh_score += 0.3
        else:
            if effective_hip < -3:
                fh_score += 0.3
            elif effective_hip > 3:
                bh_score += 0.3

        # Classify based on voting
        if fh_score > bh_score and fh_score > 0.3:
            return 'forehand'
        elif bh_score > fh_score and bh_score > 0.3:
            return 'backhand'
        return 'unknown'

    def _calculate_form_score(self, metrics: Dict[str, float], stroke_type: str) -> float:
        """
        Calculate a form quality score (0-100) based on metrics.
        Higher score = better technique.
        """
        score = 100.0

        # Ideal ranges for different metrics (sport-specific)
        ideal_elbow_angle = 120  # Slightly bent elbow at contact
        ideal_knee_angle = 150   # Slightly bent knees
        ideal_hip_angle = 170    # Nearly straight hip

        # Penalize deviations from ideal form
        elbow_angle = metrics.get('elbow_angle', ideal_elbow_angle)
        elbow_deviation = abs(elbow_angle - ideal_elbow_angle)
        score -= min(elbow_deviation * 0.3, 20)  # Max 20 point penalty

        knee_angle = metrics.get('knee_angle', ideal_knee_angle)
        knee_deviation = abs(knee_angle - ideal_knee_angle)
        score -= min(knee_deviation * 0.2, 15)  # Max 15 point penalty

        # Reward good hip rotation (power generation)
        hip_rotation_range = metrics.get('hip_rotation_range', 0)
        if hip_rotation_range < 10:
            score -= 15  # Not enough hip rotation
        elif hip_rotation_range > 40:
            score -= 10  # Too much hip rotation (loss of control)

        # Reward good shoulder-hip separation
        shoulder_rotation_range = metrics.get('shoulder_rotation_range', 0)
        if shoulder_rotation_range < 10:
            score -= 10  # Not enough shoulder rotation

        # Penalize excessive spine lean (balance issues)
        spine_lean = abs(metrics.get('spine_lean', 0))
        if spine_lean > 20:
            score -= min((spine_lean - 20) * 0.5, 15)

        # Ensure score is between 0 and 100
        return max(0, min(100, score))

    def calculate_overall_form_score(self, strokes: List[Stroke]) -> Dict[str, float]:
        """
        Calculate overall statistics from all detected strokes.
        """
        if not strokes:
            return {
                'average_form_score': 0,
                'best_form_score': 0,
                'consistency_score': 0,
                'total_strokes': 0
            }

        form_scores = [s.form_score for s in strokes]

        avg_score = sum(form_scores) / len(form_scores)
        best_score = max(form_scores)

        # Calculate consistency (lower variance = higher consistency)
        variance = sum((score - avg_score) ** 2 for score in form_scores) / len(form_scores)
        std_dev = math.sqrt(variance)
        consistency = max(0, 100 - std_dev * 2)  # Convert to 0-100 scale

        return {
            'average_form_score': round(avg_score, 1),
            'best_form_score': round(best_score, 1),
            'consistency_score': round(consistency, 1),
            'total_strokes': len(strokes),
            'forehand_count': sum(1 for s in strokes if s.stroke_type == 'forehand'),
            'backhand_count': sum(1 for s in strokes if s.stroke_type == 'backhand'),
        }
