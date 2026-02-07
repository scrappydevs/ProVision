from typing import List, Optional, Dict
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel
import traceback

from ..database.supabase import get_supabase, get_current_user_id
from ..utils.video_utils import download_video_from_storage, extract_video_path_from_url, cleanup_temp_file

router = APIRouter()


def _get_player_handedness(supabase, session_id: str) -> str:
    """Look up the handedness of the player linked to a session via game_players."""
    try:
        gp_result = supabase.table("game_players").select("player_id").eq("game_id", session_id).limit(1).execute()
        if gp_result.data:
            player_id = gp_result.data[0]["player_id"]
            player_result = supabase.table("players").select("handedness").eq("id", player_id).single().execute()
            if player_result.data and player_result.data.get("handedness"):
                return player_result.data["handedness"]
    except Exception:
        pass
    return "right"


class Keypoint(BaseModel):
    name: str
    x: float
    y: float
    confidence: float


class PoseFrame(BaseModel):
    frame: int
    keypoints: List[Keypoint]


class PoseDataResponse(BaseModel):
    session_id: str
    frames: List[PoseFrame]
    joint_angles: Optional[dict] = None


class PlayerSelectionRequest(BaseModel):
    player_idx: int
    bbox: dict
    center: dict
    confidence: Optional[float] = None


def process_pose_analysis(session_id: str, video_path: str, video_url: str, target_player: Optional[Dict] = None):
    """
    Background task to process pose analysis.
    This runs asynchronously to avoid blocking the API.
    """
    try:
        print(f"[PoseAnalysis] Task started for session: {session_id}", flush=True)
        if target_player:
            print(f"[PoseAnalysis] Tracking player: {target_player}", flush=True)
        import os
        import tempfile

        supabase = get_supabase()
        local_video_path = None
        pose_video_path = None

        print(f"[PoseAnalysis] Starting analysis for session: {session_id}")

        # Update session status
        supabase.table("sessions").update({"status": "processing"}).eq("id", session_id).execute()

        # Download video from storage
        local_video_path = download_video_from_storage(video_path)

        from ..services.pose_processor import PoseProcessor
        processor = PoseProcessor(model_name='yolo11n-pose.pt', conf=0.25)

        # Process video (sample every 3rd frame for speed)
        pose_frames = processor.process_video(local_video_path, sample_rate=3, target_player=target_player)

        print(f"[PoseAnalysis] Extracted pose data from {len(pose_frames)} frames")

        # Store pose data in database
        for pose_frame in pose_frames:
            pose_dict = processor.pose_frame_to_dict(pose_frame)

            supabase.table("pose_analysis").insert({
                "session_id": session_id,
                "frame_number": pose_dict['frame_number'],
                "timestamp": pose_dict['timestamp'],
                "keypoints": pose_dict['keypoints'],
                "joint_angles": pose_dict['joint_angles'],
                "body_metrics": pose_dict['body_metrics']
            }).execute()

        # Generate pose overlay video
        print(f"[PoseAnalysis] Generating pose overlay video for session: {session_id}")
        pose_overlay_temp = tempfile.NamedTemporaryFile(delete=False, suffix='.mp4').name
        processor.generate_pose_overlay_video(local_video_path, pose_overlay_temp, sample_rate=1, target_player=target_player)

        # Upload pose overlay video to Supabase storage
        print(f"[PoseAnalysis] Uploading pose overlay video to storage")

        # Get user_id from video_path (format: user_id/session_id/filename)
        user_id = video_path.split('/')[0]
        pose_storage_path = f"{user_id}/{session_id}/pose_overlay.mp4"

        # Read video file
        with open(pose_overlay_temp, 'rb') as f:
            video_content = f.read()

        # Upload to storage
        supabase.storage.from_("provision-videos").upload(pose_storage_path, video_content)

        # Get public URL
        pose_video_url = supabase.storage.from_("provision-videos").get_public_url(pose_storage_path)

        print(f"[PoseAnalysis] Pose overlay video uploaded: {pose_video_url}")

        # Clean up temporary pose video file
        pose_video_path = pose_overlay_temp

        # Update session with pose video path
        supabase.table("sessions").update({
            "status": "completed",
            "pose_video_path": pose_video_url,
            "pose_data": {
                "frame_count": len(pose_frames),
                "analyzed_at": pose_frames[0].timestamp if pose_frames else 0,
                "analyzed_until": pose_frames[-1].timestamp if pose_frames else 0
            }
        }).eq("id", session_id).execute()

        print(f"[PoseAnalysis] Completed analysis for session: {session_id}")

    except Exception as e:
        print(f"[PoseAnalysis] Error processing session {session_id}: {str(e)}", flush=True)
        print(f"[PoseAnalysis] Traceback: {traceback.format_exc()}", flush=True)

        # Update session status to failed
        try:
            supabase.table("sessions").update({
                "status": "failed"
            }).eq("id", session_id).execute()
        except Exception as db_error:
            print(f"[PoseAnalysis] Failed to update status: {db_error}", flush=True)

    finally:
        # Cleanup temporary files
        if local_video_path:
            cleanup_temp_file(local_video_path)
        if pose_video_path:
            cleanup_temp_file(pose_video_path)


@router.post("/preview/{session_id}")
async def get_player_preview(
    session_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """
    Generate a preview frame with detected players for selection.
    Returns preview image URL and list of detected players with bounding boxes.
    """
    import tempfile
    import cv2

    supabase = get_supabase()

    result = supabase.table("sessions").select("*").eq("id", session_id).eq("user_id", user_id).single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Session not found")

    session = result.data
    video_url = session.get("video_path")
    if not video_url:
        raise HTTPException(status_code=400, detail="No video uploaded for this session")

    try:
        video_path = extract_video_path_from_url(video_url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    local_video_path = None
    try:
        local_video_path = download_video_from_storage(video_path)

        from ..services.pose_processor import PoseProcessor
        processor = PoseProcessor(model_name='yolo11n-pose.pt', conf=0.25)

        # Extract preview frame
        frame, video_info = processor.extract_preview_frame(local_video_path, frame_number=0)

        # Detect players
        players = processor.detect_players_in_frame(frame)

        # Generate preview image with bounding boxes
        preview_frame = processor.generate_preview_with_boxes(frame, players)

        # Save preview to temp file and upload
        preview_temp = tempfile.NamedTemporaryFile(delete=False, suffix='.jpg').name
        cv2.imwrite(preview_temp, preview_frame)

        user_id_from_path = video_path.split('/')[0]
        preview_storage_path = f"{user_id_from_path}/{session_id}/player_preview.jpg"

        with open(preview_temp, 'rb') as f:
            preview_content = f.read()

        # Try to remove old preview first
        try:
            supabase.storage.from_("provision-videos").remove([preview_storage_path])
        except Exception:
            pass

        supabase.storage.from_("provision-videos").upload(preview_storage_path, preview_content)
        preview_url = supabase.storage.from_("provision-videos").get_public_url(preview_storage_path)

        # Update session with preview info
        supabase.table("sessions").update({
            "preview_frame_url": preview_url,
        }).eq("id", session_id).execute()

        # Clean up temp file
        import os
        os.unlink(preview_temp)

        return {
            "session_id": session_id,
            "preview_url": preview_url,
            "video_info": video_info,
            "players": players,
            "player_count": len(players),
        }

    finally:
        if local_video_path:
            cleanup_temp_file(local_video_path)


@router.post("/select-player/{session_id}")
async def select_player(
    session_id: str,
    request: PlayerSelectionRequest,
    user_id: str = Depends(get_current_user_id),
):
    """Save selected player for pose tracking."""
    supabase = get_supabase()

    result = supabase.table("sessions").select("id").eq("id", session_id).eq("user_id", user_id).single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Session not found")

    selected_player = {
        "player_idx": request.player_idx,
        "bbox": request.bbox,
        "center": request.center,
        "confidence": request.confidence,
    }

    supabase.table("sessions").update({
        "selected_player": selected_player,
    }).eq("id", session_id).execute()

    return {"status": "ok", "selected_player": selected_player}


@router.delete("/select-player/{session_id}")
async def clear_player_selection(
    session_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """Clear selected player."""
    supabase = get_supabase()

    result = supabase.table("sessions").select("id").eq("id", session_id).eq("user_id", user_id).single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Session not found")

    supabase.table("sessions").update({
        "selected_player": None,
    }).eq("id", session_id).execute()

    return {"status": "ok"}


@router.post("/analyze/{session_id}")
async def analyze_pose(
    session_id: str,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_current_user_id),
):
    """
    Trigger pose analysis for a session.
    Processing happens in the background.
    """
    supabase = get_supabase()

    # Verify session exists and belongs to user
    result = supabase.table("sessions").select("*").eq("id", session_id).eq("user_id", user_id).single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Session not found")

    session = result.data

    # If pose video already exists, skip re-analysis
    if session.get("pose_video_path"):
        return {
            "status": "already_complete",
            "session_id": session_id,
            "message": "Pose analysis already completed.",
            "pose_video_path": session["pose_video_path"],
        }

    video_url = session.get("video_path")

    if not video_url:
        raise HTTPException(status_code=400, detail="No video uploaded for this session")

    # Extract storage path from URL
    try:
        video_path = extract_video_path_from_url(video_url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Get selected player if any
    target_player = session.get("selected_player")

    # Add background task for processing
    background_tasks.add_task(process_pose_analysis, session_id, video_path, video_url, target_player)

    return {
        "status": "processing",
        "session_id": session_id,
        "message": "Pose analysis started. Check session status for progress."
    }


@router.post("/retry/{session_id}")
async def retry_pose_analysis(
    session_id: str,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_current_user_id),
):
    """
    Retry pose analysis for a failed session.
    Clears previous pose data and re-triggers processing.
    """
    supabase = get_supabase()

    result = supabase.table("sessions").select("*").eq("id", session_id).eq("user_id", user_id).single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Session not found")

    session = result.data
    status = session.get("status")

    if status == "processing":
        raise HTTPException(status_code=409, detail="Session is already processing")

    video_url = session.get("video_path")
    if not video_url:
        raise HTTPException(status_code=400, detail="No video uploaded for this session")

    try:
        video_path = extract_video_path_from_url(video_url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Clear previous pose data for this session
    supabase.table("pose_analysis").delete().eq("session_id", session_id).execute()

    # Reset session status
    supabase.table("sessions").update({
        "status": "pending",
        "pose_video_path": None,
        "pose_data": {},
    }).eq("id", session_id).execute()

    # Re-trigger processing
    background_tasks.add_task(process_pose_analysis, session_id, video_path, video_url)

    return {
        "status": "processing",
        "session_id": session_id,
        "message": "Pose analysis retry started.",
    }


@router.get("/data/{session_id}", response_model=PoseDataResponse)
async def get_pose_data(
    session_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """Get pose data for a session (legacy format)."""
    supabase = get_supabase()

    result = supabase.table("sessions").select("*").eq("id", session_id).eq("user_id", user_id).single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Session not found")

    pose_data = result.data.get("pose_data")
    if not pose_data:
        raise HTTPException(status_code=404, detail="No pose data found")

    return PoseDataResponse(
        session_id=session_id,
        frames=[
            PoseFrame(
                frame=f["frame"],
                keypoints=[Keypoint(**k) for k in f["keypoints"]],
            )
            for f in pose_data.get("frames", [])
        ],
        joint_angles=pose_data.get("joint_angles"),
    )


@router.get("/analysis/{session_id}")
async def get_pose_analysis(
    session_id: str,
    limit: Optional[int] = 100,
    offset: Optional[int] = 0,
    user_id: str = Depends(get_current_user_id),
):
    """
    Get detailed pose analysis data from pose_analysis table.

    Args:
        session_id: Session ID
        limit: Number of frames to return (default 100)
        offset: Offset for pagination (default 0)

    Returns:
        List of pose frames with keypoints, angles, and metrics
    """
    supabase = get_supabase()

    # Verify session exists and belongs to user
    result = supabase.table("sessions").select("id").eq("id", session_id).eq("user_id", user_id).single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Session not found")

    # Get pose analysis data
    pose_result = supabase.table("pose_analysis")\
        .select("*")\
        .eq("session_id", session_id)\
        .order("timestamp")\
        .range(offset, offset + limit - 1)\
        .execute()

    if not pose_result.data:
        raise HTTPException(status_code=404, detail="No pose analysis data found. Run analysis first.")

    return {
        "session_id": session_id,
        "frame_count": len(pose_result.data),
        "offset": offset,
        "limit": limit,
        "frames": pose_result.data
    }


@router.get("/summary/{session_id}")
async def get_pose_summary(
    session_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """
    Get pose analysis summary statistics for a session.

    Returns aggregate metrics like average angles, movement patterns, etc.
    """
    supabase = get_supabase()

    # Verify session exists and belongs to user
    session_result = supabase.table("sessions").select("*").eq("id", session_id).eq("user_id", user_id).single().execute()
    if not session_result.data:
        raise HTTPException(status_code=404, detail="Session not found")

    # Get all pose analysis data for statistics
    pose_result = supabase.table("pose_analysis")\
        .select("joint_angles, body_metrics")\
        .eq("session_id", session_id)\
        .execute()

    if not pose_result.data or len(pose_result.data) == 0:
        raise HTTPException(status_code=404, detail="No pose analysis data found")

    # Calculate summary statistics
    frames = pose_result.data

    # Average joint angles
    avg_angles = {}
    for angle_name in ['right_elbow', 'left_elbow', 'right_shoulder', 'left_shoulder',
                       'right_knee', 'left_knee', 'right_hip', 'left_hip']:
        angles = [f['joint_angles'].get(angle_name, 0) for f in frames if angle_name in f.get('joint_angles', {})]
        if angles:
            avg_angles[angle_name] = {
                'mean': sum(angles) / len(angles),
                'min': min(angles),
                'max': max(angles)
            }

    # Average body metrics
    avg_metrics = {}
    for metric_name in ['hip_rotation', 'shoulder_rotation', 'spine_lean']:
        metrics = [f['body_metrics'].get(metric_name, 0) for f in frames if metric_name in f.get('body_metrics', {})]
        if metrics:
            avg_metrics[metric_name] = {
                'mean': sum(metrics) / len(metrics),
                'min': min(metrics),
                'max': max(metrics)
            }

    return {
        "session_id": session_id,
        "frame_count": len(frames),
        "duration": frames[-1].get('timestamp', 0) if frames else 0,
        "average_joint_angles": avg_angles,
        "average_body_metrics": avg_metrics,
        "status": session_result.data.get('status')
    }


@router.get("/strokes/{session_id}")
async def get_strokes(
    session_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """Get classified stroke events (forehand/backhand) for a session."""
    supabase = get_supabase()

    result = supabase.table("sessions").select("id").eq("id", session_id).eq("user_id", user_id).single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Session not found")

    pose_result = supabase.table("pose_analysis")\
        .select("frame_number, timestamp, keypoints, joint_angles")\
        .eq("session_id", session_id)\
        .order("timestamp")\
        .execute()

    if not pose_result.data:
        return {"session_id": session_id, "strokes": [], "count": 0}

    # Look up player handedness
    handedness = _get_player_handedness(supabase, session_id)

    from ..services.stroke_classifier import classify_strokes
    strokes = classify_strokes(pose_result.data, handedness=handedness)

    return {
        "session_id": session_id,
        "strokes": strokes,
        "count": len(strokes),
        "handedness": handedness,
    }


@router.get("/match-analytics/{session_id}")
async def get_match_analytics(
    session_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """Get combined match analytics including strokes, dominant hand, and weakness analysis."""
    supabase = get_supabase()

    session_result = supabase.table("sessions").select("*").eq("id", session_id).eq("user_id", user_id).single().execute()
    if not session_result.data:
        raise HTTPException(status_code=404, detail="Session not found")

    pose_result = supabase.table("pose_analysis")\
        .select("frame_number, timestamp, keypoints, joint_angles, body_metrics")\
        .eq("session_id", session_id)\
        .order("timestamp")\
        .execute()

    if not pose_result.data:
        return {
            "session_id": session_id,
            "strokes": [],
            "stroke_count": 0,
            "dominant_hand": "unknown",
            "weakness_analysis": {"summary": "No pose data available"},
        }

    # Look up player handedness
    handedness = _get_player_handedness(supabase, session_id)

    from ..services.stroke_classifier import build_match_analytics
    analytics = build_match_analytics(pose_result.data, handedness=handedness)
    analytics["session_id"] = session_id
    analytics["status"] = session_result.data.get("status")
    analytics["handedness"] = handedness

    return analytics
