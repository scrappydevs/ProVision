"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession, useTrackObject } from "@/hooks/useSessions";
import { usePoseAnalysis } from "@/hooks/usePoseData";
import { useStrokeSummary, useAnalyzeStrokes } from "@/hooks/useStrokeData";
import { useQueryClient } from "@tanstack/react-query";
import { sessionKeys } from "@/hooks/useSessions";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardFooter, ScrollShadow, Chip, Spinner } from "@heroui/react";
import {
  ArrowLeft, Crosshair, Loader2, ChevronRight, Play, Pause,
  SkipBack, SkipForward, Volume2, VolumeX, Activity, Sparkles, LayoutGrid,
  X, Send, Users,
} from "lucide-react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";
import { TrajectoryPoint, Stroke, aiChat, detectBalls, BallDetection, trackWithTrackNet, detectPoses, PersonPose } from "@/lib/api";
import { AnimatePresence } from "framer-motion";
// PlayerSelection removed - pose estimation is auto-triggered on upload

const BirdEyeView = dynamic(
  () => import("@/components/viewer/BirdEyeView").then((m) => m.BirdEyeView),
  { ssr: false }
);

const ShotCard = dynamic(
  () => import("@/components/viewer/ShotCard").then((m) => m.ShotCard),
  { ssr: false }
);

type TabId = "pose" | "track" | "players" | "court" | "ai";

const tabs: { id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "pose", label: "Pose", icon: Activity },
  { id: "track", label: "Track", icon: Crosshair },
  { id: "players", label: "Players", icon: Users },
  { id: "court", label: "Court", icon: LayoutGrid },
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
  const [selectedStroke, setSelectedStroke] = useState<Stroke | null>(null);

  // AI Chat state
  const [aiOpen, setAiOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { role: "assistant", content: "I'm your AI sports analyst. Ask me about ball trajectory, spin, technique, or anything about this game." },
  ]);
  const [isAiThinking, setIsAiThinking] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
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
  const isResizing = useRef(false);

  // Player selection removed - pose auto-runs on upload
  // Player selection auto-open removed

  const { data: session, isLoading } = useSession(gameId);
  const { data: poseData } = usePoseAnalysis(gameId);
  const { data: strokeSummary } = useStrokeSummary(gameId);
  const trackMutation = useTrackObject(gameId);
  const strokeMutation = useAnalyzeStrokes(gameId);

  const hasPose = !!session?.pose_video_path;
  const hasStrokes = !!strokeSummary?.total_strokes;
  const hasTrajectory = !!(session?.trajectory_data?.frames?.length);
  // Pose processing: no pose_video_path yet AND status is processing
  const isPoseProcessing = session?.status === "processing" && !hasPose;
  // General processing for ball tracking / pending
  const isProcessing = session?.status === "processing" || session?.status === "pending";
  // Need pose: has video, no pose video yet, and not currently processing pose
  const needsPose = !!session?.video_path && !hasPose && !isPoseProcessing;

  const strokes = strokeSummary?.strokes ?? [];
  const sessionMaxVelocity = useMemo(
    () => (strokes.length > 0 ? Math.max(...strokes.map((s) => s.max_velocity)) : 1),
    [strokes]
  );
  const selectedStrokeIndex = useMemo(
    () => (selectedStroke ? strokes.findIndex((s) => s.id === selectedStroke.id) + 1 : 0),
    [selectedStroke, strokes]
  );

  // Auto-open removed - pose auto-runs on upload now

  // Player selection modal removed - pose auto-runs on upload

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

  const trajectoryFrameMap = useMemo(() => {
    if (!session?.trajectory_data?.frames) return new Map<number, TrajectoryPoint>();
    return new Map(session.trajectory_data.frames.map((f: TrajectoryPoint) => [f.frame, f]));
  }, [session?.trajectory_data]);

  const visibleTrajectoryPoints = useMemo(() => {
    if (!session?.trajectory_data?.frames) return [];
    return session.trajectory_data.frames.filter((f: TrajectoryPoint) => f.frame <= currentFrame);
  }, [session?.trajectory_data, currentFrame]);

  // Use FPS from trajectory video_info if available
  const fps = useMemo(() => {
    try {
      const td = session?.trajectory_data as unknown as { video_info?: { fps?: number } } | undefined;
      return td?.video_info?.fps || videoFps;
    } catch { return videoFps; }
  }, [session?.trajectory_data, videoFps]);

  // Video events — use RAF loop for smooth frame-accurate updates (like modelhealthdemo)
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let rafId: number;

    // RAF loop runs at ~60fps during playback for smooth overlay sync
    const rafLoop = () => {
      if (video && !video.paused) {
        setCurrentTime(video.currentTime);
        setCurrentFrame(Math.floor(video.currentTime * fps));
        rafId = requestAnimationFrame(rafLoop);
      }
    };

    const onPlay = () => { rafId = requestAnimationFrame(rafLoop); };
    const onPause = () => {
      cancelAnimationFrame(rafId);
      // Update one final time on pause for accurate stopped position
      setCurrentTime(video.currentTime);
      setCurrentFrame(Math.floor(video.currentTime * fps));
    };
    const onSeeked = () => {
      setCurrentTime(video.currentTime);
      setCurrentFrame(Math.floor(video.currentTime * fps));
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
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("timeupdate", onSeeked);
    };
  }, [videoUrl, fps]);

  // Draw ball tracking overlay (green mask/bbox like SAM2 official + modelhealthdemo)
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
    // (modelhealthdemo pattern: exact match first, then closest within window)
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

        // Green semi-transparent fill over segmented area (SAM2 style)
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

  // Primary: Track with TrackNet (full video, no click needed)
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

  const handleTabClick = useCallback((tabId: TabId) => {
    setActiveTab(tabId);
    setPlayerSelectMode(false);
    setSelectedStroke(null);
    if (tabId === "ai") { setAiOpen((o) => !o); return; }
    setAiOpen(false);
    if (tabId === "pose") {
      setShowPoseOverlay((p) => !p);
      if (!showPoseOverlay) handleDetectPose(); // detect on first enable
    }
    if (tabId === "track" && !hasTrajectory) handleTrackNetTrack();
    if (tabId === "players") {
      setShowPlayerOverlay(true);
      if (segmentedPlayers.length === 0) setPlayerSelectMode(true);
    }
  }, [segmentedPlayers.length]);

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

  const showSidePanel = activeTab === "track" || activeTab === "players" || activeTab === "court" || activeTab === "pose" || aiOpen;
  const showCourt = activeTab === "court";

  // Auto-widen panel for court view
  useEffect(() => {
    setPanelWidth(showCourt ? 480 : 320);
  }, [showCourt]);

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
  if (isLoading) return <div className="flex items-center justify-center h-[60vh]"><Loader2 className="w-8 h-8 text-primary animate-spin" /></div>;
  if (!session) return <div className="text-center py-16"><p className="text-muted-foreground">Game not found</p><Button variant="outline" onClick={() => router.push("/dashboard")} className="mt-4">Back</Button></div>;

  const firstPlayer = session.players?.[0];

  return (
    <>
      <div className="h-[calc(100vh-7rem)] flex flex-col overflow-hidden">
        {/* Breadcrumbs */}
        <nav className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2 shrink-0">
          <Link href="/dashboard" className="hover:text-foreground transition-colors">Players</Link>
          <ChevronRight className="w-3 h-3" />
          {firstPlayer && (<><Link href={`/dashboard/players/${firstPlayer.id}`} className="hover:text-foreground transition-colors">{firstPlayer.name}</Link><ChevronRight className="w-3 h-3" /></>)}
          <span className="text-foreground">{session.name}</span>
        </nav>

        {/* Header */}
        <div className="flex items-center gap-3 mb-3 shrink-0">
          <button onClick={() => router.back()} className="text-muted-foreground hover:text-foreground transition-colors"><ArrowLeft className="w-5 h-5" /></button>
          <div>
            <h1 className="text-lg font-light text-foreground">{session.name}</h1>
            <p className="text-xs text-muted-foreground">{new Date(session.created_at).toLocaleDateString()}</p>
          </div>
        </div>

        {/* Main area */}
        <div className="flex gap-3 flex-1 min-h-0">
          {/* Left: Video or Court (full area) */}
          <div className={cn("flex flex-col min-h-0", showSidePanel ? "flex-1 min-w-0" : "w-full")}>
            {/* Video / Court swap */}
            <div className="relative rounded-xl overflow-hidden bg-background flex-1 min-h-0">
              {/* Video always visible */}
              {(trackingMode || playerSelectMode) && (
                <div className="absolute top-3 left-3 right-3 z-30 flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/20 backdrop-blur-sm">
                  {trackingMode ? <Crosshair className="w-4 h-4 text-primary" /> : <Users className="w-4 h-4 text-primary" />}
                  <span className="text-xs text-foreground">
                    {trackingMode ? "Click on the ball to track" : "Click on a player to detect"}
                  </span>
                  <button onClick={() => { setTrackingMode(false); setPlayerSelectMode(false); }} className="ml-auto text-xs text-muted-foreground hover:text-foreground">Cancel</button>
                </div>
              )}
              <div className={cn("relative w-full h-full", (trackingMode || playerSelectMode) && "cursor-crosshair")} onClick={handleFrameClick}>
                {videoUrl && <video ref={videoRef} src={videoUrl} className="w-full h-full object-contain" muted={isMuted} playsInline />}
                <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
                <canvas ref={playerCanvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
              </div>
              {/* Shot analysis overlay — above canvas, below toolbar */}
              <AnimatePresence>
                {selectedStroke && (
                  <ShotCard
                    key={selectedStroke.id}
                    stroke={selectedStroke}
                    index={selectedStrokeIndex}
                    totalStrokes={strokes.length}
                    sessionMaxVelocity={sessionMaxVelocity}
                    onDismiss={() => setSelectedStroke(null)}
                  />
                )}
              </AnimatePresence>
              {/* Glass Toolbar — always on top */}
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20">
                <div className="glass-toolbar flex items-center gap-1 px-2 py-1.5">
                  <div className="glass-shimmer" />
                  {tabs.map((tab) => {
                    const Icon = tab.icon;
                    const isActive = activeTab === tab.id;
                    const isOn = (tab.id === "pose" && showPoseOverlay) || (tab.id === "track" && trackingMode) || (tab.id === "players" && (showPlayerOverlay || playerSelectMode)) || (tab.id === "ai" && aiOpen);
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
            <div className="rounded-xl bg-card p-2.5 mt-2 shrink-0">
              <div className="flex items-center gap-3 mb-1.5">
                <span className="text-[10px] text-muted-foreground w-10">{fmtTime(currentTime)}</span>
                <input type="range" min={0} max={duration || 100} step={0.01} value={currentTime} onChange={handleSeek}
                  className="flex-1 h-1 bg-border rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:rounded-full" />
                <span className="text-[10px] text-muted-foreground w-10 text-right">{fmtTime(duration)}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => skipFrames(-10)}><SkipBack className="w-3 h-3" /></Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={togglePlay}>{isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}</Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => skipFrames(10)}><SkipForward className="w-3 h-3" /></Button>
                </div>
                <span className="text-[10px] text-muted-foreground">Frame {currentFrame}</span>
                <button
                  onClick={() => {
                    const rates = [0.25, 0.5, 1, 1.5, 2];
                    const next = rates[(rates.indexOf(playbackRate) + 1) % rates.length];
                    setPlaybackRate(next);
                    if (videoRef.current) videoRef.current.playbackRate = next;
                  }}
                  className="text-[10px] px-1.5 py-0.5 rounded text-primary hover:bg-muted transition-colors font-mono"
                >
                  {playbackRate}x
                </button>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setIsMuted((m) => !m)}>{isMuted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}</Button>
              </div>
            </div>
          </div>

          {/* Right Panel — Track results, Players, Court, Pose, or AI Chat */}
          {showSidePanel && (
            <div className="shrink-0 flex min-h-0 overflow-hidden" style={{ width: panelWidth }}>
              {/* Resize handle */}
              <div
                onMouseDown={handleResizeStart}
                className="w-1.5 shrink-0 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors rounded-full self-stretch"
              />
              <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              {/* Track results */}
              {activeTab === "track" && !trackingMode && !aiOpen && (
                <Card isBlurred className="bg-background/60 dark:bg-content1/60">
                  <CardBody>
                  {hasTrajectory ? (
                    <div className="space-y-3">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Tracking Results</p>
                      <div className="space-y-2">
                        <div className="flex justify-between text-xs"><span className="text-muted-foreground">Frames</span><span className="text-foreground">{session.trajectory_data?.frames?.length}</span></div>
                        <div className="flex justify-between text-xs"><span className="text-muted-foreground">Avg Speed</span><span className="text-foreground">{session.trajectory_data?.velocity?.length ? (session.trajectory_data.velocity.reduce((a: number, b: number) => a + b, 0) / session.trajectory_data.velocity.length).toFixed(1) : "—"} px/f</span></div>
                        <div className="flex justify-between text-xs"><span className="text-muted-foreground">Spin</span><span className="text-primary capitalize">{session.trajectory_data?.spin_estimate ?? "—"}</span></div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-6">
                      {isProcessing ? (
                        <>
                          <Loader2 className="w-5 h-5 text-primary mx-auto mb-2 animate-spin" />
                          <p className="text-xs text-muted-foreground">Auto-tracking in progress...</p>
                          <p className="text-[10px] text-muted-foreground/70 mt-1">Ball trajectory will appear when ready</p>
                        </>
                      ) : (
                        <>
                          <Crosshair className="w-5 h-5 text-border mx-auto mb-2" />
                          <p className="text-xs text-muted-foreground mb-3">Click Track to detect ball trajectory</p>
                          <button onClick={handleAutoDetect} className="text-[10px] text-muted-foreground hover:text-primary transition-colors underline">
                            Manual detect (YOLO+SAM2)
                          </button>
                        </>
                      )}
                    </div>
                  )}
                  </CardBody>
                </Card>
              )}

              {/* Players panel */}
              {activeTab === "players" && !aiOpen && (
                <Card isBlurred className="bg-background/60 dark:bg-content1/60 flex flex-col h-full overflow-hidden">
                  <CardHeader className="px-3 py-2.5 border-b border-content3/30 flex items-center justify-between">
                    <span className="text-xs font-medium text-foreground">Players</span>
                    <button
                      onClick={() => { setPlayerSelectMode(true); setShowPlayerOverlay(true); }}
                      className={cn(
                        "text-[10px] px-2.5 py-1 rounded-lg transition-colors",
                        playerSelectMode
                          ? "bg-primary text-primary-foreground"
                          : "text-primary hover:bg-primary/10"
                      )}
                    >
                      {playerSelectMode ? "Selecting..." : "+ Add Player"}
                    </button>
                  </CardHeader>

                  <CardBody className="flex-1 overflow-y-auto p-3 space-y-2">
                    {segmentedPlayers.length === 0 ? (
                      <div className="text-center py-8">
                        <Users className="w-6 h-6 text-border mx-auto mb-3" />
                        <p className="text-xs text-muted-foreground mb-1">No players detected</p>
                        <p className="text-[10px] text-muted-foreground/70 mb-3">Click &quot;Add Player&quot; then click on a player in the video</p>
                        <button
                          onClick={() => { setPlayerSelectMode(true); setShowPlayerOverlay(true); }}
                          className="text-[10px] text-primary hover:text-primary/80 transition-colors"
                        >
                          Detect a player
                        </button>
                      </div>
                    ) : (
                      segmentedPlayers.map((player) => (
                        <div key={player.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-background hover:bg-muted transition-colors">
                          <div
                            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 cursor-pointer"
                            style={{ background: `rgba(${player.rgb}, 0.15)` }}
                            onClick={() => setSegmentedPlayers((ps) => ps.map((p) => p.id === player.id ? { ...p, visible: !p.visible } : p))}
                          >
                            <div className="w-3 h-3 rounded-full" style={{ background: player.color, opacity: player.visible ? 1 : 0.3 }} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-foreground">{player.name}</p>
                            <p className="text-[10px] text-muted-foreground">
                              ({Math.round(player.clickX)}, {Math.round(player.clickY)})
                            </p>
                          </div>
                          <button
                            onClick={() => setSegmentedPlayers((ps) => ps.filter((p) => p.id !== player.id))}
                            className="text-muted-foreground hover:text-destructive transition-colors"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))
                    )}
                  </CardBody>

                  {segmentedPlayers.length > 0 && (
                    <div className="px-3 py-2.5 border-t border-border/30">
                      <div className="flex justify-between text-[10px]">
                        <span className="text-muted-foreground">{segmentedPlayers.length} player{segmentedPlayers.length !== 1 ? "s" : ""} detected</span>
                        <button
                          onClick={() => { setSegmentedPlayers([]); setShowPlayerOverlay(false); }}
                          className="text-muted-foreground hover:text-destructive transition-colors"
                        >
                          Clear all
                        </button>
                      </div>
                    </div>
                  )}
                </Card>
              )}

              {/* Pose analysis panel */}
              {activeTab === "pose" && showPoseOverlay && !aiOpen && (
                <Card isBlurred className="bg-background/60 dark:bg-content1/60 flex flex-col h-full overflow-hidden">
                  <CardHeader className="px-3 py-2.5 border-b border-content3/30 flex items-center justify-between">
                    <span className="text-xs font-medium text-foreground">
                      {isPoseProcessing ? "Pose Analysis" : detectedPersons.length > 0 ? `${detectedPersons.length} Person${detectedPersons.length > 1 ? "s" : ""}` : "Pose Analysis"}
                    </span>
                    {(isDetectingPose || isPoseProcessing) && <Spinner size="sm" color="primary" />}
                  </CardHeader>
                  <CardBody className="flex-1 overflow-y-auto p-2 space-y-2">
                    {isPoseProcessing ? (
                      <div className="text-center py-6">
                        <Loader2 className="w-6 h-6 text-primary mx-auto mb-3 animate-spin" />
                        <p className="text-xs text-foreground mb-1">Pose estimation running...</p>
                        <p className="text-[10px] text-muted-foreground">Analyzing player movements frame by frame.</p>
                        <p className="text-[10px] text-muted-foreground mt-1">This may take a minute for longer videos.</p>
                        {session?.selected_player && (
                          <p className="text-[10px] text-primary mt-2">Tracking Player {session.selected_player.player_idx + 1}</p>
                        )}
                      </div>
                    ) : session?.status === "failed" && !hasPose ? (
                      <div className="text-center py-6">
                        <Activity className="w-6 h-6 text-destructive mx-auto mb-3" />
                        <p className="text-xs text-destructive mb-1">Pose analysis failed</p>
                        <p className="text-[10px] text-muted-foreground mb-3">Pose estimation failed. Re-upload the video to retry.</p>
                      </div>
                    ) : detectedPersons.length === 0 && !isDetectingPose && !hasPose ? (
                      <div className="text-center py-6">
                        <Activity className="w-5 h-5 text-border mx-auto mb-2" />
                        <p className="text-xs text-muted-foreground mb-3">No pose data yet</p>
                        <p className="text-[10px] text-foreground/40">Pose runs automatically on upload.</p>
                      </div>
                    ) : null}
                    {!isPoseProcessing && detectedPersons.map((person) => {
                      const isSelected = person.id === selectedPersonId;
                      const color = ["#9B7B5B", "#5B9B7B", "#7B5B9B", "#C8B464"][(person.id - 1) % 4];
                      return (
                        <button
                          key={person.id}
                          onClick={() => setSelectedPersonId(isSelected ? null : person.id)}
                          className={`w-full p-2.5 rounded-lg text-left transition-colors ${
                            isSelected ? "bg-border/60 ring-1" : "bg-background hover:bg-border/30"
                          }`}
                          style={isSelected ? { borderColor: color, borderWidth: 1 } : undefined}
                        >
                          <div className="flex items-center gap-2 mb-2">
                            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
                            <span className="text-xs font-medium text-foreground">Player {person.id}</span>
                            <span className="text-[10px] text-muted-foreground ml-auto">{(person.confidence * 100).toFixed(0)}%</span>
                          </div>
                          {isSelected && (
                            <div className="space-y-1.5 mt-2">
                              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Keypoints</p>
                              <div className="grid grid-cols-2 gap-1">
                                {person.keypoints.filter((k) => k.conf > 0.3).map((kp) => (
                                  <div key={kp.name} className="flex justify-between text-[10px]">
                                    <span className="text-muted-foreground truncate">{kp.name.replace("_", " ")}</span>
                                    <span className="text-foreground font-mono">{kp.conf.toFixed(2)}</span>
                                  </div>
                                ))}
                              </div>
                              <div className="mt-2 pt-2 border-t border-border/30">
                                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Bbox</p>
                                <p className="text-[10px] text-muted-foreground font-mono">
                                  {person.bbox[0]},{person.bbox[1]} — {person.bbox[2]},{person.bbox[3]}
                                  <span className="text-muted-foreground/70 ml-2">
                                    ({person.bbox[2] - person.bbox[0]}x{person.bbox[3] - person.bbox[1]}px)
                                  </span>
                                </p>
                              </div>
                            </div>
                          )}
                        </button>
                      );
                    })}

                    {/* Stroke Analysis Section */}
                    {hasPose && !isPoseProcessing && (
                      <div className="mt-3 pt-3 border-t border-border/30">
                        {hasStrokes ? (
                          <div className="space-y-2">
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Stroke Analysis</p>
                            <div className="grid grid-cols-2 gap-2">
                              <div className="p-2 rounded-lg bg-background">
                                <p className="text-[10px] text-muted-foreground">Forehand</p>
                                <p className="text-lg font-light text-[#9B7B5B]">{strokeSummary?.forehand_count ?? 0}</p>
                              </div>
                              <div className="p-2 rounded-lg bg-background">
                                <p className="text-[10px] text-muted-foreground">Backhand</p>
                                <p className="text-lg font-light text-[#5B9B7B]">{strokeSummary?.backhand_count ?? 0}</p>
                              </div>
                            </div>
                            <div className="space-y-1.5">
                              <div className="flex justify-between text-[10px]">
                                <span className="text-muted-foreground">Avg Form Score</span>
                                <span className="text-foreground font-mono">{strokeSummary?.average_form_score?.toFixed(1)}</span>
                              </div>
                              <div className="flex justify-between text-[10px]">
                                <span className="text-muted-foreground">Best Form Score</span>
                                <span className="text-[#9B7B5B] font-mono">{strokeSummary?.best_form_score?.toFixed(1)}</span>
                              </div>
                              <div className="flex justify-between text-[10px]">
                                <span className="text-muted-foreground">Consistency</span>
                                <span className="text-foreground font-mono">{strokeSummary?.consistency_score?.toFixed(1)}</span>
                              </div>
                              <div className="flex justify-between text-[10px]">
                                <span className="text-muted-foreground">Serves</span>
                                <span className="text-foreground font-mono">{strokeSummary?.serve_count ?? 0}</span>
                              </div>
                              <div className="flex justify-between text-[10px]">
                                <span className="text-muted-foreground">Total Strokes</span>
                                <span className="text-foreground font-mono">{strokeSummary?.total_strokes ?? 0}</span>
                              </div>
                            </div>
                            {/* FH/BH ratio bar */}
                            {(strokeSummary?.total_strokes ?? 0) > 0 && (
                              <div className="mt-1">
                                <div className="flex h-1.5 rounded-full overflow-hidden bg-border">
                                  <div
                                    className="bg-[#9B7B5B] transition-all"
                                    style={{ width: `${((strokeSummary?.forehand_count ?? 0) / (strokeSummary?.total_strokes ?? 1)) * 100}%` }}
                                  />
                                  <div
                                    className="bg-[#5B9B7B] transition-all"
                                    style={{ width: `${((strokeSummary?.backhand_count ?? 0) / (strokeSummary?.total_strokes ?? 1)) * 100}%` }}
                                  />
                                </div>
                                <div className="flex justify-between mt-1">
                                  <span className="text-[9px] text-[#9B7B5B]">FH {Math.round(((strokeSummary?.forehand_count ?? 0) / (strokeSummary?.total_strokes ?? 1)) * 100)}%</span>
                                  <span className="text-[9px] text-[#5B9B7B]">BH {Math.round(((strokeSummary?.backhand_count ?? 0) / (strokeSummary?.total_strokes ?? 1)) * 100)}%</span>
                                </div>
                              </div>
                            )}
                            {/* Individual stroke list */}
                            {strokes.length > 0 && (
                              <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                                <p className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1">Shots</p>
                                {strokes.map((s, i) => {
                                  const isActive = selectedStroke?.id === s.id;
                                  const typeColor = s.stroke_type === "forehand" ? "#9B7B5B" : s.stroke_type === "backhand" ? "#5B9B7B" : "#5B7B9B";
                                  return (
                                    <button
                                      key={s.id}
                                      onClick={() => {
                                        setSelectedStroke(isActive ? null : s);
                                        if (!isActive && videoRef.current) {
                                          videoRef.current.currentTime = s.peak_frame / fps;
                                        }
                                      }}
                                      className={cn(
                                        "w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-left transition-colors",
                                        isActive ? "bg-border/50" : "hover:bg-background"
                                      )}
                                    >
                                      <div className="flex items-center gap-2">
                                        <span
                                          className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
                                          style={{ background: `${typeColor}20`, color: typeColor }}
                                        >
                                          {s.stroke_type === "forehand" ? "FH" : s.stroke_type === "backhand" ? "BH" : "SV"}
                                        </span>
                                        <span className="text-[10px] text-muted-foreground font-mono">#{i + 1}</span>
                                      </div>
                                      <span className="text-[10px] font-mono" style={{ color: typeColor }}>
                                        {s.form_score.toFixed(0)}
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="text-center py-3">
                            <p className="text-[10px] text-muted-foreground mb-2">Detect forehand & backhand strokes</p>
                            <button
                              onClick={() => strokeMutation.mutate()}
                              disabled={strokeMutation.isPending}
                              className="text-xs px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
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
                      </div>
                    )}
                  </CardBody>
                </Card>
              )}

              {/* Court 3D view — side panel synced to video */}
              {showCourt && !aiOpen && (
                <div className="flex-1 min-h-0 rounded-xl overflow-hidden">
                  <BirdEyeView trajectoryData={session.trajectory_data} poseData={poseData} currentFrame={currentFrame} totalFrames={Math.floor(duration * fps)} isPlaying={isPlaying} />
                </div>
              )}

              {/* AI Chat — inline right panel */}
              {aiOpen && (
                <Card isBlurred className="bg-background/60 dark:bg-content1/60 flex flex-col h-full overflow-hidden rounded-xl">
                  {/* Minimal header — just close button */}
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-xs text-muted-foreground">Ask anything about this game</span>
                    <button onClick={() => setAiOpen(false)} className="w-6 h-6 rounded-full hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="h-px bg-border/30 mx-3" />

                  {/* Messages */}
                  <div className="flex-1 overflow-y-auto p-3 space-y-3">
                    {chatMessages.map((msg, i) => (
                      <div key={i} className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}>
                        {msg.role === "tool" ? (
                          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#9B7B5B]/8 text-[10px] text-[#9B7B5B] w-full">
                            <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                            <span className="font-mono truncate">{msg.toolName}</span>
                          </div>
                        ) : (
                          <div className={cn("max-w-[90%] rounded-2xl px-3 py-2 text-xs leading-relaxed",
                            msg.role === "user" ? "bg-primary text-primary-foreground rounded-br-md" : "bg-card text-foreground rounded-bl-md")}>
                            {msg.content.split("\n").map((line, j) => (
                              <p key={j} className={j > 0 ? "mt-1" : ""}>
                                {line.split("**").map((part, k) => k % 2 === 1 ? <strong key={k} className={msg.role === "user" ? "font-semibold" : "text-[#9B7B5B] font-medium"}>{part}</strong> : part)}
                              </p>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                    {isAiThinking && (
                      <div className="flex justify-start">
                        <div className="bg-card rounded-2xl rounded-bl-md px-4 py-3 flex items-center gap-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-[#9B7B5B] animate-pulse" />
                          <div className="w-1.5 h-1.5 rounded-full bg-[#9B7B5B] animate-pulse" style={{ animationDelay: "0.15s" }} />
                          <div className="w-1.5 h-1.5 rounded-full bg-[#9B7B5B] animate-pulse" style={{ animationDelay: "0.3s" }} />
                        </div>
                      </div>
                    )}
                    <div ref={chatEndRef} />
                  </div>

                  <div className="h-px bg-border/30 mx-3" />

                  {/* Input */}
                  <div className="p-3">
                    <div className="flex items-center gap-2 bg-background/50 rounded-xl px-3 py-1 focus-within:ring-1 focus-within:ring-primary/20 transition-all">
                      <input type="text" value={chatInput} onChange={(e) => setChatInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") handleChatSend(); }}
                        placeholder="Ask about the game..."
                        className="flex-1 py-2 bg-transparent text-xs text-foreground placeholder-muted-foreground focus:outline-none" />
                      <button onClick={handleChatSend} disabled={!chatInput.trim() || isAiThinking}
                        className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-primary-foreground disabled:opacity-20 hover:bg-primary/90 transition-all shrink-0">
                        <Send className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </Card>
              )}
              </div>
            </div>
          )}
        </div>

        {(isTracking || isDetecting) && (
          <Card isBlurred className="bg-background/60 dark:bg-content1/60 p-3 flex-row items-center gap-3 mt-2 shrink-0">
            <Loader2 className="w-4 h-4 text-primary animate-spin" />
            <span className="text-xs text-muted-foreground">{isDetecting ? "Detecting balls with YOLO..." : "Tracking ball with TrackNet..."}</span>
          </Card>
        )}
      </div>

      {/* YOLO Detection result modal */}
      {detectionResult && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setDetectionResult(null)}>
          <div className="bg-card rounded-2xl max-w-lg w-full overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="p-4">
              <p className="text-sm font-medium text-foreground mb-1">
                {detectionResult.detections.length > 0
                  ? `Detected ${detectionResult.detections.length} ball${detectionResult.detections.length > 1 ? "s" : ""}`
                  : "No balls detected"}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {detectionResult.detections.length > 0
                  ? "Click a detection to track, or click manually on the video"
                  : "Try a different frame, or click manually on the ball in the video"}
              </p>
            </div>
            <div className="px-4">
              <img src={detectionResult.preview_image} alt="YOLO detections" className="w-full rounded-lg" />
            </div>
            {detectionResult.detections.length > 0 && (
              <div className="p-4 space-y-2">
                {detectionResult.detections.map((det, i) => (
                  <button
                    key={i}
                    onClick={() => handleConfirmDetection(det)}
                    className="w-full flex items-center justify-between p-2.5 rounded-lg bg-background hover:bg-border transition-colors text-left"
                  >
                    <span className="text-xs text-foreground">
                      {det.class_name} — {det.size[0]}x{det.size[1]}px
                    </span>
                    <span className="text-[10px] text-[#9B7B5B] font-medium">{(det.confidence * 100).toFixed(0)}%</span>
                  </button>
                ))}
              </div>
            )}
            <div className="p-4 flex gap-3">
              <button onClick={() => setDetectionResult(null)} className="flex-1 py-2 rounded-lg text-xs text-muted-foreground hover:bg-muted transition-colors">
                Cancel
              </button>
              <button onClick={() => { setDetectionResult(null); setTrackingMode(true); }} className="flex-1 py-2 rounded-lg text-xs text-foreground border border-border hover:border-primary transition-colors">
                Click Manually
              </button>
            </div>
          </div>
        </div>
      )}

    
    </>
  );
}
