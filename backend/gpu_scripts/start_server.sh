#!/bin/bash
# ProVision Model Server Startup Script
# This script sets up and starts the FastAPI model server on RunPod GPU

set -e  # Exit on error

echo "=== ProVision Model Server Startup ==="
echo "Starting at: $(date)"

# Install ultralytics (does not persist across pod restarts)
echo "Installing ultralytics..."
pip install --break-system-packages -q ultralytics opencv-python-headless scipy fastapi uvicorn pydantic

# Check if CUDA is available
python3 -c "import torch; print(f'CUDA available: {torch.cuda.is_available()}')"
python3 -c "import torch; print(f'CUDA device: {torch.cuda.get_device_name(0) if torch.cuda.is_available() else \"N/A\"}')"

# Start the model server
echo "Starting FastAPI model server on port 8765..."
cd /workspace/provision
python3 model_server.py --port 8765 --models sam2,yolo,tracknet

