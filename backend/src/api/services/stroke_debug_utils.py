"""
Debug logging utilities for stroke detection pipeline.
"""

from time import perf_counter
from typing import Optional, Any, Dict
from contextlib import contextmanager


def debug_header(message: str, char: str = "=") -> None:
    """Print a debug header with formatting."""
    print(f"\n{char*80}")
    print(f"[STROKE DEBUG] {message}")
    print(f"{char*80}\n")


def debug_info(message: str, **kwargs) -> None:
    """Print a debug info message with optional key-value pairs."""
    print(f"[STROKE DEBUG] {message}")
    for key, value in kwargs.items():
        print(f"[STROKE DEBUG]    {key}: {value}")


def debug_section_start(title: str) -> None:
    """Print a section start marker."""
    print(f"\n{'='*80}")
    print(f"[STROKE DEBUG] {title}")
    print(f"{'='*80}\n")


def debug_section_end(title: str, elapsed_ms: Optional[float] = None, **kwargs) -> None:
    """Print a section end marker with timing."""
    print(f"\n{'='*80}")
    if elapsed_ms is not None:
        print(f"[STROKE DEBUG] ✅ {title} in {elapsed_ms:.1f}ms")
    else:
        print(f"[STROKE DEBUG] ✅ {title}")
    for key, value in kwargs.items():
        print(f"[STROKE DEBUG]    {key}: {value}")
    print(f"{'='*80}\n")


@contextmanager
def debug_timer(operation: str):
    """Context manager for timing operations with debug output."""
    debug_section_start(f"🚀 {operation}")
    start = perf_counter()
    try:
        yield
    finally:
        elapsed = (perf_counter() - start) * 1000
        debug_section_end(f"✅ {operation} COMPLETE", elapsed_ms=elapsed)


def debug_pipeline_start(session_id: str, **kwargs) -> None:
    """Print pipeline start banner."""
    print(f"\n{'#'*80}")
    print(f"{'#'*80}")
    print(f"[STROKE DEBUG] 🚀 STARTING HYBRID STROKE DETECTION PIPELINE")
    print(f"[STROKE DEBUG]    Session: {session_id}")
    for key, value in kwargs.items():
        print(f"[STROKE DEBUG]    {key}: {value}")
    print(f"{'#'*80}")
    print(f"{'#'*80}\n")


def debug_pipeline_end(strokes_count: int, elapsed_ms: float, **kwargs) -> None:
    """Print pipeline end banner."""
    print(f"\n{'#'*80}")
    print(f"{'#'*80}")
    print(f"[STROKE DEBUG] ✅ HYBRID STROKE DETECTION PIPELINE COMPLETE")
    print(f"[STROKE DEBUG]    Final strokes: {strokes_count}")
    print(f"[STROKE DEBUG]    Total time: {elapsed_ms:.1f}ms ({elapsed_ms/1000:.1f}s)")
    for key, value in kwargs.items():
        print(f"[STROKE DEBUG]    {key}: {value}")
    print(f"{'#'*80}")
    print(f"{'#'*80}\n")
