"""
Configuration for ping pong player scraping.

Placeholder values only; no real scraping is performed.
"""

from dataclasses import dataclass
from typing import Optional


@dataclass
class ScraperConfig:
    """Config for player data sources (not used for live scraping)."""

    base_url: str = "https://example.com/table-tennis"
    rate_limit_delay_seconds: float = 1.0
    request_timeout_seconds: float = 15.0
    user_agent: Optional[str] = None
    max_pages_per_run: Optional[int] = None

    def __post_init__(self) -> None:
        if self.user_agent is None:
            self.user_agent = "ProVision-Scraper/1.0 (scraping logic only)"
