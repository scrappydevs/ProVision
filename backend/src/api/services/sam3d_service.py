"""
SAM3D Service for 3D point cloud segmentation.

Pipeline:
1. Get SAM2 masks for tracked object
2. Estimate depth using MiDaS
3. Project 2D masks to 3D point clouds
4. Merge point clouds using SAM3D bidirectional merging
5. Upload result to Supabase and return URL
"""

import os
import uuid
import asyncio
import logging
from typing import Dict, Any, Optional, List
from datetime import datetime

from src.engines.remote_run import RemoteEngineRunner, RemoteEngineConfig

logger = logging.getLogger(__name__)


class SAM3DJob:
    """Represents a SAM3D processing job."""
    
    def __init__(
        self,
        job_id: str,
        session_id: str,
        object_id: str,
        status: str = "pending"
    ):
        self.job_id = job_id
        self.session_id = session_id
        self.object_id = object_id
        self.status = status
        self.created_at = datetime.now()
        self.completed_at: Optional[datetime] = None
        self.result: Optional[Dict[str, Any]] = None
        self.error: Optional[str] = None
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "job_id": self.job_id,
            "session_id": self.session_id,
            "object_id": self.object_id,
            "status": self.status,
            "created_at": self.created_at.isoformat(),
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "result": self.result,
            "error": self.error
        }


class SAM3DService:
    """Service for SAM3D 3D point cloud segmentation."""
    
    def __init__(self, remote_runner: Optional[RemoteEngineRunner] = None):
        """
        Initialize SAM3D service.
        
        Args:
            remote_runner: Remote engine runner for GPU execution.
                          If None, creates one with default config.
        """
        self.remote_runner = remote_runner or RemoteEngineRunner()
        self.jobs: Dict[str, SAM3DJob] = {}
        self._mock_mode = os.getenv("SAM3D_MOCK_MODE", "false").lower() == "true"
    
    def get_job(self, job_id: str) -> Optional[SAM3DJob]:
        """Get a job by ID."""
        return self.jobs.get(job_id)
    
    def list_jobs(self, session_id: Optional[str] = None) -> List[SAM3DJob]:
        """List all jobs, optionally filtered by session."""
        jobs = list(self.jobs.values())
        if session_id:
            jobs = [j for j in jobs if j.session_id == session_id]
        return sorted(jobs, key=lambda j: j.created_at, reverse=True)
    
    async def segment_video_to_3d(
        self,
        session_id: str,
        object_id: str,
        video_path: str,
        masks_dir: Optional[str] = None,
        start_frame: int = 0,
        end_frame: Optional[int] = None
    ) -> str:
        """
        Start SAM3D 3D segmentation job.
        
        Args:
            session_id: Session identifier
            object_id: Tracked object identifier
            video_path: Path to video (can be Supabase URL or remote path)
            masks_dir: Directory containing SAM2 masks (optional, will generate if not provided)
            start_frame: Starting frame for processing
            end_frame: Ending frame (None for all frames)
        
        Returns:
            Job ID for tracking progress
        """
        job_id = str(uuid.uuid4())
        job = SAM3DJob(job_id, session_id, object_id, status="processing")
        self.jobs[job_id] = job
        
        # Start processing in background
        asyncio.create_task(
            self._process_segmentation(
                job=job,
                video_path=video_path,
                masks_dir=masks_dir,
                start_frame=start_frame,
                end_frame=end_frame
            )
        )
        
        return job_id
    
    async def _process_segmentation(
        self,
        job: SAM3DJob,
        video_path: str,
        masks_dir: Optional[str],
        start_frame: int,
        end_frame: Optional[int]
    ):
        """Internal method to process SAM3D segmentation."""
        try:
            logger.info(f"Starting SAM3D job {job.job_id} for session {job.session_id}")
            
            if self._mock_mode:
                # Mock mode for development/testing
                result = await self._mock_segmentation(job, start_frame, end_frame)
            else:
                # Real processing via RunPod
                config = self.remote_runner.config
                
                # Determine masks directory
                if masks_dir is None:
                    masks_dir = f"{config.REMOTE_RESULTS_DIR}/{job.session_id}/sam2"
                
                # Run SAM3D on GPU server
                result = await self.remote_runner.run_sam3d_segmentation(
                    session_id=job.session_id,
                    object_id=job.object_id,
                    video_path=video_path,
                    masks_dir=masks_dir,
                    start_frame=start_frame,
                    end_frame=end_frame
                )
            
            job.status = "completed"
            job.completed_at = datetime.now()
            job.result = result
            
            logger.info(f"SAM3D job {job.job_id} completed successfully")
        
        except Exception as e:
            logger.error(f"SAM3D job {job.job_id} failed: {e}")
            job.status = "failed"
            job.completed_at = datetime.now()
            job.error = str(e)
    
    async def _mock_segmentation(
        self,
        job: SAM3DJob,
        start_frame: int,
        end_frame: Optional[int]
    ) -> Dict[str, Any]:
        """Generate mock SAM3D results for development."""
        import random
        
        # Simulate processing time
        await asyncio.sleep(2)
        
        # Generate mock point cloud data
        num_frames = (end_frame or 100) - start_frame
        num_points = random.randint(5000, 15000)
        
        # Generate some mock statistics
        return {
            "status": "completed",
            "session_id": job.session_id,
            "object_id": job.object_id,
            "point_cloud_path": f"/results/{job.session_id}/sam3d/{job.object_id}/point_cloud.ply",
            "metadata": {
                "total_points": num_points,
                "frames_processed": num_frames,
                "start_frame": start_frame,
                "end_frame": end_frame,
                "bounding_box": {
                    "min": [-1.5, -1.0, 0.5],
                    "max": [1.5, 1.0, 3.0]
                },
                "centroid": [0.0, 0.0, 1.5]
            }
        }
    
    async def get_result(self, session_id: str, object_id: str) -> Optional[Dict[str, Any]]:
        """
        Get SAM3D result for a session and object.
        
        Args:
            session_id: Session identifier
            object_id: Object identifier
        
        Returns:
            Result data if available, None otherwise
        """
        # Find completed job for this session/object
        for job in self.jobs.values():
            if (job.session_id == session_id and 
                job.object_id == object_id and 
                job.status == "completed"):
                return job.result
        
        return None
    
    async def cancel_job(self, job_id: str) -> bool:
        """
        Cancel a running job.
        
        Args:
            job_id: Job identifier
        
        Returns:
            True if cancelled, False if not found or already complete
        """
        job = self.jobs.get(job_id)
        if job is None:
            return False
        
        if job.status == "processing":
            job.status = "cancelled"
            job.completed_at = datetime.now()
            return True
        
        return False


# Global service instance
_sam3d_service: Optional[SAM3DService] = None


def get_sam3d_service() -> SAM3DService:
    """Get or create the global SAM3D service instance."""
    global _sam3d_service
    if _sam3d_service is None:
        _sam3d_service = SAM3DService()
    return _sam3d_service
