"""
Ping pong player scraping module.

Provides structure and config for scraping table tennis player data.
No actual HTTP requests or scraping is performed by default.
"""

from src.scrapers.config import ScraperConfig
from src.scrapers.player_scraper import PingPongPlayerScraper

__all__ = ["ScraperConfig", "PingPongPlayerScraper"]
