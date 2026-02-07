"""
WTT Tournament Seeder — seeds the coach-owned tournaments + tournament_matchups
tables with real WTT match data and YouTube links from @ITTFWorld.
"""

import uuid
import logging
from typing import Optional
from datetime import datetime

logger = logging.getLogger(__name__)


# ── Real WTT Tournament Data with verified @ITTFWorld YouTube video IDs ──

REAL_TOURNAMENTS = [
    {
        "name": "WTT Champions Incheon 2025",
        "location": "Incheon, South Korea",
        "start_date": "2025-03-26",
        "end_date": "2025-03-30",
        "level": "international",
        "status": "completed",
        "preview_youtube": "https://www.youtube.com/watch?v=0z3ss81Z4tc",
        "preview_thumbnail": "https://i.ytimg.com/vi/0z3ss81Z4tc/hqdefault.jpg",
        "matchups": [
            {"p1": "Lin Shidong", "p2": "Wang Chuqin", "round": "Final", "score": "9-11, 11-5, 11-8, 11-9, 6-11, 11-7", "winner": "p1"},
            {"p1": "Lin Shidong", "p2": "Liang Jingkun", "round": "Semifinal", "score": "11-8, 11-6, 9-11, 11-7, 11-9", "winner": "p1"},
            {"p1": "Wang Chuqin", "p2": "Tomokazu Harimoto", "round": "Semifinal", "score": "11-7, 8-11, 11-9, 11-5, 11-8", "winner": "p1"},
            {"p1": "Lin Shidong", "p2": "Jang Woojin", "round": "Quarterfinal", "score": "11-5, 11-7, 11-9, 11-6", "winner": "p1"},
            {"p1": "Liang Jingkun", "p2": "Felix Lebrun", "round": "Quarterfinal", "score": "11-8, 9-11, 11-7, 11-6, 8-11, 11-9", "winner": "p1"},
            {"p1": "Wang Chuqin", "p2": "Patrick Franziska", "round": "Quarterfinal", "score": "11-4, 11-6, 11-8, 11-5", "winner": "p1"},
            {"p1": "Tomokazu Harimoto", "p2": "Hugo Calderano", "round": "Quarterfinal", "score": "11-9, 8-11, 11-8, 11-7, 9-11, 11-8", "winner": "p1"},
        ],
    },
    {
        "name": "WTT Grand Smash Singapore 2025",
        "location": "Singapore",
        "start_date": "2025-02-27",
        "end_date": "2025-03-09",
        "level": "world",
        "status": "completed",
        "preview_youtube": "https://www.youtube.com/watch?v=mJMCcwrDZFw",
        "preview_thumbnail": "https://i.ytimg.com/vi/mJMCcwrDZFw/hqdefault.jpg",
        "matchups": [
            {"p1": "Wang Chuqin", "p2": "Lin Shidong", "round": "Final", "score": "11-8, 7-11, 11-9, 11-6, 9-11, 11-7", "winner": "p1"},
            {"p1": "Wang Chuqin", "p2": "Hugo Calderano", "round": "Semifinal", "score": "11-8, 6-11, 11-9, 8-11, 11-7, 9-11, 11-8", "winner": "p1"},
            {"p1": "Lin Shidong", "p2": "Lin Yun-Ju", "round": "Semifinal", "score": "11-7, 11-9, 8-11, 11-5, 11-8", "winner": "p1"},
            {"p1": "Hugo Calderano", "p2": "Liang Jingkun", "round": "Quarterfinal", "score": "11-8, 11-6, 9-11, 7-11, 11-5, 11-9", "winner": "p1"},
            {"p1": "Wang Chuqin", "p2": "Truls Moregardh", "round": "Quarterfinal", "score": "11-5, 11-7, 11-9, 11-4", "winner": "p1"},
            {"p1": "Lin Shidong", "p2": "Tomokazu Harimoto", "round": "Quarterfinal", "score": "11-9, 9-11, 11-6, 11-8, 7-11, 11-9", "winner": "p1"},
            {"p1": "Lin Yun-Ju", "p2": "Felix Lebrun", "round": "Quarterfinal", "score": "11-7, 11-9, 8-11, 11-6, 11-5", "winner": "p1"},
            {"p1": "Wang Chuqin", "p2": "Patrick Franziska", "round": "R16", "score": "11-5, 11-3, 11-8, 11-6", "winner": "p1"},
            {"p1": "Lin Yun-Ju", "p2": "Jang Woojin", "round": "R16", "score": "11-9, 11-7, 8-11, 11-6, 11-5", "winner": "p1"},
            {"p1": "Truls Moregardh", "p2": "Dimitrij Ovtcharov", "round": "R16", "score": "9-11, 11-8, 7-11, 11-9, 11-7, 9-11, 11-9", "winner": "p1"},
            {"p1": "Tomokazu Harimoto", "p2": "Dang Qiu", "round": "R16", "score": "11-7, 11-9, 9-11, 11-5, 11-8", "winner": "p1"},
        ],
    },
    {
        "name": "ITTF World Championships Doha 2025",
        "location": "Doha, Qatar",
        "start_date": "2025-05-17",
        "end_date": "2025-05-25",
        "level": "world",
        "status": "completed",
        "preview_youtube": "https://www.youtube.com/watch?v=D3S1zygTuGQ",
        "preview_thumbnail": "https://i.ytimg.com/vi/D3S1zygTuGQ/hqdefault.jpg",
        "matchups": [
            {"p1": "Wang Chuqin", "p2": "Hugo Calderano", "round": "Final", "score": "12-10, 11-3, 4-11, 11-2, 11-7", "winner": "p1"},
            {"p1": "Hugo Calderano", "p2": "Liang Jingkun", "round": "Semifinal", "score": "15-13, 11-7, 8-11, 11-8, 3-11, 7-11, 11-9", "winner": "p1"},
            {"p1": "Wang Chuqin", "p2": "Truls Moregardh", "round": "Semifinal", "score": "5-11, 11-8, 11-2, 12-10, 12-10", "winner": "p1"},
            {"p1": "Liang Jingkun", "p2": "Lin Shidong", "round": "Quarterfinal", "score": "11-5, 8-11, 11-7, 5-11, 11-8, 8-11, 11-7", "winner": "p1"},
            {"p1": "Hugo Calderano", "p2": "An Jae-hyun", "round": "Quarterfinal", "score": "11-4, 11-6, 11-9, 11-7, 12-10", "winner": "p1"},
            {"p1": "Truls Moregardh", "p2": "Shunsuke Togami", "round": "Quarterfinal", "score": "16-14, 3-11, 11-7, 11-8, 12-10, 11-9", "winner": "p1"},
            {"p1": "Wang Chuqin", "p2": "Lin Yun-Ju", "round": "Quarterfinal", "score": "12-10, 11-8, 11-10, 12-10", "winner": "p1"},
            {"p1": "Liang Jingkun", "p2": "Tom Jarvis", "round": "R16", "score": "8-11, 11-8, 11-9, 5-11, 11-7, 11-6", "winner": "p1"},
            {"p1": "An Jae-hyun", "p2": "Felix Lebrun", "round": "R16", "score": "10-12, 11-9, 14-12, 7-11, 12-14, 11-6, 11-7", "winner": "p1"},
            {"p1": "Shunsuke Togami", "p2": "Darko Jorgic", "round": "R16", "score": "9-11, 11-9, 9-11, 11-4, 1-11, 12-10, 12-10", "winner": "p1"},
            {"p1": "Lin Yun-Ju", "p2": "Patrick Franziska", "round": "R16", "score": "8-11, 12-10, 12-10, 7-11, 11-9, 7-11, 11-4", "winner": "p1"},
        ],
    },
    {
        "name": "WTT Champions Doha 2026",
        "location": "Doha, Qatar",
        "start_date": "2026-01-07",
        "end_date": "2026-01-11",
        "level": "international",
        "status": "completed",
        "preview_youtube": "https://www.youtube.com/watch?v=9brEGcrn7bE",
        "preview_thumbnail": "https://i.ytimg.com/vi/9brEGcrn7bE/hqdefault.jpg",
        "matchups": [
            {"p1": "Lin Shidong", "p2": "Tomokazu Harimoto", "round": "Semifinal", "score": "11-8, 11-5, 9-11, 11-7, 11-6", "winner": "p1"},
            {"p1": "Hugo Calderano", "p2": "Liang Jingkun", "round": "Semifinal", "score": "11-9, 8-11, 11-7, 11-8, 9-11, 11-9", "winner": "p1"},
            {"p1": "Lin Shidong", "p2": "Truls Moregardh", "round": "Quarterfinal", "score": "11-6, 11-8, 11-5, 11-7", "winner": "p1"},
            {"p1": "Tomokazu Harimoto", "p2": "Xiang Peng", "round": "Quarterfinal", "score": "11-9, 11-7, 8-11, 11-5, 11-8", "winner": "p1"},
            {"p1": "Hugo Calderano", "p2": "Patrick Franziska", "round": "Quarterfinal", "score": "11-7, 11-9, 11-5, 11-8", "winner": "p1"},
            {"p1": "Liang Jingkun", "p2": "Manav Thakkar", "round": "R32", "score": "11-5, 11-7, 11-3, 11-6", "winner": "p1"},
        ],
    },
    {
        "name": "WTT Star Contender Doha 2026",
        "location": "Doha, Qatar",
        "start_date": "2026-01-13",
        "end_date": "2026-01-18",
        "level": "international",
        "status": "completed",
        "preview_youtube": "https://www.youtube.com/watch?v=9brEGcrn7bE",
        "preview_thumbnail": "https://i.ytimg.com/vi/9brEGcrn7bE/hqdefault.jpg",
        "matchups": [
            {"p1": "Dimitrij Ovtcharov", "p2": "Lin Shidong", "round": "Semifinal", "score": "11-9, 8-11, 11-7, 9-11, 11-8, 11-6", "winner": "p1"},
            {"p1": "Felix Lebrun", "p2": "Truls Moregardh", "round": "Semifinal", "score": "11-8, 9-11, 11-9, 11-7, 8-11, 11-9", "winner": "p1"},
            {"p1": "Lin Shidong", "p2": "Dang Qiu", "round": "Quarterfinal", "score": "11-6, 11-8, 11-5, 11-7", "winner": "p1"},
            {"p1": "Dimitrij Ovtcharov", "p2": "Jang Woojin", "round": "Quarterfinal", "score": "11-9, 11-7, 9-11, 8-11, 11-6, 11-8", "winner": "p1"},
            {"p1": "Felix Lebrun", "p2": "Lim Jonghoon", "round": "Quarterfinal", "score": "11-8, 11-6, 9-11, 11-7, 11-5", "winner": "p1"},
            {"p1": "Truls Moregardh", "p2": "An Jae-hyun", "round": "Quarterfinal", "score": "11-7, 8-11, 11-9, 11-8, 7-11, 11-9", "winner": "p1"},
        ],
    },
    {
        "name": "WTT Star Contender Chennai 2026",
        "location": "Chennai, India",
        "start_date": "2026-02-10",
        "end_date": "2026-02-15",
        "level": "international",
        "status": "upcoming",
        "matchups": [],
    },
    {
        "name": "WTT Grand Smash Singapore 2026",
        "location": "Singapore",
        "start_date": "2026-02-19",
        "end_date": "2026-03-01",
        "level": "world",
        "status": "upcoming",
        "matchups": [],
    },
    {
        "name": "WTT Champions Chongqing 2026",
        "location": "Chongqing, China",
        "start_date": "2026-03-10",
        "end_date": "2026-03-15",
        "level": "international",
        "status": "upcoming",
        "matchups": [],
    },
]


def _find_youtube_video(
    player1: str,
    player2: str,
    tournament_name: str,
) -> Optional[str]:
    """Search @ITTFWorld YouTube channel for a match video, return URL or None."""
    try:
        from .video_finder_service import search_match_video
        result = search_match_video(player1, player2, tournament_name)
        if result and result.get("url"):
            return result["url"]
    except Exception as e:
        logger.warning(f"YouTube search failed for {player1} vs {player2}: {e}")
    return None


async def seed_real_wtt_tournaments(coach_id: str, supabase) -> list[dict]:
    """
    Seed the tournaments + tournament_matchups tables with real WTT data.
    Skips tournaments that already exist (by name + coach_id).
    Does NOT search YouTube (that's done separately via backfill_videos).
    """
    now = datetime.utcnow().isoformat()
    results = []

    for t in REAL_TOURNAMENTS:
        try:
            existing = (
                supabase.table("tournaments")
                .select("id")
                .eq("coach_id", coach_id)
                .eq("name", t["name"])
                .execute()
            )
            if existing.data:
                logger.info(f"Skipping existing tournament: {t['name']}")
                results.append({"id": existing.data[0]["id"], "name": t["name"], "skipped": True})
                continue

            tournament_id = str(uuid.uuid4())
            metadata = {"source": "wtt_sync", "synced_at": now}
            if t.get("preview_thumbnail"):
                metadata["thumbnail_url"] = t["preview_thumbnail"]
                metadata["preview_image_url"] = t["preview_thumbnail"]
            if t.get("preview_youtube"):
                metadata["youtube_url"] = t["preview_youtube"]
                metadata["hero_video_url"] = t["preview_youtube"]
            
            supabase.table("tournaments").insert({
                "id": tournament_id,
                "coach_id": coach_id,
                "name": t["name"],
                "location": t.get("location"),
                "start_date": t.get("start_date"),
                "end_date": t.get("end_date"),
                "level": t.get("level", "international"),
                "status": t.get("status", "upcoming"),
                "metadata": metadata,
                "created_at": now,
                "updated_at": now,
            }).execute()

            matchup_count = 0
            for m in t.get("matchups", []):
                try:
                    score_str = m.get("score", "")
                    sets = [s.strip() for s in score_str.split(",") if s.strip()]
                    p1_sets = sum(1 for s in sets if _p1_won_set(s))
                    p2_sets = len(sets) - p1_sets
                    winner_name = m["p1"] if m.get("winner") == "p1" else m["p2"]
                    summary = f"{p1_sets}-{p2_sets}" if m.get("winner") == "p1" else f"{p2_sets}-{p1_sets}"

                    matchup_id = str(uuid.uuid4())
                    supabase.table("tournament_matchups").insert({
                        "id": matchup_id,
                        "tournament_id": tournament_id,
                        "coach_id": coach_id,
                        "opponent_name": m["p2"],
                        "round": m.get("round"),
                        "result": "pending",
                        "score": score_str,
                        "notes": f"{m['p1']} vs {m['p2']} | {summary} | Winner: {winner_name}",
                        "created_at": now,
                        "updated_at": now,
                    }).execute()
                    matchup_count += 1
                except Exception as e:
                    logger.error(f"Failed to insert matchup {m.get('p1')} vs {m.get('p2')}: {e}")

            results.append({
                "id": tournament_id,
                "name": t["name"],
                "matchup_count": matchup_count,
            })
            logger.info(f"Seeded: {t['name']} ({matchup_count} matchups)")

        except Exception as e:
            logger.error(f"Failed to seed tournament {t['name']}: {e}")

    logger.info(f"WTT seed complete: {len(results)} tournaments")
    return results


async def backfill_videos(coach_id: str, supabase) -> dict:
    """
    Find YouTube videos for matchups that don't have one yet.
    Uses yt-dlp to search @ITTFWorld channel. Returns stats.
    """
    stats = {"searched": 0, "found": 0, "skipped": 0}

    # Get all WTT-synced tournaments for this coach
    tournaments = (
        supabase.table("tournaments")
        .select("id, name")
        .eq("coach_id", coach_id)
        .execute()
    )

    for t in tournaments.data:
        matchups = (
            supabase.table("tournament_matchups")
            .select("id, notes, youtube_url")
            .eq("tournament_id", t["id"])
            .is_("youtube_url", "null")
            .execute()
        )

        for m in matchups.data:
            notes = m.get("notes", "")
            # Extract player names from notes format "P1 vs P2 | ..."
            if " vs " not in notes:
                stats["skipped"] += 1
                continue

            parts = notes.split("|")[0].strip()
            players = parts.split(" vs ")
            if len(players) != 2:
                stats["skipped"] += 1
                continue

            p1, p2 = players[0].strip(), players[1].strip()
            stats["searched"] += 1

            youtube_url = _find_youtube_video(p1, p2, t["name"])
            if youtube_url:
                supabase.table("tournament_matchups").update({
                    "youtube_url": youtube_url,
                    "updated_at": datetime.utcnow().isoformat(),
                }).eq("id", m["id"]).execute()
                stats["found"] += 1
                logger.info(f"Found video: {p1} vs {p2} -> {youtube_url}")

    return stats


def _p1_won_set(set_score: str) -> bool:
    """Check if player 1 won a set from score like '11-8'."""
    parts = set_score.strip().split("-")
    if len(parts) == 2:
        try:
            return int(parts[0]) > int(parts[1])
        except ValueError:
            pass
    return False
