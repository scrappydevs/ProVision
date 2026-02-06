"use client";

import { useMemo, useState } from "react";
import {
  HawkEyeView,
  Rally,
  Trajectory3DPoint,
  BouncePoint,
} from "@/components/viewer/HawkEyeView";

// ─── Physics-based trajectory generator ──────────────────────────────────────

const GRAVITY = -9.81;
const TABLE_HALF_L = 1.37;
const TABLE_HALF_W = 0.7625;
const BALL_RADIUS = 0.02;
const RESTITUTION = 0.85; // bounce coefficient

interface ShotParams {
  startX: number;
  startY: number;
  startZ: number;
  vx: number; // velocity along table length
  vy: number; // upward velocity
  vz: number; // lateral velocity
  spinFactor?: number; // 0 = no spin, positive = topspin, negative = backspin
}

function generateTrajectory(
  params: ShotParams,
  duration: number = 1.2,
  dt: number = 0.005
): { points: Trajectory3DPoint[]; bounces: BouncePoint[] } {
  const points: Trajectory3DPoint[] = [];
  const bounces: BouncePoint[] = [];

  let x = params.startX;
  let y = params.startY;
  let z = params.startZ;
  let vx = params.vx;
  let vy = params.vy;
  let vz = params.vz;
  const spin = params.spinFactor ?? 0;

  let t = 0;
  while (t < duration) {
    points.push({ x, y, z, t });

    // Apply gravity
    vy += GRAVITY * dt;
    // Apply spin effect (Magnus-like: topspin pushes ball down faster, backspin lifts)
    vy += spin * -0.5 * dt;
    vx += spin * 0.3 * dt;

    // Air resistance (simplified)
    const drag = 0.998;
    vx *= drag;
    vy *= drag;
    vz *= drag;

    x += vx * dt;
    y += vy * dt;
    z += vz * dt;

    // Bounce off table surface (y=0 is table surface in our local coords)
    if (y <= BALL_RADIUS && vy < 0) {
      // Only bounce if ball is over the table
      if (Math.abs(x) <= TABLE_HALF_L && Math.abs(z) <= TABLE_HALF_W) {
        y = BALL_RADIUS;
        vy = -vy * RESTITUTION;
        bounces.push({
          x,
          z,
          t,
          side: x < 0 ? "near" : "far",
        });
      }
    }

    // Stop if ball is way below table level (fell off)
    if (y < -0.3) break;

    t += dt;
  }

  return { points, bounces };
}

// ─── Predefined shot types ───────────────────────────────────────────────────

function createServe(
  side: "near" | "far",
  zOffset: number = 0,
  speed: number = 3,
  topspinFactor: number = 0
): ShotParams {
  const dir = side === "near" ? 1 : -1;
  return {
    startX: dir * -1.5,
    startY: 0.25,
    startZ: zOffset,
    vx: dir * speed,
    vy: 1.5,
    vz: (seededMathRandom() - 0.5) * 0.8,
    spinFactor: topspinFactor,
  };
}

function createDrive(
  fromX: number,
  fromZ: number,
  towardFar: boolean,
  speed: number = 4,
  height: number = 0.15,
  spinFactor: number = 2
): ShotParams {
  const dir = towardFar ? 1 : -1;
  return {
    startX: fromX,
    startY: height,
    startZ: fromZ,
    vx: dir * speed,
    vy: 1.0 + seededMathRandom() * 0.5,
    vz: (seededMathRandom() - 0.5) * 1.2,
    spinFactor,
  };
}

function createLob(
  fromX: number,
  fromZ: number,
  towardFar: boolean
): ShotParams {
  const dir = towardFar ? 1 : -1;
  return {
    startX: fromX,
    startY: 0.1,
    startZ: fromZ,
    vx: dir * 2.0,
    vy: 3.5,
    vz: (seededMathRandom() - 0.5) * 0.5,
    spinFactor: -1,
  };
}

function createChop(
  fromX: number,
  fromZ: number,
  towardFar: boolean
): ShotParams {
  const dir = towardFar ? 1 : -1;
  return {
    startX: fromX,
    startY: 0.35,
    startZ: fromZ,
    vx: dir * 2.5,
    vy: 0.3,
    vz: (seededMathRandom() - 0.5) * 0.6,
    spinFactor: -3,
  };
}

// ─── Color palette for trajectories ──────────────────────────────────────────

const TRAJECTORY_COLORS = [
  "#FFD700", // Gold
  "#00E5FF", // Cyan
  "#FF4081", // Pink
  "#76FF03", // Lime
  "#E040FB", // Purple
  "#FF6E40", // Deep Orange
  "#18FFFF", // Aqua
  "#FFFF00", // Yellow
  "#69F0AE", // Teal
  "#FF80AB", // Light Pink
  "#B388FF", // Light Purple
  "#F4FF81", // Light Yellow
];

// ─── Generate a multi-shot rally ─────────────────────────────────────────────

function generateRally(id: string, colorIndex: number): Rally {
  const shotCount = 2 + Math.floor(seededMathRandom() * 4); // 2-5 shots per rally
  const allPoints: Trajectory3DPoint[] = [];
  const allBounces: BouncePoint[] = [];
  let timeOffset = 0;

  let lastEndX = -1.5 + seededMathRandom() * 0.5;
  let lastEndZ = (seededMathRandom() - 0.5) * 0.8;
  let goingFar = true;

  for (let s = 0; s < shotCount; s++) {
    let params: ShotParams;

    if (s === 0) {
      // First shot is a serve
      params = createServe(
        "near",
        (seededMathRandom() - 0.5) * 0.6,
        2.5 + seededMathRandom() * 2,
        seededMathRandom() * 3
      );
    } else {
      // Subsequent shots alternate direction
      const shotType = seededMathRandom();
      if (shotType < 0.5) {
        params = createDrive(
          lastEndX,
          lastEndZ,
          goingFar,
          3 + seededMathRandom() * 3,
          0.08 + seededMathRandom() * 0.15,
          seededMathRandom() * 4 - 1
        );
      } else if (shotType < 0.8) {
        params = createLob(lastEndX, lastEndZ, goingFar);
      } else {
        params = createChop(lastEndX, lastEndZ, goingFar);
      }
    }

    const { points, bounces } = generateTrajectory(params, 0.8 + seededMathRandom() * 0.4);

    // Offset time and add to rally
    for (const p of points) {
      allPoints.push({ ...p, t: p.t + timeOffset });
    }
    for (const b of bounces) {
      allBounces.push({ ...b, t: b.t + timeOffset });
    }

    if (points.length > 0) {
      const lastPt = points[points.length - 1];
      timeOffset += lastPt.t + 0.05;
      lastEndX = lastPt.x;
      lastEndZ = lastPt.z;
    }
    goingFar = !goingFar;
  }

  return {
    id,
    points: allPoints,
    bounces: allBounces,
    color: TRAJECTORY_COLORS[colorIndex % TRAJECTORY_COLORS.length],
    label: `Rally ${id}`,
  };
}

// ─── Demo Page ───────────────────────────────────────────────────────────────

// Seeded random for deterministic generation (avoids hydration mismatch)
function createSeededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

let seededRandom = createSeededRandom(42);

function seededMathRandom() {
  return seededRandom();
}

export default function HawkEyeDemoPage() {
  const [rallyCount, setRallyCount] = useState(6);
  const [seed, setSeed] = useState(42);
  const [showBounces, setShowBounces] = useState(true);
  const [showTrajectories, setShowTrajectories] = useState(true);

  const rallies = useMemo(() => {
    seededRandom = createSeededRandom(seed);
    const result: Rally[] = [];
    for (let i = 0; i < rallyCount; i++) {
      result.push(generateRally(`${seed}-${i + 1}`, i));
    }
    return result;
  }, [rallyCount, seed]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <div className="border-b border-border px-6 py-4">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div>
            <h1 className="text-lg font-semibold">Hawk-Eye 3D Prototype</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              3D ball trajectory visualization with physics-based mock data
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <label className="text-[10px] text-muted-foreground">Rallies</label>
              <select
                value={rallyCount}
                onChange={(e) => setRallyCount(Number(e.target.value))}
                className="bg-card border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-primary"
              >
                {[1, 2, 3, 4, 6, 8, 10, 12].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={() => setSeed((s) => s + 7)}
              className="bg-[#9B7B5B] hover:bg-[#8A6B4B] text-background text-xs font-medium px-3 py-1.5 rounded transition-colors"
            >
              Regenerate
            </button>
            <button
              onClick={() => setShowBounces((b) => !b)}
              className={`text-xs px-3 py-1.5 rounded border transition-colors ${
                showBounces
                  ? "border-primary text-[#9B7B5B]"
                  : "border-border text-muted-foreground hover:border-primary"
              }`}
            >
              Bounces
            </button>
            <button
              onClick={() => setShowTrajectories((t) => !t)}
              className={`text-xs px-3 py-1.5 rounded border transition-colors ${
                showTrajectories
                  ? "border-primary text-[#9B7B5B]"
                  : "border-border text-muted-foreground hover:border-primary"
              }`}
            >
              Trajectories
            </button>
          </div>
        </div>
      </div>

      {/* Main visualization */}
      <div className="max-w-7xl mx-auto px-6 py-6">
        <HawkEyeView
          rallies={rallies}
          showBounceMarkers={showBounces}
          showTrajectoryLines={showTrajectories}
          className="h-[600px]"
        />

        {/* Info cards */}
        <div className="grid grid-cols-3 gap-4 mt-4">
          <div className="bg-card rounded-lg border border-border p-4">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
              Total Rallies
            </div>
            <div className="text-2xl font-semibold text-[#9B7B5B]">
              {rallies.length}
            </div>
          </div>
          <div className="bg-card rounded-lg border border-border p-4">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
              Total Bounces
            </div>
            <div className="text-2xl font-semibold text-[#9B7B5B]">
              {rallies.reduce((sum, r) => sum + r.bounces.length, 0)}
            </div>
          </div>
          <div className="bg-card rounded-lg border border-border p-4">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
              Total Data Points
            </div>
            <div className="text-2xl font-semibold text-[#9B7B5B]">
              {rallies.reduce((sum, r) => sum + r.points.length, 0).toLocaleString()}
            </div>
          </div>
        </div>

        {/* Bounce heatmap data table */}
        <div className="mt-4 bg-card rounded-lg border border-border p-4">
          <h3 className="text-xs font-medium text-foreground mb-3">Bounce Distribution</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-[10px] text-muted-foreground mb-2">Near Side</div>
              <div className="space-y-1">
                {rallies.map((r) => {
                  const nearBounces = r.bounces.filter((b) => b.side === "near");
                  return (
                    <div key={r.id} className="flex items-center gap-2">
                      <div
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: r.color }}
                      />
                      <span className="text-[10px] text-foreground">
                        {r.label}: {nearBounces.length} bounces
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground mb-2">Far Side</div>
              <div className="space-y-1">
                {rallies.map((r) => {
                  const farBounces = r.bounces.filter((b) => b.side === "far");
                  return (
                    <div key={r.id} className="flex items-center gap-2">
                      <div
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: r.color }}
                      />
                      <span className="text-[10px] text-foreground">
                        {r.label}: {farBounces.length} bounces
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
