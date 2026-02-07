from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel
import traceback
import json
import uuid
from datetime import datetime, timezone, timedelta
from time import perf_counter

from ..database.supabase import get_supabase, get_current_user_id
from ..services.stroke_event_service import detect_strokes_hybrid

router = APIRouter()
STROKE_PROGRESS: Dict[str, Dict[str, Any]] = {}


def _parse_iso_datetime(value: Optional[str]) -> Optional[datetime]:
    if not value or not isinstance(value, str):
        return None
    try:
        normalized = value.replace("Z", "+00:00")
        parsed = datetime.fromisoformat(normalized)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed
    except Exception:
        return None


def _prune_stroke_progress() -> None:
    """
    Keep in-memory progress bounded. Drop stale completed/failed entries and cap map size.
    """
    now = datetime.now(timezone.utc)
    stale_cutoff = now - timedelta(minutes=30)

    stale_keys: List[str] = []
    for session_id, progress in STROKE_PROGRESS.items():
        status = progress.get("status")
        if status not in {"completed", "failed"}:
            continue
        ended_at = _parse_iso_datetime(progress.get("completed_at")) or _parse_iso_datetime(progress.get("started_at"))
        if ended_at and ended_at < stale_cutoff:
            stale_keys.append(session_id)

    for key in stale_keys:
        STROKE_PROGRESS.pop(key, None)

    max_entries = 300
    if len(STROKE_PROGRESS) <= max_entries:
        return

    ordered = sorted(
        STROKE_PROGRESS.items(),
        key=lambda item: _parse_iso_datetime(item[1].get("completed_at"))
        or _parse_iso_datetime(item[1].get("started_at"))
        or datetime.min.replace(tzinfo=timezone.utc),
    )
    overflow = len(STROKE_PROGRESS) - max_entries
    for session_id, _ in ordered[:overflow]:
        STROKE_PROGRESS.pop(session_id, None)


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
    strokes: List[StrokeResponse]


def _get_player_settings_for_session(supabase, session_id: str, session_data: dict = None) -> dict:
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


def _serialize_stroke_for_debug(stroke: Any) -> Dict[str, Any]:
    return {
        "start_frame": int(getattr(stroke, "start_frame", 0)),
        "end_frame": int(getattr(stroke, "end_frame", 0)),
        "peak_frame": int(getattr(stroke, "peak_frame", 0)),
        "stroke_type": str(getattr(stroke, "stroke_type", "unknown")),
        "duration": float(getattr(stroke, "duration", 0.0)),
        "max_velocity": float(getattr(stroke, "max_velocity", 0.0)),
        "form_score": float(getattr(stroke, "form_score", 0.0)),
        "metrics": getattr(stroke, "metrics", {}) or {},
    }


def _upload_debug_log_to_storage(
    supabase,
    *,
    user_id: Optional[str],
    session_id: str,
    run_id: str,
    payload: Dict[str, Any],
) -> Dict[str, Any]:
    if not user_id:
        return {"ok": False, "reason": "missing_user_id", "path": None, "url": None}

    storage_path = f"{user_id}/{session_id}/debug/stroke-analysis/{run_id}.json"
    try:
        content = json.dumps(payload, ensure_ascii=True, default=str, indent=2).encode("utf-8")
        supabase.storage.from_("provision-videos").upload(storage_path, content)
        url = supabase.storage.from_("provision-videos").get_public_url(storage_path)
        return {"ok": True, "reason": "ok", "path": storage_path, "url": url}
    except Exception as exc:
        return {"ok": False, "reason": str(exc), "path": storage_path, "url": None}


def _insert_or_update_debug_run(
    supabase,
    *,
    run_id: str,
    session_id: str,
    user_id: Optional[str],
    payload: Dict[str, Any],
) -> bool:
    if not user_id:
        return False
    try:
        row = {
            "id": run_id,
            "session_id": session_id,
            "user_id": user_id,
            **payload,
        }
        supabase.table("stroke_detection_debug_runs").upsert(row, on_conflict="id").execute()
        return True
    except Exception as exc:
        print(f"[StrokeDetection] Debug run DB write skipped: {exc}")
        return False


def process_stroke_detection(
    session_id: str,
    use_claude_classifier: bool = True,
    owner_user_id: Optional[str] = None,
):
    """
    Background task to detect strokes from pose analysis data.
    """
    supabase = get_supabase()

    run_id = str(uuid.uuid4())
    run_started_at = datetime.now(timezone.utc).isoformat()
    session_owner_id: Optional[str] = owner_user_id

    try:
        print(f"[StrokeDetection] Starting stroke detection for session: {session_id}")

        # Determine player handedness and camera facing
        player_settings = _get_player_settings_for_session(supabase, session_id)
        handedness = player_settings["handedness"]
        camera_facing = player_settings["camera_facing"]
        print(f"[StrokeDetection] Player handedness: {handedness}, camera_facing: {camera_facing}")

        classify_stage_id = "classify_events_claude" if use_claude_classifier else "classify_events_elbow"
        stage_order = [
            "load_session_metadata",
            "load_pose_data",
            "detect_pose_strokes",
            "detect_trajectory_reversals",
            "detect_contacts",
            "merge_detection_events",
            classify_stage_id,
            "infer_hitter",
            "build_final_strokes",
            "persist_results",
        ]
        stage_labels = {
            "load_session_metadata": "Load session metadata",
            "load_pose_data": "Load pose frames",
            "detect_pose_strokes": "Detect pose stroke proposals",
            "detect_trajectory_reversals": "Detect trajectory reversals",
            "detect_contacts": "Detect wrist-ball contacts",
            "merge_detection_events": "Merge detection events",
            "classify_events_claude": "Classify events (Claude)",
            "classify_events_elbow": "Classify events (Elbow trend)",
            "infer_hitter": "Infer hitter (player/opponent)",
            "build_final_strokes": "Build final strokes",
            "persist_results": "Persist stroke analytics",
        }
        stage_statuses: Dict[str, str] = {stage_id: "pending" for stage_id in stage_order}
        stage_timings_ms: Dict[str, float] = {}
        active_stage: Optional[str] = None

        def _set_in_memory_progress(
            status: str,
            debug_stats: Dict[str, Any],
            *,
            completed_at: Optional[str] = None,
            error: Optional[str] = None,
        ) -> None:
            payload: Dict[str, Any] = {
                "run_id": run_id,
                "session_id": session_id,
                "user_id": session_owner_id,
                "status": status,
                "started_at": run_started_at,
                "use_claude_classifier": bool(use_claude_classifier),
                "debug_stats": debug_stats,
            }
            if completed_at:
                payload["completed_at"] = completed_at
            if error:
                payload["error"] = error
            STROKE_PROGRESS[session_id] = payload
            _prune_stroke_progress()

        def _processing_debug_stats(extra: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
            payload: Dict[str, Any] = {
                "phase": "processing",
                "current_stage": active_stage,
                "stage_order": stage_order,
                "stage_labels": stage_labels,
                "stage_statuses": dict(stage_statuses),
                "stage_timings_ms": dict(stage_timings_ms),
                "pipeline_elapsed_ms": round(sum(stage_timings_ms.values()), 1),
                "use_claude_classifier": bool(use_claude_classifier),
            }
            if extra:
                payload.update(extra)
            return payload

        def _update_progress_stage(
            stage_id: str,
            status: str,
            duration_ms: Optional[float] = None,
            extra_debug: Optional[Dict[str, Any]] = None,
        ) -> None:
            nonlocal active_stage
            if stage_id:
                if stage_id not in stage_statuses:
                    stage_statuses[stage_id] = "pending"
                    stage_order.append(stage_id)
                stage_statuses[stage_id] = status
            if isinstance(duration_ms, (int, float)):
                stage_timings_ms[stage_id] = round(float(duration_ms), 1)
            if status == "running":
                active_stage = stage_id
            elif active_stage == stage_id and status in {"completed", "failed"}:
                active_stage = None

            current_debug_stats = _processing_debug_stats(extra_debug)
            _set_in_memory_progress("processing", current_debug_stats)

            _insert_or_update_debug_run(
                supabase,
                run_id=run_id,
                session_id=session_id,
                user_id=session_owner_id,
                payload={
                    "status": "processing",
                    "started_at": run_started_at,
                    "handedness": handedness,
                    "camera_facing": camera_facing,
                    "use_claude_classifier": use_claude_classifier,
                    "debug_stats": current_debug_stats,
                    "event_logs": [],
                    "final_strokes": [],
                },
            )

        # Session metadata needed for debug logging and Claude frame extraction
        _update_progress_stage("load_session_metadata", "running")
        session_meta_started = perf_counter()
        session_result = supabase.table("sessions")\
            .select("trajectory_data, video_path, user_id")\
            .eq("id", session_id)\
            .single()\
            .execute()
        session_meta_elapsed_ms = (perf_counter() - session_meta_started) * 1000.0

        trajectory_data = {}
        video_url = None
        if session_result.data:
            traj = session_result.data.get("trajectory_data")
            trajectory_data = traj if isinstance(traj, dict) else {}
            video_url = session_result.data.get("video_path")
            session_owner_id = session_result.data.get("user_id") or session_owner_id
        _update_progress_stage(
            "load_session_metadata",
            "completed",
            duration_ms=session_meta_elapsed_ms,
            extra_debug={
                "trajectory_frames": len((trajectory_data or {}).get("frames") or []),
                "video_url_present": bool(video_url),
            },
        )

        # Get pose analysis for tracked players (person_id 0=player, 1=opponent)
        _update_progress_stage("load_pose_data", "running")
        pose_load_started = perf_counter()
        pose_result = supabase.table("pose_analysis")\
            .select("*")\
            .eq("session_id", session_id)\
            .eq("person_id", 0)\
            .order("timestamp")\
            .execute()
        pose_load_elapsed_ms = (perf_counter() - pose_load_started) * 1000.0

        if not pose_result.data or len(pose_result.data) == 0:
            _update_progress_stage(
                "load_pose_data",
                "failed",
                duration_ms=pose_load_elapsed_ms,
                extra_debug={"error": "no_pose_data"},
            )
            print(f"[StrokeDetection] No pose data found for session: {session_id}")
            failed_at = datetime.now(timezone.utc).isoformat()
            # Mark analysis as failed
            supabase.table("sessions").update({
                "stroke_analysis_status": "failed"
            }).eq("id", session_id).execute()
            empty_payload = {
                "run_id": run_id,
                "session_id": session_id,
                "user_id": session_owner_id,
                "status": "failed",
                "started_at": run_started_at,
                "completed_at": failed_at,
                "error": "no_pose_data",
            }
            upload_result = _upload_debug_log_to_storage(
                supabase,
                user_id=session_owner_id,
                session_id=session_id,
                run_id=run_id,
                payload=empty_payload,
            )
            _insert_or_update_debug_run(
                supabase,
                run_id=run_id,
                session_id=session_id,
                user_id=session_owner_id,
                payload={
                    "status": "failed",
                    "started_at": run_started_at,
                    "completed_at": failed_at,
                    "handedness": handedness,
                    "camera_facing": camera_facing,
                    "use_claude_classifier": use_claude_classifier,
                    "debug_stats": _processing_debug_stats({"phase": "failed", "error": "no_pose_data"}),
                    "event_logs": [],
                    "final_strokes": [],
                    "storage_path": upload_result.get("path"),
                    "storage_url": upload_result.get("url"),
                    "error": "no_pose_data",
                },
            )
            return

        pose_frames_all = pose_result.data
        pose_frames = []
        for frame in pose_frames_all:
            try:
                person_id = int(frame.get("person_id", 0))
            except Exception:
                person_id = 0
            if person_id == 0:
                pose_frames.append(frame)
        if len(pose_frames_all) > 0 and len(pose_frames) > 0:
            _update_progress_stage(
                "load_pose_data",
                "completed",
                duration_ms=pose_load_elapsed_ms,
                extra_debug={
                    "pose_frames_all": len(pose_frames_all),
                    "pose_frames_player": len(pose_frames),
                },
            )
        if len(pose_frames) == 0:
            _update_progress_stage(
                "load_pose_data",
                "failed",
                duration_ms=pose_load_elapsed_ms,
                extra_debug={"error": "no_player_pose_data"},
            )
            print(f"[StrokeDetection] No player pose data (person_id=0) found for session: {session_id}")
            failed_at = datetime.now(timezone.utc).isoformat()
            # Mark analysis as failed
            supabase.table("sessions").update({
                "stroke_analysis_status": "failed"
            }).eq("id", session_id).execute()
            empty_payload = {
                "run_id": run_id,
                "session_id": session_id,
                "user_id": session_owner_id,
                "status": "failed",
                "started_at": run_started_at,
                "completed_at": failed_at,
                "error": "no_player_pose_data",
            }
            upload_result = _upload_debug_log_to_storage(
                supabase,
                user_id=session_owner_id,
                session_id=session_id,
                run_id=run_id,
                payload=empty_payload,
            )
            _insert_or_update_debug_run(
                supabase,
                run_id=run_id,
                session_id=session_id,
                user_id=session_owner_id,
                payload={
                    "status": "failed",
                    "started_at": run_started_at,
                    "completed_at": failed_at,
                    "handedness": handedness,
                    "camera_facing": camera_facing,
                    "use_claude_classifier": use_claude_classifier,
                    "debug_stats": _processing_debug_stats({"phase": "failed", "error": "no_player_pose_data"}),
                    "event_logs": [],
                    "final_strokes": [],
                    "storage_path": upload_result.get("path"),
                    "storage_url": upload_result.get("url"),
                    "error": "no_player_pose_data",
                },
            )
            return

        def _on_hybrid_progress(update: Dict[str, Any]) -> None:
            stage_id = str(update.get("stage_id") or "")
            status = str(update.get("status") or "running")
            duration_ms_raw = update.get("duration_ms")
            duration_ms = float(duration_ms_raw) if isinstance(duration_ms_raw, (int, float)) else None

            stage_timings_from_update = update.get("stage_timings_ms")
            if isinstance(stage_timings_from_update, dict):
                for key, val in stage_timings_from_update.items():
                    if isinstance(val, (int, float)):
                        stage_timings_ms[str(key)] = round(float(val), 1)
                        stage_statuses[str(key)] = "completed"

            if stage_id:
                if stage_id not in stage_labels:
                    stage_labels[stage_id] = stage_id.replace("_", " ").title()
                _update_progress_stage(stage_id, status, duration_ms=duration_ms)

        # Hybrid detection:
        # pose strokes + trajectory direction-change events + contact events,
        # then configured event classification (Claude or elbow-trend heuristic).
        strokes, debug_stats, detector, hybrid_debug_payload = detect_strokes_hybrid(
            session_id=session_id,
            pose_frames=pose_frames,
            all_pose_frames=pose_frames_all,
            trajectory_data=trajectory_data,
            video_url=video_url,
            handedness=handedness,
            camera_facing=camera_facing,
            use_claude_classifier=use_claude_classifier,
            progress_callback=_on_hybrid_progress,
        )

        _update_progress_stage("persist_results", "running")
        persist_started = perf_counter()

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
            "stroke_summary": summary,
            "stroke_analysis_status": "completed",
        }).eq("id", session_id).execute()

        persist_elapsed_ms = (perf_counter() - persist_started) * 1000.0
        _update_progress_stage(
            "persist_results",
            "completed",
            duration_ms=persist_elapsed_ms,
            extra_debug={"final_strokes": len(strokes)},
        )

        debug_strokes = [_serialize_stroke_for_debug(s) for s in strokes]
        run_completed_at = datetime.now(timezone.utc).isoformat()
        merged_debug_stats = dict(debug_stats or {})
        merged_debug_stats.update(
            {
                "phase": "completed",
                "current_stage": None,
                "stage_order": stage_order,
                "stage_labels": stage_labels,
                "stage_statuses": dict(stage_statuses),
                "stage_timings_ms": dict(stage_timings_ms),
                "pipeline_elapsed_ms": round(sum(stage_timings_ms.values()), 1),
                "use_claude_classifier": bool(use_claude_classifier),
            }
        )
        _set_in_memory_progress("completed", merged_debug_stats, completed_at=run_completed_at)
        debug_log_payload = {
            "run_id": run_id,
            "session_id": session_id,
            "user_id": session_owner_id,
            "status": "completed",
            "started_at": run_started_at,
            "completed_at": run_completed_at,
            "handedness": handedness,
            "camera_facing": camera_facing,
            "use_claude_classifier": use_claude_classifier,
            "hybrid_debug": hybrid_debug_payload,
            "debug_stats": merged_debug_stats,
            "final_strokes": debug_strokes,
        }
        upload_result = _upload_debug_log_to_storage(
            supabase,
            user_id=session_owner_id,
            session_id=session_id,
            run_id=run_id,
            payload=debug_log_payload,
        )

        _insert_or_update_debug_run(
            supabase,
            run_id=run_id,
            session_id=session_id,
            user_id=session_owner_id,
            payload={
                "status": "completed",
                "started_at": run_started_at,
                "completed_at": run_completed_at,
                "handedness": handedness,
                "camera_facing": camera_facing,
                "use_claude_classifier": use_claude_classifier,
                "debug_stats": merged_debug_stats,
                "event_logs": hybrid_debug_payload.get("events", []),
                "final_strokes": debug_strokes,
                "storage_path": upload_result.get("path"),
                "storage_url": upload_result.get("url"),
            },
        )

        print(f"[StrokeDetection] Completed stroke detection for session: {session_id}")
        print(f"[StrokeDetection] Summary: {summary}")

    except Exception as e:
        print(f"[StrokeDetection] Error processing session {session_id}: {str(e)}")
        tb = traceback.format_exc()
        print(f"[StrokeDetection] Traceback: {tb}")
        failed_at = datetime.now(timezone.utc).isoformat()
        # Mark analysis as failed
        try:
            supabase.table("sessions").update({
                "stroke_analysis_status": "failed"
            }).eq("id", session_id).execute()
        except Exception:
            pass
        error_payload = {
            "run_id": run_id,
            "session_id": session_id,
            "user_id": session_owner_id,
            "status": "failed",
            "started_at": run_started_at,
            "completed_at": failed_at,
            "error": str(e),
            "traceback": tb,
        }
        upload_result = _upload_debug_log_to_storage(
            supabase,
            user_id=session_owner_id,
            session_id=session_id,
            run_id=run_id,
            payload=error_payload,
        )
        failed_debug_stats: Dict[str, Any] = {"phase": "failed", "error": str(e)}
        if "stage_order" in locals() and "stage_labels" in locals():
            failed_debug_stats.update(
                {
                    "current_stage": locals().get("active_stage"),
                    "stage_order": locals().get("stage_order"),
                    "stage_labels": locals().get("stage_labels"),
                    "stage_statuses": dict(locals().get("stage_statuses", {})),
                    "stage_timings_ms": dict(locals().get("stage_timings_ms", {})),
                    "pipeline_elapsed_ms": round(sum(dict(locals().get("stage_timings_ms", {})).values()), 1),
                    "use_claude_classifier": bool(use_claude_classifier),
                }
            )
        _set_in_memory_progress("failed", failed_debug_stats, completed_at=failed_at, error=str(e))
        _insert_or_update_debug_run(
            supabase,
            run_id=run_id,
            session_id=session_id,
            user_id=session_owner_id,
            payload={
                "status": "failed",
                "started_at": run_started_at,
                "completed_at": failed_at,
                "debug_stats": failed_debug_stats,
                "event_logs": [],
                "final_strokes": [],
                "storage_path": upload_result.get("path"),
                "storage_url": upload_result.get("url"),
                "error": str(e),
            },
        )


class AnalyzeStrokesBody(BaseModel):
    use_claude_classifier: Optional[bool] = True


@router.post("/analyze/{session_id}")
async def analyze_strokes(
    session_id: str,
    background_tasks: BackgroundTasks,
    body: Optional[AnalyzeStrokesBody] = None,
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

    use_claude_classifier = body.use_claude_classifier if body is not None else True
    if use_claude_classifier is None:
        use_claude_classifier = True

    # Mark session as processing strokes
    supabase.table("sessions").update({
        "stroke_analysis_status": "processing"
    }).eq("id", session_id).execute()

    # Seed in-memory progress immediately so polling can avoid database lookups.
    _prune_stroke_progress()
    STROKE_PROGRESS[session_id] = {
        "run_id": str(uuid.uuid4()),
        "session_id": session_id,
        "user_id": user_id,
        "status": "processing",
        "started_at": datetime.now(timezone.utc).isoformat(),
        "use_claude_classifier": bool(use_claude_classifier),
        "debug_stats": {
            "phase": "queued",
            "current_stage": "load_session_metadata",
            "stage_order": [],
            "stage_labels": {},
            "stage_statuses": {},
            "stage_timings_ms": {},
            "pipeline_elapsed_ms": 0.0,
            "use_claude_classifier": bool(use_claude_classifier),
        },
    }

    # Add background task for stroke detection
    background_tasks.add_task(
        process_stroke_detection,
        session_id,
        bool(use_claude_classifier),
        user_id,
    )

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
        return StrokeSummaryResponse(
            session_id=session_id,
            average_form_score=0,
            best_form_score=0,
            consistency_score=0,
            total_strokes=0,
            forehand_count=0,
            backhand_count=0,
            strokes=[]
        )

    # Get summary from session
    stroke_summary = session.get("stroke_summary", {})

    if not stroke_summary:
        total = len(strokes_result.data)
        forehand = sum(1 for s in strokes_result.data if s.get("stroke_type") == "forehand")
        backhand = sum(1 for s in strokes_result.data if s.get("stroke_type") == "backhand")
        scores = [s.get("form_score") for s in strokes_result.data if isinstance(s.get("form_score"), (int, float))]
        avg_score = sum(scores) / len(scores) if scores else 0
        best_score = max(scores) if scores else 0
        stroke_summary = {
            "average_form_score": avg_score,
            "best_form_score": best_score,
            "consistency_score": 0,
            "total_strokes": total,
            "forehand_count": forehand,
            "backhand_count": backhand,
        }

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

    # Get pose frames for this stroke (player only, person_id=0)
    pose_frames_result = supabase.table("pose_analysis")\
        .select("*")\
        .eq("session_id", stroke["session_id"])\
        .eq("person_id", 0)\
        .gte("frame_number", stroke["start_frame"])\
        .lte("frame_number", stroke["end_frame"])\
        .order("frame_number")\
        .execute()

    return {
        "stroke": stroke,
        "pose_frames": pose_frames_result.data if pose_frames_result.data else []
    }


@router.get("/debug-runs/{session_id}")
async def get_stroke_debug_runs(
    session_id: str,
    limit: int = 20,
    user_id: str = Depends(get_current_user_id),
):
    """
    List stroke detection debug runs for a session.
    """
    supabase = get_supabase()

    # Verify ownership via session
    session_result = (
        supabase.table("sessions")
        .select("id")
        .eq("id", session_id)
        .eq("user_id", user_id)
        .single()
        .execute()
    )
    if not session_result.data:
        raise HTTPException(status_code=404, detail="Session not found")

    safe_limit = max(1, min(int(limit), 100))
    try:
        runs_result = (
            supabase.table("stroke_detection_debug_runs")
            .select(
                "id, session_id, status, started_at, completed_at, "
                "handedness, camera_facing, debug_stats, storage_path, storage_url, created_at, error"
            )
            .eq("session_id", session_id)
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(safe_limit)
            .execute()
        )
    except Exception as exc:
        msg = str(exc).lower()
        if "does not exist" in msg or "42p01" in msg or "stroke_detection_debug_runs" in msg:
            return {
                "session_id": session_id,
                "count": 0,
                "runs": [],
            }
        raise HTTPException(
            status_code=500,
            detail=f"Failed to load debug runs (ensure migration is applied): {exc}",
        )

    return {
        "session_id": session_id,
        "count": len(runs_result.data or []),
        "runs": runs_result.data or [],
    }


@router.get("/debug-run/{run_id}")
async def get_stroke_debug_run(
    run_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """
    Get full payload for a stroke detection debug run.
    """
    supabase = get_supabase()
    try:
        run_result = (
            supabase.table("stroke_detection_debug_runs")
            .select("*")
            .eq("id", run_id)
            .eq("user_id", user_id)
            .single()
            .execute()
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to load debug run (ensure migration is applied): {exc}",
        )

    if not run_result.data:
        raise HTTPException(status_code=404, detail="Debug run not found")

    run_data = run_result.data
    signed_log_url = None
    storage_path = run_data.get("storage_path")
    if storage_path:
        try:
            signed = supabase.storage.from_("provision-videos").create_signed_url(storage_path, 3600)
            if isinstance(signed, dict):
                signed_log_url = signed.get("signedURL") or signed.get("signed_url") or signed.get("signedUrl")
        except Exception:
            signed_log_url = None

    return {
        "run": run_data,
        "signed_log_url": signed_log_url,
    }


@router.get("/progress/{session_id}")
async def get_stroke_progress(
    session_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """
    Get in-memory stroke pipeline progress for a session.
    """
    progress = STROKE_PROGRESS.get(session_id)
    if progress:
        progress_user_id = progress.get("user_id")
        if progress_user_id and progress_user_id != user_id:
            raise HTTPException(status_code=404, detail="Session not found")
        if progress_user_id == user_id:
            return {
                "session_id": session_id,
                "progress": progress,
            }

    # Fallback ownership verification when no in-memory progress is available.
    supabase = get_supabase()
    session_result = (
        supabase.table("sessions")
        .select("id")
        .eq("id", session_id)
        .eq("user_id", user_id)
        .single()
        .execute()
    )
    if not session_result.data:
        raise HTTPException(status_code=404, detail="Session not found")

    return {
        "session_id": session_id,
        "progress": progress,
    }
