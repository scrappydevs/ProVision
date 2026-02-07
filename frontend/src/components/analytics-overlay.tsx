'use client';

import { useRef, useMemo, Suspense, useState, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Line } from '@react-three/drei';

// Flowing motion signature - elegant waveform representing player movement/velocity
function MotionSignature({ position, scale = 1 }: { position: [number, number, number], scale?: number }) {
  const [points, setPoints] = useState<[number, number, number][]>(() => {
    const pts: [number, number, number][] = [];
    for (let i = 0; i < 100; i++) {
      pts.push([(i / 100 - 0.5) * 2.5, 0, 0]);
    }
    return pts;
  });

  useFrame((state) => {
    const time = state.clock.getElapsedTime();
    const newPoints: [number, number, number][] = [];
    
    for (let i = 0; i < 100; i++) {
      const t = i / 100;
      const x = (t - 0.5) * 2.5;
      
      // Smooth, organic wave combining multiple frequencies - more prominent
      const wave1 = Math.sin(t * Math.PI * 3 + time * 0.8) * 0.25;
      const wave2 = Math.sin(t * Math.PI * 5 - time * 0.5) * 0.12;
      const wave3 = Math.sin(t * Math.PI * 8 + time * 1.2) * 0.06;
      
      // Fade at edges for smooth appearance
      const fade = Math.sin(t * Math.PI);
      const y = (wave1 + wave2 + wave3) * fade;
      
      newPoints.push([x, y, 0]);
    }
    setPoints(newPoints);
  });

  return (
    <group position={position} scale={scale}>
      <Line 
        points={points} 
        color="#9B7B5B" 
        transparent 
        opacity={0.12} 
        lineWidth={2}
      />
    </group>
  );
}

// Trajectory arc with glowing tracking dot
function TrajectoryPath({ position, scale = 1 }: { position: [number, number, number], scale?: number }) {
  const dotRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  
  const arcPoints = useMemo(() => {
    const points: [number, number, number][] = [];
    for (let i = 0; i <= 50; i++) {
      const t = i / 50;
      const x = t * 2 - 1;
      // Smooth parabolic arc
      const y = -3 * Math.pow(t - 0.5, 2) + 0.75;
      points.push([x, y * 0.5, 0]);
    }
    return points;
  }, []);

  useFrame((state) => {
    if (!dotRef.current || !glowRef.current) return;
    const time = state.clock.getElapsedTime();
    
    // Smooth back-and-forth motion
    const t = (Math.sin(time * 0.6) + 1) / 2;
    const x = t * 2 - 1;
    const y = (-3 * Math.pow(t - 0.5, 2) + 0.75) * 0.5;
    
    dotRef.current.position.set(x, y, 0);
    glowRef.current.position.set(x, y, 0);
    
    // Pulse the glow
    const pulse = 1 + Math.sin(time * 3) * 0.2;
    glowRef.current.scale.setScalar(pulse);
  });

  return (
    <group position={position} scale={scale}>
      {/* Arc path */}
      <Line 
        points={arcPoints} 
        color="#6A6865" 
        transparent 
        opacity={0.25} 
        lineWidth={1}
      />
      {/* Outer glow */}
      <mesh ref={glowRef}>
        <circleGeometry args={[0.08, 24]} />
        <meshBasicMaterial color="#9B7B5B" transparent opacity={0.15} />
      </mesh>
      {/* Tracking dot */}
      <mesh ref={dotRef}>
        <circleGeometry args={[0.035, 20]} />
        <meshBasicMaterial color="#9B7B5B" transparent opacity={0.6} />
      </mesh>
    </group>
  );
}

// Minimal performance ring - single elegant arc gauge
function PerformanceRing({ position, value = 85 }: { position: [number, number, number], value?: number }) {
  const [currentValue, setCurrentValue] = useState(value);
  
  useFrame((state) => {
    const time = state.clock.getElapsedTime();
    // Subtle fluctuation
    setCurrentValue(value + Math.sin(time * 0.8) * 2);
  });

  const bgPoints = useMemo(() => {
    const pts: [number, number, number][] = [];
    for (let i = 0; i <= 60; i++) {
      const angle = -Math.PI * 0.7 + (i / 60) * Math.PI * 1.4;
      pts.push([Math.cos(angle) * 0.35, Math.sin(angle) * 0.35, 0]);
    }
    return pts;
  }, []);

  const arcPoints = useMemo(() => {
    const pts: [number, number, number][] = [];
    const extent = (currentValue / 100) * 1.4 * Math.PI;
    const segmentCount = Math.max(2, Math.floor(40 * (currentValue / 100)));
    for (let i = 0; i <= segmentCount; i++) {
      const angle = -Math.PI * 0.7 + (i / segmentCount) * extent;
      pts.push([Math.cos(angle) * 0.35, Math.sin(angle) * 0.35, 0]);
    }
    return pts;
  }, [currentValue]);

  return (
    <group position={position}>
      {/* Background arc */}
      <Line points={bgPoints} color="#363436" transparent opacity={0.2} lineWidth={2} />
      {/* Value arc */}
      {arcPoints.length >= 2 && (
        <Line points={arcPoints} color="#9B7B5B" transparent opacity={0.45} lineWidth={2.5} />
      )}
    </group>
  );
}

function AnalyticsScene() {
  return null;
}

export function AnalyticsOverlay() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Don't render anything on server or before mount
  if (!mounted) return null;

  return (
    <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 5 }}>
      <Canvas
        camera={{ 
          position: [0, 0, 5], 
          fov: 50,
        }}
        gl={{
          alpha: true,
          antialias: true,
          powerPreference: 'default',
        }}
        dpr={[1, 1.5]}
        frameloop="always"
        style={{ background: 'transparent' }}
      >
        <Suspense fallback={null}>
          <AnalyticsScene />
        </Suspense>
      </Canvas>
    </div>
  );
}
