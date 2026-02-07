import asyncio
import os
import sys
from datetime import datetime, timezone
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
ITTF_HEADSHOT_BASE = getattr(ittf_service, "ITTF_HEADSHOT_BASE", "https://wttsimfiles.blob.core.windows.net/wtt-media/photos/400px")


def _candidate_headshot_urls(ittf_id: int, base_url: Optional[str]) -> list[str]:
    urls: list[str] = []
    if base_url:
        urls.append(base_url)
        if "/400px/" in base_url:
            urls.insert(0, base_url.replace("/400px/", "/1200px/"))
            urls.insert(1, base_url.replace("/400px/", "/800px/"))
    if ittf_id:
        urls.append(f"{ITTF_HEADSHOT_BASE}/{ittf_id}.jpg")
        urls.append(f"{ITTF_HEADSHOT_BASE.replace('/400px/', '/800px/')}/{ittf_id}.jpg")
        urls.append(f"{ITTF_HEADSHOT_BASE.replace('/400px/', '/1200px/')}/{ittf_id}.jpg")
    # De-dupe while preserving order
    seen = set()
    deduped = []
    for url in urls:
        if url in seen:
            continue
        seen.add(url)
        deduped.append(url)
    return deduped


async def _download_image(urls: list[str]) -> Optional[bytes]:
    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
        for url in urls:
            try:
                resp = await client.get(url)
                if resp.status_code == 404:
                    continue
                resp.raise_for_status()
                if resp.content:
                    return resp.content
            except Exception:
                continue
    return None


async def backfill_headshots() -> None:
    coach_id = os.getenv("PROVISION_COACH_ID") or os.getenv("COACH_ID")
    if not coach_id:
        raise ValueError("Set PROVISION_COACH_ID or COACH_ID to backfill headshots.")

    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not supabase_key:
        raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")
    supabase: Client = create_client(supabase_url, supabase_key)

    missing = (
        supabase.table("players")
        .select("id,name,ittf_id,ittf_data,avatar_url")
        .eq("coach_id", coach_id)
        .is_("avatar_url", "null")
        .not_.is_("ittf_id", "null")
        .execute()
    )

    if not missing.data:
        print("No players missing headshots.")
        return

    for player in missing.data:
        ittf_id = player.get("ittf_id")
        data = await fetch_ittf_player_data(ittf_id) if ittf_id else None
        base_url = data.get("headshot_url") if data else None
        urls = _candidate_headshot_urls(ittf_id, base_url)
        image_bytes = await _download_image(urls)
        if not image_bytes:
            print(f"No headshot found for {player.get('name')} ({ittf_id})")
            continue

        avatar_path = f"{coach_id}/avatars/ittf_{ittf_id}.jpg"
        try:
            supabase.storage.from_("provision-videos").remove([avatar_path])
        except Exception:
            pass
        supabase.storage.from_("provision-videos").upload(avatar_path, image_bytes)
        avatar_url = supabase.storage.from_("provision-videos").get_public_url(avatar_path)

        update = {
            "avatar_url": avatar_url,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        if data:
            update["ittf_data"] = data
            update["ittf_last_synced"] = update["updated_at"]
        supabase.table("players").update(update).eq("id", player["id"]).execute()
        print(f"Updated headshot for {player.get('name')} ({ittf_id})")


if __name__ == "__main__":
    asyncio.run(backfill_headshots())
