"use client";

import { Card } from "@/components/ui/card";
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";

interface CorrelationGridProps {
  speedVsStance: Array<{ speed: number; stance: number; frame: number }>;
  speedVsExtension: Array<{ speed: number; extension: number; frame: number }>;
}

export function CorrelationGrid({ speedVsStance, speedVsExtension }: CorrelationGridProps) {
  // Calculate correlation coefficient (Pearson's r)
  const calculateCorrelation = (data: Array<{ x: number; y: number }>) => {
    if (data.length < 2) return 0;
    
    const n = data.length;
    const sumX = data.reduce((sum, point) => sum + point.x, 0);
    const sumY = data.reduce((sum, point) => sum + point.y, 0);
    const sumXY = data.reduce((sum, point) => sum + point.x * point.y, 0);
    const sumX2 = data.reduce((sum, point) => sum + point.x * point.x, 0);
    const sumY2 = data.reduce((sum, point) => sum + point.y * point.y, 0);
    
    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
    
    if (denominator === 0) return 0;
    return numerator / denominator;
  };

  const stanceData = speedVsStance.map(p => ({ x: p.stance, y: p.speed, frame: p.frame }));
  const extensionData = speedVsExtension.map(p => ({ x: p.extension, y: p.speed, frame: p.frame }));
  
  const stanceCorr = calculateCorrelation(stanceData);
  const extensionCorr = calculateCorrelation(extensionData);

  const getCorrelationColor = (r: number) => {
    const absR = Math.abs(r);
    if (absR < 0.3) return "#8A8885"; // weak
    if (absR < 0.7) return "#9B7B5B"; // moderate
    return "#6B8E6B"; // strong
  };

  const getCorrelationStrength = (r: number) => {
    const absR = Math.abs(r);
    if (absR < 0.3) return "Weak";
    if (absR < 0.7) return "Moderate";
    return "Strong";
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-foreground">📊 Performance Correlations</h3>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Speed vs Stance Width */}
        {stanceData.length > 0 && (
          <Card className="p-4 bg-card/40 backdrop-blur-xl border-border">
            <div className="flex justify-between items-center mb-3">
              <h4 className="text-sm font-medium text-foreground">Ball Speed vs Stance Width</h4>
              <div className="text-right">
                <div className="text-xs text-muted-foreground">Correlation</div>
                <div 
                  className="text-lg font-bold"
                  style={{ color: getCorrelationColor(stanceCorr) }}
                >
                  {stanceCorr.toFixed(3)}
                </div>
                <div className="text-xs text-muted-foreground">{getCorrelationStrength(stanceCorr)}</div>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={250}>
              <ScatterChart>
                <CartesianGrid strokeDasharray="3 3" stroke="#363436" opacity={0.3} />
                <XAxis 
                  dataKey="x" 
                  stroke="#8A8885"
                  tick={{ fill: '#8A8885', fontSize: 11 }}
                  label={{ value: 'Stance Width', position: 'insideBottom', offset: -5, fill: '#8A8885', fontSize: 11 }}
                />
                <YAxis 
                  dataKey="y"
                  stroke="#8A8885"
                  tick={{ fill: '#8A8885', fontSize: 11 }}
                  label={{ value: 'Ball Speed (km/h)', angle: -90, position: 'insideLeft', fill: '#8A8885', fontSize: 11 }}
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: '#282729', 
                    border: '1px solid #363436',
                    borderRadius: '8px',
                    color: '#E8E6E3',
                    fontSize: 12
                  }}
                  formatter={(value: number | undefined, name?: string) => {
                    if (value === undefined) return ['N/A', name ?? ''];
                    if (name === 'x') return [value.toFixed(3), 'Stance'];
                    if (name === 'y') return [`${value.toFixed(1)} km/h`, 'Speed'];
                    return [value, name ?? ''];
                  }}
                  labelFormatter={(_, payload) => {
                    if (payload && payload[0]) {
                      return `Frame ${payload[0].payload.frame}`;
                    }
                    return '';
                  }}
                />
                <Scatter data={stanceData} fill="#7B8ECE" fillOpacity={0.6}>
                  {stanceData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill="#7B8ECE" />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
            <p className="text-xs text-muted-foreground mt-2">
              {stanceCorr > 0 ? "Wider stance tends to correlate with higher ball speed" : 
               stanceCorr < 0 ? "Narrower stance tends to correlate with higher ball speed" :
               "No clear correlation between stance width and ball speed"}
            </p>
          </Card>
        )}

        {/* Speed vs Arm Extension */}
        {extensionData.length > 0 && (
          <Card className="p-4 bg-card/40 backdrop-blur-xl border-border">
            <div className="flex justify-between items-center mb-3">
              <h4 className="text-sm font-medium text-foreground">Ball Speed vs Arm Extension</h4>
              <div className="text-right">
                <div className="text-xs text-muted-foreground">Correlation</div>
                <div 
                  className="text-lg font-bold"
                  style={{ color: getCorrelationColor(extensionCorr) }}
                >
                  {extensionCorr.toFixed(3)}
                </div>
                <div className="text-xs text-muted-foreground">{getCorrelationStrength(extensionCorr)}</div>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={250}>
              <ScatterChart>
                <CartesianGrid strokeDasharray="3 3" stroke="#363436" opacity={0.3} />
                <XAxis 
                  dataKey="x" 
                  stroke="#8A8885"
                  tick={{ fill: '#8A8885', fontSize: 11 }}
                  label={{ value: 'Arm Extension', position: 'insideBottom', offset: -5, fill: '#8A8885', fontSize: 11 }}
                />
                <YAxis 
                  dataKey="y"
                  stroke="#8A8885"
                  tick={{ fill: '#8A8885', fontSize: 11 }}
                  label={{ value: 'Ball Speed (km/h)', angle: -90, position: 'insideLeft', fill: '#8A8885', fontSize: 11 }}
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: '#282729', 
                    border: '1px solid #363436',
                    borderRadius: '8px',
                    color: '#E8E6E3',
                    fontSize: 12
                  }}
                  formatter={(value: number | undefined, name?: string) => {
                    if (value === undefined) return ['N/A', name ?? ''];
                    if (name === 'x') return [value.toFixed(3), 'Extension'];
                    if (name === 'y') return [`${value.toFixed(1)} km/h`, 'Speed'];
                    return [value, name ?? ''];
                  }}
                  labelFormatter={(_, payload) => {
                    if (payload && payload[0]) {
                      return `Frame ${payload[0].payload.frame}`;
                    }
                    return '';
                  }}
                />
                <Scatter data={extensionData} fill="#9B7B5B" fillOpacity={0.6}>
                  {extensionData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill="#9B7B5B" />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
            <p className="text-xs text-muted-foreground mt-2">
              {extensionCorr > 0 ? "Greater arm extension tends to correlate with higher ball speed" : 
               extensionCorr < 0 ? "Less arm extension tends to correlate with higher ball speed" :
               "No clear correlation between arm extension and ball speed"}
            </p>
          </Card>
        )}
      </div>

      {/* Summary Card */}
      <Card className="p-4 bg-card/40 backdrop-blur-xl border-border">
        <h4 className="text-sm font-medium mb-3 text-foreground">Insights Summary</h4>
        <div className="space-y-2 text-sm">
          {stanceData.length > 0 && (
            <div className="flex items-start gap-2">
              <span className="text-muted-foreground">•</span>
              <span className="text-foreground">
                Stance width shows a <span className="font-medium" style={{ color: getCorrelationColor(stanceCorr) }}>
                  {getCorrelationStrength(stanceCorr).toLowerCase()}
                </span> correlation (r = {stanceCorr.toFixed(3)}) with ball speed
              </span>
            </div>
          )}
          {extensionData.length > 0 && (
            <div className="flex items-start gap-2">
              <span className="text-muted-foreground">•</span>
              <span className="text-foreground">
                Arm extension shows a <span className="font-medium" style={{ color: getCorrelationColor(extensionCorr) }}>
                  {getCorrelationStrength(extensionCorr).toLowerCase()}
                </span> correlation (r = {extensionCorr.toFixed(3)}) with ball speed
              </span>
            </div>
          )}
          {stanceData.length === 0 && extensionData.length === 0 && (
            <div className="text-muted-foreground">No correlation data available</div>
          )}
        </div>
      </Card>
    </div>
  );
}
