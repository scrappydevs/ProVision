"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useSession, useTrackObject, useUpdateSession } from "@/hooks/useSessions";
import { usePoseAnalysis } from "@/hooks/usePoseData";
import { useStrokeSummary, useAnalyzeStrokes } from "@/hooks/useStrokeData";
import { useQueryClient } from "@tanstack/react-query";
import { sessionKeys } from "@/hooks/useSessions";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft, Crosshair, Loader2, ChevronRight, Play, Pause,
  SkipBack, SkipForward, Volume2, VolumeX, Activity, Sparkles, LayoutGrid,
  X, Send, Users, BarChart3, Bug, Copy, Check, RefreshCw,
} from "lucide-react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";
import {
  TrajectoryPoint,
  aiChat,
  detectBalls,
  BallDetection,
  trackWithTrackNet,
  detectPoses,
  PersonPose,
  Stroke,
  getDebugFrame,
} from "@/lib/api";
import { generateTipsFromStrokes } from "@/lib/tipGenerator";
import { PlayerSelection } from "@/components/viewer/PlayerSelection";
import { VideoTips, type VideoTip } from "@/components/viewer/VideoTips";

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

type TabId = "pose" | "track" | "court" | "ai" | "analytics";

const tabs: { id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "pose", label: "Pose", icon: Activity },
  { id: "track", label: "Track", icon: Crosshair },
  { id: "court", label: "Court", icon: LayoutGrid },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "ai", label: "AI", icon: Sparkles },
];

const PLAYER_COLORS = [
  { name: "Player 1", color: "#9B7B5B", rgb: "155, 123, 91" },
  { name: "Player 2", color: "#5B9B7B", rgb: "91, 155, 123" },
];

interface ChatMessage { role: "user" | "assistant" | "tool"; content: string; toolName?: string; }

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
  const [selectedPersonId, setSelectedPersonId] = useState<number | null>(null);
  const [isDetectingPose, setIsDetectingPose] = useState(false);
  const lastPoseFrame = useRef(-1);
  const [detectionResult, setDetectionResult] = useState<{ detections: BallDetection[]; preview_image: string; frame: number } | null>(null);
  const [showPoseOverlay, setShowPoseOverlay] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>("pose");
  const [showPlayerOverlay, setShowPlayerOverlay] = useState(false);
  const [playerSelectMode, setPlayerSelectMode] = useState(false);
  const [segmentedPlayers, setSegmentedPlayers] = useState<Array<{ id: number; name: string; color: string; rgb: string; visible: boolean; maskArea: number; clickX: number; clickY: number }>>([]);

  // AI Chat state
  const [aiOpen, setAiOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { role: "assistant", content: "I'm your AI sports analyst. Ask me about ball trajectory, spin, technique, or anything about this game." },
  ]);
  const [isAiThinking, setIsAiThinking] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const videoViewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerCanvasRef = useRef<HTMLCanvasElement>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(true);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [videoFps, setVideoFps] = useState(30);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [panelWidth, setPanelWidth] = useState(320);
  const [videoDisplayWidth, setVideoDisplayWidth] = useState<number | null>(null);
  const isResizing = useRef(false);
  const [activeTip, setActiveTip] = useState<VideoTip | null>(null);
  const [tipPausedVideo, setTipPausedVideo] = useState(false);

  const [showPlayerSelection, setShowPlayerSelection] = useState(false);
  const playerSelectionAutoOpened = useRef(false);
  const hasAutoSeeked = useRef(false);

  // Debug mode state
  const [debugMode, setDebugMode] = useState(false);
  const [debugLog, setDebugLog] = useState<Array<{ label: string; [key: string]: unknown }>>([]);
  const [debugLoading, setDebugLoading] = useState(false);
  const [debugFlash, setDebugFlash] = useState<string | null>(null);
  const [debugCopied, setDebugCopied] = useState(false);

  const { data: session, isLoading } = useSession(gameId);
  const { data: poseData } = usePoseAnalysis(gameId);
  const { data: strokeSummary } = useStrokeSummary(gameId);
  const trackMutation = useTrackObject(gameId);
  const strokeMutation = useAnalyzeStrokes(gameId);
  const updateSessionMutation = useUpdateSession(gameId);

  const hasPose = !!session?.pose_video_path;
  const hasStrokes = !!strokeSummary?.total_strokes;
  const hasTrajectory = !!(session?.trajectory_data?.frames?.length);
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

  // Generate video tips from stroke data
  // Generate video tips from stroke data (or test tips if no strokes)
  const videoTips = useMemo(() => {
    const tips = generateTipsFromStrokes(strokeSummary?.strokes || [], fps);
    console.log('[VideoTips] Generated tips:', {
      strokeCount: strokeSummary?.strokes?.length || 0,
      tipCount: tips.length,
      tips: tips.map(t => ({ id: t.id, timestamp: t.timestamp, title: t.title }))
    });
    return tips;
  }, [strokeSummary?.strokes, fps]);

  const tipSeekTime = useMemo(() => {
    if (!tipParam || videoTips.length === 0) return null;
    const match = videoTips.find((tip) =>
      tip.id.toLowerCase() === tipParam || tip.title.toLowerCase().includes(tipParam)
    );
    return match?.seekTime ?? match?.timestamp ?? null;
  }, [tipParam, videoTips]);

  const autoSeekTime = startTimeParam ?? tipSeekTime;
  const shouldAutoPlay = startTimeParam !== null && startTimeParam !== undefined;

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
        video.play().catch(() => undefined);
        setIsPlaying(true);
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
  }, [autoSeekTime, videoUrl, shouldAutoPlay]);

  // Handle tip state changes - freeze video when tip appears
  const handleTipChange = useCallback((tip: VideoTip | null) => {
    setActiveTip(tip);

    if (!videoRef.current) return;

    if (tip && !videoRef.current.paused) {
      // Tip appeared - pause video
      videoRef.current.pause();
      setIsPlaying(false);
      setTipPausedVideo(true);
    } else if (!tip && tipPausedVideo) {
      // Tip disappeared and we paused it - resume
      videoRef.current.play();
      setIsPlaying(true);
      setTipPausedVideo(false);
    }
  }, [tipPausedVideo]);

  const showTrack = activeTab === "track";
  const showCourt = activeTab === "court";
  const showAnalytics = activeTab === "analytics";
  const showSidePanel =
    showTrack || showCourt || activeTab === "pose" || showAnalytics || aiOpen;

  const updateVideoDisplayWidth = useCallback(() => {
    const viewport = videoViewportRef.current;
    const video = videoRef.current;
    if (!viewport) return;

    const containerWidth = viewport.clientWidth;
    const containerHeight = viewport.clientHeight;
    let nextWidth = containerWidth;

    if (video?.videoWidth && video?.videoHeight && containerHeight > 0) {
      const videoAspect = video.videoWidth / video.videoHeight;
      const containerAspect = containerWidth / containerHeight;
      nextWidth = containerAspect > videoAspect ? containerHeight * videoAspect : containerWidth;
    }

    const rounded = Math.max(0, Math.round(nextWidth));
    setVideoDisplayWidth((prev) => (prev === rounded ? prev : rounded));
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

  // Get current stroke data for visual overlay
  const currentStroke = useMemo(() => {
    if (!activeTip || !strokeSummary?.strokes) return null;

    // Extract stroke ID from tip ID (format: "stroke-{id}-contact" or "stroke-{id}-follow")
    const match = activeTip.id.match(/stroke-([^-]+)-/);
    if (!match) return null;

    const strokeId = match[1];
    return strokeSummary.strokes.find(s => s.id === strokeId) || null;
  }, [activeTip, strokeSummary?.strokes]);
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

  // Keyboard shortcuts for debug mode
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore if typing in an input/textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === "d" || e.key === "D") {
        e.preventDefault();
        setDebugMode(prev => !prev);
        return;
      }

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
      if ("requestVideoFrameCallback" in video) {
        vfcId = (video as HTMLVideoElement & { requestVideoFrameCallback: (cb: any) => number })
          .requestVideoFrameCallback(frameLoop);
      } else {
        rafId = requestAnimationFrame(() => frameLoop());
      }
    };
    const onPause = () => {
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

    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("loadedmetadata", onMeta);
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
      video.removeEventListener("timeupdate", onSeeked);
    };
  }, [videoUrl, frameFromTime]);

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

    // Trail: fading green line connecting recent positions
    if (visibleTrajectoryPoints.length >= 2) {
      const recent = visibleTrajectoryPoints.slice(-40);
      for (let i = 1; i < recent.length; i++) {
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
    // Exact match first, then closest within window
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
  }, [visibleTrajectoryPoints, trajectoryFrameMap, currentFrame, hasTrajectory]);

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

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMessages]);

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
  // Video dimensions for denormalizing stored pose keypoints
  const videoW = session?.trajectory_data?.video_info?.width ?? 1280;
  const videoH = session?.trajectory_data?.video_info?.height ?? 828;
  const hasStoredPose = !!(poseData?.frames?.length);

  // Convert stored pose data to PersonPose[] for the current frame
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
  }, [hasStoredPose, poseData, currentFrame, videoW, videoH]);

  // Use stored data when available, otherwise fall back to live detection
  useEffect(() => {
    if (showPoseOverlay && storedPersonsForFrame.length > 0) {
      setDetectedPersons(storedPersonsForFrame);
      if (selectedPersonId === null && storedPersonsForFrame.length > 0) {
        setSelectedPersonId(storedPersonsForFrame[0].id);
      }
    }
  }, [showPoseOverlay, storedPersonsForFrame, selectedPersonId]);

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
        if (res.data.persons.length > 0 && selectedPersonId === null) {
          setSelectedPersonId(res.data.persons[0].id);
        }
      })
      .catch((err) => console.error("Pose detection failed:", err))
      .finally(() => setIsDetectingPose(false));
  }, [gameId, currentFrame, isDetectingPose, selectedPersonId, hasStoredPose]);

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
      const isSelected = person.id === selectedPersonId;
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
      ctx.fillText(`P${person.id}`, x1 + 4, y1 - 6);

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
  }, [detectedPersons, showPoseOverlay, selectedPersonId, SKELETON_CONNECTIONS, PERSON_COLORS]);

  const handleTrackNetTrack = useCallback(() => {
    setIsTracking(true);
    trackWithTrackNet(gameId)
      .then((res) => {
        const tracked = res.data.frames_tracked ?? 0;
        if (tracked > 0) {
          queryClient.invalidateQueries({ queryKey: sessionKeys.detail(gameId) });
        } else {
          // TrackNet found nothing — fall back to YOLO+SAM2
          handleAutoDetect();
        }
      })
      .catch(() => {
        // TrackNet failed — fall back to YOLO+SAM2
        handleAutoDetect();
      })
      .finally(() => setIsTracking(false));
  }, [gameId, queryClient]);

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

  const togglePlay = useCallback(() => { if (isPlaying) videoRef.current?.pause(); else videoRef.current?.play(); setIsPlaying((p) => !p); }, [isPlaying]);
  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => { const t = parseFloat(e.target.value); if (videoRef.current) videoRef.current.currentTime = t; setCurrentTime(t); }, []);
  const skipFrames = useCallback((n: number) => { const t = Math.max(0, Math.min(duration, currentTime + n / fps)); if (videoRef.current) videoRef.current.currentTime = t; }, [duration, currentTime, fps]);
  const fmtTime = (t: number) => `${Math.floor(t / 60)}:${Math.floor(t % 60).toString().padStart(2, "0")}`;
  const handleTipSeek = useCallback((tip: VideoTip) => {
    if (!videoRef.current) return;
    const targetTime = tip.seekTime ?? tip.timestamp;
    videoRef.current.currentTime = targetTime;
    videoRef.current.pause();
    setIsPlaying(false);
    setTipPausedVideo(false);
  }, []);

  const handleTabClick = useCallback((tabId: TabId) => {
    setActiveTab(tabId);
    setPlayerSelectMode(false);
    if (tabId === "ai") { setAiOpen((o) => !o); return; }
    setAiOpen(false);
    if (tabId === "pose") {
      setShowPoseOverlay((p) => !p);
      if (!showPoseOverlay) handleDetectPose(); // detect on first enable
    }
    if (tabId === "track" && !hasTrajectory) handleTrackNetTrack();
  }, []);

  const handleChatSend = useCallback(async () => {
    if (!chatInput.trim() || isAiThinking) return;
    const userMsg = chatInput.trim();
    setChatInput("");
    setChatMessages((m) => [...m, { role: "user", content: userMsg }]);
    setIsAiThinking(true);
    try {
      const history = chatMessages.filter((m) => m.role === "user" || m.role === "assistant").map((m) => ({ role: m.role, content: m.content }));
      const response = await aiChat({ message: userMsg, session_id: gameId, history });
      const newMessages: ChatMessage[] = [];
      if (response.data.tool_calls?.length) {
        for (const tc of response.data.tool_calls) {
          newMessages.push({ role: "tool", toolName: tc.name, content: tc.result.slice(0, 80) + (tc.result.length > 80 ? "..." : "") });
        }
      }
      newMessages.push({ role: "assistant", content: response.data.response });
      setChatMessages((m) => [...m, ...newMessages]);
    } catch {
      setChatMessages((m) => [...m, { role: "assistant", content: "Couldn't process request. Check backend is running with ANTHROPIC_API_KEY." }]);
    }
    setIsAiThinking(false);
  }, [chatInput, isAiThinking, chatMessages, gameId]);

  // Auto-widen panel for court view and analytics
  useEffect(() => {
    if (showCourt) setPanelWidth(480);
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

  return (
    <>
      <div className="h-[calc(100vh-7rem)] flex flex-col overflow-hidden">
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

        {/* Main area */}
        <div className="flex gap-3 flex-1 min-h-0">
          {/* Left: Video or Court (full area) */}
          <div className={cn("flex flex-col min-h-0", showSidePanel ? "flex-1 min-w-0" : "w-full")}>
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
                {videoUrl && <video ref={videoRef} src={videoUrl} className="w-full h-full object-contain" muted={isMuted} playsInline />}
                <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 10 }} />
                <canvas ref={playerCanvasRef} className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 20 }} />
                
                {/* Video Tips - PlayVision AI style overlays */}
                <VideoTips
                  currentTime={currentTime}
                  tips={videoTips}
                  isPlaying={isPlaying}
                />
              </div>

              {/* Debug mode toggle button — top-right of video */}
              {hasPose && (
                <button
                  onClick={() => setDebugMode(prev => !prev)}
                  className={cn(
                    "absolute top-2 right-2 z-30 p-1.5 rounded-lg transition-all",
                    debugMode
                      ? "bg-[#C45C5C]/20 text-[#C45C5C] ring-1 ring-[#C45C5C]/40"
                      : "bg-black/30 text-[#6A6865] hover:text-[#E8E6E3] hover:bg-black/50"
                  )}
                  title="Toggle stroke debug mode (D)"
                >
                  <Bug className="w-3.5 h-3.5" />
                </button>
              )}

              {/* Debug floating bar */}
              {debugMode && (
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
                    const isOn = (tab.id === "pose" && showPoseOverlay) || (tab.id === "track" && trackingMode) || (tab.id === "analytics" && activeTab === "analytics") || (tab.id === "ai" && aiOpen);
                    return (
                      <button key={tab.id} onClick={() => handleTabClick(tab.id)} className={cn("glass-tab", (isActive || isOn) && "glass-tab-active")}>
                        <Icon className="w-3.5 h-3.5" />
                        <span>{tab.label}</span>
                        {isOn && <div className="w-1.5 h-1.5 rounded-full bg-[#9B7B5B]" />}
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
                <input type="range" min={0} max={duration || 100} step={0.01} value={currentTime} onChange={handleSeek}
                  className="flex-1 h-1 bg-[#363436] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:bg-[#9B7B5B] [&::-webkit-slider-thumb]:rounded-full" />
                <span className="text-[10px] text-[#6A6865] w-10 text-right">{fmtTime(duration)}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => skipFrames(-10)}><SkipBack className="w-3 h-3" /></Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={togglePlay}>{isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}</Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => skipFrames(10)}><SkipForward className="w-3 h-3" /></Button>
                </div>
                <span className="text-[10px] text-[#6A6865]">Frame {currentFrame}</span>
                <button
                  onClick={() => {
                    const rates = [0.25, 0.5, 1, 1.5, 2];
                    const next = rates[(rates.indexOf(playbackRate) + 1) % rates.length];
                    setPlaybackRate(next);
                    if (videoRef.current) videoRef.current.playbackRate = next;
                  }}
                  className="text-[10px] px-1.5 py-0.5 rounded text-[#9B7B5B] hover:bg-[#2D2C2E] transition-colors font-mono"
                >
                  {playbackRate}x
                </button>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setIsMuted((m) => !m)}>{isMuted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}</Button>
              </div>
            </div>
            </div>
          </div>

          {/* Right Panel — Track results, Players, Court, Pose, or AI Chat */}
          {showSidePanel && (
            <div className="shrink-0 flex min-h-0 overflow-hidden" style={{ width: panelWidth }}>
              {/* Resize handle */}
              <div
                onMouseDown={handleResizeStart}
                className="w-1.5 shrink-0 cursor-col-resize hover:bg-[#9B7B5B]/30 active:bg-[#9B7B5B]/50 transition-colors rounded-full self-stretch"
              />
              <div className="flex-1 flex min-h-0 overflow-hidden">
                <div className="w-full h-full max-w-[calc(100%-8px)] mx-auto flex flex-col min-h-0 overflow-hidden">
                  {/* 3D Ball Trajectory Visualization */}
                  {activeTab === "track" && !aiOpen && (
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
                      {isProcessing ? (
                        <>
                          <Loader2 className="w-6 h-6 text-[#9B7B5B] mx-auto mb-3 animate-spin" />
                          <p className="text-sm text-[#E8E6E3] font-medium">Tracking ball...</p>
                          <p className="text-[10px] text-[#8A8885] mt-1.5">Trajectory will appear when ready</p>
                        </>
                      ) : (
                        <>
                          <Crosshair className="w-7 h-7 text-[#9B7B5B] mx-auto mb-3" />
                          <p className="text-sm text-[#E8E6E3] font-medium mb-1">Ready to track</p>
                          <p className="text-xs text-[#8A8885]">Click Track in the toolbar to detect ball trajectory</p>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Pose analysis panel */}
              {activeTab === "pose" && showPoseOverlay && !aiOpen && (
                <div className="glass-context rounded-xl flex flex-col h-full overflow-hidden">
                  <div className="px-3 py-2.5 border-b border-[#363436]/30 flex items-center justify-between">
                    <span className="text-xs font-medium text-[#E8E6E3]">Pose & Strokes</span>
                    {(isDetectingPose || isPoseProcessing) && <Loader2 className="w-3 h-3 text-[#9B7B5B] animate-spin" />}
                  </div>
                  <div className="flex-1 overflow-y-auto p-2 space-y-2">
                    {showPlayerSelection && (
                      <PlayerSelection
                        sessionId={gameId}
                        variant="inline"
                        onClose={() => setShowPlayerSelection(false)}
                        onAnalysisStarted={() => {
                          queryClient.invalidateQueries({ queryKey: sessionKeys.detail(gameId) });
                        }}
                      />
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
                              "text-sm font-medium capitalize",
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
                        ) : (
                          <p className="text-[10px] text-[#6A6865] text-center">Play video to see live stroke detection</p>
                        )}
                      </div>
                    )}

                    {/* ── Stroke Summary Stats ── */}
                    {hasPose && !isPoseProcessing && (
                      <>
                        {hasStrokes ? (
                          <div className="space-y-2">
                            {/* Camera facing toggle + Re-analyze */}
                            <div className="flex items-center justify-between">
                              <p className="text-[10px] text-[#6A6865] uppercase tracking-wider">Stroke Breakdown</p>
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
                                  className="flex items-center gap-1 text-[10px] text-[#6A6865] hover:text-[#E8E6E3] transition-colors"
                                  title="Camera orientation: auto-detect, facing toward camera, or facing away"
                                >
                                  <span>Cam:</span>
                                  <span className={`px-1.5 py-0.5 rounded font-medium ${
                                    (session?.camera_facing ?? "auto") === "auto"
                                      ? "bg-[#9B7B5B]/20 text-[#9B7B5B]"
                                      : (session?.camera_facing ?? "auto") === "toward"
                                      ? "bg-[#6B8E6B]/20 text-[#6B8E6B]"
                                      : "bg-[#7B8ECE]/20 text-[#7B8ECE]"
                                  }`}>
                                    {(session?.camera_facing ?? "auto") === "auto" ? "Auto" : (session?.camera_facing ?? "auto") === "toward" ? "Front" : "Back"}
                                  </span>
                                </button>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-1.5">
                              <div className="p-2 rounded-lg bg-[#1E1D1F] text-center">
                                <p className="text-lg font-light text-[#9B7B5B]">{strokeSummary?.forehand_count ?? 0}</p>
                                <p className="text-[9px] text-[#6A6865]">Forehand</p>
                              </div>
                              <div className="p-2 rounded-lg bg-[#1E1D1F] text-center">
                                <p className="text-lg font-light text-[#5B9B7B]">{strokeSummary?.backhand_count ?? 0}</p>
                                <p className="text-[9px] text-[#6A6865]">Backhand</p>
                              </div>
                            </div>
                            {/* FH/BH ratio bar */}
                            {(strokeSummary?.total_strokes ?? 0) > 0 && (
                              <div>
                                <div className="flex h-1.5 rounded-full overflow-hidden bg-[#363436]">
                                  <div className="bg-[#9B7B5B] transition-all" style={{ width: `${((strokeSummary?.forehand_count ?? 0) / (strokeSummary?.total_strokes ?? 1)) * 100}%` }} />
                                  <div className="bg-[#5B9B7B] transition-all" style={{ width: `${((strokeSummary?.backhand_count ?? 0) / (strokeSummary?.total_strokes ?? 1)) * 100}%` }} />
                                </div>
                                <div className="flex justify-between mt-1">
                                  <span className="text-[9px] text-[#9B7B5B]">FH {Math.round(((strokeSummary?.forehand_count ?? 0) / (strokeSummary?.total_strokes ?? 1)) * 100)}%</span>
                                  <span className="text-[9px] text-[#5B9B7B]">BH {Math.round(((strokeSummary?.backhand_count ?? 0) / (strokeSummary?.total_strokes ?? 1)) * 100)}%</span>
                                </div>
                              </div>
                            )}
                            {/* Form metrics */}
                            <div className="space-y-1">
                              <div className="flex justify-between text-[10px]">
                                <span className="text-[#8A8885]">Avg Form</span>
                                <span className="text-[#E8E6E3] font-mono">{strokeSummary?.average_form_score?.toFixed(1)}</span>
                              </div>
                              <div className="flex justify-between text-[10px]">
                                <span className="text-[#8A8885]">Best Form</span>
                                <span className="text-[#9B7B5B] font-mono">{strokeSummary?.best_form_score?.toFixed(1)}</span>
                              </div>
                              <div className="flex justify-between text-[10px]">
                                <span className="text-[#8A8885]">Consistency</span>
                                <span className="text-[#E8E6E3] font-mono">{strokeSummary?.consistency_score?.toFixed(1)}</span>
                              </div>
                            </div>

                            {/* Stroke timeline — each stroke as a mini pill */}
                            <div>
                              <p className="text-[10px] text-[#6A6865] uppercase tracking-wider mb-1.5">Stroke Timeline</p>
                              <div className="flex flex-wrap gap-1">
                                {strokeSummary?.strokes.map((s, i) => {
                                  const isActive = activeStroke?.id === s.id;
                                  const color = s.stroke_type === "forehand" ? "#9B7B5B"
                                    : s.stroke_type === "backhand" ? "#5B9B7B"
                                    : "#8A8885";
                                  return (
                                    <button
                                      key={s.id}
                                      onClick={() => {
                                        if (videoRef.current) videoRef.current.currentTime = s.peak_frame / fps;
                                      }}
                                      className={cn(
                                        "px-1.5 py-0.5 rounded text-[9px] font-medium transition-all cursor-pointer",
                                        isActive ? "ring-1 scale-110" : "opacity-70 hover:opacity-100"
                                      )}
                                      style={{
                                        backgroundColor: `${color}20`,
                                        color,
                                        ...(isActive ? { ringColor: color } : {}),
                                      }}
                                      title={`${s.stroke_type} — Frame ${s.peak_frame} — Form ${s.form_score.toFixed(0)}`}
                                    >
                                      {s.stroke_type === "forehand" ? "FH" : s.stroke_type === "backhand" ? "BH" : "?"}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>

                            {/* All Insights throughout the video */}
                            {videoTips.length > 0 && (
                              <div>
                                <p className="text-[10px] text-[#6A6865] uppercase tracking-wider mb-1.5">
                                  Insights ({videoTips.filter(t => !t.id.includes("follow") && !t.id.includes("summary")).length})
                                </p>
                                <div className="space-y-1 max-h-[200px] overflow-y-auto pr-1">
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
                                            "w-full text-left p-2 rounded-lg transition-all",
                                            isActive
                                              ? "bg-[#9B7B5B]/15 ring-1 ring-[#9B7B5B]/40"
                                              : isPast
                                                ? "bg-[#2D2C2E]/50 hover:bg-[#2D2C2E]"
                                                : "bg-[#2D2C2E]/30 hover:bg-[#2D2C2E]"
                                          )}
                                        >
                                          <div className="flex items-center gap-2">
                                            <span className={cn(
                                              "text-[10px] font-mono shrink-0",
                                              isActive ? "text-[#9B7B5B]" : "text-[#6A6865]"
                                            )}>
                                              {fmtTime(tip.timestamp)}
                                            </span>
                                            <span className={cn(
                                              "text-[11px] truncate",
                                              isActive ? "text-[#E8E6E3]" : isPast ? "text-[#8A8885]" : "text-[#E8E6E3]"
                                            )}>
                                              {tip.title}
                                            </span>
                                          </div>
                                          {tip.message && (
                                            <p className={cn(
                                              "text-[10px] mt-1 line-clamp-2",
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
                            )}
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

                    {/* ── Divider ── */}
                    {hasPose && !isPoseProcessing && detectedPersons.length > 0 && (
                      <div className="border-t border-[#363436]/30 pt-2 mt-1">
                        <p className="text-[10px] text-[#6A6865] uppercase tracking-wider mb-1.5">Pose Estimation</p>
                      </div>
                    )}

                    {/* ── Processing / Error / Empty states ── */}
                    {isPoseProcessing ? (
                      <div className="text-center py-6">
                        <Loader2 className="w-6 h-6 text-[#9B7B5B] mx-auto mb-3 animate-spin" />
                        <p className="text-xs text-[#E8E6E3] mb-1">Pose estimation running...</p>
                        <p className="text-[10px] text-[#6A6865]">Analyzing player movements frame by frame.</p>
                        <p className="text-[10px] text-[#6A6865] mt-1">This may take a minute for longer videos.</p>
                        {session?.selected_player && (
                          <p className="text-[10px] text-[#9B7B5B] mt-2">Tracking Player {session.selected_player.player_idx + 1}</p>
                        )}
                      </div>
                    ) : session?.status === "failed" && !hasPose ? (
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
                    ) : detectedPersons.length === 0 && !isDetectingPose && !hasPose ? (
                      <div className="text-center py-6">
                        <Activity className="w-5 h-5 text-[#363436] mx-auto mb-2" />
                        <p className="text-xs text-[#6A6865] mb-3">No pose data yet</p>
                        <button
                          onClick={() => setShowPlayerSelection(true)}
                          className="text-[10px] text-[#9B7B5B] hover:text-[#B8956D] transition-colors underline"
                        >
                          Run pose estimation
                        </button>
                      </div>
                    ) : null}

                    {/* ── Per-person pose metrics ── */}
                    {!isPoseProcessing && detectedPersons.map((person) => {
                      const isSelected = person.id === selectedPersonId;
                      const color = ["#9B7B5B", "#5B9B7B", "#7B5B9B", "#C8B464"][(person.id - 1) % 4];
                      return (
                        <button
                          key={person.id}
                          onClick={() => setSelectedPersonId(isSelected ? null : person.id)}
                          className={`w-full p-2.5 rounded-lg text-left transition-colors ${
                            isSelected ? "bg-[#363436]/60 ring-1" : "bg-[#1E1D1F] hover:bg-[#363436]/30"
                          }`}
                          style={isSelected ? { borderColor: color, borderWidth: 1 } : undefined}
                        >
                          <div className="flex items-center gap-2 mb-2">
                            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
                            <span className="text-xs font-medium text-[#E8E6E3]">Player {person.id}</span>
                            <span className="text-[10px] text-[#6A6865] ml-auto">{(person.confidence * 100).toFixed(0)}%</span>
                          </div>
                          {isSelected && (
                            <div className="space-y-3 mt-2">
                              {/* Overall Detection Quality */}
                              <div>
                                <div className="flex items-center justify-between mb-1">
                                  <p className="text-[10px] text-[#6A6865] uppercase tracking-wider">Detection Quality</p>
                                  <span className="text-[10px] font-medium text-[#E8E6E3]">{(person.confidence * 100).toFixed(0)}%</span>
                                </div>
                                <div className="h-1.5 bg-[#363436] rounded-full overflow-hidden">
                                  <div 
                                    className="h-full rounded-full transition-all"
                                    style={{ 
                                      width: `${person.confidence * 100}%`,
                                      backgroundColor: color,
                                    }}
                                  />
                                </div>
                              </div>

                              {/* Keypoint Confidence Bars */}
                              <div>
                                <p className="text-[10px] text-[#6A6865] uppercase tracking-wider mb-1.5">Keypoint Confidence</p>
                                <div className="space-y-1">
                                  {person.keypoints
                                    .filter((k) => k.conf > 0.3)
                                    .sort((a, b) => b.conf - a.conf)
                                    .slice(0, 8)
                                    .map((kp) => {
                                      const conf = kp.conf * 100;
                                      const barColor = conf >= 90 ? '#5B9B7B' : conf >= 70 ? color : '#8A8885';
                                      return (
                                        <div key={kp.name}>
                                          <div className="flex items-center justify-between mb-0.5">
                                            <span className="text-[9px] text-[#8A8885] capitalize truncate">
                                              {kp.name.replace(/_/g, " ")}
                                            </span>
                                            <span className="text-[9px] text-[#E8E6E3] font-mono ml-2">
                                              {conf.toFixed(0)}%
                                            </span>
                                          </div>
                                          <div className="h-1 bg-[#363436] rounded-full overflow-hidden">
                                            <div 
                                              className="h-full rounded-full transition-all"
                                              style={{ 
                                                width: `${conf}%`,
                                                backgroundColor: barColor,
                                              }}
                                            />
                                          </div>
                                        </div>
                                      );
                                    })}
                                </div>
                              </div>

                              {/* Body Dimensions */}
                              <div className="pt-2 border-t border-[#363436]/30">
                                <p className="text-[10px] text-[#6A6865] uppercase tracking-wider mb-1.5">Body Metrics</p>
                                <div className="grid grid-cols-2 gap-2">
                                  <div className="bg-[#1E1D1F] rounded-lg p-2">
                                    <p className="text-[9px] text-[#6A6865] mb-0.5">Width</p>
                                    <p className="text-xs font-medium text-[#E8E6E3]">
                                      {(person.bbox[2] - person.bbox[0]).toFixed(0)}px
                                    </p>
                                  </div>
                                  <div className="bg-[#1E1D1F] rounded-lg p-2">
                                    <p className="text-[9px] text-[#6A6865] mb-0.5">Height</p>
                                    <p className="text-xs font-medium text-[#E8E6E3]">
                                      {(person.bbox[3] - person.bbox[1]).toFixed(0)}px
                                    </p>
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Court 3D view — side panel synced to video */}
              {showCourt && !aiOpen && (
                <div className="flex-1 min-h-0 rounded-xl overflow-hidden">
                  <BirdEyeView trajectoryData={session.trajectory_data} poseData={poseData} currentFrame={currentFrame} totalFrames={Math.floor(duration * fps)} isPlaying={isPlaying} />
                </div>
              )}

              {/* Analytics Dashboard — full-width panel */}
              {activeTab === "analytics" && !aiOpen && (
                <div className="bg-background/60 dark:bg-content1/60 rounded-xl overflow-y-auto h-full">
                  <AnalyticsDashboard sessionId={gameId} />
                </div>
              )}

              {/* AI Chat — inline right panel */}
              {aiOpen && (
                <div className="h-full p-1">
                  <div className="relative h-full rounded-2xl border border-foreground/5 shadow-[0_4px_16px_rgba(0,0,0,0.12)] flex flex-col overflow-hidden">
                    <div className="absolute inset-0 pointer-events-none">
                      <div className="absolute inset-0 bg-[url('/background.jpeg')] bg-cover bg-center opacity-20" />
                      <div className="absolute inset-0 bg-content1/75 backdrop-blur-xl" />
                    </div>

                    <div className="relative z-10 flex items-center justify-between px-4 py-3 border-b border-foreground/10">
                      <div>
                        <p className="text-sm font-semibold text-foreground/90">AI Analyst</p>
                        <p className="text-[10px] text-foreground/50">Ask anything about this game</p>
                      </div>
                      <button
                        onClick={() => setAiOpen(false)}
                        className="w-7 h-7 rounded-full hover:bg-content2 flex items-center justify-center text-foreground/50 hover:text-foreground transition-colors"
                        aria-label="Close AI analyst"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Messages */}
                    <div className="relative z-10 flex-1 overflow-y-auto p-3 space-y-3">
                      {chatMessages.map((msg, i) => (
                        <div key={i} className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}>
                          {msg.role === "tool" ? (
                            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary/10 text-[10px] text-primary w-full">
                              <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                              <span className="font-mono truncate">{msg.toolName}</span>
                            </div>
                          ) : (
                            <div
                              className={cn(
                                "max-w-[90%] rounded-2xl px-3 py-2 text-xs leading-relaxed",
                                msg.role === "user"
                                  ? "bg-primary text-primary-foreground rounded-br-md"
                                  : "bg-content2 text-foreground rounded-bl-md"
                              )}
                            >
                              {msg.content.split("\n").map((line, j) => (
                                <p key={j} className={j > 0 ? "mt-1" : ""}>
                                  {line.split("**").map((part, k) =>
                                    k % 2 === 1 ? (
                                      <strong
                                        key={k}
                                        className={msg.role === "user" ? "font-semibold" : "text-primary font-medium"}
                                      >
                                        {part}
                                      </strong>
                                    ) : (
                                      part
                                    )
                                  )}
                                </p>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                      {isAiThinking && (
                        <div className="flex justify-start">
                          <div className="bg-content2 rounded-2xl rounded-bl-md px-4 py-3 flex items-center gap-2">
                            <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                            <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" style={{ animationDelay: "0.15s" }} />
                            <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" style={{ animationDelay: "0.3s" }} />
                          </div>
                        </div>
                      )}
                      <div ref={chatEndRef} />
                    </div>

                    {/* Input */}
                    <div className="relative z-10 border-t border-foreground/10 p-3">
                      <div className="flex items-center gap-2 bg-content2/70 rounded-xl px-3 py-1 focus-within:ring-1 focus-within:ring-primary/30 transition-all">
                        <input
                          type="text"
                          value={chatInput}
                          onChange={(e) => setChatInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleChatSend();
                          }}
                          placeholder="Ask about the game..."
                          className="flex-1 py-2 bg-transparent text-xs text-foreground placeholder:text-foreground/40 focus:outline-none"
                        />
                        <button
                          onClick={handleChatSend}
                          disabled={!chatInput.trim() || isAiThinking}
                          className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-primary-foreground disabled:opacity-20 hover:opacity-90 transition-all shrink-0"
                        >
                          <Send className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              </div>
              </div>
            </div>
          )}
        </div>

        {(isTracking || isDetecting) && (
          <div className="glass-context p-3.5 flex items-center gap-3 mt-2 shrink-0 bg-[#9B7B5B]/10">
            <Loader2 className="w-4 h-4 text-[#9B7B5B] animate-spin" />
            <span className="text-sm text-[#E8E6E3] font-medium">Tracking ball...</span>
          </div>
        )}
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

    </>
  );
}
