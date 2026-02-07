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
import threading
from time import perf_counter
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
        self._video_locks: Dict[str, threading.Lock] = {}
        self._video_locks_guard = threading.Lock()
    
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
        """Download video to GPU if not already present. Returns remote path.
        
        Optimised: uses a single SSH command to check cache AND download in one
        round-trip, and prefers the public Supabase URL (fast CDN) over signed
        URLs which are much slower (~0.6s vs ~68s for the same 34MB file).
        """
        video_name = f"{session_id}.mp4"
        remote_video_dir = os.getenv("REMOTE_VIDEO_DIR", "/workspace/provision/data/videos")
        remote_video_path = f"{remote_video_dir}/{video_name}"

        lock = self._get_video_lock(session_id)
        with lock:
            ensure_start = perf_counter()

            # Resolve a fast public URL (CDN) instead of a slow signed URL.
            # The bucket is already public so signed URLs are unnecessary.
            download_url = self._resolve_public_url(video_url)

            # Single SSH round-trip: check cache → download if missing
            result = self._check_and_download(remote_video_path, download_url)
            elapsed = perf_counter() - ensure_start

            if result == "CACHED":
                logger.info(
                    f"[GPUVideoCache] Reusing cached video for session={session_id} "
                    f"check_ms={elapsed * 1000:.1f}"
                )
            else:
                logger.info(
                    f"[GPUVideoCache] Downloaded session={session_id} via public URL in "
                    f"{elapsed:.2f}s"
                )

            return remote_video_path

    def _resolve_public_url(self, video_url: str) -> str:
        """Convert any Supabase video URL to a fast public URL.
        
        Public URLs go through the CDN and are ~100x faster than signed URLs
        for downloads from RunPod GPU servers.
        """
        # If it's already a public URL, strip trailing ? and return
        if "/object/public/" in video_url:
            return video_url.split("?")[0]

        # Convert signed URL or storage path to public URL
        if "/provision-videos/" in video_url:
            storage_path = video_url.split("/provision-videos/")[-1].split("?")[0]
            from ..database.supabase import get_supabase
            supabase = get_supabase()
            return supabase.storage.from_("provision-videos").get_public_url(storage_path)

        # Fallback: use as-is
        return video_url

    def _check_and_download(self, remote_path: str, download_url: str) -> str:
        """Single SSH round-trip: check if video is cached, download if not.
        
        Returns 'CACHED' or 'DOWNLOADED'.
        """
        escaped_url = download_url.replace("'", "'\\''")
        cmd = (
            f"test -s '{remote_path}' && echo 'CACHED' || "
            f"(mkdir -p \"$(dirname '{remote_path}')\" && "
            f"wget -q -O '{remote_path}' '{escaped_url}' && echo 'DOWNLOADED')"
        )
        with self.runner.ssh_session() as ssh:
            exit_code, stdout, stderr = ssh.execute_command(cmd, timeout=120)
            result = stdout.strip().split("\n")[-1] if stdout else ""
            if result not in ("CACHED", "DOWNLOADED"):
                logger.warning(
                    f"[GPUVideoCache] Unexpected result: exit={exit_code} "
                    f"stdout={stdout!r} stderr={stderr!r}"
                )
                # If wget failed, raise so caller can handle
                if exit_code != 0:
                    raise RuntimeError(f"GPU video download failed: {stderr}")
            return result

    def _get_video_lock(self, session_id: str) -> threading.Lock:
        with self._video_locks_guard:
            lock = self._video_locks.get(session_id)
            if lock is None:
                lock = threading.Lock()
                self._video_locks[session_id] = lock
            return lock

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
        pipeline_start = perf_counter()
        
        if not self.is_available:
            raise Exception("GPU not configured")
        
        # Step 1: Ensure video is on GPU (download if needed)
        video_prep_start = perf_counter()
        remote_video_path = self._ensure_video_on_gpu(session_id, video_url)
        video_prep_time = perf_counter() - video_prep_start
        logger.info(f"[TrackNet] Video preparation: {video_prep_time:.2f}s")
        
        # Step 2: Run TrackNet inference on GPU
        try:
            inference_start = perf_counter()
            result = self.runner._call_model_server("/tracknet/track", {
                "session_id": session_id,
                "video_path": remote_video_path,
                "init_point": {"x": 0, "y": 0},
                "frame": frame,
            })
            inference_time = perf_counter() - inference_start
            
            # Step 3: Extract and process results
            processing_start = perf_counter()
            trajectory = result.get("trajectory") or []
            video_info = result.get("video_info") or {}
            processing_time = perf_counter() - processing_start
            
            total_time = perf_counter() - pipeline_start
            
            if not trajectory:
                error_msg = result.get("error", "No trajectory returned")
                logger.warning(f"TrackNet returned empty trajectory: {error_msg}")
            else:
                logger.info(
                    f"[TrackNet] Complete: {len(trajectory)} frames | "
                    f"Total: {total_time:.2f}s (prep: {video_prep_time:.2f}s, "
                    f"inference: {inference_time:.2f}s, processing: {processing_time:.3f}s)"
                )
            
            return self._convert_result(trajectory), video_info
        except Exception as e:
            logger.error(f"TrackNet tracking failed after {perf_counter() - pipeline_start:.2f}s: {e}")
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
