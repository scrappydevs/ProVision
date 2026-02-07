from typing import List, Optional, Dict
from datetime import datetime, timezone
from uuid import uuid4
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from pydantic import BaseModel

from ..database.supabase import get_supabase, get_current_user_id
from ..services.ittf_service import fetch_ittf_player_data, search_ittf_players

router = APIRouter()


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
    
    # Verify player belongs to coach
    player_result = supabase.table("players").select("id").eq("id", player_id).eq("coach_id", user_id).single().execute()
    if not player_result.data:
        raise HTTPException(status_code=404, detail="Player not found")
    
    # Get all games for this player
    games_result = supabase.table("game_players").select("game_id").eq("player_id", player_id).execute()
    game_ids = [g["game_id"] for g in games_result.data] if games_result.data else []
    
    if not game_ids:
        return PlayerInsightsResponse(
            player_id=player_id,
            total_games=0,
            total_strokes=0,
            forehand_stats={},
            backhand_stats={},
            strengths=[],
            weaknesses=[],
        )
    
    # Get stroke analytics for all games
    strokes_result = supabase.table("stroke_analytics")\
        .select("stroke_type, form_score, metrics")\
        .in_("session_id", game_ids)\
        .execute()
    
    strokes = strokes_result.data if strokes_result.data else []
    
    # Aggregate statistics
    forehand_strokes = [s for s in strokes if s["stroke_type"] == "forehand"]
    backhand_strokes = [s for s in strokes if s["stroke_type"] == "backhand"]
    
    forehand_stats = {
        "count": len(forehand_strokes),
        "avg_form_score": sum(s["form_score"] for s in forehand_strokes) / len(forehand_strokes) if forehand_strokes else 0,
        "best_form_score": max((s["form_score"] for s in forehand_strokes), default=0),
    }
    
    backhand_stats = {
        "count": len(backhand_strokes),
        "avg_form_score": sum(s["form_score"] for s in backhand_strokes) / len(backhand_strokes) if backhand_strokes else 0,
        "best_form_score": max((s["form_score"] for s in backhand_strokes), default=0),
    }
    
    # Generate insights
    strengths = []
    weaknesses = []
    
    # Forehand analysis
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
    
    # Backhand analysis
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
    
    # Stroke balance
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
    
    return PlayerInsightsResponse(
        player_id=player_id,
        total_games=len(game_ids),
        total_strokes=len(strokes),
        forehand_stats=forehand_stats,
        backhand_stats=backhand_stats,
        strengths=strengths[:4],  # Limit to 4 strengths
        weaknesses=weaknesses[:2],  # Limit to 2 weaknesses
    )


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
    
    # Verify player belongs to coach
    player_result = supabase.table("players").select("name, handedness").eq("id", player_id).eq("coach_id", user_id).single().execute()
    if not player_result.data:
        raise HTTPException(status_code=404, detail="Player not found")
    
    player_name = player_result.data["name"]
    handedness = player_result.data.get("handedness", "right")
    
    # Get insights data
    insights_response = await get_player_insights(player_id, user_id)
    
    if insights_response.total_strokes == 0:
        description = f"{player_name} is developing their table tennis skills. Upload more game footage to generate personalized analysis.\n\nFocus on building fundamental technique in both forehand and backhand strokes, with emphasis on consistent form and proper body mechanics."
    else:
        # Build description from analytics
        fh_score = insights_response.forehand_stats.get("avg_form_score", 0)
        bh_score = insights_response.backhand_stats.get("avg_form_score", 0)
        fh_count = insights_response.forehand_stats.get("count", 0)
        bh_count = insights_response.backhand_stats.get("count", 0)
        total = fh_count + bh_count
        
        # Determine playing style
        if fh_count > bh_count * 1.5:
            style = "forehand-dominant"
            weapon = "forehand"
        elif bh_count > fh_count * 1.5:
            style = "backhand-dominant"
            weapon = "backhand"
        else:
            style = "balanced"
            weapon = "versatile game"
        
        # First paragraph: Overview and strengths
        para1_parts = []
        para1_parts.append(f"{player_name} is a {handedness}-handed player with a {style} playing style")
        
        if fh_score > 80:
            para1_parts.append(f"featuring exceptional forehand technique (avg {fh_score:.0f}% form)")
        elif bh_score > 80:
            para1_parts.append(f"showcasing strong backhand fundamentals (avg {bh_score:.0f}% form)")
        
        para1_parts.append(f"Across {insights_response.total_games} analyzed games and {total} strokes, {player_name.split()[0]} demonstrates {weapon} as their primary weapon")
        
        if len(insights_response.strengths) > 0:
            strength_titles = ", ".join([s["title"].lower() for s in insights_response.strengths[:2]])
            para1_parts.append(f"with notable strengths in {strength_titles}")
        
        para1 = ". ".join(para1_parts) + "."
        
        # Second paragraph: Development areas and recommendations
        para2_parts = []
        
        if len(insights_response.weaknesses) > 0:
            weak_areas = ", ".join([w["title"].lower() for w in insights_response.weaknesses])
            para2_parts.append(f"Key development areas include {weak_areas}")
        
        if fh_score < bh_score and fh_score < 75:
            para2_parts.append(f"Forehand technique needs attention (current {fh_score:.0f}% avg), focusing on hip rotation and follow-through will yield quick improvements")
        elif bh_score < fh_score and bh_score < 75:
            para2_parts.append(f"Backhand development is a priority (current {bh_score:.0f}% avg), emphasizing early contact point and weight transfer")
        
        if abs(fh_count - bh_count) > total * 0.3:
            other_side = "backhand" if fh_count > bh_count else "forehand"
            para2_parts.append(f"Incorporating more {other_side} opportunities in training will create a more complete game")
        
        if not para2_parts:
            para2_parts.append("Continue developing overall consistency and match-play experience")
        
        para2 = ". ".join(para2_parts) + "."
        
        description = f"{para1}\n\n{para2}"
    
    # Update player notes with generated description
    supabase.table("players").update({"notes": description}).eq("id", player_id).execute()
    
    return {
        "player_id": player_id,
        "description": description,
        "generated_at": "now"
    }


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
