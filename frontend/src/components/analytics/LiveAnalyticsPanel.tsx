"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getMatchAnalytics, StrokeEvent } from "@/lib/api";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, LineChart, Line,
} from "recharts";
import {
  Hand, Target, TrendingDown, Minus, Plus, ChevronDown, ChevronUp,
  Zap, RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface LiveAnalyticsPanelProps {
  sessionId: string;
  currentFrame: number;
  totalFrames: number;
  players?: Array<{ id: string; name: string; avatar_url?: string }>;
}

const COLORS = {
  forehand: "#9B7B5B",
  backhand: "#6B8E6B",
  grid: "#363436",
  accent: "#9B7B5B",
  danger: "#C45C5C",
};

function computeStats(strokes: StrokeEvent[]) {
  const fh = strokes.filter((s) => s.type === "forehand");
  const bh = strokes.filter((s) => s.type === "backhand");
  const rightCount = strokes.filter((s) => s.hand === "right").length;
  const leftCount = strokes.filter((s) => s.hand === "left").length;
  const total = strokes.length;

  let dominantHand = "unknown";
  if (rightCount > leftCount) dominantHand = "right";
  else if (leftCount > rightCount) dominantHand = "left";
  else if (total > 0) dominantHand = "ambidextrous";

  let weakerSide: string | null = null;
  if (total > 3) {
    const fhRatio = fh.length / total;
    const fhAvgConf = fh.length ? fh.reduce((a, s) => a + s.confidence, 0) / fh.length : 0;
    const bhAvgConf = bh.length ? bh.reduce((a, s) => a + s.confidence, 0) / bh.length : 0;
    if (fhRatio < 0.3) weakerSide = "forehand";
    else if (fhRatio > 0.7) weakerSide = "backhand";
    else if (fhAvgConf < bhAvgConf - 0.1) weakerSide = "forehand";
    else if (bhAvgConf < fhAvgConf - 0.1) weakerSide = "backhand";
  }

  const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  return {
    forehandCount: fh.length,
    backhandCount: bh.length,
    total,
    dominantHand,
    weakerSide,
    forehandAvgElbow: Math.round(avg(fh.map((s) => s.elbow_angle)) * 10) / 10,
    backhandAvgElbow: Math.round(avg(bh.map((s) => s.elbow_angle)) * 10) / 10,
    forehandAvgConf: Math.round(avg(fh.map((s) => s.confidence)) * 100),
    backhandAvgConf: Math.round(avg(bh.map((s) => s.confidence)) * 100),
    forehandAvgElbowVel: Math.round(avg(fh.map((s) => s.elbow_velocity)) * 10) / 10,
    backhandAvgElbowVel: Math.round(avg(bh.map((s) => s.elbow_velocity)) * 10) / 10,
    forehandAvgShoulderRot: Math.round(avg(fh.map((s) => Math.abs(s.shoulder_rotation_delta))) * 10) / 10,
    backhandAvgShoulderRot: Math.round(avg(bh.map((s) => Math.abs(s.shoulder_rotation_delta))) * 10) / 10,
  };
}

export function LiveAnalyticsPanel({
  sessionId,
  currentFrame,
  totalFrames,
  players,
}: LiveAnalyticsPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [scores, setScores] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {};
    players?.forEach((p) => (initial[p.id] = 0));
    if (Object.keys(initial).length === 0) {
      initial["player1"] = 0;
      initial["player2"] = 0;
    }
    return initial;
  });

  const { data: analytics } = useQuery({
    queryKey: ["match-analytics", sessionId],
    queryFn: async () => {
      const res = await getMatchAnalytics(sessionId);
      return res.data;
    },
    staleTime: 60_000,
  });

  const allStrokes = analytics?.strokes ?? [];

  // Frame-reactive: only count strokes up to the current frame
  const activeStrokes = useMemo(
    () => allStrokes.filter((s) => s.frame <= currentFrame),
    [allStrokes, currentFrame]
  );

  const stats = useMemo(() => computeStats(activeStrokes), [activeStrokes]);

  // Last stroke event (for "latest hit" display)
  const lastStroke = activeStrokes.length > 0 ? activeStrokes[activeStrokes.length - 1] : null;

  // Stroke accumulation over time for the line chart
  const strokeTimeline = useMemo(() => {
    let fh = 0;
    let bh = 0;
    const points: Array<{ frame: number; forehand: number; backhand: number }> = [];
    for (const s of allStrokes) {
      if (s.type === "forehand") fh++;
      else bh++;
      points.push({ frame: s.frame, forehand: fh, backhand: bh });
    }
    return points;
  }, [allStrokes]);

  const activeTimeline = useMemo(
    () => strokeTimeline.filter((p) => p.frame <= currentFrame),
    [strokeTimeline, currentFrame]
  );

  const updateScore = (id: string, delta: number) => {
    setScores((prev) => ({
      ...prev,
      [id]: Math.max(0, (prev[id] || 0) + delta),
    }));
  };

  const playerEntries = players?.length
    ? players.map((p) => ({ id: p.id, name: p.name }))
    : [
        { id: "player1", name: "Player 1" },
        { id: "player2", name: "Player 2" },
      ];

  const barData = [
    { name: "FH", count: stats.forehandCount, fill: COLORS.forehand },
    { name: "BH", count: stats.backhandCount, fill: COLORS.backhand },
  ];

  const timelineMax = Math.max(totalFrames, ...allStrokes.map((s) => s.frame), 1);

  return (
    <div className="mt-3 rounded-xl bg-card border border-border overflow-hidden">
      {/* Collapsed: compact stat row */}
      <div className="p-3">
        <div className="flex items-center gap-3">
          {/* Score */}
          <div className="flex items-center gap-2 shrink-0">
            {playerEntries.map((p, i) => (
              <div key={p.id} className="flex items-center gap-1">
                {i > 0 && (
                  <span className="text-[10px] text-muted-foreground mx-0.5">-</span>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 rounded-full"
                  onClick={() => updateScore(p.id, -1)}
                >
                  <Minus className="w-2.5 h-2.5" />
                </Button>
                <div className="text-center">
                  <span className="text-lg font-light text-foreground tabular-nums leading-none">
                    {scores[p.id] || 0}
                  </span>
                  <p className="text-[8px] text-muted-foreground leading-none mt-0.5 truncate max-w-[48px]">
                    {p.name}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 rounded-full"
                  onClick={() => updateScore(p.id, 1)}
                >
                  <Plus className="w-2.5 h-2.5" />
                </Button>
              </div>
            ))}
          </div>

          <div className="w-px h-8 bg-border shrink-0" />

          {/* Stat pills */}
          <div className="flex items-center gap-2 flex-1 min-w-0 overflow-x-auto">
            <StatPill label="FH" value={stats.forehandCount} color={COLORS.forehand} />
            <StatPill label="BH" value={stats.backhandCount} color={COLORS.backhand} />
            <StatPill
              label="Hand"
              value={stats.dominantHand === "unknown" ? "-" : stats.dominantHand.charAt(0).toUpperCase()}
              color="#E8E6E3"
              tooltip={stats.dominantHand}
            />
            {stats.weakerSide ? (
              <StatPill
                label="Weak"
                value={stats.weakerSide.charAt(0).toUpperCase() + stats.weakerSide.slice(1, 3)}
                color={COLORS.danger}
                tooltip={stats.weakerSide}
              />
            ) : stats.total > 3 ? (
              <StatPill label="Weak" value="-" color="#6B8E6B" tooltip="Balanced" />
            ) : null}
            {lastStroke && (
              <StatPill
                label="Last"
                value={lastStroke.type === "forehand" ? "FH" : "BH"}
                color={lastStroke.type === "forehand" ? COLORS.forehand : COLORS.backhand}
                tooltip={`Frame ${lastStroke.frame} | ${lastStroke.confidence * 100}% conf`}
              />
            )}
          </div>

          <button
            onClick={() => setExpanded((e) => !e)}
            className="shrink-0 p-1.5 rounded-lg hover:bg-border transition-colors text-muted-foreground hover:text-foreground"
          >
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* Stroke timeline */}
        <div className="mt-2.5 relative h-3 rounded-full bg-background overflow-hidden">
          {allStrokes.map((s, i) => {
            const pct = (s.frame / timelineMax) * 100;
            const isActive = s.frame <= currentFrame;
            return (
              <div
                key={i}
                className="absolute top-1/2 -translate-y-1/2 rounded-full"
                title={`${s.type} (${s.hand}) @ frame ${s.frame} | ${s.confidence * 100}%`}
                style={{
                  left: `${pct}%`,
                  width: 5,
                  height: 5,
                  backgroundColor: isActive
                    ? s.type === "forehand" ? COLORS.forehand : COLORS.backhand
                    : "hsl(var(--border))",
                  opacity: isActive ? 1 : 0.4,
                  transition: "background-color 0.15s, opacity 0.15s",
                }}
              />
            );
          })}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-foreground"
            style={{
              left: `${(currentFrame / timelineMax) * 100}%`,
              transition: "left 0.1s linear",
            }}
          />
        </div>
      </div>

      {/* Expanded detail section */}
      {expanded && (
        <div className="border-t border-border p-4 space-y-4">
          {/* Top cards: Hand + Weakness + Strokes bar chart */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-background p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <Hand className="w-3.5 h-3.5 text-[#9B7B5B]" />
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Dominant Hand</span>
              </div>
              <p className="text-lg font-light text-foreground capitalize">{stats.dominantHand}</p>
              <p className="text-[10px] text-muted-foreground">{stats.total} strokes at frame {currentFrame}</p>
            </div>

            <div className="rounded-lg bg-background p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <TrendingDown className="w-3.5 h-3.5 text-[#C45C5C]" />
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Weaker Side</span>
              </div>
              {stats.weakerSide ? (
                <p className="text-lg font-light text-[#C45C5C] capitalize">{stats.weakerSide}</p>
              ) : (
                <p className="text-lg font-light text-[#6B8E6B]">Balanced</p>
              )}
            </div>

            <div className="rounded-lg bg-background p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <Target className="w-3.5 h-3.5 text-[#9B7B5B]" />
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Strokes</span>
              </div>
              {stats.total > 0 ? (
                <ResponsiveContainer width="100%" height={80}>
                  <BarChart data={barData} barCategoryGap="30%">
                    <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />
                    <XAxis dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis hide />
                    <Tooltip
                      contentStyle={{ backgroundColor: "hsl(var(--background))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }}
                      labelStyle={{ color: "hsl(var(--foreground))" }}
                      itemStyle={{ color: "hsl(var(--muted-foreground))" }}
                    />
                    <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                      {barData.map((entry, idx) => (
                        <Cell key={idx} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-[10px] text-muted-foreground text-center py-4">No strokes yet</p>
              )}
            </div>
          </div>

          {/* Stroke comparison with full metrics */}
          {stats.total > 0 && (
            <div className="grid grid-cols-2 gap-3">
              {(["forehand", "backhand"] as const).map((type) => {
                const isFH = type === "forehand";
                const count = isFH ? stats.forehandCount : stats.backhandCount;
                const avgElbow = isFH ? stats.forehandAvgElbow : stats.backhandAvgElbow;
                const avgConf = isFH ? stats.forehandAvgConf : stats.backhandAvgConf;
                const avgElbowVel = isFH ? stats.forehandAvgElbowVel : stats.backhandAvgElbowVel;
                const avgShoulderRot = isFH ? stats.forehandAvgShoulderRot : stats.backhandAvgShoulderRot;
                return (
                  <div key={type} className="rounded-lg bg-background p-3 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: isFH ? COLORS.forehand : COLORS.backhand }}
                      />
                      <span className="text-xs text-foreground capitalize">{type}</span>
                      <span className="text-[10px] text-muted-foreground ml-auto">
                        {count}/{stats.total} ({stats.total ? Math.round((count / stats.total) * 100) : 0}%)
                      </span>
                    </div>
                    <div className="space-y-1 text-[11px]">
                      <MetricRow label="Avg Elbow Angle" value={`${avgElbow}°`} icon={<Zap className="w-2.5 h-2.5 text-muted-foreground" />} />
                      <MetricRow label="Elbow Speed" value={`${avgElbowVel}°/f`} icon={<Zap className="w-2.5 h-2.5 text-muted-foreground" />} />
                      <MetricRow label="Shoulder Rotation" value={`${avgShoulderRot}°`} icon={<RotateCcw className="w-2.5 h-2.5 text-muted-foreground" />} />
                      <MetricRow label="Confidence" value={`${avgConf}%`} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Stroke accumulation line chart */}
          {activeTimeline.length > 1 && (
            <div className="rounded-lg bg-background p-3">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                Stroke Accumulation
              </span>
              <ResponsiveContainer width="100%" height={100} className="mt-2">
                <LineChart data={activeTimeline}>
                  <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />
                  <XAxis
                    dataKey="frame"
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis hide />
                  <Tooltip
                    contentStyle={{ backgroundColor: "hsl(var(--background))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }}
                    labelStyle={{ color: "hsl(var(--foreground))" }}
                    labelFormatter={(v) => `Frame ${v}`}
                  />
                  <Line
                    type="stepAfter"
                    dataKey="forehand"
                    name="Forehand"
                    stroke={COLORS.forehand}
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="stepAfter"
                    dataKey="backhand"
                    name="Backhand"
                    stroke={COLORS.backhand}
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatPill({
  label,
  value,
  color,
  tooltip,
}: {
  label: string;
  value: string | number;
  color: string;
  tooltip?: string;
}) {
  return (
    <div
      className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-background shrink-0"
      title={tooltip}
    >
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className="text-xs font-medium tabular-nums" style={{ color }}>
        {value}
      </span>
    </div>
  );
}

function MetricRow({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-1 text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}
