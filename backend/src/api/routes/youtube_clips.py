import os
import uuid
import logging
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel
from datetime import datetime

from ..database.supabase import get_supabase, get_current_user_id
from ..services.youtube_service import (
    extract_youtube_id,
    get_youtube_metadata,
    download_youtube_video,
    get_youtube_streaming_url,
)

logger = logging.getLogger(__name__)

router = APIRouter()


class YouTubeClipCreate(BaseModel):
    youtube_url: str
    clip_start_time: float = 0
    clip_end_time: float
    title: Optional[str] = None


class YouTubeClipResponse(BaseModel):
    id: str
    coach_id: str
    youtube_url: str
    youtube_video_id: str
    title: Optional[str]
    thumbnail_url: Optional[str]
    clip_start_time: float
    clip_end_time: float
    duration: float
    video_storage_path: Optional[str]
    video_public_url: Optional[str]
    session_id: Optional[str]
    status: str
    error_message: Optional[str]
    metadata: Optional[dict]
    created_at: str
    updated_at: Optional[str]


@router.post("", response_model=YouTubeClipResponse)
async def create_youtube_clip(
    clip: YouTubeClipCreate,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_current_user_id),
):
    """Create a YouTube clip and start processing in background.
    
    This creates a clip record and starts downloading/clipping the video in background.
    The clip can be analyzed later by calling POST /youtube-clips/{clip_id}/analyze
    """
    supabase = get_supabase()
    
    youtube_id = extract_youtube_id(clip.youtube_url)
    if not youtube_id:
        raise HTTPException(400, "Invalid YouTube URL")
    
    # Validate clip range
    if clip.clip_start_time < 0 or clip.clip_end_time <= clip.clip_start_time:
        raise HTTPException(400, "Invalid clip time range")
    
    duration = clip.clip_end_time - clip.clip_start_time
    if duration > 45:
        raise HTTPException(400, "Clip duration must be ≤45 seconds")
    
    # Get metadata if title not provided
    title = clip.title
    thumbnail_url = f"https://img.youtube.com/vi/{youtube_id}/maxresdefault.jpg"
    
    if not title:
        metadata = get_youtube_metadata(clip.youtube_url)
        if metadata:
            title = metadata.get("title", f"YouTube Clip - {youtube_id[:8]}")
        else:
            title = f"YouTube Clip - {youtube_id[:8]}"
    
    clip_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()
    
    data = {
        "id": clip_id,
        "coach_id": user_id,
        "youtube_url": clip.youtube_url,
        "youtube_video_id": youtube_id,
        "title": title,
        "thumbnail_url": thumbnail_url,
        "clip_start_time": clip.clip_start_time,
        "clip_end_time": clip.clip_end_time,
        "duration": duration,
        "status": "pending",
        "created_at": now,
        "updated_at": now,
    }
    
    try:
        result = supabase.table("youtube_clips").insert(data).execute()
    except Exception as e:
        raise HTTPException(500, f"Failed to create clip: {str(e)}")
    
    # Start background processing
    background_tasks.add_task(
        _process_youtube_clip_background,
        clip_id=clip_id,
        youtube_url=clip.youtube_url,
        start_time=clip.clip_start_time,
        end_time=clip.clip_end_time,
        user_id=user_id,
    )
    
    return YouTubeClipResponse(**result.data[0])


@router.get("", response_model=List[YouTubeClipResponse])
async def list_youtube_clips(
    user_id: str = Depends(get_current_user_id),
):
    """List all YouTube clips for current user, ordered by most recent first."""
    supabase = get_supabase()
    
    try:
        result = supabase.table("youtube_clips")\
            .select("*")\
            .eq("coach_id", user_id)\
            .order("created_at", desc=True)\
            .execute()
        return [YouTubeClipResponse(**c) for c in result.data]
    except Exception as e:
        raise HTTPException(500, f"Failed to list clips: {str(e)}")


@router.get("/{clip_id}", response_model=YouTubeClipResponse)
async def get_youtube_clip(
    clip_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """Get a specific YouTube clip."""
    supabase = get_supabase()
    
    try:
        result = supabase.table("youtube_clips")\
            .select("*")\
            .eq("id", clip_id)\
            .eq("coach_id", user_id)\
            .single()\
            .execute()
        
        if not result.data:
            raise HTTPException(404, "Clip not found")
        
        return YouTubeClipResponse(**result.data)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Failed to get clip: {str(e)}")


@router.post("/{clip_id}/analyze")
async def analyze_youtube_clip(
    clip_id: str,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_current_user_id),
):
    """Create a session and analyze the YouTube clip.
    
    The clip must be in 'completed' status before analysis can begin.
    This creates a new session with the clipped video and triggers background analysis.
    """
    supabase = get_supabase()
    
    # Get clip
    try:
        clip_result = supabase.table("youtube_clips")\
            .select("*")\
            .eq("id", clip_id)\
            .eq("coach_id", user_id)\
            .single()\
            .execute()
        
        if not clip_result.data:
            raise HTTPException(404, "Clip not found")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Failed to get clip: {str(e)}")
    
    clip = clip_result.data
    
    # Check if already has session
    if clip.get("session_id"):
        return {"message": "Already analyzed", "session_id": clip["session_id"]}
    
    # Check if video is processed
    if clip["status"] != "completed" or not clip.get("video_public_url"):
        raise HTTPException(400, f"Clip must be processed before analysis. Current status: {clip['status']}")
    
    # Create session
    session_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()
    
    clip_label = f" ({int(clip['clip_start_time'])}s-{int(clip['clip_end_time'])}s)"
    
    session_data = {
        "id": session_id,
        "user_id": user_id,
        "name": f"{clip['title']}{clip_label}",
        "description": f"YouTube clip from {clip['youtube_url']}",
        "video_path": clip["video_public_url"],
        "status": "pending",  # Will be processed by existing pipeline
        "created_at": now,
    }
    
    try:
        supabase.table("sessions").insert(session_data).execute()
        
        # Link clip to session
        supabase.table("youtube_clips")\
            .update({"session_id": session_id, "updated_at": now})\
            .eq("id", clip_id)\
            .execute()
        
        logger.info(f"Created session {session_id} for YouTube clip {clip_id}")
        
        # Trigger background analysis tasks (TrackNet + Dashboard only).
        # Pose analysis is NOT auto-triggered — the frontend will open the
        # PlayerSelection modal so the user picks which person to track,
        # then POST /api/pose/analyze/{session_id} runs pose with that selection.
        video_url = clip["video_public_url"]

        from .sessions import _run_tracknet_background, _run_dashboard_analysis_background

        try:
            background_tasks.add_task(
                _run_tracknet_background,
                session_id, video_url
            )
            background_tasks.add_task(
                _run_dashboard_analysis_background,
                session_id, user_id, video_url
            )
            logger.info(f"[YouTubeClip {clip_id}] TrackNet + Dashboard queued for session {session_id}")
        except Exception as bg_error:
            logger.warning(f"[YouTubeClip {clip_id}] Failed to queue background tasks: {bg_error}")
        
        return {"message": "Analysis started", "session_id": session_id}
    except Exception as e:
        raise HTTPException(500, f"Failed to create session: {str(e)}")


@router.delete("/{clip_id}")
async def delete_youtube_clip(
    clip_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """Delete a YouTube clip and its associated storage file."""
    supabase = get_supabase()
    
    try:
        # Get clip to find storage path
        clip_result = supabase.table("youtube_clips")\
            .select("*")\
            .eq("id", clip_id)\
            .eq("coach_id", user_id)\
            .single()\
            .execute()
        
        if not clip_result.data:
            raise HTTPException(404, "Clip not found")
        
        clip = clip_result.data
        
        # Delete from storage if exists
        if clip.get("video_storage_path"):
            try:
                supabase.storage.from_("provision-videos").remove([clip["video_storage_path"]])
            except Exception as e:
                logger.warning(f"Failed to delete storage file: {e}")
        
        # Delete clip record
        supabase.table("youtube_clips").delete().eq("id", clip_id).execute()
        
        return {"message": "Clip deleted"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Failed to delete clip: {str(e)}")


@router.get("/{clip_id}/streaming-url")
async def get_clip_streaming_url(
    clip_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """Get direct streaming URL for instant preview (expires in ~6 hours).
    
    This is useful for instant playback in the UI while the clip is being processed.
    """
    supabase = get_supabase()
    
    try:
        clip_result = supabase.table("youtube_clips")\
            .select("youtube_url, clip_start_time")\
            .eq("id", clip_id)\
            .eq("coach_id", user_id)\
            .single()\
            .execute()
        
        if not clip_result.data:
            raise HTTPException(404, "Clip not found")
        
        clip = clip_result.data
        stream_info = get_youtube_streaming_url(clip["youtube_url"])
        
        if not stream_info:
            raise HTTPException(500, "Failed to get streaming URL")
        
        return {
            "streaming_url": stream_info["url"],
            "start_time": clip["clip_start_time"],
            "http_headers": stream_info.get("http_headers", {}),
            "expires": "~6 hours",
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Failed to get streaming URL: {str(e)}")


def _process_youtube_clip_background(
    clip_id: str,
    youtube_url: str,
    start_time: float,
    end_time: float,
    user_id: str,
):
    """Background task: download and clip YouTube video, upload to storage.
    
    This uses the optimized download_youtube_video which implements FFmpeg smart seeking.
    """
    supabase = get_supabase()
    
    try:
        # Update status
        supabase.table("youtube_clips")\
            .update({"status": "processing", "updated_at": datetime.utcnow().isoformat()})\
            .eq("id", clip_id)\
            .execute()
        
        logger.info(f"[YouTubeClip {clip_id}] Downloading {youtube_url} ({start_time}s-{end_time}s)")
        
        # Download and clip (uses optimized FFmpeg seeking)
        local_path = download_youtube_video(
            youtube_url,
            max_duration=600,
            start_time=start_time,
            end_time=end_time
        )
        
        if not local_path:
            raise Exception("Download failed")
        
        # Upload to storage
        ext = os.path.splitext(local_path)[1] or ".mp4"
        storage_path = f"{user_id}/youtube_clips/{clip_id}{ext}"
        
        logger.info(f"[YouTubeClip {clip_id}] Uploading to {storage_path}")
        
        with open(local_path, "rb") as f:
            supabase.storage.from_("provision-videos").upload(storage_path, f.read(), {
                "content-type": "video/mp4",
                "upsert": "true",
            })
        
        video_url = supabase.storage.from_("provision-videos").get_public_url(storage_path)
        
        # Update clip
        supabase.table("youtube_clips").update({
            "video_storage_path": storage_path,
            "video_public_url": video_url,
            "status": "completed",
            "updated_at": datetime.utcnow().isoformat(),
        }).eq("id", clip_id).execute()
        
        logger.info(f"[YouTubeClip {clip_id}] Completed successfully")
        
        # Cleanup
        try:
            os.unlink(local_path)
            os.rmdir(os.path.dirname(local_path))
        except Exception:
            pass
        
    except Exception as e:
        logger.error(f"[YouTubeClip {clip_id}] Failed: {e}")
        supabase.table("youtube_clips").update({
            "status": "failed",
            "error_message": str(e),
            "updated_at": datetime.utcnow().isoformat(),
        }).eq("id", clip_id).execute()
