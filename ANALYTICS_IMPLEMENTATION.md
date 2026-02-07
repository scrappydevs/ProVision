# ProVision Analytics Implementation Plan

## Understanding: Current Data Flow

### Data Sources
1. **Ball Trajectory** (`sessions.trajectory_data` JSONB):
   - Frame-by-frame ball position (x, y)
   - Per-frame velocity array
   - Spin estimate (topspin/backspin/sidespin)
   - 98.4% detection rate from bidirectional TrackNet

2. **Pose Data** (`pose_analysis` table):
   - 17 COCO keypoints per person per frame (every 3rd frame)
   - 8 calculated joint angles (elbows, shoulders, knees, hips)
   - 5 body metrics (hip rotation, shoulder rotation, spine lean, COM, height)
   - Already aggregated via `/api/pose/summary/{session_id}`

### Current Analytics
✅ Basic ball stats (frame count, avg speed, spin)
✅ Joint angle aggregates (avg/min/max)
✅ Body metrics aggregates
✅ Stroke classification (forehand/backhand)
❌ **Missing: Time-series visualizations**
❌ **Missing: Distribution charts**
❌ **Missing: Correlation analysis**

---

## Implementation Plan

### Phase 1: Backend Analytics API ⚙️
**Goal**: Create comprehensive analytics computation endpoint

**File**: `/backend/src/api/routes/analytics.py` (NEW)

**Endpoint**: `GET /api/analytics/{session_id}`

**Computations**:

#### Ball Analytics
1. **Speed Analysis**:
   - Convert px/frame to km/h using fps and court dimensions
   - Speed timeline (frame → speed)
   - Speed distribution buckets
   - Max/min/avg/median/stddev

2. **Trajectory Analysis**:
   - Total distance traveled
   - Bounce detection (y-position local minima where velocity reverses)
   - Rally segmentation (bounce to bounce)
   - Arc heights per rally
   - Direction changes (x-velocity sign changes = side switches)

3. **Spin Correlation**:
   - Spin type distribution
   - Average speed per spin type

#### Pose Analytics
1. **Movement Analysis**:
   - Player velocity timeline (COM movement)
   - Stance width timeline (ankle distance)
   - Arm extension timeline (shoulder-wrist distance)

2. **Contact Analysis**:
   - Detect ball contact moments (ball within 50px of wrist)
   - Contact height distribution
   - Arm angle at contact

3. **Correlations**:
   - Ball speed vs stance width
   - Ball speed vs arm extension
   - Ball speed vs body lean

### Phase 2: Frontend Analytics Tab 📊
**Goal**: Add "Analytics" tab with interactive charts

**Component**: `/frontend/src/components/analytics/AnalyticsDashboard.tsx` (NEW)

**Dependencies**: Install Recharts
```bash
pnpm add recharts
```

**Layout**:
```tsx
<div className="analytics-dashboard p-6 space-y-6">
  {/* Ball Analytics */}
  <SpeedAnalysis data={analytics.ball.speed} />
  <TrajectoryAnalysis data={analytics.ball.trajectory} />
  
  {/* Pose Analytics */}
  <MovementAnalysis data={analytics.pose.movement} />
  <ContactAnalysis data={analytics.pose.contact} />
  
  {/* Correlations */}
  <CorrelationGrid data={analytics.correlations} />
</div>
```

**Sub-Components**:
1. `SpeedAnalysis.tsx` - Line chart + histogram + stats cards
2. `TrajectoryAnalysis.tsx` - Rally timeline + bounce markers
3. `MovementAnalysis.tsx` - Multi-line chart (stance, velocity, extension)
4. `ContactAnalysis.tsx` - Scatter plot (contact height vs speed)
5. `CorrelationGrid.tsx` - Multiple scatter plots in grid

### Phase 3: Integration 🔌
1. Add "Analytics" tab to game viewer toolbar
2. Create `useAnalytics(sessionId)` hook
3. Wire up analytics panel in game viewer page
4. Add loading/error states

---

## Detailed Implementation Steps

### Step 1: Install Recharts ✓
```bash
cd frontend && pnpm add recharts
```

### Step 2: Backend Analytics Service ✓
1. Create `/backend/src/services/analytics_service.py`
2. Implement computation functions
3. Create analytics route

### Step 3: Frontend Analytics Components ✓
1. Create analytics components directory
2. Build chart components using Recharts
3. Create analytics dashboard layout

### Step 4: Integration ✓
1. Add Analytics tab to game viewer
2. Create hook for data fetching
3. Wire up in game viewer page

---

## Design Specifications

### Color Palette (Match ProVision Theme)
- Primary: `#9B7B5B` (bronze)
- Success: `#6B8E6B` (green)
- Info: `#7B8ECE` (blue)
- Warning: `#CE9B7B` (orange)
- Danger: `#C45C5C` (red)
- Background: `#1E1D1F` (dark) / adaptive for light mode
- Text: `#E8E6E3` (light) / adaptive for light mode

### Chart Styling
- Glass morphism cards with `backdrop-blur-xl`
- Smooth animations on load
- Responsive tooltips
- Bronze accent lines for primary metrics
- Grid lines with low opacity

---

## Expected Output

### Analytics Tab Structure
```
┌──────────────────────────────────────────┐
│ Analytics                    [Export]    │
├──────────────────────────────────────────┤
│ ┌────────────────────────────────────┐  │
│ │ 🏓 Ball Performance                │  │
│ │ ├─ Speed Timeline (line chart)     │  │
│ │ ├─ Speed Distribution (histogram)  │  │
│ │ └─ Rally Analysis (segments)       │  │
│ └────────────────────────────────────┘  │
│                                          │
│ ┌────────────────────────────────────┐  │
│ │ 🤸 Movement & Technique            │  │
│ │ ├─ Stance Width Over Time          │  │
│ │ ├─ Arm Extension Timeline          │  │
│ │ └─ Body Lean Analysis              │  │
│ └────────────────────────────────────┘  │
│                                          │
│ ┌────────────────────────────────────┐  │
│ │ 📈 Performance Correlations        │  │
│ │ ├─ Speed vs Stance (scatter)       │  │
│ │ ├─ Speed vs Extension (scatter)    │  │
│ │ └─ Technique Score                 │  │
│ └────────────────────────────────────┘  │
└──────────────────────────────────────────┘
```

---

## Next: Begin Implementation

Ready to implement? I'll:
1. Install Recharts
2. Create analytics service (backend)
3. Create analytics components (frontend)
4. Add analytics tab to game viewer
5. Test with sample video

