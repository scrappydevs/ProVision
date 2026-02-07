from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel
import traceback

from ..database.supabase import get_supabase, get_current_user_id
from ..services.stroke_detector import StrokeDetector, Stroke

router = APIRouter()


class StrokeResponse(BaseModel):
    id: str
    session_id: str
    start_frame: int
    end_frame: int
    peak_frame: int
    stroke_type: str
    duration: float
    max_velocity: float
    form_score: float
    metrics: dict


class StrokeSummaryResponse(BaseModel):
    session_id: str
    average_form_score: float
    best_form_score: float
    consistency_score: float
    total_strokes: int
    forehand_count: int
    backhand_count: int
    serve_count: int
    strokes: List[StrokeResponse]


def _get_handedness_for_session(supabase, session_id: str) -> str:
    """Look up the handedness of the player linked to this session."""
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


def process_stroke_detection(session_id: str):
    """
    Background task to detect strokes from pose analysis data.
    """
    supabase = get_supabase()

    try:
        print(f"[StrokeDetection] Starting stroke detection for session: {session_id}")

        # Determine player handedness
        handedness = _get_handedness_for_session(supabase, session_id)
        print(f"[StrokeDetection] Player handedness: {handedness}")

        # Get all pose analysis data for the session
        pose_result = supabase.table("pose_analysis")\
            .select("*")\
            .eq("session_id", session_id)\
            .order("timestamp")\
            .execute()

        if not pose_result.data or len(pose_result.data) == 0:
            print(f"[StrokeDetection] No pose data found for session: {session_id}")
            return

        pose_frames = pose_result.data
        print(f"[StrokeDetection] Analyzing {len(pose_frames)} frames")

        # Initialize stroke detector with handedness
        detector = StrokeDetector(
            velocity_threshold=50.0,
            min_stroke_duration=5,
            max_stroke_duration=60,
            handedness=handedness,
        )

        # Detect strokes
        strokes = detector.detect_strokes(pose_frames)
        print(f"[StrokeDetection] Detected {len(strokes)} strokes")

        # Delete existing stroke analytics for this session
        supabase.table("stroke_analytics").delete().eq("session_id", session_id).execute()

        # Store each stroke in database
        for stroke in strokes:
            supabase.table("stroke_analytics").insert({
                "session_id": session_id,
                "start_frame": stroke.start_frame,
                "end_frame": stroke.end_frame,
                "peak_frame": stroke.peak_frame,
                "stroke_type": stroke.stroke_type,
                "duration": stroke.duration,
                "max_velocity": stroke.max_velocity,
                "form_score": stroke.form_score,
                "metrics": stroke.metrics
            }).execute()

        # Calculate overall statistics
        summary = detector.calculate_overall_form_score(strokes)

        # Update session with stroke summary
        supabase.table("sessions").update({
            "stroke_summary": summary
        }).eq("id", session_id).execute()

        print(f"[StrokeDetection] Completed stroke detection for session: {session_id}")
        print(f"[StrokeDetection] Summary: {summary}")

    except Exception as e:
        print(f"[StrokeDetection] Error processing session {session_id}: {str(e)}")
        print(f"[StrokeDetection] Traceback: {traceback.format_exc()}")


@router.post("/analyze/{session_id}")
async def analyze_strokes(
    session_id: str,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_current_user_id),
):
    """
    Trigger stroke detection for a session.
    Requires pose analysis to be completed first.
    """
    supabase = get_supabase()

    # Verify session exists and belongs to user
    result = supabase.table("sessions").select("*").eq("id", session_id).eq("user_id", user_id).single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Session not found")

    session = result.data

    # Check if pose video or pose data exists (don't rely on status field)
    if not session.get("pose_video_path"):
        pose_count = supabase.table("pose_analysis").select("id", count="exact").eq("session_id", session_id).execute()
        if not pose_count.data or pose_count.count == 0:
            raise HTTPException(status_code=400, detail="Pose analysis must be completed first. No pose video or pose data found.")

    # Add background task for stroke detection
    background_tasks.add_task(process_stroke_detection, session_id)

    return {
        "status": "processing",
        "session_id": session_id,
        "message": "Stroke detection started."
    }


@router.get("/summary/{session_id}", response_model=StrokeSummaryResponse)
async def get_stroke_summary(
    session_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """
    Get stroke analysis summary for a session.
    """
    supabase = get_supabase()

    # Verify session exists and belongs to user
    session_result = supabase.table("sessions").select("*").eq("id", session_id).eq("user_id", user_id).single().execute()
    if not session_result.data:
        raise HTTPException(status_code=404, detail="Session not found")

    session = session_result.data

    # Get all strokes for the session
    strokes_result = supabase.table("stroke_analytics")\
        .select("*")\
        .eq("session_id", session_id)\
        .order("start_frame")\
        .execute()

    if not strokes_result.data:
        raise HTTPException(status_code=404, detail="No stroke data found. Run stroke analysis first.")

    # Get summary from session
    stroke_summary = session.get("stroke_summary", {})

    if not stroke_summary:
        raise HTTPException(status_code=404, detail="Stroke summary not available")

    # Format strokes
    strokes = [
        StrokeResponse(
            id=s["id"],
            session_id=s["session_id"],
            start_frame=s["start_frame"],
            end_frame=s["end_frame"],
            peak_frame=s["peak_frame"],
            stroke_type=s["stroke_type"],
            duration=s["duration"],
            max_velocity=s["max_velocity"],
            form_score=s["form_score"],
            metrics=s["metrics"]
        )
        for s in strokes_result.data
    ]

    return StrokeSummaryResponse(
        session_id=session_id,
        average_form_score=stroke_summary.get("average_form_score", 0),
        best_form_score=stroke_summary.get("best_form_score", 0),
        consistency_score=stroke_summary.get("consistency_score", 0),
        total_strokes=stroke_summary.get("total_strokes", 0),
        forehand_count=stroke_summary.get("forehand_count", 0),
        backhand_count=stroke_summary.get("backhand_count", 0),
        serve_count=stroke_summary.get("serve_count", 0),
        strokes=strokes
    )


@router.get("/strokes/{session_id}")
async def get_strokes(
    session_id: str,
    stroke_type: Optional[str] = None,
    user_id: str = Depends(get_current_user_id),
):
    """
    Get all strokes for a session, optionally filtered by type.
    """
    supabase = get_supabase()

    # Verify session exists and belongs to user
    result = supabase.table("sessions").select("id").eq("id", session_id).eq("user_id", user_id).single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Session not found")

    # Build query
    query = supabase.table("stroke_analytics").select("*").eq("session_id", session_id)

    if stroke_type:
        query = query.eq("stroke_type", stroke_type)

    strokes_result = query.order("start_frame").execute()

    if not strokes_result.data:
        return {
            "session_id": session_id,
            "count": 0,
            "strokes": []
        }

    return {
        "session_id": session_id,
        "count": len(strokes_result.data),
        "strokes": strokes_result.data
    }


@router.get("/stroke/{stroke_id}")
async def get_stroke_detail(
    stroke_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """
    Get detailed information about a specific stroke.
    """
    supabase = get_supabase()

    # Get stroke
    stroke_result = supabase.table("stroke_analytics").select("*").eq("id", stroke_id).single().execute()
    if not stroke_result.data:
        raise HTTPException(status_code=404, detail="Stroke not found")

    stroke = stroke_result.data

    # Verify session belongs to user
    session_result = supabase.table("sessions").select("id").eq("id", stroke["session_id"]).eq("user_id", user_id).single().execute()
    if not session_result.data:
        raise HTTPException(status_code=404, detail="Session not found")

    # Get pose frames for this stroke
    pose_frames_result = supabase.table("pose_analysis")\
        .select("*")\
        .eq("session_id", stroke["session_id"])\
        .gte("frame_number", stroke["start_frame"])\
        .lte("frame_number", stroke["end_frame"])\
        .order("frame_number")\
        .execute()

    return {
        "stroke": stroke,
        "pose_frames": pose_frames_result.data if pose_frames_result.data else []
    }
