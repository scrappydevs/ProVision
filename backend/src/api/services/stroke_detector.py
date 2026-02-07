"""
Enhanced stroke detection and form scoring service.
Analyzes pose data to detect strokes and score technique quality.
Uses multi-signal approach with signal processing for improved accuracy.
"""

import numpy as np
from typing import List, Dict, Tuple, Optional
from dataclasses import dataclass
import math


@dataclass
class Stroke:
    """Represents a detected stroke."""
    start_frame: int
    end_frame: int
    peak_frame: int
    stroke_type: str  # 'forehand', 'backhand', 'serve', 'unknown'
    duration: float
    max_velocity: float
    form_score: float
    metrics: Dict[str, float]
    confidence: float = 0.0  # Detection confidence (0-1)


class StrokeDetector:
    """
    Enhanced stroke detector with multi-signal analysis and signal processing.
    Detects strokes from pose analysis data and scores form quality.
    """

    def __init__(self,
                 velocity_threshold: float = 50.0,
                 min_stroke_duration: int = 5,
                 max_stroke_duration: int = 60,
                 handedness: str = "right",
                 use_smoothing: bool = True,
                 smoothing_window: int = 3):
        """
        Initialize stroke detector.

        Args:
            velocity_threshold: Minimum wrist velocity to consider as stroke
            min_stroke_duration: Minimum frames for a valid stroke
            max_stroke_duration: Maximum frames for a valid stroke
            handedness: 'right' or 'left' — the player's dominant hand
            use_smoothing: Apply smoothing to velocity signals
            smoothing_window: Window size for moving average smoothing
        """
        self.velocity_threshold = velocity_threshold
        self.min_stroke_duration = min_stroke_duration
        self.max_stroke_duration = max_stroke_duration
        self.handedness = handedness
        self.use_smoothing = use_smoothing
        self.smoothing_window = smoothing_window

    def detect_strokes(self, pose_frames: List[Dict]) -> List[Stroke]:
        """
        Detect all strokes in the pose analysis data using multi-signal approach.

        Args:
            pose_frames: List of pose analysis frames from database

        Returns:
            List of detected Stroke objects
        """
        if len(pose_frames) < 2:
            return []

        # Calculate multiple signals
        wrist_velocities = self._calculate_wrist_velocities(pose_frames)
        elbow_velocities = self._calculate_elbow_angle_velocities(pose_frames)
        shoulder_velocities = self._calculate_shoulder_angle_velocities(pose_frames)

        # Apply smoothing if enabled
        if self.use_smoothing:
            wrist_velocities = self._smooth_signal(wrist_velocities)
            elbow_velocities = self._smooth_signal(elbow_velocities)
            shoulder_velocities = self._smooth_signal(shoulder_velocities)

        # Combine signals for better detection
        combined_signal = self._combine_signals(
            wrist_velocities, elbow_velocities, shoulder_velocities
        )

        # Find velocity peaks using combined signal
        peaks = self._find_velocity_peaks(combined_signal, wrist_velocities)

        # Analyze each peak to determine stroke boundaries
        strokes = []
        for peak_idx in peaks:
            stroke = self._analyze_stroke(
                pose_frames, wrist_velocities, elbow_velocities, 
                shoulder_velocities, peak_idx
            )
            if stroke:
                strokes.append(stroke)

        # Post-process: merge overlapping strokes and filter false positives
        strokes = self._post_process_strokes(strokes)

        return strokes

    def _smooth_signal(self, signal: List[float]) -> List[float]:
        """Apply moving average smoothing to reduce noise."""
        if len(signal) < self.smoothing_window:
            return signal
        
        smoothed = []
        window = self.smoothing_window
        
        for i in range(len(signal)):
            start = max(0, i - window // 2)
            end = min(len(signal), i + window // 2 + 1)
            smoothed.append(sum(signal[start:end]) / (end - start))
        
        return smoothed

    def _combine_signals(self, wrist: List[float], elbow: List[float], 
                        shoulder: List[float]) -> List[float]:
        """Combine multiple signals with weighted average."""
        combined = []
        for i in range(len(wrist)):
            # Normalize each signal to 0-1 range
            w_norm = min(1.0, wrist[i] / 200.0) if wrist[i] > 0 else 0
            e_norm = min(1.0, elbow[i] / 20.0) if elbow[i] > 0 else 0
            s_norm = min(1.0, shoulder[i] / 15.0) if shoulder[i] > 0 else 0
            
            # Weighted combination (wrist is primary signal)
            combined_val = (w_norm * 0.6 + e_norm * 0.25 + s_norm * 0.15) * 200
            combined.append(combined_val)
        
        return combined

    def _calculate_wrist_velocities(self, pose_frames: List[Dict]) -> List[float]:
        """Calculate dominant wrist velocity for each frame."""
        dom = self.handedness  # "right" or "left"
        off = "left" if dom == "right" else "right"
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
                # Check visibility
                prev_vis = prev_wrist.get('visibility', 0)
                curr_vis = curr_wrist.get('visibility', 0)
                
                if prev_vis > 0.3 and curr_vis > 0.3:
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
            else:
                velocity = 0.0

            velocities.append(velocity)

        return velocities

    def _calculate_elbow_angle_velocities(self, pose_frames: List[Dict]) -> List[float]:
        """Calculate elbow angle change rate (extension/flexion velocity)."""
        dom = self.handedness
        off = "left" if dom == "right" else "right"
        velocities = [0.0]

        for i in range(1, len(pose_frames)):
            prev_frame = pose_frames[i - 1]
            curr_frame = pose_frames[i]

            prev_angles = prev_frame.get('joint_angles', {})
            curr_angles = curr_frame.get('joint_angles', {})

            prev_elbow = prev_angles.get(f'{dom}_elbow', prev_angles.get(f'{off}_elbow', 0))
            curr_elbow = curr_angles.get(f'{dom}_elbow', curr_angles.get(f'{off}_elbow', 0))

            dt = curr_frame['timestamp'] - prev_frame['timestamp']
            if dt > 0:
                velocity = abs(curr_elbow - prev_elbow) / dt
            else:
                velocity = 0.0

            velocities.append(velocity)

        return velocities

    def _calculate_shoulder_angle_velocities(self, pose_frames: List[Dict]) -> List[float]:
        """Calculate shoulder angle change rate."""
        dom = self.handedness
        off = "left" if dom == "right" else "right"
        velocities = [0.0]

        for i in range(1, len(pose_frames)):
            prev_frame = pose_frames[i - 1]
            curr_frame = pose_frames[i]

            prev_angles = prev_frame.get('joint_angles', {})
            curr_angles = curr_frame.get('joint_angles', {})

            prev_shoulder = prev_angles.get(f'{dom}_shoulder', prev_angles.get(f'{off}_shoulder', 0))
            curr_shoulder = curr_angles.get(f'{dom}_shoulder', curr_angles.get(f'{off}_shoulder', 0))

            dt = curr_frame['timestamp'] - prev_frame['timestamp']
            if dt > 0:
                velocity = abs(curr_shoulder - prev_shoulder) / dt
            else:
                velocity = 0.0

            velocities.append(velocity)

        return velocities

    def _find_velocity_peaks(self, combined_signal: List[float], 
                            wrist_velocities: List[float]) -> List[int]:
        """Find peaks in velocity using combined signal and validate with wrist velocity."""
        peaks = []

        for i in range(2, len(combined_signal) - 2):
            # Check if this is a local maximum above threshold
            is_peak = (
                combined_signal[i] > self.velocity_threshold * 0.7 and
                combined_signal[i] > combined_signal[i - 1] and
                combined_signal[i] > combined_signal[i + 1] and
                combined_signal[i] > combined_signal[i - 2] and
                combined_signal[i] > combined_signal[i + 2]
            )

            # Also check wrist velocity for validation
            wrist_strong = wrist_velocities[i] > self.velocity_threshold * 0.5

            if is_peak and wrist_strong:
                # Ensure peaks are not too close together (at least 10 frames apart)
                if not peaks or (i - peaks[-1]) > 10:
                    peaks.append(i)

        return peaks

    def _analyze_stroke(self,
                       pose_frames: List[Dict],
                       wrist_velocities: List[float],
                       elbow_velocities: List[float],
                       shoulder_velocities: List[float],
                       peak_idx: int) -> Optional[Stroke]:
        """
        Analyze a velocity peak to determine stroke boundaries and characteristics.
        """
        # Find stroke start (velocity rises above 25% of peak)
        threshold_vel = wrist_velocities[peak_idx] * 0.25
        start_idx = peak_idx
        for i in range(peak_idx - 1, max(0, peak_idx - self.max_stroke_duration), -1):
            if wrist_velocities[i] < threshold_vel:
                start_idx = i
                break

        # Find stroke end (velocity drops below 25% of peak)
        end_idx = peak_idx
        for i in range(peak_idx + 1, min(len(wrist_velocities), peak_idx + self.max_stroke_duration)):
            if wrist_velocities[i] < threshold_vel:
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

        # Determine stroke type with improved classification
        stroke_type, confidence = self._classify_stroke_type(stroke_frames, metrics)

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
            max_velocity=wrist_velocities[peak_idx],
            form_score=form_score,
            metrics=metrics,
            confidence=confidence
        )

    def _calculate_stroke_metrics(self, stroke_frames: List[Dict], peak_idx: int) -> Dict[str, float]:
        """Calculate comprehensive metrics for a stroke."""
        metrics = {}
        dom = self.handedness
        off = "left" if dom == "right" else "right"

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
        metrics['hip_rotation_range'] = max(hip_rotations) - min(hip_rotations) if hip_rotations else 0

        shoulder_rotations = [f.get('body_metrics', {}).get('shoulder_rotation', 0) for f in stroke_frames]
        metrics['shoulder_rotation_range'] = max(shoulder_rotations) - min(shoulder_rotations) if shoulder_rotations else 0

        # Calculate acceleration metrics
        if len(stroke_frames) > 2:
            start_vel = metrics.get('elbow_range', 0) / stroke_frames[0].get('timestamp', 1)
            end_vel = metrics.get('elbow_range', 0) / stroke_frames[-1].get('timestamp', 1)
            metrics['acceleration'] = abs(end_vel - start_vel) / len(stroke_frames) if len(stroke_frames) > 0 else 0

        return metrics

    def _classify_stroke_type(self, stroke_frames: List[Dict], 
                             metrics: Dict[str, float]) -> Tuple[str, float]:
        """
        Classify the stroke type with improved accuracy and return confidence.
        
        Returns:
            Tuple of (stroke_type, confidence)
        """
        shoulder_rotation = metrics.get('shoulder_rotation', 0)
        hip_rotation_range = metrics.get('hip_rotation_range', 0)
        shoulder_rotation_range = metrics.get('shoulder_rotation_range', 0)

        # Serve detection: large hip rotation and high shoulder rotation
        if hip_rotation_range > 30 and shoulder_rotation_range > 25:
            return ('serve', 0.9)

        # Get wrist position relative to body midline for better classification
        if stroke_frames:
            peak_frame = stroke_frames[len(stroke_frames) // 2]
            keypoints = peak_frame.get('keypoints', {})
            
            dom = self.handedness
            dom_wrist = keypoints.get(f'{dom}_wrist', {})
            left_shoulder = keypoints.get('left_shoulder', {})
            right_shoulder = keypoints.get('right_shoulder', {})
            
            if dom_wrist and left_shoulder and right_shoulder:
                mid_x = (left_shoulder.get('x', 0) + right_shoulder.get('x', 0)) / 2
                wrist_x = dom_wrist.get('x', 0)
                wrist_relative = wrist_x - mid_x
            else:
                wrist_relative = 0
        else:
            wrist_relative = 0

        confidence = 0.7  # Base confidence

        # Classification based on handedness
        if self.handedness == "right":
            # Right-hander: positive shoulder rotation = forehand side
            if shoulder_rotation > 5 and wrist_relative > 0:
                return ('forehand', min(0.95, confidence + 0.2))
            elif shoulder_rotation < -5 and wrist_relative < 0:
                return ('backhand', min(0.95, confidence + 0.2))
            elif shoulder_rotation > 5:
                return ('forehand', confidence)
            elif shoulder_rotation < -5:
                return ('backhand', confidence)
        else:
            # Left-hander: negative shoulder rotation = forehand side
            if shoulder_rotation < -5 and wrist_relative < 0:
                return ('forehand', min(0.95, confidence + 0.2))
            elif shoulder_rotation > 5 and wrist_relative > 0:
                return ('backhand', min(0.95, confidence + 0.2))
            elif shoulder_rotation < -5:
                return ('forehand', confidence)
            elif shoulder_rotation > 5:
                return ('backhand', confidence)

        return ('unknown', 0.3)

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
        elif 15 <= hip_rotation_range <= 35:
            score += 5  # Bonus for optimal range

        # Reward good shoulder-hip separation
        shoulder_rotation_range = metrics.get('shoulder_rotation_range', 0)
        if shoulder_rotation_range < 10:
            score -= 10  # Not enough shoulder rotation
        elif 15 <= shoulder_rotation_range <= 30:
            score += 5  # Bonus for good rotation

        # Penalize excessive spine lean (balance issues)
        spine_lean = abs(metrics.get('spine_lean', 0))
        if spine_lean > 20:
            score -= min((spine_lean - 20) * 0.5, 15)

        # Reward good elbow range (full extension/flexion)
        elbow_range = metrics.get('elbow_range', 0)
        if 30 <= elbow_range <= 80:
            score += 5  # Good range of motion

        # Ensure score is between 0 and 100
        return max(0, min(100, score))

    def _post_process_strokes(self, strokes: List[Stroke]) -> List[Stroke]:
        """Post-process strokes: merge overlapping and filter low-confidence."""
        if not strokes:
            return []

        # Sort by start frame
        strokes = sorted(strokes, key=lambda s: s.start_frame)

        # Merge overlapping strokes (keep the one with higher confidence)
        merged = []
        for stroke in strokes:
            if not merged:
                merged.append(stroke)
            else:
                last = merged[-1]
                # Check if overlapping
                if stroke.start_frame <= last.end_frame:
                    # Merge: keep the one with higher confidence or velocity
                    if stroke.confidence > last.confidence or stroke.max_velocity > last.max_velocity:
                        merged[-1] = stroke
                else:
                    merged.append(stroke)

        # Filter low-confidence strokes
        filtered = [s for s in merged if s.confidence > 0.3]

        return filtered

    def calculate_overall_form_score(self, strokes: List[Stroke]) -> Dict[str, float]:
        """
        Calculate overall statistics from all detected strokes.
        """
        if not strokes:
            return {
                'average_form_score': 0,
                'best_form_score': 0,
                'consistency_score': 0,
                'total_strokes': 0,
                'forehand_count': 0,
                'backhand_count': 0,
                'serve_count': 0,
                'average_confidence': 0
            }

        form_scores = [s.form_score for s in strokes]
        confidences = [s.confidence for s in strokes]

        avg_score = sum(form_scores) / len(form_scores)
        best_score = max(form_scores)
        avg_confidence = sum(confidences) / len(confidences)

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
            'serve_count': sum(1 for s in strokes if s.stroke_type == 'serve'),
            'average_confidence': round(avg_confidence, 2),
        }
