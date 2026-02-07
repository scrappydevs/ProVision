import os
import json
import logging
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..database.supabase import get_supabase, get_current_user_id

logger = logging.getLogger(__name__)
router = APIRouter()

# ─────────────────────────────────────────────────────────────────────────────
# System prompt
# ─────────────────────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are an elite AI coaching analyst embedded inside the ProVision table tennis analytics platform.
You have FULL access to the coach's database through your tools. You can query any player, session, recording,
stroke, tournament, or analytics data in real time.

## CRITICAL RULES — READ CAREFULLY

1. **NEVER say "I cannot", "I don't have access", "I apologize", or "I'm unable to".** You HAVE access. USE YOUR TOOLS.
2. **ALWAYS use tools FIRST before responding.** When asked about anything data-related, call the tool immediately. Do not guess.
3. **NEVER hallucinate data.** Only cite numbers/stats that came from a tool result.
4. **Be proactive.** If the user asks about "the last recording", call get_player_recordings to find it, then call get_recording_context for details. Don't say you can't — just do it.
5. **Chain tools.** You can call multiple tools in sequence. Example: get recordings → get the last one's details → get its session strokes.

## DECISION TREE — what tool to call for each question type

- "Tell me about this player" / "Summarize" → get_player_profile
- "Show recordings" / "last recording" / "last match" → get_player_recordings, then get_recording_context for the most recent one
- "Analyze the session" / "How did the match go?" → get_session_details + get_session_strokes
- "How's my forehand?" / "Am I improving?" → compare_strokes_across_sessions
- "Show me the strokes" / "Breakdown of this session" → get_session_strokes (optionally filtered by type)
- "Tournament history" / "Match results" → get_player_tournament_history
- "Compare players" / "Who's better at X?" → compare_players
- "Pose analysis" / "Body mechanics" → get_session_pose_analysis
- "Who's on my roster?" / "List players" → search_players
- "Show me the video" / "Can I watch?" → look up the recording/session, then provide an ACTION:NAVIGATE link

## APP CAPABILITIES — the frontend can do these things

The ProVision app has:
- A video player at /dashboard/games/{session_id} that shows match footage, pose overlays, ball tracking, and stroke-by-stroke analysis
- Player profiles at /dashboard/players/{player_id}
- Recording management per player

When you find a recording with a session_id and video, you can offer the user a clickable link to watch it.
When you find a session with analysis data, you can link them directly to the game analysis view.

## ACTION PROTOCOL — embedding clickable actions in your response

You can embed special action tokens in your response text. The frontend will render them as clickable cards.

Syntax: [[ACTION:TYPE:value|Label text]]

Types:
- NAVIGATE — clickable card that takes the user to a page in the app
  Example: [[ACTION:NAVIGATE:/dashboard/games/abc-123|Watch this match]]
  Example: [[ACTION:NAVIGATE:/dashboard/players/xyz-456|View player profile]]

- ASK — suggestion chip that sends a follow-up message to you
  Example: [[ACTION:ASK:Break down the forehand strokes|Analyze forehand technique]]
  Example: [[ACTION:ASK:Compare their last 3 sessions|Track progression]]

Use NAVIGATE actions whenever you reference a recording with a session, a game session, or a player.
Use ASK actions to suggest natural follow-up questions the coach might want to ask.
Place actions AFTER the relevant paragraph, not at the very beginning.

## FORMATTING

- Use **bold** for key terms, metrics, and numbers
- Be concise but insightful — coaches are busy
- Reference data qualitatively: stroke preferences, tactical patterns, mechanical tendencies
- AVOID citing specific percentage form scores (like "76.7% average") — instead say "strong forehand", "consistent technique", "needs development"
- When suggesting improvements, be specific about body mechanics (elbow angle at contact, hip rotation range, spine lean, etc.)
- Structure longer responses with bullet points
- If a tool returns empty/no data, say what data is missing and suggest what the coach could do (e.g. "No stroke data yet — try running pose analysis on this session")"""


# ─────────────────────────────────────────────────────────────────────────────
# Tool schemas (Anthropic format)
# ─────────────────────────────────────────────────────────────────────────────

TOOLS = [
    # ── Player & Profile Tools ──
    {
        "name": "get_player_profile",
        "description": "Get a player's full profile including name, handedness, team, notes, ITTF ranking, nationality, career W/L, playing style, and recent ITTF match results. Use this when asked about a player's background or stats.",
        "input_schema": {
            "type": "object",
            "properties": {
                "player_id": {
                    "type": "string",
                    "description": "The player's UUID. Use the player_id from the conversation context if available."
                }
            },
            "required": ["player_id"]
        }
    },
    {
        "name": "search_players",
        "description": "Search the coach's roster by name or get all players. Useful for cross-player questions like 'who is left-handed?' or 'list all my players'.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Optional name search query. Leave empty to list all players."
                }
            },
            "required": []
        }
    },
    {
        "name": "get_player_recordings",
        "description": "List recordings for a player, optionally filtered by type (match, informal, clip, highlight). Shows title, type, duration, whether analyzed, and creation date.",
        "input_schema": {
            "type": "object",
            "properties": {
                "player_id": {
                    "type": "string",
                    "description": "The player's UUID."
                },
                "type_filter": {
                    "type": "string",
                    "enum": ["match", "informal", "clip", "highlight"],
                    "description": "Optional: filter by recording type."
                },
                "limit": {
                    "type": "integer",
                    "description": "Max recordings to return. Default 20.",
                    "default": 20
                }
            },
            "required": ["player_id"]
        }
    },

    # ── Session & Game Tools ──
    {
        "name": "get_session_details",
        "description": "Get full details of a game session: name, status, video availability, stroke summary (total strokes, FH/BH counts, form scores), trajectory stats (ball speed, frames tracked), and players involved.",
        "input_schema": {
            "type": "object",
            "properties": {
                "session_id": {
                    "type": "string",
                    "description": "The session UUID."
                }
            },
            "required": ["session_id"]
        }
    },
    {
        "name": "get_session_strokes",
        "description": "Get all individual strokes from a session with form scores, velocity, duration, and biomechanics metrics (elbow angle, shoulder rotation, hip rotation, contact height, etc.). Can filter by stroke type.",
        "input_schema": {
            "type": "object",
            "properties": {
                "session_id": {
                    "type": "string",
                    "description": "The session UUID."
                },
                "stroke_type": {
                    "type": "string",
                    "enum": ["forehand", "backhand", "serve"],
                    "description": "Optional: filter by stroke type."
                },
                "limit": {
                    "type": "integer",
                    "description": "Max strokes to return. Default 30.",
                    "default": 30
                }
            },
            "required": ["session_id"]
        }
    },
    {
        "name": "get_session_pose_analysis",
        "description": "Get pose analysis data for a session: joint angles (elbow, shoulder, knee, hip), body metrics (stance width, hip rotation, shoulder rotation, spine lean), sampled across frames.",
        "input_schema": {
            "type": "object",
            "properties": {
                "session_id": {
                    "type": "string",
                    "description": "The session UUID."
                },
                "limit": {
                    "type": "integer",
                    "description": "Max frames to sample. Default 10.",
                    "default": 10
                }
            },
            "required": ["session_id"]
        }
    },

    # ── Stroke & Biomechanics Tools ──
    {
        "name": "compare_strokes_across_sessions",
        "description": "Compare a player's stroke metrics (form score, velocity, biomechanics) across their N most recent sessions. Shows trends and progression over time. Great for answering 'is my forehand improving?'.",
        "input_schema": {
            "type": "object",
            "properties": {
                "player_id": {
                    "type": "string",
                    "description": "The player's UUID."
                },
                "stroke_type": {
                    "type": "string",
                    "enum": ["forehand", "backhand", "serve"],
                    "description": "Optional: filter by stroke type for comparison."
                },
                "session_limit": {
                    "type": "integer",
                    "description": "Number of recent sessions to compare. Default 5.",
                    "default": 5
                }
            },
            "required": ["player_id"]
        }
    },
    {
        "name": "get_stroke_detail",
        "description": "Deep dive into a single stroke by ID: all biomechanics metrics, joint angles at contact, shoulder/hip rotation, wrist snap speed, contact height, follow-through angle, stance width, knee bend.",
        "input_schema": {
            "type": "object",
            "properties": {
                "stroke_id": {
                    "type": "string",
                    "description": "The stroke_analytics UUID."
                }
            },
            "required": ["stroke_id"]
        }
    },

    # ── Tournament & Match Tools ──
    {
        "name": "get_player_tournament_history",
        "description": "Get all tournament matchups for a player: opponents, rankings, results, scores, rounds, tournament names, and any notes. Shows win/loss record.",
        "input_schema": {
            "type": "object",
            "properties": {
                "player_id": {
                    "type": "string",
                    "description": "The player's UUID."
                },
                "limit": {
                    "type": "integer",
                    "description": "Max matchups to return. Default 20.",
                    "default": 20
                }
            },
            "required": ["player_id"]
        }
    },
    {
        "name": "get_tournament_details",
        "description": "Get info about a specific tournament: name, location, dates, level, status, and all matchups with results.",
        "input_schema": {
            "type": "object",
            "properties": {
                "tournament_id": {
                    "type": "string",
                    "description": "The tournament UUID."
                }
            },
            "required": ["tournament_id"]
        }
    },

    # ── Analytics & Comparison Tools ──
    {
        "name": "get_session_analytics",
        "description": "Get comprehensive analytics for a session: ball speed distribution (max/min/avg/median), rally stats (count, avg length), bounce analysis, trajectory distance, and point events.",
        "input_schema": {
            "type": "object",
            "properties": {
                "session_id": {
                    "type": "string",
                    "description": "The session UUID."
                }
            },
            "required": ["session_id"]
        }
    },
    {
        "name": "compare_players",
        "description": "Side-by-side comparison of two players: profiles, stroke form scores (avg FH/BH), velocity, tournament records, and strengths. Great for scouting or matchup prep.",
        "input_schema": {
            "type": "object",
            "properties": {
                "player_id_a": {
                    "type": "string",
                    "description": "First player's UUID."
                },
                "player_id_b": {
                    "type": "string",
                    "description": "Second player's UUID."
                }
            },
            "required": ["player_id_a", "player_id_b"]
        }
    },

    # ── Video & Recording Tools ──
    {
        "name": "get_recording_context",
        "description": "Get details about a specific recording: title, description, type, duration, video path, linked session, clip timestamps, and any analysis metadata.",
        "input_schema": {
            "type": "object",
            "properties": {
                "recording_id": {
                    "type": "string",
                    "description": "The recording UUID."
                }
            },
            "required": ["recording_id"]
        }
    },
]


# ─────────────────────────────────────────────────────────────────────────────
# Tool executor functions
# ─────────────────────────────────────────────────────────────────────────────

def _safe(fn):
    """Wrap a tool function so exceptions return error JSON instead of crashing."""
    def wrapper(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except Exception as e:
            logger.warning(f"Tool {fn.__name__} error: {e}")
            return json.dumps({"error": str(e)})
    return wrapper


@_safe
def _tool_get_player_profile(player_id: str, user_id: str) -> str:
    supabase = get_supabase()
    player = supabase.table("players").select(
        "id, name, position, team, notes, handedness, is_active, ittf_id, ittf_data, created_at"
    ).eq("id", player_id).eq("coach_id", user_id).single().execute()

    if not player.data:
        return json.dumps({"error": "Player not found"})

    p = player.data
    result = {
        "id": p["id"],
        "name": p["name"],
        "handedness": p.get("handedness", "unknown"),
        "position": p.get("position"),
        "team": p.get("team"),
        "notes": p.get("notes"),
        "is_active": p.get("is_active", True),
        "ittf_id": p.get("ittf_id"),
        "created_at": p.get("created_at"),
    }

    ittf = p.get("ittf_data")
    if ittf:
        result["ittf"] = {
            "ranking": ittf.get("ranking"),
            "career_best_ranking": ittf.get("career_best_ranking"),
            "nationality": ittf.get("nationality"),
            "playing_style": ittf.get("playing_style"),
            "career_wins": ittf.get("career_wins", 0),
            "career_losses": ittf.get("career_losses", 0),
            "senior_titles": ittf.get("senior_titles", 0),
            "recent_matches": ittf.get("recent_matches", [])[:5],
        }

    return json.dumps(result)


@_safe
def _tool_search_players(user_id: str, query: str = "") -> str:
    supabase = get_supabase()
    q = supabase.table("players").select(
        "id, name, handedness, team, position, is_active, ittf_data"
    ).eq("coach_id", user_id)

    if query:
        q = q.ilike("name", f"%{query}%")

    players = q.order("name").limit(50).execute()

    results = []
    for p in players.data or []:
        ittf = p.get("ittf_data") or {}
        results.append({
            "id": p["id"],
            "name": p["name"],
            "handedness": p.get("handedness"),
            "team": p.get("team"),
            "position": p.get("position"),
            "is_active": p.get("is_active"),
            "ranking": ittf.get("ranking"),
            "nationality": ittf.get("nationality"),
        })

    return json.dumps({"players": results, "count": len(results)})


@_safe
def _tool_get_player_recordings(player_id: str, user_id: str, type_filter: str = None, limit: int = 20) -> str:
    supabase = get_supabase()
    q = supabase.table("recordings").select(
        "id, title, type, session_id, duration, video_path, thumbnail_path, "
        "clip_start_time, clip_end_time, metadata, created_at"
    ).eq("player_id", player_id).eq("coach_id", user_id)

    if type_filter:
        q = q.eq("type", type_filter)

    recs = q.order("created_at", desc=True).limit(limit).execute()

    results = []
    for r in recs.data or []:
        results.append({
            "id": r["id"],
            "title": r["title"],
            "type": r["type"],
            "session_id": r.get("session_id"),
            "has_video": bool(r.get("video_path")),
            "duration": r.get("duration"),
            "clip_start": r.get("clip_start_time"),
            "clip_end": r.get("clip_end_time"),
            "analyzed": bool(r.get("session_id")),
            "metadata": r.get("metadata"),
            "created_at": r.get("created_at"),
        })

    return json.dumps({"recordings": results, "count": len(results)})


@_safe
def _tool_get_session_details(session_id: str, user_id: str) -> str:
    supabase = get_supabase()
    session = supabase.table("sessions").select(
        "id, name, status, video_path, pose_video_path, ego_video_path, "
        "trajectory_data, stroke_summary, camera_facing, created_at"
    ).eq("id", session_id).eq("user_id", user_id).single().execute()

    if not session.data:
        return json.dumps({"error": "Session not found"})

    s = session.data
    result = {
        "id": s["id"],
        "name": s["name"],
        "status": s["status"],
        "has_video": bool(s.get("video_path")),
        "has_pose_overlay": bool(s.get("pose_video_path")),
        "has_ego_view": bool(s.get("ego_video_path")),
        "camera_facing": s.get("camera_facing", "auto"),
        "created_at": s.get("created_at"),
    }

    # Trajectory summary
    traj = s.get("trajectory_data") or {}
    frames = traj.get("frames", [])
    velocity = traj.get("velocity", [])
    if frames:
        result["trajectory"] = {
            "frames_tracked": len(frames),
            "avg_speed": round(sum(velocity) / len(velocity), 1) if velocity else 0,
            "peak_speed": round(max(velocity), 1) if velocity else 0,
            "spin_estimate": traj.get("spin_estimate", "unknown"),
        }

    # Stroke summary
    ss = s.get("stroke_summary") or {}
    if ss:
        result["stroke_summary"] = {
            "total_strokes": ss.get("total_strokes", 0),
            "forehand_count": ss.get("forehand_count", 0),
            "backhand_count": ss.get("backhand_count", 0),
            "avg_form_score": round(ss.get("average_form_score", 0), 1),
            "best_form_score": round(ss.get("best_form_score", 0), 1),
            "consistency_score": round(ss.get("consistency_score", 0), 1),
        }

    # Players
    gp = supabase.table("game_players").select(
        "players(id, name, handedness, team)"
    ).eq("game_id", session_id).execute()
    if gp.data:
        result["players"] = [
            g["players"] for g in gp.data
            if isinstance(g.get("players"), dict) and g["players"].get("name")
        ]

    return json.dumps(result)


@_safe
def _tool_get_session_strokes(session_id: str, user_id: str, stroke_type: str = None, limit: int = 30) -> str:
    supabase = get_supabase()
    q = supabase.table("stroke_analytics").select(
        "id, stroke_type, form_score, max_velocity, duration, "
        "start_frame, end_frame, peak_frame, metrics, created_at"
    ).eq("session_id", session_id)

    if stroke_type:
        q = q.eq("stroke_type", stroke_type)

    strokes = q.order("start_frame").limit(limit).execute()

    results = []
    for st in strokes.data or []:
        entry = {
            "id": st["id"],
            "stroke_type": st["stroke_type"],
            "form_score": st.get("form_score"),
            "max_velocity": st.get("max_velocity"),
            "duration": st.get("duration"),
            "start_frame": st.get("start_frame"),
            "end_frame": st.get("end_frame"),
            "peak_frame": st.get("peak_frame"),
        }
        m = st.get("metrics") or {}
        if m:
            entry["biomechanics"] = {
                k: v for k, v in m.items()
                if v is not None and k in (
                    "elbow_angle_at_contact", "shoulder_rotation",
                    "hip_rotation", "wrist_snap_speed",
                    "contact_height", "follow_through_angle",
                    "stance_width", "knee_bend",
                    "elbow_angle_range", "shoulder_angle_range",
                    "hip_angle_range", "wrist_velocity_peak",
                )
            }
        results.append(entry)

    # Aggregated stats
    form_scores = [s["form_score"] for s in results if s.get("form_score")]
    velocities = [s["max_velocity"] for s in results if s.get("max_velocity")]
    summary = {
        "count": len(results),
        "avg_form_score": round(sum(form_scores) / len(form_scores), 1) if form_scores else None,
        "max_form_score": round(max(form_scores), 1) if form_scores else None,
        "min_form_score": round(min(form_scores), 1) if form_scores else None,
        "avg_velocity": round(sum(velocities) / len(velocities), 1) if velocities else None,
        "max_velocity": round(max(velocities), 1) if velocities else None,
    }

    return json.dumps({"strokes": results, "summary": summary})


@_safe
def _tool_get_session_pose_analysis(session_id: str, user_id: str, limit: int = 10) -> str:
    supabase = get_supabase()
    pose = supabase.table("pose_analysis").select(
        "frame_number, timestamp, person_id, joint_angles, body_metrics"
    ).eq("session_id", session_id).order("frame_number").limit(limit).execute()

    if not pose.data:
        return json.dumps({"frames": [], "message": "No pose analysis data found for this session."})

    frames = []
    for f in pose.data:
        entry = {
            "frame_number": f["frame_number"],
            "timestamp": f.get("timestamp"),
            "person_id": f.get("person_id"),
        }
        ja = f.get("joint_angles") or {}
        if ja:
            entry["joint_angles"] = ja
        bm = f.get("body_metrics") or {}
        if bm:
            entry["body_metrics"] = bm
        frames.append(entry)

    return json.dumps({"frames": frames, "count": len(frames)})


@_safe
def _tool_compare_strokes_across_sessions(player_id: str, user_id: str, stroke_type: str = None, session_limit: int = 5) -> str:
    supabase = get_supabase()

    # Get player's session IDs
    gp = supabase.table("game_players").select("game_id").eq("player_id", player_id).execute()
    if not gp.data:
        return json.dumps({"error": "No sessions found for this player"})

    game_ids = [g["game_id"] for g in gp.data]

    # Get recent sessions with names
    sessions = supabase.table("sessions").select(
        "id, name, created_at"
    ).in_("id", game_ids).order("created_at", desc=True).limit(session_limit).execute()

    if not sessions.data:
        return json.dumps({"error": "No sessions found"})

    session_map = {s["id"]: s for s in sessions.data}
    session_ids = [s["id"] for s in sessions.data]

    # Get strokes across those sessions
    q = supabase.table("stroke_analytics").select(
        "session_id, stroke_type, form_score, max_velocity, duration, metrics"
    ).in_("session_id", session_ids)

    if stroke_type:
        q = q.eq("stroke_type", stroke_type)

    strokes = q.order("created_at", desc=True).limit(200).execute()

    # Group by session
    by_session = {}
    for st in strokes.data or []:
        sid = st["session_id"]
        if sid not in by_session:
            by_session[sid] = []
        by_session[sid].append(st)

    comparison = []
    for sid in session_ids:
        session_info = session_map.get(sid, {})
        session_strokes = by_session.get(sid, [])

        form_scores = [s["form_score"] for s in session_strokes if s.get("form_score")]
        velocities = [s["max_velocity"] for s in session_strokes if s.get("max_velocity")]

        fh = [s for s in session_strokes if s.get("stroke_type") == "forehand"]
        bh = [s for s in session_strokes if s.get("stroke_type") == "backhand"]
        fh_scores = [s["form_score"] for s in fh if s.get("form_score")]
        bh_scores = [s["form_score"] for s in bh if s.get("form_score")]

        comparison.append({
            "session_name": session_info.get("name", "Unknown"),
            "session_date": session_info.get("created_at"),
            "total_strokes": len(session_strokes),
            "forehand_count": len(fh),
            "backhand_count": len(bh),
            "avg_form_score": round(sum(form_scores) / len(form_scores), 1) if form_scores else None,
            "avg_fh_form": round(sum(fh_scores) / len(fh_scores), 1) if fh_scores else None,
            "avg_bh_form": round(sum(bh_scores) / len(bh_scores), 1) if bh_scores else None,
            "avg_velocity": round(sum(velocities) / len(velocities), 1) if velocities else None,
            "max_velocity": round(max(velocities), 1) if velocities else None,
        })

    return json.dumps({"sessions": comparison, "stroke_type_filter": stroke_type})


@_safe
def _tool_get_stroke_detail(stroke_id: str, user_id: str) -> str:
    supabase = get_supabase()
    stroke = supabase.table("stroke_analytics").select(
        "id, session_id, stroke_type, form_score, max_velocity, duration, "
        "start_frame, end_frame, peak_frame, metrics, created_at"
    ).eq("id", stroke_id).single().execute()

    if not stroke.data:
        return json.dumps({"error": "Stroke not found"})

    st = stroke.data
    result = {
        "id": st["id"],
        "session_id": st["session_id"],
        "stroke_type": st["stroke_type"],
        "form_score": st.get("form_score"),
        "max_velocity": st.get("max_velocity"),
        "duration": st.get("duration"),
        "start_frame": st.get("start_frame"),
        "end_frame": st.get("end_frame"),
        "peak_frame": st.get("peak_frame"),
        "all_metrics": st.get("metrics") or {},
    }

    return json.dumps(result)


@_safe
def _tool_get_player_tournament_history(player_id: str, user_id: str, limit: int = 20) -> str:
    supabase = get_supabase()
    matchups = supabase.table("tournament_matchups").select(
        "id, opponent_name, opponent_ranking, opponent_club, round, result, score, "
        "notes, youtube_url, scheduled_at, created_at, tournaments(id, name, location, level, start_date)"
    ).eq("player_id", player_id).order("created_at", desc=True).limit(limit).execute()

    results = []
    wins = losses = pending = 0
    for m in matchups.data or []:
        tourn = m.get("tournaments") or {}
        if isinstance(tourn, dict):
            t_name = tourn.get("name", "Unknown")
            t_location = tourn.get("location")
            t_level = tourn.get("level")
        else:
            t_name = "Unknown"
            t_location = None
            t_level = None

        result_val = m.get("result", "pending")
        if result_val == "win":
            wins += 1
        elif result_val == "loss":
            losses += 1
        else:
            pending += 1

        results.append({
            "opponent": m["opponent_name"],
            "opponent_ranking": m.get("opponent_ranking"),
            "opponent_club": m.get("opponent_club"),
            "round": m.get("round"),
            "result": result_val,
            "score": m.get("score"),
            "tournament": t_name,
            "tournament_location": t_location,
            "tournament_level": t_level,
            "notes": m.get("notes"),
            "has_video": bool(m.get("youtube_url")),
            "date": m.get("scheduled_at") or m.get("created_at"),
        })

    return json.dumps({
        "matchups": results,
        "record": {"wins": wins, "losses": losses, "pending": pending},
        "count": len(results),
    })


@_safe
def _tool_get_tournament_details(tournament_id: str, user_id: str) -> str:
    supabase = get_supabase()
    tourn = supabase.table("tournaments").select(
        "id, name, location, notes, start_date, end_date, level, status, surface, metadata"
    ).eq("id", tournament_id).eq("coach_id", user_id).single().execute()

    if not tourn.data:
        return json.dumps({"error": "Tournament not found"})

    t = tourn.data
    result = {
        "id": t["id"],
        "name": t["name"],
        "location": t.get("location"),
        "start_date": t.get("start_date"),
        "end_date": t.get("end_date"),
        "level": t.get("level"),
        "status": t.get("status"),
        "surface": t.get("surface"),
        "notes": t.get("notes"),
    }

    # Get matchups
    matchups = supabase.table("tournament_matchups").select(
        "opponent_name, opponent_ranking, round, result, score, notes, "
        "players(id, name)"
    ).eq("tournament_id", tournament_id).order("created_at").execute()

    result["matchups"] = []
    for m in matchups.data or []:
        player_info = m.get("players") or {}
        result["matchups"].append({
            "player": player_info.get("name") if isinstance(player_info, dict) else None,
            "opponent": m["opponent_name"],
            "opponent_ranking": m.get("opponent_ranking"),
            "round": m.get("round"),
            "result": m.get("result"),
            "score": m.get("score"),
            "notes": m.get("notes"),
        })

    return json.dumps(result)


@_safe
def _tool_get_session_analytics(session_id: str, user_id: str) -> str:
    supabase = get_supabase()

    # Check for cached analytics
    cached = supabase.table("session_analytics").select(
        "analytics"
    ).eq("session_id", session_id).single().execute()

    if cached.data and cached.data.get("analytics"):
        return json.dumps(cached.data["analytics"])

    # Fall back to session_metrics
    metrics = supabase.table("session_metrics").select(
        "total_strokes, forehand_count, backhand_count, serve_count, "
        "avg_form_score, avg_ball_speed, rally_count, analysis_duration"
    ).eq("session_id", session_id).single().execute()

    if metrics.data:
        return json.dumps({"session_metrics": metrics.data})

    # Fall back to raw session data
    session = supabase.table("sessions").select(
        "trajectory_data, stroke_summary"
    ).eq("id", session_id).single().execute()

    if not session.data:
        return json.dumps({"error": "No analytics data found for this session"})

    result = {}
    traj = session.data.get("trajectory_data") or {}
    velocity = traj.get("velocity", [])
    if velocity:
        result["ball_speed"] = {
            "max": round(max(velocity), 1),
            "min": round(min(velocity), 1),
            "avg": round(sum(velocity) / len(velocity), 1),
            "frames_tracked": len(traj.get("frames", [])),
        }

    ss = session.data.get("stroke_summary") or {}
    if ss:
        result["stroke_summary"] = ss

    return json.dumps(result) if result else json.dumps({"message": "No analytics data available"})


@_safe
def _tool_compare_players(player_id_a: str, player_id_b: str, user_id: str) -> str:
    supabase = get_supabase()

    def _get_player_stats(pid: str):
        # Profile
        p = supabase.table("players").select(
            "id, name, handedness, team, ittf_data"
        ).eq("id", pid).eq("coach_id", user_id).single().execute()

        if not p.data:
            return {"error": f"Player {pid} not found"}

        profile = p.data
        ittf = profile.get("ittf_data") or {}

        # Stroke stats
        gp = supabase.table("game_players").select("game_id").eq("player_id", pid).execute()
        game_ids = [g["game_id"] for g in (gp.data or [])]

        stroke_stats = {}
        if game_ids:
            strokes = supabase.table("stroke_analytics").select(
                "stroke_type, form_score, max_velocity"
            ).in_("session_id", game_ids).limit(100).execute()

            if strokes.data:
                fh = [s for s in strokes.data if s.get("stroke_type") == "forehand"]
                bh = [s for s in strokes.data if s.get("stroke_type") == "backhand"]
                fh_scores = [s["form_score"] for s in fh if s.get("form_score")]
                bh_scores = [s["form_score"] for s in bh if s.get("form_score")]
                all_vel = [s["max_velocity"] for s in strokes.data if s.get("max_velocity")]

                stroke_stats = {
                    "total_strokes_analyzed": len(strokes.data),
                    "forehand_count": len(fh),
                    "backhand_count": len(bh),
                    "avg_fh_form": round(sum(fh_scores) / len(fh_scores), 1) if fh_scores else None,
                    "avg_bh_form": round(sum(bh_scores) / len(bh_scores), 1) if bh_scores else None,
                    "avg_velocity": round(sum(all_vel) / len(all_vel), 1) if all_vel else None,
                    "max_velocity": round(max(all_vel), 1) if all_vel else None,
                }

        # Tournament record
        matchups = supabase.table("tournament_matchups").select(
            "result"
        ).eq("player_id", pid).execute()
        wins = sum(1 for m in (matchups.data or []) if m.get("result") == "win")
        losses = sum(1 for m in (matchups.data or []) if m.get("result") == "loss")

        return {
            "name": profile["name"],
            "handedness": profile.get("handedness"),
            "team": profile.get("team"),
            "ranking": ittf.get("ranking"),
            "nationality": ittf.get("nationality"),
            "playing_style": ittf.get("playing_style"),
            "career_wins": ittf.get("career_wins", 0),
            "career_losses": ittf.get("career_losses", 0),
            "stroke_stats": stroke_stats,
            "tournament_record": {"wins": wins, "losses": losses},
            "sessions_count": len(game_ids),
        }

    player_a = _get_player_stats(player_id_a)
    player_b = _get_player_stats(player_id_b)

    return json.dumps({"player_a": player_a, "player_b": player_b})


@_safe
def _tool_get_recording_context(recording_id: str, user_id: str) -> str:
    supabase = get_supabase()
    rec = supabase.table("recordings").select(
        "id, title, description, type, duration, video_path, thumbnail_path, "
        "session_id, source_recording_id, clip_start_time, clip_end_time, "
        "metadata, created_at, updated_at"
    ).eq("id", recording_id).eq("coach_id", user_id).single().execute()

    if not rec.data:
        return json.dumps({"error": "Recording not found"})

    r = rec.data
    result = {
        "id": r["id"],
        "title": r["title"],
        "description": r.get("description"),
        "type": r["type"],
        "duration": r.get("duration"),
        "has_video": bool(r.get("video_path")),
        "has_thumbnail": bool(r.get("thumbnail_path")),
        "session_id": r.get("session_id"),
        "analyzed": bool(r.get("session_id")),
        "source_recording_id": r.get("source_recording_id"),
        "clip_start_time": r.get("clip_start_time"),
        "clip_end_time": r.get("clip_end_time"),
        "metadata": r.get("metadata"),
        "created_at": r.get("created_at"),
    }

    # If linked to a session, include session summary
    if r.get("session_id"):
        session = supabase.table("sessions").select(
            "name, status, stroke_summary"
        ).eq("id", r["session_id"]).single().execute()
        if session.data:
            result["session"] = {
                "name": session.data["name"],
                "status": session.data["status"],
                "stroke_summary": session.data.get("stroke_summary"),
            }

    return json.dumps(result)


# ─────────────────────────────────────────────────────────────────────────────
# Tool dispatcher
# ─────────────────────────────────────────────────────────────────────────────

def execute_tool(name: str, tool_input: dict, user_id: str) -> str:
    """Route a tool call to the correct executor function."""
    dispatch = {
        "get_player_profile": lambda: _tool_get_player_profile(
            tool_input["player_id"], user_id
        ),
        "search_players": lambda: _tool_search_players(
            user_id, tool_input.get("query", "")
        ),
        "get_player_recordings": lambda: _tool_get_player_recordings(
            tool_input["player_id"], user_id,
            type_filter=tool_input.get("type_filter"),
            limit=tool_input.get("limit", 20),
        ),
        "get_session_details": lambda: _tool_get_session_details(
            tool_input["session_id"], user_id
        ),
        "get_session_strokes": lambda: _tool_get_session_strokes(
            tool_input["session_id"], user_id,
            stroke_type=tool_input.get("stroke_type"),
            limit=tool_input.get("limit", 30),
        ),
        "get_session_pose_analysis": lambda: _tool_get_session_pose_analysis(
            tool_input["session_id"], user_id,
            limit=tool_input.get("limit", 10),
        ),
        "compare_strokes_across_sessions": lambda: _tool_compare_strokes_across_sessions(
            tool_input["player_id"], user_id,
            stroke_type=tool_input.get("stroke_type"),
            session_limit=tool_input.get("session_limit", 5),
        ),
        "get_stroke_detail": lambda: _tool_get_stroke_detail(
            tool_input["stroke_id"], user_id
        ),
        "get_player_tournament_history": lambda: _tool_get_player_tournament_history(
            tool_input["player_id"], user_id,
            limit=tool_input.get("limit", 20),
        ),
        "get_tournament_details": lambda: _tool_get_tournament_details(
            tool_input["tournament_id"], user_id
        ),
        "get_session_analytics": lambda: _tool_get_session_analytics(
            tool_input["session_id"], user_id
        ),
        "compare_players": lambda: _tool_compare_players(
            tool_input["player_id_a"], tool_input["player_id_b"], user_id
        ),
        "get_recording_context": lambda: _tool_get_recording_context(
            tool_input["recording_id"], user_id
        ),
    }

    fn = dispatch.get(name)
    if not fn:
        return json.dumps({"error": f"Unknown tool: {name}"})
    return fn()


# ─────────────────────────────────────────────────────────────────────────────
# Legacy context gathering (kept for initial context injection)
# ─────────────────────────────────────────────────────────────────────────────

def _gather_player_context(player_id: str, user_id: str) -> str:
    """Pull comprehensive player data from DB."""
    supabase = get_supabase()
    parts = []

    try:
        player = supabase.table("players").select(
            "name, position, team, notes, handedness, is_active, ittf_id, ittf_data, created_at"
        ).eq("id", player_id).eq("coach_id", user_id).single().execute()

        if player.data:
            p = player.data
            parts.append(f"## Player Profile\n"
                         f"Name: {p['name']}\n"
                         f"Player ID: {player_id}\n"
                         f"Handedness: {p.get('handedness', 'unknown')}\n"
                         f"Position: {p.get('position') or 'not set'}\n"
                         f"Team: {p.get('team') or 'not set'}\n"
                         f"Active: {p.get('is_active', True)}\n"
                         f"Notes: {p.get('notes') or 'none'}")

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
        recs = supabase.table("recordings").select(
            "id, title, type, session_id, duration, created_at, clip_start_time, clip_end_time"
        ).eq("player_id", player_id).order("created_at", desc=True).limit(15).execute()

        if recs.data:
            parts.append(f"\n## Recordings ({len(recs.data)} total)")
            for r in recs.data:
                analyzed = "analyzed" if r.get("session_id") else "not analyzed"
                dur = f"{r['duration']:.0f}s" if r.get("duration") else "unknown length"
                parts.append(f"  - \"{r['title']}\" [{r['type']}] ({analyzed}, {dur}) "
                             f"recording_id={r['id']}"
                             f"{' session_id=' + r['session_id'] if r.get('session_id') else ''}")
    except Exception as e:
        logger.warning(f"Failed to get recordings: {e}")

    try:
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
                    parts.append(f"  - \"{s['name']}\" [{s['status']}] session_id={s['id']} "
                                 f"{'(' + str(frames) + ' trajectory frames)' if frames else ''}")
                    if strokes_info:
                        parts.append(strokes_info)
    except Exception as e:
        logger.warning(f"Failed to get sessions: {e}")

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
                     f"Session ID: {session_id}\n"
                     f"Name: {s['name']}\n"
                     f"Status: {s['status']}\n"
                     f"Has video: {bool(s.get('video_path'))}\n"
                     f"Has pose overlay: {bool(s.get('pose_video_path'))}\n"
                     f"Has ego view: {bool(s.get('ego_video_path'))}\n"
                     f"Camera facing: {s.get('camera_facing', 'auto')}")

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
        gp = supabase.table("game_players").select(
            "players(id, name, handedness, team)"
        ).eq("game_id", session_id).execute()

        if gp.data:
            parts.append("\n## Players in Session")
            for g in gp.data:
                p = g.get("players", {})
                if isinstance(p, dict) and p.get("name"):
                    parts.append(f"  - {p['name']} (player_id={p['id']}, "
                                 f"{p.get('handedness', '?')}-handed, "
                                 f"team: {p.get('team', 'none')})")
    except Exception as e:
        logger.warning(f"Failed to get players: {e}")

    return "\n".join(parts) if parts else "No session data found."


# ─────────────────────────────────────────────────────────────────────────────
# Request/Response models
# ─────────────────────────────────────────────────────────────────────────────

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


# ─────────────────────────────────────────────────────────────────────────────
# Chat endpoint with tool-use loop
# ─────────────────────────────────────────────────────────────────────────────

MAX_TOOL_ITERATIONS = 5


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

    # Gather initial context from DB (lightweight summary for system prompt)
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
--- END CONTEXT ---

IMPORTANT: The context above contains IDs (player_id, session_id, recording_id) that you can use with your tools.
When the user asks for deeper analysis, use the appropriate tool with the relevant ID.
You have 13 tools available — use them to fetch real data rather than guessing."""

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
        executed_tools = []

        # Tool-use loop
        for iteration in range(MAX_TOOL_ITERATIONS):
            response = client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=4096,
                system=system_prompt,
                messages=messages,
                tools=TOOLS,
            )

            # Check if the model wants to use tools
            tool_use_blocks = [b for b in response.content if b.type == "tool_use"]

            if not tool_use_blocks:
                # No tool calls — extract final text response
                text_blocks = [b.text for b in response.content if hasattr(b, "text")]
                final_text = "\n".join(text_blocks) if text_blocks else ""
                logger.info(f"AI response via Anthropic (iterations: {iteration + 1}, tools: {len(executed_tools)})")
                return ChatResponse(response=final_text, tool_calls=executed_tools)

            # Model wants to use tools — execute them
            # First, append the assistant's response (with tool_use blocks) to messages
            messages.append({"role": "assistant", "content": response.content})

            # Execute each tool and collect results
            tool_results = []
            for tool_block in tool_use_blocks:
                tool_name = tool_block.name
                tool_input = tool_block.input
                tool_id = tool_block.id

                logger.info(f"Executing tool: {tool_name} with input: {json.dumps(tool_input)[:200]}")
                result = execute_tool(tool_name, tool_input, user_id)

                # Truncate very large results to avoid token limits
                if len(result) > 8000:
                    result = result[:8000] + '..."}'

                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": tool_id,
                    "content": result,
                })

                executed_tools.append({
                    "name": tool_name,
                    "input": tool_input,
                    "result": result[:200] + ("..." if len(result) > 200 else ""),
                })

            # Append tool results as a user message
            messages.append({"role": "user", "content": tool_results})

        # If we hit the iteration limit, extract whatever text we have
        text_blocks = [b.text for b in response.content if hasattr(b, "text")]
        final_text = "\n".join(text_blocks) if text_blocks else "I ran out of tool iterations. Please try a more specific question."
        logger.warning(f"Hit max tool iterations ({MAX_TOOL_ITERATIONS})")
        return ChatResponse(response=final_text, tool_calls=executed_tools)

    except Exception as e:
        logger.error(f"Anthropic API error: {e}")
        raise HTTPException(status_code=500, detail=f"AI inference error: {str(e)}")
