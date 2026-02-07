"use client";

import { memo, useMemo, useCallback, useRef, useState } from "react";

export interface ActivityMarker {
  /** Normalized position 0–1 along the timeline */
  position: number;
  /** Normalized intensity 0–1 (height of the bar) */
  intensity: number;
  /** Color of this bar */
  color: string;
  /** Tooltip text */
  label: string;
  /** Seek time in seconds */
  time: number;
  /** Category for layering */
  type: "stroke" | "velocity" | "point";
  /** Stroke subtype for color coding */
  strokeType?: "forehand" | "backhand" | "unknown";
}

export interface ActivityRegionData {
  start_frame: number;
  end_frame: number;
  start_time: number;
  end_time: number;
  peak_score: number;
  type: "rally" | "point" | "stroke_cluster" | "high_speed";
  label: string;
}

interface ActivityTimelineProps {
  /** Current playback time in seconds */
  currentTime: number;
  /** Total video duration in seconds */
  duration: number;
  /** Stroke markers with frame/time info */
  strokes: Array<{
    id: string;
    start_frame: number;
    end_frame: number;
    peak_frame: number;
    stroke_type: "forehand" | "backhand" | "unknown";
    form_score: number;
    max_velocity: number;
  }>;
  /** Trajectory velocity data for ball speed activity */
  velocities?: number[];
  /** Point events (scoring moments) */
  pointEvents?: Array<{
    frame: number;
    timestamp: number;
    reason: string;
  }>;
  /** Pre-computed activity regions from backend analytics */
  activityRegions?: ActivityRegionData[];
  /** Video FPS for frame-to-time conversion */
  fps: number;
  /** Total frame count */
  totalFrames: number;
  /** Called when the user seeks by clicking */
  onSeek: (time: number) => void;
}

const STROKE_COLORS = {
  forehand: "#C49A6C",   // warm bronze/gold — forehand
  backhand: "#5BB89B",   // teal green — backhand
  unknown: "#8A8885",
};

const POINT_COLOR = "#E05555";
const VELOCITY_COLOR = "rgba(91, 123, 155, 0.45)";

const REGION_COLORS: Record<string, string> = {
  rally: "rgba(91, 123, 155, 0.12)",
  point: "rgba(224, 85, 85, 0.13)",
  stroke_cluster: "rgba(196, 154, 108, 0.14)",
  high_speed: "rgba(91, 180, 180, 0.12)",
};

/**
 * ActivityTimeline — a waveform-style seek bar that shows vertical bars
 * at moments of high activity (strokes, fast ball movement, point events).
 * Bars fatten on hover for easier inspection. Color-coded by stroke type.
 */
export const ActivityTimeline = memo(function ActivityTimeline({
  currentTime,
  duration,
  strokes,
  velocities,
  pointEvents,
  activityRegions,
  fps,
  totalFrames,
  onSeek,
}: ActivityTimelineProps) {
  const timelineRef = useRef<HTMLDivElement>(null);
  const [hoverX, setHoverX] = useState<number | null>(null); // 0-1 position

  // Build activity markers from all data sources
  const markers = useMemo((): ActivityMarker[] => {
    if (!duration || duration <= 0) return [];

    const result: ActivityMarker[] = [];
    const maxFrame = totalFrames > 0 ? totalFrames : duration * fps;

    // --- Stroke activity bars (from stroke_analytics table) ---
    for (const stroke of strokes) {
      const startPos = stroke.start_frame / maxFrame;
      const endPos = stroke.end_frame / maxFrame;
      const peakPos = stroke.peak_frame / maxFrame;
      const color = STROKE_COLORS[stroke.stroke_type] || STROKE_COLORS.unknown;

      // Generate bars across the stroke range, peaking at the peak frame
      const barCount = Math.max(3, Math.round((stroke.end_frame - stroke.start_frame) / 2));
      for (let i = 0; i < barCount; i++) {
        const t = i / (barCount - 1); // 0 to 1 across the stroke
        const pos = startPos + t * (endPos - startPos);

        // Intensity: bell curve peaking at peak_frame position
        const peakT = (peakPos - startPos) / (endPos - startPos || 1);
        const dist = Math.abs(t - peakT);
        const baseIntensity = Math.exp(-(dist * dist) / 0.08); // Gaussian
        // Scale by form score (higher score = taller bars)
        const intensity = 0.3 + baseIntensity * 0.7 * Math.min(1, stroke.form_score / 100);

        result.push({
          position: Math.max(0, Math.min(1, pos)),
          intensity: Math.max(0.15, Math.min(1, intensity)),
          color,
          label: `${stroke.stroke_type} — Form ${stroke.form_score.toFixed(0)}`,
          time: (startPos + t * (endPos - startPos)) * duration,
          type: "stroke",
          strokeType: stroke.stroke_type,
        });
      }
    }

    // --- Velocity waveform (ball speed) ---
    if (velocities && velocities.length > 0) {
      const maxVel = Math.max(...velocities, 1);
      // Downsample to ~120 bars max
      const step = Math.max(1, Math.floor(velocities.length / 120));
      for (let i = 0; i < velocities.length; i += step) {
        const pos = i / velocities.length;
        const vel = velocities[i];
        const normalizedVel = vel / maxVel;
        // Only show bars above a threshold (skip calm moments)
        if (normalizedVel > 0.25) {
          result.push({
            position: pos,
            intensity: 0.1 + normalizedVel * 0.5,
            color: VELOCITY_COLOR,
            label: `Ball speed: ${vel.toFixed(1)} px/f`,
            time: pos * duration,
            type: "velocity",
          });
        }
      }
    }

    // --- Point events (scoring moments) ---
    if (pointEvents) {
      for (const evt of pointEvents) {
        const pos = evt.frame / maxFrame;
        result.push({
          position: Math.max(0, Math.min(1, pos)),
          intensity: 1.0,
          color: POINT_COLOR,
          label: `Point — ${evt.reason.replace(/_/g, " ")}`,
          time: evt.timestamp,
          type: "point",
        });
      }
    }

    return result;
  }, [strokes, velocities, pointEvents, duration, fps, totalFrames]);

  // Click handler for seeking
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = timelineRef.current;
      if (!el || !duration) return;
      const rect = el.getBoundingClientRect();
      const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      const time = (x / rect.width) * duration;
      onSeek(time);
    },
    [duration, onSeek]
  );

  // Mouse drag for scrubbing
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      handleClick(e);

      const onMove = (ev: MouseEvent) => {
        const el = timelineRef.current;
        if (!el || !duration) return;
        const rect = el.getBoundingClientRect();
        const x = Math.max(0, Math.min(ev.clientX - rect.left, rect.width));
        const time = (x / rect.width) * duration;
        onSeek(time);
      };

      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [duration, onSeek, handleClick]
  );

  // Track hover position for fatten effect
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = timelineRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    setHoverX(Math.max(0, Math.min(1, x)));
  }, []);

  const handleMouseLeave = useCallback(() => {
    setHoverX(null);
  }, []);

  const playheadPct = duration > 0 ? (currentTime / duration) * 100 : 0;

  // Group markers by type for layered rendering (velocity behind, strokes in front, points on top)
  const velocityMarkers = markers.filter((m) => m.type === "velocity");
  const strokeMarkers = markers.filter((m) => m.type === "stroke");
  const pointMarkers = markers.filter((m) => m.type === "point");

  // Compute fatten scale for a marker based on hover proximity
  const getHoverScale = (pos: number): number => {
    if (hoverX === null) return 1;
    const dist = Math.abs(pos - hoverX);
    // Bars within ~3% of cursor fatten, peak at cursor
    const radius = 0.03;
    if (dist > radius) return 1;
    return 1 + 2.5 * (1 - dist / radius); // up to 3.5x width at cursor
  };

  // Hover tooltip text
  const hoverLabel = useMemo(() => {
    if (hoverX === null) return null;
    // Find nearest stroke marker to hover position
    const radius = 0.015;
    const nearby = strokeMarkers.find((m) => Math.abs(m.position - hoverX) < radius);
    if (nearby) return nearby.label;
    const nearbyPoint = pointMarkers.find((m) => Math.abs(m.position - hoverX) < radius);
    if (nearbyPoint) return nearbyPoint.label;
    return null;
  }, [hoverX, strokeMarkers, pointMarkers]);

  return (
    <div
      ref={timelineRef}
      className="relative h-10 rounded-lg overflow-hidden cursor-pointer select-none group"
      style={{ background: "#1C1A19" }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {/* Subtle grid lines for visual rhythm */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.04]">
        {Array.from({ length: 20 }).map((_, i) => (
          <div
            key={i}
            className="absolute top-0 bottom-0 w-px bg-white"
            style={{ left: `${(i / 20) * 100}%` }}
          />
        ))}
      </div>

      {/* Activity region rectangles (behind everything) */}
      {activityRegions?.map((region, i) => {
        const startPct = duration > 0 ? (region.start_time / duration) * 100 : 0;
        const endPct = duration > 0 ? (region.end_time / duration) * 100 : 0;
        const widthPct = endPct - startPct;
        const bg = REGION_COLORS[region.type] || REGION_COLORS.rally;
        return (
          <div
            key={`r-${i}`}
            className="absolute inset-y-0 pointer-events-none"
            style={{
              left: `${startPct}%`,
              width: `${Math.max(0.3, widthPct)}%`,
              background: bg,
              borderLeft: `1px solid ${bg.replace(/[\d.]+\)$/, "0.3)")}`,
              borderRight: `1px solid ${bg.replace(/[\d.]+\)$/, "0.3)")}`,
            }}
          />
        );
      })}

      {/* Velocity waveform layer (behind) */}
      {velocityMarkers.map((m, i) => {
        const scale = getHoverScale(m.position);
        const w = 2 * scale;
        return (
          <div
            key={`v-${i}`}
            className="absolute bottom-0 pointer-events-none"
            style={{
              left: `${m.position * 100}%`,
              width: `${w}px`,
              height: `${m.intensity * 100}%`,
              background: m.color,
              transform: "translateX(-50%)",
              transition: "width 80ms ease-out",
            }}
          />
        );
      })}

      {/* Stroke activity bars — color-coded forehand/backhand */}
      {strokeMarkers.map((m, i) => {
        const scale = getHoverScale(m.position);
        const baseW = 3;
        const w = baseW * scale;
        return (
          <div
            key={`s-${i}`}
            className="absolute bottom-0 pointer-events-none"
            style={{
              left: `${m.position * 100}%`,
              width: `${w}px`,
              height: `${m.intensity * 100}%`,
              background: m.color,
              borderRadius: `${Math.max(1, w / 3)}px ${Math.max(1, w / 3)}px 0 0`,
              opacity: 0.9,
              transform: "translateX(-50%)",
              transition: "width 80ms ease-out, border-radius 80ms ease-out",
              boxShadow: scale > 1.5 ? `0 0 4px ${m.color}44` : "none",
            }}
          />
        );
      })}

      {/* Point event markers — full-height accent lines */}
      {pointMarkers.map((m, i) => {
        const scale = getHoverScale(m.position);
        const w = Math.max(2, 2 * scale);
        return (
          <div
            key={`p-${i}`}
            className="absolute top-0 bottom-0 pointer-events-none"
            style={{
              left: `${m.position * 100}%`,
              width: `${w}px`,
              background: `linear-gradient(180deg, ${m.color}00, ${m.color}88, ${m.color}cc)`,
              transform: "translateX(-50%)",
              transition: "width 80ms ease-out",
            }}
          >
            {/* Diamond marker at top */}
            <div
              className="absolute -top-0.5 left-1/2 -translate-x-1/2 rotate-45"
              style={{
                background: m.color,
                width: `${Math.max(6, 6 * Math.min(scale, 2))}px`,
                height: `${Math.max(6, 6 * Math.min(scale, 2))}px`,
                transition: "width 80ms ease-out, height 80ms ease-out",
              }}
            />
          </div>
        );
      })}

      {/* Played region tint */}
      <div
        className="absolute inset-y-0 left-0 pointer-events-none"
        style={{
          width: `${playheadPct}%`,
          background: "rgba(155, 123, 91, 0.06)",
        }}
      />

      {/* Playhead — thin white line */}
      <div
        className="absolute top-0 bottom-0 z-10 pointer-events-none"
        style={{
          left: `calc(${playheadPct}% - 1px)`,
          width: "2px",
        }}
      >
        <div className="w-[2px] h-full bg-white shadow-[0_0_6px_rgba(255,255,255,0.5)]" />
        {/* Top arrow */}
        <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[3px] border-r-[3px] border-t-[5px] border-transparent border-t-white" />
      </div>

      {/* Hover tooltip */}
      {hoverX !== null && hoverLabel && (
        <div
          className="absolute z-30 pointer-events-none -top-7 px-1.5 py-0.5 rounded text-[9px] font-medium whitespace-nowrap bg-[#282729] text-[#E8E6E3] border border-[#363436] shadow-lg"
          style={{
            left: `${hoverX * 100}%`,
            transform: "translateX(-50%)",
          }}
        >
          {hoverLabel}
        </div>
      )}

      {/* Hover time indicator */}
      {hoverX !== null && (
        <div
          className="absolute bottom-0 z-20 pointer-events-none"
          style={{
            left: `${hoverX * 100}%`,
            width: "1px",
            height: "100%",
            background: "rgba(255,255,255,0.15)",
            transform: "translateX(-50%)",
          }}
        />
      )}
    </div>
  );
});
