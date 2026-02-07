from typing import List, Optional, Dict, Any
from datetime import datetime, timezone
from uuid import uuid4
import json
import os
import logging
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from pydantic import BaseModel, ValidationError, validator

from ..database.supabase import get_supabase, get_current_user_id
from ..services.ittf_service import fetch_ittf_player_data, search_ittf_players

router = APIRouter()
logger = logging.getLogger(__name__)


class PlayerCreate(BaseModel):
    name: str
    position: Optional[str] = None
    team: Optional[str] = None
    notes: Optional[str] = None
    description: Optional[str] = None
    handedness: Optional[str] = None
    is_active: Optional[bool] = True
    ittf_id: Optional[int] = None


class PlayerUpdate(BaseModel):
    name: Optional[str] = None
    position: Optional[str] = None
    team: Optional[str] = None
    notes: Optional[str] = None
    description: Optional[str] = None
    handedness: Optional[str] = None
    is_active: Optional[bool] = None
    ittf_id: Optional[int] = None


class PlayerInsightsResponse(BaseModel):
    player_id: str
    total_games: int
    total_strokes: int
    forehand_stats: dict
    backhand_stats: dict
    strengths: List[dict]
    weaknesses: List[dict]


class PlayerDescriptionBatchRequest(BaseModel):
    player_ids: Optional[List[str]] = None


class PlayerMatchupAnalysisRequest(BaseModel):
    left_player_id: str
    right_player_id: str


MATCHUP_AXIS_NAMES = [
    "Tactical Advantage",
    "Key Edges",
    "Serve/Receive",
    "Rally Length",
    "Experience/Form",
]


class MatchupAxis(BaseModel):
    axis: str
    left: int
    right: int

    @validator("axis")
    def axis_name_is_valid(cls, value: str) -> str:
        if value not in MATCHUP_AXIS_NAMES:
            raise ValueError("Invalid axis name")
        return value

    @validator("left", "right")
    def scores_are_in_range(cls, value: int) -> int:
        if not isinstance(value, int):
            raise ValueError("Score must be an integer")
        if value < 0 or value > 100:
            raise ValueError("Score must be between 0 and 100")
        return value


class MatchupScores(BaseModel):
    axes: List[MatchupAxis]

    @validator("axes")
    def axes_are_complete(cls, value: List[MatchupAxis]) -> List[MatchupAxis]:
        if len(value) != len(MATCHUP_AXIS_NAMES):
            raise ValueError("Scores must include all axis entries")
        axes_by_name = {axis.axis: axis for axis in value}
        if set(axes_by_name.keys()) != set(MATCHUP_AXIS_NAMES):
            raise ValueError("Scores must include the required axes")
        return [axes_by_name[name] for name in MATCHUP_AXIS_NAMES]


class MatchupAnalysisResponseModel(BaseModel):
    headline: str
    tactical_advantage: List[str]
    key_edges: List[str]
    serve_receive_plan: List[str]
    rally_length_bias: List[str]
    scores: MatchupScores
    raw: Optional[str] = None

    @validator("tactical_advantage")
    def validate_tactical_advantage(cls, value: List[str]) -> List[str]:
        if not (2 <= len(value) <= 3):
            raise ValueError("tactical_advantage must contain 2-3 items")
        return value

    @validator("key_edges")
    def validate_key_edges(cls, value: List[str]) -> List[str]:
        if not (3 <= len(value) <= 4):
            raise ValueError("key_edges must contain 3-4 items")
        return value

    @validator("serve_receive_plan")
    def validate_serve_receive_plan(cls, value: List[str]) -> List[str]:
        if not (2 <= len(value) <= 3):
            raise ValueError("serve_receive_plan must contain 2-3 items")
        return value

    @validator("rally_length_bias")
    def validate_rally_length_bias(cls, value: List[str]) -> List[str]:
        if not (2 <= len(value) <= 3):
            raise ValueError("rally_length_bias must contain 2-3 items")
        return value


def _get_game_counts(supabase, player_ids: List[str]) -> Dict[str, int]:
    if not player_ids:
        return {}
    gp_result = supabase.table("game_players").select("player_id").in_("player_id", player_ids).execute()
    counts: Dict[str, int] = {}
    for row in gp_result.data or []:
        pid = row.get("player_id")
        if pid:
            counts[pid] = counts.get(pid, 0) + 1
    return counts


def _get_players_for_games(supabase, game_ids: List[str]) -> Dict[str, List[dict]]:
    """Fetch players for a list of game IDs. Returns {game_id: [player]}."""
    if not game_ids:
        return {}
    gp_result = supabase.table("game_players").select("game_id, player_id").in_("game_id", game_ids).execute()
    if not gp_result.data:
        return {}
    player_ids = list({gp["player_id"] for gp in gp_result.data if gp.get("player_id")})
    if not player_ids:
        return {}
    players_result = supabase.table("players").select("id, name, avatar_url").in_("id", player_ids).execute()
    player_map = {p["id"]: p for p in players_result.data or []}
    game_players_map: Dict[str, List[dict]] = {}
    for gp in gp_result.data:
        player = player_map.get(gp.get("player_id"))
        if not player:
            continue
        game_players_map.setdefault(gp["game_id"], []).append(player)
    return game_players_map


def _build_player_insights_data(supabase, player_id: str, user_id: str) -> Dict[str, Any]:
    # Verify player belongs to coach
    player_result = supabase.table("players").select("id").eq("id", player_id).eq("coach_id", user_id).single().execute()
    if not player_result.data:
        raise HTTPException(status_code=404, detail="Player not found")

    # Get all games for this player
    games_result = supabase.table("game_players").select("game_id").eq("player_id", player_id).execute()
    game_ids = [g["game_id"] for g in games_result.data] if games_result.data else []

    if not game_ids:
        return {
            "player_id": player_id,
            "total_games": 0,
            "total_strokes": 0,
            "forehand_stats": {"count": 0, "avg_form_score": 0, "best_form_score": 0},
            "backhand_stats": {"count": 0, "avg_form_score": 0, "best_form_score": 0},
            "strengths": [],
            "weaknesses": [],
        }

    # Get stroke analytics for all games
    strokes_result = supabase.table("stroke_analytics")\
        .select("stroke_type, form_score, metrics")\
        .in_("session_id", game_ids)\
        .execute()

    strokes = strokes_result.data if strokes_result.data else []

    # Aggregate statistics
    forehand_strokes = [s for s in strokes if s.get("stroke_type") == "forehand"]
    backhand_strokes = [s for s in strokes if s.get("stroke_type") == "backhand"]

    forehand_stats = {
        "count": len(forehand_strokes),
        "avg_form_score": sum(s.get("form_score", 0) for s in forehand_strokes) / len(forehand_strokes) if forehand_strokes else 0,
        "best_form_score": max((s.get("form_score", 0) for s in forehand_strokes), default=0),
    }

    backhand_stats = {
        "count": len(backhand_strokes),
        "avg_form_score": sum(s.get("form_score", 0) for s in backhand_strokes) / len(backhand_strokes) if backhand_strokes else 0,
        "best_form_score": max((s.get("form_score", 0) for s in backhand_strokes), default=0),
    }

    # Generate insights
    strengths = []
    weaknesses = []

    if forehand_stats["avg_form_score"] > 75:
        strengths.append({
            "title": "Forehand power",
            "summary": f"Consistent forehand technique with {forehand_stats['avg_form_score']:.1f}% average form score",
            "metric": f"Best: {forehand_stats['best_form_score']:.1f}%",
        })
    elif forehand_stats["count"] > 0:
        weaknesses.append({
            "title": "Forehand consistency",
            "summary": f"Form score averaging {forehand_stats['avg_form_score']:.1f}% - room for improvement",
            "metric": "Focus on hip rotation and follow-through",
        })

    if backhand_stats["avg_form_score"] > 75:
        strengths.append({
            "title": "Backhand technique",
            "summary": f"Strong backhand form with {backhand_stats['avg_form_score']:.1f}% average score",
            "metric": f"Best: {backhand_stats['best_form_score']:.1f}%",
        })
    elif backhand_stats["count"] > 0:
        weaknesses.append({
            "title": "Backhand development",
            "summary": f"Form score averaging {backhand_stats['avg_form_score']:.1f}% - focus area",
            "metric": "Work on contact point and weight transfer",
        })

    total = forehand_stats["count"] + backhand_stats["count"]
    if total > 0:
        fh_pct = (forehand_stats["count"] / total) * 100
        if fh_pct > 70:
            strengths.append({
                "title": "Forehand reliance",
                "summary": f"{fh_pct:.0f}% of strokes are forehands - dominant weapon",
                "metric": "Maintain this strength in pressure situations",
            })
            weaknesses.append({
                "title": "Backhand usage",
                "summary": f"Only {100-fh_pct:.0f}% backhands - develop for balance",
                "metric": "Add backhand drills to training routine",
            })
        elif fh_pct < 30:
            strengths.append({
                "title": "Backhand reliance",
                "summary": f"{100-fh_pct:.0f}% of strokes are backhands - strong side",
                "metric": "Leverage this in match strategy",
            })
            weaknesses.append({
                "title": "Forehand development",
                "summary": f"Only {fh_pct:.0f}% forehands - balance needed",
                "metric": "Incorporate more forehand practice",
            })

    return {
        "player_id": player_id,
        "total_games": len(game_ids),
        "total_strokes": len(strokes),
        "forehand_stats": forehand_stats,
        "backhand_stats": backhand_stats,
        "strengths": strengths[:4],
        "weaknesses": weaknesses[:2],
    }


def _generate_player_description_with_agent(
    supabase,
    player_id: str,
    user_id: str,
) -> Optional[str]:
    anthropic_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not anthropic_key:
        logger.warning("ANTHROPIC_API_KEY not configured; skipping player description update.")
        return None

    player = supabase.table("players").select(
        "id, coach_id, name, handedness, team, position, is_active, ittf_data, created_at"
    ).eq("id", player_id).eq("coach_id", user_id).single().execute()
    if not player.data:
        raise HTTPException(status_code=404, detail="Player not found")

    insights = _build_player_insights_data(supabase, player_id, user_id)
    context = {
        "player": player.data,
        "insights": insights,
    }

    system = (
        "You are a concise tennis coach assistant. "
        "Output EXACTLY 1-2 sentences ONLY. NO paragraphs. NO additional text. "
        "Format: One sentence about playing style and strength. One sentence about weakness or area for improvement."
    )
    user_msg = (
        "Write ONLY 1-2 sentences describing this player. NO MORE.\n\n"
        f"{json.dumps(context, ensure_ascii=True)}"
    )

    try:
        import anthropic
        client = anthropic.Anthropic(api_key=anthropic_key)
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=100,
            system=system,
            messages=[{"role": "user", "content": user_msg}],
        )
        text_blocks = [b.text for b in response.content if hasattr(b, "text")]
        description = "\n".join(text_blocks).strip()
        if not description:
            return None
        
        # Enforce 1-2 sentence limit by truncating after second period
        sentences = description.split('. ')
        if len(sentences) > 2:
            description = '. '.join(sentences[:2]) + '.'
        supabase.table("players").update({
            "description": description,
            "notes": description,
        }).eq("id", player_id).execute()
        return description
    except Exception as e:
        logger.error(f"Player description generation failed: {e}")
        return None


def update_player_description_from_insights(player_id: str, coach_id: Optional[str] = None) -> Optional[str]:
    supabase = get_supabase()
    if coach_id:
        user_id = coach_id
    else:
        player = supabase.table("players").select("coach_id").eq("id", player_id).single().execute()
        if not player.data:
            return None
        user_id = player.data.get("coach_id")
    if not user_id:
        return None
    return _generate_player_description_with_agent(supabase, player_id, user_id)


def _parse_matchup_json(raw_text: str) -> Dict[str, Any]:
    if not raw_text:
        return {}
    try:
        return json.loads(raw_text)
    except Exception:
        start = raw_text.find("{")
        end = raw_text.rfind("}")
        if start != -1 and end != -1 and end > start:
            try:
                return json.loads(raw_text[start : end + 1])
            except Exception:
                pass
        return {"insights": [raw_text.strip()]}


def _coerce_string_list(value: Any) -> List[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    if isinstance(value, str):
        return [value.strip()] if value.strip() else []
    return []


def _validate_matchup_response(parsed: Dict[str, Any], raw_text: str) -> Dict[str, Any]:
    payload = {
        "headline": (parsed.get("headline") or "").strip(),
        "tactical_advantage": _coerce_string_list(
            parsed.get("tactical_advantage") or parsed.get("insights")
        ),
        "key_edges": _coerce_string_list(parsed.get("key_edges")),
        "serve_receive_plan": _coerce_string_list(
            parsed.get("serve_receive_plan") or parsed.get("gameplan")
        ),
        "rally_length_bias": _coerce_string_list(
            parsed.get("rally_length_bias") or parsed.get("watchouts")
        ),
        "scores": parsed.get("scores") or {},
        "raw": raw_text,
    }
    model = MatchupAnalysisResponseModel(**payload)
    return model.model_dump()


@router.get("/")
async def list_players(
    search: Optional[str] = Query(default=None),
    user_id: str = Depends(get_current_user_id),
):
    supabase = get_supabase()
    q = supabase.table("players").select(
        "id, coach_id, name, avatar_url, position, team, notes, description, "
        "handedness, is_active, ittf_id, ittf_data, ittf_last_synced, created_at, updated_at"
    ).eq("coach_id", user_id)
    if search:
        q = q.ilike("name", f"%{search}%")
    players = q.order("name").execute()
    player_ids = [p["id"] for p in players.data or []]
    game_counts = _get_game_counts(supabase, player_ids)
    for p in players.data or []:
        p["game_count"] = game_counts.get(p["id"], 0)
    return players.data or []


@router.post("/")
async def create_player(
    data: PlayerCreate,
    user_id: str = Depends(get_current_user_id),
):
    supabase = get_supabase()
    payload = data.model_dump(exclude_unset=True)
    payload["coach_id"] = user_id
    result = supabase.table("players").insert(payload).execute()
    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to create player")
    return result.data[0]


@router.get("/search-ittf")
async def search_ittf(
    q: str = Query(min_length=2),
    user_id: str = Depends(get_current_user_id),
):
    _ = user_id
    results = await search_ittf_players(q)
    return {"query": q, "results": results, "count": len(results)}


@router.get("/insights/{player_id}")
async def get_player_insights(
    player_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """
    Generate personalized insights for a player based on their stroke analytics.
    """
    supabase = get_supabase()
    insights = _build_player_insights_data(supabase, player_id, user_id)
    return PlayerInsightsResponse(**insights)


@router.post("/generate-description/{player_id}")
async def generate_player_description(
    player_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """
    Generate a comprehensive player description based on analytics from all their games.
    Returns a two-paragraph summary of strengths, weaknesses, and playing style.
    """
    supabase = get_supabase()
    description = _generate_player_description_with_agent(supabase, player_id, user_id)
    if not description:
        raise HTTPException(status_code=500, detail="Failed to generate player description")
    return {
        "player_id": player_id,
        "description": description,
        "generated_at": "now"
    }


@router.post("/generate-descriptions")
async def generate_player_descriptions(
    payload: PlayerDescriptionBatchRequest,
    user_id: str = Depends(get_current_user_id),
):
    supabase = get_supabase()
    if payload.player_ids:
        player_ids = payload.player_ids
    else:
        players_result = supabase.table("players").select("id").eq("coach_id", user_id).execute()
        player_ids = [p["id"] for p in (players_result.data or [])]

    updated = []
    failed = []

    for pid in player_ids:
        try:
            description = _generate_player_description_with_agent(supabase, pid, user_id)
            if description:
                updated.append(pid)
            else:
                failed.append(pid)
        except Exception:
            failed.append(pid)

    return {
        "updated": updated,
        "failed": failed,
        "updated_count": len(updated),
        "failed_count": len(failed),
    }


@router.post("/compare/analyze")
async def analyze_player_matchup(
    payload: PlayerMatchupAnalysisRequest,
    user_id: str = Depends(get_current_user_id),
):
    supabase = get_supabase()
    anthropic_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not anthropic_key:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not configured.")

    left = supabase.table("players").select(
        "id, coach_id, name, handedness, team, position, description, notes, ittf_data"
    ).eq("id", payload.left_player_id).eq("coach_id", user_id).single().execute()
    right = supabase.table("players").select(
        "id, coach_id, name, handedness, team, position, description, notes, ittf_data"
    ).eq("id", payload.right_player_id).eq("coach_id", user_id).single().execute()

    if not left.data or not right.data:
        raise HTTPException(status_code=404, detail="Player not found")

    left_insights = _build_player_insights_data(supabase, payload.left_player_id, user_id)
    right_insights = _build_player_insights_data(supabase, payload.right_player_id, user_id)

    context = {
        "left_player": left.data,
        "right_player": right.data,
        "left_insights": left_insights,
        "right_insights": right_insights,
    }

    system = (
        "You are a table tennis scouting analyst. "
        "Use only the provided data and be concise. "
        "Return ONLY valid JSON (no markdown, no prose). "
        "Return JSON with keys: headline (string), "
        "tactical_advantage (array of 2-3 strings), "
        "key_edges (array of 3-4 strings — each edge must describe a MEANINGFUL, "
        "actionable difference between the players. Ignore trivially small gaps. "
        "Focus on style clashes, physical advantages, or strategic mismatches. "
        "Do NOT just restate scores with decimal points.), "
        "serve_receive_plan (array of 2-3 strings), "
        "rally_length_bias (array of 2-3 strings), "
        "scores (object with key 'axes' as an array of 5 objects: "
        "{axis: string, left: number, right: number}, "
        "where axis names are: Tactical Advantage, Key Edges, Serve/Receive, Rally Length, Experience/Form. "
        "Scores must be integers from 0-100.) "
        "IMPORTANT: Scores are on a 0-100 scale, NOT percentages. "
        "Never use '%' or 'percent' — write '82 form score' not '82%'. "
        "Describe qualities in plain language (e.g. 'strong backhand', 'consistent rallier') "
        "rather than citing raw numbers."
    )
    user_msg = (
        "Analyze this matchup using both player descriptions and insights. "
        "Be specific and actionable.\n\n"
        f"{json.dumps(context, ensure_ascii=True)}"
    )

    try:
        import anthropic
        client = anthropic.Anthropic(api_key=anthropic_key)
        def _call_model(system_prompt: str, prompt: str) -> str:
            response = client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=1024,
                system=system_prompt,
                messages=[{"role": "user", "content": prompt}],
            )
            text_blocks = [b.text for b in response.content if hasattr(b, "text")]
            return "\n".join(text_blocks).strip()

        raw_text = _call_model(system, user_msg)
        parsed = _parse_matchup_json(raw_text)
        try:
            return _validate_matchup_response(parsed, raw_text)
        except ValidationError as ve:
            logger.warning(f"Invalid matchup analysis format, retrying: {ve}")
            repair_system = (
                "You are a strict JSON formatter. "
                "Return ONLY valid JSON with the exact schema. "
                "No markdown, no extra text."
            )
            repair_prompt = (
                "Fix the following content into valid JSON with keys: "
                "headline (string), tactical_advantage (array of 2-3 strings), "
                "key_edges (array of 3-4 strings), serve_receive_plan (array of 2-3 strings), "
                "rally_length_bias (array of 2-3 strings), scores (object with key 'axes' "
                "as an array of 5 objects: {axis, left, right} with axes: Tactical Advantage, "
                "Key Edges, Serve/Receive, Rally Length, Experience/Form; integers 0-100). "
                "If a field is missing, infer reasonable values.\n\n"
                f"{raw_text}"
            )
            repaired_text = _call_model(repair_system, repair_prompt)
            repaired_parsed = _parse_matchup_json(repaired_text)
            try:
                return _validate_matchup_response(repaired_parsed, repaired_text)
            except ValidationError as ve2:
                logger.error(f"Invalid matchup analysis format after retry: {ve2}")
                raise HTTPException(status_code=502, detail="Invalid matchup analysis format")
    except Exception as e:
        logger.error(f"Matchup analysis failed: {e}")
        raise HTTPException(status_code=502, detail="Failed to analyze matchup")


@router.post("/{player_id}/sync-ittf")
async def sync_ittf(
    player_id: str,
    user_id: str = Depends(get_current_user_id),
):
    supabase = get_supabase()
    player_result = supabase.table("players").select("id, ittf_id").eq("id", player_id).eq("coach_id", user_id).single().execute()
    if not player_result.data:
        raise HTTPException(status_code=404, detail="Player not found")
    ittf_id = player_result.data.get("ittf_id")
    if not ittf_id:
        raise HTTPException(status_code=400, detail="Player does not have an ITTF ID")
    ittf_data = await fetch_ittf_player_data(ittf_id)
    if not ittf_data:
        raise HTTPException(status_code=502, detail="Failed to fetch ITTF data")
    now = datetime.now(timezone.utc).isoformat()
    update = {
        "ittf_data": ittf_data,
        "ittf_last_synced": now,
    }
    result = supabase.table("players").update(update).eq("id", player_id).execute()
    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to update ITTF data")
    return result.data[0]


@router.get("/{player_id}/ittf-stats")
async def get_ittf_stats(
    player_id: str,
    user_id: str = Depends(get_current_user_id),
):
    supabase = get_supabase()
    player_result = supabase.table("players").select(
        "ittf_id, ittf_data, ittf_last_synced"
    ).eq("id", player_id).eq("coach_id", user_id).single().execute()
    if not player_result.data:
        raise HTTPException(status_code=404, detail="Player not found")
    return {
        "ittf_id": player_result.data.get("ittf_id"),
        "ittf_data": player_result.data.get("ittf_data"),
        "ittf_last_synced": player_result.data.get("ittf_last_synced"),
    }


@router.post("/{player_id}/avatar")
async def upload_avatar(
    player_id: str,
    avatar: UploadFile = File(...),
    user_id: str = Depends(get_current_user_id),
):
    supabase = get_supabase()
    player_result = supabase.table("players").select("id").eq("id", player_id).eq("coach_id", user_id).single().execute()
    if not player_result.data:
        raise HTTPException(status_code=404, detail="Player not found")
    filename = avatar.filename or "avatar"
    ext = f".{filename.rsplit('.', 1)[-1]}" if "." in filename else ".jpg"
    storage_path = f"{user_id}/players/{player_id}/avatar-{uuid4().hex}{ext}"
    content = await avatar.read()
    supabase.storage.from_("provision-videos").upload(storage_path, content)
    avatar_url = supabase.storage.from_("provision-videos").get_public_url(storage_path)
    result = supabase.table("players").update({"avatar_url": avatar_url}).eq("id", player_id).execute()
    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to update avatar")
    return result.data[0]


@router.get("/{player_id}/games")
async def get_player_games(
    player_id: str,
    search: Optional[str] = Query(default=None),
    status: Optional[str] = Query(default=None),
    user_id: str = Depends(get_current_user_id),
):
    supabase = get_supabase()
    player_result = supabase.table("players").select("id").eq("id", player_id).eq("coach_id", user_id).single().execute()
    if not player_result.data:
        raise HTTPException(status_code=404, detail="Player not found")
    games_result = supabase.table("game_players").select("game_id").eq("player_id", player_id).execute()
    game_ids = [g["game_id"] for g in games_result.data or []]
    if not game_ids:
        return []
    q = supabase.table("sessions").select(
        "id, name, video_path, status, created_at"
    ).in_("id", game_ids)
    if search:
        q = q.ilike("name", f"%{search}%")
    if status:
        q = q.eq("status", status)
    sessions = q.order("created_at", desc=True).execute()
    players_map = _get_players_for_games(supabase, [s["id"] for s in sessions.data or []])
    for s in sessions.data or []:
        s["players"] = players_map.get(s["id"], [])
    return sessions.data or []


@router.get("/{player_id}")
async def get_player(
    player_id: str,
    user_id: str = Depends(get_current_user_id),
):
    supabase = get_supabase()
    result = supabase.table("players").select(
        "id, coach_id, name, avatar_url, position, team, notes, description, "
        "handedness, is_active, ittf_id, ittf_data, ittf_last_synced, created_at, updated_at"
    ).eq("id", player_id).eq("coach_id", user_id).single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Player not found")
    game_counts = _get_game_counts(supabase, [player_id])
    result.data["game_count"] = game_counts.get(player_id, 0)
    return result.data


@router.put("/{player_id}")
async def update_player(
    player_id: str,
    data: PlayerUpdate,
    user_id: str = Depends(get_current_user_id),
):
    supabase = get_supabase()
    payload = data.model_dump(exclude_unset=True)
    if not payload:
        raise HTTPException(status_code=400, detail="No updates provided")
    player_result = supabase.table("players").select("id").eq("id", player_id).eq("coach_id", user_id).single().execute()
    if not player_result.data:
        raise HTTPException(status_code=404, detail="Player not found")
    result = supabase.table("players").update(payload).eq("id", player_id).execute()
    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to update player")
    return result.data[0]


@router.delete("/{player_id}")
async def delete_player(
    player_id: str,
    user_id: str = Depends(get_current_user_id),
):
    supabase = get_supabase()
    player_result = supabase.table("players").select("id").eq("id", player_id).eq("coach_id", user_id).single().execute()
    if not player_result.data:
        raise HTTPException(status_code=404, detail="Player not found")
    supabase.table("players").delete().eq("id", player_id).execute()
    return {"status": "ok"}
