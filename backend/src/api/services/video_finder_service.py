"""
Video finder service — automatically searches YouTube for table tennis match videos
using yt-dlp's ytsearch. Targets the official WTT channel first, then general search.
"""

import logging
from typing import Optional

logger = logging.getLogger(__name__)

WTT_CHANNEL_URL = "https://www.youtube.com/@WTTGlobal"
WTT_CHANNEL_ID = "UC9ckyA_A3MfXUa0ttxMoIZw"

ITTF_CHANNEL_URL = "https://www.youtube.com/@ITTFWorld"
ITTF_CHANNEL_ID = "UCa2SNlpTOL4F0NeHPFMVKdw"


def search_match_video(
    player1: str,
    player2: str,
    tournament_name: str = "",
    max_results: int = 5,
) -> Optional[dict]:
    """
    Search YouTube for a match video using yt-dlp ytsearch.
    Searches @ITTFWorld first, then @WTTGlobal, then general YouTube.
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

    # First: search within the @ITTFWorld channel
    result = _search_youtube(query, max_results=max_results, channel_filter=ITTF_CHANNEL_ID)
    if result:
        return result

    # Second: search within the @WTTGlobal channel
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


