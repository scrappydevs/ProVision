"""
SSH/SFTP client for remote GPU server operations.
Handles file transfers and remote command execution.

Optimizations implemented:
- Connection pooling/reuse across multiple operations
- Batch file transfers using ThreadPoolExecutor
- Streaming for large files to minimize memory usage
"""

import os
import paramiko
from pathlib import Path
from typing import Optional, Tuple, List, Callable, Dict, Any
import logging
from contextlib import contextmanager
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading

logger = logging.getLogger(__name__)


class SSHClient:
    """Manages SSH connections to remote GPU server."""
    
    def __init__(
        self,
        hostname: str,
        username: str,
        password: Optional[str] = None,
        key_filename: Optional[str] = None,
        port: int = 22
    ):
        """
        Initialize SSH client.
        
        Args:
            hostname: Remote server hostname or IP
            username: SSH username
            password: SSH password (optional if using key)
            key_filename: Path to SSH private key (optional)
            port: SSH port (default 22)
        """
        self.hostname = hostname
        self.username = username
        self.password = password
        self.key_filename = key_filename
        self.port = port
        
        self._ssh_client: Optional[paramiko.SSHClient] = None
        self._sftp_client: Optional[paramiko.SFTPClient] = None
    
    def connect(self) -> None:
        """Establish SSH connection to remote server."""
        if self._ssh_client is not None:
            return  # Already connected
        
        try:
            self._ssh_client = paramiko.SSHClient()
            self._ssh_client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            
            connect_kwargs = {
                'hostname': self.hostname,
                'username': self.username,
                'port': self.port,
                'timeout': 30
            }
            
            if self.key_filename:
                connect_kwargs['key_filename'] = self.key_filename
            elif self.password:
                connect_kwargs['password'] = self.password
            else:
                raise ValueError("Either password or key_filename must be provided")
            
            self._ssh_client.connect(**connect_kwargs)
            self._sftp_client = self._ssh_client.open_sftp()
            
            logger.info(f"Connected to {self.hostname} as {self.username}")
        
        except Exception as e:
            logger.error(f"Failed to connect to {self.hostname}: {e}")
            self.close()
            raise
    
    def close(self) -> None:
        """Close SSH and SFTP connections."""
        if self._sftp_client:
            self._sftp_client.close()
            self._sftp_client = None
        
        if self._ssh_client:
            self._ssh_client.close()
            self._ssh_client = None
        
        logger.debug("SSH connection closed")
    
    @contextmanager
    def session(self):
        """Context manager for SSH session."""
        self.connect()
        try:
            yield self
        finally:
            self.close()
    
    def is_connected(self) -> bool:
        """Check if SSH connection is active."""
        if self._ssh_client is None:
            return False
        try:
            transport = self._ssh_client.get_transport()
            return transport is not None and transport.is_active()
        except Exception:
            return False
    
    def execute_command(
        self,
        command: str,
        timeout: int = 300,
        get_pty: bool = False
    ) -> Tuple[int, str, str]:
        """
        Execute a command on the remote server.
        
        Args:
            command: Command to execute
            timeout: Command timeout in seconds
            get_pty: Whether to request a pseudo-terminal
        
        Returns:
            Tuple of (exit_code, stdout, stderr)
        """
        if not self.is_connected():
            self.connect()
        
        try:
            stdin, stdout, stderr = self._ssh_client.exec_command(
                command,
                timeout=timeout,
                get_pty=get_pty
            )
            
            exit_code = stdout.channel.recv_exit_status()
            stdout_str = stdout.read().decode('utf-8', errors='replace')
            stderr_str = stderr.read().decode('utf-8', errors='replace')
            
            return exit_code, stdout_str, stderr_str
        
        except Exception as e:
            logger.error(f"Command execution failed: {e}")
            raise
    
    def upload_file(
        self,
        local_path: str,
        remote_path: str,
        callback: Optional[Callable[[int, int], None]] = None
    ) -> None:
        """
        Upload a file to the remote server.
        
        Args:
            local_path: Local file path
            remote_path: Remote destination path
            callback: Optional progress callback(bytes_transferred, total_bytes)
        """
        if not self.is_connected():
            self.connect()
        
        # Ensure remote directory exists
        remote_dir = os.path.dirname(remote_path)
        self._ensure_remote_dir(remote_dir)
        
        self._sftp_client.put(local_path, remote_path, callback=callback)
        logger.debug(f"Uploaded {local_path} -> {remote_path}")
    
    def download_file(
        self,
        remote_path: str,
        local_path: str,
        callback: Optional[Callable[[int, int], None]] = None
    ) -> None:
        """
        Download a file from the remote server.
        
        Args:
            remote_path: Remote file path
            local_path: Local destination path
            callback: Optional progress callback(bytes_transferred, total_bytes)
        """
        if not self.is_connected():
            self.connect()
        
        # Ensure local directory exists
        local_dir = os.path.dirname(local_path)
        os.makedirs(local_dir, exist_ok=True)
        
        self._sftp_client.get(remote_path, local_path, callback=callback)
        logger.debug(f"Downloaded {remote_path} -> {local_path}")
    
    def _ensure_remote_dir(self, remote_dir: str) -> None:
        """Ensure remote directory exists, creating if necessary."""
        if not remote_dir:
            return
        
        try:
            self._sftp_client.stat(remote_dir)
        except FileNotFoundError:
            # Create directory recursively
            parts = remote_dir.split('/')
            current = ''
            for part in parts:
                if not part:
                    continue
                current = f"{current}/{part}"
                try:
                    self._sftp_client.stat(current)
                except FileNotFoundError:
                    self._sftp_client.mkdir(current)
    
    def file_exists(self, remote_path: str) -> bool:
        """Check if a file exists on the remote server."""
        if not self.is_connected():
            self.connect()
        
        try:
            self._sftp_client.stat(remote_path)
            return True
        except FileNotFoundError:
            return False
    
    def list_dir(self, remote_path: str) -> List[str]:
        """List files in a remote directory."""
        if not self.is_connected():
            self.connect()
        
        try:
            return self._sftp_client.listdir(remote_path)
        except FileNotFoundError:
            return []


class SSHConnectionPool:
    """
    Thread-safe pool of SSH connections for concurrent operations.
    Reuses connections across multiple requests.
    """
    
    _instance = None
    _lock = threading.Lock()
    
    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._connections: Dict[str, SSHClient] = {}
                    cls._instance._connection_locks: Dict[str, threading.Lock] = {}
        return cls._instance
    
    def _get_key(self, hostname: str, username: str, port: int) -> str:
        """Generate a unique key for connection identification."""
        return f"{username}@{hostname}:{port}"
    
    def get_client(
        self,
        hostname: str,
        username: str,
        password: Optional[str] = None,
        key_filename: Optional[str] = None,
        port: int = 22
    ) -> SSHClient:
        """
        Get or create an SSH client from the pool.
        
        Args:
            hostname: Remote server hostname
            username: SSH username
            password: SSH password (optional)
            key_filename: Path to SSH key (optional)
            port: SSH port
        
        Returns:
            SSHClient instance (may be reused)
        """
        key = self._get_key(hostname, username, port)
        
        with self._lock:
            if key not in self._connection_locks:
                self._connection_locks[key] = threading.Lock()
        
        with self._connection_locks[key]:
            if key in self._connections:
                client = self._connections[key]
                if client.is_connected():
                    return client
            
            # Create new connection
            client = SSHClient(
                hostname=hostname,
                username=username,
                password=password,
                key_filename=key_filename,
                port=port
            )
            client.connect()
            self._connections[key] = client
            return client
    
    def close_all(self) -> None:
        """Close all pooled connections."""
        with self._lock:
            for client in self._connections.values():
                try:
                    client.close()
                except Exception as e:
                    logger.warning(f"Error closing connection: {e}")
            self._connections.clear()


class BatchFileTransfer:
    """
    Handles batch file transfers with parallel execution.
    Uses ThreadPoolExecutor for concurrent uploads/downloads.
    """
    
    def __init__(self, ssh_client: SSHClient, max_workers: int = 4):
        """
        Initialize batch transfer handler.
        
        Args:
            ssh_client: SSHClient instance to use
            max_workers: Maximum concurrent transfers
        """
        self.ssh_client = ssh_client
        self.max_workers = max_workers
    
    def upload_batch(
        self,
        transfers: List[Tuple[str, str]],
        progress_callback: Optional[Callable[[str, int, int], None]] = None
    ) -> Dict[str, bool]:
        """
        Upload multiple files in parallel.
        
        Args:
            transfers: List of (local_path, remote_path) tuples
            progress_callback: Optional callback(filename, bytes_done, total_bytes)
        
        Returns:
            Dict mapping local_path to success status
        """
        results = {}
        
        def upload_one(local_path: str, remote_path: str) -> Tuple[str, bool]:
            try:
                self.ssh_client.upload_file(local_path, remote_path)
                return local_path, True
            except Exception as e:
                logger.error(f"Failed to upload {local_path}: {e}")
                return local_path, False
        
        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            futures = {
                executor.submit(upload_one, local, remote): local
                for local, remote in transfers
            }
            
            for future in as_completed(futures):
                local_path, success = future.result()
                results[local_path] = success
        
        return results
    
    def download_batch(
        self,
        transfers: List[Tuple[str, str]],
        progress_callback: Optional[Callable[[str, int, int], None]] = None
    ) -> Dict[str, bool]:
        """
        Download multiple files in parallel.
        
        Args:
            transfers: List of (remote_path, local_path) tuples
            progress_callback: Optional callback(filename, bytes_done, total_bytes)
        
        Returns:
            Dict mapping remote_path to success status
        """
        results = {}
        
        def download_one(remote_path: str, local_path: str) -> Tuple[str, bool]:
            try:
                self.ssh_client.download_file(remote_path, local_path)
                return remote_path, True
            except Exception as e:
                logger.error(f"Failed to download {remote_path}: {e}")
                return remote_path, False
        
        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            futures = {
                executor.submit(download_one, remote, local): remote
                for remote, local in transfers
            }
            
            for future in as_completed(futures):
                remote_path, success = future.result()
                results[remote_path] = success
        
        return results


class RemoteCommandBuilder:
    """Helper class to build complex remote commands."""
    
    @staticmethod
    def with_conda_env(command: str, env_name: str) -> str:
        """Wrap command to run in a conda environment."""
        return f"source ~/miniconda3/etc/profile.d/conda.sh && conda activate {env_name} && {command}"
    
    @staticmethod
    def with_working_dir(command: str, working_dir: str) -> str:
        """Wrap command to run in a specific directory."""
        return f"cd {working_dir} && {command}"
    
    @staticmethod
    def with_timeout(command: str, timeout_seconds: int) -> str:
        """Wrap command with a timeout."""
        return f"timeout {timeout_seconds} {command}"
    
    @staticmethod
    def background(command: str, log_file: Optional[str] = None) -> str:
        """Run command in background with optional logging."""
        if log_file:
            return f"nohup {command} > {log_file} 2>&1 &"
        return f"nohup {command} > /dev/null 2>&1 &"
