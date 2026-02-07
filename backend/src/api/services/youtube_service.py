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
    video_id = extract_youtube_id(url)
    if not video_id:
        return None

    # Try yt-dlp first (full metadata)
    try:
        import yt_dlp

        ydl_opts = {
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
        }

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            if info:
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
        logger.warning(f"yt-dlp metadata extraction failed for {url}: {e}")

    # Fallback: use YouTube oEmbed API (not blocked by bot detection)
    logger.info(f"Falling back to oEmbed for metadata: {video_id}")
    try:
        import requests
        oembed_url = f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={video_id}&format=json"
        resp = requests.get(oembed_url, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            return {
                "title": data.get("title", f"YouTube Video {video_id}"),
                "thumbnail_url": f"https://img.youtube.com/vi/{video_id}/maxresdefault.jpg",
                "duration": "0:00",
                "duration_seconds": 0,
                "channel": data.get("author_name", "Unknown"),
                "view_count": 0,
                "upload_date": "",
                "description": "",
                "youtube_video_id": video_id,
            }
    except Exception as oembed_err:
        logger.warning(f"oEmbed fallback also failed: {oembed_err}")

    # Last resort: return minimal metadata from URL
    logger.info(f"Using minimal metadata for video {video_id}")
    return {
        "title": f"YouTube Video {video_id}",
        "thumbnail_url": f"https://img.youtube.com/vi/{video_id}/maxresdefault.jpg",
        "duration": "0:00",
        "duration_seconds": 0,
        "channel": "Unknown",
        "view_count": 0,
        "upload_date": "",
        "description": "",
        "youtube_video_id": video_id,
    }


def get_youtube_streaming_url(url: str) -> Optional[dict]:
    """Extract direct streaming URL and metadata without downloading.
    
    Returns dict with 'url', 'title', 'duration', 'http_headers' for direct playback.
    Note: URLs expire after ~6 hours and require headers for playback.
    """
    try:
        import yt_dlp

        ydl_opts = {
            "format": "best[ext=mp4][height<=720]/best[ext=mp4]/best",
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
            "extract_flat": False,
        }

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            if not info:
                return None

            return {
                "url": info.get("url"),  # Direct streaming URL
                "title": info.get("title"),
                "duration": info.get("duration"),
                "thumbnail": info.get("thumbnail"),
                "http_headers": info.get("http_headers", {}),
                "formats": info.get("formats", []),
            }
    except Exception as e:
        logger.error(f"Failed to get streaming URL for {url}: {e}")
        return None


def download_youtube_video(
    url: str,
    max_duration: int = 600,
    start_time: Optional[float] = None,
    end_time: Optional[float] = None,
) -> Optional[str]:
    """Download YouTube video with optimization for clipping.
    
    OPTIMIZATIONS:
    - If clipping: Uses FFmpeg smart seeking to download only relevant portion
    - If full video: Downloads normally via yt-dlp
    """
    try:
        import yt_dlp

        metadata = get_youtube_metadata(url)
        if metadata and metadata.get("duration_seconds", 0) > max_duration:
            logger.warning(f"Video too long: {metadata['duration_seconds']}s > {max_duration}s limit")
            return None

        temp_dir = tempfile.mkdtemp(prefix="provision_yt_")
        
        # OPTIMIZATION: If clipping, use FFmpeg smart seeking to download only clip portion
        if start_time is not None and end_time is not None:
            logger.info(f"Using optimized clip extraction for {start_time}s-{end_time}s")
            clipped = _download_clip_optimized(url, temp_dir, start_time, end_time)
            if clipped:
                return clipped
            logger.warning("Optimized clip extraction failed, falling back to full download")

        # Fallback: Download full video
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


def _download_clip_optimized(
    url: str, temp_dir: str, start: float, end: float
) -> Optional[str]:
    """Download ONLY the clip portion using FFmpeg smart seeking.
    
    OPTIMIZATION: Uses -ss BEFORE -i to seek before downloading.
    This downloads only ~10-20% more than the clip duration instead of full video.
    Performance: 10-30s download → 2-5s download
    """
    import subprocess

    try:
        # Get streaming URL with headers
        stream_info = get_youtube_streaming_url(url)
        if not stream_info or not stream_info.get("url"):
            logger.warning("Failed to get streaming URL for optimized download")
            return None

        stream_url = stream_info["url"]
        headers = stream_info.get("http_headers", {})
        
        output_path = os.path.join(temp_dir, "clip.mp4")
        duration = end - start
        
        # Build headers string for ffmpeg
        headers_list = [f"{k}: {v}" for k, v in headers.items()]
        headers_str = "\r\n".join(headers_list)
        
        # CRITICAL OPTIMIZATION: -ss BEFORE -i enables smart seeking
        # FFmpeg will seek to nearest keyframe and download only from there
        cmd = [
            "ffmpeg", "-y",
            "-headers", headers_str,     # Required HTTP headers
            "-ss", str(start),           # SEEK BEFORE INPUT (fast)
            "-i", stream_url,            # Direct streaming URL
            "-t", str(duration),         # Duration to extract
            "-c", "copy",                # Stream copy (no re-encoding, ~1000x faster)
            "-avoid_negative_ts", "make_zero",
            output_path,
        ]
        
        logger.info(f"FFmpeg optimized clip: {start}s-{end}s ({duration}s)")
        result = subprocess.run(cmd, check=True, capture_output=True, timeout=120)
        
        if os.path.exists(output_path) and os.path.getsize(output_path) > 0:
            logger.info(f"Optimized clip success: {os.path.getsize(output_path) / 1024 / 1024:.2f} MB")
            return output_path
        
    except subprocess.TimeoutExpired:
        logger.error(f"FFmpeg timeout after 120s")
    except subprocess.CalledProcessError as e:
        logger.error(f"FFmpeg failed: {e.stderr.decode() if e.stderr else str(e)}")
    except Exception as e:
        logger.error(f"Optimized clip extraction failed: {e}")
    
    return None


def _clip_with_ffmpeg(
    input_path: str, temp_dir: str, start: float, end: float
) -> Optional[str]:
    """Clip a video to [start, end] seconds using ffmpeg (fast seek).
    
    NOTE: This is the fallback method for already-downloaded videos.
    Prefer _download_clip_optimized() for downloading clips.
    """
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
        logger.warning(f"ffmpeg clip failed: {e}")
    return None
