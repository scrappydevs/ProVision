# Ball Tracking & Pose Data Storage Analysis

## Current System Overview

### ✅ What's Working

**Ball Tracking (TrackNet)**:
- **Storage**: `sessions.trajectory_data` (JSONB column)
- **Structure**:
  ```json
  {
    "frames": [
      {"frame": 0, "x": 100, "y": 200, "confidence": 0.95, "bbox": [x1,y1,x2,y2]},
      ...
    ],
    "velocity": [1.2, 3.4, ...],
    "spin_estimate": "topspin",
    "video_info": {"fps": 30, "total_frames": 300, "width": 1280, "height": 720}
  }
  ```
- **Backend**: `_run_tracknet_background()` stores data after processing
- **Frontend**: `useSession()` hook loads it automatically from session data
- **Status**: ✅ Data IS being stored and persisted
- **Caching**: TanStack Query caches for 60 seconds (staleTime)

**Pose Analysis (YOLO-Pose)**:
- **Storage**: `pose_analysis` table (separate table, NOT in sessions.pose_data)
- **Structure**:
  ```sql
  CREATE TABLE pose_analysis (
    id uuid PRIMARY KEY,
    session_id uuid REFERENCES sessions(id),
    frame_number integer,
    timestamp double precision,
    keypoints jsonb,           -- normalized 0-1 coordinates
    joint_angles jsonb,
    body_metrics jsonb,
    created_at timestamptz
  )
  ```
- **Backend**: `_run_pose_background()` stores rows in `pose_analysis` table
- **Frontend**: `usePoseAnalysis()` hook queries `/api/pose/analysis/{session_id}`
- **Status**: ✅ Data IS being stored in dedicated table
- **Caching**: TanStack Query caches for 5 minutes

### 🔴 Current Issues

1. **TrackNet Background Task Failing Silently**
   - Task is queued: `background_tasks.add_task(_run_tracknet_background, ...)`
   - BUT: No logs appear when it runs (task might be failing before logging)
   - **Root Cause**: Likely video upload to RunPod failing OR SSH connection issue
   - **Evidence**: DB shows some sessions have `traj_frame_count: null` (empty trajectory)

2. **Status Not Updated Correctly**
   - Sessions stuck in "processing" or "pending" state
   - No mechanism to show "tracking in progress" vs "ready to view"

3. **No Re-processing Prevention**
   - Frontend doesn't check if trajectory already exists before calling TrackNet
   - Each page load might trigger re-processing (waste of GPU time)

### 📊 Database State (from latest query)

```
| id       | name              | status      | traj_frames | pose_type |
|----------|-------------------|-------------|-------------|-----------|
| 44dd076a | wed (0s-30s)      | pending     | null        | object    |
| 338b4590 | sdas (0s-30s)     | failed      | 308         | object    |  ✅ Has data!
| c81fd432 | ewdewd (0s-9s)    | pending     | null        | object    |
| 20888b92 | herror (0s-20s)   | processing  | null        | object    |
| 0f0268d7 | herror (2s-20s)   | completed   | null        | object    |
```

**Key Observation**: Session `338b4590` has 308 trajectory frames stored! So storage DOES work when TrackNet succeeds.

---

## What Needs to Be Fixed

### Priority 1: Debug TrackNet Background Task
- [x] Add detailed logging to `_run_tracknet_background()`
- [ ] Test with a new video upload
- [ ] Check backend logs for the actual error
- [ ] Fix SSH/video transfer issue

### Priority 2: Prevent Re-processing
**Frontend** (`games/[id]/page.tsx`):
```typescript
// Current: Always calls TrackNet when clicking "Track" tab
if (tabId === "track" && !hasTrajectory) handleTrackNetTrack();

// Should be:
const hasTrajectory = session.trajectory_data?.frames?.length > 0;
if (tabId === "track" && !hasTrajectory) {
  // Only call if no existing data
  handleTrackNetTrack();
} else if (hasTrajectory) {
  // Load from session.trajectory_data (already cached)
  setTrajectoryPoints(session.trajectory_data.frames);
}
```

**Backend**: Already stores data correctly (no changes needed)

### Priority 3: Status Management
Add status checks:
- `pending` - video uploaded, waiting for processing
- `processing` - TrackNet/pose running
- `ready` - data available (has trajectory_data.frames.length > 0)
- `failed` - processing error

---

## Current Data Flow

### Upload → Processing
```
1. User uploads video
   ↓
2. POST /api/sessions (create session)
   ↓
3. background_tasks.add_task(_run_tracknet_background)
   background_tasks.add_task(_run_pose_background)
   ↓
4. TrackNet: processes video → stores trajectory_data
   Pose: processes frames → stores rows in pose_analysis table
   ↓
5. Updates session status to "ready"
```

### Loading Existing Data
```
1. User opens game viewer
   ↓
2. useSession(gameId) - TanStack Query hook
   ↓
3. GET /api/sessions/{id}
   ↓
4. Returns session with trajectory_data & pose_data
   ↓
5. Frontend renders from cached data
```

---

## Recommended Actions

1. **Immediate**: Restart backend and upload a test video to see the TrackNet error logs
2. **Add frontend check**: Don't re-run TrackNet if `trajectory_data.frames.length > 0`
3. **Fix backend**: Debug SSH/video transfer issue in `_ensure_video_on_gpu()`
4. **Add UI indicator**: Show "Processing..." when status is "processing"

---

**Last Updated**: 2026-02-06
**Status**: Analysis complete, awaiting test video upload for error logs
