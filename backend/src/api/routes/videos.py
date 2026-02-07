import os
import re
import uuid
import logging
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from pydantic import BaseModel
from datetime import datetime

from ..database.supabase import get_supabase, get_current_user_id

logger = logging.getLogger(__name__)

router = APIRouter()


def extract_youtube_id(url: str) -> Optional[str]:
    patterns = [
        r"(?:youtube\.com/watch\?v=|youtu\.be/|youtube\.com/embed/|youtube\.com/v/)([a-zA-Z0-9_-]{11})",
        r"youtube\.com/shorts/([a-zA-Z0-9_-]{11})",
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return None


class VideoCreate(BaseModel):
    url: str
    title: Optional[str] = None
    thumbnail_url: Optional[str] = None
    duration: Optional[str] = None
    source: str = "youtube"
    matchup_id: Optional[str] = None
    tournament_id: Optional[str] = None
    player_id: Optional[str] = None
    metadata: Optional[dict] = None


class VideoUpdate(BaseModel):
    title: Optional[str] = None
    url: Optional[str] = None
    thumbnail_url: Optional[str] = None
    duration: Optional[str] = None
    matchup_id: Optional[str] = None
    tournament_id: Optional[str] = None
    player_id: Optional[str] = None
    metadata: Optional[dict] = None


class VideoResponse(BaseModel):
    id: str
    coach_id: str
    url: str
    youtube_video_id: Optional[str] = None
    title: Optional[str] = None
    thumbnail_url: Optional[str] = None
    duration: Optional[str] = None
    source: str
    matchup_id: Optional[str] = None
    tournament_id: Optional[str] = None
    player_id: Optional[str] = None
    session_id: Optional[str] = None
    metadata: Optional[dict] = None
    created_at: str
    updated_at: Optional[str] = None


@router.post("", response_model=VideoResponse)
async def create_video(
    video: VideoCreate,
    user_id: str = Depends(get_current_user_id),
):
    supabase = get_supabase()
    video_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()

    youtube_video_id = extract_youtube_id(video.url) if video.source == "youtube" else None
    thumbnail_url = video.thumbnail_url
    if not thumbnail_url and youtube_video_id:
        thumbnail_url = f"https://img.youtube.com/vi/{youtube_video_id}/hqdefault.jpg"

    data = {
        "id": video_id,
        "coach_id": user_id,
        "url": video.url,
        "youtube_video_id": youtube_video_id,
        "title": video.title,
        "thumbnail_url": thumbnail_url,
        "duration": video.duration,
        "source": video.source,
        "matchup_id": video.matchup_id,
        "tournament_id": video.tournament_id,
        "player_id": video.player_id,
        "metadata": video.metadata or {},
        "created_at": now,
        "updated_at": now,
    }

    try:
        result = supabase.table("videos").insert(data).execute()
        return VideoResponse(**result.data[0])
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create video: {str(e)}")


@router.get("/youtube-metadata")
async def get_youtube_metadata_endpoint(
    url: str = Query(..., description="YouTube video URL"),
    user_id: str = Depends(get_current_user_id),
):
    from ..services.youtube_service import get_youtube_metadata

    metadata = get_youtube_metadata(url)
    if not metadata:
        raise HTTPException(status_code=400, detail="Could not extract metadata from URL. Ensure it is a valid YouTube video.")
    return metadata


@router.get("", response_model=List[VideoResponse])
async def list_videos(
    user_id: str = Depends(get_current_user_id),
    matchup_id: Optional[str] = Query(None),
    tournament_id: Optional[str] = Query(None),
    player_id: Optional[str] = Query(None),
):
    supabase = get_supabase()

    try:
        query = supabase.table("videos").select("*").eq("coach_id", user_id).order("created_at", desc=True)
        if matchup_id:
            query = query.eq("matchup_id", matchup_id)
        if tournament_id:
            query = query.eq("tournament_id", tournament_id)
        if player_id:
            query = query.eq("player_id", player_id)

        result = query.execute()
        return [VideoResponse(**v) for v in result.data]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list videos: {str(e)}")


@router.get("/{video_id}", response_model=VideoResponse)
async def get_video(
    video_id: str,
    user_id: str = Depends(get_current_user_id),
):
    supabase = get_supabase()

    try:
        result = supabase.table("videos").select("*").eq("id", video_id).eq("coach_id", user_id).single().execute()
        if not result.data:
            raise HTTPException(status_code=404, detail="Video not found")
        return VideoResponse(**result.data)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get video: {str(e)}")


@router.put("/{video_id}", response_model=VideoResponse)
async def update_video(
    video_id: str,
    video: VideoUpdate,
    user_id: str = Depends(get_current_user_id),
):
    supabase = get_supabase()

    try:
        existing = supabase.table("videos").select("*").eq("id", video_id).eq("coach_id", user_id).single().execute()
        if not existing.data:
            raise HTTPException(status_code=404, detail="Video not found")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to find video: {str(e)}")

    update_data = {k: v for k, v in video.model_dump().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail="No fields to update")

    if "url" in update_data:
        yt_id = extract_youtube_id(update_data["url"])
        update_data["youtube_video_id"] = yt_id
        if yt_id and "thumbnail_url" not in update_data:
            update_data["thumbnail_url"] = f"https://img.youtube.com/vi/{yt_id}/hqdefault.jpg"

    update_data["updated_at"] = datetime.utcnow().isoformat()

    try:
        result = supabase.table("videos").update(update_data).eq("id", video_id).execute()
        return VideoResponse(**result.data[0])
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update video: {str(e)}")


@router.delete("/{video_id}")
async def delete_video(
    video_id: str,
    user_id: str = Depends(get_current_user_id),
):
    supabase = get_supabase()

    try:
        existing = supabase.table("videos").select("*").eq("id", video_id).eq("coach_id", user_id).single().execute()
        if not existing.data:
            raise HTTPException(status_code=404, detail="Video not found")

        supabase.table("videos").delete().eq("id", video_id).execute()
        return {"message": "Video deleted"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete video: {str(e)}")


def _analyze_youtube_background(video_id: str, url: str, user_id: str, player_id: Optional[str] = None):
    """Background task: download YouTube video, upload to storage, create session, run analysis."""
    from ..services.youtube_service import download_youtube_video

    supabase = get_supabase()

    try:
        logger.info(f"[VideoAnalyze] Starting download for video {video_id}: {url}")
        local_path = download_youtube_video(url, max_duration=600)
        if not local_path:
            logger.error(f"[VideoAnalyze] Download failed for {url}")
            supabase.table("videos").update({"metadata": {"analysis_status": "download_failed"}}).eq("id", video_id).execute()
            return

        session_id = str(uuid.uuid4())
        ext = os.path.splitext(local_path)[1] or ".mp4"
        storage_path = f"{user_id}/{session_id}/original{ext}"

        logger.info(f"[VideoAnalyze] Uploading to storage: {storage_path}")
        with open(local_path, "rb") as f:
            supabase.storage.from_("provision-videos").upload(storage_path, f.read())

        video_url = supabase.storage.from_("provision-videos").get_public_url(storage_path)

        session_data = {
            "id": session_id,
            "user_id": user_id,
            "name": f"YouTube Analysis - {video_id[:8]}",
            "video_path": video_url,
            "status": "pending",
            "created_at": datetime.utcnow().isoformat(),
        }
        supabase.table("sessions").insert(session_data).execute()

        if player_id:
            try:
                supabase.table("game_players").insert({
                    "game_id": session_id,
                    "player_id": player_id,
                }).execute()
            except Exception as e:
                logger.warning(f"[VideoAnalyze] Failed to link player: {e}")

        supabase.table("videos").update({
            "session_id": session_id,
            "updated_at": datetime.utcnow().isoformat(),
        }).eq("id", video_id).execute()

        logger.info(f"[VideoAnalyze] Session created: {session_id}, triggering analysis")

        try:
            os.unlink(local_path)
            os.rmdir(os.path.dirname(local_path))
        except Exception:
            pass

    except Exception as e:
        logger.error(f"[VideoAnalyze] Failed for video {video_id}: {e}")
        try:
            supabase.table("videos").update({
                "metadata": {"analysis_status": "failed", "error": str(e)},
            }).eq("id", video_id).execute()
        except Exception:
            pass


@router.post("/{video_id}/analyze")
async def analyze_video(
    video_id: str,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_current_user_id),
):
    supabase = get_supabase()

    try:
        existing = supabase.table("videos").select("*").eq("id", video_id).eq("coach_id", user_id).single().execute()
        if not existing.data:
            raise HTTPException(status_code=404, detail="Video not found")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to find video: {str(e)}")

    video_data = existing.data
    if video_data.get("session_id"):
        return {"message": "Already analyzed", "session_id": video_data["session_id"]}

    background_tasks.add_task(
        _analyze_youtube_background,
        video_id=video_id,
        url=video_data["url"],
        user_id=user_id,
        player_id=video_data.get("player_id"),
    )

    return {"message": "Analysis started", "video_id": video_id}
