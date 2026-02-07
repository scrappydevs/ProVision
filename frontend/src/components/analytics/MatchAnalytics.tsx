"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getMatchAnalytics,
  getPoseSummary,
  MatchAnalytics as MatchAnalyticsData,
  PoseSummary,
} from "@/lib/api";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, Legend, PieChart, Pie, Cell,
} from "recharts";
import {
  Loader2, Hand, Target, TrendingDown, Activity, Minus, Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface MatchAnalyticsProps {
  sessionId: string;
  players?: Array<{ id: string; name: string; avatar_url?: string }>;
}

const CHART_COLORS = {
  forehand: "#9B7B5B",
  backhand: "#6B8E6B",
  accent: "#9B7B5B",
  muted: "#8A8885",
  grid: "#363436",
  bg: "#282729",
};

export function MatchAnalytics({ sessionId, players }: MatchAnalyticsProps) {
  const [scores, setScores] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {};
    players?.forEach((p) => (initial[p.id] = 0));
    if (Object.keys(initial).length === 0) {
      initial["player1"] = 0;
      initial["player2"] = 0;
    }
    return initial;
  });

  const { data: analytics, isLoading: analyticsLoading } = useQuery({
    queryKey: ["match-analytics", sessionId],
    queryFn: async () => {
      const res = await getMatchAnalytics(sessionId);
      return res.data;
    },
    staleTime: 60_000,
  });

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ["pose-summary", sessionId],
    queryFn: async () => {
      const res = await getPoseSummary(sessionId);
      return res.data;
    },
    staleTime: 60_000,
  });

  const isLoading = analyticsLoading || summaryLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 text-[#9B7B5B] animate-spin" />
      </div>
    );
  }

  const wa = analytics?.weakness_analysis;
  const strokeData = wa
    ? [
        { name: "Forehand", count: wa.forehand.count, fill: CHART_COLORS.forehand },
        { name: "Backhand", count: wa.backhand.count, fill: CHART_COLORS.backhand },
      ]
    : [];

  const pieData = wa
    ? [
        { name: "Forehand", value: wa.forehand.count },
        { name: "Backhand", value: wa.backhand.count },
      ]
    : [];

  // Build angle chart data from summary
  const angleChartData = summary?.average_joint_angles
    ? Object.entries(summary.average_joint_angles).map(([joint, stats]) => {
        const s = stats as { mean: number; min: number; max: number };
        return {
          joint: joint.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
          mean: Math.round(s.mean),
          min: Math.round(s.min),
          max: Math.round(s.max),
        };
      })
    : [];

  const metricsData = summary?.average_body_metrics
    ? Object.entries(summary.average_body_metrics).map(([metric, stats]) => {
        const s = stats as { mean: number; min: number; max: number };
        return {
          metric: metric.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
          mean: Math.round(s.mean * 10) / 10,
          min: Math.round(s.min * 10) / 10,
          max: Math.round(s.max * 10) / 10,
        };
      })
    : [];

  const updateScore = (id: string, delta: number) => {
    setScores((prev) => ({
      ...prev,
      [id]: Math.max(0, (prev[id] || 0) + delta),
    }));
  };

  const playerEntries = players?.length
    ? players.map((p) => ({ id: p.id, name: p.name }))
    : [
        { id: "player1", name: "Player" },
        { id: "player2", name: "Opponent" },
      ];

  return (
    <div className="space-y-5">
      {/* Score Tracker */}
      <div className="rounded-xl bg-card p-5">
        <h3 className="text-xs text-muted-foreground uppercase tracking-wider mb-4">
          Score Tracker
        </h3>
        <div className="flex items-center justify-center gap-8">
          {playerEntries.map((p, i) => (
            <div key={p.id} className="text-center">
              <p className="text-xs text-muted-foreground mb-2">{p.name}</p>
              <div className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-full"
                  onClick={() => updateScore(p.id, -1)}
                >
                  <Minus className="w-3.5 h-3.5" />
                </Button>
                <span className="text-4xl font-light text-foreground w-16 text-center tabular-nums">
                  {scores[p.id] || 0}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-full"
                  onClick={() => updateScore(p.id, 1)}
                >
                  <Plus className="w-3.5 h-3.5" />
                </Button>
              </div>
              {i < playerEntries.length - 1 && (
                <span className="hidden" />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Top row: Dominant Hand + Weakness */}
      <div className="grid grid-cols-2 gap-4">
        {/* Dominant Hand */}
        <div className="rounded-xl bg-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Hand className="w-4 h-4 text-[#9B7B5B]" />
            <h3 className="text-xs text-muted-foreground uppercase tracking-wider">
              Dominant Hand
            </h3>
          </div>
          <p className="text-2xl font-light text-foreground capitalize">
            {analytics?.dominant_hand || "Unknown"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {analytics?.stroke_count || 0} strokes detected
          </p>
        </div>

        {/* Weakness */}
        <div className="rounded-xl bg-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingDown className="w-4 h-4 text-[#C45C5C]" />
            <h3 className="text-xs text-muted-foreground uppercase tracking-wider">
              Weaker Side
            </h3>
          </div>
          {wa?.weaker_side ? (
            <>
              <p className="text-2xl font-light text-[#C45C5C] capitalize">
                {wa.weaker_side}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {wa.weaker_side === "forehand"
                  ? `${wa.forehand.percentage}% of strokes`
                  : `${wa.backhand.percentage}% of strokes`}
              </p>
            </>
          ) : (
            <>
              <p className="text-2xl font-light text-[#6B8E6B]">Balanced</p>
              <p className="text-xs text-muted-foreground mt-1">
                No clear weakness detected
              </p>
            </>
          )}
        </div>
      </div>

      {/* Stroke Breakdown */}
      <div className="grid grid-cols-2 gap-4">
        {/* Bar Chart */}
        <div className="rounded-xl bg-card p-4">
          <div className="flex items-center gap-2 mb-4">
            <Target className="w-4 h-4 text-[#9B7B5B]" />
            <h3 className="text-xs text-muted-foreground uppercase tracking-wider">
              Stroke Breakdown
            </h3>
          </div>
          {strokeData.length > 0 && (wa?.forehand.count || 0) + (wa?.backhand.count || 0) > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={strokeData} barCategoryGap="30%">
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
                <XAxis dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: "hsl(var(--background))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                  labelStyle={{ color: "hsl(var(--foreground))" }}
                  itemStyle={{ color: "hsl(var(--muted-foreground))" }}
                />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {strokeData.map((entry, idx) => (
                    <Cell key={idx} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[180px] text-xs text-muted-foreground">
              No stroke data yet
            </div>
          )}
        </div>

        {/* Pie Chart */}
        <div className="rounded-xl bg-card p-4">
          <h3 className="text-xs text-muted-foreground uppercase tracking-wider mb-4">
            Stroke Distribution
          </h3>
          {pieData.length > 0 && (wa?.forehand.count || 0) + (wa?.backhand.count || 0) > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={40}
                  outerRadius={70}
                  paddingAngle={4}
                  dataKey="value"
                >
                  <Cell fill={CHART_COLORS.forehand} />
                  <Cell fill={CHART_COLORS.backhand} />
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: "hsl(var(--background))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                  labelStyle={{ color: "hsl(var(--foreground))" }}
                  itemStyle={{ color: "hsl(var(--muted-foreground))" }}
                />
                <Legend
                  formatter={(value) => <span style={{ color: "hsl(var(--muted-foreground))", fontSize: 11 }}>{value}</span>}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[180px] text-xs text-muted-foreground">
              No stroke data yet
            </div>
          )}
        </div>
      </div>

      {/* Stroke Detail Stats */}
      {wa && wa.total_strokes > 0 && (
        <div className="rounded-xl bg-card p-4">
          <h3 className="text-xs text-muted-foreground uppercase tracking-wider mb-3">
            Stroke Comparison
          </h3>
          <div className="grid grid-cols-2 gap-6">
            {(["forehand", "backhand"] as const).map((type) => {
              const data = wa[type];
              return (
                <div key={type} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: type === "forehand" ? CHART_COLORS.forehand : CHART_COLORS.backhand }}
                    />
                    <span className="text-sm text-foreground capitalize">{type}</span>
                  </div>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Count</span>
                      <span className="text-foreground">{data.count}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Avg Elbow Angle</span>
                      <span className="text-foreground">{data.avg_elbow_angle}°</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Confidence</span>
                      <span className="text-foreground">{(data.avg_confidence * 100).toFixed(0)}%</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Joint Angles Chart */}
      {angleChartData.length > 0 && (
        <div className="rounded-xl bg-card p-4">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="w-4 h-4 text-[#9B7B5B]" />
            <h3 className="text-xs text-muted-foreground uppercase tracking-wider">
              Joint Angles (avg / min / max)
            </h3>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={angleChartData} barCategoryGap="20%">
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
              <XAxis dataKey="joint" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }} axisLine={false} tickLine={false} angle={-30} textAnchor="end" height={60} />
              <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ backgroundColor: "hsl(var(--background))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                labelStyle={{ color: "hsl(var(--foreground))" }}
                itemStyle={{ color: "hsl(var(--muted-foreground))" }}
              />
              <Legend formatter={(value) => <span style={{ color: "hsl(var(--muted-foreground))", fontSize: 11 }}>{value}</span>} />
              <Bar dataKey="mean" name="Average" fill={CHART_COLORS.forehand} radius={[3, 3, 0, 0]} />
              <Bar dataKey="min" name="Min" fill="hsl(var(--border))" radius={[3, 3, 0, 0]} />
              <Bar dataKey="max" name="Max" fill={CHART_COLORS.backhand} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Body Metrics */}
      {metricsData.length > 0 && (
        <div className="rounded-xl bg-card p-4">
          <h3 className="text-xs text-muted-foreground uppercase tracking-wider mb-3">
            Body Metrics
          </h3>
          <div className="grid grid-cols-3 gap-4">
            {metricsData.map((m) => (
              <div key={m.metric} className="text-center">
                <p className="text-xs text-muted-foreground mb-1">{m.metric}</p>
                <p className="text-xl font-light text-foreground">{m.mean}°</p>
                <p className="text-[10px] text-muted-foreground">
                  {m.min}° – {m.max}°
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
