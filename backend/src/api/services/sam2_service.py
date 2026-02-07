"""
Ball Tracking Service - Runs GPU tracking via SSH.
Uses RemoteEngineRunner for GPU communication.

Tracking pipeline (automatic, no click needed):
  1. Upload: video uploaded → background task calls track_with_tracknet()
  2. GPU: model server runs tracking
  3. Result: trajectory stored in sessions.trajectory_data
"""

import os
import math
import logging
from typing import Optional, List, Dict, Any
from pydantic import BaseModel

from src.engines.remote_run import RemoteEngineRunner

logger = logging.getLogger(__name__)


class TrajectoryPoint(BaseModel):
    frame: int
    x: float
    y: float
    confidence: float
    bbox: Optional[List[int]] = None  # [x1, y1, x2, y2]


class TrajectoryData(BaseModel):
    frames: List[TrajectoryPoint]
    velocity: List[float]
    spin_estimate: Optional[str] = None


class BallTrackingService:
    """Service for automatic ball tracking via GPU."""
    
    def __init__(self):
        self._runner: Optional[RemoteEngineRunner] = None
    
    @property
    def runner(self) -> RemoteEngineRunner:
        if self._runner is None:
            self._runner = RemoteEngineRunner()
        return self._runner
    
    @property
    def is_available(self) -> bool:
        return bool(os.getenv("SSH_HOST"))
    
    async def health_check(self) -> dict:
        if not self.is_available:
            return {"status": "unavailable", "message": "SSH_HOST not configured"}
        try:
            running = self.runner.is_model_server_running()
            return {"status": "ok" if running else "server_not_running", "model_server": running}
        except Exception as e:
            return {"status": "error", "message": str(e)}
    
    def _ensure_video_on_gpu(self, session_id: str, video_url: str) -> str:
        """Download video to GPU if not already present. Returns remote path."""
        video_name = f"{session_id}.mp4"
        remote_video_dir = os.getenv("REMOTE_VIDEO_DIR", "/workspace/provision/data/videos")
        remote_video_path = f"{remote_video_dir}/{video_name}"
        
        try:
            from ..database.supabase import get_supabase
            supabase = get_supabase()
            storage_path = video_url.split("/provision-videos/")[-1].rstrip("?") if "/provision-videos/" in video_url else None
            if storage_path:
                signed = supabase.storage.from_("provision-videos").create_signed_url(storage_path, 3600)
                signed_url = signed.get("signedURL") or signed.get("signed_url") or signed.get("signedUrl")
                if signed_url:
                    self.runner.download_videos_from_supabase({video_name: signed_url}, remote_video_dir)
                    return remote_video_path
        except Exception as e:
            logger.warning(f"Signed URL download failed, falling back to direct: {e}")
        
        self._download_via_url(remote_video_path, video_url)
        return remote_video_path

    async def detect_poses(
        self,
        session_id: str,
        video_url: str,
        frame: int = 0,
    ) -> dict:
        """Detect all persons with bounding boxes and keypoints using a pose model on GPU."""
        if not self.is_available:
            raise Exception("GPU not configured")
        
        remote_video_path = self._ensure_video_on_gpu(session_id, video_url)
        
        result = self.runner._call_model_server("/yolo/pose", {
            "session_id": session_id,
            "video_path": remote_video_path,
            "init_point": {"x": 0, "y": 0},
            "frame": frame,
        })
        
        logger.info(f"YOLO-pose detected {len(result.get('persons', []))} persons")
        return result
    
    async def detect_poses_batch(
        self,
        session_id: str,
        video_url: str,
        frames: List[int],
    ) -> dict:
        """OPTIMIZED: Detect poses on multiple frames in a single GPU request.
        
        This is 10-20x faster than calling detect_poses() in a loop because:
        - Video opened once instead of N times
        - Single HTTP round-trip instead of N requests
        - GPU can batch-process frames
        
        Args:
            session_id: Session ID
            video_url: Video URL (will be downloaded to GPU if not present)
            frames: List of frame numbers to process
            
        Returns:
            dict with:
                - results: Dict[frame_num, {persons, timestamp}]
                - video_info: {width, height, fps}
                - frames_processed: int
        """
        if not self.is_available:
            raise Exception("GPU not configured")
        
        remote_video_path = self._ensure_video_on_gpu(session_id, video_url)
        
        result = self.runner._call_model_server("/yolo/pose/batch", {
            "session_id": session_id,
            "video_path": remote_video_path,
            "frames": frames,
        })
        
        frames_with_poses = sum(1 for r in result.get('results', {}).values() if r.get('persons'))
        logger.info(f"YOLO-pose batch: {frames_with_poses}/{len(frames)} frames had detections")
        return result

    async def detect_balls(
        self,
        session_id: str,
        video_url: str,
        frame: int = 0,
    ) -> dict:
        """Detect ball candidates using YOLO on GPU."""
        if not self.is_available:
            raise Exception("GPU not configured")

        remote_video_path = self._ensure_video_on_gpu(session_id, video_url)
        result = self.runner._call_model_server("/yolo/detect", {
            "session_id": session_id,
            "video_path": remote_video_path,
            "init_point": {"x": 0, "y": 0},
            "frame": frame,
        })

        logger.info(f"YOLO detected {len(result.get('detections', []))} candidates")
        return result

    async def track_with_tracknet(
        self,
        session_id: str,
        video_url: str,
        frame: int = 0,
    ):
        """Track ball through entire video automatically (no click needed)."""
        if not self.is_available:
            raise Exception("GPU not configured")
        
        remote_video_path = self._ensure_video_on_gpu(session_id, video_url)
        
        # Try TrackNet (primary tracker)
        try:
            result = self.runner._call_model_server("/tracknet/track", {
                "session_id": session_id,
                "video_path": remote_video_path,
                "init_point": {"x": 0, "y": 0},
                "frame": frame,
            })
            
            trajectory = result.get("trajectory") or []
            video_info = result.get("video_info") or {}
            
            if not trajectory:
                error_msg = result.get("error", "No trajectory returned")
                logger.warning(f"TrackNet returned empty trajectory: {error_msg}")
            else:
                logger.info(f"TrackNet tracking complete: {len(trajectory)} frames detected")
            
            return self._convert_result(trajectory), video_info
        except Exception as e:
            logger.error(f"TrackNet tracking failed: {e}")
            raise Exception(f"Ball tracking failed: {str(e)}")
    
    def _download_via_url(self, remote_path: str, url: str):
        with self.runner.ssh_session() as ssh:
            cmd = f'mkdir -p "$(dirname \'{remote_path}\')" && wget -q -O \'{remote_path}\' \'{url}\''
            exit_code, stdout, stderr = ssh.execute_command(cmd, timeout=120)
            if exit_code != 0:
                raise RuntimeError(f"Download failed: {stderr}")
    
    def _convert_result(self, trajectory: List[Dict]) -> TrajectoryData:
        frames = []
        for t in trajectory:
            frames.append(TrajectoryPoint(
                frame=t.get("frame", 0),
                x=float(t.get("x", 0)),
                y=float(t.get("y", 0)),
                confidence=float(t.get("confidence", 1.0)),
                bbox=t.get("bbox"),
            ))
        
        velocities = []
        for i in range(1, len(frames)):
            dx = frames[i].x - frames[i-1].x
            dy = frames[i].y - frames[i-1].y
            velocities.append(round(math.sqrt(dx*dx + dy*dy), 2))
        
        spin = self._estimate_spin(frames) if len(frames) > 10 else None
        
        return TrajectoryData(frames=frames, velocity=velocities, spin_estimate=spin)
    
    def _estimate_spin(self, frames: List[TrajectoryPoint]) -> Optional[str]:
        if len(frames) < 10:
            return None
        mid = len(frames) // 2
        first_dy = sum(frames[i+1].y - frames[i].y for i in range(mid)) / mid
        second_dy = sum(frames[i+1].y - frames[i].y for i in range(mid, len(frames)-1)) / (len(frames) - mid - 1)
        if second_dy > first_dy + 1:
            return "topspin"
        elif first_dy > second_dy + 1:
            return "backspin"
        return "flat"


# Keep backward-compatible name for imports
sam2_service = BallTrackingService()
