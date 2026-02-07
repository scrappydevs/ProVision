from typing import List, Optional, Dict
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel
import traceback

from ..database.supabase import get_supabase, get_current_user_id
from ..utils.video_utils import download_video_from_storage, extract_video_path_from_url, cleanup_temp_file

router = APIRouter()


def _get_player_settings(supabase, session_id: str, session_data: dict = None) -> dict:
    """Look up handedness (from player) and camera_facing (from session)."""
    settings = {"handedness": "right", "camera_facing": "auto"}

    # camera_facing lives on the session
    if session_data and session_data.get("camera_facing"):
        settings["camera_facing"] = session_data["camera_facing"]
    else:
        try:
            sess = supabase.table("sessions").select("camera_facing").eq("id", session_id).single().execute()
            if sess.data and sess.data.get("camera_facing"):
                settings["camera_facing"] = sess.data["camera_facing"]
        except Exception:
            pass

    # handedness lives on the player
    try:
        gp_result = supabase.table("game_players").select("player_id").eq("game_id", session_id).limit(1).execute()
        if gp_result.data:
            player_id = gp_result.data[0]["player_id"]
            player_result = supabase.table("players").select("handedness").eq("id", player_id).single().execute()
            if player_result.data and player_result.data.get("handedness"):
                settings["handedness"] = player_result.data["handedness"]
    except Exception:
        pass
    return settings


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

        # Store pose data in database - batch insert for performance
        pose_records = []
        for pose_frame in pose_frames:
            pose_dict = processor.pose_frame_to_dict(pose_frame)
            pose_records.append({
                "session_id": session_id,
                "frame_number": pose_dict['frame_number'],
                "timestamp": pose_dict['timestamp'],
                "person_id": pose_dict['person_id'],
                "keypoints": pose_dict['keypoints'],
                "joint_angles": pose_dict['joint_angles'],
                "body_metrics": pose_dict['body_metrics']
            })
        
        # Insert in batches of 100 to avoid connection timeout
        batch_size = 100
        for i in range(0, len(pose_records), batch_size):
            batch = pose_records[i:i + batch_size]
            supabase.table("pose_analysis").insert(batch).execute()
            print(f"[PoseAnalysis] Inserted batch {i//batch_size + 1}/{(len(pose_records) + batch_size - 1)//batch_size}")

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

    # Get all pose analysis data for statistics (player only)
    pose_result = supabase.table("pose_analysis")\
        .select("joint_angles, body_metrics")\
        .eq("session_id", session_id)\
        .eq("person_id", 0)\
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
        .eq("person_id", 0)\
        .order("timestamp")\
        .execute()

    if not pose_result.data:
        return {"session_id": session_id, "strokes": [], "count": 0}

    # Look up player settings (handedness + camera facing)
    player_settings = _get_player_settings(supabase, session_id)

    from ..services.stroke_classifier import classify_strokes
    strokes = classify_strokes(
        pose_result.data,
        handedness=player_settings["handedness"],
        camera_facing=player_settings["camera_facing"],
    )

    return {
        "session_id": session_id,
        "strokes": strokes,
        "count": len(strokes),
        "handedness": player_settings["handedness"],
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
        .eq("person_id", 0)\
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

    # Look up player settings (handedness + camera facing)
    player_settings = _get_player_settings(supabase, session_id)

    from ..services.stroke_classifier import build_match_analytics
    analytics = build_match_analytics(
        pose_result.data,
        handedness=player_settings["handedness"],
        camera_facing=player_settings["camera_facing"],
    )
    analytics["session_id"] = session_id
    analytics["status"] = session_result.data.get("status")
    analytics["handedness"] = player_settings["handedness"]

    return analytics


@router.get("/debug-frame/{session_id}")
async def debug_frame(
    session_id: str,
    frame: int,
    user_id: str = Depends(get_current_user_id),
):
    """
    Diagnostic endpoint: compute all raw stroke-detection signals for a window
    of frames around the given frame number. Used for tuning thresholds.
    """
    from ..services.stroke_classifier import (
        _get_kp, _visible, _body_width, detect_camera_facing, _resolve_facing,
        _normalize_angle_delta,
    )

    supabase = get_supabase()

    session_result = supabase.table("sessions").select("*").eq("id", session_id).eq("user_id", user_id).single().execute()
    if not session_result.data:
        raise HTTPException(status_code=404, detail="Session not found")

    player_settings = _get_player_settings(supabase, session_id, session_result.data)
    handedness = player_settings["handedness"]
    camera_facing_setting = player_settings["camera_facing"]

    # For auto-detection, sample from the FULL video (not just the window)
    # to avoid flip-flopping between "toward" and "away" on different windows
    if camera_facing_setting == "auto":
        full_sample = supabase.table("pose_analysis")\
            .select("keypoints")\
            .eq("session_id", session_id)\
            .order("frame_number")\
            .execute()
        resolved_facing = detect_camera_facing(full_sample.data if full_sample.data else [])
    else:
        resolved_facing = camera_facing_setting

    window = 5
    pose_result = supabase.table("pose_analysis")\
        .select("frame_number, timestamp, keypoints, joint_angles, body_metrics")\
        .eq("session_id", session_id)\
        .gte("frame_number", frame - window)\
        .lte("frame_number", frame + window)\
        .order("frame_number")\
        .execute()

    if not pose_result.data or len(pose_result.data) < 3:
        return {
            "session_id": session_id,
            "frame": frame,
            "error": "Not enough pose data around this frame",
            "frames_found": len(pose_result.data) if pose_result.data else 0,
        }

    frames_data = pose_result.data

    actual_hand = handedness
    if resolved_facing == "away":
        model_dom = "left" if actual_hand == "right" else "right"
        model_off = "right" if actual_hand == "right" else "left"
    else:
        model_dom = actual_hand
        model_off = "left" if actual_hand == "right" else "right"

    debug_frames = []
    for i in range(len(frames_data)):
        curr = frames_data[i]
        prev = frames_data[i - 1] if i >= 1 else None
        prev2 = frames_data[i - 2] if i >= 2 else None

        curr_angles = curr.get("joint_angles", {})
        prev_angles = prev.get("joint_angles", {}) if prev else {}
        prev2_angles = prev2.get("joint_angles", {}) if prev2 else {}

        curr_metrics = curr.get("body_metrics", {})
        prev_metrics = prev.get("body_metrics", {}) if prev else {}

        bw = _body_width(curr)
        nose = _get_kp(curr, "nose")
        nose_vis = nose.get("visibility", 0) if nose else 0

        dom_elbow = curr_angles.get(f"{model_dom}_elbow", 0)
        off_elbow = curr_angles.get(f"{model_off}_elbow", 0)
        dom_elbow_prev = prev_angles.get(f"{model_dom}_elbow", 0) if prev else 0
        dom_elbow_prev2 = prev2_angles.get(f"{model_dom}_elbow", 0) if prev2 else 0

        elbow_vel = abs(dom_elbow - dom_elbow_prev) if prev else 0
        elbow_delta_2f = (dom_elbow - dom_elbow_prev2) if prev2 else 0

        dom_shoulder = curr_angles.get(f"{model_dom}_shoulder", 0)
        dom_shoulder_prev = prev_angles.get(f"{model_dom}_shoulder", 0) if prev else 0
        shoulder_vel = abs(dom_shoulder - dom_shoulder_prev) if prev else 0

        wrist = _get_kp(curr, f"{model_dom}_wrist")
        prev_wrist = _get_kp(prev, f"{model_dom}_wrist") if prev else {}
        wx = wrist.get("x", 0)
        wy = wrist.get("y", 0)
        prev_wx = prev_wrist.get("x", 0)
        prev_wy = prev_wrist.get("y", 0)
        dx_norm = abs(wx - prev_wx) / bw if prev else 0
        dy_norm = abs(wy - prev_wy) / bw if prev else 0
        wrist_speed = (dx_norm**2 + dy_norm**2) ** 0.5

        shoulder_rot = curr_metrics.get("shoulder_rotation", 0)
        prev_shoulder_rot = prev_metrics.get("shoulder_rotation", 0) if prev else 0
        rot_delta = _normalize_angle_delta(shoulder_rot - prev_shoulder_rot) if prev else 0

        hip_rot = curr_metrics.get("hip_rotation", 0)
        prev_hip_rot = prev_metrics.get("hip_rotation", 0) if prev else 0
        hip_delta = _normalize_angle_delta(hip_rot - prev_hip_rot) if prev else 0

        ls = _get_kp(curr, "left_shoulder")
        rs = _get_kp(curr, "right_shoulder")
        mid_x = (ls.get("x", 0) + rs.get("x", 0)) / 2
        dom_wx = wrist.get("x", 0) if _visible(wrist) else 0
        wrist_relative = (dom_wx - mid_x) / bw if bw else 0

        elbow_strong = elbow_vel > 8
        shoulder_active = shoulder_vel > 4
        wrist_fast = wrist_speed > 0.12
        signal_count = sum([elbow_strong, shoulder_active, wrist_fast])

        effective_rot = rot_delta if resolved_facing == "toward" else -rot_delta
        effective_hip = hip_delta if resolved_facing == "toward" else -hip_delta
        effective_wrist_rel = wrist_relative if resolved_facing == "toward" else -wrist_relative

        fh_score = 0.0
        bh_score = 0.0
        if actual_hand == "right":
            if effective_rot < -1: fh_score += min(abs(effective_rot) / 5, 1.0)
            elif effective_rot > 1: bh_score += min(abs(effective_rot) / 5, 1.0)
            if effective_wrist_rel > 0.1: fh_score += 0.5
            elif effective_wrist_rel < -0.1: bh_score += 0.5
            if effective_hip < -0.5: fh_score += 0.3
            elif effective_hip > 0.5: bh_score += 0.3
        else:
            if effective_rot > 1: fh_score += min(abs(effective_rot) / 5, 1.0)
            elif effective_rot < -1: bh_score += min(abs(effective_rot) / 5, 1.0)
            if effective_wrist_rel < -0.1: fh_score += 0.5
            elif effective_wrist_rel > 0.1: bh_score += 0.5
            if effective_hip > 0.5: fh_score += 0.3
            elif effective_hip < -0.5: bh_score += 0.3

        would_classify = "forehand" if fh_score >= bh_score else "backhand"
        would_trigger = signal_count >= 2 and elbow_strong and elbow_delta_2f >= -5

        debug_frames.append({
            "frame_number": curr.get("frame_number"),
            "timestamp": round(curr.get("timestamp", 0), 4),
            "dom_elbow_angle": round(dom_elbow, 1),
            "off_elbow_angle": round(off_elbow, 1),
            "elbow_velocity": round(elbow_vel, 2),
            "elbow_delta_2f": round(elbow_delta_2f, 2),
            "dom_shoulder_angle": round(dom_shoulder, 1),
            "shoulder_velocity": round(shoulder_vel, 2),
            "wrist_x": round(wx, 1),
            "wrist_y": round(wy, 1),
            "wrist_speed_norm": round(wrist_speed, 4),
            "shoulder_rotation": round(shoulder_rot, 2),
            "shoulder_rotation_delta": round(rot_delta, 2),
            "hip_rotation": round(hip_rot, 2),
            "hip_rotation_delta": round(hip_delta, 2),
            "wrist_relative": round(wrist_relative, 4),
            "body_width": round(bw, 1),
            "nose_visibility": round(nose_vis, 3),
            "signals": {
                "elbow_strong": elbow_strong,
                "shoulder_active": shoulder_active,
                "wrist_fast": wrist_fast,
                "count": signal_count,
                "extension_ok": elbow_delta_2f >= -5,
            },
            "vote": {
                "fh_score": round(fh_score, 2),
                "bh_score": round(bh_score, 2),
                "would_classify": would_classify,
                "would_trigger": would_trigger,
            },
        })

    nearby_strokes = []
    try:
        strokes_result = supabase.table("stroke_analytics")\
            .select("stroke_type, peak_frame, form_score, start_frame, end_frame")\
            .eq("session_id", session_id)\
            .gte("peak_frame", frame - 10)\
            .lte("peak_frame", frame + 10)\
            .order("peak_frame")\
            .execute()
        if strokes_result.data:
            nearby_strokes = strokes_result.data
    except Exception:
        pass

    center_frame = next((f for f in frames_data if f.get("frame_number") == frame), frames_data[len(frames_data) // 2])

    return {
        "session_id": session_id,
        "frame": frame,
        "timestamp": round(center_frame.get("timestamp", 0), 4),
        "handedness": handedness,
        "camera_facing": camera_facing_setting,
        "resolved_facing": resolved_facing,
        "model_dominant_side": model_dom,
        "model_off_side": model_off,
        "detected_strokes_nearby": nearby_strokes,
        "frames": debug_frames,
    }
