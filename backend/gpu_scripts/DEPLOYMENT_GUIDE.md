# ProVision RunPod Setup - Manual Deployment Guide

## ⚠️ IMPORTANT: Your Pod SSH Details Have Changed

The old SSH connection (216.81.248.127:15094) is no longer accessible.

## Step 1: Get New SSH Connection Details

1. Go to RunPod dashboard: https://www.runpod.io/console/pods
2. Find your pod: **delightful_green_snail-migration**
3. Click **"Connect"** button  
4. Copy the SSH command that looks like:
   ```
   ssh root@<NEW_IP> -p <NEW_PORT> -i ~/.ssh/id_ed25519
   ```

## Step 2: Update Backend .env

Edit `/Users/julianng-thow-hing/Desktop/ProVision/backend/.env`:

```bash
SSH_HOST=<NEW_IP>
SSH_PORT=<NEW_PORT>
SSH_USER=root
SSH_KEY_FILE=/Users/julianng-thow-hing/.ssh/id_ed25519
```

## Step 3: Manual Deployment (Recommended)

Since the automated script can't connect, let's do this manually:

### A. SSH into your RunPod

```bash
ssh root@<NEW_IP> -p <NEW_PORT> -i ~/.ssh/id_ed25519
```

### B. Create directory structure

```bash
mkdir -p /workspace/provision/tracknet
mkdir -p /workspace/checkpoints
mkdir -p /workspace/codes
mkdir -p /workspace/provision/data/{videos,results}
```

### C. Copy setup_runpod.sh content

Create the file:
```bash
nano /workspace/provision/setup_runpod.sh
```

Paste this content:

```bash
#!/bin/bash
set -e
echo "=== ProVision RunPod Setup ==="

# Install Python dependencies
echo "Installing Python packages..."
pip install --upgrade pip
pip install fastapi uvicorn pydantic opencv-python scipy numpy httpx
pip install ultralytics

# Clone SAM2
if [ ! -d "/workspace/codes/sam2" ]; then
    echo "Setting up SAM2..."
    cd /workspace/codes
    git clone https://github.com/facebookresearch/sam2.git
    cd sam2
    pip install -e .
fi

# Download model checkpoints
echo "Downloading model checkpoints..."

# SAM2
if [ ! -f "/workspace/checkpoints/sam2.1_hiera_tiny.pt" ]; then
    wget -O /workspace/checkpoints/sam2.1_hiera_tiny.pt \
        https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_tiny.pt
fi

# YOLO
if [ ! -f "/workspace/checkpoints/yolo11n.pt" ]; then
    wget -O /workspace/checkpoints/yolo11n.pt \
        https://github.com/ultralytics/assets/releases/download/v8.3.0/yolo11n.pt
fi

if [ ! -f "/workspace/checkpoints/yolo11n-pose.pt" ]; then
    wget -O /workspace/checkpoints/yolo11n-pose.pt \
        https://github.com/ultralytics/assets/releases/download/v8.3.0/yolo11n-pose.pt
fi

echo "Setup complete!"
```

Save (Ctrl+O, Enter, Ctrl+X) and run:
```bash
chmod +x /workspace/provision/setup_runpod.sh
bash /workspace/provision/setup_runpod.sh
```

### D. Upload files from your local machine

Open a NEW terminal window on your Mac and run:

```bash
# Set your SSH details
export SSH_HOST="<NEW_IP>"
export SSH_PORT="<NEW_PORT>"
export SSH_KEY="$HOME/.ssh/id_ed25519"

# Upload model server
scp -i $SSH_KEY -P $SSH_PORT \
    ~/Desktop/ProVision/backend/gpu_scripts/model_server.py \
    root@$SSH_HOST:/workspace/provision/

# Upload TrackNet files
scp -i $SSH_KEY -P $SSH_PORT \
    ~/Desktop/ProVision/backend/gpu_scripts/tracknet/*.py \
    root@$SSH_HOST:/workspace/provision/tracknet/

# Upload start script
scp -i $SSH_KEY -P $SSH_PORT \
    ~/Desktop/ProVision/backend/gpu_scripts/start_server.sh \
    root@$SSH_HOST:/workspace/provision/
```

### E. Start the Model Server

Back in your RunPod SSH session:

```bash
chmod +x /workspace/provision/start_server.sh
nohup /workspace/provision/start_server.sh > /workspace/provision/server.log 2>&1 &
```

Wait 10-20 seconds for models to load, then check:
```bash
curl http://localhost:8765/health
```

You should see:
```json
{
  "status": "ok",
  "models": {
    "sam2": {"loaded": true},
    "yolo": {"loaded": true},
    "yolo_pose": {"loaded": true},
    "tracknet": {"loaded": true}
  },
  "device": "cuda:0"
}
```

### F. View logs
```bash
tail -f /workspace/provision/server.log
```

Press Ctrl+C to exit log viewing.

## Step 4: Update Backend .env and Test

1. Update your backend/.env with the new SSH details
2. Restart your backend server
3. Try uploading a video in the ProVision app

## Troubleshooting

### "TrackNet checkpoint not found"
```bash
# On RunPod, check if you have the checkpoint:
ls -lh /workspace/checkpoints/

# If tracknet_tennis.pt is missing, you need to upload your trained model
```

### Models not loading
```bash
# Check Python packages
pip list | grep -E "torch|ultralytics|fastapi"

# Check CUDA
nvidia-smi
python3 -c "import torch; print(f'CUDA: {torch.cuda.is_available()}')"
```

### Server crashed
```bash
# Check logs
tail -100 /workspace/provision/server.log

# Restart
pkill -f model_server
nohup /workspace/provision/start_server.sh > /workspace/provision/server.log 2>&1 &
```

## Quick Commands Reference

```bash
# Check if server is running
ps aux | grep model_server

# Stop server
pkill -f model_server

# Start server
nohup /workspace/provision/start_server.sh > /workspace/provision/server.log 2>&1 &

# Test health
curl http://localhost:8765/health

# View logs
tail -f /workspace/provision/server.log

# Check disk space
df -h /workspace
```

