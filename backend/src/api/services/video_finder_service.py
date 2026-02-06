"""
Video finder service — automatically searches YouTube for table tennis match videos
using yt-dlp's ytsearch. Targets the official WTT channel first, then general search.
"""

import logging
from typing import Optional
from datetime import datetime

logger = logging.getLogger(__name__)

WTT_CHANNEL_URL = "https://www.youtube.com/@WTTGlobal"
WTT_CHANNEL_ID = "UC9ckyA_A3MfXUa0ttxMoIZw"


def search_match_video(
    player1: str,
    player2: str,
    tournament_name: str = "",
    max_results: int = 5,
) -> Optional[dict]:
    """
    Search YouTube for a match video using yt-dlp ytsearch.
    Returns the best match as {url, title, thumbnail_url, duration, channel, youtube_video_id}.
    """
    try:
        import yt_dlp
    except ImportError:
        logger.error("yt-dlp not installed")
        return None

    query = f"{player1} vs {player2}"
    if tournament_name:
        query += f" {tournament_name}"
    query += " table tennis"

    # First: search within the WTT channel
    result = _search_youtube(query, max_results=max_results, channel_filter=WTT_CHANNEL_ID)
    if result:
        return result

    # Fallback: general YouTube search
    result = _search_youtube(query, max_results=max_results)
    return result


def _search_youtube(
    query: str,
    max_results: int = 5,
    channel_filter: Optional[str] = None,
) -> Optional[dict]:
    """Run yt-dlp ytsearch and return the best result."""
    try:
        import yt_dlp

        search_url = f"ytsearch{max_results}:{query}"

        ydl_opts = {
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
            "extract_flat": False,
        }

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(search_url, download=False)

        if not info or "entries" not in info:
            return None

        entries = list(info["entries"]) if info["entries"] else []

        for entry in entries:
            if not entry:
                continue

            # Filter by channel if specified
            if channel_filter:
                entry_channel = entry.get("channel_id") or ""
                if entry_channel != channel_filter:
                    continue

            # Skip very short videos (< 60s, likely clips) and very long (> 2h)
            duration = entry.get("duration") or 0
            if duration < 60 or duration > 7200:
                continue

            video_id = entry.get("id", "")
            return {
                "url": f"https://www.youtube.com/watch?v={video_id}",
                "title": entry.get("title", ""),
                "thumbnail_url": entry.get("thumbnail") or f"https://img.youtube.com/vi/{video_id}/hqdefault.jpg",
                "duration": _format_duration(duration),
                "duration_seconds": duration,
                "channel": entry.get("uploader") or entry.get("channel") or "",
                "youtube_video_id": video_id,
                "view_count": entry.get("view_count"),
                "upload_date": entry.get("upload_date"),
            }

        return None
    except Exception as e:
        logger.error(f"YouTube search failed for '{query}': {e}")
        return None


def _format_duration(seconds: int) -> str:
    """Format seconds to HH:MM:SS or MM:SS."""
    hours = seconds // 3600
    minutes = (seconds % 3600) // 60
    secs = seconds % 60
    if hours > 0:
        return f"{hours}:{minutes:02d}:{secs:02d}"
    return f"{minutes}:{secs:02d}"


async def auto_enrich_tournament_videos(tournament_uuid: str, supabase) -> dict:
    """
    For all matches in a tournament that don't have a video_url,
    search YouTube and populate the video_url field.
    Returns stats: {searched, found, errors}.
    """
    stats = {"searched": 0, "found": 0, "errors": 0}

    try:
        # Get tournament name
        t_result = supabase.table("wtt_tournaments").select("name").eq("id", tournament_uuid).single().execute()
        tournament_name = t_result.data.get("name", "") if t_result.data else ""

        # Get matches without video
        matches = (
            supabase.table("wtt_matches")
            .select("id, player_1_id, player_2_id, video_url")
            .eq("tournament_id", tournament_uuid)
            .is_("video_url", "null")
            .eq("status", "finished")
            .execute()
        )

        if not matches.data:
            return stats

        # Build player name lookup
        player_ids = set()
        for m in matches.data:
            if m.get("player_1_id"):
                player_ids.add(m["player_1_id"])
            if m.get("player_2_id"):
                player_ids.add(m["player_2_id"])

        player_names: dict[str, str] = {}
        if player_ids:
            ids_list = list(player_ids)
            players = supabase.table("wtt_players").select("id, name").in_("id", ids_list).execute()
            for p in players.data:
                player_names[p["id"]] = p["name"]

        # Search for each match
        for m in matches.data:
            stats["searched"] += 1
            p1_name = player_names.get(m.get("player_1_id", ""), "Player 1")
            p2_name = player_names.get(m.get("player_2_id", ""), "Player 2")

            try:
                result = search_match_video(p1_name, p2_name, tournament_name)
                if result and result.get("url"):
                    supabase.table("wtt_matches").update({
                        "video_url": result["url"],
                        "updated_at": datetime.utcnow().isoformat(),
                    }).eq("id", m["id"]).execute()
                    stats["found"] += 1
                    logger.info(f"Found video for {p1_name} vs {p2_name}: {result['url']}")
            except Exception as e:
                stats["errors"] += 1
                logger.error(f"Video search error for match {m['id']}: {e}")

    except Exception as e:
        logger.error(f"Auto-enrich failed for tournament {tournament_uuid}: {e}")
        stats["errors"] += 1

    return stats
