"""
Pose estimation service using a pose model.
Extracts body keypoints and calculates joint angles from video.
"""

import cv2
import numpy as np
from ultralytics import YOLO
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
    person_id: int = 0  # 0 = primary player, 1 = opponent


class PoseProcessor:
    """
    Processes video to extract pose information using a pose model.
    """

    # Pose keypoints (COCO format - 17 keypoints)
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

    # Pose skeleton connections
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

    def __init__(self, model_name: str = 'yolo11n-pose.pt', conf: float = 0.3):
        """
        Initialize the pose processor with a pose model.

        Args:
            model_name: Pose model to use (e.g., yolo11n-pose.pt, yolo11s-pose.pt, etc.)
            conf: Confidence threshold for detections
        """
        print(f"[PoseProcessor] Loading YOLOv11 model: {model_name}")
        self.model = YOLO(model_name)
        self.conf = conf
        print(f"[PoseProcessor] YOLOv11 model loaded successfully")

    def detect_players_in_frame(self, frame: np.ndarray, conf_override: float = None) -> List[Dict]:
        """
        Detect all people in a single frame.

        Args:
            frame: Video frame (BGR format)
            conf_override: Override confidence threshold (lower = more detections)

        Returns:
            List of detected players with bounding boxes and centers
        """
        # Use lower confidence for detection to catch more players
        detection_conf = conf_override if conf_override is not None else min(self.conf, 0.15)
        results = self.model(frame, conf=detection_conf, verbose=False)

        print(f"[PoseProcessor] Detection with conf={detection_conf}, found {len(results[0].boxes) if results[0].boxes is not None else 0} boxes")

        players = []
        if len(results) > 0 and results[0].boxes is not None:
            boxes = results[0].boxes
            keypoints_data = results[0].keypoints.data if results[0].keypoints is not None else None
            
            print(f"[PoseProcessor] Processing {len(boxes)} detected boxes")

            for idx, box in enumerate(boxes):
                bbox = box.xyxy[0].cpu().numpy()  # [x1, y1, x2, y2]
                confidence = float(box.conf[0])

                x1, y1, x2, y2 = bbox
                width = x2 - x1
                height = y2 - y1
                center_x = x1 + width / 2
                center_y = y1 + height / 2

                player = {
                    "player_idx": idx,
                    "bbox": {
                        "x": float(x1),
                        "y": float(y1),
                        "width": float(width),
                        "height": float(height)
                    },
                    "confidence": confidence,
                    "center": {
                        "x": float(center_x),
                        "y": float(center_y)
                    }
                }

                # Add keypoints if available
                if keypoints_data is not None and idx < len(keypoints_data):
                    player["has_keypoints"] = True

                players.append(player)

        # Sort by confidence (highest first)
        players.sort(key=lambda p: p["confidence"], reverse=True)

        # Re-index after sorting
        for i, player in enumerate(players):
            player["player_idx"] = i

        return players

    def extract_preview_frame(self, video_path: str, frame_number: int = 0) -> Tuple[np.ndarray, Dict]:
        """
        Extract a frame from video for preview.

        Args:
            video_path: Path to video file
            frame_number: Which frame to extract (default: first frame)

        Returns:
            Tuple of (frame image, video info dict)
        """
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise ValueError(f"Could not open video: {video_path}")

        fps = cap.get(cv2.CAP_PROP_FPS)
        frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

        # Seek to frame
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_number)
        success, frame = cap.read()
        cap.release()

        if not success:
            raise ValueError(f"Could not read frame {frame_number} from video")

        video_info = {
            "fps": fps,
            "frame_count": frame_count,
            "width": width,
            "height": height,
            "duration": frame_count / fps if fps > 0 else 0
        }

        return frame, video_info

    def generate_preview_with_boxes(self, frame: np.ndarray, players: List[Dict]) -> np.ndarray:
        """
        Draw bounding boxes on frame for player selection preview.

        Args:
            frame: Video frame
            players: List of detected players

        Returns:
            Frame with bounding boxes drawn
        """
        preview = frame.copy()

        colors = [
            (91, 123, 155),   # Bronze accent
            (92, 184, 92),    # Green
            (66, 139, 202),   # Blue
            (240, 173, 78),   # Orange
            (217, 83, 79),    # Red
        ]

        for player in players:
            idx = player["player_idx"]
            bbox = player["bbox"]
            color = colors[idx % len(colors)]

            x1 = int(bbox["x"])
            y1 = int(bbox["y"])
            x2 = int(bbox["x"] + bbox["width"])
            y2 = int(bbox["y"] + bbox["height"])

            # Draw bounding box
            cv2.rectangle(preview, (x1, y1), (x2, y2), color, 3)

            # Draw player number label
            label = f"Player {idx + 1}"
            font = cv2.FONT_HERSHEY_SIMPLEX
            font_scale = 0.8
            thickness = 2
            (label_w, label_h), _ = cv2.getTextSize(label, font, font_scale, thickness)

            # Label background
            cv2.rectangle(preview, (x1, y1 - label_h - 10), (x1 + label_w + 10, y1), color, -1)
            # Label text
            cv2.putText(preview, label, (x1 + 5, y1 - 5), font, font_scale, (255, 255, 255), thickness)

            # Draw confidence
            conf_label = f"{player['confidence']:.0%}"
            cv2.putText(preview, conf_label, (x1 + 5, y2 + 20), font, 0.6, color, 2)

        return preview

    def _find_closest_player(self, results, last_center: Dict[str, float], exclude_indices: List[int] = None) -> Optional[int]:
        """
        Find the player closest to the last tracked position.

        Args:
            results: Pose detection results
            last_center: Last known center position {"x": float, "y": float}
            exclude_indices: List of indices to exclude from matching

        Returns:
            Index of closest player or None
        """
        if results[0].boxes is None or len(results[0].boxes) == 0:
            return None

        if exclude_indices is None:
            exclude_indices = []

        boxes = results[0].boxes
        min_dist = float('inf')
        closest_idx = None

        for idx, box in enumerate(boxes):
            if idx in exclude_indices:
                continue
                
            bbox = box.xyxy[0].cpu().numpy()
            center_x = (bbox[0] + bbox[2]) / 2
            center_y = (bbox[1] + bbox[3]) / 2

            dist = math.sqrt(
                (center_x - last_center["x"]) ** 2 +
                (center_y - last_center["y"]) ** 2
            )

            if dist < min_dist:
                min_dist = dist
                closest_idx = idx

        return closest_idx

    def process_video(self, video_path: str, sample_rate: int = 2, 
                      selected_players: Optional[List[Dict]] = None,
                      target_player: Optional[Dict] = None) -> List[PoseFrame]:
        """
        Process a video file and extract pose data.

        Args:
            video_path: Path to the video file
            sample_rate: Process every Nth frame (1 = all frames, 2 = every other frame)
            selected_players: List of selected players [player, opponent] with initial positions
            target_player: DEPRECATED - use selected_players instead

        Returns:
            List of PoseFrame objects containing pose data
        """
        print(f"[PoseProcessor] Processing video: {video_path}")

        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise ValueError(f"Could not open video: {video_path}")

        fps = cap.get(cv2.CAP_PROP_FPS)
        frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

        print(f"[PoseProcessor] Video info: {frame_count} frames, {fps} fps")

        # Support both new multi-player and legacy single player
        if selected_players and len(selected_players) > 0:
            print(f"[PoseProcessor] Tracking {len(selected_players)} selected players")
            player_center = selected_players[0]["center"].copy()
            opponent_center = selected_players[1]["center"].copy() if len(selected_players) > 1 else None
        elif target_player:
            print(f"[PoseProcessor] Tracking selected player at center: {target_player['center']}")
            player_center = target_player["center"].copy()
            opponent_center = None
        else:
            print(f"[PoseProcessor] No player selected - tracking all detected persons")
            player_center = None
            opponent_center = None

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

            # Run pose inference
            results = self.model(frame, conf=self.conf, verbose=False)

            # Process detected persons (track both player and opponent)
            if len(results) > 0 and results[0].keypoints is not None:
                keypoints_data = results[0].keypoints.data

                if len(keypoints_data) > 0:
                    # Match detections to selected players using proximity
                    player_idx = None
                    opp_idx = None
                    
                    if player_center:
                        player_idx = self._find_closest_player(results, player_center)
                        if player_idx is None:
                            player_idx = 0
                    else:
                        player_idx = 0
                    
                    if opponent_center and len(keypoints_data) > 1:
                        # Find closest to opponent center (excluding player_idx)
                        opp_idx = self._find_closest_player(results, opponent_center, exclude_indices=[player_idx])
                        
                        # Validate the match distance - if too far, the selected opponent isn't in frame
                        if opp_idx is not None:
                            bbox = results[0].boxes[opp_idx].xyxy[0].cpu().numpy()
                            center_x = (bbox[0] + bbox[2]) / 2
                            center_y = (bbox[1] + bbox[3]) / 2
                            dist = math.sqrt((center_x - opponent_center["x"]) ** 2 + (center_y - opponent_center["y"]) ** 2)
                            
                            if dist > 200:  # More than 200px away - likely wrong person
                                print(f"[PoseProcessor] WARNING: Closest opponent match is {dist:.0f}px away (> 200px threshold)")
                                print(f"  Selected opponent center: ({opponent_center['x']:.1f}, {opponent_center['y']:.1f})")
                                print(f"  Matched detection center: ({center_x:.1f}, {center_y:.1f})")
                                print(f"  Skipping opponent tracking - selected person not in frame")
                                opp_idx = None  # Don't track wrong person
                                opponent_center = None  # Stop trying to track opponent
                        
                        if frame_number == 0 and opp_idx is not None:
                            print(f"[PoseProcessor] Frame 0: Opponent matched successfully at idx {opp_idx}")
                        
                        if opp_idx is None and len(keypoints_data) > 1:
                            # Fallback disabled - don't track wrong person
                            pass
                    elif len(keypoints_data) > 1:
                        # No opponent selected - pick the other person
                        opp_idx = 1 if player_idx == 0 else 0

                    # Process main player (person_id=0)
                    if player_idx is not None and player_idx < len(keypoints_data):
                        kpts = keypoints_data[player_idx]

                        # Update tracking center for next frame
                        if player_center:
                            left_hip = kpts[11]
                            right_hip = kpts[12]
                            left_shoulder = kpts[5]
                            right_shoulder = kpts[6]
                            player_center = {
                                "x": float((left_hip[0] + right_hip[0] + left_shoulder[0] + right_shoulder[0]) / 4),
                                "y": float((left_hip[1] + right_hip[1] + left_shoulder[1] + right_shoulder[1]) / 4)
                            }

                        keypoints = self._extract_keypoints(kpts)
                        joint_angles = self._calculate_joint_angles(keypoints)
                        body_metrics = self._calculate_body_metrics(keypoints)

                        pose_frames.append(PoseFrame(
                            frame_number=frame_number,
                            timestamp=timestamp,
                            keypoints=keypoints,
                            joint_angles=joint_angles,
                            body_metrics=body_metrics,
                            person_id=0,
                        ))

                    # Process opponent (person_id=1)
                    if opp_idx is not None and opp_idx < len(keypoints_data):
                        opp_kpts = keypoints_data[opp_idx]
                        
                        # Update tracking center for next frame
                        if opponent_center:
                            left_hip = opp_kpts[11]
                            right_hip = opp_kpts[12]
                            left_shoulder = opp_kpts[5]
                            right_shoulder = opp_kpts[6]
                            opponent_center = {
                                "x": float((left_hip[0] + right_hip[0] + left_shoulder[0] + right_shoulder[0]) / 4),
                                "y": float((left_hip[1] + right_hip[1] + left_shoulder[1] + right_shoulder[1]) / 4)
                            }

                        opp_keypoints = self._extract_keypoints(opp_kpts)
                        opp_joint_angles = self._calculate_joint_angles(opp_keypoints)
                        opp_body_metrics = self._calculate_body_metrics(opp_keypoints)

                        pose_frames.append(PoseFrame(
                            frame_number=frame_number,
                            timestamp=timestamp,
                            keypoints=opp_keypoints,
                            joint_angles=opp_joint_angles,
                            body_metrics=opp_body_metrics,
                            person_id=1,
                        ))

            frame_number += 1

            # Progress update
            if frame_number % 30 == 0:
                progress = (frame_number / frame_count) * 100
                print(f"[PoseProcessor] Progress: {progress:.1f}%")

        cap.release()
        print(f"[PoseProcessor] Processed {len(pose_frames)} frames with pose data")

        return pose_frames

    def generate_pose_overlay_video(self, video_path: str, output_path: str, 
                                     sample_rate: int = 1,
                                     selected_players: Optional[List[Dict]] = None,
                                     target_player: Optional[Dict] = None) -> str:
        """
        Generate a video with pose skeleton overlay using the pose model.

        Args:
            video_path: Path to input video
            output_path: Path to save output video
            sample_rate: Process every Nth frame (default: 1 for continuous overlay)
            target_player: Optional player selection with initial center position

        Returns:
            Path to the generated video
        """
        print(f"[PoseProcessor] Generating pose overlay video: {video_path}")

        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise ValueError(f"Failed to open video: {video_path}")

        # Get video properties
        fps = cap.get(cv2.CAP_PROP_FPS)
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

        print(f"[PoseProcessor] Video info: {total_frames} frames, {width}x{height}, {fps} fps")

        # Support both new multi-player and legacy single player
        if selected_players and len(selected_players) > 0:
            print(f"[PoseProcessor] Tracking {len(selected_players)} selected players")
            player_center = selected_players[0]["center"].copy()
            opponent_center = selected_players[1]["center"].copy() if len(selected_players) > 1 else None
        elif target_player:
            print(f"[PoseProcessor] Tracking selected player at center: {target_player['center']}")
            player_center = target_player["center"].copy()
            opponent_center = None
        else:
            player_center = None
            opponent_center = None

        # Colors: player = green, opponent = orange (BGR format)
        PLAYER_COLOR = (91, 155, 107)     # Green
        OPPONENT_COLOR = (91, 123, 205)   # Orange
        BORDER_COLOR = (232, 230, 227)    # Light

        fourcc = cv2.VideoWriter_fourcc(*'avc1')
        out = cv2.VideoWriter(output_path, fourcc, fps, (width, height))

        if not out.isOpened():
            raise ValueError(f"Failed to create video writer: {output_path}")

        frame_idx = 0
        last_player_kpts = None
        last_opponent_kpts = None

        try:
            while True:
                ret, frame = cap.read()
                if not ret:
                    break

                if frame_idx % sample_rate == 0:
                    results = self.model(frame, conf=self.conf, verbose=False)

                    if len(results) > 0 and results[0].keypoints is not None:
                        keypoints_data = results[0].keypoints.data
                        if len(keypoints_data) > 0:
                            # Match detections to selected players using proximity
                            player_idx = None
                            opp_idx = None
                            
                            if player_center:
                                player_idx = self._find_closest_player(results, player_center)
                                if player_idx is None:
                                    player_idx = 0
                            else:
                                player_idx = 0
                            
                            if opponent_center and len(keypoints_data) > 1:
                                opp_idx = self._find_closest_player(results, opponent_center, exclude_indices=[player_idx])
                                
                                # Validate the match distance - if too far, the selected opponent isn't in frame
                                if opp_idx is not None:
                                    bbox = results[0].boxes[opp_idx].xyxy[0].cpu().numpy()
                                    center_x = (bbox[0] + bbox[2]) / 2
                                    center_y = (bbox[1] + bbox[3]) / 2
                                    dist = math.sqrt((center_x - opponent_center["x"]) ** 2 + (center_y - opponent_center["y"]) ** 2)
                                    
                                    if dist > 200:
                                        if frame_idx == 0:
                                            print(f"[PoseProcessor] Overlay: Skipping opponent - closest match is {dist:.0f}px away (threshold 200px)")
                                        opp_idx = None
                                        opponent_center = None
                                    elif frame_idx == 0:
                                        print(f"[PoseProcessor] Overlay Frame 0: Opponent matched successfully at idx {opp_idx}")
                                
                                if opp_idx is None and len(keypoints_data) > 1:
                                    # Don't use fallback - skip opponent tracking if not found
                                    pass
                            elif len(keypoints_data) > 1:
                                opp_idx = 1 if player_idx == 0 else 0

                            # Update player tracking
                            if player_idx is not None and player_idx < len(keypoints_data):
                                last_player_kpts = keypoints_data[player_idx].cpu().numpy()
                                
                                # Update center for next frame
                                if player_center:
                                    left_hip = last_player_kpts[11]
                                    right_hip = last_player_kpts[12]
                                    left_shoulder = last_player_kpts[5]
                                    right_shoulder = last_player_kpts[6]
                                    player_center = {
                                        "x": float((left_hip[0] + right_hip[0] + left_shoulder[0] + right_shoulder[0]) / 4),
                                        "y": float((left_hip[1] + right_hip[1] + left_shoulder[1] + right_shoulder[1]) / 4)
                                    }

                            # Update opponent tracking
                            if opp_idx is not None and opp_idx < len(keypoints_data):
                                last_opponent_kpts = keypoints_data[opp_idx].cpu().numpy()
                                
                                # Update center for next frame
                                if opponent_center:
                                    left_hip = last_opponent_kpts[11]
                                    right_hip = last_opponent_kpts[12]
                                    left_shoulder = last_opponent_kpts[5]
                                    right_shoulder = last_opponent_kpts[6]
                                    opponent_center = {
                                        "x": float((left_hip[0] + right_hip[0] + left_shoulder[0] + right_shoulder[0]) / 4),
                                        "y": float((left_hip[1] + right_hip[1] + left_shoulder[1] + right_shoulder[1]) / 4)
                                    }
                            else:
                                last_opponent_kpts = None

                # Helper to draw a skeleton with a given color and label
                def _draw_skeleton(kpts, color, label):
                    if kpts is None:
                        return
                    # Draw skeleton connections
                    for connection in self.SKELETON:
                        i1, i2 = connection
                        k1, k2 = kpts[i1], kpts[i2]
                        if k1[2] > 0.5 and k2[2] > 0.5:
                            cv2.line(frame,
                                     (int(round(k1[0])), int(round(k1[1]))),
                                     (int(round(k2[0])), int(round(k2[1]))),
                                     color, 3)
                    # Draw keypoint circles
                    for kpt in kpts:
                        if kpt[2] > 0.5:
                            pt = (int(round(kpt[0])), int(round(kpt[1])))
                            cv2.circle(frame, pt, 5, color, -1)
                            cv2.circle(frame, pt, 5, BORDER_COLOR, 2)
                    
                    # Draw label above head (nose keypoint)
                    nose = kpts[0]  # Nose is keypoint 0 in COCO format
                    if nose[2] > 0.5:
                        label_x = int(round(nose[0]))
                        label_y = int(round(nose[1])) - 30
                        
                        # Background for text
                        font = cv2.FONT_HERSHEY_SIMPLEX
                        font_scale = 0.7
                        thickness = 2
                        (text_w, text_h), _ = cv2.getTextSize(label, font, font_scale, thickness)
                        
                        # Draw background rectangle
                        cv2.rectangle(frame, 
                                    (label_x - 5, label_y - text_h - 5),
                                    (label_x + text_w + 5, label_y + 5),
                                    color, -1)
                        
                        # Draw text
                        cv2.putText(frame, label, (label_x, label_y), 
                                  font, font_scale, (255, 255, 255), thickness)

                _draw_skeleton(last_player_kpts, PLAYER_COLOR, "Player")
                _draw_skeleton(last_opponent_kpts, OPPONENT_COLOR, "Opponent")

                out.write(frame)
                frame_idx += 1

                if frame_idx % 100 == 0:
                    progress = (frame_idx / total_frames) * 100
                    print(f"[PoseProcessor] Progress: {progress:.1f}%")

        finally:
            cap.release()
            out.release()

        print(f"[PoseProcessor] Generated pose overlay video: {output_path}")
        return output_path

    def _extract_keypoints(self, kpts: np.ndarray) -> Dict[str, Keypoint]:
        """Extract keypoints from pose output."""
        keypoints = {}

        for idx, name in enumerate(self.LANDMARK_NAMES):
            kpt = kpts[idx]
            keypoints[name] = Keypoint(
                x=float(kpt[0]),
                y=float(kpt[1]),
                z=0.0,  # Model doesn't provide z-coordinate
                visibility=float(kpt[2])  # confidence score
            )

        return keypoints

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
            print(f"[PoseProcessor] Warning: Missing keypoint for angle calculation: {e}")

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
            print(f"[PoseProcessor] Warning: Missing keypoint for body metrics: {e}")

        return metrics

    def pose_frame_to_dict(self, pose_frame: PoseFrame) -> Dict:
        """Convert PoseFrame to dictionary for JSON serialization."""
        return {
            'frame_number': pose_frame.frame_number,
            'timestamp': pose_frame.timestamp,
            'person_id': pose_frame.person_id,
            'keypoints': {k: asdict(v) for k, v in pose_frame.keypoints.items()},
            'joint_angles': pose_frame.joint_angles,
            'body_metrics': pose_frame.body_metrics
        }

    def __del__(self):
        """Cleanup resources."""
        pass  # Model handles cleanup automatically
