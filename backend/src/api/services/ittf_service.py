import re
import logging
from typing import Optional
import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

ITTF_PROFILE_URL = "https://results.ittf.link/index.php"
ITTF_HEADSHOT_BASE = "https://wttsimfiles.blob.core.windows.net/wtt-media/photos/400px"


async def fetch_ittf_player_data(ittf_id: int) -> Optional[dict]:
    params = {
        "option": "com_fabrik",
        "view": "list",
        "listid": "60",
        "Itemid": "391",
        "resetfilters": "1",
        "vw_profiles___player_id_raw[value][]": str(ittf_id),
    }

    try:
        async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
            resp = await client.get(ITTF_PROFILE_URL, params=params)
            resp.raise_for_status()
    except Exception as e:
        logger.error(f"ITTF fetch failed for player {ittf_id}: {e}")
        return None

    soup = BeautifulSoup(resp.text, "html.parser")

    data: dict = {"ittf_id": ittf_id}

    # Extract headshot image
    img_tag = soup.select_one("img[src*='wttsimfiles.blob.core.windows.net']")
    if img_tag and img_tag.get("src"):
        data["headshot_url"] = img_tag["src"]

    # The profile info is in the table rows
    profile_text = soup.get_text(separator="\n", strip=True)

    # Extract player name from header like "FAN Zhendong (#121404)"
    name_match = re.search(r"([A-Z]+\s+[\w\s-]+)\s*\(#\d+\)", profile_text)
    if name_match:
        data["player_name"] = name_match.group(1).strip()

    # Nationality - look for country code after flag image
    nationality_match = re.search(r"\b(CHN|JPN|KOR|GER|SWE|FRA|BRA|TPE|HKG|ENG|IND|USA|AUT|ROU|ESP|CRO|SGP|NGA|POL|CZE|HUN|SVK|THA|MAS|POR)\b", profile_text)
    if nationality_match:
        data["nationality"] = nationality_match.group(1)

    # Birth Year
    birth_match = re.search(r"Birth\s*Year[:\s]*(\d{4})", profile_text)
    if birth_match:
        data["birth_year"] = int(birth_match.group(1))

    # Playing style
    style_match = re.search(r"Style[:\s]*([\w\-]+\s*(?:Hand)?\s*(?:Attack|Defense|All[- ]?Round)?\s*\([^)]+\))", profile_text)
    if style_match:
        data["playing_style"] = style_match.group(1).strip()
    else:
        style_match2 = re.search(r"((?:Right|Left)-Hand\s*(?:Attack|Defense|All[- ]?Round)\s*\([^)]+\))", profile_text)
        if style_match2:
            data["playing_style"] = style_match2.group(1).strip()

    # Ranking
    ranking_match = re.search(r"Ranking[:\s]*(\d+)", profile_text)
    if ranking_match:
        data["ranking"] = int(ranking_match.group(1))

    # Career Best
    best_match = re.search(r"Career\s*Best[*:\s]*(\d+)", profile_text)
    if best_match:
        data["career_best_ranking"] = int(best_match.group(1))

    # Wins / Losses
    wins_match = re.search(r"Wins[:\s]*(\d+)", profile_text)
    if wins_match:
        data["career_wins"] = int(wins_match.group(1))

    losses_match = re.search(r"Loses[:\s]*(\d+)", profile_text)
    if losses_match:
        data["career_losses"] = int(losses_match.group(1))

    # Senior Titles
    titles_match = re.search(r"All\s*Senior\s*Titles[:\s]*(\d+)", profile_text)
    if titles_match:
        data["senior_titles"] = int(titles_match.group(1))

    # Recent matches - parse from the "Recent Singles Matches" section
    recent_matches = []
    match_blocks = soup.find_all(string=re.compile(r"Result:\s*(WON|LOST)"))
    for block in match_blocks[:10]:
        parent = block.find_parent()
        if not parent:
            continue
        # Walk up to find the container with tournament and score info
        container = parent
        for _ in range(5):
            if container.parent:
                container = container.parent
            else:
                break
        container_text = container.get_text(separator=" ", strip=True)

        result_m = re.search(r"Result:\s*(WON|LOST)", container_text)
        score_m = re.search(r"\d+\s*-\s*\d+\s*\([\d:\s]+\)", container_text)
        vs_m = re.search(r"(\w[\w\s]+)\s*\((\w{3})\)\s*vs\s*(\w[\w\s]+)\s*\((\w{3})\)", container_text, re.IGNORECASE)

        match_entry = {}
        if result_m:
            match_entry["result"] = result_m.group(1)
        if score_m:
            match_entry["score"] = score_m.group(0).strip()
        if vs_m:
            match_entry["opponent"] = f"{vs_m.group(1).strip()} ({vs_m.group(2)})"

        # Try to extract tournament name (usually at the start)
        tournament_m = re.match(r"^([\w\s']+\d{4})", container_text)
        if tournament_m:
            match_entry["tournament"] = tournament_m.group(1).strip()

        if match_entry.get("result"):
            recent_matches.append(match_entry)

    if recent_matches:
        data["recent_matches"] = recent_matches

    # Only return if we got meaningful data
    if len(data) <= 1:
        logger.warning(f"No meaningful data extracted for ITTF player {ittf_id}")
        return None

    return data


async def search_ittf_players(query: str) -> list[dict]:
    """Search ITTF results site for players matching a name query."""
    params = {
        "option": "com_fabrik",
        "view": "list",
        "listid": "60",
        "Itemid": "391",
        "resetfilters": "1",
        "vw_profiles___player_name": query,
    }

    try:
        async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
            resp = await client.get(ITTF_PROFILE_URL, params=params)
            resp.raise_for_status()
    except Exception as e:
        logger.error(f"ITTF search failed for '{query}': {e}")
        return []

    soup = BeautifulSoup(resp.text, "html.parser")
    results: list[dict] = []

    rows = soup.select("table.fabrikList tbody tr")
    for row in rows[:20]:
        cells = row.find_all("td")
        if len(cells) < 3:
            continue

        name_tag = cells[0].find("a") or cells[0]
        name = name_tag.get_text(strip=True)
        if not name:
            continue

        ittf_id_match = re.search(r"player_id[^=]*=(\d+)", str(cells[0]))
        nationality = cells[1].get_text(strip=True) if len(cells) > 1 else None
        ranking_text = cells[2].get_text(strip=True) if len(cells) > 2 else None

        entry: dict = {"name": name}
        if ittf_id_match:
            entry["ittf_id"] = int(ittf_id_match.group(1))
        if nationality:
            entry["nationality"] = nationality
        if ranking_text and ranking_text.isdigit():
            entry["ranking"] = int(ranking_text)

        results.append(entry)

    return results
