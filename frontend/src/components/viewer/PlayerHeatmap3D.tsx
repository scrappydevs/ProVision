"use client";

import { useState, useRef, useMemo } from "react";
import { Canvas, ThreeEvent } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { TrajectoryPoint } from "@/lib/api";
import { PlayerHeatmapGame } from "@/hooks/usePlayerHeatmap";

interface PlayerHeatmap3DProps {
  gamesData: PlayerHeatmapGame[];
  height?: number;
  onZoneClick?: (zone: { x: number; z: number; games: string[]; gameNames: string[] }) => void;
}

// Table dimensions (same as BirdEyeView)
const TABLE_W = 2.74;
const TABLE_D = 1.525;
const TABLE_H = 0.76;
const TABLE_THICK = 0.03;
const NET_H = 0.1525;
const SURFACE_Y = TABLE_H + TABLE_THICK / 2;

// Trajectory filtering (simplified from BirdEyeView)
interface FilteredPoint extends TrajectoryPoint {
  isToss: boolean;
}

function filterTrajectoryNoise(raw: TrajectoryPoint[]): FilteredPoint[] {
  if (raw.length < 3) return raw.map(f => ({ ...f, isToss: false }));

  const JUMP_THRESH = 80;
  const sorted = [...raw].sort((a, b) => a.frame - b.frame);

  // Median filter - remove isolated spikes
  const pass1 = sorted.map((p, i) => {
    if (i === 0 || i === sorted.length - 1) return { ...p, keep: true };
    const prev = sorted[i - 1];
    const next = sorted[i + 1];
    const prevGap = p.frame - prev.frame;
    const nextGap = next.frame - p.frame;
    if (prevGap > 3 || nextGap > 3) return { ...p, keep: true };
    const distPrev = Math.sqrt((p.x - prev.x) ** 2 + (p.y - prev.y) ** 2);
    const distNext = Math.sqrt((p.x - next.x) ** 2 + (p.y - next.y) ** 2);
    if (distPrev > JUMP_THRESH && distNext > JUMP_THRESH) return { ...p, keep: false };
    return { ...p, keep: true };
  });

  const kept = pass1.filter(p => p.keep);
  return kept.map(p => ({ ...p, isToss: false }));
}

// Compute bounds for coordinate mapping
interface TrajectoryBounds {
  xP25: number;
  xP75: number;
  yP25: number;
  yP75: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function computeTrajectoryBounds(frames: FilteredPoint[]): TrajectoryBounds {
  const xs = frames.map(f => f.x).sort((a, b) => a - b);
  const ys = frames.map(f => f.y).sort((a, b) => a - b);

  return {
    minX: xs[0] || 0,
    maxX: xs[xs.length - 1] || 1,
    minY: ys[0] || 0,
    maxY: ys[ys.length - 1] || 1,
    xP25: xs[Math.floor(xs.length * 0.25)] || 0,
    xP75: xs[Math.floor(xs.length * 0.75)] || 1,
    yP25: ys[Math.floor(ys.length * 0.25)] || 0,
    yP75: ys[Math.floor(ys.length * 0.75)] || 1,
  };
}

// Map video coordinates to table coordinates
function videoToTable(
  px: number,
  py: number,
  bounds: TrajectoryBounds,
): [number, number, number] {
  const wideRangeX = (bounds.xP75 - bounds.xP25) * 1.6 || 1;
  const midX = (bounds.xP25 + bounds.xP75) / 2;
  const nx = (px - midX) / wideRangeX;
  const x = nx * TABLE_W * 1.3;

  const fullRangeY = bounds.maxY - bounds.minY || 1;
  const nyFull = (py - bounds.minY) / fullRangeY;
  const zRaw = (nyFull - 0.5) * TABLE_D;
  const zLimit = TABLE_D * 0.6;
  const z = Math.abs(zRaw) > zLimit
    ? Math.sign(zRaw) * (zLimit + Math.tanh((Math.abs(zRaw) - zLimit) / 0.3) * 0.3)
    : zRaw;

  return [x, SURFACE_Y, z];
}

// Table component
function Table({ onClick }: { onClick?: (point: THREE.Vector3) => void }) {
  return (
    <group>
      {/* Table surface */}
      <mesh
        position={[0, TABLE_H, 0]}
        castShadow
        receiveShadow
        onClick={(e: ThreeEvent<MouseEvent>) => {
          if (onClick) {
            e.stopPropagation();
            onClick(e.point);
          }
        }}
      >
        <boxGeometry args={[TABLE_W, TABLE_THICK, TABLE_D]} />
        <meshStandardMaterial color="#1e3a5f" roughness={0.3} metalness={0.2} />
      </mesh>

      {/* Net */}
      <group position={[0, TABLE_H + TABLE_THICK / 2, 0]}>
        <mesh position={[0, NET_H / 2, 0]}>
          <boxGeometry args={[0.01, NET_H, TABLE_D + 0.1]} />
          <meshStandardMaterial color="#e8e6e3" opacity={0.7} transparent />
        </mesh>
      </group>

      {/* Table lines */}
      <group position={[0, TABLE_H + TABLE_THICK / 2 + 0.002, 0]}>
        <mesh>
          <boxGeometry args={[TABLE_W, 0.001, 0.015]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
        <mesh position={[0, 0, -TABLE_D / 2]}>
          <boxGeometry args={[TABLE_W, 0.001, 0.015]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
        <mesh position={[0, 0, TABLE_D / 2]}>
          <boxGeometry args={[TABLE_W, 0.001, 0.015]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
        <mesh position={[-TABLE_W / 2, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
          <boxGeometry args={[TABLE_D, 0.001, 0.015]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
        <mesh position={[TABLE_W / 2, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
          <boxGeometry args={[TABLE_D, 0.001, 0.015]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
      </group>
    </group>
  );
}

// Grid cell data structure
interface GridCell {
  value: number;
  games: Set<string>;
  gameNames: Set<string>;
}

// Impact heatmap with multi-game aggregation and click detection
function ImpactHeatmap({
  gamesData,
  onCellClick,
}: {
  gamesData: PlayerHeatmapGame[];
  onCellClick?: (x: number, z: number, games: string[], gameNames: string[]) => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);

  // Build grid with game tracking
  const { texture, gridMap } = useMemo(() => {
    const BINS_X = 80;
    const BINS_Z = 50;
    const gridMap = new Map<string, GridCell>();

    // Process each game's trajectory data
    for (const game of gamesData) {
      const filtered = game.trajectory_frames.length
        ? filterTrajectoryNoise(game.trajectory_frames)
        : [];

      if (filtered.length === 0) continue;

      const bounds = computeTrajectoryBounds(filtered);

      // Add each point to the grid
      for (const f of filtered) {
        const [tx, , tz] = videoToTable(f.x, f.y, bounds);
        const bx = Math.floor(((tx + TABLE_W / 2) / TABLE_W) * BINS_X);
        const bz = Math.floor(((tz + TABLE_D / 2) / TABLE_D) * BINS_Z);

        // Gaussian splat: spread each point across a 5x5 kernel for smooth gradients
        for (let dz = -2; dz <= 2; dz++) {
          for (let dx = -2; dx <= 2; dx++) {
            const gx = bx + dx;
            const gz = bz + dz;
            if (gx >= 0 && gx < BINS_X && gz >= 0 && gz < BINS_Z) {
              const weight = Math.exp(-(dx * dx + dz * dz) / 2);
              const key = `${gx},${gz}`;

              if (!gridMap.has(key)) {
                gridMap.set(key, {
                  value: 0,
                  games: new Set(),
                  gameNames: new Set(),
                });
              }

              const cell = gridMap.get(key)!;
              cell.value += weight;
              cell.games.add(game.session_id);
              cell.gameNames.add(game.session_name);
            }
          }
        }
      }
    }

    // Find max value for normalization
    let maxVal = 1;
    for (const [, cell] of gridMap) {
      if (cell.value > maxVal) maxVal = cell.value;
    }

    // Create canvas texture
    const CANVAS_W = 256;
    const CANVAS_H = 160;
    const canvas = document.createElement("canvas");
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    const ctx = canvas.getContext("2d")!;

    // Color ramp: transparent -> blue -> cyan -> yellow -> red
    const colorRamp = (t: number): [number, number, number, number] => {
      if (t < 0.25) return [0, 0, Math.floor(t * 4 * 255), Math.floor(t * 4 * 0.7 * 255)];
      if (t < 0.5) {
        const s = (t - 0.25) * 4;
        return [0, Math.floor(s * 255), 255, Math.floor(0.8 * 255)];
      }
      if (t < 0.75) {
        const s = (t - 0.5) * 4;
        return [Math.floor(s * 255), 255, Math.floor((1 - s) * 255), Math.floor(0.85 * 255)];
      }
      const s = (t - 0.75) * 4;
      return [255, Math.floor((1 - s) * 255), 0, Math.floor(0.9 * 255)];
    };

    // Render grid cells
    for (let z = 0; z < BINS_Z; z++) {
      for (let x = 0; x < BINS_X; x++) {
        const key = `${x},${z}`;
        const cell = gridMap.get(key);

        if (cell && cell.value > 0.02) {
          const v = cell.value / maxVal;
          const [r, g, b, a] = colorRamp(Math.min(v, 1));
          const cx = (x / BINS_X) * CANVAS_W;
          const cz = (z / BINS_Z) * CANVAS_H;
          const cw = CANVAS_W / BINS_X + 1;
          const ch = CANVAS_H / BINS_Z + 1;

          // Draw radial gradient for smooth blending
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

    return { texture: tex, gridMap };
  }, [gamesData]);

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    if (!onCellClick) return;

    event.stopPropagation();
    const point = event.point;

    // Convert 3D world coordinates back to grid coordinates
    const BINS_X = 80;
    const BINS_Z = 50;
    const bx = Math.floor(((point.x + TABLE_W / 2) / TABLE_W) * BINS_X);
    const bz = Math.floor(((point.z + TABLE_D / 2) / TABLE_D) * BINS_Z);

    const key = `${bx},${bz}`;
    const cell = gridMap.get(key);

    if (cell && cell.value > 0.02) {
      onCellClick(bx, bz, Array.from(cell.games), Array.from(cell.gameNames));
    }
  };

  return (
    <mesh
      ref={meshRef}
      position={[0, SURFACE_Y + 0.008, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      onClick={handleClick}
    >
      <planeGeometry args={[TABLE_W, TABLE_D]} />
      <meshBasicMaterial map={texture} transparent opacity={0.9} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  );
}

// Main component
export function PlayerHeatmap3D({ gamesData, height = 400, onZoneClick }: PlayerHeatmap3DProps) {
  const [hoveredZone, setHoveredZone] = useState<{ x: number; z: number } | null>(null);

  const handleZoneClick = (x: number, z: number, games: string[], gameNames: string[]) => {
    onZoneClick?.({ x, z, games, gameNames });
  };

  return (
    <div style={{ width: "100%", height: `${height}px`, position: "relative" }}>
      <Canvas
        camera={{ position: [0, 3.5, 0.01], fov: 50 }}
        shadows
        gl={{ antialias: true, alpha: true }}
        style={{ background: "transparent" }}
      >
        <ambientLight intensity={0.6} />
        <directionalLight position={[5, 10, 5]} intensity={0.8} castShadow />
        <pointLight position={[-5, 5, -5]} intensity={0.3} />

        <Table onClick={undefined} />
        <ImpactHeatmap gamesData={gamesData} onCellClick={handleZoneClick} />

        <OrbitControls
          enablePan={true}
          enableZoom={true}
          enableRotate={true}
          minDistance={1.5}
          maxDistance={6}
          maxPolarAngle={Math.PI / 2 - 0.1}
        />
      </Canvas>

      {/* Legend overlay */}
      <div className="absolute bottom-4 left-4 bg-background/80 backdrop-blur-sm px-3 py-2 rounded-lg border border-foreground/10">
        <div className="text-[10px] uppercase tracking-wider text-foreground/50 mb-2">
          Impact Density
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-sm" style={{ background: "rgba(0,0,255,0.7)" }} />
            <span className="text-[9px] text-foreground/60">Low</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-sm" style={{ background: "rgba(0,255,255,0.8)" }} />
            <span className="text-[9px] text-foreground/60">Med</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-sm" style={{ background: "rgba(255,255,0,0.85)" }} />
            <span className="text-[9px] text-foreground/60">High</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-sm" style={{ background: "rgba(255,0,0,0.9)" }} />
            <span className="text-[9px] text-foreground/60">Max</span>
          </div>
        </div>
      </div>

      {/* Instructions overlay */}
      <div className="absolute top-4 right-4 bg-background/80 backdrop-blur-sm px-3 py-2 rounded-lg border border-foreground/10">
        <div className="text-[9px] text-foreground/50">
          Click zones to see games
        </div>
      </div>
    </div>
  );
}
