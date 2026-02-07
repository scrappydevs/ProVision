"""
Pose Service - MediaPipe-based pose estimation.
Runs locally (no GPU required) for pose extraction.
"""

import os
import cv2
import numpy as np
from typing import List, Optional
from pydantic import BaseModel

# MediaPipe import
try:
    import mediapipe as mp
    MEDIAPIPE_AVAILABLE = True
except ImportError:
    MEDIAPIPE_AVAILABLE = False


class Keypoint(BaseModel):
    name: str
    x: float
    y: float
    z: float
    visibility: float


class PoseFrame(BaseModel):
    frame: int
    timestamp: float
    keypoints: List[Keypoint]


class JointAngles(BaseModel):
    left_elbow: List[float]
    right_elbow: List[float]
    left_knee: List[float]
    right_knee: List[float]
    left_shoulder: List[float]
    right_shoulder: List[float]


class PoseData(BaseModel):
    frames: List[PoseFrame]
    joint_angles: Optional[JointAngles] = None
    fps: float = 30.0


# MediaPipe landmark names
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


class PoseService:
    """Service for pose estimation using MediaPipe."""
    
    def __init__(self):
        self.pose = None
        if MEDIAPIPE_AVAILABLE:
            mp_pose = mp.solutions.pose
            self.pose = mp_pose.Pose(
                static_image_mode=False,
                model_complexity=1,
                enable_segmentation=False,
                min_detection_confidence=0.5,
                min_tracking_confidence=0.5,
            )
    
    @property
    def is_available(self) -> bool:
        return MEDIAPIPE_AVAILABLE and self.pose is not None
    
    def extract_poses_from_video(self, video_path: str, max_frames: int = 500) -> PoseData:
        """Extract pose data from video file."""
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
                    keypoints.append(Keypoint(
                        name=POSE_LANDMARKS[i] if i < len(POSE_LANDMARKS) else f"landmark_{i}",
                        x=landmark.x,
                        y=landmark.y,
                        z=landmark.z,
                        visibility=landmark.visibility,
                    ))
                
                frames.append(PoseFrame(
                    frame=frame_idx,
                    timestamp=frame_idx / fps,
                    keypoints=keypoints,
                ))
            
            frame_idx += 1
        
        cap.release()
        
        # Calculate joint angles
        joint_angles = self._calculate_joint_angles(frames) if frames else None
        
        return PoseData(
            frames=frames,
            joint_angles=joint_angles,
            fps=fps,
        )
    
    def _calculate_joint_angles(self, frames: List[PoseFrame]) -> JointAngles:
        """Calculate joint angles from pose keypoints."""
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
    
    def _mock_pose_data(self, num_frames: int) -> PoseData:
        """Generate mock pose data for testing."""
        frames = []
        
        for i in range(min(num_frames, 100)):
            keypoints = []
            for name in POSE_LANDMARKS:
                keypoints.append(Keypoint(
                    name=name,
                    x=0.5 + np.random.randn() * 0.1,
                    y=0.5 + np.random.randn() * 0.1,
                    z=0.0,
                    visibility=0.9,
                ))
            
            frames.append(PoseFrame(
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
