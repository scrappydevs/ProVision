#!/bin/bash
# ProVision RunPod A100 Setup
# This script sets up the GPU environment for SAM2 and SAM3D processing

set -e

echo "=== ProVision GPU Environment Setup ==="
echo "Date: $(date)"
echo "GPU: $(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null || echo 'N/A')"

# 1. Install PyTorch with CUDA 12.1
echo ""
echo "=== Installing PyTorch with CUDA 12.1 ==="
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121

# 2. Install common dependencies
echo ""
echo "=== Installing common dependencies ==="
pip install fastapi uvicorn opencv-python-headless numpy pydantic httpx

# 3. Create workspace directories
echo ""
echo "=== Creating workspace directories ==="
mkdir -p /workspace/codes
mkdir -p /workspace/checkpoints
mkdir -p /workspace/provision/data/videos
mkdir -p /workspace/provision/data/results

# 4. Clone SAM2 repository
echo ""
echo "=== Setting up SAM2 ==="
cd /workspace/codes
if [ ! -d "sam2" ]; then
    echo "Cloning SAM2..."
    git clone https://github.com/facebookresearch/sam2.git
    cd sam2
    pip install -e .
    cd ..
else
    echo "SAM2 already exists, updating..."
    cd sam2 && git pull && pip install -e . && cd ..
fi

# 5. Clone SAM3D repository
echo ""
echo "=== Setting up SAM3D ==="
cd /workspace/codes
if [ ! -d "sam3d" ]; then
    echo "Cloning SAM3D..."
    git clone https://github.com/Pointcept/SegmentAnything3D.git sam3d
    cd sam3d
    pip install -r requirements.txt 2>/dev/null || echo "No requirements.txt found"
    cd ..
else
    echo "SAM3D already exists, updating..."
    cd sam3d && git pull && cd ..
fi

# 6. Install MiDaS for depth estimation (used by SAM3D)
echo ""
echo "=== Installing MiDaS dependencies ==="
pip install timm

# 7. Download model checkpoints
echo ""
echo "=== Downloading model checkpoints ==="
cd /workspace/checkpoints

# SAM2 checkpoint
if [ ! -f "sam2.1_hiera_large.pt" ]; then
    echo "Downloading SAM2 checkpoint..."
    wget -q --show-progress https://dl.fbaipublicfiles.com/segment_anything_2/sam2.1_hiera_l.pt -O sam2.1_hiera_large.pt
else
    echo "SAM2 checkpoint already exists"
fi

# MiDaS will auto-download on first use via torch.hub

# 8. Create SAM3D conda environment (optional, for isolation)
echo ""
echo "=== Checking conda environment ==="
if command -v conda &> /dev/null; then
    if ! conda env list | grep -q "sam3d"; then
        echo "Creating sam3d conda environment..."
        conda create -n sam3d python=3.10 -y
        conda activate sam3d
        pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
        pip install timm opencv-python-headless numpy
    else
        echo "sam3d conda environment already exists"
    fi
else
    echo "Conda not available, using base environment"
fi

# 9. Copy model server script
echo ""
echo "=== Setting up model server ==="
if [ -f "/workspace/provision/model_server.py" ]; then
    cp /workspace/provision/model_server.py /workspace/codes/model_server.py
    echo "Model server copied to /workspace/codes/"
else
    echo "Note: model_server.py not found in /workspace/provision/"
    echo "Upload it manually or via SFTP"
fi

# 10. Create systemd service (optional)
echo ""
echo "=== Setup Complete ==="
echo ""
echo "To start the model server:"
echo "  cd /workspace/codes"
echo "  python model_server.py --port 8765 --models sam2,sam3d"
echo ""
echo "Or run in background with nohup:"
echo "  nohup python model_server.py --port 8765 --models sam2,sam3d > /workspace/provision/model_server.log 2>&1 &"
echo ""
echo "Check health endpoint:"
echo "  curl http://localhost:8765/health"
