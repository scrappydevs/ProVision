"""
Analytics API routes.
Provides comprehensive performance metrics and visualizations.
"""

from fastapi import APIRouter, HTTPException, Depends
from typing import Dict, Any
import logging
import time

from ..database.supabase import get_supabase, get_current_user_id
from ..services.analytics_service import compute_session_analytics
from ..services.runpod_dashboard_service import runpod_dashboard_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


# ── Health / diagnostics (no auth required) ────────────────────────
@router.get("/dashboard-health")
async def dashboard_health() -> Dict[str, Any]:
    """Quick diagnostic endpoint to verify RunPod dashboard pipeline is operational.

    Checks:
      1. SSH config is present
      2. SSH connection + basic remote commands work
      3. Inference repo & script exist on the GPU
      4. Supabase Storage bucket is reachable

    Hit via: GET /api/analytics/dashboard-health
    """
    checks: Dict[str, Any] = {}

    # 1. SSH config
    cfg = runpod_dashboard_service._ssh_config
    checks["ssh_configured"] = cfg.is_configured()
    checks["ssh_host"] = cfg.SSH_HOST or "(not set)"
    checks["ssh_port"] = cfg.SSH_PORT

    # 2. SSH connection + remote probe
    if cfg.is_configured():
        try:
            t0 = time.time()
            with runpod_dashboard_service.runner.ssh_session() as ssh:
                probe_cmd = (
                    "echo OK && "
                    "hostname && "
                    f"test -d {runpod_dashboard_service.repo_dir} && echo repo_exists=YES || echo repo_exists=NO && "
                    f"test -f {runpod_dashboard_service.repo_dir}/run_inference_full_video.py && echo script_exists=YES || echo script_exists=NO && "
                    "python3 --version 2>&1 && "
                    "nvidia-smi --query-gpu=name,memory.total,memory.free --format=csv,noheader 2>/dev/null || echo gpu=N/A"
                )
                exit_code, stdout, stderr = ssh.execute_command(probe_cmd, timeout=15)
            elapsed = round(time.time() - t0, 2)
            checks["ssh_connection"] = "ok" if exit_code == 0 else f"exit_code={exit_code}"
            checks["ssh_latency_sec"] = elapsed
            checks["remote_probe"] = stdout.strip() if stdout else stderr.strip()
        except Exception as exc:
            checks["ssh_connection"] = f"failed: {exc}"
    else:
        checks["ssh_connection"] = "skipped (not configured)"

    # 3. Supabase Storage bucket
    try:
        supabase = get_supabase()
        # listing root of the bucket is the cheapest check
        supabase.storage.from_(runpod_dashboard_service.bucket_name).list("", {"limit": 1})
        checks["supabase_bucket"] = "ok"
    except Exception as exc:
        checks["supabase_bucket"] = f"failed: {exc}"

    checks["all_ok"] = (
        checks.get("ssh_configured") is True
        and checks.get("ssh_connection") == "ok"
        and checks.get("supabase_bucket") == "ok"
    )
    return checks


def _with_runpod_dashboard(
    analytics: Dict[str, Any],
    *,
    user_id: str,
    session_id: str,
) -> Dict[str, Any]:
    """Attach dynamic RunPod artifact metadata to analytics payload."""
    payload = dict(analytics)
    try:
        payload["runpod_dashboard"] = runpod_dashboard_service.get_dashboard_payload(
            user_id=user_id,
            session_id=session_id,
        )
    except Exception as exc:
        logger.warning(f"Failed to load RunPod artifacts for {session_id}: {exc}")
        payload["runpod_dashboard"] = {
            "status": "error",
            "folder": runpod_dashboard_service.artifact_prefix(user_id, session_id),
            "artifacts": [],
            "error": str(exc),
        }
    return payload


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
        # Return empty analytics instead of 400 error
        logger.info(f"No trajectory data for session {session_id}, returning empty analytics")
        return {
            "session_id": session_id,
            "session_name": session_result.data.get("name", "Unnamed"),
            "ball_analytics": None,
            "pose_analytics": None,
            "correlation": None,
            "fps": 30.0,
            "video_info": {},
            "pose_frame_count": 0,
            "message": "Ball tracking not completed yet. Click 'Track' to analyze ball trajectory.",
        }

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
                    return _with_runpod_dashboard(
                        cache_row["analytics"],
                        user_id=user_id,
                        session_id=session_id,
                    )
        except Exception as e:
            logger.warning(f"Analytics cache lookup failed: {e}")
    
    # Fetch pose data (player only, person_id=0)
    pose_result = supabase.table("pose_analysis") \
        .select("frame_number, timestamp, keypoints, joint_angles, body_metrics, person_id") \
        .eq("session_id", session_id) \
        .eq("person_id", 0) \
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

    return _with_runpod_dashboard(
        analytics,
        user_id=user_id,
        session_id=session_id,
    )


@router.get("/{session_id}/runpod-artifacts")
async def get_runpod_artifacts(
    session_id: str,
    user_id: str = Depends(get_current_user_id),
) -> Dict[str, Any]:
    """Lightweight poll-friendly endpoint: list RunPod dashboard artifacts.

    Unlike the full analytics endpoint this does NOT require trajectory data,
    so it can be polled immediately after video upload while tracking is still
    running.
    """
    supabase = get_supabase()
    # Verify ownership
    session_result = (
        supabase.table("sessions")
        .select("id")
        .eq("id", session_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    if not session_result.data:
        raise HTTPException(status_code=404, detail="Session not found")

    return runpod_dashboard_service.get_dashboard_payload(
        user_id=user_id,
        session_id=session_id,
    )


@router.post("/{session_id}/runpod-dashboard")
async def run_session_dashboard_pipeline(
    session_id: str,
    force: bool = False,
    user_id: str = Depends(get_current_user_id),
) -> Dict[str, Any]:
    """Run dashboard analysis file on RunPod for this session's game video."""
    supabase = get_supabase()
    session_result = (
        supabase.table("sessions")
        .select("id, video_path")
        .eq("id", session_id)
        .eq("user_id", user_id)
        .single()
        .execute()
    )

    if not session_result.data:
        raise HTTPException(status_code=404, detail="Session not found")

    video_url = session_result.data.get("video_path")
    if not video_url:
        raise HTTPException(status_code=400, detail="Session has no video")

    try:
        return runpod_dashboard_service.run_dashboard_analysis(
            session_id=session_id,
            user_id=user_id,
            video_url=video_url,
            force=force,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"RunPod dashboard run failed: {exc}")
