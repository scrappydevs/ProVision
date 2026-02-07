"use client";

import { useState, useRef, useMemo, useCallback, useEffect, Suspense } from "react";
import { Canvas, useFrame, useThree, ThreeEvent } from "@react-three/fiber";
import { OrbitControls, Line } from "@react-three/drei";
import * as THREE from "three";
import { TrajectoryData, TrajectoryPoint } from "@/lib/api";
import { PoseAnalysisData } from "@/hooks/usePoseData";

interface BirdEyeViewProps {
  trajectoryData?: TrajectoryData;
  poseData?: PoseAnalysisData;
  currentFrame: number;
  totalFrames: number;
  isPlaying: boolean;
}

type PhysicsMode = "replay" | "predict" | "whatif" | "heatmap";
type CameraPreset = "default" | "top" | "side" | "end" | "player";

const TABLE_W = 2.74;
const TABLE_D = 1.525;
const TABLE_H = 0.76;
const TABLE_THICK = 0.03;
const NET_H = 0.1525;
const LEG_SIZE = 0.06;
const SURFACE_Y = TABLE_H + TABLE_THICK / 2;
const GRAVITY = 9.81;
const RESTITUTION = 0.85;

// Camera preset positions: [position, target]
const CAMERA_PRESETS: Record<CameraPreset, { pos: [number, number, number]; label: string }> = {
  default: { pos: [2.6, 2.6, 2.6], label: "3D" },
  top:     { pos: [0, 4.5, 0.01], label: "Top" },
  side:    { pos: [0, 1.4, 4.0], label: "Side" },
  end:     { pos: [4.5, 1.8, 0], label: "End" },
  player:  { pos: [-3.5, 1.5, 0], label: "Player" },
};

function Table({ onClick }: { onClick?: (point: THREE.Vector3) => void }) {
  const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    if (onClick) {
      e.stopPropagation();
      onClick(e.point);
    }
  }, [onClick]);

  return (
    <group>
      <mesh position={[0, TABLE_H, 0]} castShadow receiveShadow onClick={handleClick}>
        <boxGeometry args={[TABLE_W, TABLE_THICK, TABLE_D]} />
        <meshStandardMaterial color="#1B3A5C" roughness={0.3} metalness={0.1} />
      </mesh>
      {/* Boundary lines */}
      {[[0, TABLE_D / 2], [0, -TABLE_D / 2]].map(([x, z], i) => (
        <mesh key={`long-${i}`} position={[x, SURFACE_Y + 0.001, z]}>
          <planeGeometry args={[TABLE_W, 0.02]} />
          <meshBasicMaterial color="white" transparent opacity={0.9} />
        </mesh>
      ))}
      {[[TABLE_W / 2, 0], [-TABLE_W / 2, 0]].map(([x, z], i) => (
        <mesh key={`short-${i}`} position={[x, SURFACE_Y + 0.001, z]} rotation={[0, Math.PI / 2, 0]}>
          <planeGeometry args={[TABLE_D, 0.02]} />
          <meshBasicMaterial color="white" transparent opacity={0.9} />
        </mesh>
      ))}
      <mesh position={[0, SURFACE_Y + 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[TABLE_W, 0.01]} />
        <meshBasicMaterial color="white" transparent opacity={0.4} />
      </mesh>
      {/* Net */}
      <mesh position={[0, SURFACE_Y + NET_H / 2, 0]}>
        <boxGeometry args={[0.01, NET_H, TABLE_D + 0.15]} />
        <meshStandardMaterial color="#E8E6E3" transparent opacity={0.4} roughness={0.8} side={THREE.DoubleSide} />
      </mesh>
      {[1, -1].map((s, i) => (
        <mesh key={`post-${i}`} position={[0, SURFACE_Y + NET_H / 2, s * (TABLE_D + 0.15) / 2]}>
          <cylinderGeometry args={[0.012, 0.012, NET_H, 8]} />
          <meshStandardMaterial color="#666" metalness={0.6} roughness={0.3} />
        </mesh>
      ))}
      {/* Legs */}
      {[[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([sx, sz], i) => (
        <mesh key={`leg-${i}`} position={[sx * (TABLE_W / 2 - 0.1), TABLE_H / 2, sz * (TABLE_D / 2 - 0.08)]}>
          <boxGeometry args={[LEG_SIZE, TABLE_H, LEG_SIZE]} />
          <meshStandardMaterial color="#333" roughness={0.5} />
        </mesh>
      ))}
      {/* Floor */}
      <mesh position={[0, -0.01, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[8, 5]} />
        <meshStandardMaterial color="#1E1D1F" roughness={0.9} />
      </mesh>
    </group>
  );
}

// ============================================================================
// Step 1: Pixel-space noise filter
// ============================================================================

interface FilteredPoint {
  frame: number;
  x: number;
  y: number;
  confidence: number;
  isToss: boolean; // serve toss frames rendered differently
}

/**
 * Filter raw trajectory points in pixel space BEFORE any 3D mapping.
 *
 * - Median filter: if a point jumps far from both predecessor AND successor, remove it.
 * - Velocity continuity: sharp direction reversals that snap back are noise.
 * - Serve toss: nearly-vertical ball movement in a tight X range is flagged.
 */
function filterTrajectoryNoise(raw: TrajectoryPoint[]): FilteredPoint[] {
  if (raw.length < 3) return raw.map(f => ({ ...f, isToss: false }));

  const JUMP_THRESH = 80; // pixels — if dist to BOTH neighbors exceeds this, it's noise
  const sorted = [...raw].sort((a, b) => a.frame - b.frame);

  // Pass 1: median filter — remove isolated spikes
  const pass1: (TrajectoryPoint & { keep: boolean })[] = sorted.map((p, i) => {
    if (i === 0 || i === sorted.length - 1) return { ...p, keep: true };
    const prev = sorted[i - 1];
    const next = sorted[i + 1];
    const prevGap = p.frame - prev.frame;
    const nextGap = next.frame - p.frame;
    // Only apply to close frames (gap <= 3)
    if (prevGap > 3 || nextGap > 3) return { ...p, keep: true };
    const distPrev = Math.sqrt((p.x - prev.x) ** 2 + (p.y - prev.y) ** 2);
    const distNext = Math.sqrt((p.x - next.x) ** 2 + (p.y - next.y) ** 2);
    // Isolated spike: far from both neighbors
    if (distPrev > JUMP_THRESH && distNext > JUMP_THRESH) return { ...p, keep: false };
    return { ...p, keep: true };
  });

  const kept = pass1.filter(p => p.keep);

  // Pass 2: velocity continuity — remove points where direction reverses >120° and snaps back
  const pass2: (TrajectoryPoint & { keep: boolean })[] = kept.map((p, i) => {
    if (i < 2 || i >= kept.length - 1) return { ...p, keep: true };
    const pp = kept[i - 1];
    const ppp = kept[i - 2];
    const np = kept[i + 1];
    // Trend direction from previous 2 points
    const trendDx = pp.x - ppp.x;
    const trendDy = pp.y - ppp.y;
    const trendLen = Math.sqrt(trendDx * trendDx + trendDy * trendDy);
    if (trendLen < 3) return { ...p, keep: true }; // too slow to judge
    // Current direction
    const curDx = p.x - pp.x;
    const curDy = p.y - pp.y;
    const curLen = Math.sqrt(curDx * curDx + curDy * curDy);
    if (curLen < 3) return { ...p, keep: true };
    // Dot product for angle
    const dot = (trendDx * curDx + trendDy * curDy) / (trendLen * curLen);
    if (dot < -0.5) {
      // Sharp reversal — check if NEXT point also reverses back (snap-back noise)
      const nextDx = np.x - p.x;
      const nextDy = np.y - p.y;
      const nextLen = Math.sqrt(nextDx * nextDx + nextDy * nextDy);
      if (nextLen > 3) {
        const dot2 = (curDx * nextDx + curDy * nextDy) / (curLen * nextLen);
        if (dot2 < -0.3) return { ...p, keep: false }; // snap back = noise
      }
    }
    return { ...p, keep: true };
  });

  const clean = pass2.filter(p => p.keep);

  // Pass 3: detect serve toss sequences
  const result: FilteredPoint[] = clean.map((p, i) => {
    let isToss = false;
    if (i >= 2 && i < clean.length - 2) {
      // A toss is: ball moves mostly vertically (small dX, large dY upward)
      // in a tight horizontal band over ~5+ consecutive frames
      const window = clean.slice(Math.max(0, i - 3), Math.min(clean.length, i + 4));
      const xRange = Math.max(...window.map(w => w.x)) - Math.min(...window.map(w => w.x));
      const yRange = Math.max(...window.map(w => w.y)) - Math.min(...window.map(w => w.y));
      // Toss: X range < 40px but Y range > 60px (mostly vertical movement)
      if (xRange < 40 && yRange > 60) isToss = true;
    }
    return { frame: p.frame, x: p.x, y: p.y, confidence: p.confidence, isToss };
  });

  return result;
}

// ============================================================================
// Step 2: Detect events (bounces, hits, toss peaks)
// ============================================================================

interface TrajectoryEvent {
  frame: number;
  index: number; // index into filtered points array
  type: "bounce" | "hit" | "toss_peak";
}

/**
 * Detect bounces (Y-velocity reversal / local Y maxima in video coords),
 * hits (X-direction changes), and toss peaks from filtered pixel data.
 */
function detectEvents(points: FilteredPoint[]): TrajectoryEvent[] {
  if (points.length < 5) return [];
  const events: TrajectoryEvent[] = [];

  for (let i = 2; i < points.length - 2; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const next = points[i + 1];
    const gap1 = cur.frame - prev.frame;
    const gap2 = next.frame - cur.frame;
    if (gap1 > 5 || gap2 > 5) continue; // too big a gap to judge

    // Bounce: local maximum in video-Y (ball at lowest physical point = table)
    // In video coords, Y increases downward, so a bounce is a local max in Y.
    if (cur.y > prev.y && cur.y > next.y && (cur.y - prev.y) > 3 && (cur.y - next.y) > 3) {
      events.push({ frame: cur.frame, index: i, type: "bounce" });
      continue;
    }

    // Hit / direction change: X-velocity reverses sign with significant magnitude
    const dxPrev = cur.x - prev.x;
    const dxNext = next.x - cur.x;
    if ((dxPrev > 15 && dxNext < -15) || (dxPrev < -15 && dxNext > 15)) {
      events.push({ frame: cur.frame, index: i, type: "hit" });
      continue;
    }

    // Toss peak: local minimum in video-Y (ball at highest physical point) during a toss
    if (cur.isToss && cur.y < prev.y && cur.y < next.y) {
      events.push({ frame: cur.frame, index: i, type: "toss_peak" });
    }
  }

  return events;
}

// ============================================================================
// Step 3 & 4: Segment into arcs and fit smooth curves
// ============================================================================

interface ArcSegment {
  points: FilteredPoint[];
  isToss: boolean;
  /** Whether the arc crosses the net (X=0 in 3D) and clears it */
  netCrossing: "clears" | "clips" | "none";
}

/**
 * Segment filtered trajectory into arcs between events, then generate
 * smooth CatmullRom curves in 3D for each arc.
 */
function segmentIntoArcs(points: FilteredPoint[], events: TrajectoryEvent[]): ArcSegment[] {
  if (points.length < 2) return [];

  // Build cut indices from events
  const cutIndices = events.map(e => e.index).sort((a, b) => a - b);
  // Add boundaries
  const boundaries = [0, ...cutIndices, points.length - 1];
  // Deduplicate and sort
  const unique = [...new Set(boundaries)].sort((a, b) => a - b);

  const arcs: ArcSegment[] = [];
  for (let i = 0; i < unique.length - 1; i++) {
    const start = unique[i];
    const end = unique[i + 1];
    if (end - start < 1) continue;
    const slice = points.slice(start, end + 1);
    const isToss = slice.filter(p => p.isToss).length > slice.length * 0.5;
    arcs.push({ points: slice, isToss, netCrossing: "none" });
  }

  return arcs;
}

// ============================================================================
// Step 5: Wider scale mapping (IQR-based)
// ============================================================================

interface TrajectoryBounds {
  /** IQR anchors for X: P25 and P75 map to table edges */
  xP25: number; xP75: number;
  /** IQR anchors for Y */
  yP25: number; yP75: number;
  /** Full range for baseline computation */
  minX: number; maxX: number;
  minY: number; maxY: number;
  /** Per-bucket baseline Y */
  baselineByBucket: number[];
  bucketCount: number;
}

/**
 * Compute IQR-based bounds. The P25-P75 range of X maps to the table width.
 * Points outside this range naturally extend far beyond the table.
 */
function computeTrajectoryBounds(frames: FilteredPoint[]): TrajectoryBounds {
  const BUCKETS = 16;
  const xs = frames.map(f => f.x).sort((a, b) => a - b);
  const ys = frames.map(f => f.y).sort((a, b) => a - b);

  const minX = xs[0], maxX = xs[xs.length - 1];
  const minY = ys[0], maxY = ys[ys.length - 1];
  const xP25 = xs[Math.floor(xs.length * 0.25)];
  const xP75 = xs[Math.floor(xs.length * 0.75)];
  const yP25 = ys[Math.floor(ys.length * 0.25)];
  const yP75 = ys[Math.floor(ys.length * 0.75)];

  const rangeX = maxX - minX || 1;

  // Per-bucket baseline (90th percentile of Y in each X slice)
  const bucketValues: number[][] = Array.from({ length: BUCKETS }, () => []);
  for (const f of frames) {
    const bIdx = Math.min(BUCKETS - 1, Math.max(0, Math.floor(((f.x - minX) / rangeX) * BUCKETS)));
    bucketValues[bIdx].push(f.y);
  }
  const baselineByBucket: number[] = [];
  let lastGood = maxY;
  for (let i = 0; i < BUCKETS; i++) {
    const vals = bucketValues[i];
    if (vals.length >= 2) {
      vals.sort((a, b) => a - b);
      lastGood = vals[Math.floor(vals.length * 0.9)];
    }
    baselineByBucket.push(lastGood);
  }

  return { xP25, xP75, yP25, yP75, minX, maxX, minY, maxY, baselineByBucket, bucketCount: BUCKETS };
}

/**
 * Map video pixel coordinates to 3D table coordinates using IQR-based scaling.
 *
 * The IQR (P25-P75) of X positions maps to the table width. This means:
 * - Most rallying activity fills the table
 * - Extreme positions (serves, off-table shots) extend well beyond table edges
 *
 * Height is derived from deviation above the per-bucket baseline.
 */
function videoToTable(
  px: number,
  py: number,
  bounds: TrajectoryBounds,
): [number, number, number] {
  // X (along table length): use wider P10-P90 range so the ball path
  // is less compressed horizontally and uses more of the table.
  const wideRangeX = (bounds.xP75 - bounds.xP25) * 1.6 || 1; // approximate P10-P90
  const midX = (bounds.xP25 + bounds.xP75) / 2;
  const nx = (px - midX) / wideRangeX; // ~-0.5 to +0.5 for the central 80%
  const x = nx * TABLE_W * 1.3; // 1.3x table width so rallies span the table well

  // Height: deviation above the per-bucket baseline
  const rangeX = bounds.maxX - bounds.minX || 1;
  const bucketIdx = Math.min(
    bounds.bucketCount - 1,
    Math.max(0, Math.floor(((px - bounds.minX) / rangeX) * bounds.bucketCount))
  );
  const baselineY = bounds.baselineByBucket[bucketIdx];
  const heightPx = Math.max(0, baselineY - py); // pixels above baseline (video Y is inverted)
  const fullRange = bounds.maxY - bounds.minY || 1;
  const heightFrac = Math.min(1, heightPx / (fullRange * 0.5));
  const maxHeight = 0.35; // 35cm max — realistic ping pong arc height
  const y = SURFACE_Y + 0.015 + heightFrac * heightFrac * maxHeight;

  // Z (depth across table): compress — in a spectator view, most
  // vertical pixel variation is HEIGHT not depth.
  const fullRangeY = bounds.maxY - bounds.minY || 1;
  const nyFull = (py - bounds.minY) / fullRangeY; // 0–1 across full Y range
  const zRaw = (nyFull - 0.5) * TABLE_D;
  const zLimit = TABLE_D * 0.6;
  const z = Math.abs(zRaw) > zLimit
    ? Math.sign(zRaw) * (zLimit + Math.tanh((Math.abs(zRaw) - zLimit) / 0.3) * 0.3)
    : zRaw;

  return [x, y, z];
}

/**
 * Generate smooth 3D curve points for an arc using CatmullRom interpolation.
 * After generating the spline, enforces net clearance: if the arc crosses
 * x=0, the ball must arc over the net — we inject height via a parabolic
 * bump centered at the net crossing point.
 */
function arcTo3DCurve(
  arc: ArcSegment,
  bounds: TrajectoryBounds,
): [number, number, number][] {
  const pts = arc.points;
  if (pts.length < 2) return [];

  // Map all arc points to 3D
  const mapped = pts.map(p => videoToTable(p.x, p.y, bounds));

  if (mapped.length === 2) {
    // Even with only 2 points, enforce net arc
    return enforceNetArc(mapped);
  }

  const controlPoints = mapped.map(([x, y, z]) => new THREE.Vector3(x, y, z));

  // CatmullRom with moderate tension
  const curve = new THREE.CatmullRomCurve3(controlPoints, false, "catmullrom", 0.3);
  const subdivisions = Math.max(10, pts.length * 3);
  const raw = curve.getPoints(subdivisions);

  // Clamp scene bounds
  const X_LIMIT = TABLE_W * 2.0;
  const Z_LIMIT = TABLE_D * 1.5;
  const Y_MAX = SURFACE_Y + 0.6;

  const clamped: [number, number, number][] = raw.map(v => [
    Math.max(-X_LIMIT, Math.min(X_LIMIT, v.x)),
    Math.max(SURFACE_Y, Math.min(Y_MAX, v.y)),
    Math.max(-Z_LIMIT, Math.min(Z_LIMIT, v.z)),
  ]);

  // Enforce net clearance arc
  return enforceNetArc(clamped);
}

/**
 * If the curve crosses x=0 (the net), ensure the ball arcs over it.
 * Adds a parabolic height bump so the crossing point is at least
 * NET_H + margin above the table surface.
 */
function enforceNetArc(
  points: [number, number, number][]
): [number, number, number][] {
  if (points.length < 2) return points;

  // Find the net crossing index
  let crossIdx = -1;
  for (let i = 1; i < points.length; i++) {
    if ((points[i - 1][0] < 0 && points[i][0] >= 0) ||
        (points[i - 1][0] > 0 && points[i][0] <= 0)) {
      crossIdx = i;
      break;
    }
  }

  if (crossIdx < 0) return points; // no crossing

  // Interpolate the Y (height) at the crossing
  const prevX = points[crossIdx - 1][0];
  const curX = points[crossIdx][0];
  const t = Math.abs(prevX) / (Math.abs(prevX) + Math.abs(curX) || 1);
  const yAtCross = points[crossIdx - 1][1] + t * (points[crossIdx][1] - points[crossIdx - 1][1]);

  const minClearance = SURFACE_Y + NET_H + 0.04; // net top + 4cm margin
  if (yAtCross >= minClearance) return points; // already clears

  // Need to add height. Apply a parabolic bump centered at the crossing,
  // fading to zero at the arc endpoints. This creates a natural arc shape.
  const peakBoost = minClearance - yAtCross + 0.06; // extra 6cm for a nice arc
  const crossT = crossIdx / (points.length - 1); // 0–1 position of crossing

  return points.map((p, i) => {
    const ti = i / (points.length - 1);
    // Parabolic bump: peaks at crossT, zero at start and end
    // bump(t) = 4 * h * (t - 0)(t_end - t) / (t_end)^2, shifted to peak at crossT
    const distFromCross = (ti - crossT);
    const width = Math.max(crossT, 1 - crossT) * 1.2; // how wide the bump is
    const bump = Math.max(0, 1 - (distFromCross / width) ** 2) * peakBoost;
    return [p[0], p[1] + bump, p[2]] as [number, number, number];
  });
}

/**
 * Check if an arc crosses the net (X=0) and whether it clears net height.
 */
function checkNetCrossing(
  curvePoints: [number, number, number][]
): "clears" | "clips" | "none" {
  const netTopY = SURFACE_Y + NET_H;
  for (let i = 1; i < curvePoints.length; i++) {
    const prevX = curvePoints[i - 1][0];
    const curX = curvePoints[i][0];
    if ((prevX < 0 && curX >= 0) || (prevX > 0 && curX <= 0)) {
      // Interpolate Y at X=0
      const t = Math.abs(prevX) / (Math.abs(prevX) + Math.abs(curX));
      const yAtNet = curvePoints[i - 1][1] + t * (curvePoints[i][1] - curvePoints[i - 1][1]);
      return yAtNet >= netTopY ? "clears" : "clips";
    }
  }
  return "none";
}

// ============================================================================
// Processed trajectory: the full pipeline output
// ============================================================================

interface ProcessedArc {
  curvePoints: [number, number, number][];
  isToss: boolean;
  netCrossing: "clears" | "clips" | "none";
  startFrame: number;
  endFrame: number;
}

interface ProcessedTrajectory {
  arcs: ProcessedArc[];
  /** All points in order for ball position lookup */
  allPoints: { frame: number; pos: [number, number, number] }[];
  bounds: TrajectoryBounds;
}

/**
 * Full pipeline: filter → detect events → segment → fit curves → check net.
 */
function processTrajectory(rawFrames: TrajectoryPoint[]): ProcessedTrajectory {
  // Step 1: Pixel-space noise filter
  const filtered = filterTrajectoryNoise(rawFrames);
  if (filtered.length < 2) {
    return { arcs: [], allPoints: [], bounds: computeTrajectoryBounds(filtered.length ? filtered : [{ frame: 0, x: 0, y: 0, confidence: 0, isToss: false }]) };
  }

  // Step 2: Detect events
  const events = detectEvents(filtered);

  // Step 3: Segment into arcs
  const arcSegments = segmentIntoArcs(filtered, events);

  // Step 5: Compute IQR-based bounds
  const bounds = computeTrajectoryBounds(filtered);

  // Step 4 & 6 & 7: Fit curves, check net
  const arcs: ProcessedArc[] = arcSegments.map(seg => {
    const curvePoints = arcTo3DCurve(seg, bounds);
    const netCrossing = checkNetCrossing(curvePoints);
    return {
      curvePoints,
      isToss: seg.isToss,
      netCrossing,
      startFrame: seg.points[0].frame,
      endFrame: seg.points[seg.points.length - 1].frame,
    };
  });

  // Build allPoints for ball position lookup (from filtered data)
  const allPoints = filtered.map(p => ({
    frame: p.frame,
    pos: videoToTable(p.x, p.y, bounds),
  }));

  return { arcs, allPoints, bounds };
}

/**
 * Compute predicted trajectory arc from current ball velocity.
 *
 * Physics model:
 *   - Velocities are computed in "3D meters per frame" from recent positions
 *   - Converted to m/s using the video FPS for proper gravity integration
 *   - Gravity (9.81 m/s²) applied to vertical velocity each timestep
 *   - Bounce on table surface with restitution coefficient
 *   - Net collision at x=0 (net height = SURFACE_Y + NET_H)
 *   - Ball stops if it hits the net or goes below the floor
 */
function computePrediction(
  points: { pos: [number, number, number]; frame: number }[],
  currentFrame: number,
  fps: number,
  steps = 60
): [number, number, number][] {
  const recent = points.filter((p) => p.frame <= currentFrame).slice(-15);
  if (recent.length < 4) return [];

  const last = recent[recent.length - 1];

  // Compute weighted average velocity (meters per frame)
  let sumVx = 0, sumVz = 0, sumVy = 0, totalWeight = 0;
  for (let i = 1; i < recent.length; i++) {
    const frameDiff = recent[i].frame - recent[i - 1].frame;
    if (frameDiff > 0 && frameDiff < 10) {
      const weight = i / recent.length; // recent frames weighted more
      const vx = (recent[i].pos[0] - recent[i - 1].pos[0]) / frameDiff;
      const vz = (recent[i].pos[2] - recent[i - 1].pos[2]) / frameDiff;
      const vy = (recent[i].pos[1] - recent[i - 1].pos[1]) / frameDiff;
      sumVx += vx * weight;
      sumVz += vz * weight;
      sumVy += vy * weight;
      totalWeight += weight;
    }
  }
  if (totalWeight === 0) return [];

  // Velocity in m/frame → convert to m/s for physics
  const effectiveFps = fps > 0 ? fps : 30;
  const vxPerFrame = sumVx / totalWeight;
  const vzPerFrame = sumVz / totalWeight;
  const vyPerFrame = sumVy / totalWeight;

  let vxSec = vxPerFrame * effectiveFps;
  let vzSec = vzPerFrame * effectiveFps;
  let vySec = vyPerFrame * effectiveFps;

  // If vertical velocity is near zero or slightly negative, give a small
  // upward boost for a more natural arc prediction
  if (vySec < 0.3 && vySec > -2.0) {
    vySec = Math.max(vySec, 0.8);
  }

  const dt = 1.0 / effectiveFps; // timestep in seconds
  const netTopY = SURFACE_Y + NET_H;

  const path: [number, number, number][] = [last.pos];
  let x = last.pos[0], y = last.pos[1], z = last.pos[2];

  for (let i = 0; i < steps; i++) {
    // Integrate position
    x += vxSec * dt;
    vySec -= GRAVITY * dt; // gravity: decelerate upward / accelerate downward
    y += vySec * dt;
    z += vzSec * dt;

    // Net collision: ball crosses x=0 plane and is below net top
    const prevX = path[path.length - 1][0];
    if ((prevX < 0 && x >= 0) || (prevX > 0 && x <= 0)) {
      if (y < netTopY) {
        // Ball hits the net — stop prediction here
        path.push([0, y, z]);
        break;
      }
    }

    // Bounce off table surface (only if ball is above the table area)
    if (y <= SURFACE_Y + 0.005 && Math.abs(x) <= TABLE_W / 2 && Math.abs(z) <= TABLE_D / 2) {
      y = SURFACE_Y + 0.005;
      vySec = Math.abs(vySec) * RESTITUTION;
      // Dampen horizontal velocity slightly on bounce
      vxSec *= 0.95;
      vzSec *= 0.95;
      // Stop bouncing if velocity is negligible
      if (Math.abs(vySec) < 0.05) break;
    }

    // Ball fell off the table and below floor
    if (y < 0) break;

    // Ball went far off scene — stop rendering (wider range now)
    if (Math.abs(x) > TABLE_W * 3 || Math.abs(z) > TABLE_D * 3) break;

    path.push([x, y, z]);
  }

  return path;
}

// Compute parabolic arc from a placed position
function computeWhatIfArc(
  start: [number, number, number],
  speed: number,
  angleDeg: number,
  directionDeg: number,
  steps = 60
): [number, number, number][] {
  const angleRad = (angleDeg * Math.PI) / 180;
  const dirRad = (directionDeg * Math.PI) / 180;
  const dt = 0.02;

  let vx = speed * Math.cos(angleRad) * Math.sin(dirRad);
  let vy = speed * Math.sin(angleRad);
  let vz = speed * Math.cos(angleRad) * Math.cos(dirRad);
  let x = start[0], y = start[1], z = start[2];

  const path: [number, number, number][] = [[x, y, z]];

  for (let i = 0; i < steps; i++) {
    x += vx * dt;
    vy -= GRAVITY * dt;
    y += vy * dt;
    z += vz * dt;

    if (y < SURFACE_Y + 0.01) {
      y = SURFACE_Y + 0.01;
      vy = Math.abs(vy) * RESTITUTION;
      if (Math.abs(vy) < 0.1) break;
    }
    if (y < 0) break;

    path.push([x, y, z]);
  }

  return path;
}

function BallTrajectory({
  trajectoryData, currentFrame, mode, fps, whatIfStart, whatIfSpeed, whatIfAngle, whatIfDir,
}: {
  trajectoryData?: TrajectoryData;
  currentFrame: number;
  mode: PhysicsMode;
  fps: number;
  whatIfStart: [number, number, number] | null;
  whatIfSpeed: number;
  whatIfAngle: number;
  whatIfDir: number;
}) {
  const ballRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);

  // Full pipeline: filter → events → arcs → curves → net check
  const processed = useMemo((): ProcessedTrajectory => {
    if (!trajectoryData?.frames?.length) {
      return { arcs: [], allPoints: [], bounds: computeTrajectoryBounds([{ frame: 0, x: 0, y: 0, confidence: 0, isToss: false }]) };
    }
    return processTrajectory(trajectoryData.frames);
  }, [trajectoryData]);

  const { arcs, allPoints, bounds } = processed;

  // Find arcs visible at the current frame
  const visibleArcs = useMemo(() => {
    return arcs.filter(a => a.startFrame <= currentFrame);
  }, [arcs, currentFrame]);

  // Current arc (the one being actively drawn)
  const currentArc = useMemo(() => {
    return arcs.find(a => a.startFrame <= currentFrame && a.endFrame >= currentFrame) ?? null;
  }, [arcs, currentFrame]);

  // For the current arc, compute partial curve up to currentFrame
  const currentArcPartial = useMemo((): [number, number, number][] | null => {
    if (!currentArc || !currentArc.curvePoints.length) return null;
    const totalFrameSpan = currentArc.endFrame - currentArc.startFrame || 1;
    const progress = (currentFrame - currentArc.startFrame) / totalFrameSpan;
    const clampedProgress = Math.min(1, Math.max(0, progress));
    const endIdx = Math.ceil(clampedProgress * (currentArc.curvePoints.length - 1));
    return currentArc.curvePoints.slice(0, endIdx + 1);
  }, [currentArc, currentFrame]);

  // Ball target position — sampled from the smooth CatmullRom curve
  // so the ball follows the exact same smooth path as the rendered arcs.
  const targetPos = useMemo((): [number, number, number] | null => {
    // If we're inside a current arc, sample the curve at the right progress
    if (currentArc && currentArc.curvePoints.length >= 2) {
      const totalFrameSpan = currentArc.endFrame - currentArc.startFrame || 1;
      const progress = Math.min(1, Math.max(0, (currentFrame - currentArc.startFrame) / totalFrameSpan));
      const idx = progress * (currentArc.curvePoints.length - 1);
      const lo = Math.floor(idx);
      const hi = Math.min(lo + 1, currentArc.curvePoints.length - 1);
      const t = idx - lo;
      const a = currentArc.curvePoints[lo];
      const b = currentArc.curvePoints[hi];
      return [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
      ];
    }
    // Between arcs or before first arc — fall back to nearest filtered point
    if (!allPoints.length) return null;
    const visible = allPoints.filter(p => p.frame <= currentFrame);
    if (!visible.length) return allPoints[0].pos;
    return visible[visible.length - 1].pos;
  }, [currentArc, allPoints, currentFrame]);

  // Predicted path
  const predictedPath = useMemo((): [number, number, number][] => {
    if (mode !== "predict" || !allPoints.length) return [];
    return computePrediction(allPoints, currentFrame, fps);
  }, [mode, allPoints, currentFrame, fps]);

  // What-if arc
  const whatIfPath = useMemo((): [number, number, number][] => {
    if (mode !== "whatif" || !whatIfStart) return [];
    return computeWhatIfArc(whatIfStart, whatIfSpeed, whatIfAngle, whatIfDir);
  }, [mode, whatIfStart, whatIfSpeed, whatIfAngle, whatIfDir]);

  // Landing zone for prediction
  const landingPos = useMemo(() => {
    if (!predictedPath.length) return null;
    for (const p of predictedPath) {
      if (p[1] <= SURFACE_Y + 0.02 && Math.abs(p[0]) < TABLE_W / 2 && Math.abs(p[2]) < TABLE_D / 2) {
        return p;
      }
    }
    return null;
  }, [predictedPath]);

  const landingRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    if (!ballRef.current || !targetPos) return;
    if (mode === "whatif" && whatIfStart) {
      ballRef.current.position.set(whatIfStart[0], whatIfStart[1], whatIfStart[2]);
    } else {
      // Smooth lerp — 0.2 gives a gentle glide along the curve
      ballRef.current.position.x = THREE.MathUtils.lerp(ballRef.current.position.x, targetPos[0], 0.2);
      ballRef.current.position.y = THREE.MathUtils.lerp(ballRef.current.position.y, targetPos[1], 0.2);
      ballRef.current.position.z = THREE.MathUtils.lerp(ballRef.current.position.z, targetPos[2], 0.2);
    }
    if (glowRef.current) {
      glowRef.current.position.copy(ballRef.current.position);
      glowRef.current.scale.setScalar(1 + Math.sin(Date.now() * 0.005) * 0.3);
    }
    if (landingRef.current && landingPos) {
      landingRef.current.scale.setScalar(1 + Math.sin(Date.now() * 0.004) * 0.4);
    }
  });

  if (!targetPos && mode !== "whatif") return null;

  const ballPos = mode === "whatif" && whatIfStart ? whatIfStart : targetPos!;

  // Determine which arcs are "recent" (last 2 fully visible arcs) vs "old"
  const recentArcCount = 2;
  const fullyVisibleArcs = visibleArcs.filter(a => a.endFrame <= currentFrame);
  const recentCutoff = fullyVisibleArcs.length - recentArcCount;

  return (
    <group>
      {/* Render completed arcs */}
      {fullyVisibleArcs.map((arc, i) => {
        if (arc.curvePoints.length < 2) return null;
        const isRecent = i >= recentCutoff;
        const isToss = arc.isToss;
        const clips = arc.netCrossing === "clips";

        // Color: rally arcs bronze, toss arcs fainter, net clips red
        const color = clips ? "#C45C5C" : "#9B7B5B";
        const opacity = isToss ? 0.12 : isRecent ? 0.5 : 0.12;
        const lineWidth = isToss ? 1 : isRecent ? 2 : 1;

        return (
          <group key={`arc-${arc.startFrame}`}>
            <Line
              points={arc.curvePoints}
              color={color}
              transparent
              opacity={opacity}
              lineWidth={lineWidth}
            />
            {/* Net clip indicator: small X marker at net crossing */}
            {clips && (
              <mesh position={[0, SURFACE_Y + NET_H + 0.01, 0]}>
                <sphereGeometry args={[0.015, 8, 8]} />
                <meshBasicMaterial color="#C45C5C" transparent opacity={0.7} />
              </mesh>
            )}
          </group>
        );
      })}

      {/* Render current (in-progress) arc */}
      {currentArcPartial && currentArcPartial.length >= 2 && (
        <Line
          points={currentArcPartial}
          color={currentArc?.netCrossing === "clips" ? "#C45C5C" : "#9B7B5B"}
          transparent
          opacity={0.7}
          lineWidth={2.5}
        />
      )}

      {/* Predicted path (dashed) */}
      {predictedPath.length >= 2 && (
        <Line points={predictedPath} color="#C45C5C" transparent opacity={0.7} lineWidth={2} dashed dashSize={0.05} gapSize={0.03} />
      )}

      {/* Landing zone */}
      {landingPos && (
        <mesh ref={landingRef} position={[landingPos[0], SURFACE_Y + 0.002, landingPos[2]]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.03, 0.06, 24]} />
          <meshBasicMaterial color="#C45C5C" transparent opacity={0.6} side={THREE.DoubleSide} />
        </mesh>
      )}

      {/* What-if arc */}
      {whatIfPath.length >= 2 && (
        <Line points={whatIfPath} color="#5B9B7B" transparent opacity={0.8} lineWidth={2} />
      )}

      {/* Ball shadow on table surface */}
      <mesh
        position={[ballPos[0], SURFACE_Y + 0.003, ballPos[2]]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <circleGeometry args={[0.025, 16]} />
        <meshBasicMaterial
          color="#000000"
          transparent
          opacity={Math.max(0.05, 0.4 - (ballPos[1] - SURFACE_Y) * 0.8)}
          depthWrite={false}
        />
      </mesh>

      {/* Ball glow */}
      <mesh ref={glowRef} position={ballPos}>
        <sphereGeometry args={[0.04, 16, 16]} />
        <meshBasicMaterial color="#9B7B5B" transparent opacity={0.2} />
      </mesh>
      {/* Ball */}
      <mesh ref={ballRef} position={ballPos} castShadow>
        <sphereGeometry args={[0.02, 16, 16]} />
        <meshStandardMaterial color="#F5F5F0" emissive="#9B7B5B" emissiveIntensity={0.3} roughness={0.2} metalness={0.1} />
      </mesh>

      {/* What-if start marker */}
      {mode === "whatif" && whatIfStart && (
        <mesh position={[whatIfStart[0], SURFACE_Y + 0.003, whatIfStart[2]]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.02, 0.04, 24]} />
          <meshBasicMaterial color="#5B9B7B" transparent opacity={0.8} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  );
}

// Impact heatmap overlay on table surface
function ImpactHeatmap({ trajectoryData }: { trajectoryData?: TrajectoryData }) {
  const meshRef = useRef<THREE.Mesh>(null);

  const texture = useMemo(() => {
    const BINS_X = 80, BINS_Z = 50;
    const grid = Array.from({ length: BINS_Z }, () => new Float32Array(BINS_X));
    const filtered = trajectoryData?.frames?.length
      ? filterTrajectoryNoise(trajectoryData.frames)
      : [];
    const hBounds = filtered.length
      ? computeTrajectoryBounds(filtered)
      : computeTrajectoryBounds([{ frame: 0, x: 0, y: 0, confidence: 0, isToss: false }]);

    if (filtered.length) {
      for (const f of filtered) {
        const [tx, , tz] = videoToTable(f.x, f.y, hBounds);
        const bx = Math.floor(((tx + TABLE_W / 2) / TABLE_W) * BINS_X);
        const bz = Math.floor(((tz + TABLE_D / 2) / TABLE_D) * BINS_Z);
        // Gaussian splat: spread each point across a 5x5 kernel for smooth gradients
        for (let dz = -2; dz <= 2; dz++) {
          for (let dx = -2; dx <= 2; dx++) {
            const gx = bx + dx, gz = bz + dz;
            if (gx >= 0 && gx < BINS_X && gz >= 0 && gz < BINS_Z) {
              const weight = Math.exp(-(dx * dx + dz * dz) / 2);
              grid[gz][gx] += weight;
            }
          }
        }
      }
    }

    let maxVal = 1;
    for (const row of grid) for (const v of row) if (v > maxVal) maxVal = v;

    // Higher res canvas for smoother rendering
    const CANVAS_W = 256, CANVAS_H = 160;
    const canvas = document.createElement("canvas");
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    const ctx = canvas.getContext("2d")!;

    // Vivid color ramp: transparent -> blue -> cyan -> yellow -> red
    const colorRamp = (t: number): [number, number, number, number] => {
      if (t < 0.25) return [0, 0, Math.floor(t * 4 * 255), Math.floor(t * 4 * 0.7 * 255)];
      if (t < 0.5) { const s = (t - 0.25) * 4; return [0, Math.floor(s * 255), 255, Math.floor(0.8 * 255)]; }
      if (t < 0.75) { const s = (t - 0.5) * 4; return [Math.floor(s * 255), 255, Math.floor((1 - s) * 255), Math.floor(0.85 * 255)]; }
      const s = (t - 0.75) * 4; return [255, Math.floor((1 - s) * 255), 0, Math.floor(0.9 * 255)];
    };

    for (let z = 0; z < BINS_Z; z++) {
      for (let x = 0; x < BINS_X; x++) {
        const v = grid[z][x] / maxVal;
        if (v > 0.02) {
          const [r, g, b, a] = colorRamp(Math.min(v, 1));
          const cx = (x / BINS_X) * CANVAS_W;
          const cz = (z / BINS_Z) * CANVAS_H;
          const cw = CANVAS_W / BINS_X + 1;
          const ch = CANVAS_H / BINS_Z + 1;
          // Draw radial gradient for each cell for smooth blending
          const grad = ctx.createRadialGradient(cx + cw / 2, cz + ch / 2, 0, cx + cw / 2, cz + ch / 2, cw);
          grad.addColorStop(0, `rgba(${r},${g},${b},${a / 255})`);
          grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
          ctx.fillStyle = grad;
          ctx.fillRect(cx - cw / 2, cz - ch / 2, cw * 2, ch * 2);
        }
      }
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    return tex;
  }, [trajectoryData]);

  return (
    <mesh ref={meshRef} position={[0, SURFACE_Y + 0.008, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[TABLE_W, TABLE_D]} />
      <meshBasicMaterial map={texture} transparent opacity={0.9} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  );
}

/** Animate camera to a preset position */
function CameraController({ preset }: { preset: CameraPreset }) {
  const { camera } = useThree();

  useEffect(() => {
    const target = CAMERA_PRESETS[preset].pos;
    // Smoothly lerp the camera over ~20 frames
    let frame = 0;
    const startPos = camera.position.clone();
    const endPos = new THREE.Vector3(...target);
    const animate = () => {
      frame++;
      const t = Math.min(1, frame / 20);
      const ease = t * (2 - t); // ease-out
      camera.position.lerpVectors(startPos, endPos, ease);
      camera.lookAt(0, TABLE_H, 0);
      if (t < 1) requestAnimationFrame(animate);
    };
    animate();
  }, [preset, camera]);

  return null;
}

function Scene({
  trajectoryData, poseData, currentFrame, totalFrames, mode, fps,
  whatIfStart, setWhatIfStart, whatIfSpeed, whatIfAngle, whatIfDir,
}: Omit<BirdEyeViewProps, "isPlaying"> & {
  mode: PhysicsMode;
  fps: number;
  whatIfStart: [number, number, number] | null;
  setWhatIfStart: (p: [number, number, number] | null) => void;
  whatIfSpeed: number;
  whatIfAngle: number;
  whatIfDir: number;
}) {
  const handleTableClick = useCallback((point: THREE.Vector3) => {
    if (mode === "whatif") {
      setWhatIfStart([point.x, SURFACE_Y + 0.02, point.z]);
    }
  }, [mode, setWhatIfStart]);

  return (
    <>
      <ambientLight intensity={0.4} />
      <directionalLight position={[3, 5, 2]} intensity={1} castShadow shadow-mapSize={1024} />
      <pointLight position={[-2, 3, -1]} intensity={0.3} color="#9B7B5B" />
      <Table onClick={mode === "whatif" ? handleTableClick : undefined} />
      <BallTrajectory
        trajectoryData={trajectoryData} currentFrame={currentFrame} mode={mode} fps={fps}
        whatIfStart={whatIfStart} whatIfSpeed={whatIfSpeed} whatIfAngle={whatIfAngle} whatIfDir={whatIfDir}
      />
      {mode === "heatmap" && <ImpactHeatmap trajectoryData={trajectoryData} />}
    </>
  );
}

export function BirdEyeView({ trajectoryData, poseData, currentFrame, totalFrames, isPlaying }: BirdEyeViewProps) {
  const [mode, setMode] = useState<PhysicsMode>("predict");
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>("default");
  const fps = trajectoryData?.video_info?.fps ?? 30;
  const [whatIfStart, setWhatIfStart] = useState<[number, number, number] | null>(null);
  const [whatIfSpeed, setWhatIfSpeed] = useState(3);
  const [whatIfAngle, setWhatIfAngle] = useState(15);
  const [whatIfDir, setWhatIfDir] = useState(0);

  return (
    <div className="rounded-xl overflow-hidden bg-sidebar relative h-full flex flex-col">
      {/* Mode toolbar */}
      <div className="absolute top-3 left-3 right-3 z-10 flex items-center justify-between">
        <div className="flex items-center gap-1">
          {(["replay", "predict", "whatif", "heatmap"] as PhysicsMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-2 py-1 rounded text-[9px] transition-colors ${
                mode === m ? "bg-[#9B7B5B]/30 text-foreground" : "bg-black/40 text-muted-foreground hover:text-muted-foreground"
              } backdrop-blur-sm`}
            >
              {m === "replay" ? "Replay" : m === "predict" ? "Predict" : m === "whatif" ? "What If" : "Heatmap"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {/* Camera preset buttons */}
          <div className="flex items-center gap-0.5 px-1 py-0.5 rounded bg-black/40 backdrop-blur-sm">
            {(Object.keys(CAMERA_PRESETS) as CameraPreset[]).map((p) => (
              <button
                key={p}
                onClick={() => setCameraPreset(p)}
                className={`px-1.5 py-0.5 rounded text-[8px] transition-colors ${
                  cameraPreset === p ? "bg-[#9B7B5B]/40 text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {CAMERA_PRESETS[p].label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-black/40 backdrop-blur-sm">
            <div className="w-2 h-2 rounded-full bg-[#F5F5F0] border border-[#9B7B5B]" />
            <span className="text-[9px] text-muted-foreground">Ball</span>
          </div>
          {mode === "predict" && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-black/40 backdrop-blur-sm">
              <div className="w-2 h-2 rounded-full bg-[#C45C5C]" />
              <span className="text-[9px] text-muted-foreground">Predicted</span>
            </div>
          )}
        </div>
      </div>

      {/* What-if controls */}
      {mode === "whatif" && (
        <div className="absolute bottom-3 left-3 right-3 z-10 flex items-center gap-3 px-3 py-2 rounded-lg bg-black/60 backdrop-blur-sm">
          <span className="text-[9px] text-muted-foreground shrink-0">Click table to place ball</span>
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] text-muted-foreground">Speed</span>
            <input type="range" min={1} max={8} step={0.5} value={whatIfSpeed} onChange={(e) => setWhatIfSpeed(parseFloat(e.target.value))}
              className="w-16 h-1 accent-[#9B7B5B]" />
            <span className="text-[9px] text-foreground font-mono w-6">{whatIfSpeed}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] text-muted-foreground">Angle</span>
            <input type="range" min={5} max={60} step={5} value={whatIfAngle} onChange={(e) => setWhatIfAngle(parseInt(e.target.value))}
              className="w-16 h-1 accent-[#9B7B5B]" />
            <span className="text-[9px] text-foreground font-mono w-6">{whatIfAngle}°</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] text-muted-foreground">Dir</span>
            <input type="range" min={-90} max={90} step={15} value={whatIfDir} onChange={(e) => setWhatIfDir(parseInt(e.target.value))}
              className="w-16 h-1 accent-[#9B7B5B]" />
            <span className="text-[9px] text-foreground font-mono w-8">{whatIfDir}°</span>
          </div>
        </div>
      )}

      <div className="h-full min-h-[16rem] flex-1">
        <Canvas
          camera={{
            position: CAMERA_PRESETS.default.pos,
            fov: 38,
            near: 0.1,
            far: 50,
          }}
          shadows
          gl={{ alpha: true, antialias: true }}
          dpr={[1, 2]}
          style={{ background: "transparent" }}
        >
          <Suspense fallback={null}>
            <CameraController preset={cameraPreset} />
            <Scene
              trajectoryData={trajectoryData} poseData={poseData} currentFrame={currentFrame} totalFrames={totalFrames}
              mode={mode} fps={fps} whatIfStart={whatIfStart} setWhatIfStart={setWhatIfStart}
              whatIfSpeed={whatIfSpeed} whatIfAngle={whatIfAngle} whatIfDir={whatIfDir}
            />
            <OrbitControls enablePan enableZoom enableRotate target={[0, TABLE_H, 0]} minDistance={0.8} maxDistance={8} maxPolarAngle={Math.PI / 2.1} />
          </Suspense>
        </Canvas>
      </div>
    </div>
  );
}
