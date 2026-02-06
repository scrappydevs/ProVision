"""
Pose estimation service using MoveNet Lightning.
Extracts body keypoints and calculates joint angles from video.
MoveNet Lightning is optimized for speed and real-time performance.
"""

import cv2
import numpy as np
import tensorflow as tf
import tensorflow_hub as hub
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, asdict
import math


@dataclass
class Keypoint:
    """Represents a single body keypoint."""
    x: float
    y: float
    z: float
    visibility: float


@dataclass
class PoseFrame:
    """Represents pose data for a single frame."""
    frame_number: int
    timestamp: float
    keypoints: Dict[str, Keypoint]
    joint_angles: Dict[str, float]
    body_metrics: Dict[str, float]


class MoveNetProcessor:
    """
    Processes video to extract pose information using MoveNet Lightning.
    MoveNet Lightning is optimized for speed with minimal accuracy trade-off.
    """

    # MoveNet keypoints (COCO format - 17 keypoints)
    LANDMARK_NAMES = [
        'nose',              # 0
        'left_eye',          # 1
        'right_eye',         # 2
        'left_ear',          # 3
        'right_ear',         # 4
        'left_shoulder',     # 5
        'right_shoulder',    # 6
        'left_elbow',        # 7
        'right_elbow',       # 8
        'left_wrist',        # 9
        'right_wrist',       # 10
        'left_hip',          # 11
        'right_hip',         # 12
        'left_knee',         # 13
        'right_knee',        # 14
        'left_ankle',        # 15
        'right_ankle'        # 16
    ]

    # Skeleton connections for visualization
    SKELETON = [
        # Face
        (0, 1), (0, 2),  # nose to eyes
        (1, 3), (2, 4),  # eyes to ears
        # Torso
        (5, 6),   # shoulders
        (5, 11), (6, 12),  # shoulder to hip
        (11, 12),  # hips
        # Left arm
        (5, 7), (7, 9),  # shoulder-elbow-wrist
        # Right arm
        (6, 8), (8, 10),  # shoulder-elbow-wrist
        # Left leg
        (11, 13), (13, 15),  # hip-knee-ankle
        # Right leg
        (12, 14), (14, 16),  # hip-knee-ankle
    ]

    def __init__(self, conf_threshold: float = 0.2):
        """
        Initialize the pose processor with MoveNet Lightning.

        Args:
            conf_threshold: Confidence threshold for keypoint visibility
        """
        print(f"[MoveNetProcessor] Loading MoveNet Lightning model...")

        # Load MoveNet Lightning model from TensorFlow Hub
        # Lightning variant: 192x192 input, fastest performance
        model_url = "https://tfhub.dev/google/movenet/singlepose/lightning/4"
        self.model = hub.load(model_url)
        self.movenet = self.model.signatures['serving_default']
        self.conf_threshold = conf_threshold

        print(f"[MoveNetProcessor] MoveNet Lightning model loaded successfully")

    def process_video(self, video_path: str, sample_rate: int = 2) -> List[PoseFrame]:
        """
        Process a video file and extract pose data.

        Args:
            video_path: Path to the video file
            sample_rate: Process every Nth frame (1 = all frames, 2 = every other frame)

        Returns:
            List of PoseFrame objects containing pose data
        """
        print(f"[MoveNetProcessor] Processing video: {video_path}")

        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise ValueError(f"Could not open video: {video_path}")

        fps = cap.get(cv2.CAP_PROP_FPS)
        frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

        print(f"[MoveNetProcessor] Video info: {frame_count} frames, {fps} fps")

        pose_frames = []
        frame_number = 0

        while cap.isOpened():
            success, frame = cap.read()
            if not success:
                break

            # Sample frames based on sample_rate
            if frame_number % sample_rate != 0:
                frame_number += 1
                continue

            timestamp = frame_number / fps

            # Run MoveNet inference
            keypoints = self._detect_pose(frame)

            if keypoints is not None:
                # Calculate joint angles
                joint_angles = self._calculate_joint_angles(keypoints)

                # Calculate body metrics
                body_metrics = self._calculate_body_metrics(keypoints)

                pose_frame = PoseFrame(
                    frame_number=frame_number,
                    timestamp=timestamp,
                    keypoints=keypoints,
                    joint_angles=joint_angles,
                    body_metrics=body_metrics
                )

                pose_frames.append(pose_frame)

            frame_number += 1

            # Progress update
            if frame_number % 30 == 0:
                progress = (frame_number / frame_count) * 100
                print(f"[MoveNetProcessor] Progress: {progress:.1f}%")

        cap.release()
        print(f"[MoveNetProcessor] Processed {len(pose_frames)} frames with pose data")

        return pose_frames

    def generate_pose_overlay_video(self, video_path: str, output_path: str, sample_rate: int = 1) -> str:
        """
        Generate a video with pose skeleton overlay using MoveNet.

        Args:
            video_path: Path to input video
            output_path: Path to save output video
            sample_rate: Process every Nth frame (default: 1 for continuous overlay)

        Returns:
            Path to the generated video
        """
        print(f"[MoveNetProcessor] Generating pose overlay video: {video_path}")

        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise ValueError(f"Failed to open video: {video_path}")

        # Get video properties
        fps = cap.get(cv2.CAP_PROP_FPS)
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

        print(f"[MoveNetProcessor] Video info: {total_frames} frames, {width}x{height}, {fps} fps")

        # Create video writer with H.264 codec
        fourcc = cv2.VideoWriter_fourcc(*'avc1')
        out = cv2.VideoWriter(output_path, fourcc, fps, (width, height))

        if not out.isOpened():
            raise ValueError(f"Failed to create video writer: {output_path}")

        frame_idx = 0
        last_keypoints = None  # Cache last detected keypoints

        try:
            while True:
                ret, frame = cap.read()
                if not ret:
                    break

                # Process every sample_rate frame
                if frame_idx % sample_rate == 0:
                    # Run MoveNet inference
                    keypoints = self._detect_pose(frame)
                    if keypoints is not None:
                        last_keypoints = keypoints

                # Draw skeleton using current or cached keypoints
                if last_keypoints is not None:
                    self._draw_pose_on_frame(frame, last_keypoints, height, width)

                # Write frame
                out.write(frame)
                frame_idx += 1

                if frame_idx % 100 == 0:
                    progress = (frame_idx / total_frames) * 100
                    print(f"[MoveNetProcessor] Progress: {progress:.1f}%")

        finally:
            cap.release()
            out.release()

        print(f"[MoveNetProcessor] Generated pose overlay video: {output_path}")
        return output_path

    def _detect_pose(self, frame: np.ndarray) -> Optional[Dict[str, Keypoint]]:
        """
        Detect pose in a single frame using MoveNet.

        Args:
            frame: Input frame (BGR format from OpenCV)

        Returns:
            Dictionary of keypoints or None if no pose detected
        """
        # Convert BGR to RGB
        img = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

        # Resize to 192x192 (MoveNet Lightning input size)
        img = tf.image.resize_with_pad(img, 192, 192)

        # Convert to int32 and add batch dimension
        input_image = tf.cast(img, dtype=tf.int32)
        input_image = tf.expand_dims(input_image, axis=0)

        # Run inference
        outputs = self.movenet(input_image)
        keypoints_with_scores = outputs['output_0'].numpy()[0, 0, :, :]

        # Extract keypoints
        keypoints = {}
        has_valid_pose = False

        for idx, name in enumerate(self.LANDMARK_NAMES):
            y, x, confidence = keypoints_with_scores[idx]

            # Check if keypoint is above confidence threshold
            if confidence > self.conf_threshold:
                has_valid_pose = True

            keypoints[name] = Keypoint(
                x=float(x),
                y=float(y),
                z=0.0,  # MoveNet doesn't provide z-coordinate
                visibility=float(confidence)
            )

        return keypoints if has_valid_pose else None

    def _draw_pose_on_frame(self, frame: np.ndarray, keypoints: Dict[str, Keypoint],
                           height: int, width: int) -> None:
        """
        Draw pose skeleton on frame.

        Args:
            frame: Frame to draw on (modified in-place)
            keypoints: Dictionary of keypoints
            height: Frame height
            width: Frame width
        """
        # Convert normalized coordinates to pixel coordinates
        for connection in self.SKELETON:
            idx1, idx2 = connection
            name1 = self.LANDMARK_NAMES[idx1]
            name2 = self.LANDMARK_NAMES[idx2]

            kpt1 = keypoints[name1]
            kpt2 = keypoints[name2]

            # Check confidence
            if kpt1.visibility > self.conf_threshold and kpt2.visibility > self.conf_threshold:
                x1, y1 = int(kpt1.x * width), int(kpt1.y * height)
                x2, y2 = int(kpt2.x * width), int(kpt2.y * height)
                # Green line
                cv2.line(frame, (x1, y1), (x2, y2), (107, 142, 107), 3)

        # Draw keypoints
        for name, kpt in keypoints.items():
            if kpt.visibility > self.conf_threshold:
                x, y = int(kpt.x * width), int(kpt.y * height)
                # Green filled circle
                cv2.circle(frame, (x, y), 5, (107, 142, 107), -1)
                # Light border
                cv2.circle(frame, (x, y), 5, (232, 230, 227), 2)

    def _calculate_angle(self, p1: Keypoint, p2: Keypoint, p3: Keypoint) -> float:
        """
        Calculate angle between three points.

        Args:
            p1, p2, p3: Three keypoints forming an angle at p2

        Returns:
            Angle in degrees
        """
        # Vector from p2 to p1
        v1 = np.array([p1.x - p2.x, p1.y - p2.y])
        # Vector from p2 to p3
        v2 = np.array([p3.x - p2.x, p3.y - p2.y])

        # Calculate angle
        cos_angle = np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2) + 1e-6)
        angle = np.arccos(np.clip(cos_angle, -1.0, 1.0))

        return np.degrees(angle)

    def _calculate_joint_angles(self, keypoints: Dict[str, Keypoint]) -> Dict[str, float]:
        """Calculate key joint angles from keypoints."""
        angles = {}

        try:
            # Right elbow angle
            angles['right_elbow'] = self._calculate_angle(
                keypoints['right_shoulder'],
                keypoints['right_elbow'],
                keypoints['right_wrist']
            )

            # Left elbow angle
            angles['left_elbow'] = self._calculate_angle(
                keypoints['left_shoulder'],
                keypoints['left_elbow'],
                keypoints['left_wrist']
            )

            # Right shoulder angle
            angles['right_shoulder'] = self._calculate_angle(
                keypoints['right_hip'],
                keypoints['right_shoulder'],
                keypoints['right_elbow']
            )

            # Left shoulder angle
            angles['left_shoulder'] = self._calculate_angle(
                keypoints['left_hip'],
                keypoints['left_shoulder'],
                keypoints['left_elbow']
            )

            # Right knee angle
            angles['right_knee'] = self._calculate_angle(
                keypoints['right_hip'],
                keypoints['right_knee'],
                keypoints['right_ankle']
            )

            # Left knee angle
            angles['left_knee'] = self._calculate_angle(
                keypoints['left_hip'],
                keypoints['left_knee'],
                keypoints['left_ankle']
            )

            # Right hip angle
            angles['right_hip'] = self._calculate_angle(
                keypoints['right_shoulder'],
                keypoints['right_hip'],
                keypoints['right_knee']
            )

            # Left hip angle
            angles['left_hip'] = self._calculate_angle(
                keypoints['left_shoulder'],
                keypoints['left_hip'],
                keypoints['left_knee']
            )

        except KeyError as e:
            print(f"[MoveNetProcessor] Warning: Missing keypoint for angle calculation: {e}")

        return angles

    def _calculate_body_metrics(self, keypoints: Dict[str, Keypoint]) -> Dict[str, float]:
        """Calculate body-level metrics like center of mass, rotation, etc."""
        metrics = {}

        try:
            # Calculate center of mass (approximate from hips and shoulders)
            com_x = (keypoints['left_hip'].x + keypoints['right_hip'].x +
                     keypoints['left_shoulder'].x + keypoints['right_shoulder'].x) / 4
            com_y = (keypoints['left_hip'].y + keypoints['right_hip'].y +
                     keypoints['left_shoulder'].y + keypoints['right_shoulder'].y) / 4

            metrics['center_of_mass_x'] = com_x
            metrics['center_of_mass_y'] = com_y

            # Hip rotation (angle of hip line relative to horizontal)
            hip_dx = keypoints['right_hip'].x - keypoints['left_hip'].x
            hip_dy = keypoints['right_hip'].y - keypoints['left_hip'].y
            hip_rotation = math.degrees(math.atan2(hip_dy, hip_dx))
            metrics['hip_rotation'] = hip_rotation

            # Shoulder rotation
            shoulder_dx = keypoints['right_shoulder'].x - keypoints['left_shoulder'].x
            shoulder_dy = keypoints['right_shoulder'].y - keypoints['left_shoulder'].y
            shoulder_rotation = math.degrees(math.atan2(shoulder_dy, shoulder_dx))
            metrics['shoulder_rotation'] = shoulder_rotation

            # Spine lean (forward/backward)
            mid_shoulder_y = (keypoints['left_shoulder'].y + keypoints['right_shoulder'].y) / 2
            mid_hip_y = (keypoints['left_hip'].y + keypoints['right_hip'].y) / 2
            mid_shoulder_x = (keypoints['left_shoulder'].x + keypoints['right_shoulder'].x) / 2
            mid_hip_x = (keypoints['left_hip'].x + keypoints['right_hip'].x) / 2

            spine_angle = math.degrees(math.atan2(mid_shoulder_x - mid_hip_x, mid_hip_y - mid_shoulder_y))
            metrics['spine_lean'] = spine_angle

            # Body height (shoulder to ankle average)
            left_height = abs(keypoints['left_shoulder'].y - keypoints['left_ankle'].y)
            right_height = abs(keypoints['right_shoulder'].y - keypoints['right_ankle'].y)
            metrics['body_height'] = (left_height + right_height) / 2

        except KeyError as e:
            print(f"[MoveNetProcessor] Warning: Missing keypoint for body metrics: {e}")

        return metrics

    def pose_frame_to_dict(self, pose_frame: PoseFrame) -> Dict:
        """Convert PoseFrame to dictionary for JSON serialization."""
        return {
            'frame_number': pose_frame.frame_number,
            'timestamp': pose_frame.timestamp,
            'keypoints': {k: asdict(v) for k, v in pose_frame.keypoints.items()},
            'joint_angles': pose_frame.joint_angles,
            'body_metrics': pose_frame.body_metrics
        }

    def __del__(self):
        """Cleanup resources."""
        pass  # TensorFlow handles cleanup automatically
