# TTNet Setup for ProVision

## Overview

TTNet (CVPR 2020) is a table-tennis-specific neural network that performs:
- **Ball detection** (global + local refinement stages)
- **Event spotting** (bounce/net detection)
- **Semantic segmentation** (players, table, scoreboard)

It achieves **<4px RMSE** for ball detection at **>130 FPS** on Full HD video.

**Why TTNet > TrackNet:**
- TrackNet was trained on tennis balls (large, bright yellow, ~20-30px)
- TTNet was trained on table tennis balls (small, white/orange, ~3-8px)
- TTNet uses 9-frame temporal context with two-stage refinement
- TTNet is designed for the exact use case: table tennis rally tracking

## Status

✅ **Completed:**
- Code integrated into `backend/gpu_scripts/model_server.py`
- `/ttnet/track` endpoint added (drop-in compatible with TrackNet output format)
- Backend service updated to prefer TTNet over TrackNet
- TTNet repo cloned on RunPod: `/workspace/provision/ttnet`
- OpenTTGames dataset downloaded (1.7GB)
- Image extraction in progress (8,246+ images extracted)

🔄 **In Progress (on RunPod GPU):**
- Extracting training frames from videos
- Process: `python extract_selected_images.py && python extract_smooth_labellings.py`
- Status: Running for ~18 minutes, 8,246 images extracted

⏳ **Next Steps:**
1. Wait for image extraction to complete (~30-45 min total)
2. Train TTNet (3-phase strategy, ~90 epochs total, 3-6 hours)
3. Deploy trained weights to `/workspace/checkpoints/ttnet_3rd_phase.pth`
4. Restart model server with TTNet enabled

## Architecture

```
Input: 9 consecutive frames (1920x1080 downsampled to 320x128)
       ↓
[Global Stage] → Coarse ball position heatmap (320x128)
       ↓
[Local Stage] → Crop around predicted position → Refined heatmap
       ↓
[Event Spotting] → Bounce/Net classification
       ↓
[Segmentation] → Pixel-wise player/table/scoreboard masks
```

## Training Process

TTNet uses a 3-phase training strategy:

### Phase 1: Global + Segmentation (30 epochs)
Train the foundation modules first since ball detection quality determines everything.

```bash
cd /workspace/provision/ttnet/src
python main.py --gpu_idx 0 --num_epochs 30 --no_local --no_event --saved_fn ttnet_1st_phase
```

### Phase 2: Local + Event (30 epochs)
Load global weights, initialize local weights from global, train local+event while freezing global.

```bash
python main.py --gpu_idx 0 --num_epochs 30 --freeze_global --freeze_seg \
  --pretrained_path ../logs/ttnet_1st_phase/checkpoints/Model_ttnet_1st_phase_epoch_30.pth \
  --overwrite_global_2_local --saved_fn ttnet_2nd_phase
```

### Phase 3: Full Fine-tune (30 epochs)
Train all modules together end-to-end.

```bash
python main.py --gpu_idx 0 --num_epochs 30 \
  --pretrained_path ../logs/ttnet_2nd_phase/checkpoints/Model_ttnet_2nd_phase_epoch_30.pth \
  --saved_fn ttnet_3rd_phase
```

## Deployment

After training, copy the final checkpoint:

```bash
cp /workspace/provision/ttnet/logs/ttnet_3rd_phase/checkpoints/Model_ttnet_3rd_phase_epoch_30.pth \
   /workspace/checkpoints/ttnet_3rd_phase.pth
```

Then restart the model server with TTNet enabled:

```bash
# Kill existing server
pkill -f model_server.py

# Start with TTNet
cd /workspace/provision
python3 model_server.py --port 8765 --models sam2,yolo,tracknet,ttnet
```

## API Usage

The `/ttnet/track` endpoint uses the same request/response format as `/tracknet/track`:

**Request:**
```json
{
  "session_id": "uuid",
  "video_path": "/workspace/provision/data/videos/uuid.mp4",
  "frame": 0
}
```

**Response:**
```json
{
  "status": "completed",
  "trajectory": [
    {"frame": 0, "x": 640.5, "y": 300.2, "confidence": 0.89, "bbox": [630, 290, 650, 310]},
    ...
  ],
  "total_frames": 500,
  "tracked_frames": 487,
  "video_info": {"width": 1280, "height": 720, "fps": 30.0}
}
```

## Backend Integration

The backend service (`sam2_service.py`) automatically tries TTNet first:

```python
# 1. Try TTNet (table tennis specific)
result = self.runner._call_model_server("/ttnet/track", {...})

# 2. Fallback to TrackNet (bidirectional + YOLO recovery)
result = self.runner._call_model_server("/tracknet/track", {...})
```

This happens transparently - no frontend changes needed.

## Dataset: OpenTTGames

- **Source:** https://lab.osai.ai (CC BY-NC-SA 4.0)
- **Size:** 5 training videos (10-25 min each) + 7 test videos
- **FPS:** 120 fps (industrial camera)
- **Annotations:** 4,271 events, frame-by-frame ball coordinates, segmentation masks
- **Downloaded to:** `/workspace/provision/ttnet/dataset`

## Expected Performance

Based on TTNet paper and author's implementation:
- **Ball Detection RMSE:** <4 pixels (Full HD resolution)
- **Event Detection PCE:** ~97% (percentage of correct events)
- **Segmentation IoU:** ~0.96
- **Inference Speed:** >130 FPS on A100 GPU

For ProVision's use case (ball tracking only):
- Expected detection rate: >95% of frames (vs ~70-80% for TrackNet on ping pong)
- Much better handling of small, fast-moving white balls
- Event spotting bonus: automatic bounce detection

## References

- **Paper:** TTNet: Real-time temporal and spatial video analysis of table tennis (CVPR 2020)
- **Repo:** https://github.com/maudzung/TTNet-Real-time-Analysis-System-for-Table-Tennis-Pytorch
- **Dataset:** https://lab.osai.ai
