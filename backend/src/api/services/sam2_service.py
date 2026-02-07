"""
SAM2 Service - Runs SAM2 tracking on RunPod GPU via SSH.
Uses RemoteEngineRunner for GPU communication (like DeepGaitLab pattern).
"""

import asyncio
import math
import os
import logging
from typing import Optional, List, Dict, Any

from cachetools import TTLCache
from pydantic import BaseModel

from src.engines.remote_run import RemoteEngineRunner

logger = logging.getLogger(__name__)

# Cache remote video paths to avoid re-downloading same session within 10 min
_VIDEO_PATH_CACHE: TTLCache[str, str] = TTLCache(maxsize=64, ttl=600)


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


class SAM2Service:
    """Service for SAM2 ball/object tracking via RunPod GPU."""
    
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
        """Download video to GPU if not already present. Returns remote path. Uses cache to skip re-downloads."""
        cache_key = f"{session_id}:{video_url}"
        if cache_key in _VIDEO_PATH_CACHE:
            return _VIDEO_PATH_CACHE[cache_key]

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
                    _VIDEO_PATH_CACHE[cache_key] = remote_video_path
                    return remote_video_path
        except Exception as e:
            logger.warning("Signed URL download failed, falling back to direct: %s", e)

        self._download_via_url(remote_video_path, video_url)
        _VIDEO_PATH_CACHE[cache_key] = remote_video_path
        return remote_video_path

    async def detect_balls(
        self,
        session_id: str,
        video_url: str,
        frame: int = 0,
    ) -> dict:
        """Auto-detect sports balls using YOLO on GPU."""
        if not self.is_available:
            raise Exception("GPU not configured")

        remote_video_path = self._ensure_video_on_gpu(session_id, video_url)
        payload = {"session_id": session_id, "video_path": remote_video_path, "init_point": {"x": 0, "y": 0}, "frame": frame}
        result = await asyncio.to_thread(self.runner._call_model_server, "/yolo/detect", payload)

        logger.info("YOLO detected %d balls", len(result.get("detections", [])))
        return result

    async def detect_poses(
        self,
        session_id: str,
        video_url: str,
        frame: int = 0,
    ) -> dict:
        """Detect all persons with bounding boxes and keypoints using YOLO-pose on GPU."""
        if not self.is_available:
            raise Exception("GPU not configured")

        remote_video_path = self._ensure_video_on_gpu(session_id, video_url)
        payload = {"session_id": session_id, "video_path": remote_video_path, "init_point": {"x": 0, "y": 0}, "frame": frame}
        result = await asyncio.to_thread(self.runner._call_model_server, "/yolo/pose", payload)

        logger.info("YOLO-pose detected %d persons", len(result.get("persons", [])))
        return result

    async def track_with_tracknet(
        self,
        session_id: str,
        video_url: str,
        frame: int = 0,
    ):
        """Track ball through entire video using TrackNet (temporal heatmaps)."""
        if not self.is_available:
            raise Exception("GPU not configured")

        remote_video_path = self._ensure_video_on_gpu(session_id, video_url)
        payload = {"session_id": session_id, "video_path": remote_video_path, "init_point": {"x": 0, "y": 0}, "frame": frame}
        result = await asyncio.to_thread(self.runner._call_model_server, "/tracknet/track", payload)

        trajectory = result.get("trajectory", [])
        video_info = result.get("video_info", {})
        logger.info("TrackNet tracking complete: %d frames detected", len(trajectory))
        return self._convert_result(trajectory), video_info

    async def preview_segmentation(
        self,
        session_id: str,
        video_url: str,
        x: float,
        y: float,
        frame: int = 0,
    ) -> dict:
        """Preview segmentation at click point before full tracking."""
        if not self.is_available:
            raise Exception("GPU not configured")

        remote_video_path = self._ensure_video_on_gpu(session_id, video_url)
        payload = {"session_id": session_id, "video_path": remote_video_path, "init_point": {"x": x, "y": y}, "frame": frame}
        return await asyncio.to_thread(self.runner._call_model_server, "/sam2/preview", payload)

    async def init_and_track(
        self,
        session_id: str,
        video_url: str,
        x: float,
        y: float,
        frame: int = 0,
        detection_box: Optional[List[float]] = None,
    ) -> TrajectoryData:
        """
        Full GPU tracking pipeline:
        1. Download video to GPU from Supabase URL
        2. Run SAM2 tracking on GPU via model server
        3. Return trajectory
        """
        if not self.is_available:
            raise Exception("GPU not configured. Set SSH_HOST in .env")
        
        logger.info("SAM2 tracking: session=%s, click=(%s,%s), frame=%s", session_id, x, y, frame)
        
        remote_video_path = self._ensure_video_on_gpu(session_id, video_url)
        
        # Run SAM2 on GPU
        try:
            result = await self.runner.run_sam2_tracking(
                session_id=session_id,
                video_path=remote_video_path,
                init_point={"x": x, "y": y},
                frame=frame,
                detection_box=detection_box,
            )
            
            trajectory = result.get("trajectory", [])
            video_info = result.get("video_info", {})
            logger.info("SAM2 tracking complete: %d frames", len(trajectory))
            return self._convert_result(trajectory), video_info
            
        except Exception as e:
            logger.error(f"SAM2 GPU tracking failed: {e}")
            raise Exception(f"SAM2 tracking failed: {str(e)}")
    
    def _download_via_url(self, remote_path: str, url: str):
        with self.runner.ssh_session() as ssh:
            cmd = f'mkdir -p "$(dirname \'{remote_path}\')" && wget -q -O \'{remote_path}\' \'{url}\''
            exit_code, stdout, stderr = ssh.execute_command(cmd, timeout=120)
            if exit_code != 0:
                raise RuntimeError(f"Download failed: {stderr}")
    
    def _convert_result(self, trajectory: List[Dict]) -> TrajectoryData:
        frames = [
            TrajectoryPoint(
                frame=t.get("frame", 0),
                x=float(t.get("x", 0)),
                y=float(t.get("y", 0)),
                confidence=float(t.get("confidence", 1.0)),
                bbox=t.get("bbox"),
            )
            for t in trajectory
        ]

        velocities = [
            round(math.sqrt((frames[i].x - frames[i - 1].x) ** 2 + (frames[i].y - frames[i - 1].y) ** 2), 2)
            for i in range(1, len(frames))
        ]

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


sam2_service = SAM2Service()
