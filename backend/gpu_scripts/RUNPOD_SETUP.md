# ProVision RunPod Setup Guide

## Your RunPod Details
- **Pod Name**: delightful_green_snail-migration
- **GPU**: A100 SXM 1x
- **Template**: runpod-torch-v280
- **Volume**: 50 GB at `/workspace` (persistent)

## Quick Setup Instructions

### Step 1: Get SSH Connection Details
1. Go to your RunPod pod dashboard
2. Click "Connect" button
3. Copy the SSH command (it will look like: `ssh root@<IP> -p <PORT> -i ~/.ssh/id_ed25519`)

### Step 2: Update Backend .env File
Update `/Desktop/ProVision/backend/.env` with your pod's SSH details:
```bash
SSH_HOST=<your_pod_ip>
SSH_PORT=<your_pod_port>
SSH_USER=root
SSH_KEY_FILE=/Users/julianng-thow-hing/.ssh/id_ed25519
```

### Step 3: Deploy to RunPod
From your local machine:
```bash
cd /Users/julianng-thow-hing/Desktop/ProVision/backend/gpu_scripts
./deploy_to_runpod.sh
```

This script will:
1. Test SSH connection
2. Upload all necessary files (model_server.py, tracknet files, scripts)
3. Run the setup script on RunPod
4. Download all model checkpoints

### Step 4: Start the Model Server
SSH into your pod and start the server:
```bash
ssh -i ~/.ssh/id_ed25519 -p <PORT> root@<IP>
nohup /workspace/provision/start_server.sh > /workspace/provision/server.log 2>&1 &
```

### Step 5: Verify Server is Running
Check the health endpoint:
```bash
curl http://localhost:8765/health
```

Should return:
```json
{
  "status": "ok",
  "uptime_seconds": 123.45,
  "models": {
    "sam2": {"loaded": true, "load_time_seconds": 2.3},
    "yolo": {"loaded": true, "load_time_seconds": 0.5},
    "yolo_pose": {"loaded": true, "load_time_seconds": 0.4},
    "tracknet": {"loaded": true, "load_time_seconds": 1.2}
  },
  "device": "cuda:0"
}
```

### Step 6: Test Ball Tracking
Back on your local machine, test with a video:
```bash
cd /Users/julianng-thow-hing/Desktop/ProVision/backend
python3 -c "
from src.engines.remote_run import RemoteEngineRunner
runner = RemoteEngineRunner()
# Test will be added
"
```

## Directory Structure on RunPod

```
/workspace/
├── checkpoints/                      # Model weights (persists)
│   ├── sam2.1_hiera_tiny.pt         # 149MB
│   ├── yolo11n.pt                    # 5.4MB
│   ├── yolo11n-pose.pt               # 6MB
│   └── tracknet_tennis.pt            # 41MB (you need to provide)
├── codes/
│   └── sam2/                         # SAM2 source code (persists)
└── provision/                        # ProVision server files (persists)
    ├── model_server.py               # FastAPI server
    ├── start_server.sh               # Startup script
    ├── setup_runpod.sh               # One-time setup
    ├── server.log                    # Server logs
    ├── tracknet/
    │   ├── model.py                  # TrackNet architecture
    │   └── utils.py                  # Postprocessing
    └── data/
        ├── videos/                   # Downloaded videos
        └── results/                  # Tracking results
```

## Model Server Endpoints

Once running on `localhost:8765`:

- **GET /health** - Server status + loaded models
- **POST /tracknet/track** - Bidirectional ball tracking
- **POST /yolo/detect** - Single-frame ball detection
- **POST /yolo/pose** - Multi-person pose detection  
- **POST /sam2/track** - SAM2 video segmentation
- **POST /sam2/preview** - Single-frame SAM2 preview

## Troubleshooting

### Server won't start
Check logs:
```bash
tail -f /workspace/provision/server.log
```

### "TrackNet checkpoint not found"
You need to upload your trained TrackNet model:
```bash
scp -i ~/.ssh/id_ed25519 -P <PORT> \
    /path/to/tracknet_tennis.pt \
    root@<IP>:/workspace/checkpoints/
```

### "CUDA not available"
Check GPU:
```bash
nvidia-smi
python3 -c "import torch; print(torch.cuda.is_available())"
```

### Connection refused from backend
Make sure:
1. Model server is running on port 8765
2. SSH connection is configured in backend/.env
3. Backend can SSH into RunPod

## After Pod Restart

RunPod pods lose running processes but keep `/workspace`. To restart:

1. SSH into pod
2. Run: `nohup /workspace/provision/start_server.sh > /workspace/provision/server.log 2>&1 &`
3. Verify: `curl http://localhost:8765/health`

Note: `ultralytics` pip package doesn't persist, but `start_server.sh` auto-installs it.

## Testing with Sample Video

Upload pigpong2.mov or any test video and try ball tracking:

```bash
# From your local machine
cd /Users/julianng-thow-hing/Desktop/ProVision
# Test script will be created
```

