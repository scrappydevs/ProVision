import os
import re
import logging
import tempfile
from typing import Optional

logger = logging.getLogger(__name__)


def extract_youtube_id(url: str) -> Optional[str]:
    patterns = [
        r"(?:youtube\.com/watch\?v=|youtu\.be/|youtube\.com/embed/|youtube\.com/v/)([a-zA-Z0-9_-]{11})",
        r"youtube\.com/shorts/([a-zA-Z0-9_-]{11})",
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return None


def get_youtube_metadata(url: str) -> Optional[dict]:
    try:
        import yt_dlp

        ydl_opts = {
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
        }

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            if not info:
                return None

            duration_secs = info.get("duration", 0)
            hours = duration_secs // 3600
            minutes = (duration_secs % 3600) // 60
            seconds = duration_secs % 60
            if hours > 0:
                duration_str = f"{hours}:{minutes:02d}:{seconds:02d}"
            else:
                duration_str = f"{minutes}:{seconds:02d}"

            return {
                "title": info.get("title"),
                "thumbnail_url": info.get("thumbnail"),
                "duration": duration_str,
                "duration_seconds": duration_secs,
                "channel": info.get("uploader") or info.get("channel"),
                "view_count": info.get("view_count"),
                "upload_date": info.get("upload_date"),
                "description": (info.get("description") or "")[:500],
                "youtube_video_id": info.get("id"),
            }
    except Exception as e:
        logger.error(f"Failed to get YouTube metadata for {url}: {e}")
        return None


def download_youtube_video(
    url: str,
    max_duration: int = 600,
    start_time: Optional[float] = None,
    end_time: Optional[float] = None,
) -> Optional[str]:
    try:
        import yt_dlp

        metadata = get_youtube_metadata(url)
        if metadata and metadata.get("duration_seconds", 0) > max_duration:
            logger.warning(f"Video too long: {metadata['duration_seconds']}s > {max_duration}s limit")
            return None

        temp_dir = tempfile.mkdtemp(prefix="provision_yt_")
        output_path = os.path.join(temp_dir, "video.mp4")

        ydl_opts = {
            "format": "best[ext=mp4][height<=720]/best[ext=mp4]/best",
            "outtmpl": output_path,
            "quiet": True,
            "no_warnings": True,
            "max_filesize": 500 * 1024 * 1024,
        }

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])

        downloaded = _find_downloaded_file(temp_dir, output_path)
        if not downloaded:
            logger.error("Download completed but no video file found")
            return None

        # Clip to the requested time range using ffmpeg
        if start_time is not None and end_time is not None:
            clipped = _clip_with_ffmpeg(downloaded, temp_dir, start_time, end_time)
            if clipped:
                return clipped
            logger.warning("ffmpeg clip failed, returning full video")

        return downloaded
    except Exception as e:
        logger.error(f"Failed to download YouTube video {url}: {e}")
        return None


def _find_downloaded_file(temp_dir: str, expected_path: str) -> Optional[str]:
    if os.path.exists(expected_path):
        return expected_path
    for f in os.listdir(temp_dir):
        if f.endswith((".mp4", ".webm", ".mkv")):
            return os.path.join(temp_dir, f)
    return None


def _clip_with_ffmpeg(
    input_path: str, temp_dir: str, start: float, end: float
) -> Optional[str]:
    """Clip a video to [start, end] seconds using ffmpeg (fast seek)."""
    import subprocess

    clipped_path = os.path.join(temp_dir, "clipped.mp4")
    duration = end - start
    cmd = [
        "ffmpeg", "-y",
        "-ss", str(start),
        "-i", input_path,
        "-t", str(duration),
        "-c", "copy",
        "-avoid_negative_ts", "make_zero",
        clipped_path,
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True, timeout=120)
        if os.path.exists(clipped_path) and os.path.getsize(clipped_path) > 0:
            os.unlink(input_path)
            return clipped_path
    except Exception as e:
        logger.warning(f"ffmpeg clip failed, returning full video: {e}")
    return None
