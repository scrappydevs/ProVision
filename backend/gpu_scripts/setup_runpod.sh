#!/bin/bash
# ProVision RunPod Setup Script
# Run this ONCE after creating a new pod to set up the environment

set -e

echo "=== ProVision RunPod Setup ==="
echo "Starting setup at: $(date)"

# Create directory structure
echo "Creating directory structure..."
mkdir -p /workspace/provision/{data/videos,data/results,tracknet}
mkdir -p /workspace/checkpoints
mkdir -p /workspace/codes

cd /workspace

# Install Python dependencies
echo "Installing Python packages..."
pip install --break-system-packages --upgrade pip
pip install --break-system-packages fastapi uvicorn pydantic opencv-python scipy numpy httpx
pip install --break-system-packages ultralytics  # YOLO

# TTNet dependencies (table tennis specific ball tracking)
pip install --break-system-packages torchvision

# Clone/setup SAM2
if [ ! -d "/workspace/codes/sam2" ]; then
    echo "Setting up SAM2..."
    cd /workspace/codes
    git clone https://github.com/facebookresearch/sam2.git
    cd sam2
    pip install -e .
fi

# Download model checkpoints
echo "Downloading model checkpoints..."

# SAM2 tiny checkpoint
if [ ! -f "/workspace/checkpoints/sam2.1_hiera_tiny.pt" ]; then
    echo "Downloading SAM2 tiny checkpoint..."
    wget -O /workspace/checkpoints/sam2.1_hiera_tiny.pt \
        https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_tiny.pt
fi

# YOLO checkpoints
if [ ! -f "/workspace/checkpoints/yolo11n.pt" ]; then
    echo "Downloading YOLO11n..."
    wget -O /workspace/checkpoints/yolo11n.pt \
        https://github.com/ultralytics/assets/releases/download/v8.3.0/yolo11n.pt
fi

if [ ! -f "/workspace/checkpoints/yolo11n-pose.pt" ]; then
    echo "Downloading YOLO11n-pose..."
    wget -O /workspace/checkpoints/yolo11n-pose.pt \
        https://github.com/ultralytics/assets/releases/download/v8.3.0/yolo11n-pose.pt
fi

# TrackNet checkpoint (placeholder - you'll need to provide this)
if [ ! -f "/workspace/checkpoints/tracknet_tennis.pt" ]; then
    echo "WARNING: TrackNet checkpoint not found at /workspace/checkpoints/tracknet_tennis.pt"
    echo "You need to upload your trained TrackNet model"
fi

# TTNet repo (table tennis specific)
if [ ! -d "/workspace/provision/ttnet" ]; then
    echo "Cloning TTNet repo..."
    git clone https://github.com/maudzung/TTNet-Real-time-Analysis-System-for-Table-Tennis-Pytorch /workspace/provision/ttnet
fi

# TTNet checkpoint (placeholder - you'll need to provide this)
if [ ! -f "/workspace/checkpoints/ttnet_3rd_phase.pth" ]; then
    echo "WARNING: TTNet checkpoint not found at /workspace/checkpoints/ttnet_3rd_phase.pth"
    echo "You need to upload trained TTNet weights (3rd-phase recommended)"
fi

echo ""
echo "=== Setup Complete ==="
echo "Next steps:"
echo "1. Upload model_server.py to /workspace/provision/"
echo "2. Upload tracknet model files to /workspace/provision/tracknet/"
echo "3. Upload start_server.sh to /workspace/provision/"
echo "4. Run: chmod +x /workspace/provision/start_server.sh"
echo "5. Run: nohup /workspace/provision/start_server.sh > /workspace/provision/server.log 2>&1 &"
echo "6. Check logs: tail -f /workspace/provision/server.log"
echo "7. Test: curl http://localhost:8765/health"

