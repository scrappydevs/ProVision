# ProVision Analytics Plan: Graphical Trends & Performance Metrics

## Current Data Flow (Understanding)

### 1. Data Collection
**On Video Upload:**
- Backend automatically runs two background tasks:
  1. **TrackNet Ball Tracking** → Stores in `sessions.trajectory_data` (JSONB)
  2. **YOLO-Pose Analysis** → Stores in `pose_analysis` table (per-frame, every 3rd frame)

### 2. Data Structure

**Trajectory Data** (`sessions.trajectory_data`):
```typescript
{
  frames: TrajectoryPoint[]  // { frame, x, y, confidence, bbox }
  velocity: number[]          // px/frame velocity for each point
  spin_estimate: string       // "topspin", "backspin", "sidespin"
  video_info: { width, height, fps }
}
```

**Pose Data** (`pose_analysis` table):
```typescript
{
  session_id: string
  frame: number
  person_id: number
  keypoints: { name, x, y, conf }[]  // 17 COCO keypoints (normalized 0-1)
}
```

**Available Keypoints** (COCO 17-point skeleton):
- Head: nose, left_eye, right_eye, left_ear, right_ear
- Arms: left/right shoulder, elbow, wrist
- Torso: left/right hip
- Legs: left/right knee, ankle

### 3. Current Usage
- Ball trajectory overlaid on video in real-time
- Pose skeleton drawn on video
- Basic stats shown: frame count, avg speed, spin
- Bird's eye view (3D court visualization)

## Proposed Analytics Features

### Phase 1: Ball Performance Analytics 🏓

#### 1.1 Speed Analysis
**Metrics:**
- Max speed (px/frame → km/h conversion)
- Min speed
- Average speed
- Speed distribution histogram
- Speed over time line chart
- Speed zones: slow (0-30%), medium (30-70%), fast (70-100%)

**Charts:**
- Line chart: Speed vs Time
- Histogram: Speed distribution
- Heatmap: Speed zones on trajectory overlay

#### 1.2 Trajectory Analysis
**Metrics:**
- Total distance traveled
- Bounce count detection (y-position local minima)
- Arc height (max y - min y per segment)
- Direction changes (detect hits/rebounds)
- Rally length (frames between bounces)

**Charts:**
- 2D trajectory path with color gradient (speed)
- Bounce points marked
- Rally segments highlighted

#### 1.3 Spin Analysis
**Current:** String estimate ("topspin", "backspin", "sidespin")
**Enhanced:**
- Spin rate estimation (if possible from trajectory curvature)
- Spin type distribution pie chart
- Spin vs speed correlation

### Phase 2: Pose Performance Analytics 🤸

#### 2.1 Body Position Analysis
**Metrics:**
- Stance width (distance between feet)
- Body lean angle (torso relative to vertical)
- Arm extension (elbow to wrist distance)
- Knee bend angle
- Center of mass position (average of hip keypoints)

**Charts:**
- Time series: Stance width over time
- Time series: Arm extension over time
- Scatter: Arm extension vs ball speed

#### 2.2 Movement Analysis
**Metrics:**
- Player velocity (change in center of mass)
- Step frequency
- Reach distance (max arm extension)
- Balance score (COM deviation from base)

**Charts:**
- Velocity heatmap (player movement speed)
- Step frequency timeline
- Movement patterns visualization

#### 2.3 Contact Point Analysis
**Metrics:**
- Racket contact height (wrist y-position at ball contact)
- Contact point relative to body (wrist x-distance from COM)
- Follow-through distance (wrist travel after contact)
- Ready position timing (time between shot and return to ready)

**Charts:**
- Scatter: Contact height vs ball speed
- Contact point distribution (forehand/backhand zones)

### Phase 3: Correlation Analytics 📊

#### 3.1 Performance Correlations
- Ball speed vs player stance width
- Ball spin vs arm extension
- Rally length vs player movement speed
- Contact point vs shot outcome

#### 3.2 Temporal Analysis
- Performance progression over video duration
- Fatigue indicators (speed/accuracy decline)
- Hot/cold zones (best/worst performance periods)

## Implementation Architecture

### Backend: Analytics Computation Service

**New Endpoint:** `GET /api/sessions/{id}/analytics`

Response:
```typescript
{
  ball_analytics: {
    speed: { max, min, avg, distribution, timeline },
    trajectory: { distance, bounces, arc_heights, rallies },
    spin: { distribution, correlation_with_speed }
  },
  pose_analytics: {
    stance: { avg_width, timeline },
    movement: { avg_velocity, step_freq, reach },
    contact: { heights, positions, follow_through }
  },
  correlations: {
    speed_vs_stance: { correlation, scatter_data },
    speed_vs_extension: { correlation, scatter_data }
  }
}
```

### Frontend: Analytics Dashboard Component

**New Tab:** "Analytics" (alongside Pose, Track, Players, Court, AI)

**Layout:**
```
┌─────────────────────────────────────┐
│ Analytics Dashboard                  │
├─────────────────────────────────────┤
│ Filter: [All] [Forehand] [Backhand] │
├─────────────────────────────────────┤
│ ┌─────────────┐ ┌─────────────┐    │
│ │ Speed Chart │ │ Trajectory  │    │
│ └─────────────┘ └─────────────┘    │
│ ┌─────────────┐ ┌─────────────┐    │
│ │ Pose Metrics│ │ Correlations│    │
│ └─────────────┘ └─────────────┘    │
└─────────────────────────────────────┘
```

**Charting Library:** Recharts (already compatible with Next.js/React)

## Implementation Steps

### Step 1: Backend Analytics Service
1. Create `/backend/src/services/analytics_service.py`
2. Functions:
   - `compute_ball_analytics(trajectory_data)`
   - `compute_pose_analytics(pose_data, fps)`
   - `compute_correlations(trajectory, pose)`
3. Add route `GET /api/sessions/{id}/analytics`

### Step 2: Frontend Analytics Component
1. Create `/frontend/src/components/analytics/AnalyticsDashboard.tsx`
2. Sub-components:
   - `SpeedChart.tsx` (line + histogram)
   - `TrajectoryAnalysis.tsx` (2D path with metrics)
   - `PoseMetrics.tsx` (body position timelines)
   - `CorrelationCharts.tsx` (scatter plots)
3. Add "Analytics" tab to game viewer

### Step 3: Chart Components
1. Install: `pnpm add recharts`
2. Create reusable chart components:
   - `LineChart.tsx`
   - `Histogram.tsx`
   - `ScatterPlot.tsx`
   - `Heatmap.tsx`

### Step 4: Data Fetching Hook
1. Create `/frontend/src/hooks/useAnalytics.ts`
2. Fetch and cache analytics data
3. Provide loading/error states

## Success Metrics

- [ ] Ball speed visualized with timeline
- [ ] Bounce detection and rally segmentation
- [ ] Pose metrics computed (stance, reach, etc.)
- [ ] Correlation charts (speed vs stance, etc.)
- [ ] Analytics tab functional in game viewer
- [ ] Export analytics as PDF/JSON (future)

## Design Mockup

```
╔═══════════════════════════════════════════╗
║ Speed Analysis                     🏓     ║
╠═══════════════════════════════════════════╣
║ Max: 85 km/h  Avg: 42 km/h  Min: 12 km/h ║
║                                           ║
║  Speed (km/h)                            ║
║   80 ┤    ╭╮                             ║
║   60 ┤   ╭╯╰╮  ╭╮                        ║
║   40 ┤  ╭╯  ╰╮╭╯╰╮                       ║
║   20 ┤╭╯     ╰╯  ╰╮                      ║
║    0 └──────────────────> Time           ║
║                                           ║
║ Distribution:                             ║
║ █████████ Slow (0-30%)                   ║
║ ██████████████ Medium (30-70%)           ║
║ ███████ Fast (70-100%)                   ║
╚═══════════════════════════════════════════╝
```

