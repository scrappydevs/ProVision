"""
Video generation service for exocentric to egocentric conversion.

Requirements:
- A100 80GB GPU
- CUDA 12.1+
- Pre-processed depth maps
- Camera parameters

For demo: Use pre-rendered videos.
"""

import os
import asyncio
from typing import Optional
from pydantic import BaseModel
from enum import Enum


class EgoXStatus(str, Enum):
    PENDING = "pending"
    PREPROCESSING = "preprocessing"
    GENERATING = "generating"
    COMPLETED = "completed"
    FAILED = "failed"


class EgoXJob(BaseModel):
    job_id: str
    session_id: str
    status: EgoXStatus
    progress: float = 0.0
    message: str = ""
    ego_video_url: Optional[str] = None


class EgoXService:
    """Service for egocentric video generation via GPU."""
    
    def __init__(self):
        self.runpod_host = os.getenv("RUNPOD_EGOX_HOST", "")
        self.runpod_port = os.getenv("RUNPOD_EGOX_PORT", "8081")
        
        # In-memory job tracking (use Redis in production)
        self._jobs: dict[str, EgoXJob] = {}
        
        # Pre-rendered demo videos
        self.demo_videos = {
            "pingpong_demo_1": "https://example.com/demo/ego_pingpong_1.mp4",
            "pingpong_demo_2": "https://example.com/demo/ego_pingpong_2.mp4",
        }
    
    @property
    def is_available(self) -> bool:
        return bool(self.runpod_host)
    
    async def start_generation(
        self,
        session_id: str,
        video_path: str,
        use_demo: bool = True,
    ) -> EgoXJob:
        """Start generation job."""
        import uuid
        job_id = str(uuid.uuid4())
        
        job = EgoXJob(
            job_id=job_id,
            session_id=session_id,
            status=EgoXStatus.PENDING,
            message="Job queued",
        )
        
        self._jobs[job_id] = job
        
        if use_demo or not self.is_available:
            # Use pre-rendered demo
            asyncio.create_task(self._simulate_generation(job_id))
        else:
            # Real generation (requires GPU setup)
            asyncio.create_task(self._run_egox_generation(job_id, video_path))
        
        return job
    
    async def _simulate_generation(self, job_id: str):
        """Simulate generation with progress updates."""
        job = self._jobs.get(job_id)
        if not job:
            return
        
        # Preprocessing phase
        job.status = EgoXStatus.PREPROCESSING
        job.message = "Extracting depth maps..."
        job.progress = 0.1
        await asyncio.sleep(2)
        
        job.message = "Estimating camera parameters..."
        job.progress = 0.2
        await asyncio.sleep(1)
        
        job.message = "Generating ego camera trajectory..."
        job.progress = 0.3
        await asyncio.sleep(1)
        
        # Generation phase
        job.status = EgoXStatus.GENERATING
        job.message = "Running model..."
        
        for i in range(7):
            job.progress = 0.3 + (i * 0.1)
            job.message = f"Generating frames... {int(job.progress * 100)}%"
            await asyncio.sleep(1)
        
        # Complete
        job.status = EgoXStatus.COMPLETED
        job.progress = 1.0
        job.message = "Generation complete"
        job.ego_video_url = self.demo_videos.get("pingpong_demo_1", "")
    
    async def _run_egox_generation(self, job_id: str, video_path: str):
        """Run actual generation on GPU."""
        # TODO: Implement real generation pipeline
        # 1. Download video from Supabase
        # 2. Run MiDaS depth estimation
        # 3. Estimate camera parameters
        # 4. Run model inference
        # 5. Upload result to Supabase
        
        # For now, fall back to simulation
        await self._simulate_generation(job_id)
    
    def get_job_status(self, job_id: str) -> Optional[EgoXJob]:
        """Get status of a job."""
        return self._jobs.get(job_id)
    
    def get_session_jobs(self, session_id: str) -> list[EgoXJob]:
        """Get all jobs for a session."""
        return [job for job in self._jobs.values() if job.session_id == session_id]


# Singleton instance
egox_service = EgoXService()
