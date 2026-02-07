"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useSession, useTrackObject, useUpdateSession } from "@/hooks/useSessions";
import { usePoseAnalysis } from "@/hooks/usePoseData";
import { useStrokeSummary, useAnalyzeStrokes, useStrokeProgress, useCancelInsights, strokeKeys } from "@/hooks/useStrokeData";
import { useAnalytics } from "@/hooks/useAnalytics";
import { useQueryClient } from "@tanstack/react-query";
import { sessionKeys } from "@/hooks/useSessions";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft, Crosshair, Loader2, ChevronRight, Play, Pause,
  SkipBack, SkipForward, Volume2, VolumeX, Activity, LayoutGrid,
  Users, BarChart3, Bug, Copy, Check, RefreshCw, Scissors, X,
} from "lucide-react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";
import { appSettingKeys, readStrokeDebugModeSetting, readStrokeClaudeClassifierEnabledSetting } from "@/lib/appSettings";
import {
  TrajectoryPoint,
  detectBalls,
  BallDetection,
  trackWithTrackNet,
  detectPoses,
  PersonPose,
  Stroke,
  getDebugFrame,
  getSessionAnalytics,
  getStrokeProgress,
  createSessionClip,
  ActivityRegion,
} from "@/lib/api";
import { motion, AnimatePresence } from "framer-motion";
import { generateTipsFromStrokes } from "@/lib/tipGenerator";
import { PlayerSelection, PlayerSelectionOverlays } from "@/components/viewer/PlayerSelection";
import { VideoTips, type VideoTip } from "@/components/viewer/VideoTips";
import { ActivityTimeline } from "@/components/viewer/ActivityTimeline";
import { useAIChat } from "@/contexts/AIChatContext";

const BirdEyeView = dynamic(
  () => import("@/components/viewer/BirdEyeView").then((m) => m.BirdEyeView),
  { ssr: false }
);

const ShotCard = dynamic(
  () => import("@/components/viewer/ShotCard").then((m) => m.ShotCard),
  { ssr: false }
);

const AnalyticsDashboard = dynamic(
  () => import("@/components/analytics/AnalyticsDashboard").then((m) => m.AnalyticsDashboard),
  { ssr: false }
);

const ClipSelector = dynamic(
  () => import("@/components/players/ClipSelector"),
  { ssr: false }
);

type TabId = "pose" | "track" | "court" | "analytics";

const tabs: { id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "pose", label: "Pose", icon: Activity },
  { id: "track", label: "Track", icon: Crosshair },
  { id: "court", label: "Court", icon: LayoutGrid },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
];

const PLAYER_COLORS = [
  { name: "Player", color: "#9B7B5B", rgb: "155, 123, 91" },
  { name: "Opponent", color: "#5B9B7B", rgb: "91, 155, 123" },
];

export default function GameViewerPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const gameId = params.id as string;

  const [isTracking, setIsTracking] = useState(false);
  const [trackingMode, setTrackingMode] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [detectedPersons, setDetectedPersons] = useState<PersonPose[]>([]);
  const [selectedPersonIds, setSelectedPersonIds] = useState<number[]>([]);
  const [isDetectingPose, setIsDetectingPose] = useState(false);
  const lastPoseFrame = useRef(-1);
  const [detectionResult, setDetectionResult] = useState<{ detections: BallDetection[]; preview_image: string; frame: number } | null>(null);
  const [showPoseOverlay, setShowPoseOverlay] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>("pose");
  const [showPlayerOverlay, setShowPlayerOverlay] = useState(false);
  const [playerSelectMode, setPlayerSelectMode] = useState(false);
  const [segmentedPlayers, setSegmentedPlayers] = useState<Array<{ id: number; name: string; color: string; rgb: string; visible: boolean; maskArea: number; clickX: number; clickY: number }>>([]);

  // AI Chat — use global sidebar
  const { isOpen: aiChatOpen, setContext: setAIChatContext, clearContext: clearAIChatContext } = useAIChat();

  const videoRef = useRef<HTMLVideoElement>(null);
  const videoViewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerCanvasRef = useRef<HTMLCanvasElement>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [videoFps, setVideoFps] = useState(30);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [panelWidth, setPanelWidth] = useState(320);
  const [videoDisplayWidth, setVideoDisplayWidth] = useState<number | null>(null);
  const [videoBounds, setVideoBounds] = useState<{ top: number; left: number; right: number; width: number; height: number } | null>(null);
  const [videoReady, setVideoReady] = useState(false);
  const isResizing = useRef(false);
  const [activeTip, setActiveTip] = useState<VideoTip | null>(null);

  const [showPlayerSelection, setShowPlayerSelection] = useState(false);
  const playerSelectionAutoOpened = useRef(false);
  const hasAutoSeeked = useRef(false);

  // Clip selector state
  const [showClipSelector, setShowClipSelector] = useState(false);
  const [clipLoading, setClipLoading] = useState(false);

  // Debug mode state
  const [debugMode, setDebugMode] = useState(false);
  const [strokeClaudeClassifierEnabled, setStrokeClaudeClassifierEnabled] = useState(true);
  const [debugLog, setDebugLog] = useState<Array<{ label: string; [key: string]: unknown }>>([]);
  const [debugLoading, setDebugLoading] = useState(false);
  const [debugFlash, setDebugFlash] = useState<string | null>(null);
  const [debugCopied, setDebugCopied] = useState(false);
  const [isRecomputingAnalytics, setIsRecomputingAnalytics] = useState(false);

  useEffect(() => {
    setDebugMode(readStrokeDebugModeSetting());
    setStrokeClaudeClassifierEnabled(readStrokeClaudeClassifierEnabledSetting());
    const syncDebugSetting = (event: StorageEvent) => {
      if (event.key && event.key !== appSettingKeys.strokeDebugMode) return;
      setDebugMode(readStrokeDebugModeSetting());
    };
    const syncClaudeSetting = (event: StorageEvent) => {
      if (event.key && event.key !== appSettingKeys.strokeClaudeClassifier) return;
      setStrokeClaudeClassifierEnabled(readStrokeClaudeClassifierEnabledSetting());
    };
    window.addEventListener("storage", syncDebugSetting);
    window.addEventListener("storage", syncClaudeSetting);
    return () => {
      window.removeEventListener("storage", syncDebugSetting);
      window.removeEventListener("storage", syncClaudeSetting);
    };
  }, []);

  const { data: session, isLoading } = useSession(gameId);
  const { data: poseData } = usePoseAnalysis(gameId);
  const { data: analytics } = useAnalytics(gameId);
  const trackMutation = useTrackObject(gameId);
  const strokeMutation = useAnalyzeStrokes(gameId);
  const cancelInsightsMutation = useCancelInsights(gameId);
  const updateSessionMutation = useUpdateSession(gameId);

  const sessionInsightGenerating = session?.insight_generation_status === "generating";
  const isStrokeRecomputeProcessing =
    isRecomputingAnalytics ||
    strokeMutation.isPending ||
    session?.stroke_analysis_status === "processing";
  const shouldPollStrokeProgress = isStrokeRecomputeProcessing || sessionInsightGenerating;
  const { data: liveStrokeProgress } = useStrokeProgress(gameId, shouldPollStrokeProgress);
  const strokePipelineDebugStats = useMemo(() => {
    if (liveStrokeProgress?.debug_stats && typeof liveStrokeProgress.debug_stats === "object") {
      return liveStrokeProgress.debug_stats as Record<string, unknown>;
    }
    return null;
  }, [liveStrokeProgress]);
  const insightStageStatus = useMemo(() => {
    const stageStatuses = (
      strokePipelineDebugStats?.stage_statuses &&
      typeof strokePipelineDebugStats.stage_statuses === "object"
    )
      ? (strokePipelineDebugStats.stage_statuses as Record<string, unknown>)
      : null;
    const raw = stageStatuses?.generate_insights;
    return raw === "pending" || raw === "running" || raw === "completed" || raw === "failed" ? raw : null;
  }, [strokePipelineDebugStats]);
  const isInsightGenerating =
    insightStageStatus === "running" ||
    (sessionInsightGenerating && insightStageStatus !== "completed" && insightStageStatus !== "failed");
  const { data: strokeSummary } = useStrokeSummary(gameId, isInsightGenerating);

  const hasPose = !!session?.pose_video_path;
  const hasStrokes = !!strokeSummary?.total_strokes;
  const hasTrajectory = !!(session?.trajectory_data?.frames?.length);
  const strokePipelineStageRows = useMemo(() => {
    const defaultStageOrder = [
      "load_session_metadata",
      "load_pose_data",
      "detect_pose_strokes",
      "detect_trajectory_reversals",
      "detect_contacts",
      "merge_detection_events",
      strokeClaudeClassifierEnabled ? "classify_events_claude" : "classify_events_elbow",
      "infer_hitter",
      "build_final_strokes",
      "persist_results",
      "generate_insights",
    ];
    const defaultLabels: Record<string, string> = {
      load_session_metadata: "Load session metadata",
      load_pose_data: "Load pose frames",
      detect_pose_strokes: "Detect pose stroke proposals",
      detect_trajectory_reversals: "Detect trajectory reversals",
      detect_contacts: "Detect wrist-ball contacts",
      merge_detection_events: "Merge detection events",
      classify_events_claude: "Classify events (Claude)",
      classify_events_elbow: "Classify events (Elbow trend)",
      infer_hitter: "Infer hitter (player/opponent)",
      build_final_strokes: "Build final strokes",
      persist_results: "Persist stroke analytics",
      generate_insights: "Generate AI insights",
    };

    const stageOrder = Array.isArray(strokePipelineDebugStats?.stage_order)
      ? strokePipelineDebugStats.stage_order.filter((id): id is string => typeof id === "string" && id.length > 0)
      : defaultStageOrder;
    const stageLabelsFromStats = (
      strokePipelineDebugStats?.stage_labels &&
      typeof strokePipelineDebugStats.stage_labels === "object"
    )
      ? (strokePipelineDebugStats.stage_labels as Record<string, unknown>)
      : {};
    const stageStatusFromStats = (
      strokePipelineDebugStats?.stage_statuses &&
      typeof strokePipelineDebugStats.stage_statuses === "object"
    )
      ? (strokePipelineDebugStats.stage_statuses as Record<string, unknown>)
      : {};
    const stageTimingsFromStats = (
      strokePipelineDebugStats?.stage_timings_ms &&
      typeof strokePipelineDebugStats.stage_timings_ms === "object"
    )
      ? (strokePipelineDebugStats.stage_timings_ms as Record<string, unknown>)
      : {};
    const currentStage = typeof strokePipelineDebugStats?.current_stage === "string"
      ? strokePipelineDebugStats.current_stage
      : null;

    const seen = new Set<string>();
    return stageOrder
      .filter((stageId) => {
        if (seen.has(stageId)) return false;
        seen.add(stageId);
        return true;
      })
      .map((stageId) => {
        const labelRaw = stageLabelsFromStats[stageId];
        const label = typeof labelRaw === "string" && labelRaw.trim().length > 0
          ? labelRaw
          : (defaultLabels[stageId] ?? stageId.replace(/_/g, " "));
        const statusRaw = stageStatusFromStats[stageId];
        let status: "pending" | "running" | "completed" | "failed" = "pending";
        if (statusRaw === "running" || statusRaw === "completed" || statusRaw === "failed") {
          status = statusRaw;
        } else if (statusRaw === "pending") {
          status = "pending";
        } else if (currentStage === stageId) {
          status = "running";
        }
        const durationRaw = stageTimingsFromStats[stageId];
        const durationMs = (typeof durationRaw === "number" && Number.isFinite(durationRaw)) ? durationRaw : null;
        if (durationMs !== null && status === "pending") {
          status = "completed";
        }
        return { id: stageId, label, status, durationMs };
      });
  }, [strokePipelineDebugStats, strokeClaudeClassifierEnabled]);
  const strokePipelineElapsedMs = useMemo(() => {
    const raw = strokePipelineDebugStats?.pipeline_elapsed_ms;
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    return strokePipelineStageRows.reduce((sum, stage) => sum + (stage.durationMs ?? 0), 0);
  }, [strokePipelineDebugStats, strokePipelineStageRows]);

  // Insight generation progress from pipeline debug stats
  const insightsProgress = useMemo(() => {
    const prog = strokePipelineDebugStats?.insights_progress as { current?: number; total?: number; completed?: number } | undefined;
    if (!prog) return null;
    return {
      current: typeof prog.current === "number" ? prog.current : 0,
      total: typeof prog.total === "number" ? prog.total : 0,
      completed: typeof prog.completed === "number" ? prog.completed : 0,
    };
  }, [strokePipelineDebugStats]);

  // Strokes that have AI insights (for progressive rendering)
  const aiInsightStrokes = useMemo(() => {
    if (!strokeSummary?.strokes) return [];
    return strokeSummary.strokes.filter((s) => s.ai_insight);
  }, [strokeSummary?.strokes]);

  // Whether any AI insights exist (to decide if we show AI vs rule-based tips)
  const hasAiInsights = aiInsightStrokes.length > 0;

  // Pose processing: no pose_video_path yet AND status is processing
  const isPoseProcessing = session?.status === "processing" && !hasPose;
  // General processing for ball tracking / pending
  const isProcessing = session?.status === "processing" || session?.status === "pending";
  // Need pose: has video, no pose video yet, and not currently processing pose
  const needsPose = !!session?.video_path && !hasPose && !isPoseProcessing;

  // Auto-open player selection when session has video but no pose video yet
  useEffect(() => {
    if (session && !playerSelectionAutoOpened.current && needsPose) {
      playerSelectionAutoOpened.current = true;
      setShowPlayerSelection(true);
    }
  }, [session, needsPose]);

  // Auto-close player selection modal when pose_video_path appears (e.g. from poll or stale cache refresh)
  useEffect(() => {
    if (hasPose && showPlayerSelection) {
      setShowPlayerSelection(false);
    }
  }, [hasPose, showPlayerSelection]);

  // Auto-poll while session is still processing or waiting for pose video
  useEffect(() => {
    if (!isProcessing && !isPoseProcessing) return;
    const interval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: sessionKeys.detail(gameId) });
    }, 3000);
    return () => clearInterval(interval);
  }, [isProcessing, isPoseProcessing, queryClient, gameId]);

  const videoUrl = useMemo(() => {
    if (showPoseOverlay && session?.pose_video_path) return session.pose_video_path;
    return session?.video_path;
  }, [showPoseOverlay, session?.pose_video_path, session?.video_path]);

  const startTimeParam = useMemo(() => {
    const raw = searchParams.get("t");
    if (!raw) return null;
    const parsed = Number.parseFloat(raw);
    if (Number.isNaN(parsed) || parsed < 0) return null;
    return parsed;
  }, [searchParams]);

  const tipParam = useMemo(() => {
    const raw = searchParams.get("tip");
    if (!raw) return null;
    return raw.toLowerCase();
  }, [searchParams]);

  const trajectoryFrameMap = useMemo(() => {
    if (!session?.trajectory_data?.frames) return new Map<number, TrajectoryPoint>();
    return new Map(session.trajectory_data.frames.map((f: TrajectoryPoint) => [f.frame, f]));
  }, [session?.trajectory_data]);

  const visibleTrajectoryPoints = useMemo(() => {
    if (!session?.trajectory_data?.frames) return [];
    return session.trajectory_data.frames.filter((f: TrajectoryPoint) => f.frame <= currentFrame);
  }, [session?.trajectory_data, currentFrame]);

  // Find the active stroke at current video frame
  const activeStroke = useMemo((): Stroke | null => {
    if (!strokeSummary?.strokes?.length) return null;
    return strokeSummary.strokes.find(
      (s) => currentFrame >= s.start_frame && currentFrame <= s.end_frame
    ) ?? null;
  }, [strokeSummary?.strokes, currentFrame]);

  // Find the most recent stroke (for display when between strokes)
  const lastStroke = useMemo((): Stroke | null => {
    if (!strokeSummary?.strokes?.length) return null;
    const past = strokeSummary.strokes.filter((s) => s.peak_frame <= currentFrame);
    return past.length > 0 ? past[past.length - 1] : null;
  }, [strokeSummary?.strokes, currentFrame]);



  const computedTrajectoryFps = useMemo(() => {
    const frames = session?.trajectory_data?.frames?.length ?? 0;
    if (!frames || !duration) return null;
    const derived = frames / duration;
    if (!Number.isFinite(derived) || derived <= 0) return null;
    return derived;
  }, [session?.trajectory_data?.frames?.length, duration]);

  // Use FPS from trajectory video_info if available, otherwise derive from data/duration
  const fps = useMemo(() => {
    try {
      const td = session?.trajectory_data as unknown as { video_info?: { fps?: number } } | undefined;
      const metaFps = td?.video_info?.fps;
      if (metaFps && Number.isFinite(metaFps) && metaFps > 0) return metaFps;
      if (computedTrajectoryFps) return computedTrajectoryFps;
      return videoFps;
    } catch { return videoFps; }
  }, [session?.trajectory_data, videoFps, computedTrajectoryFps]);

  const frameFromTime = useCallback(
    (time: number) => Math.max(0, Math.round(time * fps)),
    [fps]
  );

  // Video dimensions for denormalizing stored pose keypoints
  const videoW = session?.trajectory_data?.video_info?.width ?? 1280;
  const videoH = session?.trajectory_data?.video_info?.height ?? 828;

  // Derive fps from pose data — stroke frame numbers live in this frame space,
  // which may differ from trajectory fps if the pose video was re-encoded.
  const poseBasedFps = useMemo(() => {
    if (!poseData?.frames?.length) return null;
    for (const f of poseData.frames) {
      if (f.timestamp > 1.0 && f.frame_number > 10) {
        const derived = f.frame_number / f.timestamp;
        if (Number.isFinite(derived) && derived > 0) return derived;
      }
    }
    return null;
  }, [poseData?.frames]);

  // Generate video tips from stroke data
  const videoTips = useMemo(() => {
    const firstPlayer = session?.players?.[0];
    const tipFps = poseBasedFps ?? fps;
    const tips = generateTipsFromStrokes(strokeSummary?.strokes || [], tipFps, firstPlayer?.name);

    // Fix timestamps by looking up actual pose-data timestamps (bypasses fps math)
    if (poseData?.frames?.length && strokeSummary?.strokes?.length) {
      const playerFrames = poseData.frames.filter((f) => (f.person_id ?? 0) === 0);
      for (const tip of tips) {
        const stroke = strokeSummary.strokes.find((s) => tip.strokeId === s.id);
        if (!stroke) continue;
        // Find closest pose frame to peak_frame / start_frame and use its timestamp
        let peakDist = Infinity;
        let peakTs: number | null = null;
        let startDist = Infinity;
        let startTs: number | null = null;
        for (const f of playerFrames) {
          const pd = Math.abs(f.frame_number - stroke.peak_frame);
          if (pd < peakDist) { peakDist = pd; peakTs = f.timestamp; }
          const sd = Math.abs(f.frame_number - stroke.start_frame);
          if (sd < startDist) { startDist = sd; startTs = f.timestamp; }
        }
        if (peakTs !== null && peakDist < 5) tip.timestamp = peakTs;
        if (startTs !== null && startDist < 5) tip.seekTime = startTs;
      }
    }

    // Drop tips that start in the last 20% of the video (dead time after action ends)
    const cutoff = duration > 0 ? duration * 0.8 : Infinity;
    const filtered = tips.filter((t) => t.timestamp <= cutoff);

    console.log('[VideoTips] Generated tips:', {
      strokeCount: strokeSummary?.strokes?.length || 0,
      tipCount: filtered.length,
      dropped: tips.length - filtered.length,
      tipFps,
      poseBasedFps,
      videoDuration: duration,
      tips: filtered.map(t => ({ id: t.id, ts: t.timestamp.toFixed(2), title: t.title }))
    });
    return filtered;
  }, [strokeSummary?.strokes, fps, poseBasedFps, selectedPersonIds, poseData?.frames, videoW, videoH, session?.trajectory_data, duration]);


  const tipSeekTime = useMemo(() => {
    if (!tipParam || videoTips.length === 0) return null;
    const match = videoTips.find((tip) =>
      tip.id.toLowerCase() === tipParam || tip.title.toLowerCase().includes(tipParam)
    );
    return match?.seekTime ?? match?.timestamp ?? null;
  }, [tipParam, videoTips]);

  const strokeMarkers = useMemo(() => {
    if (isStrokeRecomputeProcessing) return [];
    if (!strokeSummary?.strokes?.length) return [];
    return strokeSummary.strokes.map((stroke) => ({
      id: stroke.id,
      time: stroke.peak_frame / fps,
      type: stroke.stroke_type,
      formScore: stroke.form_score,
      frame: stroke.peak_frame,
    }));
  }, [strokeSummary?.strokes, fps, isStrokeRecomputeProcessing]);

  // Reversal markers sourced from backend stroke events.
  // This keeps UI aligned with the stroke pipeline instead of a separate client-only heuristic.
  const trajectoryReversalMarkers = useMemo(() => {
    if (isStrokeRecomputeProcessing) return [];
    if (!strokeSummary?.strokes?.length) return [];
    const out: Array<{ frame: number; time: number }> = [];
    const seen = new Set<number>();

    for (const stroke of strokeSummary.strokes) {
      if (stroke.stroke_type !== "forehand" && stroke.stroke_type !== "backhand") continue;
      const sourcesRaw = stroke.metrics?.event_sources;
      const sources = Array.isArray(sourcesRaw)
        ? sourcesRaw
        : typeof sourcesRaw === "string"
          ? [sourcesRaw]
          : [];
      if (!sources.includes("trajectory")) continue;

      const frame = stroke.peak_frame;
      if (!Number.isFinite(frame) || seen.has(frame)) continue;
      seen.add(frame);
      out.push({ frame, time: frame / fps });
    }

    out.sort((a, b) => a.frame - b.frame);
    return out;
  }, [strokeSummary?.strokes, fps, isStrokeRecomputeProcessing]);

  const autoSeekTime = startTimeParam ?? tipSeekTime;
  const shouldAutoPlay = startTimeParam !== null && startTimeParam !== undefined;

  const playVideoSafely = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      await video.play();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      console.error("Video play failed:", error);
    }
  }, []);

  useEffect(() => {
    hasAutoSeeked.current = false;
  }, [videoUrl, autoSeekTime]);

  useEffect(() => {
    if (autoSeekTime === null || autoSeekTime === undefined || !videoRef.current) return;
    if (hasAutoSeeked.current) return;

    const video = videoRef.current;
    const seekAndPlay = () => {
      if (hasAutoSeeked.current) return;
      const durationSafe = Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.05) : autoSeekTime;
      const safeTime = Math.min(Math.max(0, autoSeekTime), durationSafe);
      video.currentTime = safeTime;
      hasAutoSeeked.current = true;
      if (shouldAutoPlay) {
        void playVideoSafely();
      } else {
        video.pause();
        setIsPlaying(false);
      }
    };

    if (video.readyState >= 1) {
      seekAndPlay();
      return;
    }

    video.addEventListener("loadedmetadata", seekAndPlay, { once: true });
    return () => video.removeEventListener("loadedmetadata", seekAndPlay);
  }, [autoSeekTime, videoUrl, shouldAutoPlay, playVideoSafely]);

  // Handle tip state changes - pause video when tip appears, user resumes manually
  const handleTipChange = useCallback((tip: VideoTip | null) => {
    setActiveTip(tip);
    // Don't pause video - let insights appear as overlays while video plays
  }, []);

  const showTrack = activeTab === "track";
  const showCourt = activeTab === "court";
  const showAnalytics = activeTab === "analytics";
  const showSidePanel =
    showTrack || showCourt || activeTab === "pose" || showAnalytics;

  const updateVideoDisplayWidth = useCallback(() => {
    const viewport = videoViewportRef.current;
    const video = videoRef.current;
    if (!viewport) return;

    const containerWidth = viewport.clientWidth;
    const containerHeight = viewport.clientHeight;
    let nextWidth = containerWidth;
    let nextHeight = containerHeight;

    if (video?.videoWidth && video?.videoHeight && containerHeight > 0) {
      const videoAspect = video.videoWidth / video.videoHeight;
      const containerAspect = containerWidth / containerHeight;
      if (containerAspect > videoAspect) {
        nextWidth = containerHeight * videoAspect;
        nextHeight = containerHeight;
      } else {
        nextWidth = containerWidth;
        nextHeight = containerWidth / videoAspect;
      }
    }

    const rounded = Math.max(0, Math.round(nextWidth));
    setVideoDisplayWidth((prev) => (prev === rounded ? prev : rounded));

    // Calculate video element bounds for overlay positioning
    const viewportRect = viewport.getBoundingClientRect();
    const videoLeft = viewportRect.left + (containerWidth - nextWidth) / 2;
    const videoTop = viewportRect.top + (containerHeight - nextHeight) / 2;

    setVideoBounds({
      top: videoTop,
      left: videoLeft,
      right: videoLeft + nextWidth,
      width: nextWidth,
      height: nextHeight,
    });
  }, []);

  useEffect(() => {
    updateVideoDisplayWidth();

    const video = videoRef.current;
    const viewport = videoViewportRef.current;
    const handleResize = () => updateVideoDisplayWidth();

    video?.addEventListener("loadedmetadata", handleResize);
    window.addEventListener("resize", handleResize);

    let observer: ResizeObserver | null = null;
    if (viewport && typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(handleResize);
      observer.observe(viewport);
    }

    return () => {
      video?.removeEventListener("loadedmetadata", handleResize);
      window.removeEventListener("resize", handleResize);
      observer?.disconnect();
    };
  }, [updateVideoDisplayWidth, videoUrl, showSidePanel, panelWidth]);

  // Debug mode: annotate current frame
  const debugAnnotate = useCallback(async (label: "forehand" | "backhand" | "false_positive" | "missed") => {
    if (!gameId || debugLoading) return;
    // Pause video
    if (videoRef.current && !videoRef.current.paused) {
      videoRef.current.pause();
      setIsPlaying(false);
    }
    setDebugLoading(true);
    setDebugFlash(label);
    try {
      const res = await getDebugFrame(gameId, currentFrame);
      const entry = { label, ...res.data };
      setDebugLog(prev => [...prev, entry]);
    } catch (err) {
      console.error("Debug frame fetch failed:", err);
      setDebugLog(prev => [...prev, { label, frame: currentFrame, error: "fetch_failed" }]);
    }
    setDebugLoading(false);
    setTimeout(() => setDebugFlash(null), 800);
  }, [gameId, currentFrame, debugLoading]);

  const copyDebugLog = useCallback(() => {
    navigator.clipboard.writeText(JSON.stringify(debugLog, null, 2));
    setDebugCopied(true);
    setTimeout(() => setDebugCopied(false), 2000);
  }, [debugLog]);

  const handleRecomputeAnalytics = useCallback(async () => {
    if (!gameId || isRecomputingAnalytics) return;
    setIsRecomputingAnalytics(true);
    try {
      // Reflect processing state immediately in UI.
      queryClient.setQueryData(
        sessionKeys.detail(gameId),
        (prev: unknown) =>
          prev && typeof prev === "object"
            ? {
                ...(prev as Record<string, unknown>),
                stroke_analysis_status: "processing",
                insight_generation_status: null,
              }
            : prev
      );

      // 1) Trigger stroke analysis
      await strokeMutation.mutateAsync();

      // 2) Wait until backend stroke job completes/fails
      const timeoutMs = 5 * 60 * 1000;
      const pollMs = 1000;
      const startedAt = Date.now();
      let finalStatus: string | undefined;
      while (true) {
        const progressResponse = await getStrokeProgress(gameId);
        const progress = progressResponse.data?.progress;
        const status = progress?.status;
        const stageStatuses = (
          progress?.debug_stats?.stage_statuses &&
          typeof progress.debug_stats.stage_statuses === "object"
        )
          ? (progress.debug_stats.stage_statuses as Record<string, unknown>)
          : null;
        const persistDone = stageStatuses?.persist_results === "completed";

        if (status === "failed") {
          finalStatus = "failed";
          break;
        }
        if (status === "completed" || persistDone) {
          finalStatus = "completed";
          break;
        }
        if (Date.now() - startedAt > timeoutMs) break;
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }

      if (finalStatus) {
        queryClient.setQueryData(
          sessionKeys.detail(gameId),
          (prev: unknown) =>
            prev && typeof prev === "object"
              ? { ...(prev as Record<string, unknown>), stroke_analysis_status: finalStatus }
              : prev
        );
      }

      // 3) Main stroke outputs are ready at persist_results; refresh UI immediately.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: strokeKeys.progress(gameId) }),
        queryClient.invalidateQueries({ queryKey: strokeKeys.summary(gameId) }),
        queryClient.invalidateQueries({ queryKey: sessionKeys.detail(gameId) }),
      ]);
      setIsRecomputingAnalytics(false);

      // 4) Analytics refresh can continue in background while AI insights generate.
      const analyticsResponse = await getSessionAnalytics(gameId, { force: true });
      queryClient.setQueryData(["analytics", gameId], analyticsResponse.data);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["analytics", gameId] }),
      ]);

      if (finalStatus === "failed") {
        console.error("Stroke recompute finished with status=failed");
      }
    } catch (err) {
      console.error("Analytics recompute failed:", err);
    } finally {
      setIsRecomputingAnalytics(false);
    }
  }, [gameId, isRecomputingAnalytics, queryClient, strokeMutation]);

  // Keyboard shortcuts for debug mode
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore if typing in an input/textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (!debugMode) return;

      if (e.key === "h" || e.key === "H") {
        e.preventDefault();
        debugAnnotate("forehand");
      } else if (e.key === "b" || e.key === "B") {
        e.preventDefault();
        debugAnnotate("backhand");
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        debugAnnotate("false_positive");
      } else if (e.key === "m" || e.key === "M") {
        e.preventDefault();
        debugAnnotate("missed");
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [debugMode, debugAnnotate]);

  // Reset videoReady when the video source changes (e.g. clip loaded, pose overlay toggled)
  useEffect(() => {
    setVideoReady(false);
  }, [videoUrl]);

  // Video events — use requestVideoFrameCallback when available for tighter sync
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let rafId: number;
    let vfcId: number | null = null;

    const frameLoop = (_now?: number, metadata?: VideoFrameCallbackMetadata) => {
      if (!video || video.paused) return;
      const mediaTime = metadata?.mediaTime ?? video.currentTime;
      setCurrentTime(mediaTime);
      setCurrentFrame(frameFromTime(mediaTime));
      if ("requestVideoFrameCallback" in video) {
        vfcId = (video as HTMLVideoElement & { requestVideoFrameCallback: (cb: any) => number })
          .requestVideoFrameCallback(frameLoop);
      } else {
        rafId = requestAnimationFrame(() => frameLoop());
      }
    };

    const onPlay = () => {
      setIsPlaying(true);
      if ("requestVideoFrameCallback" in video) {
        vfcId = (video as HTMLVideoElement & { requestVideoFrameCallback: (cb: any) => number })
          .requestVideoFrameCallback(frameLoop);
      } else {
        rafId = requestAnimationFrame(() => frameLoop());
      }
    };
    const onPause = () => {
      setIsPlaying(false);
      cancelAnimationFrame(rafId);
      if (vfcId !== null && "cancelVideoFrameCallback" in video) {
        (video as HTMLVideoElement & { cancelVideoFrameCallback: (id: number) => void }).cancelVideoFrameCallback(vfcId);
        vfcId = null;
      }
      // Update one final time on pause for accurate stopped position
      setCurrentTime(video.currentTime);
      setCurrentFrame(frameFromTime(video.currentTime));
    };
    const onSeeked = () => {
      setCurrentTime(video.currentTime);
      setCurrentFrame(frameFromTime(video.currentTime));
    };
    const onMeta = () => { setDuration(video.duration); };
    const onCanPlay = () => { setVideoReady(true); };

    // If video is already loaded (e.g. cached), mark ready immediately
    if (video.readyState >= 3) setVideoReady(true);

    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("loadedmetadata", onMeta);
    video.addEventListener("canplay", onCanPlay);
    // Also handle timeupdate as fallback for initial load / slow seek
    video.addEventListener("timeupdate", onSeeked);
    return () => {
      cancelAnimationFrame(rafId);
      if (vfcId !== null && "cancelVideoFrameCallback" in video) {
        (video as HTMLVideoElement & { cancelVideoFrameCallback: (id: number) => void }).cancelVideoFrameCallback(vfcId);
      }
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("canplay", onCanPlay);
      video.removeEventListener("timeupdate", onSeeked);
    };
  }, [videoUrl, frameFromTime]);

  // Jump threshold: points further than 12% of video diagonal are tracking noise
  const jumpThreshold = useMemo(() => {
    const vw = videoRef.current?.videoWidth || 1920;
    const vh = videoRef.current?.videoHeight || 1080;
    return Math.sqrt(vw * vw + vh * vh) * 0.12;
  }, [session?.trajectory_data]);

  // Draw ball tracking overlay (mask/bbox)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx || !videoRef.current) return;
    const vw = videoRef.current.videoWidth || 1920;
    const vh = videoRef.current.videoHeight || 1080;
    if (canvas.width !== vw || canvas.height !== vh) { canvas.width = vw; canvas.height = vh; }
    ctx.clearRect(0, 0, vw, vh);
    if (!hasTrajectory || visibleTrajectoryPoints.length === 0) return;

    // Trail: fading green line connecting recent positions, breaking on jumps
    if (visibleTrajectoryPoints.length >= 2) {
      const recent = visibleTrajectoryPoints.slice(-40);
      for (let i = 1; i < recent.length; i++) {
        const dx = recent[i].x - recent[i-1].x;
        const dy = recent[i].y - recent[i-1].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        // Skip drawing segment if it's a tracking jump (noise)
        if (dist > jumpThreshold) continue;
        const alpha = (i / recent.length) * 0.4;
        ctx.beginPath();
        ctx.strokeStyle = `rgba(34, 197, 94, ${alpha})`;
        ctx.lineWidth = 2;
        ctx.moveTo(recent[i-1].x, recent[i-1].y);
        ctx.lineTo(recent[i].x, recent[i].y);
        ctx.stroke();
      }
    }

    // Lookup current frame's trajectory point — find closest match if no exact hit
    let cp = trajectoryFrameMap.get(currentFrame);
    if (!cp && trajectoryFrameMap.size > 0) {
      let minDiff = Infinity;
      for (const [frame, point] of trajectoryFrameMap) {
        const diff = Math.abs(frame - currentFrame);
        if (diff < minDiff && diff <= 3) {
          minDiff = diff;
          cp = point;
        }
      }
    }

    // Validate the current point isn't a wild jump from recent trajectory
    if (cp && visibleTrajectoryPoints.length >= 2) {
      const prev = visibleTrajectoryPoints[visibleTrajectoryPoints.length - 1];
      // If current point is the prev point itself, it's fine
      if (prev.frame !== cp.frame) {
        const dx = cp.x - prev.x;
        const dy = cp.y - prev.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > jumpThreshold) {
          cp = undefined; // Suppress the jump — don't render this detection
        }
      }
    }

    if (cp) {
      const bbox = (cp as TrajectoryPoint & { bbox?: number[] }).bbox;

      if (bbox && bbox.length === 4) {
        const [x1, y1, x2, y2] = bbox;
        const bw = x2 - x1;
        const bh = y2 - y1;

        // Green semi-transparent fill over segmented area
        ctx.fillStyle = "rgba(34, 197, 94, 0.35)";
        ctx.fillRect(x1, y1, bw, bh);

        // Green border
        ctx.strokeStyle = "rgba(34, 197, 94, 0.8)";
        ctx.lineWidth = 2;
        ctx.strokeRect(x1, y1, bw, bh);

        // Center crosshair
        ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cp.x - 6, cp.y); ctx.lineTo(cp.x + 6, cp.y);
        ctx.moveTo(cp.x, cp.y - 6); ctx.lineTo(cp.x, cp.y + 6);
        ctx.stroke();
      } else {
        // Fallback: small green dot if no bbox
        ctx.beginPath();
        ctx.arc(cp.x, cp.y, 8, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(34, 197, 94, 0.5)";
        ctx.fill();
        ctx.strokeStyle = "rgba(34, 197, 94, 0.8)";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }, [visibleTrajectoryPoints, trajectoryFrameMap, currentFrame, hasTrajectory, jumpThreshold]);

  // Draw player markers on video
  useEffect(() => {
    const canvas = playerCanvasRef.current;
    if (!canvas || !showPlayerOverlay || !videoRef.current) {
      if (canvas) { const ctx = canvas.getContext("2d"); ctx?.clearRect(0, 0, canvas.width, canvas.height); }
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const vw = videoRef.current.videoWidth || 1920;
    const vh = videoRef.current.videoHeight || 1080;
    if (canvas.width !== vw || canvas.height !== vh) { canvas.width = vw; canvas.height = vh; }
    ctx.clearRect(0, 0, vw, vh);

    segmentedPlayers.forEach((player) => {
      if (!player.visible) return;
      ctx.save();
      // Draw marker at the player's clicked position
      const cx = player.clickX;
      const cy = player.clickY;

      // Small outer ring
      ctx.globalAlpha = 0.2;
      ctx.strokeStyle = player.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, 18, 0, Math.PI * 2);
      ctx.stroke();

      // Inner dot
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = player.color;
      ctx.beginPath();
      ctx.arc(cx, cy, 5, 0, Math.PI * 2);
      ctx.fill();

      // Label
      ctx.globalAlpha = 1;
      ctx.fillStyle = player.color;
      ctx.font = "bold 10px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(player.name, cx, cy - 22);

      ctx.restore();
    });
  }, [showPlayerOverlay, segmentedPlayers, currentFrame]);

  // Set AI chat context when session loads
  useEffect(() => {
    if (!session) return;
    const firstPlayer = session.players?.[0];
    setAIChatContext({
      sessionId: gameId,
      sessionName: session.name,
      playerId: firstPlayer?.id,
      playerName: firstPlayer?.name,
      strokeSummary: strokeSummary
        ? {
            total_strokes: strokeSummary.total_strokes ?? 0,
            forehand_count: strokeSummary.forehand_count ?? 0,
            backhand_count: strokeSummary.backhand_count ?? 0,
            average_form_score: strokeSummary.average_form_score ?? 0,
            best_form_score: strokeSummary.best_form_score ?? 0,
            consistency_score: strokeSummary.consistency_score ?? 0,
          }
        : undefined,
    });
    return () => clearAIChatContext();
  }, [session, strokeSummary, gameId, setAIChatContext, clearAIChatContext]);

  const handleFrameClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!videoRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const video = videoRef.current;
    const x = (e.clientX - rect.left) * (video.videoWidth / rect.width);
    const y = (e.clientY - rect.top) * (video.videoHeight / rect.height);

    // Player selection mode — add a player at click position
    if (playerSelectMode) {
      const nextId = segmentedPlayers.length + 1;
      const colorDef = PLAYER_COLORS[(nextId - 1) % PLAYER_COLORS.length];
      setSegmentedPlayers((prev) => [...prev, {
        id: nextId,
        name: colorDef.name,
        color: colorDef.color,
        rgb: colorDef.rgb,
        visible: true,
        maskArea: 0,
        clickX: x,
        clickY: y,
      }]);
      setPlayerSelectMode(false);
      setShowPlayerOverlay(true);
      return;
    }

    // Manual fallback click tracking (if user is in trackingMode after YOLO found nothing)
    if (trackingMode) {
      setIsTracking(true);
      setTrackingMode(false);
      trackMutation.mutate({ x, y, frame: currentFrame }, {
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: sessionKeys.detail(gameId) }); },
        onError: (err) => { console.error("Tracking failed:", err); alert("Tracking failed."); },
        onSettled: () => setIsTracking(false),
      });
    }
  }, [trackingMode, playerSelectMode, trackMutation, currentFrame, queryClient, gameId, segmentedPlayers.length]);

  // Primary: full-video tracking (no click needed)
  const hasStoredPose = !!(poseData?.frames?.length);

  // How many players did the user actually select? (1 = player only, 2 = player + opponent)
  const selectedPlayerCount = session?.players?.length ?? 1;

  // Convert stored pose data to PersonPose[] for the current frame
  // Only include persons the user selected (person_id 0 = player, 1 = opponent)
  const storedPersonsForFrame = useMemo((): PersonPose[] => {
    if (!hasStoredPose || !poseData?.frames) return [];
    // Find closest frames to currentFrame
    let bestDist = Infinity;
    let bestFrame = currentFrame;
    for (const f of poseData.frames) {
      const d = Math.abs(f.frame_number - currentFrame);
      if (d < bestDist) { bestDist = d; bestFrame = f.frame_number; }
    }
    if (bestDist > 5) return []; // too far from any stored frame

    // Group rows for this frame by person_id
    const frameRows = poseData.frames.filter((f) => f.frame_number === bestFrame);
    const personMap = new Map<number, typeof frameRows>();
    for (const row of frameRows) {
      const pid = row.person_id ?? 1;
      // Only include persons the user selected
      if (pid >= selectedPlayerCount) continue;
      if (!personMap.has(pid)) personMap.set(pid, []);
      personMap.get(pid)!.push(row);
    }

    const persons: PersonPose[] = [];
    for (const [pid, rows] of personMap) {
      const row = rows[0]; // take first row for this person
      const kps = row.keypoints;
      const keypointsList: { name: string; x: number; y: number; conf: number }[] = [];
      let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0;
      for (const [name, kp] of Object.entries(kps)) {
        const px = kp.x * videoW;
        const py = kp.y * videoH;
        keypointsList.push({ name, x: px, y: py, conf: kp.visibility ?? 0.5 });
        if (kp.visibility > 0.3) {
          minX = Math.min(minX, px); minY = Math.min(minY, py);
          maxX = Math.max(maxX, px); maxY = Math.max(maxY, py);
        }
      }
      // Compute bbox from keypoint extremes with padding
      const pad = 20;
      const bbox: [number, number, number, number] = [
        Math.max(0, minX - pad), Math.max(0, minY - pad),
        Math.min(videoW, maxX + pad), Math.min(videoH, maxY + pad),
      ];
      persons.push({ id: pid, bbox, confidence: 0.9, keypoints: keypointsList });
    }
    return persons;
  }, [hasStoredPose, poseData, currentFrame, videoW, videoH, selectedPlayerCount]);

  // Use stored data when available, otherwise fall back to live detection
  useEffect(() => {
    if (showPoseOverlay && storedPersonsForFrame.length > 0) {
      setDetectedPersons(storedPersonsForFrame);
      if (selectedPersonIds.length === 0 && storedPersonsForFrame.length > 0) {
        // Only auto-select as many players as the user originally chose
        const toSelect = storedPersonsForFrame
          .slice(0, Math.min(selectedPlayerCount, storedPersonsForFrame.length))
          .map(p => p.id);
        setSelectedPersonIds(toSelect);
      }
    }
  }, [showPoseOverlay, storedPersonsForFrame, selectedPersonIds.length, selectedPlayerCount]);

  // Fallback: live GPU detection when no stored data
  const handleDetectPose = useCallback((frame?: number) => {
    if (hasStoredPose || isPoseProcessing) return; // stored data available or processing, skip GPU
    const f = frame ?? currentFrame;
    if (isDetectingPose || Math.abs(f - lastPoseFrame.current) < 3) return;
    setIsDetectingPose(true);
    lastPoseFrame.current = f;
    detectPoses(gameId, f)
      .then((res) => {
        setDetectedPersons(res.data.persons);
        if (res.data.persons.length > 0 && selectedPersonIds.length === 0) {
          const toSelect = res.data.persons
            .slice(0, Math.min(selectedPlayerCount, res.data.persons.length))
            .map(p => p.id);
          setSelectedPersonIds(toSelect);
        }
      })
      .catch((err) => console.error("Pose detection failed:", err))
      .finally(() => setIsDetectingPose(false));
  }, [gameId, currentFrame, isDetectingPose, selectedPersonIds.length, hasStoredPose]);

  // Auto-refresh: use stored data (instant) or live GPU (fallback, every 5 frames)
  useEffect(() => {
    if (!showPoseOverlay || hasStoredPose) return; // stored data updates via storedPersonsForFrame
    if (!isDetectingPose && detectedPersons.length > 0 && Math.abs(currentFrame - lastPoseFrame.current) >= 5) {
      handleDetectPose(currentFrame);
    }
  }, [currentFrame, showPoseOverlay, isDetectingPose, detectedPersons.length, handleDetectPose, hasStoredPose]);

  // Draw pose skeletons on canvas
  const SKELETON_CONNECTIONS = useMemo(() => [
    [0, 1], [0, 2], [1, 3], [2, 4],
    [5, 6], [5, 7], [7, 9], [6, 8], [8, 10],
    [5, 11], [6, 12], [11, 12],
    [11, 13], [13, 15], [12, 14], [14, 16],
  ], []);

  const PERSON_COLORS = useMemo(() => ["#9B7B5B", "#5B9B7B", "#7B5B9B", "#C8B464"], []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !showPoseOverlay || detectedPersons.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx || !videoRef.current) return;
    const vw = videoRef.current.videoWidth || 1920;
    const vh = videoRef.current.videoHeight || 1080;
    if (canvas.width !== vw || canvas.height !== vh) { canvas.width = vw; canvas.height = vh; }
    // Don't clear — ball overlay draws first, then pose draws on top
    // ctx.clearRect(0, 0, vw, vh); — removed to allow layering

    for (const person of detectedPersons) {
      const color = PERSON_COLORS[(person.id - 1) % PERSON_COLORS.length];
      const isSelected = selectedPersonIds.includes(person.id);
      const alpha = isSelected ? 1.0 : 0.4;

      // Bbox
      const [x1, y1, x2, y2] = person.bbox;
      ctx.strokeStyle = color;
      ctx.lineWidth = isSelected ? 3 : 1.5;
      ctx.globalAlpha = alpha;
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
      ctx.fillStyle = color;
      ctx.globalAlpha = alpha * 0.15;
      ctx.fillRect(x1, y1, x2 - x1, y2 - y1);

      // Label
      ctx.globalAlpha = alpha;
      ctx.font = "bold 14px sans-serif";
      ctx.fillStyle = color;
      const selectionIndex = selectedPersonIds.indexOf(person.id);
      const label = selectionIndex === 0 ? "Player" : selectionIndex === 1 ? "Opponent" : `P${person.id}`;
      ctx.fillText(label, x1 + 4, y1 - 6);

      // Skeleton connections
      const kps = person.keypoints;
      ctx.lineWidth = isSelected ? 2.5 : 1.5;
      for (const [a, b] of SKELETON_CONNECTIONS) {
        if (a < kps.length && b < kps.length && kps[a].conf > 0.3 && kps[b].conf > 0.3) {
          ctx.beginPath();
          ctx.strokeStyle = color;
          ctx.globalAlpha = alpha * 0.8;
          ctx.moveTo(kps[a].x, kps[a].y);
          ctx.lineTo(kps[b].x, kps[b].y);
          ctx.stroke();
        }
      }

      // Keypoints
      for (const kp of kps) {
        if (kp.conf > 0.3) {
          ctx.beginPath();
          ctx.arc(kp.x, kp.y, isSelected ? 4 : 2.5, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.globalAlpha = alpha;
          ctx.fill();
        }
      }
    }
    ctx.globalAlpha = 1.0;
  }, [detectedPersons, showPoseOverlay, selectedPersonIds, SKELETON_CONNECTIONS, PERSON_COLORS]);

  // Fallback: Auto-detect balls with YOLO (then user confirms for SAM2)
  const handleAutoDetect = useCallback(() => {
    setIsDetecting(true);
    detectBalls(gameId, currentFrame)
      .then((res) => {
        setDetectionResult({
          detections: res.data.detections,
          preview_image: res.data.preview_image,
          frame: currentFrame,
        });
      })
      .catch((err) => {
        console.error("Detection failed:", err);
        alert("Ball detection failed. Check GPU connection.");
      })
      .finally(() => setIsDetecting(false));
  }, [gameId, currentFrame]);

  const handleTrackNetTrack = useCallback(() => {
    console.log("[Track] Starting ball tracking for session:", gameId);
    setIsTracking(true);
    trackWithTrackNet(gameId)
      .then((res) => {
        const tracked = res.data.frames_tracked ?? 0;
        console.log("[Track] TrackNet result:", tracked, "frames tracked");
        if (tracked > 0) {
          queryClient.invalidateQueries({ queryKey: sessionKeys.detail(gameId) });
        } else {
          // TrackNet found nothing — fall back to YOLO+SAM2
          handleAutoDetect();
        }
      })
      .catch((err) => {
        console.error("[Track] TrackNet failed, falling back:", err);
        // TrackNet failed — fall back to YOLO+SAM2
        handleAutoDetect();
      })
      .finally(() => setIsTracking(false));
  }, [gameId, queryClient, handleAutoDetect]);

  // Confirm a YOLO detection and run SAM2 tracking with its bbox
  const handleConfirmDetection = useCallback((detection: BallDetection) => {
    setDetectionResult(null);
    setIsTracking(true);
    const cx = detection.center[0];
    const cy = detection.center[1];
    trackMutation.mutate({ x: cx, y: cy, frame: detectionResult?.frame ?? currentFrame, detection_box: detection.bbox }, {
      onSuccess: () => { queryClient.invalidateQueries({ queryKey: sessionKeys.detail(gameId) }); },
      onError: (err) => { console.error("Tracking failed:", err); alert("Tracking failed."); },
      onSettled: () => setIsTracking(false),
    });
  }, [detectionResult, currentFrame, trackMutation, queryClient, gameId]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void playVideoSafely();
    } else {
      video.pause();
    }
  }, [playVideoSafely]);
  const skipFrames = useCallback((n: number) => { const t = Math.max(0, Math.min(duration, currentTime + n / fps)); if (videoRef.current) videoRef.current.currentTime = t; }, [duration, currentTime, fps]);
  const fmtTime = (t: number) => `${Math.floor(t / 60)}:${Math.floor(t % 60).toString().padStart(2, "0")}`;
  const handleAnalyticsSeek = useCallback((targetTime: number) => {
    const durationSafe = Number.isFinite(duration) && duration > 0 ? duration : targetTime;
    const safeTime = Math.max(0, Math.min(durationSafe, targetTime));
    if (videoRef.current) {
      videoRef.current.currentTime = safeTime;
    }
    setCurrentTime(safeTime);
    setCurrentFrame(frameFromTime(safeTime));
  }, [duration, frameFromTime]);
  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const targetTime = Number(e.target.value);
    if (!Number.isFinite(targetTime)) return;
    handleAnalyticsSeek(targetTime);
  }, [handleAnalyticsSeek]);
  const handleTipSeek = useCallback((tip: VideoTip) => {
    if (!videoRef.current) return;
    const targetTime = tip.seekTime ?? tip.timestamp;
    videoRef.current.currentTime = targetTime;
    videoRef.current.pause();
    setIsPlaying(false);
  }, []);

  // Smart clip pre-fill: find highest-scoring activity region near current time
  const clipPrefill = useMemo(() => {
    const regions = analytics?.activity_regions;
    if (!regions || regions.length === 0) return { startTime: currentTime, endTime: Math.min(currentTime + 10, duration) };
    // Find region with highest peak_score within 30s of current time
    const nearbyRadius = 30; // seconds
    let best: ActivityRegion | null = null;
    for (const r of regions) {
      const regionMid = (r.start_time + r.end_time) / 2;
      if (Math.abs(regionMid - currentTime) <= nearbyRadius) {
        if (!best || r.peak_score > best.peak_score) best = r;
      }
    }
    if (best) {
      // Add some padding (0.5s before, 1s after), clamp to video bounds
      const pad = 0.5;
      return {
        startTime: Math.max(0, best.start_time - pad),
        endTime: Math.min(duration, best.end_time + pad * 2),
      };
    }
    return { startTime: currentTime, endTime: Math.min(currentTime + 10, duration) };
  }, [analytics?.activity_regions, currentTime, duration]);

  // Handle clip creation from ClipSelector
  const handleClipSelect = useCallback(async (startTime: number, endTime: number) => {
    if (!gameId) return;
    setClipLoading(true);
    try {
      await createSessionClip(gameId, startTime, endTime, `Clip ${new Date().toLocaleTimeString()}`);
      setShowClipSelector(false);
    } catch (e) {
      console.error("Failed to create clip:", e);
    } finally {
      setClipLoading(false);
    }
  }, [gameId]);

  // Tabs that require the video to be loaded before they can function
  const videoRequiredTabs: TabId[] = ["track", "court", "analytics"];
  const isTabDisabled = useCallback((tabId: TabId) => {
    if (!videoRequiredTabs.includes(tabId)) return false;
    return !videoReady || isProcessing;
  }, [videoReady, isProcessing]);

  const handleTabClick = useCallback((tabId: TabId) => {
    // Block switching to video-dependent tabs until clip/video is loaded
    if (isTabDisabled(tabId)) return;

    setActiveTab(tabId);
    setPlayerSelectMode(false);
    if (tabId === "pose") {
      setShowPoseOverlay((p) => !p);
      if (!showPoseOverlay) handleDetectPose(); // detect on first enable
    }
    if (tabId === "track" && !hasTrajectory) handleTrackNetTrack();
  }, [showPoseOverlay, handleDetectPose, hasTrajectory, handleTrackNetTrack, isTabDisabled]);

  // Auto-widen panel for court view and analytics
  useEffect(() => {
    if (showCourt) setPanelWidth(640);
    else if (showAnalytics) setPanelWidth(800); // Wide panel for analytics
    else setPanelWidth(320);
  }, [showCourt, showAnalytics]);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    const startX = e.clientX;
    const startW = panelWidth;
    const onMove = (ev: MouseEvent) => {
      if (!isResizing.current) return;
      const delta = startX - ev.clientX;
      setPanelWidth(Math.max(280, Math.min(window.innerWidth * 0.6, startW + delta)));
    };
    const onUp = () => { isResizing.current = false; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [panelWidth]);

  // Early returns AFTER all hooks
  if (isLoading) return <div className="flex items-center justify-center h-[60vh]"><Loader2 className="w-8 h-8 text-[#9B7B5B] animate-spin" /></div>;
  if (!session) return <div className="text-center py-16"><p className="text-[#8A8885]">Game not found</p><Button variant="outline" onClick={() => router.push("/dashboard")} className="mt-4">Back</Button></div>;

  const firstPlayer = session.players?.[0];
  const detection = detectionResult;
  const isAnalyticsView = activeTab === "analytics";

  return (
    <>
      <div className="h-[calc(100vh-7rem)] flex flex-col overflow-hidden">
        {!isAnalyticsView && (
          <>
            {/* Breadcrumbs */}
            <nav className="flex items-center gap-1.5 text-xs text-[#6A6865] mb-2 shrink-0">
              <Link href="/dashboard" className="hover:text-[#E8E6E3] transition-colors">Players</Link>
              <ChevronRight className="w-3 h-3" />
              {firstPlayer && (<><Link href={`/dashboard/players/${firstPlayer.id}`} className="hover:text-[#E8E6E3] transition-colors">{firstPlayer.name}</Link><ChevronRight className="w-3 h-3" /></>)}
              <span className="text-[#E8E6E3]">{session.name}</span>
            </nav>

            {/* Header */}
            <div className="flex items-center gap-3 mb-3 shrink-0">
              <button onClick={() => router.back()} className="text-[#6A6865] hover:text-[#E8E6E3] transition-colors"><ArrowLeft className="w-5 h-5" /></button>
              <div>
                <h1 className="text-lg font-light text-[#E8E6E3]">{session.name}</h1>
                <p className="text-xs text-[#6A6865]">{new Date(session.created_at).toLocaleDateString()}</p>
              </div>
            </div>
          </>
        )}

        {/* Main area — stacks vertically when AI sidebar is open */}
        <div className={cn(
          "gap-3 flex-1 min-h-0",
          aiChatOpen ? "flex flex-col overflow-y-auto" : "flex"
        )}>
          {/* Left: Video or Court (full area) */}
          <div className={cn(
            "flex flex-col min-h-0",
            aiChatOpen
              ? "w-full shrink-0"
              : showSidePanel ? "flex-1 min-w-0" : "w-full"
          )}>
            {/* Video / Court swap */}
            <div className="relative rounded-xl overflow-hidden bg-[#1E1D1F] flex-1 min-h-0">
              {/* Video always visible */}
              {(trackingMode || playerSelectMode) && (
                <div className="absolute top-3 left-3 right-3 z-30 flex items-center gap-2 px-3 py-2 rounded-lg bg-[#9B7B5B]/20 backdrop-blur-sm">
                  {trackingMode ? <Crosshair className="w-4 h-4 text-[#9B7B5B]" /> : <Users className="w-4 h-4 text-[#9B7B5B]" />}
                  <span className="text-xs text-[#E8E6E3]">
                    {trackingMode ? "Click on the ball to track" : "Click on a player to detect"}
                  </span>
                  <button onClick={() => { setTrackingMode(false); setPlayerSelectMode(false); }} className="ml-auto text-xs text-[#8A8885] hover:text-[#E8E6E3]">Cancel</button>
                </div>
              )}
              <div
                ref={videoViewportRef}
                className={cn("relative w-full h-full", (trackingMode || playerSelectMode) && "cursor-crosshair")}
                onClick={handleFrameClick}
              >
                {videoUrl ? (
                  <video ref={videoRef} src={videoUrl} className="w-full h-full object-contain" muted={isMuted} playsInline />
                ) : session?.status === "pending" || session?.status === "processing" ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                    <Loader2 className="w-8 h-8 text-[#9B7B5B] animate-spin" />
                    <div className="text-center">
                      <p className="text-sm font-medium text-[#E8E6E3]">
                        {session?.status === "pending" ? "Downloading clip..." : "Processing video..."}
                      </p>
                      <p className="text-[10px] text-[#8A8885] mt-1">
                        {session?.status === "pending" ? "Trimming and preparing your clip" : "Analysis will begin automatically"}
                      </p>
                    </div>
                  </div>
                ) : null}
                <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 10 }} />
                <canvas ref={playerCanvasRef} className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 20 }} />
                
                {/* Player Selection Overlays - rendered separately in video container */}
                {showPlayerSelection && (
                  <PlayerSelectionOverlays
                    videoRef={videoRef}
                    videoViewportRef={videoViewportRef}
                    sessionId={gameId}
                  />
                )}
                
                {/* Video Tips - AI-powered overlays */}
                <VideoTips
                  currentTime={currentTime}
                  tips={videoTips}
                  isPlaying={isPlaying}
                  onTipChange={handleTipChange}
                />

                {/* Live Stroke Indicator - Top-left of video */}
                {(hasStrokes || poseData?.frames?.length) && (
                  <div
                    className="absolute top-1/3 left-4 pointer-events-none"
                    style={{ zIndex: 100 }}
                  >
                    <div className="glass-shot-card px-4 py-2">
                      <div className="flex items-center gap-2.5">
                        <div className={cn(
                          "w-2 h-2 rounded-full shrink-0",
                          activeStroke
                            ? activeStroke.stroke_type === "forehand"
                              ? "bg-[#9B7B5B] animate-pulse"
                              : "bg-[#5B9B7B] animate-pulse"
                            : lastStroke
                              ? lastStroke.stroke_type === "forehand"
                                ? "bg-[#9B7B5B]"
                                : "bg-[#5B9B7B]"
                              : "bg-[#363436]"
                        )} />
                        <span className="text-xs font-medium text-[#E8E6E3] leading-tight capitalize whitespace-nowrap">
                          {activeStroke
                            ? activeStroke.stroke_type
                            : lastStroke
                              ? `Last ${lastStroke.stroke_type}`
                              : "Ready"
                          }
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Tracking in-progress overlay */}
                {isTracking && videoBounds && (
                  <div
                    className="fixed z-30 pointer-events-none"
                    style={{
                      top: `${videoBounds.top + 12}px`,
                      left: `${videoBounds.right - (videoBounds.width / 2) - 80}px`,
                    }}
                  >
                    <div className="rounded-lg bg-black/60 backdrop-blur-md border border-[#9B7B5B]/30 px-4 py-2.5 flex items-center gap-2.5">
                      <Loader2 className="w-4 h-4 text-[#9B7B5B] animate-spin" />
                      <div>
                        <p className="text-xs font-medium text-[#E8E6E3]">Tracking ball</p>
                        <p className="text-[10px] text-[#8A8885]">This may take a moment</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Pose processing overlay */}
                {isPoseProcessing && videoBounds && (
                  <div
                    className="fixed z-30 pointer-events-none"
                    style={{
                      top: `${videoBounds.top + 12}px`,
                      left: `${videoBounds.right - (videoBounds.width / 2) - 80}px`,
                    }}
                  >
                    <div className="rounded-lg bg-black/60 backdrop-blur-md border border-[#9B7B5B]/30 px-4 py-2.5 flex items-center gap-2.5">
                      <Loader2 className="w-4 h-4 text-[#9B7B5B] animate-spin" />
                      <div>
                        <p className="text-xs font-medium text-[#E8E6E3]">Analyzing poses</p>
                        <p className="text-[10px] text-[#8A8885]">
                          {hasTrajectory ? "Generating overlay video..." : "Detecting players and tracking ball..."}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Debug floating bar */}
              {hasPose && debugMode && (
                <div className="absolute bottom-14 left-1/2 -translate-x-1/2 z-30">
                  <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-black/80 backdrop-blur-sm border border-[#C45C5C]/30">
                    {debugFlash && (
                      <span className={cn(
                        "text-[10px] font-bold px-1.5 py-0.5 rounded animate-pulse",
                        debugFlash === "forehand" ? "bg-[#9B7B5B]/30 text-[#9B7B5B]"
                        : debugFlash === "backhand" ? "bg-[#5B9B7B]/30 text-[#5B9B7B]"
                        : debugFlash === "false_positive" ? "bg-[#C45C5C]/30 text-[#C45C5C]"
                        : "bg-[#8A8885]/30 text-[#8A8885]"
                      )}>
                        {debugFlash === "forehand" ? "FH" : debugFlash === "backhand" ? "BH" : debugFlash === "false_positive" ? "FALSE+" : "MISSED"} logged
                      </span>
                    )}
                    <button
                      onClick={() => debugAnnotate("forehand")}
                      disabled={debugLoading}
                      className="px-2.5 py-1 rounded-lg text-[10px] font-medium bg-[#9B7B5B]/20 text-[#9B7B5B] hover:bg-[#9B7B5B]/30 transition-colors disabled:opacity-50"
                      title="Mark as forehand hit (H)"
                    >
                      {debugLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : "FH (H)"}
                    </button>
                    <button
                      onClick={() => debugAnnotate("backhand")}
                      disabled={debugLoading}
                      className="px-2.5 py-1 rounded-lg text-[10px] font-medium bg-[#5B9B7B]/20 text-[#5B9B7B] hover:bg-[#5B9B7B]/30 transition-colors disabled:opacity-50"
                      title="Mark as backhand hit (B)"
                    >
                      BH (B)
                    </button>
                    <button
                      onClick={() => debugAnnotate("false_positive")}
                      disabled={debugLoading}
                      className="px-2.5 py-1 rounded-lg text-[10px] font-medium bg-[#C45C5C]/20 text-[#C45C5C] hover:bg-[#C45C5C]/30 transition-colors disabled:opacity-50"
                      title="Mark as false positive (F)"
                    >
                      False+ (F)
                    </button>
                    <button
                      onClick={() => debugAnnotate("missed")}
                      disabled={debugLoading}
                      className="px-2.5 py-1 rounded-lg text-[10px] font-medium bg-[#8A8885]/20 text-[#8A8885] hover:bg-[#8A8885]/30 transition-colors disabled:opacity-50"
                      title="Mark as missed hit (M)"
                    >
                      Missed (M)
                    </button>
                    <div className="w-px h-4 bg-[#363436] mx-1" />
                    <span className="text-[10px] text-[#6A6865] tabular-nums">
                      {debugLog.length} logged
                    </span>
                    {debugLog.length > 0 && (
                      <button
                        onClick={copyDebugLog}
                        className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium bg-[#363436] text-[#E8E6E3] hover:bg-[#4A4849] transition-colors"
                        title="Copy debug log as JSON"
                      >
                        {debugCopied ? <Check className="w-3 h-3 text-[#6B8E6B]" /> : <Copy className="w-3 h-3" />}
                        {debugCopied ? "Copied" : "Copy"}
                      </button>
                    )}
                    <span className="text-[9px] text-[#6A6865] tabular-nums ml-1">
                      F{currentFrame}
                    </span>
                  </div>
                </div>
              )}

              {/* Glass Toolbar — always on top */}
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20">
                <div className="glass-toolbar flex items-center gap-1 px-2 py-1.5">
                  <div className="glass-shimmer" />
                  {tabs.map((tab) => {
                    const Icon = tab.icon;
                    const isActive = activeTab === tab.id;
                    const isOn = (tab.id === "pose" && showPoseOverlay) || (tab.id === "track" && trackingMode) || (tab.id === "analytics" && activeTab === "analytics");
                    const disabled = isTabDisabled(tab.id);
                    return (
                      <button
                        key={tab.id}
                        onClick={() => handleTabClick(tab.id)}
                        disabled={disabled}
                        className={cn(
                          "glass-tab",
                          (isActive || isOn) && !disabled && "glass-tab-active",
                          disabled && "opacity-35 cursor-not-allowed"
                        )}
                        title={disabled ? "Waiting for video to load..." : tab.label}
                      >
                        {disabled ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
                        <span>{tab.label}</span>
                        {isOn && !disabled && <div className="w-1.5 h-1.5 rounded-full bg-[#9B7B5B]" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Controls */}
            <div className="mx-auto mt-2 shrink-0 w-full" style={videoDisplayWidth ? { width: `${videoDisplayWidth}px` } : undefined}>
              <div className="rounded-xl bg-[#282729] p-2.5">
              <div className="flex items-center gap-3 mb-1.5">
                <span className="text-[10px] text-[#6A6865] w-10">{fmtTime(currentTime)}</span>
                <div className="relative flex-1">
                  <div className="absolute inset-x-0 -top-1.5 h-2 pointer-events-none">
                    {duration > 0 && strokeMarkers.map((marker) => {
                      const pct = Math.min(1, Math.max(0, marker.time / duration));
                      const isActive = activeStroke?.id === marker.id;
                      const color = marker.type === "forehand" ? "#9B7B5B"
                        : marker.type === "backhand" ? "#5B9B7B"
                        : "#8A8885";
                      return (
                        <button
                          key={marker.id}
                          onClick={() => {
                            if (videoRef.current) videoRef.current.currentTime = marker.time;
                          }}
                          className={cn(
                            "absolute top-0 -translate-x-1/2 h-3 w-1.5 rounded-full pointer-events-auto transition-transform",
                            isActive ? "scale-125" : "hover:scale-125"
                          )}
                          style={{ left: `${pct * 100}%`, backgroundColor: color }}
                          title={`${marker.type} — Frame ${marker.frame} — Form ${marker.formScore.toFixed(0)}`}
                          aria-label={`${marker.type} stroke at ${fmtTime(marker.time)}`}
                        />
                      );
                    })}
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={duration || 100}
                    step={0.01}
                    value={currentTime}
                    onChange={handleSeek}
                    className="w-full h-1 bg-[#363436] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:bg-[#9B7B5B] [&::-webkit-slider-thumb]:rounded-full"
                  />
                  {/* Trajectory reversal markers (blue dots below slider) */}
                  {trajectoryReversalMarkers.length > 0 && (
                    <div className="absolute inset-x-0 top-2.5 h-2 pointer-events-none">
                      {duration > 0 && trajectoryReversalMarkers.map((marker, i) => {
                        const pct = Math.min(1, Math.max(0, marker.time / duration));
                        return (
                          <button
                            key={`rev-${marker.frame}-${i}`}
                            onClick={() => {
                              if (videoRef.current) videoRef.current.currentTime = marker.time;
                            }}
                            className="absolute top-0 -translate-x-1/2 w-2 h-2 rounded-full pointer-events-auto hover:scale-150 transition-transform"
                            style={{
                              left: `${pct * 100}%`,
                              backgroundColor: "#7B9BC4",
                              boxShadow: "0 0 4px rgba(123, 155, 196, 0.5)",
                            }}
                            title={`Ball direction change — Frame ${marker.frame}`}
                            aria-label={`Trajectory reversal at ${fmtTime(marker.time)}`}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
                <span className="text-[10px] text-[#6A6865] w-10 text-right">{fmtTime(duration)}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-[#6A6865] w-10 tabular-nums">{fmtTime(currentTime)}</span>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => skipFrames(-10)}><SkipBack className="w-3 h-3" /></Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={togglePlay}>{isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}</Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => skipFrames(10)}><SkipForward className="w-3 h-3" /></Button>
                </div>
                <span className="text-[10px] text-[#6A6865] tabular-nums">Frame {currentFrame}</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setShowClipSelector(true)}
                    className="p-1 rounded text-[#9B7B5B] hover:bg-[#2D2C2E] transition-colors"
                    title="Create clip"
                  >
                    <Scissors className="w-3.5 h-3.5" />
                  </button>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-[#9B7B5B] font-mono w-7 text-right">{playbackRate}x</span>
                    <input
                      type="range"
                      min={0}
                      max={4}
                      step={1}
                      value={[0.25, 0.5, 1, 1.5, 2].indexOf(playbackRate)}
                      onChange={(e) => {
                        const rates = [0.25, 0.5, 1, 1.5, 2];
                        const rate = rates[parseInt(e.target.value)];
                        setPlaybackRate(rate);
                        if (videoRef.current) videoRef.current.playbackRate = rate;
                      }}
                      className="w-14 h-1 accent-[#9B7B5B] cursor-pointer"
                      title={`Speed: ${playbackRate}x`}
                    />
                  </div>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setIsMuted((m) => !m)}>{isMuted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}</Button>
                  <span className="text-[10px] text-[#6A6865] w-10 text-right tabular-nums">{fmtTime(duration)}</span>
                </div>
              </div>
            </div>
            </div>
          </div>

          {/* Right Panel — Track results, Players, Court, Pose */}
          {showSidePanel && (
            <div
              className={cn(
                "flex min-h-0 overflow-hidden",
                aiChatOpen ? "w-full shrink-0" : "shrink-0"
              )}
              style={aiChatOpen ? undefined : { width: panelWidth }}
            >
              {/* Resize handle — hidden when stacked */}
              {!aiChatOpen && (
                <div
                  onMouseDown={handleResizeStart}
                  className="w-1.5 shrink-0 cursor-col-resize hover:bg-[#9B7B5B]/30 active:bg-[#9B7B5B]/50 transition-colors rounded-full self-stretch"
                />
              )}
              <div className="flex-1 flex min-h-0 overflow-hidden">
                <div className={cn(
                  "mx-auto flex flex-col min-h-0 overflow-hidden",
                  aiChatOpen ? "w-full h-auto max-h-[50vh]" : "w-full h-full max-w-[calc(100%-8px)]"
                )}>
                  {/* 3D Ball Trajectory Visualization */}
                  {activeTab === "track" && (
                    <div className="flex-1 min-h-0 rounded-xl overflow-hidden flex flex-col">
                  {hasTrajectory ? (
                    <div className="space-y-3">
                      <p className="text-[10px] text-[#6A6865] uppercase tracking-wider">Tracking Results</p>
                      <div className="space-y-2">
                        <div className="flex justify-between text-xs"><span className="text-[#8A8885]">Frames</span><span className="text-[#E8E6E3]">{session.trajectory_data?.frames?.length}</span></div>
                        <div className="flex justify-between text-xs"><span className="text-[#8A8885]">Avg Speed</span><span className="text-[#E8E6E3]">{session.trajectory_data?.velocity?.length ? (session.trajectory_data.velocity.reduce((a: number, b: number) => a + b, 0) / session.trajectory_data.velocity.length).toFixed(1) : "—"} px/f</span></div>
                        <div className="flex justify-between text-xs"><span className="text-[#8A8885]">Spin</span><span className="text-[#9B7B5B] capitalize">{session.trajectory_data?.spin_estimate ?? "—"}</span></div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      {(isTracking || isProcessing) ? (
                        <>
                          <Loader2 className="w-6 h-6 text-[#9B7B5B] mx-auto mb-3 animate-spin" />
                          <p className="text-sm text-[#E8E6E3] font-medium">Tracking ball...</p>
                          <p className="text-[10px] text-[#8A8885] mt-1.5">Trajectory will appear when ready</p>
                        </>
                      ) : (
                        <>
                          <Crosshair className="w-7 h-7 text-[#9B7B5B] mx-auto mb-3" />
                          <p className="text-sm text-[#E8E6E3] font-medium mb-1">Ready to track</p>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleTrackNetTrack}
                            className="mt-2 text-xs"
                          >
                            <Crosshair className="w-3 h-3 mr-1" />
                            Track Ball
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Pose analysis panel */}
              {activeTab === "pose" && showPoseOverlay && (
                <div className="glass-context rounded-xl flex flex-col h-full min-h-0 flex-1 overflow-hidden">
                  <div className="px-3 py-2.5 border-b border-[#363436]/30 flex items-center justify-between">
                    <span className="text-xs font-medium text-[#E8E6E3]">Pose & Strokes</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleRecomputeAnalytics}
                        disabled={isRecomputingAnalytics}
                        className="flex items-center gap-1 text-[10px] text-[#6A6865] hover:text-[#9B7B5B] transition-colors disabled:opacity-50"
                        title="Recompute analytics for this session"
                      >
                        <RefreshCw className={cn("w-3 h-3", isRecomputingAnalytics && "animate-spin")} />
                        <span className="hidden sm:inline">Recompute analytics</span>
                      </button>
                      {(isDetectingPose || isPoseProcessing) && <Loader2 className="w-3 h-3 text-[#9B7B5B] animate-spin" />}
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto p-2 space-y-2">
                    {showPlayerSelection && (
                      <>
                        <PlayerSelection
                          sessionId={gameId}
                          variant="inline"
                          videoRef={videoRef}
                          videoViewportRef={videoViewportRef}
                          onClose={() => setShowPlayerSelection(false)}
                          onAnalysisStarted={() => {
                            queryClient.invalidateQueries({ queryKey: sessionKeys.detail(gameId) });
                          }}
                        />
                      </>
                    )}

                    {/* ── Live Stroke Indicator (synced to video frame) ── */}
                    {hasStrokes && (
                      <div className={cn(
                        "p-2.5 rounded-lg transition-all duration-200",
                        activeStroke
                          ? activeStroke.stroke_type === "forehand" ? "bg-[#9B7B5B]/15 ring-1 ring-[#9B7B5B]/40"
                          : activeStroke.stroke_type === "backhand" ? "bg-[#5B9B7B]/15 ring-1 ring-[#5B9B7B]/40"
                          : "bg-[#1E1D1F]"
                          : "bg-[#1E1D1F]"
                      )}>
                        {activeStroke ? (
                          <div className="flex items-center gap-2">
                            <div className={cn(
                              "w-2 h-2 rounded-full animate-pulse",
                              activeStroke.stroke_type === "forehand" ? "bg-[#9B7B5B]"
                              : activeStroke.stroke_type === "backhand" ? "bg-[#5B9B7B]"
                              : "bg-[#8A8885]"
                            )} />
                            <span className={cn(
                              "text-xs font-medium capitalize",
                              activeStroke.stroke_type === "forehand" ? "text-[#9B7B5B]"
                              : activeStroke.stroke_type === "backhand" ? "text-[#5B9B7B]"
                              : "text-[#8A8885]"
                            )}>
                              {activeStroke.stroke_type}
                            </span>
                            <span className="text-[10px] text-[#6A6865] ml-auto">
                              Form {activeStroke.form_score.toFixed(0)}
                            </span>
                          </div>
                        ) : lastStroke ? (
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-[#363436]" />
                            <span className="text-xs text-[#6A6865]">
                              Last: <span className={cn(
                                "capitalize",
                                lastStroke.stroke_type === "forehand" ? "text-[#9B7B5B]"
                                : lastStroke.stroke_type === "backhand" ? "text-[#5B9B7B]"
                                : "text-[#8A8885]"
                              )}>{lastStroke.stroke_type}</span>
                            </span>
                            <span className="text-[10px] text-[#6A6865] ml-auto">
                              Form {lastStroke.form_score.toFixed(0)}
                            </span>
                          </div>
                        ) : null}
                      </div>
                    )}

                    {/* ── Stroke Summary Stats ── */}
                    {hasPose && !isPoseProcessing && (
                      <>
                        {isStrokeRecomputeProcessing ? (
                          <div className="rounded-lg bg-[#1E1D1F] ring-1 ring-[#9B7B5B]/30 p-3">
                            <div className="flex items-center gap-2">
                              <Loader2 className="w-3.5 h-3.5 text-[#9B7B5B] animate-spin" />
                              <span className="text-xs font-medium text-[#E8E6E3]">Recomputing stroke insights</span>
                            </div>
                            <p className="text-[10px] text-[#8A8885] mt-1">
                              {strokeClaudeClassifierEnabled
                                ? "Waiting for Claude classifications, then refreshing timeline and AI insights."
                                : "Waiting for vision analysis, then refreshing timeline and AI insights."}
                            </p>
                            <div className="mt-2 space-y-1.5">
                              {strokePipelineStageRows.map((stage) => (
                                <div key={stage.id} className="flex items-center justify-between gap-2 text-[10px]">
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    {stage.status === "completed" ? (
                                      <Check className="w-3 h-3 text-[#5B9B7B] shrink-0" />
                                    ) : stage.status === "running" ? (
                                      <Loader2 className="w-3 h-3 text-[#9B7B5B] animate-spin shrink-0" />
                                    ) : stage.status === "failed" ? (
                                      <X className="w-3 h-3 text-[#C45C5C] shrink-0" />
                                    ) : (
                                      <div className="w-3 h-3 rounded-full bg-[#363436] shrink-0" />
                                    )}
                                    <span
                                      className={cn(
                                        "truncate",
                                        stage.status === "running" ? "text-[#E8E6E3]"
                                        : stage.status === "completed" ? "text-[#8A8885]"
                                        : stage.status === "failed" ? "text-[#C45C5C]"
                                        : "text-[#6A6865]"
                                      )}
                                    >
                                      {stage.label}
                                    </span>
                                  </div>
                                  <span className="text-[#6A6865] tabular-nums shrink-0">
                                    {stage.durationMs !== null ? `${(stage.durationMs / 1000).toFixed(stage.durationMs >= 10000 ? 1 : 2)}s` : "—"}
                                  </span>
                                </div>
                              ))}
                            </div>
                            <div className="mt-2 pt-2 border-t border-[#363436]/40 flex items-center justify-between text-[10px]">
                              <span className="text-[#6A6865]">Elapsed</span>
                              <span className="text-[#8A8885] tabular-nums">
                                {(strokePipelineElapsedMs / 1000).toFixed(strokePipelineElapsedMs >= 10000 ? 1 : 2)}s
                              </span>
                            </div>
                          </div>
                        ) : hasStrokes ? (
                          <div className="flex flex-col gap-2 min-h-0 flex-1">
                            {/* Camera facing toggle + Re-analyze */}
                            <div className="flex items-center justify-between shrink-0">
                              <p className="text-[11px] text-[#6A6865] uppercase tracking-wider">Stroke Breakdown</p>
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => strokeMutation.mutate()}
                                  disabled={strokeMutation.isPending}
                                  className="flex items-center gap-1 text-[10px] text-[#6A6865] hover:text-[#9B7B5B] transition-colors disabled:opacity-50"
                                  title="Re-analyze strokes with current settings"
                                >
                                  <RefreshCw className={cn("w-3 h-3", strokeMutation.isPending && "animate-spin")} />
                                </button>
                                <button
                                  onClick={() => {
                                    const cycle = { auto: "toward" as const, toward: "away" as const, away: "auto" as const };
                                    const current = (session?.camera_facing ?? "auto") as "auto" | "toward" | "away";
                                    updateSessionMutation.mutate({ camera_facing: cycle[current] });
                                  }}
                                  className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[#1E1D1F] hover:bg-[#2D2C2E] transition-colors"
                                  title="Player orientation: Auto-detect, facing camera (front), or facing away (back)"
                                >
                                  <span className="text-[10px] text-[#6A6865]">View:</span>
                                  <span className={`text-[11px] font-medium ${
                                    (session?.camera_facing ?? "auto") === "auto"
                                      ? "text-[#9B7B5B]"
                                      : (session?.camera_facing ?? "auto") === "toward"
                                      ? "text-[#6B8E6B]"
                                      : "text-[#7B8ECE]"
                                  }`}>
                                    {(session?.camera_facing ?? "auto") === "auto" ? "Auto" : (session?.camera_facing ?? "auto") === "toward" ? "Front" : "Back"}
                                  </span>
                                </button>
                              </div>
                            </div>

                            {/* Stroke Distribution */}
                            {(strokeSummary?.total_strokes ?? 0) > 0 && (
                              <div className="shrink-0">
                                <div className="flex h-2.5 rounded-full overflow-hidden bg-[#363436]">
                                  <div className="bg-[#9B7B5B] transition-all" style={{ width: `${((strokeSummary?.forehand_count ?? 0) / (strokeSummary?.total_strokes ?? 1)) * 100}%` }} />
                                  <div className="bg-[#5B9B7B] transition-all" style={{ width: `${((strokeSummary?.backhand_count ?? 0) / (strokeSummary?.total_strokes ?? 1)) * 100}%` }} />
                                </div>
                                <div className="flex justify-between mt-2 gap-2">
                                  <span className="text-sm font-medium text-[#9B7B5B]">Forehand ({strokeSummary?.forehand_count ?? 0}) - {Math.round(((strokeSummary?.forehand_count ?? 0) / (strokeSummary?.total_strokes ?? 1)) * 100)}%</span>
                                  <span className="text-sm font-medium text-[#5B9B7B]">Backhand ({strokeSummary?.backhand_count ?? 0}) - {Math.round(((strokeSummary?.backhand_count ?? 0) / (strokeSummary?.total_strokes ?? 1)) * 100)}%</span>
                                </div>
                              </div>
                            )}

                            {/* Insight Generation Progress */}
                            {isInsightGenerating && (
                              <div className="rounded-lg bg-[#1E1D1F] ring-1 ring-[#9B7B5B]/30 p-3">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <Loader2 className="w-3.5 h-3.5 text-[#9B7B5B] animate-spin" />
                                    <span className="text-xs font-medium text-[#E8E6E3]">
                                      Generating AI insights
                                      {insightsProgress ? ` — Stroke ${insightsProgress.current} of ${insightsProgress.total}` : ""}
                                    </span>
                                  </div>
                                  <button
                                    onClick={() => cancelInsightsMutation.mutate()}
                                    disabled={cancelInsightsMutation.isPending}
                                    className="text-[#6A6865] hover:text-[#C45C5C] transition-colors disabled:opacity-50"
                                    title="Cancel insight generation"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                                {insightsProgress && insightsProgress.total > 0 && (
                                  <div className="mt-2 h-1.5 rounded-full bg-[#363436] overflow-hidden">
                                    <div
                                      className="h-full bg-[#9B7B5B] transition-all duration-300"
                                      style={{ width: `${(insightsProgress.completed / insightsProgress.total) * 100}%` }}
                                    />
                                  </div>
                                )}
                              </div>
                            )}

                            {/* AI Insight Cards (replace rule-based tips when available) */}
                            {hasAiInsights ? (
                              <div className="flex flex-col min-h-0 flex-1">
                                <div className="flex items-center justify-between mb-1.5 shrink-0">
                                  <p className="text-[11px] text-[#6A6865] uppercase tracking-wider">
                                    Insights ({aiInsightStrokes.length})
                                  </p>
                                  {isInsightGenerating && (
                                    <button
                                      onClick={() => cancelInsightsMutation.mutate()}
                                      disabled={cancelInsightsMutation.isPending}
                                      className="text-[#6A6865] hover:text-[#C45C5C] transition-colors disabled:opacity-50"
                                      title="Cancel insight generation"
                                    >
                                      <X className="w-3 h-3" />
                                    </button>
                                  )}
                                </div>
                                <div className="space-y-1.5 overflow-y-auto pr-1 flex-1">
                                  <AnimatePresence mode="popLayout">
                                    {aiInsightStrokes.map((stroke, idx) => {
                                      const wasReclassified = stroke.ai_insight_data?.corrected_stroke_type &&
                                        stroke.ai_insight_data.corrected_stroke_type !== stroke.ai_insight_data.original_stroke_type;
                                      const strokeColor = stroke.stroke_type === "forehand" ? "#9B7B5B" : stroke.stroke_type === "backhand" ? "#5B9B7B" : "#8A8885";
                                      const strokeTime = stroke.peak_frame / fps;
                                      const isActive = activeStroke?.id === stroke.id;
                                      return (
                                        <motion.button
                                          key={stroke.id}
                                          initial={{ opacity: 0, y: 8 }}
                                          animate={{ opacity: 1, y: 0 }}
                                          exit={{ opacity: 0, y: -4 }}
                                          transition={{ delay: idx * 0.05, duration: 0.2 }}
                                          onClick={() => {
                                            if (videoRef.current) {
                                              videoRef.current.currentTime = stroke.start_frame / fps;
                                              videoRef.current.pause();
                                              setIsPlaying(false);
                                            }
                                          }}
                                          className={cn(
                                            "w-full text-left p-2.5 rounded-lg transition-all",
                                            isActive
                                              ? "bg-[#9B7B5B]/15 ring-1 ring-[#9B7B5B]/40"
                                              : "bg-[#2D2C2E]/30 hover:bg-[#2D2C2E]"
                                          )}
                                        >
                                          <div className="flex items-center gap-2">
                                            <span className="text-[11px] font-mono shrink-0 text-[#6A6865]">
                                              {fmtTime(strokeTime)}
                                            </span>
                                            <span
                                              className="text-[10px] font-medium px-1.5 py-0.5 rounded capitalize"
                                              style={{ backgroundColor: `${strokeColor}20`, color: strokeColor }}
                                            >
                                              {stroke.stroke_type}
                                            </span>
                                            {wasReclassified && (
                                              <span className="text-[9px] text-[#C4A05C] bg-[#C4A05C]/15 px-1 py-0.5 rounded">
                                                was {stroke.ai_insight_data?.original_stroke_type}
                                              </span>
                                            )}
                                          </div>
                                          {stroke.ai_insight && (
                                            <p className="text-[11px] mt-1.5 line-clamp-3 leading-relaxed text-[#8A8885]">
                                              {stroke.ai_insight}
                                            </p>
                                          )}
                                        </motion.button>
                                      );
                                    })}
                                  </AnimatePresence>
                                </div>
                              </div>
                            ) : videoTips.length > 0 ? (
                              <div className="flex flex-col min-h-0 flex-1">
                                <p className="text-[11px] text-[#6A6865] uppercase tracking-wider mb-1.5 shrink-0">
                                  Insights ({videoTips.filter(t => !t.id.includes("follow") && !t.id.includes("summary")).length})
                                </p>
                                <div className="space-y-1.5 overflow-y-auto pr-1 flex-1">
                                  {videoTips
                                    .filter(t => !t.id.includes("follow") && !t.id.includes("summary"))
                                    .map((tip) => {
                                      const isActive = activeTip?.id === tip.id;
                                      const isPast = currentTime > tip.timestamp + tip.duration;
                                      return (
                                        <button
                                          key={tip.id}
                                          onClick={() => {
                                            handleTipSeek(tip);
                                          }}
                                          className={cn(
                                            "w-full text-left p-2.5 rounded-lg transition-all",
                                            isActive
                                              ? "bg-[#9B7B5B]/15 ring-1 ring-[#9B7B5B]/40"
                                              : isPast
                                                ? "bg-[#2D2C2E]/50 hover:bg-[#2D2C2E]"
                                                : "bg-[#2D2C2E]/30 hover:bg-[#2D2C2E]"
                                          )}
                                        >
                                          <div className="flex items-center gap-2">
                                            <span className={cn(
                                              "text-[11px] font-mono shrink-0",
                                              isActive ? "text-[#9B7B5B]" : "text-[#6A6865]"
                                            )}>
                                              {fmtTime(tip.timestamp)}
                                            </span>
                                            <span className={cn(
                                              "text-xs font-medium truncate",
                                              isActive ? "text-[#E8E6E3]" : isPast ? "text-[#8A8885]" : "text-[#E8E6E3]"
                                            )}>
                                              {tip.title}
                                            </span>
                                          </div>
                                          {tip.message && (
                                            <p className={cn(
                                              "text-[11px] mt-1 line-clamp-3 leading-relaxed",
                                              isActive ? "text-[#8A8885]" : "text-[#6A6865]"
                                            )}>
                                              {tip.message}
                                            </p>
                                          )}
                                        </button>
                                      );
                                    })}
                                </div>
                              </div>
                            ) : null}
                          </div>
                        ) : (
                          <div className="text-center py-3">
                            <p className="text-[10px] text-[#6A6865] mb-2">Detect forehand & backhand strokes</p>
                            <button
                              onClick={() => strokeMutation.mutate()}
                              disabled={strokeMutation.isPending}
                              className="text-xs px-3 py-1.5 rounded-lg bg-[#9B7B5B] text-[#1E1D1F] hover:bg-[#8A6B4B] transition-colors disabled:opacity-50"
                            >
                              {strokeMutation.isPending ? (
                                <span className="flex items-center gap-1.5">
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                  Analyzing...
                                </span>
                              ) : (
                                "Analyze Strokes"
                              )}
                            </button>
                          </div>
                        )}
                      </>
                    )}

                    {/* ── Error / Empty states ── */}
                    {session?.status === "failed" && !hasPose ? (
                      <div className="text-center py-6">
                        <Activity className="w-6 h-6 text-[#C45C5C] mx-auto mb-3" />
                        <p className="text-xs text-[#C45C5C] mb-1">Pose analysis failed</p>
                        <p className="text-[10px] text-[#6A6865] mb-3">Something went wrong during processing.</p>
                        <button
                          onClick={() => setShowPlayerSelection(true)}
                          className="text-[10px] text-[#9B7B5B] hover:text-[#B8956D] transition-colors underline"
                        >
                          Retry with player selection
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              )}

              {/* Court 3D view — side panel synced to video */}
              {showCourt && (
                <div className="flex-1 min-h-0 rounded-xl overflow-hidden">
                  <BirdEyeView trajectoryData={session.trajectory_data} poseData={poseData} currentFrame={currentFrame} totalFrames={Math.floor(duration * fps)} isPlaying={isPlaying} />
                </div>
              )}

              {/* Analytics Dashboard — full-width panel */}
              {activeTab === "analytics" && (
                <div className="bg-background/60 dark:bg-content1/60 rounded-xl overflow-y-auto h-full">
                  <AnalyticsDashboard sessionId={gameId} onSeekToTime={handleAnalyticsSeek} playerName={firstPlayer?.name} />
                </div>
              )}

              {/* AI Chat removed — now in global sidebar */}
              </div>
              </div>
            </div>
          )}
        </div>
      </div>
      {/* YOLO Detection result modal */}
      {detection && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setDetectionResult(null)}>
          <div className="bg-[#282729] rounded-2xl max-w-lg w-full overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="p-4">
              <p className="text-sm font-medium text-[#E8E6E3] mb-1">
                {detection.detections.length > 0
                  ? `Detected ${detection.detections.length} ball${detection.detections.length > 1 ? "s" : ""}`
                  : "No balls detected"}
              </p>
              <p className="text-[10px] text-[#6A6865]">
                {detection.detections.length > 0
                  ? "Click a detection to track, or click manually on the video"
                  : "Try a different frame, or click manually on the ball in the video"}
              </p>
            </div>
            <div className="px-4">
              <img src={detection.preview_image} alt="YOLO detections" className="w-full rounded-lg" />
            </div>
            {detection.detections.length > 0 && (
              <div className="p-4 space-y-2">
                {detection.detections.map((det, i) => (
                  <button
                    key={i}
                    onClick={() => handleConfirmDetection(det)}
                    className="w-full flex items-center justify-between p-2.5 rounded-lg bg-[#1E1D1F] hover:bg-[#363436] transition-colors text-left"
                  >
                    <span className="text-xs text-[#E8E6E3]">
                      {det.class_name} — {det.size[0]}x{det.size[1]}px
                    </span>
                    <span className="text-[10px] text-[#9B7B5B] font-medium">{(det.confidence * 100).toFixed(0)}%</span>
                  </button>
                ))}
              </div>
            )}
            <div className="p-4 flex gap-3">
              <button onClick={() => setDetectionResult(null)} className="flex-1 py-2 rounded-lg text-xs text-[#8A8885] hover:bg-[#2D2C2E] transition-colors">
                Cancel
              </button>
              <button onClick={() => { setDetectionResult(null); setTrackingMode(true); }} className="flex-1 py-2 rounded-lg text-xs text-[#E8E6E3] border border-[#363436] hover:border-[#9B7B5B] transition-colors">
                Click Manually
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clip Selector Modal */}
      {showClipSelector && session?.video_path && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="relative w-full max-w-3xl mx-4 rounded-2xl bg-[#1C1A19] border border-[#363436] shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#363436]">
              <div className="flex items-center gap-2">
                <Scissors className="w-4 h-4 text-[#9B7B5B]" />
                <span className="text-sm font-medium text-[#E8E6E3]">Create Clip</span>
              </div>
              <button
                onClick={() => setShowClipSelector(false)}
                className="p-1 rounded hover:bg-[#2D2C2E] transition-colors"
              >
                <X className="w-4 h-4 text-[#8A8885]" />
              </button>
            </div>
            {/* Clip selector body */}
            <div className="p-4">
              <ClipSelector
                videoUrl={session.video_path}
                duration={duration}
                initialStartTime={clipPrefill.startTime}
                initialEndTime={clipPrefill.endTime}
                onClipSelect={handleClipSelect}
                onAnalyze={(start, end) => handleClipSelect(start, end)}
                onCancel={() => setShowClipSelector(false)}
                maxClipDuration={45}
                mode="both"
                clipLoading={clipLoading}
              />
            </div>
          </div>
        </div>
      )}

    </>
  );
}
