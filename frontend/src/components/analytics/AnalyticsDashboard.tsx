"use client";

import { useAnalytics } from "@/hooks/useAnalytics";
import { usePoseAnalysis } from "@/hooks/usePoseData";
import { useRunpodArtifacts } from "@/hooks/useRunpodArtifacts";
import { runRunpodDashboard, type RunpodDashboardArtifact } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, AlertCircle, Activity, TrendingUp, Zap, Target, RefreshCw, Play, RotateCcw } from "lucide-react";
import { LineChart, Line, BarChart, Bar, ScatterChart, Scatter, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell, Area, AreaChart } from "recharts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface AnalyticsDashboardProps {
  sessionId: string;
  onSeekToTime?: (timeSec: number) => void;
}

interface ChartClickPayload {
  payload?: {
    timeSec?: number;
  };
}

interface ChartClickState {
  activePayload?: ChartClickPayload[];
  activeLabel?: number | string;
}

function formatBytes(size?: number): string {
  if (size === undefined || size === null || Number.isNaN(size)) return "Unknown size";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function AnalyticsDashboard({ sessionId, onSeekToTime }: AnalyticsDashboardProps) {
  const queryClient = useQueryClient();
  const { data: analytics, isLoading, error } = useAnalytics(sessionId);
  const { data: poseData } = usePoseAnalysis(sessionId, 1000, 0);
  const { data: runpodData, isLoading: runpodLoading } = useRunpodArtifacts(sessionId);
  const autoRunRef = useRef(false);
  const [expandedShot, setExpandedShot] = useState<number | null>(null);
  const runpodMutation = useMutation({
    mutationFn: async (force: boolean = false) => {
      const response = await runRunpodDashboard(sessionId, force);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["runpod-artifacts", sessionId] });
      queryClient.invalidateQueries({ queryKey: ["analytics", sessionId] });
    },
  });

  // Process joint angles over time
  const fps = useMemo(() => {
    if (analytics?.fps && Number.isFinite(analytics.fps) && analytics.fps > 0) return analytics.fps;
    return 30;
  }, [analytics?.fps]);

  const jointAngleData = useMemo<Array<{
    frame: number;
    timeSec: number;
    leftElbow: number;
    rightElbow: number;
    leftKnee: number;
    rightKnee: number;
    leftShoulder: number;
    rightShoulder: number;
  }>>(() => {
    if (!poseData?.frames || poseData.frames.length === 0) return [];

    return poseData.frames.map((frame: { frame_number: number; joint_angles?: Record<string, number> }) => ({
      frame: frame.frame_number,
      timeSec: frame.frame_number / fps,
      leftElbow: frame.joint_angles?.left_elbow || 0,
      rightElbow: frame.joint_angles?.right_elbow || 0,
      leftKnee: frame.joint_angles?.left_knee || 0,
      rightKnee: frame.joint_angles?.right_knee || 0,
      leftShoulder: frame.joint_angles?.left_shoulder || 0,
      rightShoulder: frame.joint_angles?.right_shoulder || 0,
    }));
  }, [poseData, fps]);

  // Average joint angles for radar chart
  const avgJointAngles = useMemo(() => {
    if (jointAngleData.length === 0) return [];
    
    const sum = jointAngleData.reduce(
      (acc, frame) => ({
        leftElbow: acc.leftElbow + frame.leftElbow,
        rightElbow: acc.rightElbow + frame.rightElbow,
        leftKnee: acc.leftKnee + frame.leftKnee,
        rightKnee: acc.rightKnee + frame.rightKnee,
        leftShoulder: acc.leftShoulder + frame.leftShoulder,
        rightShoulder: acc.rightShoulder + frame.rightShoulder,
      }),
      { leftElbow: 0, rightElbow: 0, leftKnee: 0, rightKnee: 0, leftShoulder: 0, rightShoulder: 0 }
    );
    
    const count = jointAngleData.length;
    return [
      { joint: "L Elbow", angle: sum.leftElbow / count, fullMark: 180 },
      { joint: "R Elbow", angle: sum.rightElbow / count, fullMark: 180 },
      { joint: "L Knee", angle: sum.leftKnee / count, fullMark: 180 },
      { joint: "R Knee", angle: sum.rightKnee / count, fullMark: 180 },
      { joint: "L Shoulder", angle: sum.leftShoulder / count, fullMark: 180 },
      { joint: "R Shoulder", angle: sum.rightShoulder / count, fullMark: 180 },
    ];
  }, [jointAngleData]);

  const handleTimelineClick = useCallback((state: unknown) => {
    if (!onSeekToTime) return;
    if (!state || typeof state !== "object") return;
    const clickState = state as ChartClickState;
    const payloadTime = clickState.activePayload?.[0]?.payload?.timeSec;
    const labelTime = typeof clickState.activeLabel === "number"
      ? clickState.activeLabel
      : Number(clickState.activeLabel);
    const clickedTime = typeof payloadTime === "number" ? payloadTime : labelTime;
    if (Number.isFinite(clickedTime)) {
      onSeekToTime(clickedTime);
    }
  }, [onSeekToTime]);

  const formatSecondsTick = useCallback((value: number) => `${value.toFixed(1)}s`, []);

  // Merge RunPod data from dedicated polling hook and analytics payload
  const runpodDashboard = runpodData ?? analytics?.runpod_dashboard;
  const runpodArtifacts = runpodDashboard?.artifacts || [];

  // Classify artifacts for structured display
  const classifiedArtifacts = useMemo(() => {
    const bounceMap = runpodArtifacts.find((a) => a.name === "bounce_map.png");
    const annotatedVideo = runpodArtifacts.find(
      (a) => a.name === "annotated_full_video.mp4" || a.name === "annotated_video.mp4"
    );
    const trajectory3d = runpodArtifacts.find((a) => a.name === "trajectory_3d.png");
    const trajectoryReprojected = runpodArtifacts.find((a) => a.name === "trajectory_reprojected.png");
    const summaryJson = runpodArtifacts.find((a) => a.name === "summary.json");
    const bouncesJson = runpodArtifacts.find((a) => a.name === "bounces.json");
    const resultsJson = runpodArtifacts.find((a) => a.name === "results.json");

    // Group shot files by shot index
    const shotFiles: Record<number, { image?: RunpodDashboardArtifact; video?: RunpodDashboardArtifact; json?: RunpodDashboardArtifact; image3d?: RunpodDashboardArtifact }> = {};
    for (const a of runpodArtifacts) {
      const match = a.name.match(/^shot_(\d+)(?:_(3d|video))?\.(\w+)$/);
      if (!match) continue;
      const idx = parseInt(match[1], 10);
      if (!shotFiles[idx]) shotFiles[idx] = {};
      if (match[2] === "3d") shotFiles[idx].image3d = a;
      else if (match[2] === "video") shotFiles[idx].video = a;
      else if (match[3] === "json") shotFiles[idx].json = a;
      else if (match[3] === "png") shotFiles[idx].image = a;
    }

    return {
      bounceMap,
      annotatedVideo,
      trajectory3d,
      trajectoryReprojected,
      summaryJson,
      bouncesJson,
      resultsJson,
      shots: Object.entries(shotFiles)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([idx, files]) => ({ index: Number(idx), ...files })),
    };
  }, [runpodArtifacts]);

  // Parse summary.json from URL
  const [summaryData, setSummaryData] = useState<Record<string, unknown> | null>(null);
  const [bouncesData, setBouncesData] = useState<{ bounces: Array<Record<string, unknown>> } | null>(null);

  useEffect(() => {
    if (!classifiedArtifacts.summaryJson?.url) { setSummaryData(null); return; }
    fetch(classifiedArtifacts.summaryJson.url)
      .then((r) => r.json())
      .then(setSummaryData)
      .catch(() => setSummaryData(null));
  }, [classifiedArtifacts.summaryJson?.url]);

  useEffect(() => {
    if (!classifiedArtifacts.bouncesJson?.url) { setBouncesData(null); return; }
    fetch(classifiedArtifacts.bouncesJson.url)
      .then((r) => r.json())
      .then(setBouncesData)
      .catch(() => setBouncesData(null));
  }, [classifiedArtifacts.bouncesJson?.url]);

  useEffect(() => {
    autoRunRef.current = false;
  }, [sessionId]);

  // Auto-trigger analysis if no artifacts are present
  useEffect(() => {
    if (autoRunRef.current) return;
    if (runpodArtifacts.length > 0) return;
    if (runpodLoading) return;
    autoRunRef.current = true;
    runpodMutation.mutate(false);
  }, [runpodArtifacts.length, runpodLoading, runpodMutation]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-[600px] gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-[#9B7B5B]" />
        <p className="text-xs text-[#8A8885]">Computing analytics...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-[600px] gap-3">
        <AlertCircle className="w-8 h-8 text-[#C45C5C]" />
        <p className="text-sm font-medium text-[#E8E6E3]">Failed to load analytics</p>
        <p className="text-xs text-[#8A8885] max-w-md text-center">
          {error instanceof Error ? error.message : "Unknown error"}
        </p>
        <p className="text-[10px] text-[#6A6865]">
          Make sure ball tracking and pose analysis are completed.
        </p>
      </div>
    );
  }

  if (!analytics) {
    return (
      <div className="flex flex-col items-center justify-center h-[600px] gap-3">
        <AlertCircle className="w-8 h-8 text-[#8A8885]" />
        <p className="text-sm font-medium text-[#E8E6E3]">No analytics available</p>
        <p className="text-xs text-[#8A8885]">
          Complete ball tracking and pose analysis first.
        </p>
      </div>
    );
  }

  const ballSpeed = analytics.ball_analytics.speed;
  const trajectory = analytics.ball_analytics.trajectory;
  const movement = analytics.pose_analytics.movement;
  const contact = analytics.pose_analytics.contact;
  const ballSpeedTimeline = ballSpeed.timeline.map((point) => ({
    ...point,
    timeSec: Number.isFinite(point.timestamp) ? point.timestamp : point.frame / fps,
  }));
  const stanceWidthTimeline = movement.stance_width_timeline.map((point) => ({
    ...point,
    timeSec: point.frame / fps,
  }));
  const armExtensionTimeline = movement.arm_extension_timeline.map((point) => ({
    ...point,
    timeSec: point.frame / fps,
  }));
  const velocityTimeline = movement.velocity_timeline.map((point) => ({
    ...point,
    timeSec: point.frame / fps,
  }));
  const contactMomentsTimeline = contact.contact_moments.map((point) => ({
    ...point,
    timeSec: point.frame / fps,
  }));

  return (
    <div className="p-4 space-y-4 h-full overflow-y-auto">
      {/* Header Stats */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-[#282729]/60 backdrop-blur-xl rounded-xl p-3 border border-[#363436]/30">
          <div className="flex items-center gap-2 mb-1">
            <Zap className="w-3.5 h-3.5 text-[#9B7B5B]" />
            <span className="text-[10px] text-[#8A8885]">Max Speed</span>
          </div>
          <div className="text-xl font-bold text-[#E8E6E3]">
            {ballSpeed.max.toFixed(1)}
          </div>
          <div className="text-[9px] text-[#6A6865]">px/frame</div>
        </div>

        <div className="bg-[#282729]/60 backdrop-blur-xl rounded-xl p-3 border border-[#363436]/30">
          <div className="flex items-center gap-2 mb-1">
            <Target className="w-3.5 h-3.5 text-[#5B9B7B]" />
            <span className="text-[10px] text-[#8A8885]">Avg Speed</span>
          </div>
          <div className="text-xl font-bold text-[#E8E6E3]">
            {ballSpeed.avg.toFixed(1)}
          </div>
          <div className="text-[9px] text-[#6A6865]">px/frame</div>
        </div>

        <div className="bg-[#282729]/60 backdrop-blur-xl rounded-xl p-3 border border-[#363436]/30">
          <div className="flex items-center gap-2 mb-1">
            <Activity className="w-3.5 h-3.5 text-[#9B7B5B]" />
            <span className="text-[10px] text-[#8A8885]">Bounces</span>
          </div>
          <div className="text-xl font-bold text-[#E8E6E3]">
            {trajectory.bounce_count}
          </div>
          <div className="text-[9px] text-[#6A6865]">detected</div>
        </div>

        <div className="bg-[#282729]/60 backdrop-blur-xl rounded-xl p-3 border border-[#363436]/30">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="w-3.5 h-3.5 text-[#5B9B7B]" />
            <span className="text-[10px] text-[#8A8885]">Distance</span>
          </div>
          <div className="text-xl font-bold text-[#E8E6E3]">
            {(trajectory.total_distance / 100).toFixed(1)}
          </div>
          <div className="text-[9px] text-[#6A6865]">meters</div>
        </div>
      </div>

      {/* Ball Speed Over Time */}
      <div className="bg-[#282729]/40 backdrop-blur-xl rounded-xl p-4 border border-[#363436]/30">
        <h3 className="text-xs font-medium text-[#E8E6E3] mb-3">Ball Speed Timeline</h3>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={ballSpeedTimeline} onClick={handleTimelineClick}>
            <defs>
              <linearGradient id="speedGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#9B7B5B" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="#9B7B5B" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#363436" opacity={0.3} />
            <XAxis 
              dataKey="timeSec" 
              stroke="#8A8885" 
              tick={{ fill: '#6A6865', fontSize: 10 }}
              tickFormatter={formatSecondsTick}
              label={{ value: 'Time (s)', position: 'insideBottom', offset: -5, fill: '#8A8885', fontSize: 10 }}
            />
            <YAxis 
              stroke="#8A8885" 
              tick={{ fill: '#6A6865', fontSize: 10 }}
              label={{ value: 'Speed (px/frame)', angle: -90, position: 'insideLeft', fill: '#8A8885', fontSize: 10 }}
            />
            <Tooltip 
              contentStyle={{ 
                backgroundColor: '#1E1D1F', 
                border: '1px solid #363436',
                borderRadius: '8px',
                fontSize: '11px',
                color: '#E8E6E3'
              }}
            />
            <Area 
              type="monotone" 
              dataKey="speed" 
              stroke="#9B7B5B" 
              strokeWidth={2}
              fill="url(#speedGradient)" 
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Joint Angles Over Time */}
      {jointAngleData.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          {/* Joint Angles Timeline */}
          <div className="bg-[#282729]/40 backdrop-blur-xl rounded-xl p-4 border border-[#363436]/30">
            <h3 className="text-xs font-medium text-[#E8E6E3] mb-3">Joint Angles Over Time</h3>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={jointAngleData} onClick={handleTimelineClick}>
                <CartesianGrid strokeDasharray="3 3" stroke="#363436" opacity={0.2} />
                <XAxis 
                  dataKey="timeSec" 
                  stroke="#8A8885" 
                  tick={{ fill: '#6A6865', fontSize: 9 }}
                  tickFormatter={formatSecondsTick}
                  label={{ value: 'Time (s)', position: 'insideBottom', offset: -5, fill: '#8A8885', fontSize: 9 }}
                />
                <YAxis 
                  stroke="#8A8885" 
                  tick={{ fill: '#6A6865', fontSize: 9 }}
                  domain={[0, 180]}
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: '#1E1D1F', 
                    border: '1px solid #363436',
                    borderRadius: '8px',
                    fontSize: '10px'
                  }}
                />
                <Legend 
                  wrapperStyle={{ fontSize: '9px' }}
                  iconSize={8}
                />
                <Line type="monotone" dataKey="leftElbow" stroke="#9B7B5B" strokeWidth={1.5} dot={false} name="L Elbow" />
                <Line type="monotone" dataKey="rightElbow" stroke="#B8956D" strokeWidth={1.5} dot={false} name="R Elbow" />
                <Line type="monotone" dataKey="leftKnee" stroke="#5B9B7B" strokeWidth={1.5} dot={false} name="L Knee" />
                <Line type="monotone" dataKey="rightKnee" stroke="#6DAB8B" strokeWidth={1.5} dot={false} name="R Knee" />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Average Joint Angles Radar */}
          <div className="bg-[#282729]/40 backdrop-blur-xl rounded-xl p-4 border border-[#363436]/30">
            <h3 className="text-xs font-medium text-[#E8E6E3] mb-3">Average Joint Angles</h3>
            <ResponsiveContainer width="100%" height={220}>
              <RadarChart data={avgJointAngles}>
                <PolarGrid stroke="#363436" />
                <PolarAngleAxis 
                  dataKey="joint" 
                  tick={{ fill: '#8A8885', fontSize: 9 }}
                />
                <PolarRadiusAxis 
                  angle={90} 
                  domain={[0, 180]}
                  tick={{ fill: '#6A6865', fontSize: 9 }}
                />
                <Radar 
                  name="Angle (degrees)" 
                  dataKey="angle" 
                  stroke="#9B7B5B" 
                  fill="#9B7B5B" 
                  fillOpacity={0.3}
                  strokeWidth={2}
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: '#1E1D1F', 
                    border: '1px solid #363436',
                    borderRadius: '8px',
                    fontSize: '10px'
                  }}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Stance Width & Arm Extension */}
      {stanceWidthTimeline.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-[#282729]/40 backdrop-blur-xl rounded-xl p-4 border border-[#363436]/30">
            <h3 className="text-xs font-medium text-[#E8E6E3] mb-3">Stance Width</h3>
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={stanceWidthTimeline} onClick={handleTimelineClick}>
                <defs>
                  <linearGradient id="stanceGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#5B9B7B" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#5B9B7B" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#363436" opacity={0.2} />
                <XAxis dataKey="timeSec" stroke="#8A8885" tick={{ fill: '#6A6865', fontSize: 9 }} tickFormatter={formatSecondsTick} label={{ value: 'Time (s)', position: 'insideBottom', offset: -5, fill: '#8A8885', fontSize: 9 }} />
                <YAxis stroke="#8A8885" tick={{ fill: '#6A6865', fontSize: 9 }} />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: '#1E1D1F', 
                    border: '1px solid #363436',
                    borderRadius: '8px',
                    fontSize: '10px'
                  }}
                />
                <Area 
                  type="monotone" 
                  dataKey="width" 
                  stroke="#5B9B7B" 
                  strokeWidth={2}
                  fill="url(#stanceGradient)" 
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-[#282729]/40 backdrop-blur-xl rounded-xl p-4 border border-[#363436]/30">
            <h3 className="text-xs font-medium text-[#E8E6E3] mb-3">Arm Extension</h3>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={armExtensionTimeline} onClick={handleTimelineClick}>
                <CartesianGrid strokeDasharray="3 3" stroke="#363436" opacity={0.2} />
                <XAxis dataKey="timeSec" stroke="#8A8885" tick={{ fill: '#6A6865', fontSize: 9 }} tickFormatter={formatSecondsTick} label={{ value: 'Time (s)', position: 'insideBottom', offset: -5, fill: '#8A8885', fontSize: 9 }} />
                <YAxis stroke="#8A8885" tick={{ fill: '#6A6865', fontSize: 9 }} />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: '#1E1D1F', 
                    border: '1px solid #363436',
                    borderRadius: '8px',
                    fontSize: '10px'
                  }}
                />
                <Line type="monotone" dataKey="left" stroke="#9B7B5B" strokeWidth={1.5} dot={false} name="Left" />
                <Line type="monotone" dataKey="right" stroke="#5B9B7B" strokeWidth={1.5} dot={false} name="Right" />
                <Legend wrapperStyle={{ fontSize: '9px' }} iconSize={8} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Speed Distribution */}
      <div className="bg-[#282729]/40 backdrop-blur-xl rounded-xl p-4 border border-[#363436]/30">
        <h3 className="text-xs font-medium text-[#E8E6E3] mb-3">Speed Distribution</h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={[
            { range: 'Slow', count: ballSpeed.distribution.slow, fill: '#5B9B7B' },
            { range: 'Medium', count: ballSpeed.distribution.medium, fill: '#9B7B5B' },
            { range: 'Fast', count: ballSpeed.distribution.fast, fill: '#C45C5C' },
          ]}>
            <CartesianGrid strokeDasharray="3 3" stroke="#363436" opacity={0.2} />
            <XAxis dataKey="range" stroke="#8A8885" tick={{ fill: '#8A8885', fontSize: 10 }} />
            <YAxis stroke="#8A8885" tick={{ fill: '#6A6865', fontSize: 10 }} />
            <Tooltip 
              cursor={false}
              contentStyle={{ 
                backgroundColor: '#1E1D1F', 
                border: '1px solid #363436',
                borderRadius: '8px',
                fontSize: '10px',
                color: '#E8E6E3'
              }}
              labelStyle={{ color: '#E8E6E3' }}
              itemStyle={{ color: '#E8E6E3' }}
            />
            <Bar dataKey="count" radius={[6, 6, 0, 0]}>
              {[
                { range: 'Slow', count: ballSpeed.distribution.slow, fill: '#5B9B7B' },
                { range: 'Medium', count: ballSpeed.distribution.medium, fill: '#9B7B5B' },
                { range: 'Fast', count: ballSpeed.distribution.fast, fill: '#C45C5C' },
              ].map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Rally Analysis */}
      {trajectory.rallies.length > 0 && (
        <div className="bg-[#282729]/40 backdrop-blur-xl rounded-xl p-4 border border-[#363436]/30">
          <h3 className="text-xs font-medium text-[#E8E6E3] mb-3">Rally Breakdown</h3>
          <div className="space-y-2">
            {trajectory.rallies.map((rally, idx) => (
              <div key={idx} className="flex items-center gap-3 p-2 rounded-lg bg-[#1E1D1F]/40">
                <div className="text-[10px] text-[#9B7B5B] font-medium w-16">
                  Rally {idx + 1}
                </div>
                <div className="flex-1">
                  <div className="h-1.5 bg-[#363436] rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-[#9B7B5B] transition-all"
                      style={{ width: `${(rally.length / Math.max(...trajectory.rallies.map(r => r.length))) * 100}%` }}
                    />
                  </div>
                </div>
                <div className="text-[10px] text-[#8A8885]">
                  {rally.length} frames
                </div>
                <div className="text-[10px] text-[#9B7B5B] font-medium">
                  {rally.avg_speed.toFixed(1)} px/f
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Ball Contact Moments */}
      {contact.contact_moments.length > 0 && (
        <div className="bg-[#282729]/40 backdrop-blur-xl rounded-xl p-4 border border-[#363436]/30">
          <h3 className="text-xs font-medium text-[#E8E6E3] mb-3">Ball Contact Analysis</h3>
          <div className="grid grid-cols-3 gap-4 mb-3">
            <div>
              <div className="text-[10px] text-[#8A8885]">Total Contacts</div>
              <div className="text-2xl font-bold text-[#9B7B5B]">{contact.contact_moments.length}</div>
            </div>
            <div>
              <div className="text-[10px] text-[#8A8885]">Avg Height</div>
              <div className="text-2xl font-bold text-[#E8E6E3]">
                {contact.avg_contact_height.toFixed(0)}
              </div>
              <div className="text-[9px] text-[#6A6865]">px</div>
            </div>
            <div>
              <div className="text-[10px] text-[#8A8885]">Height Distribution</div>
              <div className="mt-1 space-y-0.5">
                {contact.height_distribution.map((dist) => (
                  <div key={dist.range} className="flex justify-between text-[10px]">
                    <span className="text-[#8A8885] capitalize">{dist.range}:</span>
                    <span className="text-[#E8E6E3] font-medium">{dist.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          
          {/* Contact moments timeline */}
          <ResponsiveContainer width="100%" height={140}>
            <ScatterChart onClick={handleTimelineClick}>
              <CartesianGrid strokeDasharray="3 3" stroke="#363436" opacity={0.2} />
              <XAxis 
                dataKey="timeSec" 
                name="Time" 
                stroke="#8A8885" 
                tick={{ fill: '#6A6865', fontSize: 9 }}
                tickFormatter={formatSecondsTick}
              />
              <YAxis 
                dataKey="height" 
                name="Height" 
                stroke="#8A8885" 
                tick={{ fill: '#6A6865', fontSize: 9 }}
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: '#1E1D1F', 
                  border: '1px solid #363436',
                  borderRadius: '8px',
                  fontSize: '10px'
                }}
                cursor={{ strokeDasharray: '3 3' }}
              />
              <Scatter 
                data={contactMomentsTimeline} 
                fill="#9B7B5B" 
                opacity={0.7}
              />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Player Velocity */}
      {velocityTimeline.length > 0 && (
        <div className="bg-[#282729]/40 backdrop-blur-xl rounded-xl p-4 border border-[#363436]/30">
          <h3 className="text-xs font-medium text-[#E8E6E3] mb-3">Player Velocity</h3>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={velocityTimeline} onClick={handleTimelineClick}>
              <defs>
                <linearGradient id="velocityGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#5B9B7B" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#5B9B7B" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#363436" opacity={0.2} />
              <XAxis dataKey="timeSec" stroke="#8A8885" tick={{ fill: '#6A6865', fontSize: 9 }} tickFormatter={formatSecondsTick} label={{ value: 'Time (s)', position: 'insideBottom', offset: -5, fill: '#8A8885', fontSize: 9 }} />
              <YAxis stroke="#8A8885" tick={{ fill: '#6A6865', fontSize: 9 }} />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: '#1E1D1F', 
                  border: '1px solid #363436',
                  borderRadius: '8px',
                  fontSize: '10px'
                }}
              />
              <Area 
                type="monotone" 
                dataKey="velocity" 
                stroke="#5B9B7B" 
                strokeWidth={2}
                fill="url(#velocityGradient)" 
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Key Metrics Summary */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-[#282729]/40 backdrop-blur-xl rounded-xl p-4 border border-[#363436]/30">
          <h3 className="text-xs font-medium text-[#E8E6E3] mb-3">Ball Metrics</h3>
          <div className="space-y-2">
            <div className="flex justify-between text-[10px]">
              <span className="text-[#8A8885]">Median Speed</span>
              <span className="text-[#E8E6E3] font-medium">{ballSpeed.median.toFixed(1)} px/f</span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-[#8A8885]">Std Deviation</span>
              <span className="text-[#E8E6E3] font-medium">{ballSpeed.stddev.toFixed(1)}</span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-[#8A8885]">Direction Changes</span>
              <span className="text-[#E8E6E3] font-medium">{trajectory.direction_changes}</span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-[#8A8885]">Total Distance</span>
              <span className="text-[#E8E6E3] font-medium">{(trajectory.total_distance / 100).toFixed(1)}m</span>
            </div>
          </div>
        </div>

        <div className="bg-[#282729]/40 backdrop-blur-xl rounded-xl p-4 border border-[#363436]/30">
          <h3 className="text-xs font-medium text-[#E8E6E3] mb-3">Player Metrics</h3>
          <div className="space-y-2">
            <div className="flex justify-between text-[10px]">
              <span className="text-[#8A8885]">Avg Stance Width</span>
              <span className="text-[#E8E6E3] font-medium">{movement.avg_stance_width.toFixed(0)} px</span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-[#8A8885]">Avg Velocity</span>
              <span className="text-[#E8E6E3] font-medium">{movement.avg_velocity.toFixed(2)} px/f</span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-[#8A8885]">Pose Frames</span>
              <span className="text-[#E8E6E3] font-medium">{analytics.pose_frame_count}</span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-[#8A8885]">Video FPS</span>
              <span className="text-[#E8E6E3] font-medium">{analytics.fps.toFixed(0)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Spin Estimate */}
      {analytics.ball_analytics.spin?.estimate && (
        <div className="bg-[#282729]/40 backdrop-blur-xl rounded-xl p-3 border border-[#363436]/30">
          <div className="flex items-center gap-2">
            <Zap className="w-3.5 h-3.5 text-[#9B7B5B]" />
            <span className="text-[10px] text-[#8A8885]">Estimated Spin:</span>
            <span className="text-xs font-medium text-[#E8E6E3]">{analytics.ball_analytics.spin.estimate}</span>
          </div>
        </div>
      )}

      {/* ─── Advanced Analysis (RunPod) ─── */}
      <div className="space-y-4">
        {/* Header + Status */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-[#E8E6E3]">Advanced Shot Analysis</h2>
            <p className="text-[10px] text-[#8A8885] mt-0.5">
              {runpodMutation.isPending
                ? "Running analysis on RunPod GPU..."
                : runpodArtifacts.length > 0
                ? `${runpodArtifacts.length} artifact(s) available`
                : runpodLoading
                ? "Checking for results..."
                : "Waiting for analysis to complete. Polling every 30s."}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[10px] border-[#4A4846] bg-[#1E1D1F]/60 hover:bg-[#1E1D1F]"
            onClick={() => runpodMutation.mutate(true)}
            disabled={runpodMutation.isPending}
          >
            {runpodMutation.isPending ? (
              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            ) : (
              <RotateCcw className="w-3 h-3 mr-1" />
            )}
            Re-run
          </Button>
        </div>

        {runpodDashboard?.error && (
          <p className="text-[10px] text-[#C45C5C] bg-[#C45C5C]/10 border border-[#C45C5C]/20 rounded-lg px-3 py-2">
            {runpodDashboard.error}
          </p>
        )}

        {runpodArtifacts.length === 0 ? (
          <div className="bg-[#282729]/40 backdrop-blur-xl rounded-xl p-8 border border-dashed border-[#4A4846] flex flex-col items-center justify-center gap-3">
            {runpodMutation.isPending || runpodLoading ? (
              <Loader2 className="w-6 h-6 animate-spin text-[#9B7B5B]" />
            ) : (
              <Activity className="w-6 h-6 text-[#4A4846]" />
            )}
            <p className="text-xs text-[#8A8885] text-center max-w-xs">
              {runpodMutation.isPending
                ? "Processing video on RunPod GPU. This may take a few minutes..."
                : "Analysis results will appear here automatically. Polling every 30 seconds."}
            </p>
          </div>
        ) : (
          <>
            {/* ── Summary Stats from summary.json ── */}
            {summaryData && (
              <div className="bg-[#282729]/40 backdrop-blur-xl rounded-xl p-4 border border-[#363436]/30">
                <h3 className="text-xs font-medium text-[#E8E6E3] mb-3">Match Summary</h3>
                <div className="grid grid-cols-4 gap-3">
                  <div className="bg-[#1E1D1F]/60 rounded-lg p-3 border border-[#363436]/20">
                    <div className="text-[10px] text-[#8A8885]">Shots</div>
                    <div className="text-xl font-bold text-[#E8E6E3]">{String(summaryData.num_shots ?? 0)}</div>
                  </div>
                  <div className="bg-[#1E1D1F]/60 rounded-lg p-3 border border-[#363436]/20">
                    <div className="text-[10px] text-[#8A8885]">Rallies</div>
                    <div className="text-xl font-bold text-[#E8E6E3]">{String(summaryData.num_rallies ?? 0)}</div>
                  </div>
                  <div className="bg-[#1E1D1F]/60 rounded-lg p-3 border border-[#363436]/20">
                    <div className="text-[10px] text-[#8A8885]">Duration</div>
                    <div className="text-xl font-bold text-[#E8E6E3]">{Number(summaryData.total_duration_sec ?? 0).toFixed(1)}s</div>
                  </div>
                  <div className="bg-[#1E1D1F]/60 rounded-lg p-3 border border-[#363436]/20">
                    <div className="text-[10px] text-[#8A8885]">FPS</div>
                    <div className="text-xl font-bold text-[#E8E6E3]">{Number(summaryData.fps ?? 0).toFixed(0)}</div>
                  </div>
                </div>

                {/* Shot Spin Breakdown */}
                {Array.isArray(summaryData.shots) && (summaryData.shots as Array<Record<string, unknown>>).length > 0 && (
                  <div className="mt-3 space-y-1.5">
                    <h4 className="text-[10px] font-medium text-[#8A8885] uppercase tracking-wider">Shot Details</h4>
                    {(summaryData.shots as Array<Record<string, unknown>>).map((shot, idx) => (
                      <div key={idx} className="flex items-center gap-3 bg-[#1E1D1F]/40 rounded-lg px-3 py-2">
                        <span className="text-[10px] font-medium text-[#9B7B5B] w-12">Shot {Number(shot.shot_index ?? idx) + 1}</span>
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                          shot.spin_type === "Topspin" ? "bg-[#5B9B7B]/20 text-[#5B9B7B]" :
                          shot.spin_type === "Backspin" ? "bg-[#C45C5C]/20 text-[#C45C5C]" :
                          "bg-[#9B7B5B]/20 text-[#9B7B5B]"
                        }`}>{String(shot.spin_type ?? "Unknown")}</span>
                        <span className="text-[10px] text-[#8A8885]">{Number(shot.spin_rpm ?? 0).toFixed(0)} RPM</span>
                        <span className="text-[10px] text-[#6A6865] ml-auto">{Number(shot.duration_sec ?? 0).toFixed(2)}s</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Bounce Map ── */}
            {classifiedArtifacts.bounceMap?.url && (
              <div className="bg-[#282729]/40 backdrop-blur-xl rounded-xl p-4 border border-[#363436]/30">
                <h3 className="text-xs font-medium text-[#E8E6E3] mb-3">Bounce Map</h3>
                <img
                  src={classifiedArtifacts.bounceMap.url}
                  alt="Bounce Map"
                  className="w-full rounded-lg bg-black/40 border border-[#363436]/20"
                />
                {bouncesData?.bounces && (
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {bouncesData.bounces.map((b, i) => (
                      <div key={i} className="bg-[#1E1D1F]/60 rounded-lg p-2 border border-[#363436]/20 text-center">
                        <div className="text-[9px] text-[#8A8885]">Bounce {i + 1}</div>
                        <div className="text-[10px] text-[#E8E6E3] font-medium">Frame {String(b.frame_global_estimate)}</div>
                        <div className="text-[9px] text-[#6A6865]">
                          x={Number(b.x).toFixed(2)} y={Number(b.y).toFixed(2)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Annotated Video ── */}
            {classifiedArtifacts.annotatedVideo?.url && (
              <div className="bg-[#282729]/40 backdrop-blur-xl rounded-xl p-4 border border-[#363436]/30">
                <h3 className="text-xs font-medium text-[#E8E6E3] mb-3">Annotated Video</h3>
                <video
                  controls
                  src={classifiedArtifacts.annotatedVideo.url}
                  className="w-full rounded-lg bg-black/40 border border-[#363436]/20"
                />
              </div>
            )}

            {/* ── 3D Trajectory Views ── */}
            {(classifiedArtifacts.trajectory3d?.url || classifiedArtifacts.trajectoryReprojected?.url) && (
              <div className="bg-[#282729]/40 backdrop-blur-xl rounded-xl p-4 border border-[#363436]/30">
                <h3 className="text-xs font-medium text-[#E8E6E3] mb-3">3D Trajectory</h3>
                <div className="grid grid-cols-2 gap-3">
                  {classifiedArtifacts.trajectory3d?.url && (
                    <div>
                      <p className="text-[10px] text-[#8A8885] mb-1.5">3D View</p>
                      <img
                        src={classifiedArtifacts.trajectory3d.url}
                        alt="3D Trajectory"
                        className="w-full rounded-lg bg-black/40 border border-[#363436]/20"
                      />
                    </div>
                  )}
                  {classifiedArtifacts.trajectoryReprojected?.url && (
                    <div>
                      <p className="text-[10px] text-[#8A8885] mb-1.5">Reprojected View</p>
                      <img
                        src={classifiedArtifacts.trajectoryReprojected.url}
                        alt="Reprojected Trajectory"
                        className="w-full rounded-lg bg-black/40 border border-[#363436]/20"
                      />
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Individual Shots ── */}
            {classifiedArtifacts.shots.length > 0 && (
              <div className="bg-[#282729]/40 backdrop-blur-xl rounded-xl p-4 border border-[#363436]/30">
                <h3 className="text-xs font-medium text-[#E8E6E3] mb-3">Shot-by-Shot Analysis</h3>
                <div className="space-y-3">
                  {classifiedArtifacts.shots.map(({ index, image, video, image3d }) => {
                    const isExpanded = expandedShot === index;
                    const shotSummary = Array.isArray(summaryData?.shots)
                      ? (summaryData.shots as Array<Record<string, unknown>>).find(
                          (s) => Number(s.shot_index) === index
                        )
                      : null;

                    return (
                      <div
                        key={index}
                        className="rounded-lg bg-[#1E1D1F]/40 border border-[#363436]/40 overflow-hidden"
                      >
                        {/* Shot Header */}
                        <button
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-[#1E1D1F]/60 transition-colors"
                          onClick={() => setExpandedShot(isExpanded ? null : index)}
                        >
                          <span className="text-xs font-medium text-[#9B7B5B]">Shot {index + 1}</span>
                          {shotSummary && (
                            <>
                              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                                shotSummary.spin_type === "Topspin" ? "bg-[#5B9B7B]/20 text-[#5B9B7B]" :
                                shotSummary.spin_type === "Backspin" ? "bg-[#C45C5C]/20 text-[#C45C5C]" :
                                "bg-[#9B7B5B]/20 text-[#9B7B5B]"
                              }`}>{String(shotSummary.spin_type)}</span>
                              <span className="text-[10px] text-[#8A8885]">{Number(shotSummary.spin_rpm ?? 0).toFixed(0)} RPM</span>
                              <span className="text-[10px] text-[#6A6865]">{String(shotSummary.frames ?? "")}</span>
                            </>
                          )}
                          <span className="ml-auto text-[10px] text-[#6A6865]">{isExpanded ? "Collapse" : "Expand"}</span>
                        </button>

                        {/* Shot Content */}
                        {isExpanded && (
                          <div className="px-4 pb-4 space-y-3">
                            {/* 2D trajectory + 3D side-by-side */}
                            <div className="grid grid-cols-2 gap-3">
                              {image?.url && (
                                <div>
                                  <p className="text-[10px] text-[#8A8885] mb-1.5">2D Trajectory</p>
                                  <img
                                    src={image.url}
                                    alt={`Shot ${index + 1} trajectory`}
                                    className="w-full rounded-lg bg-black/40 border border-[#363436]/20"
                                  />
                                </div>
                              )}
                              {image3d?.url && (
                                <div>
                                  <p className="text-[10px] text-[#8A8885] mb-1.5">3D Reconstruction</p>
                                  <img
                                    src={image3d.url}
                                    alt={`Shot ${index + 1} 3D`}
                                    className="w-full rounded-lg bg-black/40 border border-[#363436]/20"
                                  />
                                </div>
                              )}
                            </div>

                            {/* Shot video */}
                            {video?.url && (
                              <div>
                                <p className="text-[10px] text-[#8A8885] mb-1.5 flex items-center gap-1">
                                  <Play className="w-3 h-3" /> Shot Clip
                                </p>
                                <video
                                  controls
                                  src={video.url}
                                  className="w-full rounded-lg bg-black/40 border border-[#363436]/20"
                                />
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
