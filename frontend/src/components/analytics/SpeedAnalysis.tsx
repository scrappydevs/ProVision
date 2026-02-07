"use client";

import { Card } from "@/components/ui/card";
import { LineChart, Line, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

interface SpeedAnalysisProps {
  data: {
    max: number;
    min: number;
    avg: number;
    median: number;
    stddev: number;
    timeline: Array<{ frame: number; speed: number; timestamp: number }>;
    distribution: { slow: number; medium: number; fast: number };
  };
}

export function SpeedAnalysis({ data }: SpeedAnalysisProps) {
  // Prepare histogram data
  const histogramData = [
    { zone: "Slow", count: data.distribution.slow, fill: "#7B8ECE" },
    { zone: "Medium", count: data.distribution.medium, fill: "#9B7B5B" },
    { zone: "Fast", count: data.distribution.fast, fill: "#6B8E6B" }
  ];

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-foreground">🏓 Ball Speed Analysis</h3>
      
      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className="p-3 bg-card/40 backdrop-blur-xl border-border">
          <div className="text-xs text-muted-foreground">Max Speed</div>
          <div className="text-2xl font-bold text-foreground">{data.max}</div>
          <div className="text-xs text-muted-foreground">km/h</div>
        </Card>
        <Card className="p-3 bg-card/40 backdrop-blur-xl border-border">
          <div className="text-xs text-muted-foreground">Avg Speed</div>
          <div className="text-2xl font-bold text-accent">{data.avg}</div>
          <div className="text-xs text-muted-foreground">km/h</div>
        </Card>
        <Card className="p-3 bg-card/40 backdrop-blur-xl border-border">
          <div className="text-xs text-muted-foreground">Min Speed</div>
          <div className="text-2xl font-bold text-foreground">{data.min}</div>
          <div className="text-xs text-muted-foreground">km/h</div>
        </Card>
        <Card className="p-3 bg-card/40 backdrop-blur-xl border-border">
          <div className="text-xs text-muted-foreground">Median</div>
          <div className="text-2xl font-bold text-foreground">{data.median}</div>
          <div className="text-xs text-muted-foreground">km/h</div>
        </Card>
        <Card className="p-3 bg-card/40 backdrop-blur-xl border-border">
          <div className="text-xs text-muted-foreground">Std Dev</div>
          <div className="text-2xl font-bold text-foreground">{data.stddev}</div>
          <div className="text-xs text-muted-foreground">km/h</div>
        </Card>
      </div>

      {/* Speed Timeline */}
      <Card className="p-4 bg-card/40 backdrop-blur-xl border-border">
        <h4 className="text-sm font-medium mb-3 text-foreground">Speed Over Time</h4>
        <ResponsiveContainer width="100%" height={250}>
          <AreaChart data={data.timeline}>
            <defs>
              <linearGradient id="speedGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#9B7B5B" stopOpacity={0.8}/>
                <stop offset="95%" stopColor="#9B7B5B" stopOpacity={0.1}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#363436" opacity={0.3} />
            <XAxis 
              dataKey="timestamp" 
              stroke="#8A8885"
              tick={{ fill: '#8A8885', fontSize: 12 }}
              label={{ value: 'Time (s)', position: 'insideBottom', offset: -5, fill: '#8A8885' }}
            />
            <YAxis 
              stroke="#8A8885"
              tick={{ fill: '#8A8885', fontSize: 12 }}
              label={{ value: 'Speed (km/h)', angle: -90, position: 'insideLeft', fill: '#8A8885' }}
            />
            <Tooltip 
              contentStyle={{ 
                backgroundColor: '#282729', 
                border: '1px solid #363436',
                borderRadius: '8px',
                color: '#E8E6E3'
              }}
              formatter={(value: number | undefined) => value !== undefined ? [`${value} km/h`, 'Speed'] : ['N/A', 'Speed']}
              labelFormatter={(label) => `Time: ${label}s`}
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
      </Card>

      {/* Speed Distribution */}
      <Card className="p-4 bg-card/40 backdrop-blur-xl border-border">
        <h4 className="text-sm font-medium mb-3 text-foreground">Speed Distribution</h4>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={histogramData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#363436" opacity={0.3} />
            <XAxis 
              dataKey="zone" 
              stroke="#8A8885"
              tick={{ fill: '#8A8885', fontSize: 12 }}
            />
            <YAxis 
              stroke="#8A8885"
              tick={{ fill: '#8A8885', fontSize: 12 }}
              label={{ value: 'Count', angle: -90, position: 'insideLeft', fill: '#8A8885' }}
            />
            <Tooltip 
              contentStyle={{ 
                backgroundColor: '#282729', 
                border: '1px solid #363436',
                borderRadius: '8px',
                color: '#E8E6E3'
              }}
              formatter={(value: number | undefined) => value !== undefined ? [`${value} frames`, 'Count'] : ['N/A', 'Count']}
            />
            <Bar dataKey="count" fill="#9B7B5B" radius={[8, 8, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
        <div className="mt-3 text-xs text-muted-foreground">
          <p>• Slow: Below {(data.avg * 0.7).toFixed(1)} km/h</p>
          <p>• Medium: {(data.avg * 0.7).toFixed(1)} - {(data.avg * 1.3).toFixed(1)} km/h</p>
          <p>• Fast: Above {(data.avg * 1.3).toFixed(1)} km/h</p>
        </div>
      </Card>
    </div>
  );
}
