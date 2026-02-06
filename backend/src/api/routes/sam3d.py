"""
SAM3D API routes for 3D point cloud segmentation.
"""

from typing import Optional, List
from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends
from pydantic import BaseModel, Field

from src.api.services.sam3d_service import get_sam3d_service, SAM3DService
from src.api.database.supabase import get_current_user_id

router = APIRouter(prefix="/api/sam3d", tags=["sam3d"])


# ============================================================================
# Request/Response Models
# ============================================================================

class SegmentRequest(BaseModel):
    """Request model for SAM3D segmentation."""
    session_id: str = Field(..., description="Session identifier")
    object_id: str = Field(..., description="Tracked object identifier")
    video_path: Optional[str] = Field(None, description="Video path (uses session video if not provided)")
    masks_dir: Optional[str] = Field(None, description="SAM2 masks directory (generates if not provided)")
    start_frame: int = Field(0, ge=0, description="Starting frame")
    end_frame: Optional[int] = Field(None, ge=0, description="Ending frame (None for all)")


class SegmentResponse(BaseModel):
    """Response model for SAM3D segmentation request."""
    status: str
    job_id: str
    message: str


class JobStatusResponse(BaseModel):
    """Response model for job status."""
    job_id: str
    session_id: str
    object_id: str
    status: str
    created_at: str
    completed_at: Optional[str] = None
    result: Optional[dict] = None
    error: Optional[str] = None


class ResultResponse(BaseModel):
    """Response model for SAM3D result."""
    session_id: str
    object_id: str
    point_cloud_url: Optional[str] = None
    metadata: Optional[dict] = None
    status: str


class JobListResponse(BaseModel):
    """Response model for job list."""
    jobs: List[JobStatusResponse]
    total: int


# ============================================================================
# API Routes
# ============================================================================

@router.post("/segment", response_model=SegmentResponse)
async def segment_3d(
    request: SegmentRequest,
    user_id: str = Depends(get_current_user_id)
):
    """
    Start SAM3D 3D segmentation job.
    
    This creates a background job that:
    1. Uses SAM2 masks from object tracking
    2. Estimates depth using MiDaS
    3. Projects 2D masks to 3D point clouds
    4. Merges point clouds using SAM3D bidirectional merging
    5. Returns a 3D point cloud (PLY format)
    
    Poll /status/{job_id} for progress.
    """
    sam3d_service = get_sam3d_service()
    
    try:
        job_id = await sam3d_service.segment_video_to_3d(
            session_id=request.session_id,
            object_id=request.object_id,
            video_path=request.video_path or "",
            masks_dir=request.masks_dir,
            start_frame=request.start_frame,
            end_frame=request.end_frame
        )
        
        return SegmentResponse(
            status="processing",
            job_id=job_id,
            message="SAM3D segmentation job started. Poll /status/{job_id} for progress."
        )
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to start SAM3D job: {str(e)}")


@router.get("/status/{job_id}", response_model=JobStatusResponse)
async def get_job_status(
    job_id: str,
    user_id: str = Depends(get_current_user_id)
):
    """
    Get SAM3D job status.
    
    Status values:
    - pending: Job created but not started
    - processing: Job is running on GPU
    - completed: Job finished successfully
    - failed: Job encountered an error
    - cancelled: Job was cancelled
    """
    sam3d_service = get_sam3d_service()
    job = sam3d_service.get_job(job_id)
    
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    
    return JobStatusResponse(**job.to_dict())


@router.get("/result/{session_id}/{object_id}", response_model=ResultResponse)
async def get_result(
    session_id: str,
    object_id: str,
    user_id: str = Depends(get_current_user_id)
):
    """
    Get SAM3D result for a session and object.
    
    Returns the point cloud URL and metadata if processing is complete.
    """
    sam3d_service = get_sam3d_service()
    result = await sam3d_service.get_result(session_id, object_id)
    
    if result is None:
        return ResultResponse(
            session_id=session_id,
            object_id=object_id,
            status="not_found"
        )
    
    return ResultResponse(
        session_id=session_id,
        object_id=object_id,
        point_cloud_url=result.get("point_cloud_path"),
        metadata=result.get("metadata"),
        status="completed"
    )


@router.get("/jobs", response_model=JobListResponse)
async def list_jobs(
    session_id: Optional[str] = None,
    user_id: str = Depends(get_current_user_id)
):
    """
    List SAM3D jobs, optionally filtered by session.
    """
    sam3d_service = get_sam3d_service()
    jobs = sam3d_service.list_jobs(session_id)
    
    return JobListResponse(
        jobs=[JobStatusResponse(**j.to_dict()) for j in jobs],
        total=len(jobs)
    )


@router.post("/cancel/{job_id}")
async def cancel_job(
    job_id: str,
    user_id: str = Depends(get_current_user_id)
):
    """
    Cancel a running SAM3D job.
    """
    sam3d_service = get_sam3d_service()
    success = await sam3d_service.cancel_job(job_id)
    
    if not success:
        raise HTTPException(
            status_code=400,
            detail="Job not found or already completed"
        )
    
    return {"status": "cancelled", "job_id": job_id}
