"use client";

import { useState, useRef, useMemo, useCallback, useEffect, Suspense } from "react";
import { Canvas, useFrame, useThree, ThreeEvent } from "@react-three/fiber";
import { OrbitControls, Line } from "@react-three/drei";
import * as THREE from "three";
import { TrajectoryData, TrajectoryPoint } from "@/lib/api";
import { PoseAnalysisData, PoseFrame } from "@/hooks/usePoseData";

interface BirdEyeViewProps {
  trajectoryData?: TrajectoryData;
  poseData?: PoseAnalysisData;
  currentFrame: number;
  totalFrames: number;
  isPlaying: boolean;
}

type PhysicsMode = "replay" | "predict" | "whatif" | "heatmap";

const TABLE_W = 2.74;
const TABLE_D = 1.525;
const TABLE_H = 0.76;
const TABLE_THICK = 0.03;
const NET_H = 0.1525;
const LEG_SIZE = 0.06;
const SURFACE_Y = TABLE_H + TABLE_THICK / 2;
const GRAVITY = 9.81;
const RESTITUTION = 0.85;

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
        <planeGeometry args={[6, 4]} />
        <meshStandardMaterial color="#1E1D1F" roughness={0.9} />
      </mesh>
    </group>
  );
}

function videoToTable(px: number, py: number, videoW = 1280, videoH = 828): [number, number, number] {
  const x = (px / videoW) * TABLE_W - TABLE_W / 2;
  const z = (py / videoH) * TABLE_D - TABLE_D / 2;
  // Estimate ball height from vertical position in frame:
  // Top of frame (low py) = ball high in the air, bottom = at table level
  const normalizedY = Math.max(0, 1 - (py / videoH)); // 0=bottom, 1=top
  const maxHeight = 0.4; // ~40cm max arc above table
  const y = SURFACE_Y + 0.02 + normalizedY * normalizedY * maxHeight; // quadratic for natural arc
  return [x, y, z];
}

// Compute predicted trajectory arc from velocity
function computePrediction(
  points: { pos: [number, number, number]; frame: number }[],
  currentFrame: number,
  steps = 40
): [number, number, number][] {
  const recent = points.filter((p) => p.frame <= currentFrame).slice(-8);
  if (recent.length < 3) return [];

  const last = recent[recent.length - 1].pos;
  const prev = recent[recent.length - 3].pos;
  const dt = 0.033; // ~30fps time step
  const frameGap = 2;

  // Velocity in table coords (m/frame)
  const vx = (last[0] - prev[0]) / frameGap;
  const vz = (last[2] - prev[2]) / frameGap;
  const vy = 0.05; // small upward arc assumption

  const path: [number, number, number][] = [last];
  let x = last[0], y = last[1], z = last[2];
  let cvx = vx, cvy = vy, cvz = vz;

  for (let i = 0; i < steps; i++) {
    x += cvx;
    cvy -= GRAVITY * dt * dt;
    y += cvy;
    z += cvz;

    // Bounce off table surface
    if (y < SURFACE_Y + 0.01 && Math.abs(x) < TABLE_W / 2 && Math.abs(z) < TABLE_D / 2) {
      y = SURFACE_Y + 0.01;
      cvy = Math.abs(cvy) * RESTITUTION;
    }

    // Stop if off table and below surface
    if (y < 0) break;

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
  trajectoryData, currentFrame, mode, whatIfStart, whatIfSpeed, whatIfAngle, whatIfDir,
}: {
  trajectoryData?: TrajectoryData;
  currentFrame: number;
  mode: PhysicsMode;
  whatIfStart: [number, number, number] | null;
  whatIfSpeed: number;
  whatIfAngle: number;
  whatIfDir: number;
}) {
  const ballRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);

  const videoW = trajectoryData?.video_info?.width ?? 1280;
  const videoH = trajectoryData?.video_info?.height ?? 828;

  const points3D = useMemo(() => {
    if (!trajectoryData?.frames?.length) return [];
    return trajectoryData.frames.map((f: TrajectoryPoint) => ({
      frame: f.frame,
      pos: videoToTable(f.x, f.y, videoW, videoH),
    }));
  }, [trajectoryData, videoW, videoH]);

  const trailPath = useMemo((): [number, number, number][] => {
    return points3D.filter((p) => p.frame <= currentFrame).map((p) => p.pos);
  }, [points3D, currentFrame]);

  const recentTrail = useMemo((): [number, number, number][] => trailPath.slice(-60), [trailPath]);

  const targetPos = useMemo(() => {
    if (!points3D.length) return null;
    let closest = points3D[0];
    for (const p of points3D) {
      if (p.frame <= currentFrame) closest = p;
      else break;
    }
    return closest.pos;
  }, [points3D, currentFrame]);

  // Predicted path
  const predictedPath = useMemo((): [number, number, number][] => {
    if (mode !== "predict" || !points3D.length) return [];
    return computePrediction(points3D, currentFrame);
  }, [mode, points3D, currentFrame]);

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

  return (
    <group>
      {trailPath.length >= 2 && <Line points={trailPath} color="#9B7B5B" transparent opacity={0.15} lineWidth={1} />}
      {recentTrail.length >= 2 && <Line points={recentTrail} color="#9B7B5B" transparent opacity={0.6} lineWidth={2} />}

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

      {/* Ball */}
      <mesh ref={glowRef} position={ballPos}>
        <sphereGeometry args={[0.04, 16, 16]} />
        <meshBasicMaterial color="#9B7B5B" transparent opacity={0.2} />
      </mesh>
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
    const videoW = trajectoryData?.video_info?.width ?? 1280;
    const videoH = trajectoryData?.video_info?.height ?? 828;

    if (trajectoryData?.frames) {
      for (const f of trajectoryData.frames) {
        const [tx, , tz] = videoToTable(f.x, f.y, videoW, videoH);
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

function PosePlayers({ poseData, currentFrame }: { poseData?: PoseAnalysisData; currentFrame: number }) {
  const frameMap = useMemo(() => {
    if (!poseData?.frames) return new Map<number, PoseFrame>();
    return new Map(poseData.frames.map((f) => [f.frame_number, f]));
  }, [poseData]);

  const getPlayerPos = useCallback((frame: PoseFrame): [number, number, number] | null => {
    const lh = frame.keypoints?.left_hip;
    const rh = frame.keypoints?.right_hip;
    if (!lh && !rh) return null;
    const cx = lh && rh ? (lh.x + rh.x) / 2 : (lh?.x ?? rh?.x ?? 0.5);
    const cy = lh && rh ? (lh.y + rh.y) / 2 : (lh?.y ?? rh?.y ?? 0.5);
    return [cx * 4.0 - 2.0, TABLE_H + 0.5, cy * 2.5 - 1.25];
  }, []);

  const currentPoseFrame = useMemo(() => {
    if (!frameMap.size) return null;
    let closest: PoseFrame | null = null;
    let minDist = Infinity;
    for (const [fn, f] of frameMap) {
      const dist = Math.abs(fn - currentFrame);
      if (dist < minDist) { minDist = dist; closest = f; }
    }
    return closest;
  }, [frameMap, currentFrame]);

  const trail = useMemo(() => {
    if (!poseData?.frames) return [];
    return poseData.frames.filter((f) => f.frame_number <= currentFrame).slice(-30)
      .map((f) => getPlayerPos(f)).filter((p): p is [number, number, number] => p !== null);
  }, [poseData, currentFrame, getPlayerPos]);

  const playerPos = currentPoseFrame ? getPlayerPos(currentPoseFrame) : null;

  if (!playerPos) {
    const t = currentFrame / Math.max(1, 300);
    return (
      <>
        <PlayerCapsule position={[-TABLE_W / 2 - 0.4, TABLE_H + 0.3, Math.sin(t * Math.PI * 4) * 0.3]} color="#9B7B5B" />
        <PlayerCapsule position={[TABLE_W / 2 + 0.4, TABLE_H + 0.3, Math.sin(t * Math.PI * 3 + 1) * 0.25]} color="#5B9B7B" />
      </>
    );
  }

  return (
    <group>
      <PlayerCapsule position={playerPos} color="#9B7B5B" />
      {trail.length >= 2 && <Line points={trail} color="#9B7B5B" transparent opacity={0.15} lineWidth={1} />}
    </group>
  );
}

function PlayerCapsule({ position, color }: { position: [number, number, number]; color: string }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(() => {
    if (ref.current) {
      ref.current.position.x = THREE.MathUtils.lerp(ref.current.position.x, position[0], 0.1);
      ref.current.position.z = THREE.MathUtils.lerp(ref.current.position.z, position[2], 0.1);
    }
  });
  return (
    <mesh ref={ref} position={position} castShadow>
      <capsuleGeometry args={[0.06, 0.2, 4, 12]} />
      <meshStandardMaterial color={color} roughness={0.4} metalness={0.2} />
    </mesh>
  );
}

function Scene({
  trajectoryData, poseData, currentFrame, totalFrames, mode,
  whatIfStart, setWhatIfStart, whatIfSpeed, whatIfAngle, whatIfDir,
}: Omit<BirdEyeViewProps, "isPlaying"> & {
  mode: PhysicsMode;
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
        trajectoryData={trajectoryData} currentFrame={currentFrame} mode={mode}
        whatIfStart={whatIfStart} whatIfSpeed={whatIfSpeed} whatIfAngle={whatIfAngle} whatIfDir={whatIfDir}
      />
      {mode === "heatmap" && <ImpactHeatmap trajectoryData={trajectoryData} />}
      <PosePlayers poseData={poseData} currentFrame={currentFrame} />
    </>
  );
}

export function BirdEyeView({ trajectoryData, poseData, currentFrame, totalFrames, isPlaying }: BirdEyeViewProps) {
  const [mode, setMode] = useState<PhysicsMode>("replay");
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
          camera={{ position: [0, 2.5, 2.8], fov: 45, near: 0.1, far: 50 }}
          shadows
          gl={{ alpha: true, antialias: true }}
          dpr={[1, 2]}
          style={{ background: "transparent" }}
        >
          <Suspense fallback={null}>
            <Scene
              trajectoryData={trajectoryData} poseData={poseData} currentFrame={currentFrame} totalFrames={totalFrames}
              mode={mode} whatIfStart={whatIfStart} setWhatIfStart={setWhatIfStart}
              whatIfSpeed={whatIfSpeed} whatIfAngle={whatIfAngle} whatIfDir={whatIfDir}
            />
            <OrbitControls enablePan enableZoom enableRotate target={[0, TABLE_H, 0]} minDistance={1} maxDistance={8} maxPolarAngle={Math.PI / 2.1} />
          </Suspense>
        </Canvas>
      </div>
    </div>
  );
}
