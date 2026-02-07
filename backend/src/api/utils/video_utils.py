"""
Utility functions for video handling.
"""

import os
import tempfile
import requests
from typing import Optional
from ..database.supabase import get_supabase


def download_video_from_storage(video_path: str, local_filename: Optional[str] = None) -> str:
    """
    Download a video from Supabase storage to local filesystem.

    Args:
        video_path: Path in Supabase storage (e.g., "user_id/session_id/original.mov")
        local_filename: Optional local filename. If None, creates temp file.

    Returns:
        Path to downloaded video file
    """
    supabase = get_supabase()

    print(f"[VideoUtils] Downloading video from storage: {video_path}")

    # Get the public URL or signed URL
    try:
        # Try to get public URL first
        video_url = supabase.storage.from_("provision-videos").get_public_url(video_path)
        print(f"[VideoUtils] Using public URL: {video_url}")
    except Exception as e:
        print(f"[VideoUtils] Failed to get public URL: {e}")
        # Fall back to creating a signed URL (for private buckets)
        video_url = supabase.storage.from_("provision-videos").create_signed_url(video_path, 3600)
        if isinstance(video_url, dict) and 'signedURL' in video_url:
            video_url = video_url['signedURL']

    # Download the video
    response = requests.get(video_url, stream=True)
    response.raise_for_status()

    # Determine local file path
    if local_filename is None:
        # Create temporary file
        ext = os.path.splitext(video_path)[1] or '.mp4'
        fd, local_filename = tempfile.mkstemp(suffix=ext)
        os.close(fd)

    # Write video to file
    with open(local_filename, 'wb') as f:
        for chunk in response.iter_content(chunk_size=8192):
            f.write(chunk)

    print(f"[VideoUtils] Downloaded video to: {local_filename}")
    return local_filename


def extract_video_path_from_url(video_url: str) -> str:
    """
    Extract the storage path from a Supabase video URL.

    Args:
        video_url: Full URL to video (e.g., "https://...supabase.co/storage/v1/object/public/provision-videos/user_id/...")

    Returns:
        Storage path (e.g., "user_id/session_id/original.mov")
    """
    # Parse the URL to extract the path after the bucket name
    parts = video_url.split('/provision-videos/')
    if len(parts) > 1:
        return parts[1].split('?')[0]  # Remove query params if present

    raise ValueError(f"Could not extract storage path from URL: {video_url}")


def cleanup_temp_file(file_path: str):
    """
    Remove temporary file.

    Args:
        file_path: Path to file to remove
    """
    try:
        if os.path.exists(file_path):
            os.remove(file_path)
            print(f"[VideoUtils] Cleaned up temp file: {file_path}")
    except Exception as e:
        print(f"[VideoUtils] Warning: Failed to cleanup file {file_path}: {e}")
