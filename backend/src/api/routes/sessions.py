import os
import uuid
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, BackgroundTasks
from pydantic import BaseModel
from datetime import datetime

from ..database.supabase import get_supabase, get_current_user_id

router = APIRouter()

import logging
logger = logging.getLogger(__name__)


async def _run_tracknet_background(session_id: str, video_url: str):
    """Background task: run TrackNet ball tracking on newly uploaded video."""
    try:
        from ..services.sam2_service import sam2_service
        supabase = get_supabase()

        # Update status to processing
        supabase.table("sessions").update({"status": "processing"}).eq("id", session_id).execute()

        trajectory_data, video_info = await sam2_service.track_with_tracknet(
            session_id=session_id,
            video_url=video_url,
            frame=0,
        )

        trajectory_dict = {
            "frames": [f.model_dump() for f in trajectory_data.frames],
            "velocity": trajectory_data.velocity,
            "spin_estimate": trajectory_data.spin_estimate,
            "video_info": video_info,
        }

        supabase.table("sessions").update({
            "trajectory_data": trajectory_dict,
            "status": "ready",
        }).eq("id", session_id).execute()

        logger.info(f"TrackNet auto-tracking complete: session={session_id}, frames={len(trajectory_data.frames)}")
    except Exception as e:
        logger.error(f"TrackNet auto-tracking failed for {session_id}: {e}")
        try:
            supabase = get_supabase()
            supabase.table("sessions").update({"status": "failed"}).eq("id", session_id).execute()
        except Exception:
            pass


async def _run_pose_background(session_id: str, video_url: str):
    """Background task: run YOLO-pose on sampled frames and store in pose_analysis table."""
    try:
        from ..services.sam2_service import sam2_service
        supabase = get_supabase()

        # Get video info from the session's trajectory data (if available) or default
        session_result = supabase.table("sessions").select("trajectory_data").eq("id", session_id).single().execute()
        video_info = session_result.data.get("trajectory_data", {}).get("video_info", {}) if session_result.data else {}
        total_frames = video_info.get("total_frames", 300)
        fps_val = video_info.get("fps", 30)

        # Sample every 3rd frame for pose analysis
        sample_frames = list(range(0, min(total_frames, 900), 3))
        pose_rows = []

        for frame_num in sample_frames:
            try:
                result = await sam2_service.detect_poses(
                    session_id=session_id,
                    video_url=video_url,
                    frame=frame_num,
                )
                persons = result.get("persons", [])
                for person in persons:
                    kps = {kp["name"]: {"x": kp["x"] / (video_info.get("width", 1280)), "y": kp["y"] / (video_info.get("height", 828)), "z": 0, "visibility": kp["conf"]} for kp in person.get("keypoints", [])}
                    pose_rows.append({
                        "session_id": session_id,
                        "frame_number": frame_num,
                        "timestamp": frame_num / fps_val,
                        "person_id": person["id"],
                        "keypoints": kps,
                        "joint_angles": {},
                        "body_metrics": {"bbox_width": person["bbox"][2] - person["bbox"][0], "bbox_height": person["bbox"][3] - person["bbox"][1]},
                    })
            except Exception:
                continue

        if pose_rows:
            # Batch insert (insert in chunks of 50)
            for i in range(0, len(pose_rows), 50):
                try:
                    supabase.table("pose_analysis").insert(pose_rows[i:i+50]).execute()
                except Exception as e:
                    logger.warning(f"Pose insert batch failed: {e}")

        logger.info(f"Pose auto-analysis complete: session={session_id}, {len(pose_rows)} rows from {len(sample_frames)} frames")
    except Exception as e:
        logger.error(f"Pose auto-analysis failed for {session_id}: {e}")


class PlayerBrief(BaseModel):
    id: str
    name: str
    avatar_url: Optional[str] = None


class SessionResponse(BaseModel):
    id: str
    user_id: str
    name: str
    description: Optional[str] = None
    video_path: Optional[str] = None
    ego_video_path: Optional[str] = None
    pose_video_path: Optional[str] = None
    preview_frame_url: Optional[str] = None
    selected_player: Optional[dict] = None
    trajectory_data: Optional[dict] = None
    pose_data: Optional[dict] = None
    status: str
    created_at: str
    players: Optional[List[PlayerBrief]] = None


@router.post("", response_model=SessionResponse)
async def create_session(
    background_tasks: BackgroundTasks,
    video: UploadFile = File(...),
    name: str = Form(...),
    description: str = Form(None),
    player_ids: str = Form(None),
    user_id: str = Depends(get_current_user_id),
):
    """Create a new analysis session with video upload."""
    import traceback
    print(f"[DEBUG] Creating session for user: {user_id}")
    print(f"[DEBUG] Video filename: {video.filename}")
    print(f"[DEBUG] Session name: {name}")

    supabase = get_supabase()
    session_id = str(uuid.uuid4())

    video_content = await video.read()
    video_ext = os.path.splitext(video.filename or "video.mp4")[1]
    video_path = f"{user_id}/{session_id}/original{video_ext}"

    print(f"[DEBUG] Video path: {video_path}")

    try:
        supabase.storage.from_("provision-videos").upload(video_path, video_content)
        print(f"[DEBUG] Video uploaded successfully")
    except Exception as e:
        print(f"[ERROR] Failed to upload video: {str(e)}")
        print(f"[ERROR] Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Failed to upload video: {str(e)}")

    video_url = supabase.storage.from_("provision-videos").get_public_url(video_path)
    print(f"[DEBUG] Video URL: {video_url}")

    session_data = {
        "id": session_id,
        "user_id": user_id,
        "name": name,
        "description": description,
        "video_path": video_url,
        "status": "pending",
        "created_at": datetime.utcnow().isoformat(),
    }

    print(f"[DEBUG] Session data: {session_data}")

    try:
        result = supabase.table("sessions").insert(session_data).execute()
        print(f"[DEBUG] Session created successfully: {result.data}")

        # Link players if provided (comma-separated UUIDs)
        linked_players: List[PlayerBrief] = []
        if player_ids:
            import json
            try:
                pid_list = json.loads(player_ids) if player_ids.startswith("[") else [p.strip() for p in player_ids.split(",") if p.strip()]
            except Exception:
                pid_list = [p.strip() for p in player_ids.split(",") if p.strip()]

            for pid in pid_list:
                try:
                    supabase.table("game_players").insert({
                        "game_id": session_id,
                        "player_id": pid,
                    }).execute()
                except Exception as link_err:
                    print(f"[WARNING] Failed to link player {pid}: {str(link_err)}")

            if pid_list:
                players_result = supabase.table("players").select("id, name, avatar_url").in_("id", pid_list).execute()
                linked_players = [PlayerBrief(**p) for p in players_result.data]

        # Pose analysis disabled for debugging — can be re-enabled later
        # from ..routes.pose import process_pose_analysis
        # from ..utils.video_utils import extract_video_path_from_url
        # try:
        #     video_storage_path = extract_video_path_from_url(video_url)
        #     background_tasks.add_task(process_pose_analysis, session_id, video_storage_path, video_url)
        # except Exception as e:
        #     print(f"[WARNING] Failed to queue pose analysis: {str(e)}")
        # Auto-trigger TrackNet ball tracking in background
        try:
            background_tasks.add_task(
                _run_tracknet_background,
                session_id, video_url
            )
            background_tasks.add_task(
                _run_pose_background,
                session_id, video_url
            )
            print(f"[DEBUG] TrackNet + Pose queued for session {session_id}")
        except Exception as e:
            print(f"[WARNING] Failed to queue background tasks: {str(e)}")

        response_data = result.data[0]
        response_data["players"] = [p.model_dump() for p in linked_players]
        return SessionResponse(**response_data)
    except Exception as e:
        print(f"[ERROR] Failed to create session in DB: {str(e)}")
        print(f"[ERROR] Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Failed to create session: {str(e)}")


def _get_players_for_games(supabase, game_ids: List[str]) -> dict:
    """Fetch players for a list of game IDs. Returns {game_id: [PlayerBrief]}."""
    if not game_ids:
        return {}
    gp_result = supabase.table("game_players").select("game_id, player_id").in_("game_id", game_ids).execute()
    if not gp_result.data:
        return {}

    all_player_ids = list(set(gp["player_id"] for gp in gp_result.data))
    players_result = supabase.table("players").select("id, name, avatar_url").in_("id", all_player_ids).execute()
    player_map = {p["id"]: p for p in players_result.data}

    game_players_map: dict = {}
    for gp in gp_result.data:
        game_players_map.setdefault(gp["game_id"], [])
        player = player_map.get(gp["player_id"])
        if player:
            game_players_map[gp["game_id"]].append(PlayerBrief(**player))
    return game_players_map


@router.get("", response_model=List[SessionResponse])
async def list_sessions(user_id: str = Depends(get_current_user_id)):
    """List all sessions for the current user."""
    supabase = get_supabase()
    
    try:
        result = supabase.table("sessions").select("*").eq("user_id", user_id).order("created_at", desc=True).execute()
        game_ids = [s["id"] for s in result.data]
        players_map = _get_players_for_games(supabase, game_ids)

        sessions = []
        for session in result.data:
            session["players"] = [p.model_dump() for p in players_map.get(session["id"], [])]
            sessions.append(SessionResponse(**session))
        return sessions
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch sessions: {str(e)}")


@router.get("/{session_id}", response_model=SessionResponse)
async def get_session(session_id: str, user_id: str = Depends(get_current_user_id)):
    """Get a specific session by ID."""
    supabase = get_supabase()
    
    try:
        result = supabase.table("sessions").select("*").eq("id", session_id).eq("user_id", user_id).single().execute()
        if not result.data:
            raise HTTPException(status_code=404, detail="Session not found")

        players_map = _get_players_for_games(supabase, [session_id])
        result.data["players"] = [p.model_dump() for p in players_map.get(session_id, [])]
        return SessionResponse(**result.data)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch session: {str(e)}")


@router.delete("/{session_id}")
async def delete_session(session_id: str, user_id: str = Depends(get_current_user_id)):
    """Delete a session and its associated files."""
    supabase = get_supabase()
    
    try:
        result = supabase.table("sessions").select("*").eq("id", session_id).eq("user_id", user_id).single().execute()
        if not result.data:
            raise HTTPException(status_code=404, detail="Session not found")
        
        try:
            files = supabase.storage.from_("provision-videos").list(f"{user_id}/{session_id}")
            if files:
                paths = [f"{user_id}/{session_id}/{f['name']}" for f in files]
                supabase.storage.from_("provision-videos").remove(paths)
        except Exception:
            pass
        
        supabase.table("sessions").delete().eq("id", session_id).execute()
        return {"message": "Session deleted"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete session: {str(e)}")
