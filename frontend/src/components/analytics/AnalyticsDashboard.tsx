"use client";

import { useAnalytics } from "@/hooks/useAnalytics";
import { usePoseAnalysis, type PoseFrame } from "@/hooks/usePoseData";
import { useStrokeSummary } from "@/hooks/useStrokeData";
import { useRunpodArtifacts } from "@/hooks/useRunpodArtifacts";
import { runRunpodDashboard, type RunpodDashboardArtifact } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, AlertCircle, Activity, Zap, Play, RotateCcw } from "lucide-react";
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
  const { data: strokeSummary } = useStrokeSummary(sessionId);
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

  // Split pose frames into player and opponent
  const playerFrames = useMemo<PoseFrame[]>(() => {
    if (!poseData?.frames) return [];
    return poseData.frames.filter((f: PoseFrame) => f.person_id === 0 || f.person_id === undefined);
  }, [poseData]);

  const opponentFrames = useMemo<PoseFrame[]>(() => {
    if (!poseData?.frames) return [];
    return poseData.frames.filter((f: PoseFrame) => f.person_id === 1);
  }, [poseData]);

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
    if (playerFrames.length === 0) return [];

    return playerFrames.map((frame: PoseFrame) => ({
      frame: frame.frame_number,
      timeSec: frame.frame_number / fps,
      leftElbow: frame.joint_angles?.left_elbow || 0,
      rightElbow: frame.joint_angles?.right_elbow || 0,
      leftKnee: frame.joint_angles?.left_knee || 0,
      rightKnee: frame.joint_angles?.right_knee || 0,
      leftShoulder: frame.joint_angles?.left_shoulder || 0,
      rightShoulder: frame.joint_angles?.right_shoulder || 0,
    }));
  }, [playerFrames, fps]);

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

  // Average opponent joint angles for radar comparison
  const avgOpponentJointAngles = useMemo(() => {
    if (opponentFrames.length === 0) return [];

    const sum = opponentFrames.reduce(
      (acc, frame: PoseFrame) => ({
        leftElbow: acc.leftElbow + (frame.joint_angles?.left_elbow || 0),
        rightElbow: acc.rightElbow + (frame.joint_angles?.right_elbow || 0),
        leftKnee: acc.leftKnee + (frame.joint_angles?.left_knee || 0),
        rightKnee: acc.rightKnee + (frame.joint_angles?.right_knee || 0),
        leftShoulder: acc.leftShoulder + (frame.joint_angles?.left_shoulder || 0),
        rightShoulder: acc.rightShoulder + (frame.joint_angles?.right_shoulder || 0),
      }),
      { leftElbow: 0, rightElbow: 0, leftKnee: 0, rightKnee: 0, leftShoulder: 0, rightShoulder: 0 }
    );

    const count = opponentFrames.length;
    return [
      { joint: "L Elbow", angle: sum.leftElbow / count, fullMark: 180 },
      { joint: "R Elbow", angle: sum.rightElbow / count, fullMark: 180 },
      { joint: "L Knee", angle: sum.leftKnee / count, fullMark: 180 },
      { joint: "R Knee", angle: sum.rightKnee / count, fullMark: 180 },
      { joint: "L Shoulder", angle: sum.leftShoulder / count, fullMark: 180 },
      { joint: "R Shoulder", angle: sum.rightShoulder / count, fullMark: 180 },
    ];
  }, [opponentFrames]);

  // Merged radar data for dual-layer chart
  const radarComparisonData = useMemo(() => {
    if (avgJointAngles.length === 0) return [];
    return avgJointAngles.map((item, i) => ({
      joint: item.joint,
      player: item.angle,
      opponent: avgOpponentJointAngles[i]?.angle ?? 0,
      fullMark: 180,
    }));
  }, [avgJointAngles, avgOpponentJointAngles]);

  const hasOpponentData = opponentFrames.length > 10;

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

  // --- Derived stats ---

  // Shot mix from stroke summary
  const shotMix = useMemo(() => {
    if (!strokeSummary?.total_strokes) return null;
    const total = strokeSummary.total_strokes;
    const fhPct = Math.round((strokeSummary.forehand_count / total) * 100);
    const bhPct = 100 - fhPct;
    const fhStrokes = strokeSummary.strokes.filter((s) => s.stroke_type === "forehand");
    const bhStrokes = strokeSummary.strokes.filter((s) => s.stroke_type === "backhand");
    const fhAvgForm = fhStrokes.length ? fhStrokes.reduce((sum, s) => sum + s.form_score, 0) / fhStrokes.length : 0;
    const bhAvgForm = bhStrokes.length ? bhStrokes.reduce((sum, s) => sum + s.form_score, 0) / bhStrokes.length : 0;
    const bestForm = strokeSummary.best_form_score;
    const fhSpeeds = fhStrokes.map((s) => s.max_velocity);
    const bhSpeeds = bhStrokes.map((s) => s.max_velocity);
    const fhAvgSpeed = fhSpeeds.length ? fhSpeeds.reduce((a, b) => a + b, 0) / fhSpeeds.length : 0;
    const bhAvgSpeed = bhSpeeds.length ? bhSpeeds.reduce((a, b) => a + b, 0) / bhSpeeds.length : 0;
    return {
      total, fhCount: strokeSummary.forehand_count, bhCount: strokeSummary.backhand_count,
      fhPct, bhPct, fhAvgForm: Math.round(fhAvgForm), bhAvgForm: Math.round(bhAvgForm),
      avgForm: Math.round(strokeSummary.average_form_score), bestForm: Math.round(bestForm),
      fhAvgSpeed: Math.round(fhAvgSpeed), bhAvgSpeed: Math.round(bhAvgSpeed),
    };
  }, [strokeSummary]);

  // Stroke consistency
  const consistency = useMemo(() => {
    if (!strokeSummary?.strokes?.length || strokeSummary.strokes.length < 2) return null;
    const scores = strokeSummary.strokes.map((s) => s.form_score);
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const variance = scores.reduce((sum, s) => sum + (s - mean) ** 2, 0) / scores.length;
    const stddev = Math.sqrt(variance);
    const cv = mean > 0 ? stddev / mean : 0;
    const score = Math.round(Math.max(0, Math.min(100, (1 - cv * 2) * 100)));
    return { score, stddev: Math.round(stddev), mean: Math.round(mean) };
  }, [strokeSummary]);

  // Contact height analysis
  const contactAnalysis = useMemo(() => {
    const moments = contact.contact_moments || [];
    if (!moments.length) return null;
    const heights = moments.map((c) => c.height);
    const avgHeight = heights.reduce((a, b) => a + b, 0) / heights.length;
    const highCount = heights.filter((h) => h > avgHeight * 1.2).length;
    const lowCount = heights.filter((h) => h < avgHeight * 0.8).length;
    return { avgHeight, highCount, lowCount, total: moments.length };
  }, [contact.contact_moments]);

  // --- AI Insight generators ---

  const overviewInsight = useMemo(() => {
    const parts: string[] = [];
    if (shotMix) {
      const dominant = shotMix.fhPct > 65 ? "forehand-dominant" : shotMix.bhPct > 65 ? "backhand-dominant" : "balanced";
      if (dominant !== "balanced") {
        const weaker = dominant === "forehand-dominant" ? "backhand" : "forehand";
        parts.push(`Heavily ${dominant} shot selection. The ${weaker} is underused — opponents at this level will target that side to exploit the imbalance.`);
      } else {
        parts.push(`Well-balanced shot selection between forehand and backhand, making the player tactically unpredictable.`);
      }
    }
    if (consistency) {
      if (consistency.score >= 80) parts.push(`Stroke mechanics are highly repeatable — a hallmark of elite-level technique.`);
      else if (consistency.score < 50) parts.push(`Stroke technique varies significantly between shots. Under pressure, mechanics tend to break down — drilling fundamentals would help lock it in.`);
      else parts.push(`Moderate stroke consistency. The best shots show what's possible, but the technique isn't fully locked in yet across every exchange.`);
    }
    if (hasOpponentData) {
      parts.push(`Opponent pose data available — comparative analysis included below.`);
    }
    return parts.length ? parts.join(" ") : null;
  }, [shotMix, consistency, hasOpponentData]);

  const speedInsight = useMemo(() => {
    const cvSpeed = ballSpeed.avg > 0 ? ballSpeed.stddev / ballSpeed.avg : 0;
    const parts: string[] = [];
    if (cvSpeed > 0.6) {
      parts.push("Wide speed variation across the match — mixing aggressive attacks with controlled placements. This tactical variety is effective at keeping opponents off-balance.");
    } else if (cvSpeed < 0.3) {
      parts.push("Very consistent ball speed throughout — solid baseline power but potentially predictable. Adding speed changes could create more openings.");
    } else {
      parts.push("Moderate speed variation — good balance between power shots and placement.");
    }
    if (ballSpeed.max > ballSpeed.avg * 3) {
      parts.push(`Peak speed is ${(ballSpeed.max / ballSpeed.avg).toFixed(1)}x the average, showing the ability to generate explosive power on key shots.`);
    }
    return parts.join(" ");
  }, [ballSpeed]);

  const movementInsight = useMemo(() => {
    const avgVel = movement.avg_velocity;
    const parts: string[] = [];
    if (avgVel < 1) {
      parts.push("Minimal lateral movement — the player stays planted and relies on reach rather than footwork. At the professional level, better split-stepping and recovery movement would improve court coverage.");
    } else if (avgVel > 3) {
      parts.push("Excellent court coverage with high movement speed. The player is reading the ball early and getting into position well ahead of contact.");
    } else {
      parts.push("Solid movement patterns with efficient positioning between shots.");
    }
    if (contactAnalysis && contactAnalysis.total > 3) {
      const highPct = Math.round((contactAnalysis.highCount / contactAnalysis.total) * 100);
      const lowPct = Math.round((contactAnalysis.lowCount / contactAnalysis.total) * 100);
      if (highPct > 40) parts.push(`${highPct}% of contacts are above average height — taking the ball early and aggressively.`);
      if (lowPct > 40) parts.push(`${lowPct}% of contacts are below average height — often retrieving low balls, which limits attacking options.`);
    }
    return parts.join(" ");
  }, [movement, contactAnalysis]);

  const jointInsight = useMemo(() => {
    if (playerFrames.length === 0) return null;

    const parts: string[] = [];

    const pElbows = playerFrames.map((f: PoseFrame) => f.joint_angles?.right_elbow || 0).filter((a) => a > 0);
    const pKnees = playerFrames.map((f: PoseFrame) => f.joint_angles?.right_knee || 0).filter((a) => a > 0);
    const pHips = playerFrames.map((f: PoseFrame) => f.joint_angles?.left_shoulder || 0).filter((a) => a > 0);

    const avgP = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

    if (hasOpponentData) {
      // Comparative mode
      const oElbows = opponentFrames.map((f: PoseFrame) => f.joint_angles?.right_elbow || 0).filter((a) => a > 0);
      const oKnees = opponentFrames.map((f: PoseFrame) => f.joint_angles?.right_knee || 0).filter((a) => a > 0);
      const oHips = opponentFrames.map((f: PoseFrame) => f.joint_angles?.left_shoulder || 0).filter((a) => a > 0);

      if (pElbows.length && oElbows.length) {
        const pAvg = avgP(pElbows);
        const oAvg = avgP(oElbows);
        const diff = Math.abs(pAvg - oAvg);
        if (diff > 10) {
          const more = pAvg > oAvg ? "more extended" : "more compact";
          parts.push(`Player's elbow averages ${Math.round(pAvg)}° vs opponent's ${Math.round(oAvg)}° — player uses a ${more} stroke, ${pAvg > oAvg ? "generating more power but needing faster recovery" : "trading raw power for quicker transitions"}.`);
        } else {
          parts.push(`Both players use similar elbow angles (~${Math.round(pAvg)}°), suggesting comparable stroke mechanics.`);
        }
      }

      if (pKnees.length && oKnees.length) {
        const pAvg = avgP(pKnees);
        const oAvg = avgP(oKnees);
        if (pAvg < oAvg - 8) {
          parts.push(`Player maintains a lower stance (knee ${Math.round(pAvg)}° vs ${Math.round(oAvg)}°) — better loaded for explosive footwork.`);
        } else if (pAvg > oAvg + 8) {
          parts.push(`Opponent sits lower (knee ${Math.round(oAvg)}° vs player's ${Math.round(pAvg)}°) — opponent has a more athletic base position.`);
        }
      }

      if (pHips.length && oHips.length) {
        const pAvg = avgP(pHips);
        const oAvg = avgP(oHips);
        const diff = Math.abs(pAvg - oAvg);
        if (diff > 8) {
          const who = pAvg > oAvg ? "Player" : "Opponent";
          parts.push(`${who} generates more hip rotation (${Math.round(Math.max(pAvg, oAvg))}° vs ${Math.round(Math.min(pAvg, oAvg))}°), translating to greater power transfer through the kinetic chain.`);
        }
      }
    } else {
      // Player-only mode (original behavior)
      if (pElbows.length) {
        const avgElbow = avgP(pElbows);
        const elbowRange = Math.max(...pElbows) - Math.min(...pElbows);
        if (avgElbow < 110) parts.push(`Compact elbow position (avg ${Math.round(avgElbow)}°) — good for close-table control but may limit power on mid-distance drives.`);
        else if (avgElbow > 150) parts.push(`Extended elbow (avg ${Math.round(avgElbow)}°) — generating power but potentially sacrificing quick recovery for the next shot.`);
        else parts.push(`Elbow angle (avg ${Math.round(avgElbow)}°) is in the ideal range for balancing power and control.`);
        if (elbowRange > 60) parts.push(`Wide elbow range (${Math.round(elbowRange)}°) shows good stroke differentiation between offensive and defensive shots.`);
      }

      if (pKnees.length) {
        const avgKnee = avgP(pKnees);
        if (avgKnee < 140) parts.push(`Low athletic stance (knee avg ${Math.round(avgKnee)}°) — great base for explosive movement but watch for fatigue over long matches.`);
        else if (avgKnee > 165) parts.push(`Standing fairly upright (knee avg ${Math.round(avgKnee)}°) — bending the knees more would improve balance and reaction time.`);
      }
    }

    return parts.length ? parts.join(" ") : null;
  }, [playerFrames, opponentFrames, hasOpponentData]);

  // Posture comparison insight (shoulder rotation & spine lean)
  const postureComparisonInsight = useMemo(() => {
    if (!hasOpponentData) return null;

    const parts: string[] = [];
    const avgP = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

    // Shoulder rotation — compare left vs right shoulder angles
    const pLShoulder = playerFrames.map((f: PoseFrame) => f.joint_angles?.left_shoulder || 0).filter((a) => a > 0);
    const pRShoulder = playerFrames.map((f: PoseFrame) => f.joint_angles?.right_shoulder || 0).filter((a) => a > 0);
    const oLShoulder = opponentFrames.map((f: PoseFrame) => f.joint_angles?.left_shoulder || 0).filter((a) => a > 0);
    const oRShoulder = opponentFrames.map((f: PoseFrame) => f.joint_angles?.right_shoulder || 0).filter((a) => a > 0);

    if (pLShoulder.length && pRShoulder.length && oLShoulder.length && oRShoulder.length) {
      const pRotation = Math.abs(avgP(pLShoulder) - avgP(pRShoulder));
      const oRotation = Math.abs(avgP(oLShoulder) - avgP(oRShoulder));
      if (Math.abs(pRotation - oRotation) > 5) {
        const who = pRotation > oRotation ? "Player" : "Opponent";
        parts.push(`${who} shows greater shoulder rotation asymmetry (${Math.round(Math.max(pRotation, oRotation))}° diff vs ${Math.round(Math.min(pRotation, oRotation))}°), indicating more upper-body torque in strokes.`);
      }
    }

    // Spine lean — approximate via knee angle symmetry (left vs right)
    const pLKnee = playerFrames.map((f: PoseFrame) => f.joint_angles?.left_knee || 0).filter((a) => a > 0);
    const pRKnee = playerFrames.map((f: PoseFrame) => f.joint_angles?.right_knee || 0).filter((a) => a > 0);
    const oLKnee = opponentFrames.map((f: PoseFrame) => f.joint_angles?.left_knee || 0).filter((a) => a > 0);
    const oRKnee = opponentFrames.map((f: PoseFrame) => f.joint_angles?.right_knee || 0).filter((a) => a > 0);

    if (pLKnee.length && pRKnee.length && oLKnee.length && oRKnee.length) {
      const pLean = Math.abs(avgP(pLKnee) - avgP(pRKnee));
      const oLean = Math.abs(avgP(oLKnee) - avgP(oRKnee));
      if (pLean > 10 || oLean > 10) {
        const who = pLean > oLean ? "Player" : "Opponent";
        parts.push(`${who} leans more to one side (${Math.round(Math.max(pLean, oLean))}° knee asymmetry vs ${Math.round(Math.min(pLean, oLean))}°) — this could indicate a dominant-side weight transfer pattern.`);
      }
    }

    return parts.length ? parts.join(" ") : null;
  }, [playerFrames, opponentFrames, hasOpponentData]);

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
      {/* Header Stats — inline styled */}
      <div className="space-y-3">
        <div className="flex items-baseline gap-6 flex-wrap">
          {shotMix && (
            <div>
              <span style={{ fontSize: 28, fontWeight: 700, color: '#E8E6E3', letterSpacing: '-0.02em' }}>
                {shotMix.total}
              </span>
              <span style={{ fontSize: 12, color: '#8A8885', marginLeft: 6 }}>strokes detected</span>
            </div>
          )}
          {shotMix && (
            <div>
              <span style={{ fontSize: 28, fontWeight: 700, color: '#E8E6E3', letterSpacing: '-0.02em' }}>
                {shotMix.avgForm}
              </span>
              <span style={{ fontSize: 12, color: '#8A8885', marginLeft: 6 }}>avg form</span>
              <span style={{ fontSize: 12, color: '#6A6865', marginLeft: 4 }}>/ {shotMix.bestForm} best</span>
            </div>
          )}
          {consistency && (
            <div>
              <span style={{ fontSize: 28, fontWeight: 700, color: '#E8E6E3', letterSpacing: '-0.02em' }}>
                {consistency.score}
              </span>
              <span style={{ fontSize: 12, color: '#8A8885', marginLeft: 6 }}>consistency</span>
            </div>
          )}
        </div>

        {shotMix && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 12 }}>
            <span style={{ color: '#9B7B5B', fontWeight: 600 }}>
              Forehand {shotMix.fhPct}%
              <span style={{ fontWeight: 400, color: '#6A6865', marginLeft: 4 }}>form {shotMix.fhAvgForm}</span>
            </span>
            <div style={{ flex: 1, height: 3, borderRadius: 2, background: '#363436', overflow: 'hidden', display: 'flex' }}>
              <div style={{ width: `${shotMix.fhPct}%`, background: '#9B7B5B', transition: 'width 0.5s' }} />
              <div style={{ width: `${shotMix.bhPct}%`, background: '#5B9B7B', transition: 'width 0.5s' }} />
            </div>
            <span style={{ color: '#5B9B7B', fontWeight: 600 }}>
              Backhand {shotMix.bhPct}%
              <span style={{ fontWeight: 400, color: '#6A6865', marginLeft: 4 }}>form {shotMix.bhAvgForm}</span>
            </span>
          </div>
        )}

        {/* AI Overview Insight */}
        {overviewInsight && (
          <p style={{ fontSize: 13, color: '#8A8885', lineHeight: 1.6, margin: 0 }}>
            {overviewInsight}
          </p>
        )}
      </div>

      {/* Ball Speed Over Time */}
      <div className="bg-[#282729]/40 backdrop-blur-xl rounded-xl p-4 border border-[#363436]/30">
        <h3 className="text-xs font-medium text-[#E8E6E3] mb-1">Ball Speed Timeline</h3>
        {speedInsight && (
          <p style={{ fontSize: 12, color: '#8A8885', lineHeight: 1.5, margin: '0 0 8px 0' }}>
            {speedInsight}
          </p>
        )}
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
            <h3 className="text-xs font-medium text-[#E8E6E3] mb-1">Joint Angles Over Time</h3>
            {jointInsight && (
              <p style={{ fontSize: 12, color: '#8A8885', lineHeight: 1.5, margin: '0 0 8px 0' }}>
                {jointInsight}
              </p>
            )}
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
            <h3 className="text-xs font-medium text-[#E8E6E3] mb-3">
              {hasOpponentData ? "Joint Angle Comparison" : "Average Joint Angles"}
            </h3>
            <ResponsiveContainer width="100%" height={220}>
              <RadarChart data={hasOpponentData ? radarComparisonData : avgJointAngles}>
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
                {hasOpponentData ? (
                  <>
                    <Radar
                      name="Player"
                      dataKey="player"
                      stroke="#9B7B5B"
                      fill="#9B7B5B"
                      fillOpacity={0.3}
                      strokeWidth={2}
                    />
                    <Radar
                      name="Opponent"
                      dataKey="opponent"
                      stroke="#5B9B7B"
                      fill="#5B9B7B"
                      fillOpacity={0.15}
                      strokeWidth={2}
                      strokeDasharray="4 4"
                    />
                    <Legend wrapperStyle={{ fontSize: '9px' }} iconSize={8} />
                  </>
                ) : (
                  <Radar
                    name="Angle (degrees)"
                    dataKey="angle"
                    stroke="#9B7B5B"
                    fill="#9B7B5B"
                    fillOpacity={0.3}
                    strokeWidth={2}
                  />
                )}
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
            {postureComparisonInsight && (
              <p style={{ fontSize: 12, color: '#8A8885', lineHeight: 1.5, margin: '8px 0 0 0' }}>
                {postureComparisonInsight}
              </p>
            )}
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
          <h3 className="text-xs font-medium text-[#E8E6E3] mb-1">Player Velocity</h3>
          {movementInsight && (
            <p style={{ fontSize: 12, color: '#8A8885', lineHeight: 1.5, margin: '0 0 8px 0' }}>
              {movementInsight}
            </p>
          )}
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
          <h3 className="text-xs font-medium text-[#E8E6E3] mb-3">Ball Tracking</h3>
          <div className="space-y-2">
            <div className="flex justify-between text-[10px]">
              <span className="text-[#8A8885]">Bounces</span>
              <span className="text-[#E8E6E3] font-medium">{trajectory.bounce_count}</span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-[#8A8885]">Direction Changes</span>
              <span className="text-[#E8E6E3] font-medium">{trajectory.direction_changes}</span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-[#8A8885]">Contacts Detected</span>
              <span className="text-[#E8E6E3] font-medium">{contact.contact_moments.length}</span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-[#8A8885]">Avg Contact Height</span>
              <span className="text-[#E8E6E3] font-medium">{contact.avg_contact_height.toFixed(0)}px</span>
            </div>
          </div>
        </div>

        <div className="bg-[#282729]/40 backdrop-blur-xl rounded-xl p-4 border border-[#363436]/30">
          <h3 className="text-xs font-medium text-[#E8E6E3] mb-3">Stroke Quality</h3>
          <div className="space-y-2">
            {shotMix ? (
              <>
                <div className="flex justify-between text-[10px]">
                  <span className="text-[#8A8885]">Avg Form Score</span>
                  <span className="text-[#E8E6E3] font-medium">{shotMix.avgForm}/100</span>
                </div>
                <div className="flex justify-between text-[10px]">
                  <span className="text-[#9B7B5B]">Forehand Form</span>
                  <span className="text-[#E8E6E3] font-medium">{shotMix.fhAvgForm}/100</span>
                </div>
                <div className="flex justify-between text-[10px]">
                  <span className="text-[#5B9B7B]">Backhand Form</span>
                  <span className="text-[#E8E6E3] font-medium">{shotMix.bhAvgForm}/100</span>
                </div>
                {consistency && (
                  <div className="flex justify-between text-[10px]">
                    <span className="text-[#8A8885]">Consistency</span>
                    <span className="text-[#E8E6E3] font-medium">{consistency.score}/100</span>
                  </div>
                )}
              </>
            ) : (
              <p className="text-[10px] text-[#6A6865]">Run stroke analysis to see quality metrics</p>
            )}
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
