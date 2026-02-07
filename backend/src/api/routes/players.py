import uuid
import logging
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query
from pydantic import BaseModel
from datetime import datetime

from ..database.supabase import get_supabase, get_current_user_id

logger = logging.getLogger(__name__)

router = APIRouter()


class PlayerResponse(BaseModel):
    id: str
    coach_id: str
    name: str
    avatar_url: Optional[str] = None
    position: Optional[str] = None
    team: Optional[str] = None
    notes: Optional[str] = None
    handedness: str = "right"
    is_active: bool = True
    ittf_id: Optional[int] = None
    ittf_data: Optional[dict] = None
    ittf_last_synced: Optional[str] = None
    created_at: str
    updated_at: Optional[str] = None
    game_count: Optional[int] = None


class PlayerCreate(BaseModel):
    name: str
    position: Optional[str] = None
    team: Optional[str] = None
    notes: Optional[str] = None
    handedness: str = "right"
    is_active: bool = True
    ittf_id: Optional[int] = None


class PlayerUpdate(BaseModel):
    name: Optional[str] = None
    position: Optional[str] = None
    team: Optional[str] = None
    notes: Optional[str] = None
    handedness: Optional[str] = None
    is_active: Optional[bool] = None
    ittf_id: Optional[int] = None


class GamePlayerInfo(BaseModel):
    id: str
    name: str
    video_path: Optional[str] = None
    status: str
    created_at: str
    players: Optional[List[dict]] = None


@router.get("/search-ittf")
async def search_ittf(
    q: str = Query(..., min_length=2, description="Player name to search"),
    user_id: str = Depends(get_current_user_id),
):
    from ..services.ittf_service import search_ittf_players

    try:
        results = await search_ittf_players(q)
        return {"query": q, "results": results, "count": len(results)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"ITTF search failed: {str(e)}")


OFFICIAL_PLAYER_PHOTOS: dict[str, dict] = {
    "fan zhendong": {
        "avatar_url": "https://upload.wikimedia.org/wikipedia/commons/9/90/ITTF_World_Tour_2017_German_Open_Fan_Zhendong_03.jpg",
        "ittf_id": 121404,
    },
    "ma long": {
        "avatar_url": "https://upload.wikimedia.org/wikipedia/commons/6/6e/Mondial_Ping_-_Men%27s_Singles_-_Round_4_-_Ma_Long-Koki_Niwa_-_06.jpg",
        "ittf_id": 113883,
    },
    "wang chuqin": {
        "avatar_url": "https://upload.wikimedia.org/wikipedia/commons/7/7d/Table_tennis_at_the_2018_Summer_Youth_Olympics_%E2%80%93_Men%27s_Singles_Gold_Medal_Match_068_%28cropped%29.jpg",
        "ittf_id": 126498,
    },
    "liang jingkun": {
        "avatar_url": "https://upload.wikimedia.org/wikipedia/commons/0/09/Liang_Jingkun_ACTTC2016_1_%28cropped-1%29.jpeg",
        "ittf_id": 119588,
    },
    "sun yingsha": {
        "avatar_url": None,
        "ittf_id": 131163,
    },
    "lin shidong": {
        "avatar_url": None,
        "ittf_id": 137237,
    },
}


@router.post("/update-official-photos")
async def update_official_photos(
    user_id: str = Depends(get_current_user_id),
):
    from ..services.ittf_service import fetch_ittf_player_data

    supabase = get_supabase()

    try:
        result = supabase.table("players").select("*").eq("coach_id", user_id).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch players: {str(e)}")

    updated = []
    skipped = []

    for player in result.data:
        name_key = player["name"].strip().lower()
        mapping = OFFICIAL_PLAYER_PHOTOS.get(name_key)
        if not mapping:
            skipped.append(player["name"])
            continue

        update_data: dict = {"updated_at": datetime.utcnow().isoformat()}

        if mapping["avatar_url"]:
            update_data["avatar_url"] = mapping["avatar_url"]
        else:
            ittf_id = mapping["ittf_id"]
            try:
                ittf_data = await fetch_ittf_player_data(ittf_id)
                if ittf_data and ittf_data.get("headshot_url"):
                    update_data["avatar_url"] = ittf_data["headshot_url"]
                    update_data["ittf_data"] = ittf_data
                    update_data["ittf_last_synced"] = datetime.utcnow().isoformat()
                else:
                    logger.warning(f"No ITTF headshot found for {player['name']} (ITTF ID {ittf_id})")
            except Exception as e:
                logger.error(f"ITTF fetch failed for {player['name']}: {e}")

        if not player.get("ittf_id") and mapping.get("ittf_id"):
            update_data["ittf_id"] = mapping["ittf_id"]

        try:
            supabase.table("players").update(update_data).eq("id", player["id"]).execute()
            updated.append({
                "name": player["name"],
                "avatar_url": update_data.get("avatar_url", player.get("avatar_url")),
                "ittf_id": update_data.get("ittf_id", player.get("ittf_id")),
            })
        except Exception as e:
            logger.error(f"Failed to update {player['name']}: {e}")

    return {
        "updated": updated,
        "skipped": skipped,
        "updated_count": len(updated),
        "skipped_count": len(skipped),
    }


@router.post("", response_model=PlayerResponse)
async def create_player(
    player: PlayerCreate,
    user_id: str = Depends(get_current_user_id),
):
    supabase = get_supabase()
    player_id = str(uuid.uuid4())

    player_data = {
        "id": player_id,
        "coach_id": user_id,
        "name": player.name,
        "position": player.position,
        "team": player.team,
        "notes": player.notes,
        "handedness": player.handedness,
        "is_active": player.is_active,
        "ittf_id": player.ittf_id,
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat(),
    }

    try:
        result = supabase.table("players").insert(player_data).execute()
        data = result.data[0]
        data["game_count"] = 0
        return PlayerResponse(**data)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create player: {str(e)}")


@router.post("/{player_id}/avatar", response_model=PlayerResponse)
async def upload_avatar(
    player_id: str,
    avatar: UploadFile = File(...),
    user_id: str = Depends(get_current_user_id),
):
    supabase = get_supabase()

    try:
        result = supabase.table("players").select("*").eq("id", player_id).eq("coach_id", user_id).single().execute()
        if not result.data:
            raise HTTPException(status_code=404, detail="Player not found")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to find player: {str(e)}")

    avatar_content = await avatar.read()
    import os
    ext = os.path.splitext(avatar.filename or "avatar.jpg")[1]
    avatar_path = f"{user_id}/avatars/{player_id}{ext}"

    try:
        try:
            supabase.storage.from_("provision-videos").remove([avatar_path])
        except Exception:
            pass
        supabase.storage.from_("provision-videos").upload(avatar_path, avatar_content)
        avatar_url = supabase.storage.from_("provision-videos").get_public_url(avatar_path)

        supabase.table("players").update({"avatar_url": avatar_url}).eq("id", player_id).execute()

        updated = supabase.table("players").select("*").eq("id", player_id).single().execute()
        return PlayerResponse(**updated.data)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to upload avatar: {str(e)}")


@router.get("", response_model=List[PlayerResponse])
async def list_players(user_id: str = Depends(get_current_user_id)):
    supabase = get_supabase()

    try:
        result = supabase.table("players").select("*").eq("coach_id", user_id).order("created_at", desc=True).execute()

        players = []
        for player in result.data:
            count_result = supabase.table("game_players").select("id", count="exact").eq("player_id", player["id"]).execute()
            player["game_count"] = count_result.count if count_result.count is not None else 0
            players.append(PlayerResponse(**player))

        return players
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch players: {str(e)}")


@router.get("/{player_id}", response_model=PlayerResponse)
async def get_player(player_id: str, user_id: str = Depends(get_current_user_id)):
    supabase = get_supabase()

    try:
        result = supabase.table("players").select("*").eq("id", player_id).eq("coach_id", user_id).single().execute()
        if not result.data:
            raise HTTPException(status_code=404, detail="Player not found")

        count_result = supabase.table("game_players").select("id", count="exact").eq("player_id", player_id).execute()
        result.data["game_count"] = count_result.count if count_result.count is not None else 0

        return PlayerResponse(**result.data)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch player: {str(e)}")


@router.put("/{player_id}", response_model=PlayerResponse)
async def update_player(
    player_id: str,
    player: PlayerUpdate,
    user_id: str = Depends(get_current_user_id),
):
    supabase = get_supabase()

    try:
        existing = supabase.table("players").select("*").eq("id", player_id).eq("coach_id", user_id).single().execute()
        if not existing.data:
            raise HTTPException(status_code=404, detail="Player not found")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to find player: {str(e)}")

    update_data = {k: v for k, v in player.model_dump().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail="No fields to update")

    try:
        result = supabase.table("players").update(update_data).eq("id", player_id).execute()
        return PlayerResponse(**result.data[0])
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update player: {str(e)}")


@router.delete("/{player_id}")
async def delete_player(player_id: str, user_id: str = Depends(get_current_user_id)):
    supabase = get_supabase()

    try:
        existing = supabase.table("players").select("*").eq("id", player_id).eq("coach_id", user_id).single().execute()
        if not existing.data:
            raise HTTPException(status_code=404, detail="Player not found")

        supabase.table("players").delete().eq("id", player_id).execute()
        return {"message": "Player deleted"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete player: {str(e)}")


@router.post("/{player_id}/sync-ittf", response_model=PlayerResponse)
async def sync_ittf_data(
    player_id: str,
    user_id: str = Depends(get_current_user_id),
):
    from ..services.ittf_service import fetch_ittf_player_data

    supabase = get_supabase()

    try:
        existing = supabase.table("players").select("*").eq("id", player_id).eq("coach_id", user_id).single().execute()
        if not existing.data:
            raise HTTPException(status_code=404, detail="Player not found")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to find player: {str(e)}")

    ittf_id = existing.data.get("ittf_id")
    if not ittf_id:
        raise HTTPException(status_code=400, detail="Player has no ITTF ID set. Update the player with an ITTF ID first.")

    ittf_data = await fetch_ittf_player_data(ittf_id)
    if not ittf_data:
        raise HTTPException(status_code=502, detail="Could not fetch data from ITTF. The player ID may be incorrect or the service may be unavailable.")

    try:
        update = {
            "ittf_data": ittf_data,
            "ittf_last_synced": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat(),
        }
        result = supabase.table("players").update(update).eq("id", player_id).execute()
        data = result.data[0]

        count_result = supabase.table("game_players").select("id", count="exact").eq("player_id", player_id).execute()
        data["game_count"] = count_result.count if count_result.count is not None else 0

        return PlayerResponse(**data)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save ITTF data: {str(e)}")


@router.get("/{player_id}/ittf-stats")
async def get_ittf_stats(
    player_id: str,
    user_id: str = Depends(get_current_user_id),
):
    supabase = get_supabase()

    try:
        result = supabase.table("players").select("ittf_id, ittf_data, ittf_last_synced").eq("id", player_id).eq("coach_id", user_id).single().execute()
        if not result.data:
            raise HTTPException(status_code=404, detail="Player not found")

        return {
            "ittf_id": result.data.get("ittf_id"),
            "ittf_data": result.data.get("ittf_data"),
            "ittf_last_synced": result.data.get("ittf_last_synced"),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch ITTF stats: {str(e)}")


@router.get("/{player_id}/games", response_model=List[GamePlayerInfo])
async def get_player_games(
    player_id: str,
    user_id: str = Depends(get_current_user_id),
    search: Optional[str] = None,
    status: Optional[str] = None,
):
    supabase = get_supabase()

    try:
        existing = supabase.table("players").select("id").eq("id", player_id).eq("coach_id", user_id).single().execute()
        if not existing.data:
            raise HTTPException(status_code=404, detail="Player not found")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to find player: {str(e)}")

    try:
        gp_result = supabase.table("game_players").select("game_id").eq("player_id", player_id).execute()
        game_ids = [gp["game_id"] for gp in gp_result.data]

        if not game_ids:
            return []

        query = supabase.table("sessions").select("*").in_("id", game_ids).eq("user_id", user_id).order("created_at", desc=True)

        if status:
            query = query.eq("status", status)

        result = query.execute()
        games = result.data

        if search:
            search_lower = search.lower()
            games = [g for g in games if search_lower in g["name"].lower()]

        game_list = []
        for game in games:
            gp_for_game = supabase.table("game_players").select("player_id").eq("game_id", game["id"]).execute()
            player_ids = [gp["player_id"] for gp in gp_for_game.data]

            player_info = []
            if player_ids:
                players_result = supabase.table("players").select("id, name, avatar_url").in_("id", player_ids).execute()
                player_info = players_result.data

            game_list.append(GamePlayerInfo(
                id=game["id"],
                name=game["name"],
                video_path=game.get("video_path"),
                status=game["status"],
                created_at=game["created_at"],
                players=player_info,
            ))

        return game_list
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch player games: {str(e)}")
