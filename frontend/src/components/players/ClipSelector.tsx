"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { Scissors, Play, Pause, RotateCcw, Zap } from "lucide-react";

interface ClipSelectorProps {
  videoUrl: string;
  duration: number;
  initialStartTime?: number;
  initialEndTime?: number;
  onClipSelect?: (startTime: number, endTime: number) => void;
  onAnalyze?: (startTime: number, endTime: number) => void;
  onCancel?: () => void;
  maxClipDuration?: number;
  mode?: "clip" | "analyze" | "both";
  analyzeLoading?: boolean;
  clipLoading?: boolean;
}

const formatTime = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${m}:${s.toString().padStart(2, "0")}.${ms}`;
};

const HANDLE_WIDTH = 16;
const MIN_CLIP_DURATION = 0.5;
const DEFAULT_MAX_CLIP = 45;
const CLICK_THRESHOLD_PX = 4;

type DragType = "start" | "end" | "segment" | null;

export default function ClipSelector({
  videoUrl,
  duration,
  initialStartTime,
  initialEndTime,
  onClipSelect,
  onAnalyze,
  onCancel,
  maxClipDuration = DEFAULT_MAX_CLIP,
  mode = "both",
  analyzeLoading = false,
  clipLoading = false,
}: ClipSelectorProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  const [videoReady, setVideoReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const isPlayingRef = useRef(false);
  const initStart = initialStartTime ?? 0;
  const initEnd = initialEndTime ?? Math.min(duration, maxClipDuration);
  const [currentTime, setCurrentTime] = useState(initStart);
  const [realDuration, setRealDuration] = useState(duration);
  const effectiveDuration = realDuration > 0 ? realDuration : duration;
  const [startTime, setStartTime] = useState(initStart);
  const [endTime, setEndTime] = useState(initEnd);
  const [dragging, setDragging] = useState<DragType>(null);
  const [dragOrigin, setDragOrigin] = useState<{ x: number; startT: number; endT: number } | null>(null);
  const [thumbnails, setThumbnails] = useState<string[]>([]);

  // Track whether a mousedown was a click or drag
  const mouseDownPos = useRef<{ x: number; y: number } | null>(null);
  const didDrag = useRef(false);

  const setPlaying = useCallback((val: boolean) => {
    isPlayingRef.current = val;
    setIsPlaying(val);
  }, []);

  // Wait for video to be ready and get real duration
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onReady = () => {
      setVideoReady(true);
      if (video.duration && isFinite(video.duration) && video.duration > 0) {
        const d = video.duration;
        setRealDuration(d);
        // Clamp end time to actual duration
        setEndTime((prev) => Math.min(prev, d));
      }
      // Seek to initial start time so preview shows the right frame
      if (initStart > 0 && video.currentTime < initStart - 0.1) {
        video.currentTime = initStart;
      }
    };

    video.addEventListener("loadedmetadata", onReady);
    video.addEventListener("canplaythrough", onReady);

    // If already ready
    if (video.readyState >= 1) onReady();

    return () => {
      video.removeEventListener("loadedmetadata", onReady);
      video.removeEventListener("canplaythrough", onReady);
    };
  }, [videoUrl, maxClipDuration]);

  // Generate thumbnail strip (only once we know the real duration)
  useEffect(() => {
    if (!videoUrl || !effectiveDuration || effectiveDuration <= 0) return;

    let cancelled = false;
    const video = document.createElement("video");
    video.src = videoUrl;
    video.preload = "auto";
    video.muted = true;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const thumbCount = 20;
    const thumbWidth = 80;
    const thumbHeight = 45;
    canvas.width = thumbWidth;
    canvas.height = thumbHeight;

    const generatedThumbs: string[] = [];
    let thumbIndex = 0;

    const handleError = () => {
      if (!cancelled) video.remove();
    };

    video.addEventListener("error", handleError);

    video.addEventListener("seeked", () => {
      if (cancelled) return;
      try {
        ctx.drawImage(video, 0, 0, thumbWidth, thumbHeight);
        generatedThumbs.push(canvas.toDataURL("image/jpeg", 0.5));
      } catch {
        video.remove();
        return;
      }
      thumbIndex++;
      if (thumbIndex < thumbCount) {
        video.currentTime = (thumbIndex / thumbCount) * effectiveDuration;
      } else {
        setThumbnails(generatedThumbs);
        video.remove();
      }
    });

    video.addEventListener("loadeddata", () => {
      if (!cancelled) video.currentTime = 0;
    });

    return () => {
      cancelled = true;
      video.removeEventListener("error", handleError);
      video.remove();
    };
  }, [videoUrl, effectiveDuration]);

  // Keep playhead in sync with video element
  // Use refs for startTime/endTime to avoid re-registering on every bound change
  const startTimeRef = useRef(startTime);
  const endTimeRef = useRef(endTime);
  startTimeRef.current = startTime;
  endTimeRef.current = endTime;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => {
      const t = video.currentTime;
      setCurrentTime(t);
      if (isPlayingRef.current && t >= endTimeRef.current) {
        video.pause();
        setPlaying(false);
        video.currentTime = startTimeRef.current;
        setCurrentTime(startTimeRef.current);
      }
    };

    video.addEventListener("timeupdate", handleTimeUpdate);
    return () => video.removeEventListener("timeupdate", handleTimeUpdate);
  }, [setPlaying]);

  // Seek video helper
  const seekTo = useCallback((time: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = time;
    setCurrentTime(time);
  }, []);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video || !videoReady) return;

    if (isPlaying) {
      video.pause();
      setPlaying(false);
    } else {
      // Seek to start bound first, then play after seek completes
      const needsSeek =
        video.currentTime < startTime - 0.1 || video.currentTime >= endTime - 0.1;

      const doPlay = () => {
        video.play()
          .then(() => setPlaying(true))
          .catch((err) => {
            console.warn("Play failed:", err.name, err.message);
            // If autoplay policy blocks unmuted play, retry muted
            if (err.name === "NotAllowedError") {
              video.muted = true;
              video.play()
                .then(() => {
                  setPlaying(true);
                  // Unmute shortly after
                  setTimeout(() => { video.muted = false; }, 50);
                })
                .catch(() => setPlaying(false));
            } else {
              setPlaying(false);
            }
          });
      };

      if (needsSeek) {
        video.currentTime = startTime;
        setCurrentTime(startTime);
        // Wait for seek to complete before playing
        const onSeeked = () => {
          video.removeEventListener("seeked", onSeeked);
          doPlay();
        };
        video.addEventListener("seeked", onSeeked);
      } else {
        doPlay();
      }
    }
  }, [isPlaying, startTime, endTime, videoReady, setPlaying]);

  const resetClip = useCallback(() => {
    setStartTime(initStart);
    setEndTime(initialEndTime != null ? Math.min(initEnd, effectiveDuration) : Math.min(effectiveDuration, maxClipDuration));
    seekTo(initStart);
    const video = videoRef.current;
    if (video) video.pause();
    setPlaying(false);
  }, [initStart, initEnd, initialEndTime, effectiveDuration, maxClipDuration, seekTo, setPlaying]);

  const getTimeFromX = useCallback(
    (clientX: number): number => {
      const timeline = timelineRef.current;
      if (!timeline) return 0;
      const rect = timeline.getBoundingClientRect();
      const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
      return (x / rect.width) * effectiveDuration;
    },
    [effectiveDuration]
  );

  // Determine if a click X is on the start handle, end handle, or within the segment
  const getHitZone = useCallback(
    (clientX: number): DragType => {
      const timeline = timelineRef.current;
      if (!timeline) return null;
      const rect = timeline.getBoundingClientRect();
      const x = clientX - rect.left;
      const totalW = rect.width;

      const startPx = (startTime / effectiveDuration) * totalW;
      const endPx = (endTime / effectiveDuration) * totalW;
      const handleHalf = HANDLE_WIDTH / 2 + 2; // extra tolerance

      if (Math.abs(x - startPx) <= handleHalf) return "start";
      if (Math.abs(x - endPx) <= handleHalf) return "end";
      if (x > startPx + handleHalf && x < endPx - handleHalf) return "segment";
      return null;
    },
    [startTime, endTime, effectiveDuration]
  );

  // Timeline mousedown: determine what we're interacting with
  const handleTimelineMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      mouseDownPos.current = { x: e.clientX, y: e.clientY };
      didDrag.current = false;

      const zone = getHitZone(e.clientX);

      if (zone === "start" || zone === "end") {
        setDragging(zone);
      } else if (zone === "segment") {
        // Store origin for segment dragging
        setDragging("segment");
        setDragOrigin({ x: e.clientX, startT: startTime, endT: endTime });
      } else {
        // Outside the segment area - will be a click to seek playhead
        setDragging(null);
      }
    },
    [getHitZone, startTime, endTime]
  );

  // Global mouse move / up for dragging
  useEffect(() => {
    if (!dragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      // Track if this qualifies as a drag
      if (mouseDownPos.current) {
        const dx = Math.abs(e.clientX - mouseDownPos.current.x);
        if (dx > CLICK_THRESHOLD_PX) didDrag.current = true;
      }

      const time = getTimeFromX(e.clientX);

      if (dragging === "start") {
        let newStart = Math.max(0, Math.min(time, endTime - MIN_CLIP_DURATION));
        if (endTime - newStart > maxClipDuration) {
          newStart = endTime - maxClipDuration;
        }
        setStartTime(newStart);
        seekTo(newStart);
      } else if (dragging === "end") {
        let newEnd = Math.min(effectiveDuration, Math.max(time, startTime + MIN_CLIP_DURATION));
        if (newEnd - startTime > maxClipDuration) {
          newEnd = startTime + maxClipDuration;
        }
        setEndTime(newEnd);
        seekTo(newEnd);
      } else if (dragging === "segment" && dragOrigin) {
        const timeline = timelineRef.current;
        if (!timeline) return;
        const rect = timeline.getBoundingClientRect();
        const dxPx = e.clientX - dragOrigin.x;
        const dxTime = (dxPx / rect.width) * effectiveDuration;

        const segLen = dragOrigin.endT - dragOrigin.startT;
        let newStart = dragOrigin.startT + dxTime;
        let newEnd = dragOrigin.endT + dxTime;

        // Clamp to bounds
        if (newStart < 0) {
          newStart = 0;
          newEnd = segLen;
        }
        if (newEnd > effectiveDuration) {
          newEnd = effectiveDuration;
          newStart = effectiveDuration - segLen;
        }

        setStartTime(newStart);
        setEndTime(newEnd);
        seekTo(newStart);
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      // If it was a segment mousedown but no actual drag happened, treat as a click-to-seek
      if (dragging === "segment" && !didDrag.current) {
        const time = getTimeFromX(e.clientX);
        const clamped = Math.max(startTime, Math.min(time, endTime));
        seekTo(clamped);
      }
      setDragging(null);
      setDragOrigin(null);
      mouseDownPos.current = null;
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragging, dragOrigin, startTime, endTime, effectiveDuration, maxClipDuration, getTimeFromX, seekTo]);

  // Click on the timeline outside the segment = seek playhead
  const handleTimelineClick = useCallback(
    (e: React.MouseEvent) => {
      // Only handle clicks that didn't start a drag
      if (dragging) return;
      const zone = getHitZone(e.clientX);
      if (zone) return; // was on a handle or segment, handled by mousedown
      const time = getTimeFromX(e.clientX);
      seekTo(time);
    },
    [dragging, getHitZone, getTimeFromX, seekTo]
  );

  const safeDur = effectiveDuration > 0 ? effectiveDuration : 1;
  const startPct = (startTime / safeDur) * 100;
  const endPct = (endTime / safeDur) * 100;
  const playheadPct = (currentTime / safeDur) * 100;
  const clipDuration = endTime - startTime;
  const isOverLimit = clipDuration > maxClipDuration;

  // Cursor for the segment area
  const segmentCursor = dragging === "segment" ? "cursor-grabbing" : "cursor-grab";

  return (
    <div className="flex flex-col gap-4">
      {/* Video Preview */}
      <div className="relative rounded-lg overflow-hidden bg-black aspect-video">
        <video
          ref={videoRef}
          src={videoUrl}
          className="w-full h-full object-contain"
          preload="auto"
          playsInline
        />
        {!videoReady && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-[#9B7B5B] border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>

      {/* Playback Controls */}
      <div className="flex items-center gap-3">
        <button
          onClick={togglePlay}
          disabled={!videoReady}
          className="p-2 rounded-lg bg-muted hover:bg-border text-foreground transition-colors disabled:opacity-40"
        >
          {isPlaying ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <button
          onClick={resetClip}
          className="p-2 rounded-lg bg-muted hover:bg-border text-muted-foreground transition-colors"
        >
          <RotateCcw size={18} />
        </button>

        <div className="flex-1 flex items-center justify-between text-sm text-muted-foreground">
          <span>{formatTime(currentTime)}</span>
          <div className="flex items-center gap-2">
            <span className={`font-medium ${isOverLimit ? "text-[#C45C5C]" : "text-[#9B7B5B]"}`}>
              {formatTime(clipDuration)}
            </span>
            <span className="text-[10px] text-muted-foreground">/ {maxClipDuration}s max</span>
          </div>
          <span>{formatTime(effectiveDuration)}</span>
        </div>
      </div>

      {/* Timeline with trim handles */}
      <div className="relative select-none">
        <div
          ref={timelineRef}
          className="relative h-16 rounded-lg overflow-hidden"
          onMouseDown={handleTimelineMouseDown}
          onClick={handleTimelineClick}
        >
          {/* Thumbnail images background */}
          <div className="absolute inset-0 flex pointer-events-none">
            {thumbnails.length > 0
              ? thumbnails.map((thumb, i) => (
                  <img
                    key={i}
                    src={thumb}
                    className="h-full flex-1 object-cover"
                    alt=""
                    draggable={false}
                  />
                ))
              : Array.from({ length: 20 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-full flex-1 bg-muted border-r border-border"
                  />
                ))}
          </div>

          {/* Dimmed regions outside clip */}
          <div
            className="absolute inset-y-0 left-0 bg-black/70 pointer-events-none"
            style={{ width: `${startPct}%` }}
          />
          <div
            className="absolute inset-y-0 right-0 bg-black/70 pointer-events-none"
            style={{ width: `${100 - endPct}%` }}
          />

          {/* Active clip region - lighter highlight + grab cursor */}
          <div
            className={`absolute inset-y-0 bg-white/10 ${segmentCursor}`}
            style={{
              left: `calc(${startPct}% + ${HANDLE_WIDTH / 2}px)`,
              width: `calc(${endPct - startPct}% - ${HANDLE_WIDTH}px)`,
            }}
          />

          {/* Active clip border - top and bottom */}
          <div
            className="absolute top-0 h-[3px] bg-[#9B7B5B] pointer-events-none"
            style={{ left: `${startPct}%`, width: `${endPct - startPct}%` }}
          />
          <div
            className="absolute bottom-0 h-[3px] bg-[#9B7B5B] pointer-events-none"
            style={{ left: `${startPct}%`, width: `${endPct - startPct}%` }}
          />

          {/* Start handle */}
          <div
            className="absolute inset-y-0 cursor-ew-resize z-10 group"
            style={{ left: `calc(${startPct}% - ${HANDLE_WIDTH / 2}px)`, width: `${HANDLE_WIDTH}px` }}
          >
            <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-[6px] bg-[#9B7B5B] rounded-l-md group-hover:bg-[#c49a6c] transition-colors shadow-[2px_0_8px_rgba(0,0,0,0.3)]">
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col gap-[3px]">
                <div className="w-[2px] h-[2px] bg-background rounded-full" />
                <div className="w-[2px] h-[2px] bg-background rounded-full" />
                <div className="w-[2px] h-[2px] bg-background rounded-full" />
              </div>
            </div>
          </div>

          {/* End handle */}
          <div
            className="absolute inset-y-0 cursor-ew-resize z-10 group"
            style={{ left: `calc(${endPct}% - ${HANDLE_WIDTH / 2}px)`, width: `${HANDLE_WIDTH}px` }}
          >
            <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-[6px] bg-[#9B7B5B] rounded-r-md group-hover:bg-[#c49a6c] transition-colors shadow-[-2px_0_8px_rgba(0,0,0,0.3)]">
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col gap-[3px]">
                <div className="w-[2px] h-[2px] bg-background rounded-full" />
                <div className="w-[2px] h-[2px] bg-background rounded-full" />
                <div className="w-[2px] h-[2px] bg-background rounded-full" />
              </div>
            </div>
          </div>

          {/* Playhead */}
          <div
            className="absolute inset-y-0 z-20 pointer-events-none"
            style={{ left: `calc(${playheadPct}% - 1px)`, width: "2px" }}
          >
            <div className="w-[2px] h-full bg-white shadow-[0_0_6px_rgba(255,255,255,0.6)]" />
            <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[4px] border-r-[4px] border-t-[6px] border-transparent border-t-white" />
          </div>
        </div>

        {/* Time labels under handles */}
        <div className="relative h-5 mt-1">
          <span
            className="absolute text-[11px] text-[#9B7B5B] font-medium -translate-x-1/2"
            style={{ left: `${startPct}%` }}
          >
            {formatTime(startTime)}
          </span>
          <span
            className="absolute text-[11px] text-[#9B7B5B] font-medium -translate-x-1/2"
            style={{ left: `${endPct}%` }}
          >
            {formatTime(endTime)}
          </span>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-3">
        {onCancel && (
          <button
            onClick={onCancel}
            className="px-4 py-2.5 rounded-lg border border-border hover:border-primary text-foreground transition-colors text-sm"
          >
            Cancel
          </button>
        )}
        {(mode === "clip" || mode === "both") && onClipSelect && (
          <button
            onClick={() => onClipSelect(startTime, endTime)}
            disabled={clipLoading}
            className="flex-1 py-2.5 rounded-lg border border-border hover:border-primary text-foreground transition-colors text-sm flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Scissors size={16} />
            {clipLoading ? "Saving..." : `Save Clip (${formatTime(clipDuration)})`}
          </button>
        )}
        {(mode === "analyze" || mode === "both") && onAnalyze && (
          <button
            onClick={() => onAnalyze(startTime, endTime)}
            disabled={analyzeLoading}
            className="flex-1 py-2.5 rounded-lg bg-[#9B7B5B] hover:bg-[#8A6B4B] text-background font-medium transition-colors text-sm flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Zap size={16} />
            {analyzeLoading ? "Starting..." : `Analyze (${formatTime(clipDuration)})`}
          </button>
        )}
      </div>
    </div>
  );
}
