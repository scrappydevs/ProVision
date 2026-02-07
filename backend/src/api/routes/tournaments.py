import uuid
import logging
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from datetime import datetime, date

from ..database.supabase import get_supabase, get_current_user_id

logger = logging.getLogger(__name__)

router = APIRouter()


def _get_matchup_stats_by_tournament(supabase, tournament_ids: list[str]) -> dict[str, dict]:
    """Fetch matchup counts and win/loss stats for all tournaments in a single query."""
    if not tournament_ids:
        return {}
    result = supabase.table("tournament_matchups").select("tournament_id, result").in_("tournament_id", tournament_ids).execute()
    stats: dict[str, dict] = {tid: {"matchup_count": 0, "win_count": 0, "loss_count": 0} for tid in tournament_ids}
    for row in result.data or []:
        tid = row.get("tournament_id")
        if tid and tid in stats:
            stats[tid]["matchup_count"] += 1
            r = row.get("result")
            if r == "win":
                stats[tid]["win_count"] += 1
            elif r == "loss":
                stats[tid]["loss_count"] += 1
    return stats


class TournamentCreate(BaseModel):
    name: str
    location: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    level: Optional[str] = None
    status: str = "upcoming"
    surface: Optional[str] = None
    notes: Optional[str] = None
    metadata: Optional[dict] = None


class TournamentUpdate(BaseModel):
    name: Optional[str] = None
    location: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    level: Optional[str] = None
    status: Optional[str] = None
    surface: Optional[str] = None
    notes: Optional[str] = None
    metadata: Optional[dict] = None


class TournamentResponse(BaseModel):
    id: str
    coach_id: str
    name: str
    location: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    level: Optional[str] = None
    status: str
    surface: Optional[str] = None
    notes: Optional[str] = None
    metadata: Optional[dict] = None
    created_at: str
    updated_at: Optional[str] = None
    matchup_count: Optional[int] = None
    win_count: Optional[int] = None
    loss_count: Optional[int] = None


class MatchupCreate(BaseModel):
    tournament_id: str
    youtube_url: Optional[str] = None
    player_id: Optional[str] = None
    opponent_name: str
    opponent_club: Optional[str] = None
    opponent_ranking: Optional[str] = None
    round: Optional[str] = None
    scheduled_at: Optional[datetime] = None
    result: Optional[str] = "pending"
    score: Optional[str] = None
    session_id: Optional[str] = None
    notes: Optional[str] = None


class MatchupUpdate(BaseModel):
    player_id: Optional[str] = None
    opponent_name: Optional[str] = None
    opponent_club: Optional[str] = None
    opponent_ranking: Optional[str] = None
    round: Optional[str] = None
    scheduled_at: Optional[datetime] = None
    result: Optional[str] = None
    score: Optional[str] = None
    session_id: Optional[str] = None
    notes: Optional[str] = None
    youtube_url: Optional[str] = None


class MatchupResponse(BaseModel):
    id: str
    tournament_id: str
    coach_id: str
    player_id: Optional[str] = None
    player_name: Optional[str] = None
    opponent_name: str
    opponent_club: Optional[str] = None
    opponent_ranking: Optional[str] = None
    round: Optional[str] = None
    scheduled_at: Optional[str] = None
    result: Optional[str] = None
    score: Optional[str] = None
    session_id: Optional[str] = None
    notes: Optional[str] = None
    youtube_url: Optional[str] = None
    created_at: str
    updated_at: Optional[str] = None


# --- Tournament CRUD ---

@router.post("", response_model=TournamentResponse)
async def create_tournament(
    tournament: TournamentCreate,
    user_id: str = Depends(get_current_user_id),
):
    supabase = get_supabase()
    tournament_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()

    data = {
        "id": tournament_id,
        "coach_id": user_id,
        "name": tournament.name,
        "location": tournament.location,
        "start_date": tournament.start_date.isoformat() if tournament.start_date else None,
        "end_date": tournament.end_date.isoformat() if tournament.end_date else None,
        "level": tournament.level,
        "status": tournament.status,
        "surface": tournament.surface,
        "notes": tournament.notes,
        "metadata": tournament.metadata or {},
        "created_at": now,
        "updated_at": now,
    }

    try:
        result = supabase.table("tournaments").insert(data).execute()
        row = result.data[0]
        row["matchup_count"] = 0
        row["win_count"] = 0
        row["loss_count"] = 0
        return TournamentResponse(**row)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create tournament: {str(e)}")


@router.get("", response_model=List[TournamentResponse])
async def list_tournaments(
    user_id: str = Depends(get_current_user_id),
    status: Optional[str] = Query(None),
):
    supabase = get_supabase()

    try:
        query = supabase.table("tournaments").select("*").eq("coach_id", user_id).order("start_date", desc=True)
        if status:
            query = query.eq("status", status)
        result = query.execute()
        tournament_ids = [t["id"] for t in result.data]
        stats = _get_matchup_stats_by_tournament(supabase, tournament_ids)

        tournaments = []
        for t in result.data:
            s = stats.get(t["id"], {})
            t["matchup_count"] = s.get("matchup_count", 0)
            t["win_count"] = s.get("win_count", 0)
            t["loss_count"] = s.get("loss_count", 0)
            tournaments.append(TournamentResponse(**t))

        return tournaments
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list tournaments: {str(e)}")


@router.get("/upcoming", response_model=List[TournamentResponse])
async def list_upcoming_tournaments(
    user_id: str = Depends(get_current_user_id),
):
    supabase = get_supabase()

    try:
        result = (
            supabase.table("tournaments")
            .select("*")
            .eq("coach_id", user_id)
            .in_("status", ["upcoming", "ongoing"])
            .order("start_date", desc=False)
            .execute()
        )
        tournament_ids = [t["id"] for t in result.data]
        stats = _get_matchup_stats_by_tournament(supabase, tournament_ids)

        tournaments = []
        for t in result.data:
            s = stats.get(t["id"], {})
            t["matchup_count"] = s.get("matchup_count", 0)
            t["win_count"] = s.get("win_count", 0)
            t["loss_count"] = s.get("loss_count", 0)
            tournaments.append(TournamentResponse(**t))

        return tournaments
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list upcoming tournaments: {str(e)}")


@router.get("/past", response_model=List[TournamentResponse])
async def list_past_tournaments(
    user_id: str = Depends(get_current_user_id),
):
    supabase = get_supabase()

    try:
        result = (
            supabase.table("tournaments")
            .select("*")
            .eq("coach_id", user_id)
            .in_("status", ["completed", "cancelled"])
            .order("start_date", desc=True)
            .execute()
        )
        tournament_ids = [t["id"] for t in result.data]
        stats = _get_matchup_stats_by_tournament(supabase, tournament_ids)

        tournaments = []
        for t in result.data:
            s = stats.get(t["id"], {})
            t["matchup_count"] = s.get("matchup_count", 0)
            t["win_count"] = s.get("win_count", 0)
            t["loss_count"] = s.get("loss_count", 0)
            tournaments.append(TournamentResponse(**t))

        return tournaments
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list past tournaments: {str(e)}")


# --- ITTF Calendar Import ---
# NOTE: These MUST be before /{tournament_id} to avoid being caught by the path param

@router.get("/ittf-calendar")
async def get_ittf_calendar(
    user_id: str = Depends(get_current_user_id),
    year: Optional[int] = Query(None),
):
    from ..services.tournament_service import scrape_ittf_tournaments

    try:
        events = await scrape_ittf_tournaments(year)
        return {"events": events, "count": len(events)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch ITTF calendar: {str(e)}")


class ITTFImportRequest(BaseModel):
    events: List[dict]


@router.post("/import-ittf", response_model=List[TournamentResponse])
async def import_ittf_tournaments(
    request: ITTFImportRequest,
    user_id: str = Depends(get_current_user_id),
):
    supabase = get_supabase()
    imported = []

    for event in request.events:
        tournament_id = str(uuid.uuid4())
        now = datetime.utcnow().isoformat()

        data = {
            "id": tournament_id,
            "coach_id": user_id,
            "name": event.get("name", "Unnamed Event"),
            "location": event.get("location"),
            "level": event.get("level", "international"),
            "status": "upcoming",
            "notes": event.get("date_text"),
            "metadata": {"source": "ittf_calendar", "original_data": event},
            "created_at": now,
            "updated_at": now,
        }

        try:
            result = supabase.table("tournaments").insert(data).execute()
            row = result.data[0]
            row["matchup_count"] = 0
            row["win_count"] = 0
            row["loss_count"] = 0
            imported.append(TournamentResponse(**row))
        except Exception as e:
            logger.error(f"Failed to import tournament '{event.get('name')}': {e}")
            continue

    return imported


@router.get("/{tournament_id}", response_model=TournamentResponse)
async def get_tournament(
    tournament_id: str,
    user_id: str = Depends(get_current_user_id),
):
    supabase = get_supabase()

    try:
        result = (
            supabase.table("tournaments")
            .select("*")
            .eq("id", tournament_id)
            .eq("coach_id", user_id)
            .single()
            .execute()
        )
        if not result.data:
            raise HTTPException(status_code=404, detail="Tournament not found")

        s = _get_matchup_stats_by_tournament(supabase, [tournament_id]).get(tournament_id, {})
        result.data["matchup_count"] = s.get("matchup_count", 0)
        result.data["win_count"] = s.get("win_count", 0)
        result.data["loss_count"] = s.get("loss_count", 0)

        return TournamentResponse(**result.data)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get tournament: {str(e)}")


@router.put("/{tournament_id}", response_model=TournamentResponse)
async def update_tournament(
    tournament_id: str,
    tournament: TournamentUpdate,
    user_id: str = Depends(get_current_user_id),
):
    supabase = get_supabase()

    try:
        existing = supabase.table("tournaments").select("*").eq("id", tournament_id).eq("coach_id", user_id).single().execute()
        if not existing.data:
            raise HTTPException(status_code=404, detail="Tournament not found")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to find tournament: {str(e)}")

    update_data = {}
    for k, v in tournament.model_dump().items():
        if v is not None:
            if isinstance(v, date):
                update_data[k] = v.isoformat()
            else:
                update_data[k] = v
    if not update_data:
        raise HTTPException(status_code=400, detail="No fields to update")

    update_data["updated_at"] = datetime.utcnow().isoformat()

    try:
        result = supabase.table("tournaments").update(update_data).eq("id", tournament_id).execute()
        row = result.data[0]

        s = _get_matchup_stats_by_tournament(supabase, [tournament_id]).get(tournament_id, {})
        row["matchup_count"] = s.get("matchup_count", 0)
        row["win_count"] = s.get("win_count", 0)
        row["loss_count"] = s.get("loss_count", 0)

        return TournamentResponse(**row)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update tournament: {str(e)}")


@router.delete("/{tournament_id}")
async def delete_tournament(
    tournament_id: str,
    user_id: str = Depends(get_current_user_id),
):
    supabase = get_supabase()

    try:
        existing = supabase.table("tournaments").select("*").eq("id", tournament_id).eq("coach_id", user_id).single().execute()
        if not existing.data:
            raise HTTPException(status_code=404, detail="Tournament not found")

        supabase.table("tournaments").delete().eq("id", tournament_id).execute()
        return {"message": "Tournament deleted"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete tournament: {str(e)}")


# --- Matchup CRUD ---

@router.post("/{tournament_id}/matchups", response_model=MatchupResponse)
async def create_matchup(
    tournament_id: str,
    matchup: MatchupCreate,
    user_id: str = Depends(get_current_user_id),
):
    supabase = get_supabase()

    try:
        existing = supabase.table("tournaments").select("id").eq("id", tournament_id).eq("coach_id", user_id).single().execute()
        if not existing.data:
            raise HTTPException(status_code=404, detail="Tournament not found")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to find tournament: {str(e)}")

    matchup_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()

    data = {
        "id": matchup_id,
        "tournament_id": tournament_id,
        "coach_id": user_id,
        "player_id": matchup.player_id,
        "opponent_name": matchup.opponent_name,
        "opponent_club": matchup.opponent_club,
        "opponent_ranking": matchup.opponent_ranking,
        "round": matchup.round,
        "scheduled_at": matchup.scheduled_at.isoformat() if matchup.scheduled_at else None,
        "result": matchup.result or "pending",
        "score": matchup.score,
        "session_id": matchup.session_id,
        "notes": matchup.notes,
        "youtube_url": matchup.youtube_url,
        "created_at": now,
        "updated_at": now,
    }

    try:
        result = supabase.table("tournament_matchups").insert(data).execute()
        row = result.data[0]

        if row.get("player_id"):
            player = supabase.table("players").select("name").eq("id", row["player_id"]).single().execute()
            row["player_name"] = player.data.get("name") if player.data else None
        else:
            row["player_name"] = None

        return MatchupResponse(**row)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create matchup: {str(e)}")


@router.get("/{tournament_id}/matchups", response_model=List[MatchupResponse])
async def list_matchups(
    tournament_id: str,
    user_id: str = Depends(get_current_user_id),
):
    supabase = get_supabase()

    try:
        existing = supabase.table("tournaments").select("id").eq("id", tournament_id).eq("coach_id", user_id).single().execute()
        if not existing.data:
            raise HTTPException(status_code=404, detail="Tournament not found")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to find tournament: {str(e)}")

    try:
        result = supabase.table("tournament_matchups").select("*").eq("tournament_id", tournament_id).order("scheduled_at", desc=False).execute()

        player_ids = list({m["player_id"] for m in result.data if m.get("player_id")})
        player_names: dict[str, str] = {}
        if player_ids:
            players = supabase.table("players").select("id, name").in_("id", player_ids).execute()
            player_names = {p["id"]: p.get("name") for p in players.data}

        matchups = []
        for m in result.data:
            m["player_name"] = player_names.get(m["player_id"]) if m.get("player_id") else None
            matchups.append(MatchupResponse(**m))

        return matchups
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list matchups: {str(e)}")


@router.put("/matchups/{matchup_id}", response_model=MatchupResponse)
async def update_matchup(
    matchup_id: str,
    matchup: MatchupUpdate,
    user_id: str = Depends(get_current_user_id),
):
    supabase = get_supabase()

    try:
        existing = supabase.table("tournament_matchups").select("*").eq("id", matchup_id).eq("coach_id", user_id).single().execute()
        if not existing.data:
            raise HTTPException(status_code=404, detail="Matchup not found")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to find matchup: {str(e)}")

    update_data = {k: v for k, v in matchup.model_dump().items() if v is not None}
    if "scheduled_at" in update_data and update_data["scheduled_at"]:
        update_data["scheduled_at"] = update_data["scheduled_at"].isoformat()
    if not update_data:
        raise HTTPException(status_code=400, detail="No fields to update")

    update_data["updated_at"] = datetime.utcnow().isoformat()

    try:
        result = supabase.table("tournament_matchups").update(update_data).eq("id", matchup_id).execute()
        row = result.data[0]

        if row.get("player_id"):
            player = supabase.table("players").select("name").eq("id", row["player_id"]).single().execute()
            row["player_name"] = player.data.get("name") if player.data else None
        else:
            row["player_name"] = None

        return MatchupResponse(**row)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update matchup: {str(e)}")


@router.delete("/matchups/{matchup_id}")
async def delete_matchup(
    matchup_id: str,
    user_id: str = Depends(get_current_user_id),
):
    supabase = get_supabase()

    try:
        existing = supabase.table("tournament_matchups").select("*").eq("id", matchup_id).eq("coach_id", user_id).single().execute()
        if not existing.data:
            raise HTTPException(status_code=404, detail="Matchup not found")

        supabase.table("tournament_matchups").delete().eq("id", matchup_id).execute()
        return {"message": "Matchup deleted"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete matchup: {str(e)}")


# --- Stats ---

@router.get("/stats/summary")
async def get_tournament_stats(
    user_id: str = Depends(get_current_user_id),
):
    supabase = get_supabase()

    try:
        tournaments = supabase.table("tournaments").select("id, status").eq("coach_id", user_id).execute()
        matchups = supabase.table("tournament_matchups").select("result").eq("coach_id", user_id).execute()

        total_tournaments = len(tournaments.data)
        upcoming = sum(1 for t in tournaments.data if t["status"] in ("upcoming", "ongoing"))
        completed = sum(1 for t in tournaments.data if t["status"] == "completed")

        total_matchups = len(matchups.data)
        wins = sum(1 for m in matchups.data if m.get("result") == "win")
        losses = sum(1 for m in matchups.data if m.get("result") == "loss")
        pending = sum(1 for m in matchups.data if m.get("result") == "pending")
        win_rate = round((wins / (wins + losses)) * 100, 1) if (wins + losses) > 0 else 0

        return {
            "total_tournaments": total_tournaments,
            "upcoming_tournaments": upcoming,
            "completed_tournaments": completed,
            "total_matchups": total_matchups,
            "wins": wins,
            "losses": losses,
            "pending_matchups": pending,
            "win_rate": win_rate,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get stats: {str(e)}")
