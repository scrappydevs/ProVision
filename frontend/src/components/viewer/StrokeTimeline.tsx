"use client";

import { memo, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, TrendingUp, Target } from "lucide-react";
import { Stroke } from "@/lib/api";

interface StrokeTimelineProps {
  strokes: Stroke[];
  currentFrame?: number;
  onStrokeClick?: (stroke: Stroke) => void;
}

export const StrokeTimeline = memo(function StrokeTimeline({
  strokes,
  currentFrame,
  onStrokeClick,
}: StrokeTimelineProps) {
  // Calculate timeline visualization data
  const timelineData = useMemo(() => {
    if (!strokes.length) return null;

    const maxFrame = Math.max(...strokes.map(s => s.end_frame));
    const minFrame = Math.min(...strokes.map(s => s.start_frame));
    const frameRange = maxFrame - minFrame;

    return { maxFrame, minFrame, frameRange };
  }, [strokes]);

  // Get color based on form score
  const getScoreColor = (score: number) => {
    if (score >= 85) return "bg-[#6B8E6B]"; // Green
    if (score >= 70) return "bg-[#9B7B5B]"; // Accent
    return "bg-[#C45C5C]"; // Red
  };

  // Get stroke type icon
  const getStrokeTypeIcon = (type: string) => {
    switch (type) {
      case "forehand":
        return "FH";
      case "backhand":
        return "BH";
      default:
        return "??";
    }
  };

  if (!strokes.length || !timelineData) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Activity className="w-4 h-4" />
            Stroke Timeline
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-[#8A8885]">
            No strokes detected. Analyze strokes first.
          </p>
        </CardContent>
      </Card>
    );
  }

  const { maxFrame, minFrame, frameRange } = timelineData;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Activity className="w-4 h-4" />
          Stroke Timeline ({strokes.length} strokes)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Timeline Visualization */}
        <div className="relative h-16 bg-[#1C1A19] rounded-lg overflow-hidden">
          {/* Current frame indicator */}
          {currentFrame !== undefined && (
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-[#E8E6E3] z-10"
              style={{
                left: `${((currentFrame - minFrame) / frameRange) * 100}%`,
              }}
            />
          )}

          {/* Stroke markers */}
          {strokes.map((stroke) => {
            const startPercent = ((stroke.start_frame - minFrame) / frameRange) * 100;
            const widthPercent = ((stroke.end_frame - stroke.start_frame) / frameRange) * 100;
            const isActive = currentFrame !== undefined &&
              currentFrame >= stroke.start_frame &&
              currentFrame <= stroke.end_frame;

            return (
              <div
                key={stroke.id}
                className={`absolute top-2 bottom-2 rounded cursor-pointer transition-all hover:opacity-80 ${getScoreColor(stroke.form_score)} ${isActive ? "ring-2 ring-[#E8E6E3]" : ""}`}
                style={{
                  left: `${startPercent}%`,
                  width: `${widthPercent}%`,
                }}
                onClick={() => onStrokeClick?.(stroke)}
                title={`${stroke.stroke_type} - Score: ${stroke.form_score.toFixed(1)}`}
              />
            );
          })}
        </div>

        {/* Stroke List */}
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {strokes.map((stroke, index) => {
            const isActive = currentFrame !== undefined &&
              currentFrame >= stroke.start_frame &&
              currentFrame <= stroke.end_frame;

            return (
              <div
                key={stroke.id}
                className={`flex items-center justify-between p-2 rounded-lg border transition-all cursor-pointer hover:border-[#9B7B5B] ${isActive ? "border-[#9B7B5B] bg-[#9B7B5B]/10" : "border-[#2C2A29]"}`}
                onClick={() => onStrokeClick?.(stroke)}
              >
                <div className="flex items-center gap-3">
                  <Badge variant="outline" className="w-8 h-8 flex items-center justify-center text-xs">
                    {getStrokeTypeIcon(stroke.stroke_type)}
                  </Badge>
                  <div>
                    <p className="text-sm text-[#E8E6E3] capitalize">
                      {stroke.stroke_type} #{index + 1}
                    </p>
                    <p className="text-xs text-[#8A8885]">
                      Frames {stroke.start_frame}-{stroke.end_frame}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-sm text-[#E8E6E3] font-medium">
                      {stroke.form_score.toFixed(1)}
                    </p>
                    <p className="text-xs text-[#8A8885]">Form Score</p>
                  </div>
                  <div
                    className={`w-2 h-2 rounded-full ${getScoreColor(stroke.form_score)}`}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 text-xs text-[#8A8885] pt-2 border-t border-[#2C2A29]">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-[#6B8E6B]" />
            <span>Excellent (85+)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-[#9B7B5B]" />
            <span>Good (70-84)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-[#C45C5C]" />
            <span>Needs Work (&lt;70)</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
});

interface FormMetricsCardProps {
  strokeSummary: {
    average_form_score: number;
    best_form_score: number;
    consistency_score: number;
    total_strokes: number;
    forehand_count: number;
    backhand_count: number;
  };
}

export const FormMetricsCard = memo(function FormMetricsCard({
  strokeSummary,
}: FormMetricsCardProps) {
  const getScoreColor = (score: number) => {
    if (score >= 85) return "text-[#6B8E6B]";
    if (score >= 70) return "text-[#9B7B5B]";
    return "text-[#C45C5C]";
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Target className="w-4 h-4" />
          Form Quality Metrics
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Main Scores */}
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center p-3 rounded-lg bg-[#1C1A19]">
              <p className="text-xs text-[#8A8885] mb-1">Average Score</p>
              <p className={`text-2xl font-bold ${getScoreColor(strokeSummary.average_form_score)}`}>
                {strokeSummary.average_form_score.toFixed(1)}
              </p>
            </div>
            <div className="text-center p-3 rounded-lg bg-[#1C1A19]">
              <p className="text-xs text-[#8A8885] mb-1">Best Score</p>
              <p className={`text-2xl font-bold ${getScoreColor(strokeSummary.best_form_score)}`}>
                {strokeSummary.best_form_score.toFixed(1)}
              </p>
            </div>
            <div className="text-center p-3 rounded-lg bg-[#1C1A19]">
              <p className="text-xs text-[#8A8885] mb-1">Consistency</p>
              <p className="text-2xl font-bold text-[#9B7B5B]">
                {strokeSummary.consistency_score.toFixed(1)}
              </p>
            </div>
          </div>

          {/* Stroke Breakdown */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-[#8A8885]">Total Strokes</span>
              <span className="text-[#E8E6E3] font-medium">{strokeSummary.total_strokes}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-[#8A8885]">Forehands</span>
              <span className="text-[#E8E6E3]">{strokeSummary.forehand_count}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-[#8A8885]">Backhands</span>
              <span className="text-[#E8E6E3]">{strokeSummary.backhand_count}</span>
            </div>
          </div>

          {/* Performance Indicator */}
          <div className="pt-2 border-t border-[#2C2A29]">
            <div className="flex items-center gap-2 text-sm">
              <TrendingUp className={`w-4 h-4 ${getScoreColor(strokeSummary.average_form_score)}`} />
              <span className="text-[#8A8885]">
                {strokeSummary.average_form_score >= 85
                  ? "Excellent technique! Keep it up."
                  : strokeSummary.average_form_score >= 70
                  ? "Good technique. Focus on consistency."
                  : "Room for improvement. Practice form basics."}
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
});
