"""
RunPod dashboard analysis orchestration.

Flow:
1. Resolve the dashboard game's video from Supabase Storage.
2. SSH to RunPod and create/update a dedicated wrapper script file.
3. Wrapper downloads input video from Supabase, runs analysis, uploads outputs to Supabase.
4. Backend lists uploaded artifacts for analytics UI consumption.
"""

import base64
import json
import logging
import mimetypes
import os
import shlex
import textwrap
from pathlib import PurePosixPath
from typing import Any, Dict, List, Optional

from src.engines.remote_run import RemoteEngineRunner

from ..database.supabase import get_supabase
from ..utils.video_utils import extract_video_path_from_url

logger = logging.getLogger(__name__)


class _DashboardEngineConfig:
    """SSH config for the *dashboard / UpliftingTableTennis* RunPod pod.

    This is deliberately separate from the main ``RemoteEngineConfig`` used
    for tracking/SAM2/pose, because the two workloads run on different pods.
    Env-var prefix: ``RUNPOD_DASHBOARD_SSH_*``; falls back to the global
    ``SSH_*`` vars so existing setups keep working.
    """

    def __init__(self):
        self.SSH_HOST = os.getenv("RUNPOD_DASHBOARD_SSH_HOST") or os.getenv("SSH_HOST")
        self.SSH_USER = os.getenv("RUNPOD_DASHBOARD_SSH_USER") or os.getenv("SSH_USER", "root")
        self.SSH_PORT = int(
            os.getenv("RUNPOD_DASHBOARD_SSH_PORT")
            or os.getenv("SSH_PORT", "22")
        )
        self.SSH_PASSWORD = os.getenv("RUNPOD_DASHBOARD_SSH_PASSWORD") or os.getenv("SSH_PASSWORD")
        self.SSH_KEY_FILE = os.getenv("RUNPOD_DASHBOARD_SSH_KEY_FILE") or os.getenv("SSH_KEY_FILE")
        self.SSH_KEY_BASE64 = os.getenv("RUNPOD_DASHBOARD_SSH_KEY_BASE64") or os.getenv("SSH_KEY_BASE64")

        # Expand ~ and resolve relative paths
        if self.SSH_KEY_FILE:
            self.SSH_KEY_FILE = os.path.expanduser(self.SSH_KEY_FILE)
        if self.SSH_KEY_FILE and not os.path.isabs(self.SSH_KEY_FILE):
            project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../.."))
            self.SSH_KEY_FILE = os.path.join(project_root, self.SSH_KEY_FILE)

        # Decode base64 key to temp file when no key file is set
        if self.SSH_KEY_BASE64 and not self.SSH_KEY_FILE:
            try:
                import tempfile as _tmp
                key_bytes = base64.b64decode(self.SSH_KEY_BASE64)
                fd, temp_path = _tmp.mkstemp(suffix=".pem", prefix="dashboard_ssh_key_")
                os.chmod(temp_path, 0o600)
                with os.fdopen(fd, "wb") as f:
                    f.write(key_bytes)
                self.SSH_KEY_FILE = temp_path
            except Exception as exc:
                logger.error(f"Failed to decode RUNPOD_DASHBOARD_SSH_KEY_BASE64: {exc}")

    def is_configured(self) -> bool:
        return bool(self.SSH_HOST and self.SSH_USER and (self.SSH_PASSWORD or self.SSH_KEY_FILE))


class RunPodDashboardService:
    """Service for dashboard analysis execution on RunPod + Supabase artifact sync."""

    def __init__(self):
        self._runner: Optional[RemoteEngineRunner] = None
        self._ssh_config = _DashboardEngineConfig()
        self.bucket_name = os.getenv("RUNPOD_DASHBOARD_BUCKET", "provision-videos")
        self.repo_dir = os.getenv("RUNPOD_DASHBOARD_REPO_DIR", "/workspace/UpliftingTableTennis")
        self.wrapper_path = os.getenv(
            "RUNPOD_DASHBOARD_WRAPPER_PATH",
            f"{self.repo_dir}/provision_dashboard_pipeline.py",
        )
        self.remote_python = os.getenv("RUNPOD_DASHBOARD_PYTHON", "python3")
        self.output_source_dir = os.getenv(
            "RUNPOD_DASHBOARD_OUTPUT_SOURCE_DIR",
            f"{self.repo_dir}/output",
        )
        self.default_inner_command = os.getenv(
            "RUNPOD_DASHBOARD_INNER_COMMAND",
            "python3 run_inference_full_video.py --video {input}",
        )
        self.timeout_seconds = int(os.getenv("RUNPOD_DASHBOARD_TIMEOUT", "7200"))

    @property
    def runner(self) -> RemoteEngineRunner:
        if self._runner is None:
            from src.engines.remote_run import RemoteEngineConfig

            # Build a RemoteEngineConfig that uses the *dashboard* SSH vars
            cfg = RemoteEngineConfig.__new__(RemoteEngineConfig)
            cfg.SSH_HOST = self._ssh_config.SSH_HOST
            cfg.SSH_USER = self._ssh_config.SSH_USER
            cfg.SSH_PORT = self._ssh_config.SSH_PORT
            cfg.SSH_PASSWORD = self._ssh_config.SSH_PASSWORD
            cfg.SSH_KEY_FILE = self._ssh_config.SSH_KEY_FILE
            cfg.SSH_KEY_BASE64 = self._ssh_config.SSH_KEY_BASE64
            cfg.REMOTE_BASE_DIR = self.repo_dir
            cfg.REMOTE_VIDEO_DIR = f"{self.repo_dir}/videos"
            cfg.REMOTE_RESULTS_DIR = f"{self.repo_dir}/output"
            cfg.SAM2_MODEL_PATH = ""
            cfg.SAM2_CONFIG = ""
            cfg.SAM3D_MODEL_PATH = ""
            cfg.SAM2_WORKING_DIR = self.repo_dir
            cfg.SAM3D_WORKING_DIR = self.repo_dir
            cfg.SAM2_CONDA_ENV = "base"
            cfg.SAM3D_CONDA_ENV = "base"
            cfg.MODEL_SERVER_HOST = "localhost"
            cfg.MODEL_SERVER_PORT = 8765

            self._runner = RemoteEngineRunner(config=cfg, use_pool=False)
        return self._runner

    @property
    def is_available(self) -> bool:
        return self._ssh_config.is_configured()

    def artifact_prefix(self, user_id: str, session_id: str) -> str:
        return f"{user_id}/{session_id}/runpod-dashboard"

    def list_artifacts(self, user_id: str, session_id: str) -> List[Dict[str, Any]]:
        """List dashboard artifacts uploaded to Supabase for a session."""
        supabase = get_supabase()
        prefix = self.artifact_prefix(user_id, session_id)

        try:
            files = supabase.storage.from_(self.bucket_name).list(prefix)
        except Exception as exc:
            logger.warning(f"Failed to list RunPod artifacts for {session_id}: {exc}")
            return []

        artifacts: List[Dict[str, Any]] = []
        for file_info in files or []:
            name = file_info.get("name")
            if not name:
                continue

            storage_path = f"{prefix}/{name}"
            url = ""

            try:
                signed = supabase.storage.from_(self.bucket_name).create_signed_url(storage_path, 3600)
                if isinstance(signed, dict):
                    url = (
                        signed.get("signedURL")
                        or signed.get("signed_url")
                        or signed.get("signedUrl")
                        or ""
                    )
            except Exception:
                url = ""

            if not url:
                try:
                    url = supabase.storage.from_(self.bucket_name).get_public_url(storage_path)
                except Exception:
                    url = ""

            mime_type, _ = mimetypes.guess_type(name)
            kind = "file"
            if mime_type:
                if mime_type.startswith("video/"):
                    kind = "video"
                elif mime_type.startswith("image/"):
                    kind = "image"
                elif mime_type == "application/json":
                    kind = "json"

            metadata = file_info.get("metadata") or {}
            artifacts.append(
                {
                    "name": name,
                    "path": storage_path,
                    "url": url,
                    "mime_type": mime_type or "application/octet-stream",
                    "kind": kind,
                    "size": metadata.get("size"),
                    "updated_at": file_info.get("updated_at"),
                    "created_at": file_info.get("created_at"),
                }
            )

        artifacts.sort(key=lambda item: item.get("name", ""))
        return artifacts

    def get_dashboard_payload(self, user_id: str, session_id: str) -> Dict[str, Any]:
        artifacts = self.list_artifacts(user_id, session_id)
        return {
            "status": "ready" if artifacts else "empty",
            "folder": self.artifact_prefix(user_id, session_id),
            "artifacts": artifacts,
        }

    def run_dashboard_analysis(
        self,
        session_id: str,
        user_id: str,
        video_url: str,
        force: bool = False,
        inner_command: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Run remote dashboard analysis and sync outputs to Supabase."""
        if not self.is_available:
            raise RuntimeError("RunPod SSH is not configured. Set SSH_HOST and credentials.")

        supabase_url = os.getenv("SUPABASE_URL")
        supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        if not supabase_url or not supabase_key:
            raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.")

        if not video_url:
            raise RuntimeError("Session has no source video URL.")

        existing_artifacts = self.list_artifacts(user_id, session_id)
        if existing_artifacts and not force:
            return {
                "status": "already_exists",
                "folder": self.artifact_prefix(user_id, session_id),
                "artifacts": existing_artifacts,
                "skipped": True,
            }

        storage_path = extract_video_path_from_url(video_url)
        signed_video_url = self._create_signed_video_url(storage_path)
        artifact_prefix = self.artifact_prefix(user_id, session_id)
        effective_inner_command = (
            inner_command if inner_command is not None else self.default_inner_command
        )

        cmd = self._build_remote_command(
            session_id=session_id,
            signed_video_url=signed_video_url,
            artifact_prefix=artifact_prefix,
            supabase_url=supabase_url,
            supabase_key=supabase_key,
            inner_command=effective_inner_command,
        )

        with self.runner.ssh_session() as ssh:
            exit_code, stdout, stderr = ssh.execute_command(cmd, timeout=self.timeout_seconds)

        if exit_code != 0:
            raise RuntimeError(
                "RunPod dashboard analysis failed.\n"
                f"stdout:\n{stdout[-2000:]}\n"
                f"stderr:\n{stderr[-2000:]}"
            )

        remote_payload = self._extract_json_from_output(stdout) or {"status": "completed"}
        artifacts = self.list_artifacts(user_id, session_id)
        return {
            "status": "completed",
            "folder": artifact_prefix,
            "artifacts": artifacts,
            "remote": remote_payload,
            "skipped": False,
        }

    def _create_signed_video_url(self, storage_path: str) -> str:
        supabase = get_supabase()
        signed = supabase.storage.from_(self.bucket_name).create_signed_url(storage_path, 3600)
        if not isinstance(signed, dict):
            raise RuntimeError("Unexpected signed URL response from Supabase.")
        signed_url = signed.get("signedURL") or signed.get("signed_url") or signed.get("signedUrl")
        if not signed_url:
            raise RuntimeError("Failed to generate signed URL for dashboard source video.")
        return signed_url

    def _build_remote_command(
        self,
        session_id: str,
        signed_video_url: str,
        artifact_prefix: str,
        supabase_url: str,
        supabase_key: str,
        inner_command: str,
    ) -> str:
        script = self._build_wrapper_script()
        script_b64 = base64.b64encode(script.encode("utf-8")).decode("ascii")
        script_dir = str(PurePosixPath(self.wrapper_path).parent)

        lines = [
            "set -e",
            f"mkdir -p {shlex.quote(script_dir)}",
            "python3 - <<'PY'",
            "import base64",
            "from pathlib import Path",
            f"payload = base64.b64decode({script_b64!r})",
            f"target = Path({self.wrapper_path!r})",
            "target.write_bytes(payload)",
            "PY",
            f"chmod +x {shlex.quote(self.wrapper_path)}",
        ]

        run_cmd = [
            shlex.quote(self.remote_python),
            shlex.quote(self.wrapper_path),
            "--video-url",
            shlex.quote(signed_video_url),
            "--session-id",
            shlex.quote(session_id),
            "--output-prefix",
            shlex.quote(artifact_prefix),
            "--supabase-url",
            shlex.quote(supabase_url),
            "--supabase-key",
            shlex.quote(supabase_key),
            "--bucket",
            shlex.quote(self.bucket_name),
            "--repo-dir",
            shlex.quote(self.repo_dir),
            "--output-source-dir",
            shlex.quote(self.output_source_dir),
        ]
        if inner_command:
            run_cmd.extend(["--inner-command", shlex.quote(inner_command)])

        lines.append(" ".join(run_cmd))
        return "\n".join(lines)

    @staticmethod
    def _extract_json_from_output(stdout: str) -> Optional[Dict[str, Any]]:
        if not stdout:
            return None
        for line in reversed(stdout.splitlines()):
            candidate = line.strip()
            if not candidate or not candidate.startswith("{"):
                continue
            try:
                parsed = json.loads(candidate)
                if isinstance(parsed, dict):
                    return parsed
            except json.JSONDecodeError:
                continue
        return None

    @staticmethod
    def _build_wrapper_script() -> str:
        return textwrap.dedent(
            """\
            #!/usr/bin/env python3
            import argparse
            import json
            import mimetypes
            import shutil
            import subprocess
            import tempfile
            from pathlib import Path
            from urllib.parse import quote
            import urllib.request


            def _download_file(url: str, destination: Path) -> None:
                request = urllib.request.Request(url, headers={"User-Agent": "ProVision-RunPod/1.0"})
                with urllib.request.urlopen(request, timeout=600) as response, destination.open("wb") as handle:
                    shutil.copyfileobj(response, handle)


            def _upload_file(
                *,
                supabase_url: str,
                supabase_key: str,
                bucket: str,
                storage_path: str,
                local_path: Path,
            ) -> None:
                encoded_path = "/".join(quote(part, safe="") for part in storage_path.split("/"))
                endpoint = f"{supabase_url.rstrip('/')}/storage/v1/object/{bucket}/{encoded_path}"
                cmd = [
                    "curl",
                    "-sS",
                    "-X",
                    "POST",
                    endpoint,
                    "-H",
                    f"Authorization: Bearer {supabase_key}",
                    "-H",
                    f"apikey: {supabase_key}",
                    "-H",
                    "x-upsert: true",
                    "-H",
                    f"Content-Type: {mimetypes.guess_type(local_path.name)[0] or 'application/octet-stream'}",
                    "--data-binary",
                    f"@{local_path}",
                ]
                proc = subprocess.run(cmd, capture_output=True, text=True)
                if proc.returncode != 0:
                    raise RuntimeError(f"Upload failed for {storage_path}: {proc.stderr.strip() or proc.stdout.strip()}")


            def _clear_dir(path: Path) -> None:
                if not path.exists():
                    return
                for child in path.iterdir():
                    if child.is_dir():
                        shutil.rmtree(child, ignore_errors=True)
                    else:
                        try:
                            child.unlink()
                        except FileNotFoundError:
                            pass


            def _copy_tree_files(source_dir: Path, dest_dir: Path) -> None:
                if not source_dir.exists():
                    return
                for src in source_dir.rglob("*"):
                    if not src.is_file():
                        continue
                    rel = src.relative_to(source_dir)
                    dst = dest_dir / rel
                    dst.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(src, dst)


            def _run_inner(
                *,
                repo_dir: Path,
                output_source_dir: Path,
                inner_command: str,
                input_video: Path,
                output_dir: Path,
                session_id: str,
            ) -> dict:
                attempts = []
                if inner_command:
                    command = inner_command.format(input=str(input_video), output_dir=str(output_dir), session_id=session_id)
                    attempts.append(("shell", command))
                else:
                    attempts.append(("argv", ["python3", "run_inference_full_video.py", "--video", str(input_video)]))

                errors = []
                if output_source_dir.exists():
                    _clear_dir(output_source_dir)
                output_source_dir.mkdir(parents=True, exist_ok=True)

                for mode, payload in attempts:
                    if mode == "shell":
                        proc = subprocess.run(payload, shell=True, capture_output=True, text=True, cwd=str(repo_dir))
                    else:
                        proc = subprocess.run(payload, capture_output=True, text=True, cwd=str(repo_dir))

                    if proc.returncode == 0:
                        _copy_tree_files(output_source_dir, output_dir)
                        return {
                            "ran": True,
                            "mode": mode,
                            "command": payload,
                            "stdout": proc.stdout[-4000:],
                            "stderr": proc.stderr[-4000:],
                        }

                    errors.append(
                        {
                            "mode": mode,
                            "command": payload,
                            "stdout": proc.stdout[-2000:],
                            "stderr": proc.stderr[-2000:],
                            "return_code": proc.returncode,
                        }
                    )

                return {"ran": False, "errors": errors}


            def main() -> None:
                parser = argparse.ArgumentParser(description="RunPod dashboard wrapper")
                parser.add_argument("--video-url", required=True)
                parser.add_argument("--session-id", required=True)
                parser.add_argument("--output-prefix", required=True)
                parser.add_argument("--supabase-url", required=True)
                parser.add_argument("--supabase-key", required=True)
                parser.add_argument("--bucket", default="provision-videos")
                parser.add_argument("--repo-dir", default="/workspace/UpliftingTableTennis")
                parser.add_argument("--output-source-dir", default="/workspace/UpliftingTableTennis/output")
                parser.add_argument("--inner-command", default="")
                args = parser.parse_args()

                with tempfile.TemporaryDirectory(prefix=f"provision_{args.session_id}_") as temp_dir:
                    temp_path = Path(temp_dir)
                    input_video = temp_path / "dashboard_game_video.mp4"
                    output_dir = temp_path / "output"
                    output_dir.mkdir(parents=True, exist_ok=True)
                    repo_dir = Path(args.repo_dir)
                    output_source_dir = Path(args.output_source_dir)

                    _download_file(args.video_url, input_video)

                    inner_result = _run_inner(
                        repo_dir=repo_dir,
                        output_source_dir=output_source_dir,
                        inner_command=args.inner_command,
                        input_video=input_video,
                        output_dir=output_dir,
                        session_id=args.session_id,
                    )

                    # Collect output files, skipping jupyter checkpoints and initial/ dir
                    _skip_dirs = {".ipynb_checkpoints", "initial", "__pycache__"}
                    generated_files = [
                        p
                        for p in output_dir.rglob("*")
                        if p.is_file() and not (_skip_dirs & set(p.relative_to(output_dir).parts))
                    ]
                    if not generated_files:
                        fallback_video = output_dir / "processed_video.mp4"
                        shutil.copy2(input_video, fallback_video)
                        generated_files = [fallback_video]

                    manifest_path = output_dir / "runpod_manifest.json"
                    manifest_path.write_text(
                        json.dumps(
                            {
                                "session_id": args.session_id,
                                "inner_result": inner_result,
                                "output_file_count": len(generated_files),
                            },
                            indent=2,
                        ),
                        encoding="utf-8",
                    )
                    generated_files.append(manifest_path)

                    uploaded = []
                    seen_names = {}
                    for file_path in generated_files:
                        name = file_path.name
                        count = seen_names.get(name, 0)
                        seen_names[name] = count + 1
                        if count > 0:
                            stem = file_path.stem
                            suffix = file_path.suffix
                            name = f"{stem}_{count}{suffix}"

                        storage_path = f"{args.output_prefix}/{name}"
                        _upload_file(
                            supabase_url=args.supabase_url,
                            supabase_key=args.supabase_key,
                            bucket=args.bucket,
                            storage_path=storage_path,
                            local_path=file_path,
                        )
                        uploaded.append({"name": name, "path": storage_path})

                    print(
                        json.dumps(
                            {
                                "status": "ok",
                                "output_prefix": args.output_prefix,
                                "uploaded_count": len(uploaded),
                                "uploaded": uploaded,
                            }
                        )
                    )


            if __name__ == "__main__":
                main()
            """
        )


runpod_dashboard_service = RunPodDashboardService()
