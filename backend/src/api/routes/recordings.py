import uuid
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from datetime import datetime

from ..database.supabase import get_supabase, get_current_user_id

router = APIRouter()


class RecordingResponse(BaseModel):
    id: str
    session_id: Optional[str] = None
    player_id: str
    coach_id: str
    title: str
    description: Optional[str] = None
    video_path: Optional[str] = None
    thumbnail_path: Optional[str] = None
    type: str
    source_recording_id: Optional[str] = None
    clip_start_time: Optional[float] = None
    clip_end_time: Optional[float] = None
    duration: Optional[float] = None
    metadata: Optional[dict] = None
    created_at: str
    updated_at: Optional[str] = None


class RecordingCreate(BaseModel):
    player_id: str
    title: str
    description: Optional[str] = None
    type: str
    source_recording_id: Optional[str] = None
    clip_start_time: Optional[float] = None
    clip_end_time: Optional[float] = None
    duration: Optional[float] = None
    metadata: Optional[dict] = None


class RecordingUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    metadata: Optional[dict] = None


VALID_TYPES = {"match", "informal", "clip", "highlight"}


@router.post("", response_model=RecordingResponse)
async def create_recording(
    title: str = Form(...),
    player_id: str = Form(...),
    type: str = Form(...),
    description: Optional[str] = Form(None),
    source_recording_id: Optional[str] = Form(None),
    clip_start_time: Optional[float] = Form(None),
    clip_end_time: Optional[float] = Form(None),
    duration: Optional[float] = Form(None),
    metadata: Optional[str] = Form(None),
    video: Optional[UploadFile] = File(None),
    user_id: str = Depends(get_current_user_id),
):
    if type not in VALID_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid recording type. Must be one of: {', '.join(VALID_TYPES)}")

    supabase = get_supabase()

    # Verify player belongs to user
    try:
        player = supabase.table("players").select("id").eq("id", player_id).eq("coach_id", user_id).single().execute()
        if not player.data:
            raise HTTPException(status_code=404, detail="Player not found")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to verify player: {str(e)}")

    recording_id = str(uuid.uuid4())
    video_path = None

    # Upload video if provided
    if video:
        import os
        ext = os.path.splitext(video.filename or "video.mp4")[1]
        storage_path = f"{user_id}/recordings/{recording_id}{ext}"
        video_content = await video.read()
        try:
            supabase.storage.from_("provision-videos").upload(storage_path, video_content)
            video_path = supabase.storage.from_("provision-videos").get_public_url(storage_path)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to upload video: {str(e)}")

    import json
    parsed_metadata = {}
    if metadata:
        try:
            parsed_metadata = json.loads(metadata)
        except json.JSONDecodeError:
            parsed_metadata = {}

    recording_data = {
        "id": recording_id,
        "player_id": player_id,
        "coach_id": user_id,
        "title": title,
        "description": description,
        "video_path": video_path,
        "type": type,
        "source_recording_id": source_recording_id,
        "clip_start_time": clip_start_time,
        "clip_end_time": clip_end_time,
        "duration": duration,
        "metadata": parsed_metadata,
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat(),
    }

    try:
        result = supabase.table("recordings").insert(recording_data).execute()
        return RecordingResponse(**result.data[0])
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create recording: {str(e)}")


@router.get("/player/{player_id}", response_model=List[RecordingResponse])
async def list_player_recordings(
    player_id: str,
    type: Optional[str] = None,
    user_id: str = Depends(get_current_user_id),
):
    supabase = get_supabase()

    try:
        player = supabase.table("players").select("id").eq("id", player_id).eq("coach_id", user_id).single().execute()
        if not player.data:
            raise HTTPException(status_code=404, detail="Player not found")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to verify player: {str(e)}")

    try:
        query = supabase.table("recordings").select("*").eq("player_id", player_id).eq("coach_id", user_id).order("created_at", desc=True)

        if type and type in VALID_TYPES:
            query = query.eq("type", type)

        result = query.execute()
        return [RecordingResponse(**r) for r in result.data]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch recordings: {str(e)}")


@router.get("/{recording_id}", response_model=RecordingResponse)
async def get_recording(
    recording_id: str,
    user_id: str = Depends(get_current_user_id),
):
    supabase = get_supabase()

    try:
        result = supabase.table("recordings").select("*").eq("id", recording_id).eq("coach_id", user_id).single().execute()
        if not result.data:
            raise HTTPException(status_code=404, detail="Recording not found")
        return RecordingResponse(**result.data)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch recording: {str(e)}")


@router.put("/{recording_id}", response_model=RecordingResponse)
async def update_recording(
    recording_id: str,
    recording: RecordingUpdate,
    user_id: str = Depends(get_current_user_id),
):
    supabase = get_supabase()

    try:
        existing = supabase.table("recordings").select("*").eq("id", recording_id).eq("coach_id", user_id).single().execute()
        if not existing.data:
            raise HTTPException(status_code=404, detail="Recording not found")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to find recording: {str(e)}")

    update_data = {k: v for k, v in recording.model_dump().items() if v is not None}
    update_data["updated_at"] = datetime.utcnow().isoformat()

    if not update_data:
        raise HTTPException(status_code=400, detail="No fields to update")

    try:
        result = supabase.table("recordings").update(update_data).eq("id", recording_id).execute()
        return RecordingResponse(**result.data[0])
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update recording: {str(e)}")


@router.delete("/{recording_id}")
async def delete_recording(
    recording_id: str,
    user_id: str = Depends(get_current_user_id),
):
    supabase = get_supabase()

    try:
        existing = supabase.table("recordings").select("*").eq("id", recording_id).eq("coach_id", user_id).single().execute()
        if not existing.data:
            raise HTTPException(status_code=404, detail="Recording not found")

        # Delete video from storage if exists
        video_url = existing.data.get("video_path")
        if video_url:
            try:
                # Extract storage path from public URL
                storage_path = video_url.split("/provision-videos/")[-1] if "/provision-videos/" in video_url else video_url
                supabase.storage.from_("provision-videos").remove([storage_path])
            except Exception:
                pass

        supabase.table("recordings").delete().eq("id", recording_id).execute()
        return {"message": "Recording deleted"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete recording: {str(e)}")


class AnalyzeResponse(BaseModel):
    session_id: str
    recording_id: str
    clip_start_time: float
    clip_end_time: float


@router.post("/{recording_id}/analyze", response_model=AnalyzeResponse)
async def analyze_recording(
    recording_id: str,
    clip_start_time: float = Form(...),
    clip_end_time: float = Form(...),
    user_id: str = Depends(get_current_user_id),
):
    supabase = get_supabase()

    try:
        source = supabase.table("recordings").select("*").eq("id", recording_id).eq("coach_id", user_id).single().execute()
        if not source.data:
            raise HTTPException(status_code=404, detail="Recording not found")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to find recording: {str(e)}")

    if clip_start_time >= clip_end_time:
        raise HTTPException(status_code=400, detail="Start time must be less than end time")

    if clip_end_time - clip_start_time > 46:
        raise HTTPException(status_code=400, detail="Clip duration must be 45 seconds or less")

    video_path = source.data.get("video_path")
    if not video_path:
        raise HTTPException(status_code=400, detail="Recording has no video")

    session_id = str(uuid.uuid4())
    title = source.data.get("title", "Recording")
    clip_label = f"{int(clip_start_time)}s-{int(clip_end_time)}s"

    session_data = {
        "id": session_id,
        "user_id": user_id,
        "name": f"{title} ({clip_label})",
        "description": f"Analysis of {title} from {clip_label}",
        "video_path": video_path,
        "status": "pending",
        "created_at": datetime.utcnow().isoformat(),
    }

    try:
        supabase.table("sessions").insert(session_data).execute()

        # Link player to session via game_players
        player_id = source.data.get("player_id")
        if player_id:
            supabase.table("game_players").insert({
                "game_id": session_id,
                "player_id": player_id,
            }).execute()

        # Update recording to link to session
        supabase.table("recordings").update({
            "session_id": session_id,
            "updated_at": datetime.utcnow().isoformat(),
        }).eq("id", recording_id).execute()

        return AnalyzeResponse(
            session_id=session_id,
            recording_id=recording_id,
            clip_start_time=clip_start_time,
            clip_end_time=clip_end_time,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create analysis session: {str(e)}")


@router.post("/{recording_id}/clip", response_model=RecordingResponse)
async def create_clip(
    recording_id: str,
    title: str = Form(...),
    clip_start_time: float = Form(...),
    clip_end_time: float = Form(...),
    description: Optional[str] = Form(None),
    user_id: str = Depends(get_current_user_id),
):
    supabase = get_supabase()

    try:
        source = supabase.table("recordings").select("*").eq("id", recording_id).eq("coach_id", user_id).single().execute()
        if not source.data:
            raise HTTPException(status_code=404, detail="Source recording not found")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to find source recording: {str(e)}")

    if clip_start_time >= clip_end_time:
        raise HTTPException(status_code=400, detail="Start time must be less than end time")

    clip_id = str(uuid.uuid4())
    clip_data = {
        "id": clip_id,
        "player_id": source.data["player_id"],
        "coach_id": user_id,
        "title": title,
        "description": description,
        "video_path": source.data.get("video_path"),
        "type": "clip",
        "source_recording_id": recording_id,
        "clip_start_time": clip_start_time,
        "clip_end_time": clip_end_time,
        "duration": clip_end_time - clip_start_time,
        "metadata": {
            "source_title": source.data.get("title"),
            "source_type": source.data.get("type"),
        },
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat(),
    }

    try:
        result = supabase.table("recordings").insert(clip_data).execute()
        return RecordingResponse(**result.data[0])
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create clip: {str(e)}")
