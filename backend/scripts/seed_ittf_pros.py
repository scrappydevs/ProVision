import asyncio
import os
import sys
from datetime import datetime
from typing import Optional

import httpx
from supabase import create_client, Client
import importlib.util

SCRIPT_DIR = os.path.dirname(__file__)
SRC_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, "..", "src"))

ITTF_PATH = os.path.join(SRC_DIR, "api", "services", "ittf_service.py")
spec = importlib.util.spec_from_file_location("ittf_service", ITTF_PATH)
ittf_service = importlib.util.module_from_spec(spec) if spec else None
if not spec or not ittf_service:
    raise RuntimeError("Unable to load ittf_service module")
spec.loader.exec_module(ittf_service)

fetch_ittf_player_data = ittf_service.fetch_ittf_player_data


PRO_ITTF_IDS = [
    121404,  # Fan Zhendong
    113883,  # Ma Long
    126498,  # Wang Chuqin
    119588,  # Liang Jingkun
    131163,  # Sun Yingsha
    137237,  # Lin Shidong
    109164,  # Tomokazu Harimoto
    105780,  # Hugo Calderano
    104797,  # Truls Moregardh
    110709,  # Felix Lebrun
    106082,  # Lin Yun-Ju
    104999,  # Dimitrij Ovtcharov
    109942,  # Patrick Franziska
    105355,  # Jang Woojin
    110688,  # An Jae-hyun
]


def _handedness_from_style(style: Optional[str]) -> str:
    if not style:
        return "right"
    lowered = style.lower()
    if "left" in lowered:
        return "left"
    return "right"


def _build_description(data: dict) -> str:
    name = data.get("player_name") or "This player"
    style = data.get("playing_style")
    ranking = data.get("ranking")
    nationality = data.get("nationality")
    handedness = _handedness_from_style(style)

    style_label = style or ("Aggressive attacker" if handedness == "right" else "Left-handed attacker")
    ranking_text = f"Currently ranked #{ranking} in the world." if ranking else "Competes consistently on the world stage."
    nationality_text = f"Representing {nationality}," if nationality else "On the international circuit,"

    paragraph_one = (
        f"{name} is a {handedness}-handed player known for a {style_label.lower()}. "
        f"{nationality_text} they thrive on quick tempo exchanges and first-ball initiative. "
        f"{ranking_text}"
    )

    paragraph_two = (
        "In longer rallies, opponents look to vary spin and pace to disrupt rhythm, "
        "while they aim to dictate with early placement and proactive countering. "
        "Matchups are strongest when they can control the table with fast transitions."
    )

    return f"{paragraph_one}\n\n{paragraph_two}"


async def _download_image(urls: list[str]) -> Optional[bytes]:
    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
        for url in urls:
            try:
                resp = await client.get(url)
                resp.raise_for_status()
                if resp.content:
                    return resp.content
            except Exception:
                continue
    return None


def _candidate_headshot_urls(base_url: Optional[str]) -> list[str]:
    if not base_url:
        return []
    urls = [base_url]
    if "/400px/" in base_url:
        urls.insert(0, base_url.replace("/400px/", "/1200px/"))
        urls.insert(1, base_url.replace("/400px/", "/800px/"))
    return urls


async def seed_ittf_pros() -> None:
    coach_id = os.getenv("PROVISION_COACH_ID") or os.getenv("COACH_ID")
    if not coach_id:
        raise ValueError("Set PROVISION_COACH_ID or COACH_ID to seed pro players.")

    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not supabase_key:
        raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")
    supabase: Client = create_client(supabase_url, supabase_key)

    for ittf_id in PRO_ITTF_IDS:
        existing = supabase.table("players").select("id").eq("ittf_id", ittf_id).execute()
        if existing.data:
            print(f"Skipping {ittf_id}: already exists.")
            continue

        data = await fetch_ittf_player_data(ittf_id)
        if not data:
            print(f"Skipping {ittf_id}: no ITTF data.")
            continue

        headshot_urls = _candidate_headshot_urls(data.get("headshot_url"))
        headshot_bytes = await _download_image(headshot_urls) if headshot_urls else None

        player_id = data.get("ittf_id")
        if not player_id:
            print(f"Skipping {ittf_id}: missing player id.")
            continue

        player_uuid = None
        if headshot_bytes:
            avatar_path = f"{coach_id}/avatars/ittf_{ittf_id}.jpg"
            try:
                supabase.storage.from_("provision-videos").remove([avatar_path])
            except Exception:
                pass
            supabase.storage.from_("provision-videos").upload(avatar_path, headshot_bytes)
            avatar_url = supabase.storage.from_("provision-videos").get_public_url(avatar_path)
        else:
            avatar_url = None

        description = _build_description(data)
        handedness = _handedness_from_style(data.get("playing_style"))
        now = datetime.utcnow().isoformat()

        insert_data = {
            "coach_id": coach_id,
            "name": data.get("player_name") or f"ITTF Player {ittf_id}",
            "handedness": handedness,
            "ittf_id": ittf_id,
            "ittf_data": data,
            "ittf_last_synced": now,
            "avatar_url": avatar_url,
            "description": description,
            "is_active": True,
            "created_at": now,
            "updated_at": now,
        }

        result = supabase.table("players").insert(insert_data).execute()
        player_uuid = result.data[0]["id"] if result.data else None
        print(f"Inserted {insert_data['name']} (ittf_id={ittf_id}, id={player_uuid})")


if __name__ == "__main__":
    asyncio.run(seed_ittf_pros())
