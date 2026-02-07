"use client";

import { useAnalytics } from "@/hooks/useAnalytics";
import { usePoseAnalysis } from "@/hooks/usePoseData";
import { runRunpodDashboard } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, AlertCircle, Activity, TrendingUp, Zap, Target, ExternalLink, RefreshCw } from "lucide-react";
import { LineChart, Line, BarChart, Bar, ScatterChart, Scatter, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell, Area, AreaChart } from "recharts";
import { useCallback, useEffect, useMemo, useRef } from "react";

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
  const autoRunRef = useRef(false);
  const runpodMutation = useMutation({
    mutationFn: async (force: boolean = false) => {
      const response = await runRunpodDashboard(sessionId, force);
      return response.data;
    },
    onSuccess: () => {
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

  const runpodDashboard = analytics?.runpod_dashboard;
  const runpodArtifacts = runpodDashboard?.artifacts || [];

  useEffect(() => {
    autoRunRef.current = false;
  }, [sessionId]);

  useEffect(() => {
    if (!analytics) return;
    if (autoRunRef.current) return;
    if (runpodArtifacts.length > 0) return;
    autoRunRef.current = true;
    runpodMutation.mutate(false);
  }, [analytics, runpodArtifacts.length, runpodMutation]);

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

      {/* RunPod Dashboard Outputs */}
      <div className="bg-[#282729]/40 backdrop-blur-xl rounded-xl p-4 border border-[#363436]/30">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h3 className="text-xs font-medium text-[#E8E6E3]">RunPod Dashboard Outputs</h3>
            <p className="text-[10px] text-[#8A8885] mt-1">
              {runpodMutation.isPending
                ? "Processing dashboard game video on RunPod..."
                : runpodArtifacts.length > 0
                ? `${runpodArtifacts.length} artifact(s) synced from ${runpodDashboard?.folder ?? "runpod-dashboard"}`
                : "No synced outputs yet. Triggering run automatically."}
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
              <RefreshCw className="w-3 h-3 mr-1" />
            )}
            Re-run
          </Button>
        </div>

        {runpodDashboard?.error && (
          <p className="text-[10px] text-[#C45C5C] mb-2">
            {runpodDashboard.error}
          </p>
        )}

        {runpodArtifacts.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[#4A4846] p-3 text-[10px] text-[#8A8885]">
            Waiting for uploaded outputs from `/workspace/UpliftingTableTennis/file`.
          </div>
        ) : (
          <div className="space-y-3">
            {runpodArtifacts.map((artifact) => (
              <div key={artifact.path} className="rounded-lg bg-[#1E1D1F]/40 border border-[#363436]/40 p-3">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <p className="text-[11px] text-[#E8E6E3] truncate">{artifact.name}</p>
                    <p className="text-[10px] text-[#8A8885]">
                      {artifact.kind.toUpperCase()} • {formatBytes(artifact.size)}
                    </p>
                  </div>
                  {artifact.url && (
                    <a
                      href={artifact.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[10px] text-[#9B7B5B] hover:text-[#C3A07B]"
                    >
                      <ExternalLink className="w-3 h-3" />
                      Open
                    </a>
                  )}
                </div>

                {artifact.kind === "video" && artifact.url && (
                  <video
                    controls
                    src={artifact.url}
                    className="w-full max-h-72 rounded-md bg-black/40"
                  />
                )}

                {artifact.kind === "image" && artifact.url && (
                  <img
                    src={artifact.url}
                    alt={artifact.name}
                    className="w-full max-h-72 object-contain rounded-md bg-black/40"
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
