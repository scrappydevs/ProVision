# Video Tips Overlay Implementation

## Overview
Implemented PlayVision AI-style live video tips that appear as the video plays, providing real-time insights about player performance, strokes, and game events.

## Architecture

### 1. Component Structure
```
<div> (video container - position: relative)
  <video> (base layer)
  <canvas> (trajectory overlay - z-index: 10)
  <canvas> (pose overlay - z-index: 20)
  <VideoTips> (tips overlay - z-index: 100)
</div>
```

### 2. Key Files

#### `/frontend/src/components/viewer/VideoTips.tsx`
**Purpose**: Renders liquid glass style tip overlays on top of video

**Key Features**:
- Time-based tip activation (shows tips at specific timestamps)
- Smooth fade-in animations with staggered delays
- Multiple tip types: `success`, `info`, `warning`, `highlight`
- Auto-dismiss after duration expires
- Prevents re-showing tips on rewind (one-time display)
- Reset tracking when video restarts from beginning

**Best Practices Implemented**:
1. **Proper Positioning Context**: 
   - Uses `position: absolute` with explicit `zIndex: 100`
   - Added `isolation: 'isolate'` to create new stacking context
   - Parent has `position: relative` to establish positioning reference

2. **Performance Optimization**:
   - `willChange: 'transform, opacity'` for smooth animations
   - `useCallback` to memoize update function
   - Efficient filtering of active tips

3. **Accessibility**:
   - `pointer-events-none` to allow video controls underneath
   - High contrast colors with backdrop blur
   - Clear visual hierarchy with icons

#### `/frontend/src/lib/tipGenerator.ts`
**Purpose**: Generates tip objects from stroke analysis data

**Tip Generation Logic**:
1. **Excellent Form (score > 80)**: Green success tip with checkmark
2. **Good Form (60-80)**: Blue info tip with specific improvement suggestions
3. **Needs Work (< 60)**: Yellow warning tip with general form advice
4. **Rally Events**: Bronze highlight tips for rally start/end
5. **Test Mode**: If no stroke data, generates test tips to verify overlay works

**Data Flow**:
```
Stroke Analysis → tipGenerator → VideoTip[] → VideoTips Component → DOM
```

### 3. Integration Points

#### In `/frontend/src/app/dashboard/games/[id]/page.tsx`

**Tip Generation** (lines 189-198):
```typescript
const videoTips = useMemo(() => {
  const tips = generateTipsFromStrokes(strokeSummary?.strokes || [], fps);
  console.log('[VideoTips] Generated tips:', { tipCount: tips.length });
  return tips;
}, [strokeSummary?.strokes, fps]);
```

**Component Usage** (lines 788-798):
```typescript
<div className="relative w-full h-full">
  <video ref={videoRef} />
  <canvas ref={canvasRef} style={{ zIndex: 10 }} />
  <canvas ref={playerCanvasRef} style={{ zIndex: 20 }} />
  
  <VideoTips
    currentTime={currentTime}
    tips={videoTips}
    isPlaying={isPlaying}
  />
</div>
```

## Z-Index Stacking Order (Bottom to Top)
1. **Video Element** (z-index: auto/0) - Base layer
2. **Ball Trajectory Canvas** (z-index: 10) - Tracks ball path
3. **Pose/Player Canvas** (z-index: 20) - Skeleton overlay
4. **UI Banners** (z-index: 30) - "Click to track" notifications
5. **VideoTips Overlay** (z-index: 100) - Highest layer for tips

## Styling & Design

### Glassmorphism Effect
- `backdrop-blur-xl` - Strong blur for readability
- Semi-transparent backgrounds (95% opacity)
- Subtle border with 60% opacity
- Large shadow with color-matched glow

### Color Scheme
- **Success**: Emerald green (`#10B981`)
- **Info**: Blue (`#3B82F6`)
- **Warning**: Amber (`#F59E0B`)
- **Highlight**: Bronze accent (`#9B7B5B`)

### Typography
- Title: 12px, semi-bold, white
- Message: 10px, 90% opacity, white
- Font: Inter (system default)

## Debugging

### Console Logs Added
1. **Tip Generation**: Logs when tips are created from strokes
2. **Props Updates**: Logs when VideoTips receives new data
3. **Tip Activation**: Logs when a tip enters active range
4. **Rendering**: Logs active tip count before render

### How to Debug
1. Open browser DevTools → Console
2. Play video and look for `[VideoTips]` logs
3. Check:
   - Are tips being generated? (should see tip count)
   - Are tips activating at correct timestamps?
   - Is component rendering?

### Common Issues & Fixes

**Issue**: Tips not appearing
- **Check 1**: Are tips being generated? (Console log should show tipCount > 0)
- **Check 2**: Is video playing? (Tips only update during playback)
- **Check 3**: Is currentTime reaching tip timestamps?
- **Fix**: Ensure stroke analysis is complete, or test tips will appear at 2s and 6s

**Issue**: Tips appear behind canvas
- **Check**: Canvas elements should have `style={{ zIndex: 10/20 }}`
- **Fix**: VideoTips uses `zIndex: 100` inline style + `isolation: isolate`

**Issue**: Tips not dismissing
- **Check**: Tip `duration` field
- **Fix**: Tips auto-dismiss when `currentTime > timestamp + duration`

## Future Enhancements

### Potential Improvements
1. **Interactive Tips**: Allow click-to-expand for detailed insights
2. **Tip Clustering**: Group multiple simultaneous tips to avoid clutter
3. **Customization**: User preferences for tip frequency/types
4. **AI-Generated Tips**: Use LLM to generate contextual coaching advice
5. **Sound Effects**: Optional audio cues for tip appearance
6. **Tip History**: Sidebar showing all tips from current session
7. **Export Tips**: Save tips as annotations for sharing

### Performance Optimizations
1. Use `IntersectionObserver` for viewport-based activation
2. Lazy load tip content for long videos
3. Virtual scrolling for tip history panel
4. WebWorker for tip generation from large datasets

## Testing Checklist

- [x] Tips appear at correct timestamps
- [x] Tips dismiss after duration
- [x] No re-showing on rewind
- [x] Reset works on video restart
- [x] Proper z-index layering
- [x] Test tips show when no stroke data
- [x] Smooth animations
- [x] Multiple concurrent tips display correctly
- [x] Console logs work for debugging
- [x] No performance impact on video playback

## References

### Research Sources
1. **MDN - CSS z-index**: Positioning and stacking context
2. **Stack Overflow**: React video overlay patterns
3. **Cloudinary Guides**: Video overlay best practices
4. **Remotion Docs**: Time-based layer composition
5. **PlayVision AI**: Inspiration for tip UI/UX design

### Key Design Principles
1. **Non-intrusive**: Tips don't block video content
2. **Contextual**: Tips appear at relevant moments
3. **Dismissible**: Auto-hide prevents clutter
4. **Accessible**: High contrast, clear messaging
5. **Performant**: Minimal re-renders, GPU-accelerated animations
