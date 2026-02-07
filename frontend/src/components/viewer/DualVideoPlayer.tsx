"use client";

import { useState, useRef, useEffect, useCallback, useMemo, memo } from "react";
import { Button } from "@/components/ui/button";
import { Play, Pause, SkipBack, SkipForward, Maximize2, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";
import { TrajectoryData, TrajectoryPoint } from "@/lib/api";
import { PoseAnalysisData } from "@/hooks/usePoseData";

interface DualVideoPlayerProps {
  exoVideoUrl: string;
  egoVideoUrl?: string;
  poseVideoUrl?: string;
  trajectoryData?: TrajectoryData;
  poseData?: PoseAnalysisData;
  onFrameClick?: (x: number, y: number, frame: number) => void;
  showTrajectory?: boolean;
  showPoseOverlay?: boolean;
}

// Pose connections (33 landmarks)
const POSE_CONNECTIONS = [
  // Face
  [0, 1], [1, 2], [2, 3], [3, 7], [0, 4], [4, 5], [5, 6], [6, 8],
  // Torso
  [11, 12], [11, 23], [12, 24], [23, 24],
  // Left arm
  [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19],
  // Right arm
  [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20],
  // Left leg
  [23, 25], [25, 27], [27, 29], [27, 31], [29, 31],
  // Right leg
  [24, 26], [26, 28], [28, 30], [28, 32], [30, 32],
];

/**
 * Dual video player component for side-by-side exo/ego view.
 * Uses React.memo to prevent unnecessary re-renders.
 */
export const DualVideoPlayer = memo(function DualVideoPlayer({
  exoVideoUrl,
  egoVideoUrl,
  poseVideoUrl,
  trajectoryData,
  poseData,
  onFrameClick,
  showTrajectory = true,
  showPoseOverlay = false,
}: DualVideoPlayerProps) {
  const exoVideoRef = useRef<HTMLVideoElement>(null);
  const egoVideoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const poseCanvasRef = useRef<HTMLCanvasElement>(null);

  // Determine which video to show in the exo view
  const currentExoVideoUrl = useMemo(() => {
    return showPoseOverlay && poseVideoUrl ? poseVideoUrl : exoVideoUrl;
  }, [showPoseOverlay, poseVideoUrl, exoVideoUrl]);
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(true);
  const [currentFrame, setCurrentFrame] = useState(0);
  const animFrameRef = useRef<number>(0);
  const fps = trajectoryData?.video_info?.fps ?? 30;

  // Memoize processed trajectory data to avoid recomputation
  const trajectoryFrameMap = useMemo(() => {
    if (!trajectoryData?.frames) return new Map<number, TrajectoryPoint>();
    return new Map(trajectoryData.frames.map(f => [f.frame, f]));
  }, [trajectoryData]);

  // Jump threshold based on video diagonal — points further apart than this are noise
  const jumpThreshold = useMemo(() => {
    const w = trajectoryData?.video_info?.width ?? 1280;
    const h = trajectoryData?.video_info?.height ?? 720;
    return Math.sqrt(w * w + h * h) * 0.12;
  }, [trajectoryData]);

  // Memoize trajectory points up to current frame for drawing
  const visibleTrajectoryPoints = useMemo(() => {
    if (!trajectoryData?.frames) return [];
    return trajectoryData.frames.filter(f => f.frame <= currentFrame);
  }, [trajectoryData, currentFrame]);

  // Memoize pose data frame maps — separate player (person_id=0) and opponent (person_id=1)
  const { playerPoseMap, opponentPoseMap } = useMemo(() => {
    const playerMap = new Map();
    const opponentMap = new Map();
    if (!poseData?.frames) return { playerPoseMap: playerMap, opponentPoseMap: opponentMap };
    for (const f of poseData.frames) {
      if (f.person_id === 1) {
        opponentMap.set(f.frame_number, f);
      } else {
        playerMap.set(f.frame_number, f);
      }
    }
    return { playerPoseMap: playerMap, opponentPoseMap: opponentMap };
  }, [poseData]);

  // Stable callback for syncing videos
  const syncVideos = useCallback(() => {
    if (exoVideoRef.current && egoVideoRef.current) {
      const diff = Math.abs(exoVideoRef.current.currentTime - egoVideoRef.current.currentTime);
      if (diff > 0.1) {
        egoVideoRef.current.currentTime = exoVideoRef.current.currentTime;
      }
    }
  }, []);

  // Draw trajectory on canvas
  const drawTrajectory = useCallback(() => {
    if (!canvasRef.current || !showTrajectory || visibleTrajectoryPoints.length < 2) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const video = exoVideoRef.current;
    if (!video) return;

    const videoWidth = video.videoWidth || 1920;
    const videoHeight = video.videoHeight || 1080;

    // Only resize if dimensions changed
    if (canvas.width !== videoWidth || canvas.height !== videoHeight) {
      canvas.width = videoWidth;
      canvas.height = videoHeight;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw trajectory line, breaking path on jumps (noise suppression)
    ctx.strokeStyle = "#9B7B5B";
    ctx.lineWidth = 3;
    ctx.beginPath();
    let pathStarted = false;

    visibleTrajectoryPoints.forEach((point, i) => {
      if (i === 0) {
        ctx.moveTo(point.x, point.y);
        pathStarted = true;
      } else {
        const prev = visibleTrajectoryPoints[i - 1];
        const dx = point.x - prev.x;
        const dy = point.y - prev.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > jumpThreshold) {
          // Large jump = tracking noise — break the path
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(point.x, point.y);
        } else {
          ctx.lineTo(point.x, point.y);
        }
      }
    });
    ctx.stroke();

    // Draw current point marker
    const currentPoint = trajectoryFrameMap.get(currentFrame);
    if (currentPoint) {
      ctx.beginPath();
      ctx.arc(currentPoint.x, currentPoint.y, 10, 0, Math.PI * 2);
      ctx.fillStyle = "#9B7B5B";
      ctx.fill();
      ctx.strokeStyle = "#E8E6E3";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }, [visibleTrajectoryPoints, trajectoryFrameMap, currentFrame, showTrajectory, jumpThreshold]);

  // Draw pose skeleton on canvas (both player and opponent)
  const drawPoseSkeleton = useCallback(() => {
    if (!poseCanvasRef.current || !showPoseOverlay) return;

    const canvas = poseCanvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const video = exoVideoRef.current;
    if (!video) return;

    const videoWidth = video.videoWidth || 1920;
    const videoHeight = video.videoHeight || 1080;

    // Only resize if dimensions changed
    if (canvas.width !== videoWidth || canvas.height !== videoHeight) {
      canvas.width = videoWidth;
      canvas.height = videoHeight;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // COCO 17-keypoint names (matches backend LANDMARK_NAMES order)
    const landmarkNames = [
      "nose", "left_eye", "right_eye", "left_ear", "right_ear",
      "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
      "left_wrist", "right_wrist", "left_hip", "right_hip",
      "left_knee", "right_knee", "left_ankle", "right_ankle",
    ];

    // COCO 17-keypoint skeleton connections
    const cocoConnections = [
      [0, 1], [0, 2], [1, 3], [2, 4],          // face
      [5, 6], [5, 11], [6, 12], [11, 12],       // torso
      [5, 7], [7, 9],                            // left arm
      [6, 8], [8, 10],                           // right arm
      [11, 13], [13, 15],                        // left leg
      [12, 14], [14, 16],                        // right leg
    ];

    const drawSkeleton = (
      poseFrame: { keypoints: Record<string, { x: number; y: number; z: number; visibility: number }> } | undefined,
      lineColor: string,
      dotColor: string,
    ) => {
      if (!poseFrame?.keypoints) return;

      // Build indexed array from keypoints object
      const keypointsArray = Object.entries(poseFrame.keypoints).map(([name, kp]) => ({
        name,
        x: kp.x * videoWidth,
        y: kp.y * videoHeight,
        z: kp.z,
        visibility: kp.visibility,
      }));

      const keypoints = landmarkNames.map(name =>
        keypointsArray.find(kp => kp.name === name)
      );

      // Draw connections
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 3;
      cocoConnections.forEach(([i1, i2]) => {
        const kp1 = keypoints[i1];
        const kp2 = keypoints[i2];
        if (kp1 && kp2 && kp1.visibility > 0.5 && kp2.visibility > 0.5) {
          ctx.beginPath();
          ctx.moveTo(kp1.x, kp1.y);
          ctx.lineTo(kp2.x, kp2.y);
          ctx.stroke();
        }
      });

      // Draw keypoints
      keypoints.forEach(kp => {
        if (kp && kp.visibility > 0.5) {
          ctx.beginPath();
          ctx.arc(kp.x, kp.y, 5, 0, Math.PI * 2);
          ctx.fillStyle = dotColor;
          ctx.fill();
          ctx.strokeStyle = "#E8E6E3";
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      });
    };

    // Draw player skeleton (green)
    drawSkeleton(playerPoseMap.get(currentFrame), "#6B8E6B", "#6B8E6B");
    // Draw opponent skeleton (teal)
    drawSkeleton(opponentPoseMap.get(currentFrame), "#5B9B9B", "#5B9B9B");
  }, [playerPoseMap, opponentPoseMap, currentFrame, showPoseOverlay]);

  // Video event listeners — use requestAnimationFrame for smooth frame-accurate updates
  useEffect(() => {
    const exoVideo = exoVideoRef.current;
    if (!exoVideo) return;

    const handleLoadedMetadata = () => {
      setDuration(exoVideo.duration);
    };

    exoVideo.addEventListener("loadedmetadata", handleLoadedMetadata);

    // rAF loop fires at display refresh rate (60Hz+) instead of timeupdate (~4Hz)
    let lastFrame = -1;
    const tick = () => {
      if (exoVideo) {
        const t = exoVideo.currentTime;
        const f = Math.round(t * fps);
        if (f !== lastFrame) {
          lastFrame = f;
          setCurrentTime(t);
          setCurrentFrame(f);
          syncVideos();
        }
      }
      animFrameRef.current = requestAnimationFrame(tick);
    };
    animFrameRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      exoVideo.removeEventListener("loadedmetadata", handleLoadedMetadata);
    };
  }, [fps, syncVideos]);

  // Draw trajectory when frame changes
  useEffect(() => {
    drawTrajectory();
  }, [drawTrajectory]);

  // Draw pose skeleton when frame changes
  useEffect(() => {
    drawPoseSkeleton();
  }, [drawPoseSkeleton]);

  // Stable callback for play/pause toggle
  const togglePlay = useCallback(() => {
    const exoVideo = exoVideoRef.current;
    const egoVideo = egoVideoRef.current;
    
    if (isPlaying) {
      exoVideo?.pause();
      egoVideo?.pause();
    } else {
      exoVideo?.play();
      egoVideo?.play();
    }
    setIsPlaying(prev => !prev);
  }, [isPlaying]);
  
  // Stable callback for seeking
  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (exoVideoRef.current) {
      exoVideoRef.current.currentTime = time;
    }
    if (egoVideoRef.current) {
      egoVideoRef.current.currentTime = time;
    }
    setCurrentTime(time);
  }, []);
  
  // Stable callback for frame skipping
  const skipFrames = useCallback((frames: number) => {
    const newTime = Math.max(0, Math.min(duration, currentTime + frames / fps));
    if (exoVideoRef.current) {
      exoVideoRef.current.currentTime = newTime;
    }
    if (egoVideoRef.current) {
      egoVideoRef.current.currentTime = newTime;
    }
  }, [duration, currentTime, fps]);
  
  // Stable callback for video click (object tracking)
  const handleVideoClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!onFrameClick || !exoVideoRef.current) return;
    
    const rect = e.currentTarget.getBoundingClientRect();
    const video = exoVideoRef.current;
    
    const scaleX = video.videoWidth / rect.width;
    const scaleY = video.videoHeight / rect.height;
    
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    
    onFrameClick(x, y, currentFrame);
  }, [onFrameClick, currentFrame]);
  
  // Stable callback for mute toggle
  const toggleMute = useCallback(() => {
    setIsMuted(prev => !prev);
  }, []);

  // Memoize time formatting
  const formattedCurrentTime = useMemo(() => {
    const mins = Math.floor(currentTime / 60);
    const secs = Math.floor(currentTime % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }, [currentTime]);

  const formattedDuration = useMemo(() => {
    const mins = Math.floor(duration / 60);
    const secs = Math.floor(duration % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }, [duration]);

  return (
    <div className="flex flex-col gap-4">
      {/* Video panels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Exo View */}
        <ExoVideoPanel
          videoRef={exoVideoRef}
          canvasRef={canvasRef}
          poseCanvasRef={poseCanvasRef}
          videoUrl={currentExoVideoUrl}
          isMuted={isMuted}
          onFrameClick={onFrameClick}
          handleVideoClick={handleVideoClick}
        />
        
        {/* Ego View */}
        <EgoVideoPanel
          videoRef={egoVideoRef}
          videoUrl={egoVideoUrl}
        />
      </div>
      
      {/* Controls */}
      <VideoControls
        currentTime={currentTime}
        duration={duration}
        currentFrame={currentFrame}
        isPlaying={isPlaying}
        isMuted={isMuted}
        spinEstimate={trajectoryData?.spin_estimate}
        formattedCurrentTime={formattedCurrentTime}
        formattedDuration={formattedDuration}
        onSeek={handleSeek}
        onTogglePlay={togglePlay}
        onSkipFrames={skipFrames}
        onToggleMute={toggleMute}
      />
    </div>
  );
});

// ============================================================================
// Memoized Sub-components
// ============================================================================

interface ExoVideoPanelProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  poseCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  videoUrl: string;
  isMuted: boolean;
  onFrameClick?: (x: number, y: number, frame: number) => void;
  handleVideoClick: (e: React.MouseEvent<HTMLDivElement>) => void;
}

const ExoVideoPanel = memo(function ExoVideoPanel({
  videoRef,
  canvasRef,
  poseCanvasRef,
  videoUrl,
  isMuted,
  onFrameClick,
  handleVideoClick,
}: ExoVideoPanelProps) {
  return (
    <div className="relative bg-background rounded-xl overflow-hidden border border-border">
      <div className="absolute top-3 left-3 z-10 px-2 py-1 bg-background/80 rounded text-xs text-foreground">
        Exo View (Original)
      </div>
      <div
        className={cn(
          "relative aspect-video",
          onFrameClick && "cursor-crosshair"
        )}
        onClick={handleVideoClick}
      >
        <video
          ref={videoRef}
          src={videoUrl}
          className="w-full h-full object-contain"
          muted={isMuted}
          playsInline
        />
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full pointer-events-none"
        />
        <canvas
          ref={poseCanvasRef}
          className="absolute inset-0 w-full h-full pointer-events-none"
        />
      </div>
    </div>
  );
});

interface EgoVideoPanelProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  videoUrl?: string;
}

const EgoVideoPanel = memo(function EgoVideoPanel({
  videoRef,
  videoUrl,
}: EgoVideoPanelProps) {
  return (
    <div className="relative bg-background rounded-xl overflow-hidden border border-border">
      <div className="absolute top-3 left-3 z-10 px-2 py-1 bg-[#9B7B5B]/80 rounded text-xs text-background">
        Ego View (Generated)
      </div>
      <div className="aspect-video">
        {videoUrl ? (
          <video
            ref={videoRef}
            src={videoUrl}
            className="w-full h-full object-contain"
            muted
            playsInline
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <div className="text-center">
              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
                <Play className="w-6 h-6 text-[#9B7B5B]" />
              </div>
              <p className="text-sm text-muted-foreground">Ego view not generated</p>
              <p className="text-xs text-muted-foreground mt-1">Click "Generate Ego View" to create</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

interface VideoControlsProps {
  currentTime: number;
  duration: number;
  currentFrame: number;
  isPlaying: boolean;
  isMuted: boolean;
  spinEstimate?: string;
  formattedCurrentTime: string;
  formattedDuration: string;
  onSeek: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onTogglePlay: () => void;
  onSkipFrames: (frames: number) => void;
  onToggleMute: () => void;
}

const VideoControls = memo(function VideoControls({
  currentTime,
  duration,
  currentFrame,
  isPlaying,
  isMuted,
  spinEstimate,
  formattedCurrentTime,
  formattedDuration,
  onSeek,
  onTogglePlay,
  onSkipFrames,
  onToggleMute,
}: VideoControlsProps) {
  // Stable callbacks for skip buttons
  const skipBack = useCallback(() => onSkipFrames(-10), [onSkipFrames]);
  const skipForward = useCallback(() => onSkipFrames(10), [onSkipFrames]);

  return (
    <div className="bg-card rounded-xl p-4 border border-border">
      {/* Timeline */}
      <div className="flex items-center gap-3 mb-4">
        <span className="text-xs text-muted-foreground w-12">{formattedCurrentTime}</span>
        <input
          type="range"
          min={0}
          max={duration || 100}
          step={0.01}
          value={currentTime}
          onChange={onSeek}
          className="flex-1 h-1 bg-border rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-[#9B7B5B] [&::-webkit-slider-thumb]:rounded-full"
        />
        <span className="text-xs text-muted-foreground w-12 text-right">{formattedDuration}</span>
      </div>
      
      {/* Playback controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={skipBack}>
            <SkipBack className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onTogglePlay}>
            {isPlaying ? (
              <Pause className="w-5 h-5" />
            ) : (
              <Play className="w-5 h-5" />
            )}
          </Button>
          <Button variant="ghost" size="icon" onClick={skipForward}>
            <SkipForward className="w-4 h-4" />
          </Button>
        </div>
        
        <div className="flex items-center gap-4">
          <span className="text-xs text-muted-foreground">
            Frame: {currentFrame}
          </span>
          {spinEstimate && (
            <span className="text-xs text-[#9B7B5B]">
              Spin: {spinEstimate}
            </span>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={onToggleMute}>
            {isMuted ? (
              <VolumeX className="w-4 h-4" />
            ) : (
              <Volume2 className="w-4 h-4" />
            )}
          </Button>
          <Button variant="ghost" size="icon">
            <Maximize2 className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
});
