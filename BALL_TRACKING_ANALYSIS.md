# Ball Tracking Deep Dive Analysis

## Current Setup: Auto-Tracking on Video Upload

### ✅ What's Already Working

**When you upload a video**, the backend automatically:

1. **Creates session** (`POST /api/sessions`)
2. **Queues background tasks** (lines 211-220 in `sessions.py`):
   ```python
   background_tasks.add_task(_run_tracknet_background, session_id, video_url)
   background_tasks.add_task(_run_pose_background, session_id, video_url)
   ```
3. **TrackNet runs automatically** in the background
4. **Results saved to DB** (`sessions.trajectory_data`)

### 🔴 Why You're Not Seeing Results

**The background task is failing silently!** I added logging earlier but need to see the actual error when you upload a video.

**Most likely causes:**
1. Video not uploading to RunPod (SSH/SCP issue)
2. Model server connection issue
3. Video format not supported

---

## TrackNet Bidirectional Implementation

### Current Pipeline (on RunPod)

Located in `/workspace/provision/model_server.py`:

```python
@app.post("/tracknet/track")
async def tracknet_track(request: SAM2TrackRequest):
    """Track ball through entire video using bidirectional TrackNet + YOLO recovery.
    
    Pipeline:
    1. Forward TrackNet pass (frame 2 → end)
    2. Backward TrackNet pass (end → frame 2), reversed back
    3. Merge: higher confidence wins, gaps filled from either direction
    4. Outlier removal + segment splitting + physics-aware bridging + interpolation
    5. YOLO recovery: fill remaining gaps with YOLO ball detection
    """
```

### Bidirectional Process

**Pass 1: Forward** (frame 2 → end)
- Processes frames in normal order
- Detects ball positions with confidence scores

**Pass 2: Backward** (end → frame 2)
- Reverses frame order
- Runs TrackNet again
- Reverses results back to normal order

**Merge Strategy**:
- If both passes detect ball → pick higher confidence
- If only one pass detects → use that detection
- Result: More complete trajectory, fewer gaps

### Performance Impact

**Pros:**
- ✅ Fills more gaps (bidirectional context)
- ✅ Better for occluded balls
- ✅ Smoother trajectories

**Cons:**
- ❌ **2x processing time** (runs model twice)
- ❌ **2x GPU memory usage**
- ❌ May not help much for clear videos

---

## Recommendation: Remove Bidirectional

### Why Remove It?

1. **Performance**: Current videos take ~2x longer to process
2. **Diminishing returns**: For clear table tennis videos, forward pass usually sufficient
3. **Simpler pipeline**: Easier to debug, faster iteration
4. **YOLO recovery**: Already have gap-filling with YOLO detection

### What to Keep

- ✅ Forward TrackNet pass
- ✅ Outlier removal
- ✅ Segment splitting
- ✅ Physics-aware bridging
- ✅ Interpolation
- ✅ YOLO gap recovery

### Expected Result

- **50% faster tracking** (single pass instead of double)
- **Same or slightly lower quality** (but YOLO recovery compensates)
- **Cleaner code** (remove backward pass logic)

---

## Action Plan

### 1. Upload Test Video & Check Logs

First, let's see the actual error:
```bash
# Backend logs will show TrackNet failure
tail -f /tmp/provision_backend.log | grep TrackNet
```

### 2. Remove Bidirectional from RunPod

SSH into RunPod and modify `/workspace/provision/model_server.py`:

**Before** (current):
```python
# Forward pass
fwd_track, fwd_conf, fwd_dists = _run_tracknet_pass(frames, ...)

# Backward pass
bwd_track, bwd_conf, bwd_dists = _run_tracknet_pass(frames[::-1], ...)
bwd_track.reverse()

# Merge both
ball_track = merge_passes(fwd_track, bwd_track, fwd_conf, bwd_conf)
```

**After** (simplified):
```python
# Single forward pass
ball_track, conf_track, dists = _run_tracknet_pass(frames, ...)
# Skip backward pass entirely
# Continue with post-processing
```

### 3. Test Changes

Upload a video and verify:
- ✅ Tracking completes faster
- ✅ Trajectory data saved to DB
- ✅ Results load in frontend

---

## Files to Modify

### On RunPod (SSH required)
- `/workspace/provision/model_server.py` - Remove backward pass

### No Backend Changes Needed
- Auto-tracking already set up ✅
- Just need to fix SSH/video upload issue

---

**Status**: Ready to upload test video and see error logs
**Next Step**: Upload a video, check logs, then remove bidirectional
