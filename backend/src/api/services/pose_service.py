"""
Pose Service - MediaPipe-based pose estimation.
Runs locally (no GPU required) for pose extraction.
Enhanced with video overlay generation and body metrics.
"""

import os
import cv2
import numpy as np
import math
from typing import List, Optional, Dict
from pydantic import BaseModel
from dataclasses import dataclass, asdict

# MediaPipe import
try:
    import mediapipe as mp
    MEDIAPIPE_AVAILABLE = True
except ImportError:
    MEDIAPIPE_AVAILABLE = False


@dataclass
class Keypoint:
    """Represents a single body keypoint."""
    x: float
    y: float
    z: float
    visibility: float


@dataclass
class PoseFrame:
    """Represents pose data for a single frame (compatible with pose_processor format)."""
    frame_number: int
    timestamp: float
    keypoints: Dict[str, Keypoint]
    joint_angles: Dict[str, float]
    body_metrics: Dict[str, float]


class KeypointModel(BaseModel):
    """Pydantic model for keypoint (for API responses)."""
    name: str
    x: float
    y: float
    z: float
    visibility: float


class PoseFrameModel(BaseModel):
    """Pydantic model for pose frame."""
    frame: int
    timestamp: float
    keypoints: List[KeypointModel]


class JointAngles(BaseModel):
    """Joint angles model."""
    left_elbow: List[float]
    right_elbow: List[float]
    left_knee: List[float]
    right_knee: List[float]
    left_shoulder: List[float]
    right_shoulder: List[float]


class PoseData(BaseModel):
    """Legacy pose data model."""
    frames: List[PoseFrameModel]
    joint_angles: Optional[JointAngles] = None
    fps: float = 30.0


# MediaPipe landmark names (33 landmarks)
POSE_LANDMARKS = [
    "nose", "left_eye_inner", "left_eye", "left_eye_outer",
    "right_eye_inner", "right_eye", "right_eye_outer",
    "left_ear", "right_ear", "mouth_left", "mouth_right",
    "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
    "left_wrist", "right_wrist", "left_pinky", "right_pinky",
    "left_index", "right_index", "left_thumb", "right_thumb",
    "left_hip", "right_hip", "left_knee", "right_knee",
    "left_ankle", "right_ankle", "left_heel", "right_heel",
    "left_foot_index", "right_foot_index",
]

# MediaPipe pose connections for drawing skeleton
POSE_CONNECTIONS = [
    # Face
    (0, 1), (1, 2), (2, 3), (3, 7),  # nose to left eye to left ear
    (0, 4), (4, 5), (5, 6), (6, 8),  # nose to right eye to right ear
    (9, 10),  # mouth
    # Upper body
    (11, 12),  # shoulders
    (11, 13), (13, 15),  # left arm
    (12, 14), (14, 16),  # right arm
    (15, 17), (15, 19), (15, 21),  # left hand
    (16, 18), (16, 20), (16, 22),  # right hand
    # Torso
    (11, 23), (12, 24),  # shoulders to hips
    (23, 24),  # hips
    # Lower body
    (23, 25), (25, 27),  # left leg
    (24, 26), (26, 28),  # right leg
    (27, 29), (27, 31),  # left foot
    (28, 30), (28, 32),  # right foot
]


class PoseService:
    """Service for pose estimation using MediaPipe."""
    
    def __init__(self):
        self.pose = None
        self.drawing = None
        if MEDIAPIPE_AVAILABLE:
            mp_pose = mp.solutions.pose
            mp_drawing = mp.solutions.drawing_utils
            self.pose = mp_pose.Pose(
                static_image_mode=False,
                model_complexity=1,
                enable_segmentation=False,
                min_detection_confidence=0.5,
                min_tracking_confidence=0.5,
            )
            self.drawing = mp_drawing
    
    @property
    def is_available(self) -> bool:
        return MEDIAPIPE_AVAILABLE and self.pose is not None
    
    def process_video(self, video_path: str, sample_rate: int = 3, 
                     target_player: Optional[Dict] = None) -> List[PoseFrame]:
        """
        Process a video file and extract pose data (compatible with pose_processor format).
        
        Args:
            video_path: Path to video file
            sample_rate: Process every Nth frame (default: 3)
            target_player: Optional player selection dict (for compatibility)
            
        Returns:
            List of PoseFrame objects
        """
        if not self.is_available:
            return self._mock_pose_frames(100)
        
        print(f"[PoseService] Processing video: {video_path}")
        
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise ValueError(f"Failed to open video: {video_path}")
        
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        
        print(f"[PoseService] Video info: {total_frames} frames, {fps} fps, sample_rate={sample_rate}")
        
        pose_frames = []
        frame_idx = 0
        
        try:
            while cap.isOpened():
                ret, frame = cap.read()
                if not ret:
                    break
                
                # Process every sample_rate frame
                if frame_idx % sample_rate == 0:
                    # Convert BGR to RGB
                    rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                    
                    # Process frame
                    results = self.pose.process(rgb_frame)
                    
                    if results.pose_landmarks:
                        # Extract keypoints
                        keypoints_dict = {}
                        for i, landmark in enumerate(results.pose_landmarks.landmark):
                            name = POSE_LANDMARKS[i] if i < len(POSE_LANDMARKS) else f"landmark_{i}"
                            keypoints_dict[name] = Keypoint(
                                x=landmark.x,
                                y=landmark.y,
                                z=landmark.z,
                                visibility=landmark.visibility,
                            )
                        
                        # Calculate joint angles
                        joint_angles = self._calculate_joint_angles_dict(keypoints_dict)
                        
                        # Calculate body metrics
                        body_metrics = self._calculate_body_metrics(keypoints_dict)
                        
                        pose_frame = PoseFrame(
                            frame_number=frame_idx,
                            timestamp=frame_idx / fps,
                            keypoints=keypoints_dict,
                            joint_angles=joint_angles,
                            body_metrics=body_metrics,
                        )
                        pose_frames.append(pose_frame)
                
                frame_idx += 1
                
                if frame_idx % 100 == 0:
                    progress = (frame_idx / total_frames) * 100
                    print(f"[PoseService] Progress: {progress:.1f}%")
        
        finally:
            cap.release()
        
        print(f"[PoseService] Processed {len(pose_frames)} frames with pose data")
        return pose_frames
    
    def generate_pose_overlay_video(self, video_path: str, output_path: str,
                                    sample_rate: int = 1,
                                    target_player: Optional[Dict] = None) -> str:
        """
        Generate a video with pose skeleton overlay using MediaPipe.
        
        Args:
            video_path: Path to input video
            output_path: Path to save output video
            sample_rate: Process every Nth frame (default: 1 for continuous overlay)
            target_player: Optional player selection (for compatibility)
            
        Returns:
            Path to the generated video
        """
        if not self.is_available:
            raise RuntimeError("MediaPipe is not available")
        
        print(f"[PoseService] Generating pose overlay video: {video_path}")
        
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise ValueError(f"Failed to open video: {video_path}")
        
        # Get video properties
        fps = cap.get(cv2.CAP_PROP_FPS)
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        
        print(f"[PoseService] Video info: {total_frames} frames, {width}x{height}, {fps} fps")
        
        # Create video writer
        fourcc = cv2.VideoWriter_fourcc(*'avc1')
        out = cv2.VideoWriter(output_path, fourcc, fps, (width, height))
        
        if not out.isOpened():
            raise ValueError(f"Failed to create video writer: {output_path}")
        
        frame_idx = 0
        last_landmarks = None  # Cache last detected landmarks
        
        try:
            while True:
                ret, frame = cap.read()
                if not ret:
                    break
                
                # Process every sample_rate frame
                if frame_idx % sample_rate == 0:
                    # Convert BGR to RGB
                    rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                    
                    # Process frame
                    results = self.pose.process(rgb_frame)
                    
                    if results.pose_landmarks:
                        last_landmarks = results.pose_landmarks
                
                # Draw skeleton using current or cached landmarks
                if last_landmarks and self.drawing:
                    # Draw pose landmarks and connections
                    self.drawing.draw_landmarks(
                        frame,
                        last_landmarks,
                        mp.solutions.pose.POSE_CONNECTIONS,
                        landmark_drawing_spec=self.drawing.DrawingSpec(
                            color=(107, 142, 107),  # Green
                            thickness=2,
                            circle_radius=5
                        ),
                        connection_drawing_spec=self.drawing.DrawingSpec(
                            color=(107, 142, 107),  # Green
                            thickness=3
                        )
                    )
                
                # Write frame
                out.write(frame)
                frame_idx += 1
                
                if frame_idx % 100 == 0:
                    progress = (frame_idx / total_frames) * 100
                    print(f"[PoseService] Progress: {progress:.1f}%")
        
        finally:
            cap.release()
            out.release()
        
        print(f"[PoseService] Generated pose overlay video: {output_path}")
        return output_path
    
    def extract_poses_from_video(self, video_path: str, max_frames: int = 500) -> PoseData:
        """Extract pose data from video file (legacy method)."""
        if not self.is_available:
            return self._mock_pose_data(max_frames)
        
        cap = cv2.VideoCapture(video_path)
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        
        frames = []
        frame_idx = 0
        
        while cap.isOpened() and frame_idx < max_frames:
            ret, frame = cap.read()
            if not ret:
                break
            
            # Convert BGR to RGB
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            
            # Process frame
            results = self.pose.process(rgb_frame)
            
            if results.pose_landmarks:
                keypoints = []
                for i, landmark in enumerate(results.pose_landmarks.landmark):
                    keypoints.append(KeypointModel(
                        name=POSE_LANDMARKS[i] if i < len(POSE_LANDMARKS) else f"landmark_{i}",
                        x=landmark.x,
                        y=landmark.y,
                        z=landmark.z,
                        visibility=landmark.visibility,
                    ))
                
                frames.append(PoseFrameModel(
                    frame=frame_idx,
                    timestamp=frame_idx / fps,
                    keypoints=keypoints,
                ))
            
            frame_idx += 1
        
        cap.release()
        
        # Calculate joint angles
        joint_angles = self._calculate_joint_angles_legacy(frames) if frames else None
        
        return PoseData(
            frames=frames,
            joint_angles=joint_angles,
            fps=fps,
        )
    
    def _calculate_joint_angles_dict(self, keypoints: Dict[str, Keypoint]) -> Dict[str, float]:
        """Calculate joint angles from keypoints dict (compatible format)."""
        angles = {}
        
        try:
            # Left elbow angle
            if all(k in keypoints for k in ["left_shoulder", "left_elbow", "left_wrist"]):
                angles['left_elbow'] = self._calculate_angle(
                    keypoints["left_shoulder"],
                    keypoints["left_elbow"],
                    keypoints["left_wrist"],
                )
            
            # Right elbow angle
            if all(k in keypoints for k in ["right_shoulder", "right_elbow", "right_wrist"]):
                angles['right_elbow'] = self._calculate_angle(
                    keypoints["right_shoulder"],
                    keypoints["right_elbow"],
                    keypoints["right_wrist"],
                )
            
            # Left knee angle
            if all(k in keypoints for k in ["left_hip", "left_knee", "left_ankle"]):
                angles['left_knee'] = self._calculate_angle(
                    keypoints["left_hip"],
                    keypoints["left_knee"],
                    keypoints["left_ankle"],
                )
            
            # Right knee angle
            if all(k in keypoints for k in ["right_hip", "right_knee", "right_ankle"]):
                angles['right_knee'] = self._calculate_angle(
                    keypoints["right_hip"],
                    keypoints["right_knee"],
                    keypoints["right_ankle"],
                )
            
            # Left shoulder angle
            if all(k in keypoints for k in ["left_hip", "left_shoulder", "left_elbow"]):
                angles['left_shoulder'] = self._calculate_angle(
                    keypoints["left_hip"],
                    keypoints["left_shoulder"],
                    keypoints["left_elbow"],
                )
            
            # Right shoulder angle
            if all(k in keypoints for k in ["right_hip", "right_shoulder", "right_elbow"]):
                angles['right_shoulder'] = self._calculate_angle(
                    keypoints["right_hip"],
                    keypoints["right_shoulder"],
                    keypoints["right_elbow"],
                )
            
            # Left hip angle
            if all(k in keypoints for k in ["left_shoulder", "left_hip", "left_knee"]):
                angles['left_hip'] = self._calculate_angle(
                    keypoints["left_shoulder"],
                    keypoints["left_hip"],
                    keypoints["left_knee"],
                )
            
            # Right hip angle
            if all(k in keypoints for k in ["right_shoulder", "right_hip", "right_knee"]):
                angles['right_hip'] = self._calculate_angle(
                    keypoints["right_shoulder"],
                    keypoints["right_hip"],
                    keypoints["right_knee"],
                )
        
        except KeyError as e:
            print(f"[PoseService] Warning: Missing keypoint for angle calculation: {e}")
        
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
            print(f"[PoseService] Warning: Missing keypoint for body metrics: {e}")
        
        return metrics
    
    def _calculate_joint_angles_legacy(self, frames: List[PoseFrameModel]) -> JointAngles:
        """Calculate joint angles from pose frames (legacy format)."""
        angles = {
            "left_elbow": [],
            "right_elbow": [],
            "left_knee": [],
            "right_knee": [],
            "left_shoulder": [],
            "right_shoulder": [],
        }
        
        for frame in frames:
            kp_dict = {kp.name: kp for kp in frame.keypoints}
            
            # Left elbow angle
            if all(k in kp_dict for k in ["left_shoulder", "left_elbow", "left_wrist"]):
                angle = self._calculate_angle(
                    kp_dict["left_shoulder"],
                    kp_dict["left_elbow"],
                    kp_dict["left_wrist"],
                )
                angles["left_elbow"].append(angle)
            
            # Right elbow angle
            if all(k in kp_dict for k in ["right_shoulder", "right_elbow", "right_wrist"]):
                angle = self._calculate_angle(
                    kp_dict["right_shoulder"],
                    kp_dict["right_elbow"],
                    kp_dict["right_wrist"],
                )
                angles["right_elbow"].append(angle)
            
            # Left knee angle
            if all(k in kp_dict for k in ["left_hip", "left_knee", "left_ankle"]):
                angle = self._calculate_angle(
                    kp_dict["left_hip"],
                    kp_dict["left_knee"],
                    kp_dict["left_ankle"],
                )
                angles["left_knee"].append(angle)
            
            # Right knee angle
            if all(k in kp_dict for k in ["right_hip", "right_knee", "right_ankle"]):
                angle = self._calculate_angle(
                    kp_dict["right_hip"],
                    kp_dict["right_knee"],
                    kp_dict["right_ankle"],
                )
                angles["right_knee"].append(angle)
            
            # Shoulder angles (arm raise)
            if all(k in kp_dict for k in ["left_hip", "left_shoulder", "left_elbow"]):
                angle = self._calculate_angle(
                    kp_dict["left_hip"],
                    kp_dict["left_shoulder"],
                    kp_dict["left_elbow"],
                )
                angles["left_shoulder"].append(angle)
            
            if all(k in kp_dict for k in ["right_hip", "right_shoulder", "right_elbow"]):
                angle = self._calculate_angle(
                    kp_dict["right_hip"],
                    kp_dict["right_shoulder"],
                    kp_dict["right_elbow"],
                )
                angles["right_shoulder"].append(angle)
        
        return JointAngles(**angles)
    
    def _calculate_angle(self, a: Keypoint, b: Keypoint, c: Keypoint) -> float:
        """Calculate angle at point b formed by points a-b-c."""
        a_vec = np.array([a.x, a.y])
        b_vec = np.array([b.x, b.y])
        c_vec = np.array([c.x, c.y])
        
        ba = a_vec - b_vec
        bc = c_vec - b_vec
        
        cosine_angle = np.dot(ba, bc) / (np.linalg.norm(ba) * np.linalg.norm(bc) + 1e-6)
        angle = np.arccos(np.clip(cosine_angle, -1.0, 1.0))
        
        return round(np.degrees(angle), 1)
    
    def pose_frame_to_dict(self, pose_frame: PoseFrame) -> Dict:
        """Convert PoseFrame to dictionary for JSON serialization."""
        return {
            'frame_number': pose_frame.frame_number,
            'timestamp': pose_frame.timestamp,
            'keypoints': {k: asdict(v) for k, v in pose_frame.keypoints.items()},
            'joint_angles': pose_frame.joint_angles,
            'body_metrics': pose_frame.body_metrics
        }
    
    def extract_preview_frame(self, video_path: str, frame_number: int = 0) -> tuple:
        """Extract a preview frame from video."""
        cap = cv2.VideoCapture(video_path)
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_number)
        ret, frame = cap.read()
        cap.release()
        
        if not ret:
            raise ValueError(f"Failed to extract frame {frame_number}")
        
        # Get video info
        cap = cv2.VideoCapture(video_path)
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        cap.release()
        
        video_info = {
            'fps': fps,
            'width': width,
            'height': height,
            'total_frames': total_frames
        }
        
        return frame, video_info
    
    def detect_players_in_frame(self, frame: np.ndarray) -> List[Dict]:
        """Detect all people in a single frame (for compatibility)."""
        if not self.is_available:
            return []
        
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = self.pose.process(rgb_frame)
        
        players = []
        if results.pose_landmarks:
            # Get bounding box from landmarks
            landmarks = results.pose_landmarks.landmark
            xs = [lm.x for lm in landmarks]
            ys = [lm.y for lm in landmarks]
            
            x_min, x_max = min(xs), max(xs)
            y_min, y_max = min(ys), max(ys)
            
            # Add padding
            padding = 0.1
            x_min = max(0, x_min - padding)
            y_min = max(0, y_min - padding)
            x_max = min(1, x_max + padding)
            y_max = min(1, y_max + padding)
            
            height, width = frame.shape[:2]
            
            players.append({
                'id': 0,
                'bbox': [x_min * width, y_min * height, x_max * width, y_max * height],
                'center': {
                    'x': (x_min + x_max) / 2 * width,
                    'y': (y_min + y_max) / 2 * height
                },
                'confidence': 0.9
            })
        
        return players
    
    def generate_preview_with_boxes(self, frame: np.ndarray, players: List[Dict]) -> np.ndarray:
        """Generate preview frame with bounding boxes drawn."""
        preview = frame.copy()
        
        for player in players:
            bbox = player['bbox']
            x1, y1, x2, y2 = int(bbox[0]), int(bbox[1]), int(bbox[2]), int(bbox[3])
            cv2.rectangle(preview, (x1, y1), (x2, y2), (0, 255, 0), 2)
            cv2.putText(preview, f"Player {player['id']}", (x1, y1 - 10),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)
        
        return preview
    
    def _mock_pose_frames(self, num_frames: int) -> List[PoseFrame]:
        """Generate mock pose frames for testing."""
        frames = []
        
        for i in range(min(num_frames, 100)):
            keypoints = {}
            for name in POSE_LANDMARKS:
                keypoints[name] = Keypoint(
                    x=0.5 + np.random.randn() * 0.1,
                    y=0.5 + np.random.randn() * 0.1,
                    z=0.0,
                    visibility=0.9,
                )
            
            frames.append(PoseFrame(
                frame_number=i,
                timestamp=i / 30.0,
                keypoints=keypoints,
                joint_angles={},
                body_metrics={}
            ))
        
        return frames
    
    def _mock_pose_data(self, num_frames: int) -> PoseData:
        """Generate mock pose data for testing."""
        frames = []
        
        for i in range(min(num_frames, 100)):
            keypoints = []
            for name in POSE_LANDMARKS:
                keypoints.append(KeypointModel(
                    name=name,
                    x=0.5 + np.random.randn() * 0.1,
                    y=0.5 + np.random.randn() * 0.1,
                    z=0.0,
                    visibility=0.9,
                ))
            
            frames.append(PoseFrameModel(
                frame=i,
                timestamp=i / 30.0,
                keypoints=keypoints,
            ))
        
        return PoseData(
            frames=frames,
            joint_angles=JointAngles(
                left_elbow=[120 + np.random.randn() * 5 for _ in range(len(frames))],
                right_elbow=[125 + np.random.randn() * 5 for _ in range(len(frames))],
                left_knee=[160 + np.random.randn() * 3 for _ in range(len(frames))],
                right_knee=[158 + np.random.randn() * 3 for _ in range(len(frames))],
                left_shoulder=[45 + np.random.randn() * 10 for _ in range(len(frames))],
                right_shoulder=[50 + np.random.randn() * 10 for _ in range(len(frames))],
            ),
            fps=30.0,
        )


# Singleton instance
pose_service = PoseService()
