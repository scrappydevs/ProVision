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


def upload_to_storage_with_retry(
    storage_path: str,
    content: bytes,
    bucket: str = "provision-videos",
    max_retries: int = 3,
) -> str:
    """
    Upload file to Supabase storage with automatic retry for SSL/network errors.
    
    SSL/TLS errors (SSLV3_ALERT_BAD_RECORD_MAC) are common when uploading large files
    due to connection drops or timeouts. This function retries with exponential backoff.
    
    Args:
        storage_path: Path in storage bucket (e.g., "user_id/session_id/file.mp4")
        content: File content as bytes
        bucket: Storage bucket name (default: "provision-videos")
        max_retries: Maximum retry attempts (default: 3)
        
    Returns:
        Public URL of uploaded file
        
    Raises:
        Exception if upload fails after all retries
    """
    import time
    supabase = get_supabase()
    
    size_mb = len(content) / 1024 / 1024
    print(f"[VideoUtils] Uploading to {storage_path} ({size_mb:.1f} MB)")
    
    for attempt in range(max_retries):
        try:
            supabase.storage.from_(bucket).upload(storage_path, content)
            url = supabase.storage.from_(bucket).get_public_url(storage_path)
            print(f"[VideoUtils] Upload succeeded (attempt {attempt + 1}/{max_retries}): {url}")
            return url
        except Exception as e:
            err_str = str(e).lower()
            is_retryable = any(x in err_str for x in [
                "ssl", "timeout", "connection", "network", "read error", 
                "bad record mac", "broken pipe", "reset by peer", "unbound"
            ])
            
            if attempt < max_retries - 1 and is_retryable:
                wait_time = (2 ** attempt) * 0.5  # 0.5s, 1s, 2s
                print(f"[VideoUtils] Upload failed (attempt {attempt + 1}/{max_retries}), retrying in {wait_time}s: {e}")
                time.sleep(wait_time)
            else:
                print(f"[VideoUtils] Upload failed permanently after {max_retries} attempts: {e}")
                raise e
