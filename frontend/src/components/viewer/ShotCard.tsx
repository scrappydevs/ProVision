"use client";

import { memo, useMemo } from "react";
import { motion } from "framer-motion";
import { Stroke } from "@/lib/api";

interface ShotCardProps {
  stroke: Stroke;
  index: number;
  totalStrokes: number;
  sessionMaxVelocity: number;
  onDismiss: () => void;
}

const STROKE_LABELS: Record<string, string> = {
  forehand: "FH",
  backhand: "BH",
  serve: "SV",
  unknown: "—",
};

const STROKE_NAMES: Record<string, string> = {
  forehand: "Forehand",
  backhand: "Backhand",
  serve: "Serve",
  unknown: "Unknown",
};

function scoreColor(score: number): string {
  if (score >= 85) return "#6B8E6B";
  if (score >= 70) return "#9B7B5B";
  return "#C45C5C";
}

function FormArc({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(100, score));
  const color = scoreColor(clamped);

  // Arc geometry: 180-degree arc at the top (from left to right)
  const cx = 52;
  const cy = 48;
  const r = 34;
  const startAngle = Math.PI;       // left
  const endAngle = 0;               // right (sweeps top)
  const totalArc = Math.PI;         // 180 degrees
  const circumference = totalArc * r;
  const filled = (clamped / 100) * circumference;
  const offset = circumference - filled;

  // SVG arc path (drawn from startAngle to endAngle, counter-clockwise visually = top arc)
  const x1 = cx + r * Math.cos(startAngle);
  const y1 = cy - r * Math.sin(startAngle);
  const x2 = cx + r * Math.cos(endAngle);
  const y2 = cy - r * Math.sin(endAngle);

  const bgPath = `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`;

  return (
    <svg viewBox="0 0 104 58" className="w-full" style={{ maxWidth: 140 }}>
      {/* Background arc */}
      <path
        d={bgPath}
        fill="none"
        stroke="#363436"
        strokeWidth={3}
        strokeLinecap="round"
      />
      {/* Value arc */}
      <path
        d={bgPath}
        fill="none"
        stroke={color}
        strokeWidth={3}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        style={{ transition: "stroke-dashoffset 0.6s cubic-bezier(0.17, 0.67, 0.27, 1)" }}
      />
      {/* Score number */}
      <text
        x={cx}
        y={cy - 4}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="#E8E6E3"
        fontSize={18}
        fontWeight={300}
        fontFamily="var(--font-geist-mono), ui-monospace, monospace"
      >
        {Math.round(clamped)}
      </text>
      {/* Label */}
      <text
        x={cx}
        y={cy + 10}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="#6A6865"
        fontSize={7}
        fontWeight={500}
        letterSpacing={1.2}
        fontFamily="var(--font-geist-sans), system-ui, sans-serif"
      >
        FORM
      </text>
    </svg>
  );
}

function SpeedBar({ velocity, maxVelocity }: { velocity: number; maxVelocity: number }) {
  const pct = maxVelocity > 0 ? Math.min(100, (velocity / maxVelocity) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground w-10 shrink-0">Speed</span>
      <div className="flex-1 h-1 rounded-full bg-border/60">
        <div
          className="h-full rounded-full bg-[#9B7B5B]"
          style={{
            width: `${pct}%`,
            transition: "width 0.5s cubic-bezier(0.17, 0.67, 0.27, 1)",
          }}
        />
      </div>
      <span className="text-[10px] font-mono text-muted-foreground w-12 text-right shrink-0">
        {velocity.toFixed(0)} px/f
      </span>
    </div>
  );
}

const METRIC_KEYS: { key: keyof Stroke["metrics"]; label: string; unit: string }[] = [
  { key: "elbow_angle", label: "Elbow", unit: "\u00B0" },
  { key: "shoulder_rotation", label: "Shoulder rot", unit: "\u00B0" },
  { key: "hip_rotation", label: "Hip rot", unit: "\u00B0" },
  { key: "spine_lean", label: "Spine lean", unit: "\u00B0" },
];

export const ShotCard = memo(function ShotCard({
  stroke,
  index,
  totalStrokes,
  sessionMaxVelocity,
  onDismiss,
}: ShotCardProps) {
  const label = STROKE_LABELS[stroke.stroke_type] ?? "—";
  const name = STROKE_NAMES[stroke.stroke_type] ?? "Unknown";

  const badgeColor = useMemo(() => {
    switch (stroke.stroke_type) {
      case "forehand": return "rgba(155, 123, 91, 0.2)";
      case "backhand": return "rgba(91, 155, 123, 0.2)";
      case "unknown": return "rgba(91, 123, 155, 0.2)";
      default: return "rgba(106, 104, 101, 0.2)";
    }
  }, [stroke.stroke_type]);

  const badgeText = useMemo(() => {
    switch (stroke.stroke_type) {
      case "forehand": return "#9B7B5B";
      case "backhand": return "#5B9B7B";
      case "unknown": return "#5B7B9B";
      default: return "#6A6865";
    }
  }, [stroke.stroke_type]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ type: "spring", damping: 28, stiffness: 340, mass: 0.8 }}
      className="glass-shot-card absolute top-3 right-3 z-10 w-[248px] p-3"
    >
      {/* Shimmer */}
      <div className="glass-shimmer" />

      {/* Content sits above pseudo-elements */}
      <div className="relative z-[3] space-y-3">
        {/* Header: type badge + shot index + dismiss */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className="inline-flex items-center justify-center px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide"
              style={{ background: badgeColor, color: badgeText }}
            >
              {label}
            </span>
            <span className="text-[11px] text-foreground font-light">
              {name}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground font-mono">
              {index}/{totalStrokes}
            </span>
            <button
              onClick={onDismiss}
              className="w-5 h-5 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-border/40 transition-colors"
            >
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                <path d="M1 1L7 7M7 1L1 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        {/* Form arc gauge */}
        <div className="flex justify-center">
          <FormArc score={stroke.form_score} />
        </div>

        {/* Speed bar */}
        <SpeedBar velocity={stroke.max_velocity} maxVelocity={sessionMaxVelocity} />

        {/* Duration */}
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Duration</span>
          <span className="text-[10px] font-mono text-foreground">
            {stroke.duration.toFixed(2)}s
          </span>
        </div>

        {/* Divider */}
        <div className="h-px bg-border/40" />

        {/* Metrics grid */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          {METRIC_KEYS.map(({ key, label: metricLabel, unit }) => {
            const val = stroke.metrics[key];
            if (val === undefined || val === null) return null;
            return (
              <div key={key} className="flex items-baseline justify-between">
                <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
                  {metricLabel}
                </span>
                <span className="text-[11px] font-mono text-foreground">
                  {typeof val === "number" ? val.toFixed(1) : val}{unit}
                </span>
              </div>
            );
          })}
        </div>

        {/* Frame range */}
        <div className="flex items-center justify-between pt-0.5">
          <span className="text-[9px] text-muted-foreground font-mono">
            f{stroke.start_frame}–{stroke.end_frame}
          </span>
          <span className="text-[9px] text-muted-foreground font-mono">
            peak f{stroke.peak_frame}
          </span>
        </div>
      </div>
    </motion.div>
  );
});
