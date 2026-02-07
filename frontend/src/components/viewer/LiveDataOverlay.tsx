"use client";

import { Activity, Target, Zap } from "lucide-react";
import { useMemo } from "react";

interface LiveDataOverlayProps {
  currentFrame: number;
  fps: number;
  playerPosition?: { x: number; y: number };
  velocity?: number;
  action?: string;
  ballControl?: number;
}

/**
 * PlayVision-style persistent data overlay
 * Shows real-time player/ball metrics in corners
 */
export function LiveDataOverlay({
  currentFrame,
  fps,
  playerPosition,
  velocity,
  action,
  ballControl,
}: LiveDataOverlayProps) {
  const currentTime = useMemo(() => (currentFrame / fps).toFixed(2), [currentFrame, fps]);

  return (
    <>
      {/* Top-Left: Current Action */}
      {action && (
        <div
          className="absolute top-6 left-6 pointer-events-none"
          style={{
            zIndex: 9999,
            isolation: 'isolate',
          }}
        >
          <div
            className="backdrop-blur-2xl backdrop-saturate-150 bg-[#1A1614]/85 border-2 border-[#9B7B5B]/70 rounded-2xl px-5 py-4 shadow-2xl"
            style={{
              boxShadow: '0 20px 50px rgba(0,0,0,0.6), 0 0 0 1px rgba(155,123,91,0.2) inset',
            }}
          >
            <div className="flex items-center gap-2.5 mb-2">
              <Activity className="w-4 h-4 text-[#9B7B5B]" />
              <span className="text-[10px] text-[#8A8885] uppercase tracking-widest font-semibold">
                Current Action
              </span>
            </div>
            <p className="text-lg font-bold text-white uppercase tracking-wide">
              {action}
            </p>
          </div>
        </div>
      )}

      {/* Top-Right: Position */}
      {playerPosition && (
        <div
          className="absolute top-6 right-6 pointer-events-none"
          style={{
            zIndex: 9999,
            isolation: 'isolate',
          }}
        >
          <div
            className="backdrop-blur-2xl backdrop-saturate-150 bg-[#1A1614]/85 border-2 border-[#5B9B7B]/70 rounded-2xl px-5 py-4 shadow-2xl"
            style={{
              boxShadow: '0 20px 50px rgba(0,0,0,0.6), 0 0 0 1px rgba(91,155,123,0.2) inset',
            }}
          >
            <div className="flex items-center gap-2.5 mb-2">
              <Target className="w-4 h-4 text-[#5B9B7B]" />
              <span className="text-[10px] text-[#8A8885] uppercase tracking-widest font-semibold">
                Position
              </span>
            </div>
            <p className="text-sm font-bold text-white font-mono">
              X: {Math.round(playerPosition.x)} Y: {Math.round(playerPosition.y)}
            </p>
          </div>
        </div>
      )}

      {/* Bottom-Left: Velocity */}
      {velocity !== undefined && (
        <div
          className="absolute bottom-24 left-6 pointer-events-none"
          style={{
            zIndex: 9999,
            isolation: 'isolate',
          }}
        >
          <div
            className="backdrop-blur-2xl backdrop-saturate-150 bg-[#1A1614]/85 border-2 border-[#9B7B5B]/70 rounded-2xl px-5 py-4 shadow-2xl"
            style={{
              boxShadow: '0 20px 50px rgba(0,0,0,0.6), 0 0 0 1px rgba(155,123,91,0.2) inset',
            }}
          >
            <div className="flex items-center gap-2.5 mb-2">
              <Zap className="w-4 h-4 text-[#9B7B5B]" />
              <span className="text-[10px] text-[#8A8885] uppercase tracking-widest font-semibold">
                Velocity
              </span>
            </div>
            <p className="text-lg font-bold text-white">
              {velocity.toFixed(2)} <span className="text-sm text-[#8A8885]">m/s</span>
            </p>
          </div>
        </div>
      )}

      {/* Bottom-Right: Ball Control Time */}
      {ballControl !== undefined && (
        <div
          className="absolute bottom-24 right-6 pointer-events-none"
          style={{
            zIndex: 9999,
            isolation: 'isolate',
          }}
        >
          <div
            className="backdrop-blur-2xl backdrop-saturate-150 bg-[#1A1614]/85 border-2 border-[#5B9B7B]/70 rounded-2xl px-5 py-4 shadow-2xl"
            style={{
              boxShadow: '0 20px 50px rgba(0,0,0,0.6), 0 0 0 1px rgba(91,155,123,0.2) inset',
            }}
          >
            <div className="flex items-center gap-2.5 mb-2">
              <Activity className="w-4 h-4 text-[#5B9B7B]" />
              <span className="text-[10px] text-[#8A8885] uppercase tracking-widest font-semibold">
                Ball Control
              </span>
            </div>
            <p className="text-lg font-bold text-white">
              {ballControl.toFixed(2)}<span className="text-sm text-[#8A8885]">s</span>
            </p>
          </div>
        </div>
      )}
    </>
  );
}
