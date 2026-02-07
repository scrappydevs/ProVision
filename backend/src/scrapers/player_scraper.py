"""
Ping pong player scraper — logic only, no actual scraping.

This module defines the interface and structure for fetching table tennis
player data (e.g. rankings, profiles). It does not perform any HTTP requests
or external I/O; callers would need to enable a "run" mode explicitly.
"""

import logging
from dataclasses import dataclass
from typing import Any

from src.scrapers.config import ScraperConfig

logger = logging.getLogger(__name__)


@dataclass
class ScrapedPlayer:
    """Represents a scraped ping pong player (structure only)."""

    external_id: str
    name: str
    country_code: str | None
    ranking: int | None
    raw_data: dict[str, Any] | None = None


class PingPongPlayerScraper:
    """
    Scraper for ping pong player data.

    All fetch methods are no-op by design: they return empty results and
    do not perform any network requests. Add a dedicated "run" or "live"
    mode elsewhere if scraping should be enabled.
    """

    def __init__(self, config: ScraperConfig | None = None) -> None:
        self.config = config or ScraperConfig()

    def get_players_page(self, page: int = 1, page_size: int = 50) -> list[ScrapedPlayer]:
        """
        Would fetch one page of players (e.g. from a ranking list).
        No-op: returns empty list.
        """
        logger.debug("get_players_page called (no-op): page=%s, page_size=%s", page, page_size)
        return []

    def get_player_by_id(self, external_id: str) -> ScrapedPlayer | None:
        """
        Would fetch a single player by external ID.
        No-op: returns None.
        """
        logger.debug("get_player_by_id called (no-op): external_id=%s", external_id)
        return None

    def scrape_ranking_list(self, max_pages: int | None = None) -> list[ScrapedPlayer]:
        """
        Would iterate ranking pages and collect players.
        No-op: returns empty list.
        """
        limit = max_pages or self.config.max_pages_per_run
        logger.debug("scrape_ranking_list called (no-op): max_pages=%s", limit)
        return []
