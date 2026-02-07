"""
Remote execution wrappers for ML processing engines.
Handles SSH-based execution on GPU server.

Optimized Architecture:
- Videos are stored in Supabase Storage (source of truth)
- GPU server downloads directly from Supabase via signed URLs (no SSH file transfer)
- Results are uploaded back to Supabase Storage
- SSH is only used for command execution and result downloads

This eliminates the slow SSH/SFTP file transfer bottleneck.
"""

import os
import json
import uuid
import base64
import tempfile
from pathlib import Path
from typing import List, Dict, Any, Optional
from contextlib import contextmanager
import logging
import httpx

from src.ssh_client import SSHClient, SSHConnectionPool, RemoteCommandBuilder

logger = logging.getLogger(__name__)


class SupabaseDownloadHelper:
    """
    Helper to download files from Supabase Storage on remote server.
    Instead of SFTP upload, GPU server uses wget/curl with signed URLs.
    """
    
    @staticmethod
    def generate_download_script(signed_url: str, remote_dest_path: str) -> str:
        """
        Generate bash command to download file from Supabase on remote server.
        Uses wget with resume capability for large files.
        """
        return f'''
mkdir -p "$(dirname '{remote_dest_path}')"
wget -q --show-progress -c -O '{remote_dest_path}' '{signed_url}' || curl -L -o '{remote_dest_path}' '{signed_url}'
'''
    
    @staticmethod
    def generate_batch_download_script(downloads: List[Dict[str, str]]) -> str:
        """
        Generate script to download multiple files in parallel using background jobs.
        Uses simpler approach than xargs to avoid quote escaping issues with URLs.
        
        Args:
            downloads: List of dicts with 'url' and 'dest' keys
        """
        lines = []
        
        # Create all directories first
        for dl in downloads:
            lines.append(f"mkdir -p \"$(dirname '{dl['dest']}')\"")
        
        # Download files in parallel using background jobs (simpler than xargs with complex URLs)
        # Limit to 4 concurrent downloads
        for i, dl in enumerate(downloads):
            # Escape single quotes in URL
            escaped_url = dl['url'].replace("'", "'\\''")
            dest = dl['dest']
            
            # Use subshell with background execution
            download_cmd = f"(wget -q -c -O '{dest}' '{escaped_url}' 2>/dev/null || curl -sL -o '{dest}' '{escaped_url}') &"
            lines.append(download_cmd)
            
            # Every 4 downloads, wait for batch to complete
            if (i + 1) % 4 == 0:
                lines.append("wait")
        
        # Wait for any remaining downloads
        lines.append("wait")
        
        return "\n".join(lines)


class RemoteEngineConfig:
    """
    Configuration for remote GPU server.
    All settings are loaded from environment variables.
    """
    
    def __init__(self):
        # SSH Connection - REQUIRED for remote processing
        self.SSH_HOST = os.getenv("SSH_HOST")
        self.SSH_USER = os.getenv("SSH_USER", "root")
        self.SSH_PASSWORD = os.getenv("SSH_PASSWORD")
        self.SSH_KEY_FILE = os.getenv("SSH_KEY_FILE")
        self.SSH_KEY_BASE64 = os.getenv("SSH_KEY_BASE64")
        self.SSH_PORT = int(os.getenv("SSH_PORT", "22"))
        
        # If SSH_KEY_BASE64 is provided, decode it and write to temp file
        if self.SSH_KEY_BASE64 and not self.SSH_KEY_FILE:
            try:
                key_bytes = base64.b64decode(self.SSH_KEY_BASE64)
                # Create temp file with proper permissions
                fd, temp_path = tempfile.mkstemp(suffix='.pem', prefix='ssh_key_')
                os.chmod(temp_path, 0o600)  # SSH requires strict permissions
                with os.fdopen(fd, 'wb') as f:
                    f.write(key_bytes)
                self.SSH_KEY_FILE = temp_path
                logger.info(f"Decoded SSH_KEY_BASE64 to temp file: {temp_path}")
            except Exception as e:
                logger.error(f"Failed to decode SSH_KEY_BASE64: {e}")
        
        # Validate required SSH config
        if not self.SSH_HOST:
            logger.warning("SSH_HOST not set - remote processing will fail")
        if not self.SSH_USER:
            logger.warning("SSH_USER not set - remote processing will fail")
        if not self.SSH_PASSWORD and not self.SSH_KEY_FILE:
            logger.warning("SSH_PASSWORD, SSH_KEY_FILE, or SSH_KEY_BASE64 required for authentication")
        
        # Remote paths - REQUIRED
        self.REMOTE_BASE_DIR = os.getenv("REMOTE_BASE_DIR", "/workspace/provision/data")
        self.REMOTE_VIDEO_DIR = f"{self.REMOTE_BASE_DIR}/videos"
        self.REMOTE_RESULTS_DIR = f"{self.REMOTE_BASE_DIR}/results"
        
        # Model paths (on remote server)
        self.SAM2_MODEL_PATH = os.getenv("SAM2_MODEL_PATH", "/workspace/checkpoints/sam2.1_hiera_large.pt")
        self.SAM2_CONFIG = os.getenv("SAM2_CONFIG", "configs/sam2.1/sam2.1_hiera_l.yaml")
        self.SAM3D_MODEL_PATH = os.getenv("SAM3D_MODEL_PATH", "/workspace/checkpoints/sam3d/")
        
        # Working directories (on remote server)
        self.SAM2_WORKING_DIR = os.getenv("SAM2_WORKING_DIR", "/workspace/codes/sam2")
        self.SAM3D_WORKING_DIR = os.getenv("SAM3D_WORKING_DIR", "/workspace/codes/sam3d")
        
        # Conda environments
        self.SAM2_CONDA_ENV = os.getenv("SAM2_CONDA_ENV", "base")
        self.SAM3D_CONDA_ENV = os.getenv("SAM3D_CONDA_ENV", "sam3d")
        
        # Model server settings
        self.MODEL_SERVER_HOST = os.getenv("MODEL_SERVER_HOST", "localhost")
        self.MODEL_SERVER_PORT = int(os.getenv("MODEL_SERVER_PORT", "8765"))
    
    @property
    def model_server_url(self) -> str:
        """Get the model server URL."""
        return f"http://{self.MODEL_SERVER_HOST}:{self.MODEL_SERVER_PORT}"
    
    def is_configured(self) -> bool:
        """Check if SSH is properly configured."""
        return bool(
            self.SSH_HOST and 
            self.SSH_USER and 
            (self.SSH_PASSWORD or self.SSH_KEY_FILE)
        )


class RemoteEngineRunner:
    """
    Executes ML processing tasks on remote GPU server.
    
    Supports two modes:
    1. Model Server (preferred): HTTP calls to FastAPI server on GPU
    2. Script Execution (fallback): SSH commands to run scripts directly
    """
    
    def __init__(self, config: Optional[RemoteEngineConfig] = None, use_pool: bool = True):
        """
        Initialize remote engine runner.
        
        Args:
            config: Configuration object (creates default if None)
            use_pool: Whether to use connection pooling
        """
        self.config = config or RemoteEngineConfig()
        self._use_pool = use_pool
        self.ssh_client: Optional[SSHClient] = None
        self._model_server_available: Optional[bool] = None
    
    def _init_ssh_client(self):
        """Initialize SSH client with current config."""
        if self._use_pool:
            pool = SSHConnectionPool()
            self.ssh_client = pool.get_client(
                hostname=self.config.SSH_HOST,
                username=self.config.SSH_USER,
                password=self.config.SSH_PASSWORD,
                key_filename=self.config.SSH_KEY_FILE,
                port=self.config.SSH_PORT
            )
        else:
            self.ssh_client = SSHClient(
                hostname=self.config.SSH_HOST,
                username=self.config.SSH_USER,
                password=self.config.SSH_PASSWORD,
                key_filename=self.config.SSH_KEY_FILE,
                port=self.config.SSH_PORT
            )
            self.ssh_client.connect()
    
    @contextmanager
    def ssh_session(self):
        """Context manager for SSH session."""
        if self.ssh_client is None:
            self._init_ssh_client()
        try:
            yield self.ssh_client
        finally:
            if not self._use_pool and self.ssh_client:
                self.ssh_client.close()
                self.ssh_client = None
    
    def is_model_server_running(self) -> bool:
        """Check if model server is running on remote GPU."""
        if self._model_server_available is not None:
            return self._model_server_available
        
        try:
            with self.ssh_session() as ssh:
                # Check if model server is running via SSH tunnel or direct connection
                exit_code, stdout, stderr = ssh.execute_command(
                    f"curl -s -o /dev/null -w '%{{http_code}}' http://localhost:{self.config.MODEL_SERVER_PORT}/health",
                    timeout=10
                )
                self._model_server_available = stdout.strip() == "200"
                return self._model_server_available
        except Exception as e:
            logger.warning(f"Model server check failed: {e}")
            self._model_server_available = False
            return False
    
    def _call_model_server(
        self, 
        endpoint: str, 
        payload: Dict[str, Any],
        timeout: int = 600
    ) -> Dict[str, Any]:
        """
        Call model server endpoint via SSH tunnel.
        
        Args:
            endpoint: API endpoint (e.g., "/sam2/track")
            payload: Request payload
            timeout: Request timeout in seconds
        
        Returns:
            Response data as dict
        """
        with self.ssh_session() as ssh:
            # Use curl via SSH to call the model server
            payload_json = json.dumps(payload)
            cmd = f'''curl -s -X POST "http://localhost:{self.config.MODEL_SERVER_PORT}{endpoint}" \
                -H "Content-Type: application/json" \
                -d '{payload_json}' '''
            
            exit_code, stdout, stderr = ssh.execute_command(cmd, timeout=timeout)
            
            if exit_code != 0:
                raise RuntimeError(f"Model server call failed: {stderr}")
            
            try:
                return json.loads(stdout)
            except json.JSONDecodeError:
                raise RuntimeError(f"Invalid JSON response: {stdout}")
    
    def download_videos_from_supabase(
        self,
        signed_urls: Dict[str, str],
        remote_video_dir: str
    ) -> Dict[str, str]:
        """
        Download videos to GPU server directly from Supabase using signed URLs.
        
        Args:
            signed_urls: Dict mapping video name to signed URL
            remote_video_dir: Directory on GPU server to store videos
        
        Returns:
            Dict mapping video name to remote path
        """
        downloads = []
        remote_paths = {}
        
        for video_name, signed_url in signed_urls.items():
            remote_path = f"{remote_video_dir}/{video_name}"
            downloads.append({"url": signed_url, "dest": remote_path})
            remote_paths[video_name] = remote_path
        
        # Generate and execute download script
        script = SupabaseDownloadHelper.generate_batch_download_script(downloads)
        
        with self.ssh_session() as ssh:
            exit_code, stdout, stderr = ssh.execute_command(script, timeout=300)
            
            if exit_code != 0:
                logger.error(f"Video download failed: {stderr}")
                raise RuntimeError(f"Failed to download videos: {stderr}")
        
        logger.info(f"Downloaded {len(signed_urls)} videos to GPU server")
        return remote_paths
    
    async def run_sam2_tracking(
        self,
        session_id: str,
        video_path: str,
        init_point: Dict[str, float],
        frame: int = 0,
        detection_box: Optional[List[float]] = None,
    ) -> Dict[str, Any]:
        """
        Run SAM2 object tracking on a video.
        
        Args:
            session_id: Session identifier
            video_path: Path to video on GPU server
            init_point: Initial click point {"x": float, "y": float}
            frame: Frame number for initialization
            detection_box: Optional YOLO bbox [x1,y1,x2,y2] for direct box prompt
        
        Returns:
            Tracking results with masks and trajectory
        """
        # Prefer model server if available
        if self.is_model_server_running():
            payload = {
                "session_id": session_id,
                "video_path": video_path,
                "init_point": init_point,
                "frame": frame,
            }
            if detection_box:
                payload["detection_box"] = detection_box
            return self._call_model_server("/sam2/track", payload)
        
        # Fallback to script execution
        return self._run_sam2_script(session_id, video_path, init_point, frame)
    
    def _run_sam2_script(
        self,
        session_id: str,
        video_path: str,
        init_point: Dict[str, float],
        frame: int
    ) -> Dict[str, Any]:
        """Run SAM2 via script execution (fallback method)."""
        output_dir = f"{self.config.REMOTE_RESULTS_DIR}/{session_id}/sam2"
        
        cmd = RemoteCommandBuilder.with_conda_env(
            f"python -m sam2.track_object "
            f"--video {video_path} "
            f"--point {init_point['x']},{init_point['y']} "
            f"--frame {frame} "
            f"--output {output_dir} "
            f"--checkpoint {self.config.SAM2_MODEL_PATH}",
            self.config.SAM2_CONDA_ENV
        )
        cmd = RemoteCommandBuilder.with_working_dir(cmd, self.config.SAM2_WORKING_DIR)
        
        with self.ssh_session() as ssh:
            exit_code, stdout, stderr = ssh.execute_command(cmd, timeout=600)
            
            if exit_code != 0:
                raise RuntimeError(f"SAM2 tracking failed: {stderr}")
            
            # Read results
            result_path = f"{output_dir}/trajectory.json"
            exit_code, result_json, _ = ssh.execute_command(f"cat {result_path}")
            
            if exit_code == 0:
                return json.loads(result_json)
            
            return {"status": "completed", "output_dir": output_dir}
    
    async def run_sam3d_segmentation(
        self,
        session_id: str,
        object_id: str,
        video_path: str,
        masks_dir: str,
        start_frame: int = 0,
        end_frame: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Run SAM3D 3D point cloud segmentation.
        
        Args:
            session_id: Session identifier
            object_id: Tracked object identifier
            video_path: Path to video on GPU server
            masks_dir: Directory containing SAM2 masks
            start_frame: Starting frame
            end_frame: Ending frame (None for all)
        
        Returns:
            Segmentation results with point cloud data
        """
        # Prefer model server if available
        if self.is_model_server_running():
            return self._call_model_server("/sam3d/segment", {
                "session_id": session_id,
                "object_id": object_id,
                "video_path": video_path,
                "masks_dir": masks_dir,
                "start_frame": start_frame,
                "end_frame": end_frame
            })
        
        # Fallback to script execution
        return self._run_sam3d_script(
            session_id, object_id, video_path, masks_dir, start_frame, end_frame
        )
    
    def _run_sam3d_script(
        self,
        session_id: str,
        object_id: str,
        video_path: str,
        masks_dir: str,
        start_frame: int,
        end_frame: Optional[int]
    ) -> Dict[str, Any]:
        """Run SAM3D via script execution (fallback method)."""
        output_dir = f"{self.config.REMOTE_RESULTS_DIR}/{session_id}/sam3d/{object_id}"
        
        end_frame_arg = f"--end-frame {end_frame}" if end_frame else ""
        
        cmd = RemoteCommandBuilder.with_conda_env(
            f"python sam3d.py "
            f"--video {video_path} "
            f"--masks {masks_dir} "
            f"--start-frame {start_frame} "
            f"{end_frame_arg} "
            f"--output {output_dir}",
            self.config.SAM3D_CONDA_ENV
        )
        cmd = RemoteCommandBuilder.with_working_dir(cmd, self.config.SAM3D_WORKING_DIR)
        
        with self.ssh_session() as ssh:
            exit_code, stdout, stderr = ssh.execute_command(cmd, timeout=1200)
            
            if exit_code != 0:
                raise RuntimeError(f"SAM3D segmentation failed: {stderr}")
            
            # Read results
            result_path = f"{output_dir}/segmentation.json"
            exit_code, result_json, _ = ssh.execute_command(f"cat {result_path}")
            
            if exit_code == 0:
                return json.loads(result_json)
            
            return {
                "status": "completed",
                "output_dir": output_dir,
                "point_cloud_path": f"{output_dir}/point_cloud.ply"
            }
    
    def download_results(
        self,
        remote_dir: str,
        local_dir: str,
        patterns: Optional[List[str]] = None
    ) -> List[str]:
        """
        Download processing results from GPU server.
        
        Args:
            remote_dir: Remote directory containing results
            local_dir: Local destination directory
            patterns: Optional file patterns to match (e.g., ["*.json", "*.npy"])
        
        Returns:
            List of downloaded file paths
        """
        os.makedirs(local_dir, exist_ok=True)
        downloaded = []
        
        with self.ssh_session() as ssh:
            # List files in remote directory
            if patterns:
                pattern_str = " -o ".join([f"-name '{p}'" for p in patterns])
                cmd = f"find {remote_dir} \\( {pattern_str} \\) -type f"
            else:
                cmd = f"find {remote_dir} -type f"
            
            exit_code, stdout, stderr = ssh.execute_command(cmd)
            
            if exit_code != 0:
                logger.warning(f"Could not list remote files: {stderr}")
                return []
            
            files = [f.strip() for f in stdout.strip().split('\n') if f.strip()]
            
            for remote_file in files:
                relative_path = os.path.relpath(remote_file, remote_dir)
                local_file = os.path.join(local_dir, relative_path)
                
                try:
                    ssh.download_file(remote_file, local_file)
                    downloaded.append(local_file)
                except Exception as e:
                    logger.error(f"Failed to download {remote_file}: {e}")
        
        return downloaded
