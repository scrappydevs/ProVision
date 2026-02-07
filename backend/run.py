#!/usr/bin/env python3
import os
import sys
import shutil
import subprocess
import logging

logging.basicConfig(level=logging.INFO)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)

# Auto-inject secrets from Infisical if not already injected
if not os.getenv("INFISICAL_INJECTED"):
    infisical = shutil.which("infisical")
    if infisical:
        try:
            result = subprocess.run(
                [infisical, "export", "--env=dev", "--format=dotenv"],
                capture_output=True, text=True, cwd=PROJECT_ROOT,
            )
            if result.returncode == 0:
                count = 0
                for line in result.stdout.strip().splitlines():
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        key, _, value = line.partition("=")
                        value = value.strip("'\"")
                        os.environ[key] = value
                        count += 1
                os.environ["INFISICAL_INJECTED"] = "1"
                logging.info(f"Loaded {count} secrets from Infisical")
            else:
                logging.warning(f"Infisical export failed: {result.stderr.strip()}")
        except Exception as e:
            logging.warning(f"Infisical error: {e}")
    else:
        logging.warning("Infisical CLI not found — install from https://infisical.com/docs/cli/overview")

import uvicorn

sys.path.insert(0, os.path.join(SCRIPT_DIR, "src"))

if __name__ == "__main__":
    reload = "--reload" in sys.argv or os.getenv("DEBUG", "false").lower() == "true"

    uvicorn.run(
        "api.main:app",
        host=os.getenv("API_HOST", "0.0.0.0"),
        port=int(os.getenv("API_PORT", "8000")),
        reload=reload,
    )
