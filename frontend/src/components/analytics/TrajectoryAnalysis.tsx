"use client";

import { Card } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";

interface TrajectoryAnalysisProps {
  data: {
    total_distance: number;
    bounce_count: number;
    bounces: number[];
    rallies: Array<{ start_frame: number; end_frame: number; length: number; avg_speed: number }>;
    direction_changes: number;
    arc_heights: number[];
  };
}

export function TrajectoryAnalysis({ data }: TrajectoryAnalysisProps) {
  // Prepare rally chart data
  const rallyChartData = data.rallies.map((rally, idx) => ({
    rally: `Rally ${idx + 1}`,
    length: rally.length,
    speed: rally.avg_speed,
    frames: `${rally.start_frame}-${rally.end_frame}`
  }));

  const colors = ['#7B8ECE', '#9B7B5B', '#6B8E6B', '#CE9B7B', '#8A6B4B'];

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-foreground">📈 Trajectory Analysis</h3>
      
      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-3 bg-card/40 backdrop-blur-xl border-border">
          <div className="text-xs text-muted-foreground">Total Distance</div>
          <div className="text-2xl font-bold text-foreground">{Math.round(data.total_distance)}</div>
          <div className="text-xs text-muted-foreground">pixels</div>
        </Card>
        <Card className="p-3 bg-card/40 backdrop-blur-xl border-border">
          <div className="text-xs text-muted-foreground">Bounces</div>
          <div className="text-2xl font-bold text-accent">{data.bounce_count}</div>
          <div className="text-xs text-muted-foreground">detected</div>
        </Card>
        <Card className="p-3 bg-card/40 backdrop-blur-xl border-border">
          <div className="text-xs text-muted-foreground">Rallies</div>
          <div className="text-2xl font-bold text-foreground">{data.rallies.length}</div>
          <div className="text-xs text-muted-foreground">segments</div>
        </Card>
        <Card className="p-3 bg-card/40 backdrop-blur-xl border-border">
          <div className="text-xs text-muted-foreground">Direction Changes</div>
          <div className="text-2xl font-bold text-foreground">{data.direction_changes}</div>
          <div className="text-xs text-muted-foreground">switches</div>
        </Card>
      </div>

      {/* Rally Lengths */}
      {rallyChartData.length > 0 && (
        <Card className="p-4 bg-card/40 backdrop-blur-xl border-border">
          <h4 className="text-sm font-medium mb-3 text-foreground">Rally Lengths</h4>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={rallyChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#363436" opacity={0.3} />
              <XAxis 
                dataKey="rally" 
                stroke="#8A8885"
                tick={{ fill: '#8A8885', fontSize: 12 }}
              />
              <YAxis 
                stroke="#8A8885"
                tick={{ fill: '#8A8885', fontSize: 12 }}
                label={{ value: 'Frames', angle: -90, position: 'insideLeft', fill: '#8A8885' }}
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: '#282729', 
                  border: '1px solid #363436',
                  borderRadius: '8px',
                  color: '#E8E6E3'
                }}
                formatter={(value: number | undefined, name?: string) => {
                  if (value === undefined) return ['N/A', name ?? ''];
                  if (name === 'length') return [`${value} frames`, 'Length'];
                  if (name === 'speed') return [`${value} km/h`, 'Avg Speed'];
                  return [value, name ?? ''];
                }}
                labelFormatter={(label) => label}
              />
              <Bar dataKey="length" radius={[8, 8, 0, 0]}>
                {rallyChartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            {data.rallies.slice(0, 6).map((rally, idx) => (
              <div key={idx} className="flex justify-between text-muted-foreground">
                <span>Rally {idx + 1}:</span>
                <span className="text-foreground">{rally.length} frames ({rally.avg_speed} km/h)</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Arc Heights */}
      {data.arc_heights.length > 0 && (
        <Card className="p-4 bg-card/40 backdrop-blur-xl border-border">
          <h4 className="text-sm font-medium mb-3 text-foreground">Arc Heights</h4>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Average Height:</span>
              <span className="text-foreground font-medium">
                {(data.arc_heights.reduce((a, b) => a + b, 0) / data.arc_heights.length).toFixed(1)} px
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Max Height:</span>
              <span className="text-foreground font-medium">{Math.max(...data.arc_heights).toFixed(1)} px</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Min Height:</span>
              <span className="text-foreground font-medium">{Math.min(...data.arc_heights).toFixed(1)} px</span>
            </div>
          </div>
        </Card>
      )}

      {/* Bounce Markers */}
      {data.bounces.length > 0 && (
        <Card className="p-4 bg-card/40 backdrop-blur-xl border-border">
          <h4 className="text-sm font-medium mb-3 text-foreground">Bounce Frames</h4>
          <div className="flex flex-wrap gap-2">
            {data.bounces.slice(0, 20).map((frame, idx) => (
              <div 
                key={idx}
                className="px-3 py-1 bg-accent/20 border border-accent/40 rounded-lg text-xs text-foreground"
              >
                {frame}
              </div>
            ))}
            {data.bounces.length > 20 && (
              <div className="px-3 py-1 text-xs text-muted-foreground">
                +{data.bounces.length - 20} more
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
