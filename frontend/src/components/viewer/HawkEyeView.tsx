"use client";

import { useRef, useMemo, useState, useCallback } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Line, Text } from "@react-three/drei";
import * as THREE from "three";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Trajectory3DPoint {
  x: number; // along table length (m), 0 = net, negative = near side, positive = far side
  y: number; // height above table (m)
  z: number; // across table width (m), 0 = center
  t: number; // time in seconds
}

export interface BouncePoint {
  x: number;
  z: number;
  t: number;
  side: "near" | "far";
}

export interface Rally {
  id: string;
  points: Trajectory3DPoint[];
  bounces: BouncePoint[];
  color: string;
  label?: string;
}

export interface HawkEyeViewProps {
  rallies: Rally[];
  activeBallIndex?: number; // which rally to animate, -1 or undefined = show all static
  showBounceMarkers?: boolean;
  showTrajectoryLines?: boolean;
  className?: string;
}

// ─── Table dimensions (meters, regulation) ───────────────────────────────────

const TABLE_LENGTH = 2.74;
const TABLE_WIDTH = 1.525;
const TABLE_HEIGHT = 0.76;
const NET_HEIGHT = 0.1525;
const TABLE_HALF_L = TABLE_LENGTH / 2;
const TABLE_HALF_W = TABLE_WIDTH / 2;

// ─── Colors ──────────────────────────────────────────────────────────────────

const COLORS = {
  tableSurface: "#0d4726",
  tableEdge: "#1a1a1a",
  tableLine: "#ffffff",
  net: "#cccccc",
  netPost: "#888888",
  floor: "#1A191B", // Keep as is - not in mapping rules
  bounceMarker: "#ff4444",
};

// ─── Table ───────────────────────────────────────────────────────────────────

function PingPongTable() {
  return (
    <group position={[0, TABLE_HEIGHT, 0]}>
      {/* Table surface */}
      <mesh position={[0, 0, 0]} receiveShadow>
        <boxGeometry args={[TABLE_LENGTH, 0.03, TABLE_WIDTH]} />
        <meshStandardMaterial color={COLORS.tableSurface} roughness={0.3} />
      </mesh>

      {/* Table edge/frame */}
      <mesh position={[0, -0.015, 0]}>
        <boxGeometry args={[TABLE_LENGTH + 0.04, 0.03, TABLE_WIDTH + 0.04]} />
        <meshStandardMaterial color={COLORS.tableEdge} roughness={0.5} />
      </mesh>

      {/* White border lines */}
      <TableLines />

      {/* Legs */}
      {[
        [-TABLE_HALF_L + 0.15, -TABLE_HEIGHT / 2, -TABLE_HALF_W + 0.1],
        [-TABLE_HALF_L + 0.15, -TABLE_HEIGHT / 2, TABLE_HALF_W - 0.1],
        [TABLE_HALF_L - 0.15, -TABLE_HEIGHT / 2, -TABLE_HALF_W + 0.1],
        [TABLE_HALF_L - 0.15, -TABLE_HEIGHT / 2, TABLE_HALF_W - 0.1],
      ].map((pos, i) => (
        <mesh key={i} position={pos as [number, number, number]}>
          <boxGeometry args={[0.05, TABLE_HEIGHT, 0.05]} />
          <meshStandardMaterial color={COLORS.tableEdge} roughness={0.6} />
        </mesh>
      ))}

      {/* Net */}
      <Net />
    </group>
  );
}

function TableLines() {
  const lineY = 0.017;

  return (
    <group>
      {/* Outer boundary */}
      {/* End lines */}
      <mesh position={[-TABLE_HALF_L, lineY, 0]}>
        <boxGeometry args={[0.02, 0.002, TABLE_WIDTH]} />
        <meshStandardMaterial color={COLORS.tableLine} />
      </mesh>
      <mesh position={[TABLE_HALF_L, lineY, 0]}>
        <boxGeometry args={[0.02, 0.002, TABLE_WIDTH]} />
        <meshStandardMaterial color={COLORS.tableLine} />
      </mesh>
      {/* Side lines */}
      <mesh position={[0, lineY, -TABLE_HALF_W]}>
        <boxGeometry args={[TABLE_LENGTH, 0.002, 0.02]} />
        <meshStandardMaterial color={COLORS.tableLine} />
      </mesh>
      <mesh position={[0, lineY, TABLE_HALF_W]}>
        <boxGeometry args={[TABLE_LENGTH, 0.002, 0.02]} />
        <meshStandardMaterial color={COLORS.tableLine} />
      </mesh>
      {/* Center line (for doubles) */}
      <mesh position={[0, lineY, 0]}>
        <boxGeometry args={[TABLE_LENGTH, 0.002, 0.005]} />
        <meshStandardMaterial
          color={COLORS.tableLine}
          transparent
          opacity={0.4}
        />
      </mesh>
    </group>
  );
}

function Net() {
  const netPoints = useMemo(() => {
    const pts: [number, number, number][] = [];
    const segments = 40;
    for (let i = 0; i <= segments; i++) {
      const z = -TABLE_HALF_W - 0.05 + ((TABLE_WIDTH + 0.1) * i) / segments;
      pts.push([0, NET_HEIGHT, z]);
    }
    return pts;
  }, []);

  return (
    <group>
      {/* Net mesh (simplified as grid lines) */}
      {/* Top line */}
      <Line
        points={[
          [0, NET_HEIGHT, -TABLE_HALF_W - 0.05],
          [0, NET_HEIGHT, TABLE_HALF_W + 0.05],
        ]}
        color={COLORS.net}
        lineWidth={1.5}
      />
      {/* Bottom line */}
      <Line
        points={[
          [0, 0.02, -TABLE_HALF_W - 0.05],
          [0, 0.02, TABLE_HALF_W + 0.05],
        ]}
        color={COLORS.net}
        lineWidth={0.5}
        transparent
        opacity={0.3}
      />
      {/* Vertical strings */}
      {Array.from({ length: 20 }).map((_, i) => {
        const z =
          -TABLE_HALF_W - 0.05 + ((TABLE_WIDTH + 0.1) * i) / 19;
        return (
          <Line
            key={i}
            points={[
              [0, 0.02, z],
              [0, NET_HEIGHT, z],
            ]}
            color={COLORS.net}
            lineWidth={0.3}
            transparent
            opacity={0.2}
          />
        );
      })}
      {/* Posts */}
      {[-TABLE_HALF_W - 0.05, TABLE_HALF_W + 0.05].map((z, i) => (
        <mesh key={i} position={[0, NET_HEIGHT / 2, z]}>
          <cylinderGeometry args={[0.01, 0.01, NET_HEIGHT, 8]} />
          <meshStandardMaterial color={COLORS.netPost} />
        </mesh>
      ))}
    </group>
  );
}

// ─── Floor ───────────────────────────────────────────────────────────────────

function Floor() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
      <planeGeometry args={[8, 6]} />
      <meshStandardMaterial color={COLORS.floor} roughness={0.9} />
    </mesh>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Downsample an array to at most maxCount evenly-spaced items (always keeps first & last)
function downsample<T>(arr: T[], maxCount: number): T[] {
  if (arr.length <= maxCount) return arr;
  const result: T[] = [arr[0]];
  const step = (arr.length - 1) / (maxCount - 1);
  for (let i = 1; i < maxCount - 1; i++) {
    result.push(arr[Math.round(i * step)]);
  }
  result.push(arr[arr.length - 1]);
  return result;
}

// ─── Trajectory Arc ──────────────────────────────────────────────────────────

function TrajectoryArc({ rally, showBounces }: { rally: Rally; showBounces: boolean }) {
  // Downsample to max 80 control points to keep CatmullRom fast
  const controlPoints = useMemo(() => {
    if (rally.points.length < 2) return [];
    const sampled = downsample(rally.points, 80);
    return sampled.map(
      (p) => new THREE.Vector3(p.x, TABLE_HEIGHT + p.y, p.z)
    );
  }, [rally.points]);

  const curvePoints = useMemo(() => {
    if (controlPoints.length < 2) return [];
    const curve = new THREE.CatmullRomCurve3(controlPoints, false, "catmullrom", 0.3);
    return curve.getPoints(200); // fixed 200 interpolated points
  }, [controlPoints]);

  const mainLine = useMemo(
    () => curvePoints.map((p) => [p.x, p.y, p.z] as [number, number, number]),
    [curvePoints]
  );

  const shadowLine = useMemo(
    () => curvePoints.map((p) => [p.x, TABLE_HEIGHT + 0.018, p.z] as [number, number, number]),
    [curvePoints]
  );

  if (mainLine.length < 2) return null;

  return (
    <group>
      {/* Main trajectory line */}
      <Line
        points={mainLine}
        color={rally.color}
        lineWidth={2}
        transparent
        opacity={0.85}
      />

      {/* Shadow on table */}
      <Line
        points={shadowLine}
        color={rally.color}
        lineWidth={1}
        transparent
        opacity={0.15}
      />

      {/* Bounce markers */}
      {showBounces &&
        rally.bounces.map((b, i) => (
          <BounceMarker key={i} x={b.x} z={b.z} color={rally.color} />
        ))}
    </group>
  );
}

// ─── Bounce Marker ───────────────────────────────────────────────────────────

function BounceMarker({ x, z, color }: { x: number; z: number; color: string }) {
  const ringRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (!ringRef.current) return;
    const pulse = 1 + Math.sin(state.clock.elapsedTime * 4) * 0.1;
    ringRef.current.scale.setScalar(pulse);
  });

  return (
    <group position={[x, TABLE_HEIGHT + 0.018, z]}>
      {/* Filled dot */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.015, 16]} />
        <meshBasicMaterial color={color} />
      </mesh>
      {/* Pulsing ring */}
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.02, 0.028, 24]} />
        <meshBasicMaterial color={color} transparent opacity={0.5} />
      </mesh>
    </group>
  );
}

// ─── Animated Ball ───────────────────────────────────────────────────────────

const TRAIL_LENGTH = 50;

function AnimatedBall({ rally }: { rally: Rally }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const trailGeoRef = useRef<THREE.BufferGeometry>(null);
  const trailIdxRef = useRef(0);

  const totalDuration = useMemo(() => {
    if (rally.points.length < 2) return 1;
    return rally.points[rally.points.length - 1].t - rally.points[0].t;
  }, [rally.points]);

  const curve = useMemo(() => {
    if (rally.points.length < 2) return null;
    const sampled = downsample(rally.points, 80);
    const pts = sampled.map(
      (p) => new THREE.Vector3(p.x, TABLE_HEIGHT + p.y, p.z)
    );
    return new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.3);
  }, [rally.points]);

  // Pre-allocate trail buffer
  const trailPositions = useMemo(() => new Float32Array(TRAIL_LENGTH * 3), []);

  useFrame((state) => {
    if (!meshRef.current || !curve) return;
    const loopDuration = totalDuration + 1;
    const t = (state.clock.elapsedTime % loopDuration) / totalDuration;
    const clampedT = Math.min(Math.max(t, 0), 1);

    try {
      const pos = curve.getPointAt(clampedT);
      meshRef.current.position.copy(pos);

      if (glowRef.current) {
        glowRef.current.position.copy(pos);
        const pulse = 1 + Math.sin(state.clock.elapsedTime * 8) * 0.2;
        glowRef.current.scale.setScalar(pulse);
      }

      // Update trail imperatively (no React state)
      if (trailGeoRef.current) {
        const idx = trailIdxRef.current % TRAIL_LENGTH;
        trailPositions[idx * 3] = pos.x;
        trailPositions[idx * 3 + 1] = pos.y;
        trailPositions[idx * 3 + 2] = pos.z;
        trailIdxRef.current++;

        const attr = trailGeoRef.current.getAttribute("position");
        if (attr) {
          (attr as THREE.BufferAttribute).set(trailPositions);
          (attr as THREE.BufferAttribute).needsUpdate = true;
        }
        const count = Math.min(trailIdxRef.current, TRAIL_LENGTH);
        trailGeoRef.current.setDrawRange(0, count);
      }
    } catch {
      // Silently handle any curve interpolation edge cases
    }
  });

  if (!curve) return null;

  return (
    <group>
      {/* Trail rendered imperatively via buffer geometry */}
      <line>
        <bufferGeometry ref={trailGeoRef}>
          <bufferAttribute
            attach="attributes-position"
            args={[trailPositions, 3]}
            count={TRAIL_LENGTH}
          />
        </bufferGeometry>
        <lineBasicMaterial
          color={rally.color}
          transparent
          opacity={0.4}
        />
      </line>
      {/* Glow */}
      <mesh ref={glowRef}>
        <sphereGeometry args={[0.025, 16, 16]} />
        <meshBasicMaterial color={rally.color} transparent opacity={0.2} />
      </mesh>
      {/* Ball */}
      <mesh ref={meshRef}>
        <sphereGeometry args={[0.02, 16, 16]} />
        <meshStandardMaterial
          color="#f5f0e8"
          emissive={rally.color}
          emissiveIntensity={0.3}
          roughness={0.2}
          metalness={0.1}
        />
      </mesh>
    </group>
  );
}

// ─── Scene Labels ────────────────────────────────────────────────────────────

function SceneLabels() {
  return (
    <group>
      <Text
        position={[-TABLE_HALF_L - 0.3, TABLE_HEIGHT + 0.02, 0]}
        rotation={[-Math.PI / 2, 0, Math.PI / 2]}
        fontSize={0.06}
        color="#8A8885"
        anchorX="center"
      >
        Near Side
      </Text>
      <Text
        position={[TABLE_HALF_L + 0.3, TABLE_HEIGHT + 0.02, 0]}
        rotation={[-Math.PI / 2, 0, -Math.PI / 2]}
        fontSize={0.06}
        color="#8A8885"
        anchorX="center"
      >
        Far Side
      </Text>
    </group>
  );
}

// ─── Lighting ────────────────────────────────────────────────────────────────

function Lighting() {
  return (
    <>
      <ambientLight intensity={0.4} />
      <directionalLight position={[3, 5, 2]} intensity={0.8} castShadow />
      <directionalLight position={[-2, 3, -1]} intensity={0.3} />
      <pointLight position={[0, 3, 0]} intensity={0.4} color="#ffffff" />
    </>
  );
}

// ─── Main Scene ──────────────────────────────────────────────────────────────

function HawkEyeScene({
  rallies,
  activeBallIndex,
  showBounceMarkers = true,
  showTrajectoryLines = true,
}: Omit<HawkEyeViewProps, "className">) {
  return (
    <>
      <Lighting />
      <Floor />
      <PingPongTable />
      <SceneLabels />

      {rallies.map((rally, i) => (
        <group key={rally.id}>
          {showTrajectoryLines && (
            <TrajectoryArc rally={rally} showBounces={showBounceMarkers} />
          )}
          {activeBallIndex === i && <AnimatedBall rally={rally} />}
        </group>
      ))}

      <OrbitControls
        enablePan
        enableZoom
        enableRotate
        minDistance={1}
        maxDistance={8}
        minPolarAngle={0.1}
        maxPolarAngle={Math.PI / 2 - 0.05}
        target={[0, TABLE_HEIGHT, 0]}
      />
    </>
  );
}

// ─── Legend ───────────────────────────────────────────────────────────────────

function Legend({
  rallies,
  activeBallIndex,
  onRallyClick,
}: {
  rallies: Rally[];
  activeBallIndex: number;
  onRallyClick: (i: number) => void;
}) {
  return (
    <div className="absolute top-3 left-3 z-10 flex flex-col gap-1.5">
      {rallies.map((r, i) => (
        <button
          key={r.id}
          onClick={() => onRallyClick(i)}
          className={`flex items-center gap-2 px-2.5 py-1 rounded text-left transition-all ${
            activeBallIndex === i
              ? "bg-black/60 backdrop-blur-sm ring-1 ring-[#9B7B5B]/50"
              : "bg-black/30 backdrop-blur-sm hover:bg-black/50"
          }`}
        >
          <div
            className="w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: r.color }}
          />
          <span className="text-[10px] text-foreground">
            {r.label || `Rally ${i + 1}`}
          </span>
          <span className="text-[9px] text-muted-foreground ml-1">
            {r.bounces.length} bounces
          </span>
        </button>
      ))}
    </div>
  );
}

// ─── Stats Panel ─────────────────────────────────────────────────────────────

function StatsPanel({ rally }: { rally: Rally | null }) {
  if (!rally) return null;

  const duration =
    rally.points.length > 1
      ? (rally.points[rally.points.length - 1].t - rally.points[0].t).toFixed(2)
      : "0";
  const maxHeight = Math.max(...rally.points.map((p) => p.y)).toFixed(3);
  const totalBounces = rally.bounces.length;

  return (
    <div className="absolute bottom-3 left-3 z-10 bg-black/50 backdrop-blur-sm rounded-lg px-3 py-2">
      <div className="text-[10px] text-[#9B7B5B] font-medium mb-1">
        {rally.label || rally.id}
      </div>
      <div className="flex gap-4">
        <div>
          <div className="text-[9px] text-muted-foreground">Duration</div>
          <div className="text-[11px] text-foreground">{duration}s</div>
        </div>
        <div>
          <div className="text-[9px] text-muted-foreground">Max Height</div>
          <div className="text-[11px] text-foreground">{maxHeight}m</div>
        </div>
        <div>
          <div className="text-[9px] text-muted-foreground">Bounces</div>
          <div className="text-[11px] text-foreground">{totalBounces}</div>
        </div>
        <div>
          <div className="text-[9px] text-muted-foreground">Points</div>
          <div className="text-[11px] text-foreground">{rally.points.length}</div>
        </div>
      </div>
    </div>
  );
}

// ─── Export ──────────────────────────────────────────────────────────────────

export function HawkEyeView({
  rallies,
  activeBallIndex: initialActive,
  showBounceMarkers = true,
  showTrajectoryLines = true,
  className,
}: HawkEyeViewProps) {
  const [activeBallIndex, setActiveBallIndex] = useState(initialActive ?? 0);

  const handleRallyClick = useCallback(
    (i: number) => {
      setActiveBallIndex(activeBallIndex === i ? -1 : i);
    },
    [activeBallIndex]
  );

  const activeRally = activeBallIndex >= 0 && activeBallIndex < rallies.length
    ? rallies[activeBallIndex]
    : null;

  return (
    <div className={`relative rounded-xl overflow-hidden bg-sidebar ${className || ""}`}>
      <Legend
        rallies={rallies}
        activeBallIndex={activeBallIndex}
        onRallyClick={handleRallyClick}
      />
      <StatsPanel rally={activeRally} />

      {/* View hint */}
      <div className="absolute top-3 right-3 z-10 text-[9px] text-muted-foreground bg-black/30 backdrop-blur-sm px-2 py-1 rounded">
        Drag to rotate · Scroll to zoom
      </div>

      <Canvas
        camera={{
          position: [2.5, 2.5, 2.5],
          fov: 45,
          near: 0.1,
          far: 50,
        }}
        shadows
        gl={{ antialias: true, alpha: true }}
        dpr={[1, 2]}
        style={{ background: "var(--sidebar)" }}
      >
        <HawkEyeScene
          rallies={rallies}
          activeBallIndex={activeBallIndex}
          showBounceMarkers={showBounceMarkers}
          showTrajectoryLines={showTrajectoryLines}
        />
      </Canvas>
    </div>
  );
}
