import logging
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from ..database.supabase import get_supabase, get_current_user_id

logger = logging.getLogger(__name__)

router = APIRouter()


# ── Response Models ──────────────────────────────────────────────────

class WTTTournamentResponse(BaseModel):
    id: str
    external_id: Optional[str] = None
    name: str
    season_name: Optional[str] = None
    location: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    tier: Optional[str] = None
    league_name: Optional[str] = None
    status: Optional[str] = None
    match_count: Optional[int] = None
    created_at: str
    updated_at: Optional[str] = None


class WTTPlayerResponse(BaseModel):
    id: str
    external_id: Optional[str] = None
    ittf_id: Optional[int] = None
    name: str
    country: Optional[str] = None
    ranking: Optional[int] = None
    grip_style: Optional[str] = None
    handedness: Optional[str] = None
    photo_url: Optional[str] = None
    birth_year: Optional[int] = None
    playing_style: Optional[str] = None
    career_wins: Optional[int] = None
    career_losses: Optional[int] = None
    created_at: str
    updated_at: Optional[str] = None


class WTTMatchResponse(BaseModel):
    id: str
    external_id: Optional[str] = None
    tournament_id: str
    tournament_name: Optional[str] = None
    player_1_id: Optional[str] = None
    player_1_name: Optional[str] = None
    player_1_country: Optional[str] = None
    player_2_id: Optional[str] = None
    player_2_name: Optional[str] = None
    player_2_country: Optional[str] = None
    winner_id: Optional[str] = None
    round: Optional[str] = None
    score_summary: Optional[str] = None
    score_detail: Optional[str] = None
    scores_json: Optional[list] = None
    status: Optional[str] = None
    start_time: Optional[str] = None
    duration_seconds: Optional[int] = None
    video_url: Optional[str] = None
    created_at: str
    updated_at: Optional[str] = None


# ── Tournament Endpoints ─────────────────────────────────────────────

@router.get("/tournaments", response_model=List[WTTTournamentResponse])
async def list_wtt_tournaments(
    user_id: str = Depends(get_current_user_id),
    tier: Optional[str] = Query(None),
    year: Optional[int] = Query(None),
    search: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    supabase = get_supabase()

    try:
        query = supabase.table("wtt_tournaments").select("*").order("start_date", desc=True)

        if tier:
            query = query.eq("tier", tier)
        if search:
            query = query.ilike("name", f"%{search}%")

        result = query.range(offset, offset + limit - 1).execute()

        tournaments = []
        for t in result.data:
            # Count matches
            mc = supabase.table("wtt_matches").select("id", count="exact").eq("tournament_id", t["id"]).execute()
            t["match_count"] = mc.count if hasattr(mc, 'count') and mc.count is not None else len(mc.data)
            tournaments.append(WTTTournamentResponse(**t))

        return tournaments
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list WTT tournaments: {str(e)}")


@router.get("/tournaments/{tournament_id}", response_model=WTTTournamentResponse)
async def get_wtt_tournament(
    tournament_id: str,
    user_id: str = Depends(get_current_user_id),
):
    supabase = get_supabase()

    try:
        result = supabase.table("wtt_tournaments").select("*").eq("id", tournament_id).single().execute()
        if not result.data:
            raise HTTPException(status_code=404, detail="Tournament not found")

        mc = supabase.table("wtt_matches").select("id", count="exact").eq("tournament_id", tournament_id).execute()
        result.data["match_count"] = mc.count if hasattr(mc, 'count') and mc.count is not None else len(mc.data)

        return WTTTournamentResponse(**result.data)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get tournament: {str(e)}")


@router.get("/tournaments/{tournament_id}/matches", response_model=List[WTTMatchResponse])
async def list_tournament_matches(
    tournament_id: str,
    user_id: str = Depends(get_current_user_id),
    round: Optional[str] = Query(None),
):
    supabase = get_supabase()

    try:
        query = (
            supabase.table("wtt_matches")
            .select("*")
            .eq("tournament_id", tournament_id)
            .order("created_at", desc=False)
        )
        if round:
            query = query.eq("round", round)

        result = query.execute()

        # Get tournament name
        t = supabase.table("wtt_tournaments").select("name").eq("id", tournament_id).single().execute()
        tournament_name = t.data.get("name", "") if t.data else ""

        # Enrich with player names
        return _enrich_matches(result.data, tournament_name, supabase)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list matches: {str(e)}")


# ── Match Endpoints ──────────────────────────────────────────────────

@router.get("/matches/{match_id}", response_model=WTTMatchResponse)
async def get_wtt_match(
    match_id: str,
    user_id: str = Depends(get_current_user_id),
):
    supabase = get_supabase()

    try:
        result = supabase.table("wtt_matches").select("*").eq("id", match_id).single().execute()
        if not result.data:
            raise HTTPException(status_code=404, detail="Match not found")

        t = supabase.table("wtt_tournaments").select("name").eq("id", result.data["tournament_id"]).single().execute()
        tournament_name = t.data.get("name", "") if t.data else ""

        enriched = _enrich_matches([result.data], tournament_name, supabase)
        return enriched[0]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get match: {str(e)}")


# ── Player Endpoints ─────────────────────────────────────────────────

@router.get("/players", response_model=List[WTTPlayerResponse])
async def list_wtt_players(
    user_id: str = Depends(get_current_user_id),
    search: Optional[str] = Query(None),
    country: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    supabase = get_supabase()

    try:
        query = supabase.table("wtt_players").select("*").order("ranking", desc=False)

        if search:
            query = query.ilike("name", f"%{search}%")
        if country:
            query = query.eq("country", country)

        result = query.range(offset, offset + limit - 1).execute()
        return [WTTPlayerResponse(**p) for p in result.data]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list WTT players: {str(e)}")


@router.get("/players/{player_id}", response_model=WTTPlayerResponse)
async def get_wtt_player(
    player_id: str,
    user_id: str = Depends(get_current_user_id),
):
    supabase = get_supabase()

    try:
        result = supabase.table("wtt_players").select("*").eq("id", player_id).single().execute()
        if not result.data:
            raise HTTPException(status_code=404, detail="Player not found")
        return WTTPlayerResponse(**result.data)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get player: {str(e)}")


@router.get("/players/{player_id}/matches", response_model=List[WTTMatchResponse])
async def get_player_matches(
    player_id: str,
    user_id: str = Depends(get_current_user_id),
    limit: int = Query(20, ge=1, le=50),
):
    supabase = get_supabase()

    try:
        # Matches where this player is either player_1 or player_2
        q1 = (
            supabase.table("wtt_matches")
            .select("*")
            .eq("player_1_id", player_id)
            .order("start_time", desc=True)
            .limit(limit)
            .execute()
        )
        q2 = (
            supabase.table("wtt_matches")
            .select("*")
            .eq("player_2_id", player_id)
            .order("start_time", desc=True)
            .limit(limit)
            .execute()
        )

        all_matches = q1.data + q2.data
        # Deduplicate and sort
        seen = set()
        unique = []
        for m in sorted(all_matches, key=lambda x: x.get("start_time") or "", reverse=True):
            if m["id"] not in seen:
                seen.add(m["id"])
                unique.append(m)

        # Enrich with player names + tournament name
        return _enrich_matches(unique[:limit], "", supabase)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get player matches: {str(e)}")


# ── Sync Endpoints (trigger scraping) ────────────────────────────────

class SyncTournamentRequest(BaseModel):
    external_tournament_id: int


@router.post("/sync/tournament")
async def sync_tournament_endpoint(
    request: SyncTournamentRequest,
    user_id: str = Depends(get_current_user_id),
):
    from ..services.match_scraper_service import sync_tournament

    supabase = get_supabase()
    try:
        result = await sync_tournament(request.external_tournament_id, supabase)
        if not result:
            raise HTTPException(status_code=404, detail="Tournament not found or no data available")
        return {"message": "Tournament synced", "tournament": result}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Sync failed: {str(e)}")


@router.post("/sync/recent")
async def sync_recent_endpoint(
    user_id: str = Depends(get_current_user_id),
    days: int = Query(30, ge=1, le=365),
):
    from ..services.match_scraper_service import sync_recent_tournaments

    supabase = get_supabase()
    try:
        results = await sync_recent_tournaments(supabase, days=days)
        return {"message": f"Synced {len(results)} tournaments", "tournaments": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Sync failed: {str(e)}")


@router.post("/sync/videos/{tournament_id}")
async def sync_videos_endpoint(
    tournament_id: str,
    user_id: str = Depends(get_current_user_id),
):
    from ..services.video_finder_service import auto_enrich_tournament_videos

    supabase = get_supabase()
    try:
        # Verify tournament exists
        t = supabase.table("wtt_tournaments").select("id").eq("id", tournament_id).single().execute()
        if not t.data:
            raise HTTPException(status_code=404, detail="Tournament not found")

        stats = await auto_enrich_tournament_videos(tournament_id, supabase)
        return {"message": "Video search complete", "stats": stats}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Video sync failed: {str(e)}")


@router.post("/players/{player_id}/enrich")
async def enrich_player_endpoint(
    player_id: str,
    user_id: str = Depends(get_current_user_id),
):
    from ..services.match_scraper_service import enrich_player_from_ittf

    supabase = get_supabase()
    try:
        player = supabase.table("wtt_players").select("name").eq("id", player_id).single().execute()
        if not player.data:
            raise HTTPException(status_code=404, detail="Player not found")

        success = await enrich_player_from_ittf(player_id, player.data["name"], supabase)
        if success:
            updated = supabase.table("wtt_players").select("*").eq("id", player_id).single().execute()
            return {"message": "Player enriched from ITTF", "player": updated.data}
        else:
            return {"message": "No ITTF data found for this player"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Enrichment failed: {str(e)}")


# ── Helpers ──────────────────────────────────────────────────────────

def _enrich_matches(
    matches: list[dict],
    tournament_name: str,
    supabase,
) -> list[WTTMatchResponse]:
    """Enrich match dicts with player names and tournament name."""
    # Collect player IDs
    player_ids = set()
    tournament_ids = set()
    for m in matches:
        if m.get("player_1_id"):
            player_ids.add(m["player_1_id"])
        if m.get("player_2_id"):
            player_ids.add(m["player_2_id"])
        if not tournament_name and m.get("tournament_id"):
            tournament_ids.add(m["tournament_id"])

    # Fetch player names
    player_lookup: dict[str, dict] = {}
    if player_ids:
        ids_list = list(player_ids)
        players = supabase.table("wtt_players").select("id, name, country").in_("id", ids_list).execute()
        for p in players.data:
            player_lookup[p["id"]] = p

    # Fetch tournament names if needed
    tournament_lookup: dict[str, str] = {}
    if tournament_ids:
        ids_list = list(tournament_ids)
        tournaments = supabase.table("wtt_tournaments").select("id, name").in_("id", ids_list).execute()
        for t in tournaments.data:
            tournament_lookup[t["id"]] = t["name"]

    enriched = []
    for m in matches:
        p1 = player_lookup.get(m.get("player_1_id", ""), {})
        p2 = player_lookup.get(m.get("player_2_id", ""), {})
        m["player_1_name"] = p1.get("name")
        m["player_1_country"] = p1.get("country")
        m["player_2_name"] = p2.get("name")
        m["player_2_country"] = p2.get("country")
        m["tournament_name"] = tournament_name or tournament_lookup.get(m.get("tournament_id", ""))
        enriched.append(WTTMatchResponse(**m))

    return enriched
