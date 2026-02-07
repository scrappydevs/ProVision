"use client";

import { Card } from "@/components/ui/card";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

interface MovementAnalysisProps {
  data: {
    stance_width_timeline: Array<{ frame: number; width: number }>;
    arm_extension_timeline: Array<{ frame: number; left: number | null; right: number | null }>;
    velocity_timeline: Array<{ frame: number; velocity: number }>;
    avg_stance_width: number;
    avg_velocity: number;
  };
}

export function MovementAnalysis({ data }: MovementAnalysisProps) {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-foreground">🤸 Movement & Technique</h3>
      
      {/* Stats Cards */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="p-3 bg-card/40 backdrop-blur-xl border-border">
          <div className="text-xs text-muted-foreground">Avg Stance Width</div>
          <div className="text-2xl font-bold text-accent">{data.avg_stance_width.toFixed(3)}</div>
          <div className="text-xs text-muted-foreground">normalized</div>
        </Card>
        <Card className="p-3 bg-card/40 backdrop-blur-xl border-border">
          <div className="text-xs text-muted-foreground">Avg Velocity</div>
          <div className="text-2xl font-bold text-foreground">{data.avg_velocity.toFixed(1)}</div>
          <div className="text-xs text-muted-foreground">px/s</div>
        </Card>
      </div>

      {/* Stance Width Timeline */}
      {data.stance_width_timeline.length > 0 && (
        <Card className="p-4 bg-card/40 backdrop-blur-xl border-border">
          <h4 className="text-sm font-medium mb-3 text-foreground">Stance Width Over Time</h4>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={data.stance_width_timeline}>
              <CartesianGrid strokeDasharray="3 3" stroke="#363436" opacity={0.3} />
              <XAxis 
                dataKey="frame" 
                stroke="#8A8885"
                tick={{ fill: '#8A8885', fontSize: 12 }}
                label={{ value: 'Frame', position: 'insideBottom', offset: -5, fill: '#8A8885' }}
              />
              <YAxis 
                stroke="#8A8885"
                tick={{ fill: '#8A8885', fontSize: 12 }}
                label={{ value: 'Width (normalized)', angle: -90, position: 'insideLeft', fill: '#8A8885' }}
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: '#282729', 
                  border: '1px solid #363436',
                  borderRadius: '8px',
                  color: '#E8E6E3'
                }}
                formatter={(value: number) => [value.toFixed(3), 'Width']}
              />
              <Line 
                type="monotone" 
                dataKey="width" 
                stroke="#7B8ECE" 
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* Arm Extension Timeline */}
      {data.arm_extension_timeline.length > 0 && (
        <Card className="p-4 bg-card/40 backdrop-blur-xl border-border">
          <h4 className="text-sm font-medium mb-3 text-foreground">Arm Extension Over Time</h4>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={data.arm_extension_timeline}>
              <CartesianGrid strokeDasharray="3 3" stroke="#363436" opacity={0.3} />
              <XAxis 
                dataKey="frame" 
                stroke="#8A8885"
                tick={{ fill: '#8A8885', fontSize: 12 }}
                label={{ value: 'Frame', position: 'insideBottom', offset: -5, fill: '#8A8885' }}
              />
              <YAxis 
                stroke="#8A8885"
                tick={{ fill: '#8A8885', fontSize: 12 }}
                label={{ value: 'Extension (normalized)', angle: -90, position: 'insideLeft', fill: '#8A8885' }}
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: '#282729', 
                  border: '1px solid #363436',
                  borderRadius: '8px',
                  color: '#E8E6E3'
                }}
                formatter={(value: number | null) => value !== null ? [value.toFixed(3), ''] : ['N/A', '']}
              />
              <Legend 
                wrapperStyle={{ color: '#E8E6E3' }}
                iconType="line"
              />
              <Line 
                type="monotone" 
                dataKey="left" 
                stroke="#6B8E6B" 
                strokeWidth={2}
                dot={false}
                name="Left Arm"
                connectNulls
              />
              <Line 
                type="monotone" 
                dataKey="right" 
                stroke="#9B7B5B" 
                strokeWidth={2}
                dot={false}
                name="Right Arm"
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* Player Velocity Timeline */}
      {data.velocity_timeline.length > 0 && (
        <Card className="p-4 bg-card/40 backdrop-blur-xl border-border">
          <h4 className="text-sm font-medium mb-3 text-foreground">Player Movement Speed</h4>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={data.velocity_timeline}>
              <CartesianGrid strokeDasharray="3 3" stroke="#363436" opacity={0.3} />
              <XAxis 
                dataKey="frame" 
                stroke="#8A8885"
                tick={{ fill: '#8A8885', fontSize: 12 }}
                label={{ value: 'Frame', position: 'insideBottom', offset: -5, fill: '#8A8885' }}
              />
              <YAxis 
                stroke="#8A8885"
                tick={{ fill: '#8A8885', fontSize: 12 }}
                label={{ value: 'Velocity (px/s)', angle: -90, position: 'insideLeft', fill: '#8A8885' }}
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: '#282729', 
                  border: '1px solid #363436',
                  borderRadius: '8px',
                  color: '#E8E6E3'
                }}
                formatter={(value: number) => [`${value.toFixed(1)} px/s`, 'Velocity']}
              />
              <Line 
                type="monotone" 
                dataKey="velocity" 
                stroke="#CE9B7B" 
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      )}
    </div>
  );
}
