from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..database.supabase import get_supabase, get_current_user_id
from ..services.sam2_service import sam2_service

router = APIRouter()


class DetectRequest(BaseModel):
    session_id: str
    frame: int = 0


class TrajectoryPoint(BaseModel):
    frame: int
    x: float
    y: float
    confidence: float


class TrajectoryResponse(BaseModel):
    session_id: str
    frames: list[TrajectoryPoint]
    velocity: list[float]
    spin_estimate: Optional[str] = None


@router.get("/health")
async def sam2_health():
    """Check tracking service health."""
    return await sam2_service.health_check()


@router.post("/tracknet")
async def track_with_tracknet(
    request: DetectRequest,
    user_id: str = Depends(get_current_user_id),
):
    """Track ball through entire video (no click needed)."""
    supabase = get_supabase()
    
    result = supabase.table("sessions").select("*").eq("id", request.session_id).eq("user_id", user_id).single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Session not found")
    
    session = result.data
    video_path = session.get("video_path")
    if not video_path:
        raise HTTPException(status_code=400, detail="Session has no video")
    
    try:
        trajectory_data, video_info = await sam2_service.track_with_tracknet(
            session_id=request.session_id,
            video_url=video_path,
            frame=request.frame,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ball tracking failed: {str(e)}")
    
    trajectory_dict = {
        "frames": [f.model_dump() for f in trajectory_data.frames],
        "velocity": trajectory_data.velocity,
        "spin_estimate": trajectory_data.spin_estimate,
        "video_info": video_info,
    }
    
    supabase.table("sessions").update({
        "trajectory_data": trajectory_dict,
    }).eq("id", request.session_id).execute()
    
    return {
        "status": "tracked",
        "session_id": request.session_id,
        "frames_tracked": len(trajectory_data.frames),
        "trajectory": trajectory_dict,
    }


@router.post("/pose-detect")
async def pose_detect(
    request: DetectRequest,
    user_id: str = Depends(get_current_user_id),
):
    """Detect all persons with bounding boxes and keypoints."""
    supabase = get_supabase()
    
    result = supabase.table("sessions").select("*").eq("id", request.session_id).eq("user_id", user_id).single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Session not found")
    
    video_path = result.data.get("video_path")
    if not video_path:
        raise HTTPException(status_code=400, detail="Session has no video")
    
    try:
        poses = await sam2_service.detect_poses(
            session_id=request.session_id,
            video_url=video_path,
            frame=request.frame,
        )
        return poses
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Pose detection failed: {str(e)}")


@router.post("/detect")
async def ball_detect(
    request: DetectRequest,
    user_id: str = Depends(get_current_user_id),
):
    """Detect ball candidates in a single frame using YOLO."""
    supabase = get_supabase()

    result = supabase.table("sessions").select("*").eq("id", request.session_id).eq("user_id", user_id).single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Session not found")

    video_path = result.data.get("video_path")
    if not video_path:
        raise HTTPException(status_code=400, detail="Session has no video")

    try:
        detections = await sam2_service.detect_balls(
            session_id=request.session_id,
            video_url=video_path,
            frame=request.frame,
        )
        return detections
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ball detection failed: {str(e)}")


@router.get("/trajectory/{session_id}", response_model=TrajectoryResponse)
async def get_trajectory(
    session_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """Get ball trajectory data for a session."""
    supabase = get_supabase()
    
    result = supabase.table("sessions").select("*").eq("id", session_id).eq("user_id", user_id).single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Session not found")
    
    trajectory_data = result.data.get("trajectory_data")
    if not trajectory_data:
        raise HTTPException(status_code=404, detail="No trajectory data found")
    
    return TrajectoryResponse(
        session_id=session_id,
        frames=[TrajectoryPoint(**f) for f in trajectory_data.get("frames", [])],
        velocity=trajectory_data.get("velocity", []),
        spin_estimate=trajectory_data.get("spin_estimate"),
    )
