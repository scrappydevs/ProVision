import uuid
import logging
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from datetime import datetime, date

from ..database.supabase import get_supabase, get_current_user_id

logger = logging.getLogger(__name__)

router = APIRouter()


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
        # Global: show all tournaments to any authenticated user
        query = supabase.table("tournaments").select("*").order("start_date", desc=True)
        if status:
            query = query.eq("status", status)
        result = query.execute()

        tournaments = []
        for t in result.data:
            matchups = supabase.table("tournament_matchups").select("result").eq("tournament_id", t["id"]).execute()
            t["matchup_count"] = len(matchups.data)
            t["win_count"] = sum(1 for m in matchups.data if m.get("result") == "win")
            t["loss_count"] = sum(1 for m in matchups.data if m.get("result") == "loss")
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
        # Global: show all upcoming/ongoing tournaments
        result = (
            supabase.table("tournaments")
            .select("*")
            .in_("status", ["upcoming", "ongoing"])
            .order("start_date", desc=False)
            .execute()
        )

        tournaments = []
        for t in result.data:
            matchups = supabase.table("tournament_matchups").select("result").eq("tournament_id", t["id"]).execute()
            t["matchup_count"] = len(matchups.data)
            t["win_count"] = sum(1 for m in matchups.data if m.get("result") == "win")
            t["loss_count"] = sum(1 for m in matchups.data if m.get("result") == "loss")
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
        # Global: show all past tournaments
        result = (
            supabase.table("tournaments")
            .select("*")
            .in_("status", ["completed", "cancelled"])
            .order("start_date", desc=True)
            .execute()
        )

        tournaments = []
        for t in result.data:
            matchups = supabase.table("tournament_matchups").select("result").eq("tournament_id", t["id"]).execute()
            t["matchup_count"] = len(matchups.data)
            t["win_count"] = sum(1 for m in matchups.data if m.get("result") == "win")
            t["loss_count"] = sum(1 for m in matchups.data if m.get("result") == "loss")
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


@router.post("/sync-wtt")
async def sync_wtt_tournaments(
    user_id: str = Depends(get_current_user_id),
):
    from ..services.wtt_tournament_seeder import seed_real_wtt_tournaments

    supabase = get_supabase()
    try:
        results = await seed_real_wtt_tournaments(user_id, supabase)
        return {"message": f"Synced {len(results)} tournaments", "tournaments": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"WTT sync failed: {str(e)}")


@router.post("/backfill-videos")
async def backfill_tournament_videos(
    user_id: str = Depends(get_current_user_id),
):
    from ..services.wtt_tournament_seeder import backfill_videos

    supabase = get_supabase()
    try:
        stats = await backfill_videos(user_id, supabase)
        return {"message": f"Searched {stats['searched']}, found {stats['found']}", **stats}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Video backfill failed: {str(e)}")


@router.post("/backfill-previews")
async def backfill_tournament_previews(
    user_id: str = Depends(get_current_user_id),
):
    """Backfill preview thumbnails for existing WTT tournaments"""
    from ..services.wtt_tournament_seeder import REAL_TOURNAMENTS

    supabase = get_supabase()
    
    preview_map = {
        t["name"]: t.get("preview_thumbnail")
        for t in REAL_TOURNAMENTS
        if t.get("preview_thumbnail")
    }
    
    updated = 0
    for name, thumbnail_url in preview_map.items():
        try:
            # Find tournament by name
            result = (
                supabase.table("tournaments")
                .select("id, metadata")
                .eq("coach_id", user_id)
                .eq("name", name)
                .execute()
            )
            
            if not result.data:
                continue
                
            tournament = result.data[0]
            metadata = tournament.get("metadata") or {}
            metadata["thumbnail_url"] = thumbnail_url
            metadata["preview_image_url"] = thumbnail_url
            
            # Update tournament
            supabase.table("tournaments").update({
                "metadata": metadata,
            }).eq("id", tournament["id"]).execute()
            
            updated += 1
            
        except Exception as e:
            logger.error(f"Failed to update preview for {name}: {e}")
            continue
    
    return {"message": f"Updated {updated} tournaments with preview thumbnails", "updated": updated}


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
        # Global: any authenticated user can view any tournament
        result = (
            supabase.table("tournaments")
            .select("*")
            .eq("id", tournament_id)
            .single()
            .execute()
        )
        if not result.data:
            raise HTTPException(status_code=404, detail="Tournament not found")

        matchups = supabase.table("tournament_matchups").select("result").eq("tournament_id", tournament_id).execute()
        result.data["matchup_count"] = len(matchups.data)
        result.data["win_count"] = sum(1 for m in matchups.data if m.get("result") == "win")
        result.data["loss_count"] = sum(1 for m in matchups.data if m.get("result") == "loss")

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

        matchups = supabase.table("tournament_matchups").select("result").eq("tournament_id", tournament_id).execute()
        row["matchup_count"] = len(matchups.data)
        row["win_count"] = sum(1 for m in matchups.data if m.get("result") == "win")
        row["loss_count"] = sum(1 for m in matchups.data if m.get("result") == "loss")

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
        # Global: verify tournament exists (no owner check)
        existing = supabase.table("tournaments").select("id").eq("id", tournament_id).single().execute()
        if not existing.data:
            raise HTTPException(status_code=404, detail="Tournament not found")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to find tournament: {str(e)}")

    try:
        result = supabase.table("tournament_matchups").select("*").eq("tournament_id", tournament_id).order("scheduled_at", desc=False).execute()

        matchups = []
        for m in result.data:
            if m.get("player_id"):
                try:
                    player = supabase.table("players").select("name").eq("id", m["player_id"]).single().execute()
                    m["player_name"] = player.data.get("name") if player.data else None
                except Exception:
                    m["player_name"] = None
            else:
                m["player_name"] = None
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
        # Global: aggregate stats across all tournaments
        tournaments = supabase.table("tournaments").select("id, status").execute()
        matchups = supabase.table("tournament_matchups").select("result").execute()

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
