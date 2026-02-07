import re
import logging
from typing import Optional
import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

ITTF_CALENDAR_URL = "https://www.ittf.com/calendar/"
WTT_EVENTS_URL = "https://worldtabletennis.com/eventList"

# Known WTT 2026 events (fallback when scraping fails)
KNOWN_WTT_EVENTS_2026 = [
    {"name": "WTT Star Contender Chennai", "location": "Chennai, India", "date_text": "Feb 10–15, 2026", "level": "international"},
    {"name": "WTT Grand Smash Singapore", "location": "Singapore", "date_text": "Feb 19 – Mar 1, 2026", "level": "world"},
    {"name": "WTT Champions Chongqing", "location": "Chongqing, China", "date_text": "Mar 10–15, 2026", "level": "world"},
    {"name": "WTT Contender Doha", "location": "Doha, Qatar", "date_text": "Mar 24–29, 2026", "level": "international"},
    {"name": "WTT Star Contender Beirut", "location": "Beirut, Lebanon", "date_text": "Apr 7–12, 2026", "level": "international"},
    {"name": "WTT Champions Macao", "location": "Macao, China", "date_text": "Apr 21–26, 2026", "level": "world"},
    {"name": "WTT Contender Zagreb", "location": "Zagreb, Croatia", "date_text": "May 5–10, 2026", "level": "international"},
    {"name": "WTT Star Contender Bangkok", "location": "Bangkok, Thailand", "date_text": "May 19–24, 2026", "level": "international"},
    {"name": "WTT Grand Smash Riyadh", "location": "Riyadh, Saudi Arabia", "date_text": "Jun 2–14, 2026", "level": "world"},
    {"name": "WTT Contender Tunis", "location": "Tunis, Tunisia", "date_text": "Jun 23–28, 2026", "level": "international"},
    {"name": "WTT Champions Frankfurt", "location": "Frankfurt, Germany", "date_text": "Jul 7–12, 2026", "level": "world"},
    {"name": "WTT Star Contender Ljubljana", "location": "Ljubljana, Slovenia", "date_text": "Aug 4–9, 2026", "level": "international"},
    {"name": "WTT Champions Incheon", "location": "Incheon, Korea", "date_text": "Sep 1–6, 2026", "level": "world"},
    {"name": "WTT Grand Smash Beijing", "location": "Beijing, China", "date_text": "Oct 5–18, 2026", "level": "world"},
    {"name": "WTT Finals Fukuoka", "location": "Fukuoka, Japan", "date_text": "Nov 19–22, 2026", "level": "world"},
]


async def scrape_ittf_tournaments(year: Optional[int] = None) -> list[dict]:
    """Fetch WTT/ITTF tournament data. Tries scraping first, falls back to known events."""
    tournaments: list[dict] = []

    # Try scraping the ITTF calendar
    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            resp = await client.get(ITTF_CALENDAR_URL)
            resp.raise_for_status()

            soup = BeautifulSoup(resp.text, "html.parser")
            text = soup.get_text(separator="\n", strip=True)
            lines = text.split("\n")

            for i, line in enumerate(lines):
                if re.search(r"(Grand Smash|Contender|Champions|Star Contender|WTT)", line, re.IGNORECASE):
                    tournament: dict = {"name": line.strip()}
                    for j in range(i + 1, min(i + 5, len(lines))):
                        if re.search(r"\d{1,2}\s+\w+\s+\d{4}", lines[j]):
                            tournament["date_text"] = lines[j].strip()
                        elif re.search(r"[A-Z][a-z]+,?\s+[A-Z]", lines[j]) and "location" not in tournament:
                            tournament["location"] = lines[j].strip()
                    if tournament.get("name") and len(tournament) > 1:
                        level = "international"
                        name_lower = tournament["name"].lower()
                        if "grand smash" in name_lower or "champions" in name_lower or "finals" in name_lower:
                            level = "world"
                        tournament["level"] = level
                        tournaments.append(tournament)
    except Exception as e:
        logger.warning(f"ITTF calendar scrape failed, using fallback: {e}")

    # If scraping produced nothing, use known events
    if not tournaments:
        logger.info("Using known WTT 2026 events as fallback")
        tournaments = list(KNOWN_WTT_EVENTS_2026)

    return tournaments[:20]
