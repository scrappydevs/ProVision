"""
Analytics API routes.
Provides comprehensive performance metrics and visualizations.
"""

from fastapi import APIRouter, HTTPException, Depends
from typing import Dict, Any
import logging

from ..database.supabase import get_supabase
from ..services.analytics_service import compute_session_analytics
from ..routes.sessions import get_current_user_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


@router.get("/{session_id}")
async def get_session_analytics(
    session_id: str,
    force: bool = False,
    user_id: str = Depends(get_current_user_id)
) -> Dict[str, Any]:
    """
    Get comprehensive analytics for a session.
    
    Returns:
        Complete analytics including ball performance, pose metrics, and correlations
    """
    supabase = get_supabase()
    
    # Fetch session with trajectory data
    session_result = supabase.table("sessions") \
        .select("trajectory_data, name, updated_at") \
        .eq("id", session_id) \
        .eq("user_id", user_id) \
        .single() \
        .execute()
    
    if not session_result.data:
        raise HTTPException(status_code=404, detail="Session not found")
    
    trajectory_data = session_result.data.get("trajectory_data")
    if not trajectory_data or not trajectory_data.get("frames"):
        raise HTTPException(
            status_code=400,
            detail="No trajectory data available. Ball tracking must be completed first."
        )

    session_updated_at = session_result.data.get("updated_at")
    session_updated_at_norm = (
        session_updated_at.isoformat()
        if hasattr(session_updated_at, "isoformat")
        else str(session_updated_at)
        if session_updated_at is not None
        else None
    )

    # Check cached analytics (skip if forcing recompute)
    if not force:
        try:
            cache_result = supabase.table("session_analytics") \
                .select("analytics, session_updated_at") \
                .eq("session_id", session_id) \
                .eq("user_id", user_id) \
                .limit(1) \
                .execute()
            if cache_result.data:
                cache_row = cache_result.data[0]
                cache_updated = cache_row.get("session_updated_at")
                cache_updated_norm = (
                    cache_updated.isoformat()
                    if hasattr(cache_updated, "isoformat")
                    else str(cache_updated)
                    if cache_updated is not None
                    else None
                )
                if cache_row.get("analytics") and session_updated_at_norm and cache_updated_norm == session_updated_at_norm:
                    return cache_row["analytics"]
        except Exception as e:
            logger.warning(f"Analytics cache lookup failed: {e}")
    
    # Fetch pose data
    pose_result = supabase.table("pose_analysis") \
        .select("frame_number, timestamp, keypoints, joint_angles, body_metrics") \
        .eq("session_id", session_id) \
        .order("frame_number") \
        .execute()
    
    pose_data = pose_result.data or []
    
    # Get FPS from trajectory video_info
    video_info = trajectory_data.get("video_info", {})
    fps = video_info.get("fps", 30.0)
    
    # Compute analytics
    analytics = await compute_session_analytics(
        session_id=session_id,
        trajectory_data=trajectory_data,
        pose_data=pose_data,
        fps=fps
    )
    
    # Add session metadata
    analytics["session_name"] = session_result.data.get("name", "Unnamed")
    analytics["fps"] = fps
    analytics["video_info"] = video_info
    analytics["pose_frame_count"] = len(pose_data)
    analytics["session_updated_at"] = session_updated_at_norm

    # Cache analytics for future requests
    try:
        supabase.table("session_analytics").upsert({
            "session_id": session_id,
            "user_id": user_id,
            "analytics": analytics,
            "session_updated_at": session_updated_at_norm
        }, on_conflict="session_id").execute()
    except Exception as e:
        logger.warning(f"Analytics cache write failed: {e}")
    
    return analytics
