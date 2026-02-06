from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..database.supabase import get_supabase, get_current_user_id

router = APIRouter()


class GenerateRequest(BaseModel):
    session_id: str


class StatusResponse(BaseModel):
    session_id: str
    status: str
    progress: float
    message: str


class ResultResponse(BaseModel):
    session_id: str
    ego_video_url: str
    status: str


@router.post("/generate")
async def generate_ego_video(
    request: GenerateRequest,
    user_id: str = Depends(get_current_user_id),
):
    """Start EgoX ego video generation."""
    supabase = get_supabase()
    
    result = supabase.table("sessions").select("*").eq("id", request.session_id).eq("user_id", user_id).single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Session not found")
    
    # TODO: Start EgoX generation on RunPod
    # 1. Download video from Supabase Storage
    # 2. Run preprocessing (depth maps, camera params)
    # 3. Run EgoX inference
    # 4. Upload generated ego video to Storage
    # 5. Update session with ego_video_path
    
    supabase.table("sessions").update({"status": "processing"}).eq("id", request.session_id).execute()
    
    return {
        "status": "started",
        "session_id": request.session_id,
        "message": "EgoX generation started",
    }


@router.get("/status/{session_id}", response_model=StatusResponse)
async def get_ego_status(
    session_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """Check EgoX generation status."""
    supabase = get_supabase()
    
    result = supabase.table("sessions").select("*").eq("id", session_id).eq("user_id", user_id).single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Session not found")
    
    session = result.data
    
    # TODO: Check actual RunPod job status
    progress = 0.0
    message = "Waiting to start"
    
    if session["status"] == "processing":
        progress = 0.5
        message = "Processing with EgoX..."
    elif session["status"] == "completed":
        progress = 1.0
        message = "Generation complete"
    elif session["status"] == "failed":
        message = "Generation failed"
    
    return StatusResponse(
        session_id=session_id,
        status=session["status"],
        progress=progress,
        message=message,
    )


@router.get("/result/{session_id}", response_model=ResultResponse)
async def get_ego_result(
    session_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """Get generated ego video URL."""
    supabase = get_supabase()
    
    result = supabase.table("sessions").select("*").eq("id", session_id).eq("user_id", user_id).single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Session not found")
    
    session = result.data
    
    if not session.get("ego_video_path"):
        raise HTTPException(status_code=404, detail="Ego video not yet generated")
    
    return ResultResponse(
        session_id=session_id,
        ego_video_url=session["ego_video_path"],
        status=session["status"],
    )
