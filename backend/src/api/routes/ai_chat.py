import os
import logging
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..database.supabase import get_supabase, get_current_user_id

logger = logging.getLogger(__name__)
router = APIRouter()

SYSTEM_PROMPT = """You are an elite AI table tennis coaching analyst for ProVision.
You have deep knowledge of table tennis technique, biomechanics, training methodology, and match strategy.

You are provided with rich context about the player, their recordings, match history, stroke analysis, and performance data.
Use this data to give highly specific, actionable coaching advice.

Formatting rules:
- Use **bold** for key terms and metrics
- Be concise but insightful — coaches are busy
- Reference specific data points (form scores, stroke counts, match results)
- When suggesting improvements, be specific about the body mechanics
- If asked to summarize, give a structured overview with strengths and areas to improve
- If no data is available for something, say so honestly rather than guessing"""


class ChatRequest(BaseModel):
    message: str
    session_id: str = ""
    player_id: Optional[str] = None
    player_name: Optional[str] = None
    context_summary: Optional[str] = None
    history: Optional[List[dict]] = None


class ChatResponse(BaseModel):
    response: str
    tool_calls: List[dict] = []


def _gather_player_context(player_id: str, user_id: str) -> str:
    """Pull comprehensive player data from DB."""
    supabase = get_supabase()
    parts = []

    try:
        # Player profile
        player = supabase.table("players").select(
            "name, position, team, notes, handedness, is_active, ittf_id, ittf_data, created_at"
        ).eq("id", player_id).eq("coach_id", user_id).single().execute()

        if player.data:
            p = player.data
            parts.append(f"## Player Profile\n"
                         f"Name: {p['name']}\n"
                         f"Handedness: {p.get('handedness', 'unknown')}\n"
                         f"Position: {p.get('position') or 'not set'}\n"
                         f"Team: {p.get('team') or 'not set'}\n"
                         f"Active: {p.get('is_active', True)}\n"
                         f"Notes: {p.get('notes') or 'none'}")

            # ITTF data
            ittf = p.get("ittf_data")
            if ittf:
                parts.append(f"\n## ITTF Data\n"
                             f"Ranking: {ittf.get('ranking', 'N/A')}\n"
                             f"Career best: {ittf.get('career_best_ranking', 'N/A')}\n"
                             f"Nationality: {ittf.get('nationality', 'N/A')}\n"
                             f"Playing style: {ittf.get('playing_style', 'N/A')}\n"
                             f"Career W/L: {ittf.get('career_wins', 0)}/{ittf.get('career_losses', 0)}\n"
                             f"Senior titles: {ittf.get('senior_titles', 0)}")
                recent = ittf.get("recent_matches", [])
                if recent:
                    parts.append("Recent ITTF matches:")
                    for m in recent[:5]:
                        parts.append(f"  - vs {m.get('opponent', '?')} at {m.get('tournament', '?')}: "
                                     f"{m.get('score', '?')} ({m.get('result', '?')})")
    except Exception as e:
        logger.warning(f"Failed to get player profile: {e}")

    try:
        # Recordings
        recs = supabase.table("recordings").select(
            "id, title, type, session_id, duration, created_at, clip_start_time, clip_end_time"
        ).eq("player_id", player_id).order("created_at", desc=True).limit(15).execute()

        if recs.data:
            parts.append(f"\n## Recordings ({len(recs.data)} total)")
            for r in recs.data:
                analyzed = "analyzed" if r.get("session_id") else "not analyzed"
                dur = f"{r['duration']:.0f}s" if r.get("duration") else "unknown length"
                parts.append(f"  - {r['title']} [{r['type']}] ({analyzed}, {dur})")
    except Exception as e:
        logger.warning(f"Failed to get recordings: {e}")

    try:
        # Game sessions for this player (via game_players junction)
        gp = supabase.table("game_players").select("game_id").eq("player_id", player_id).execute()
        if gp.data:
            game_ids = [g["game_id"] for g in gp.data]
            sessions = supabase.table("sessions").select(
                "id, name, status, created_at, stroke_summary, trajectory_data"
            ).in_("id", game_ids).order("created_at", desc=True).limit(10).execute()

            if sessions.data:
                parts.append(f"\n## Game Sessions ({len(sessions.data)} recent)")
                for s in sessions.data:
                    ss = s.get("stroke_summary") or {}
                    traj = s.get("trajectory_data") or {}
                    frames = len(traj.get("frames", []))
                    strokes_info = ""
                    if ss:
                        strokes_info = (f"  Strokes: {ss.get('total_strokes', 0)} "
                                        f"(FH:{ss.get('forehand_count', 0)} BH:{ss.get('backhand_count', 0)}) "
                                        f"Avg form: {ss.get('average_form_score', 0):.1f} "
                                        f"Best: {ss.get('best_form_score', 0):.1f} "
                                        f"Consistency: {ss.get('consistency_score', 0):.1f}")
                    parts.append(f"  - {s['name']} [{s['status']}] "
                                 f"{'(' + str(frames) + ' trajectory frames)' if frames else ''}")
                    if strokes_info:
                        parts.append(strokes_info)
    except Exception as e:
        logger.warning(f"Failed to get sessions: {e}")

    try:
        # Stroke analytics across all their sessions
        gp = supabase.table("game_players").select("game_id").eq("player_id", player_id).execute()
        if gp.data:
            game_ids = [g["game_id"] for g in gp.data]
            strokes = supabase.table("stroke_analytics").select(
                "session_id, stroke_type, form_score, max_velocity, duration, metrics"
            ).in_("session_id", game_ids).order("created_at", desc=True).limit(50).execute()

            if strokes.data:
                fh = [s for s in strokes.data if s.get("stroke_type") == "forehand"]
                bh = [s for s in strokes.data if s.get("stroke_type") == "backhand"]
                fh_scores = [s["form_score"] for s in fh if s.get("form_score")]
                bh_scores = [s["form_score"] for s in bh if s.get("form_score")]

                parts.append(f"\n## Stroke Analytics (across all sessions)")
                parts.append(f"Total analyzed: {len(strokes.data)} strokes ({len(fh)} FH, {len(bh)} BH)")
                if fh_scores:
                    parts.append(f"Forehand form: avg {sum(fh_scores)/len(fh_scores):.1f}, "
                                 f"best {max(fh_scores):.1f}, worst {min(fh_scores):.1f}")
                if bh_scores:
                    parts.append(f"Backhand form: avg {sum(bh_scores)/len(bh_scores):.1f}, "
                                 f"best {max(bh_scores):.1f}, worst {min(bh_scores):.1f}")

                # Detailed metrics from a recent stroke
                recent_with_metrics = [s for s in strokes.data if s.get("metrics")]
                if recent_with_metrics:
                    m = recent_with_metrics[0]["metrics"]
                    metric_keys = list(m.keys())[:10]
                    metrics_str = ", ".join(f"{k}: {m[k]}" for k in metric_keys if m.get(k) is not None)
                    if metrics_str:
                        parts.append(f"Recent stroke metrics: {metrics_str}")
    except Exception as e:
        logger.warning(f"Failed to get stroke analytics: {e}")

    try:
        # Tournament matchups
        matchups = supabase.table("tournament_matchups").select(
            "opponent_name, opponent_ranking, round, result, score, notes, tournaments(name)"
        ).eq("player_id", player_id).order("created_at", desc=True).limit(10).execute()

        if matchups.data:
            parts.append(f"\n## Tournament History ({len(matchups.data)} matchups)")
            for m in matchups.data:
                tourn = m.get("tournaments", {})
                t_name = tourn.get("name", "?") if isinstance(tourn, dict) else "?"
                result = m.get("result", "pending")
                parts.append(f"  - vs {m['opponent_name']} "
                             f"(rank: {m.get('opponent_ranking', '?')}) "
                             f"at {t_name} [{m.get('round', '?')}]: "
                             f"{result} {m.get('score', '')}")
    except Exception as e:
        logger.warning(f"Failed to get matchups: {e}")

    return "\n".join(parts) if parts else "No player data found."


def _gather_session_context(session_id: str, user_id: str) -> str:
    """Pull comprehensive session/game data from DB."""
    supabase = get_supabase()
    parts = []

    try:
        session = supabase.table("sessions").select(
            "name, status, video_path, pose_video_path, ego_video_path, "
            "trajectory_data, pose_data, stroke_summary, camera_facing, created_at"
        ).eq("id", session_id).eq("user_id", user_id).single().execute()

        if not session.data:
            return "Session not found."

        s = session.data
        parts.append(f"## Game Session\n"
                     f"Name: {s['name']}\n"
                     f"Status: {s['status']}\n"
                     f"Has video: {bool(s.get('video_path'))}\n"
                     f"Has pose overlay: {bool(s.get('pose_video_path'))}\n"
                     f"Has ego view: {bool(s.get('ego_video_path'))}\n"
                     f"Camera facing: {s.get('camera_facing', 'auto')}")

        # Trajectory data
        traj = s.get("trajectory_data") or {}
        frames = traj.get("frames", [])
        velocity = traj.get("velocity", [])
        if frames:
            avg_v = sum(velocity) / len(velocity) if velocity else 0
            peak_v = max(velocity) if velocity else 0
            parts.append(f"\n## Ball Tracking\n"
                         f"Frames tracked: {len(frames)}\n"
                         f"Avg speed: {avg_v:.1f} px/frame\n"
                         f"Peak speed: {peak_v:.1f} px/frame\n"
                         f"Spin estimate: {traj.get('spin_estimate', 'unknown')}")

        # Stroke summary
        ss = s.get("stroke_summary") or {}
        if ss:
            parts.append(f"\n## Stroke Summary\n"
                         f"Total: {ss.get('total_strokes', 0)} "
                         f"(FH: {ss.get('forehand_count', 0)}, BH: {ss.get('backhand_count', 0)})\n"
                         f"Avg form: {ss.get('average_form_score', 0):.1f}/100\n"
                         f"Best form: {ss.get('best_form_score', 0):.1f}/100\n"
                         f"Consistency: {ss.get('consistency_score', 0):.1f}/100")

    except Exception as e:
        logger.warning(f"Failed to get session: {e}")

    try:
        # Detailed stroke analytics for this session
        strokes = supabase.table("stroke_analytics").select(
            "stroke_type, form_score, max_velocity, duration, peak_frame, start_frame, end_frame, metrics"
        ).eq("session_id", session_id).order("start_frame").execute()

        if strokes.data:
            parts.append(f"\n## Individual Strokes ({len(strokes.data)})")
            for i, st in enumerate(strokes.data[:20], 1):
                m = st.get("metrics") or {}
                metrics_str = ""
                if m:
                    interesting = {k: v for k, v in m.items()
                                   if v is not None and k in (
                                       "elbow_angle_at_contact", "shoulder_rotation",
                                       "hip_rotation", "wrist_snap_speed",
                                       "contact_height", "follow_through_angle",
                                       "stance_width", "knee_bend")}
                    if interesting:
                        metrics_str = " | " + ", ".join(f"{k}: {v}" for k, v in interesting.items())
                parts.append(f"  {i}. {st['stroke_type']} — form: {st.get('form_score', 0):.0f} "
                             f"vel: {st.get('max_velocity', 0):.1f} "
                             f"dur: {st.get('duration', 0):.2f}s{metrics_str}")
    except Exception as e:
        logger.warning(f"Failed to get stroke analytics: {e}")

    try:
        # Pose analysis summary (sample a few frames)
        pose = supabase.table("pose_analysis").select(
            "frame_number, keypoints, joint_angles, body_metrics"
        ).eq("session_id", session_id).order("frame_number").limit(5).execute()

        if pose.data:
            parts.append(f"\n## Pose Analysis (sampled {len(pose.data)} frames)")
            for frame in pose.data[:3]:
                ja = frame.get("joint_angles") or {}
                bm = frame.get("body_metrics") or {}
                if ja:
                    angles_str = ", ".join(f"{k}: {v}" for k, v in list(ja.items())[:6])
                    parts.append(f"  Frame {frame['frame_number']}: {angles_str}")
                if bm:
                    metrics_str = ", ".join(f"{k}: {v}" for k, v in list(bm.items())[:4])
                    parts.append(f"    Body: {metrics_str}")
    except Exception as e:
        logger.warning(f"Failed to get pose analysis: {e}")

    # Players in this session
    try:
        gp = supabase.table("game_players").select(
            "players(id, name, handedness, team)"
        ).eq("game_id", session_id).execute()

        if gp.data:
            parts.append("\n## Players in Session")
            for g in gp.data:
                p = g.get("players", {})
                if isinstance(p, dict) and p.get("name"):
                    parts.append(f"  - {p['name']} ({p.get('handedness', '?')}-handed, "
                                 f"team: {p.get('team', 'none')})")
    except Exception as e:
        logger.warning(f"Failed to get players: {e}")

    return "\n".join(parts) if parts else "No session data found."


@router.post("/chat", response_model=ChatResponse)
async def ai_chat(
    request: ChatRequest,
    user_id: str = Depends(get_current_user_id),
):
    anthropic_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not anthropic_key:
        raise HTTPException(
            status_code=500,
            detail="ANTHROPIC_API_KEY not configured. Add it to Infisical.",
        )

    # Gather rich context from DB
    context_parts = []

    if request.player_id:
        player_ctx = _gather_player_context(request.player_id, user_id)
        context_parts.append(player_ctx)

    if request.session_id:
        session_ctx = _gather_session_context(request.session_id, user_id)
        context_parts.append(session_ctx)

    if request.context_summary:
        context_parts.append(f"\n## Frontend Context\n{request.context_summary}")

    full_context = "\n\n".join(context_parts) if context_parts else "No specific context available."

    system_prompt = f"""{SYSTEM_PROMPT}

--- DATA CONTEXT ---
{full_context}
--- END CONTEXT ---"""

    # Build conversation messages
    messages = []

    if request.history:
        for msg in request.history[-12:]:
            if msg.get("role") in ("user", "assistant"):
                messages.append({"role": msg["role"], "content": msg["content"]})

    messages.append({"role": "user", "content": request.message})

    try:
        import anthropic

        client = anthropic.Anthropic(api_key=anthropic_key)

        response = client.messages.create(
            model="claude-3-5-haiku-latest",
            max_tokens=2048,
            system=system_prompt,
            messages=messages,
        )

        text = response.content[0].text if response.content else ""
        logger.info("AI response via Anthropic")
        return ChatResponse(response=text, tool_calls=[])

    except Exception as e:
        logger.error(f"Anthropic API error: {e}")
        raise HTTPException(status_code=500, detail=f"AI inference error: {str(e)}")
