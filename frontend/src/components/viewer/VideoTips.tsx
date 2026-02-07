"use client";

import { useEffect, useState, useCallback, useRef } from "react";

export interface VideoTip {
  id: string;
  timestamp: number;
  duration: number;
  title: string;
  message: string;
  strokeId?: string;
  seekTime?: number;
}

interface VideoTipsProps {
  currentTime: number;
  tips: VideoTip[];
  isPlaying: boolean;
  onTipChange?: (tip: VideoTip | null) => void;
  liveTip?: { title: string; message: string } | null;
}

export function VideoTips({ currentTime, tips, onTipChange, liveTip }: VideoTipsProps) {
  const [activeTip, setActiveTip] = useState<VideoTip | null>(null);
  const [shownTipIds, setShownTipIds] = useState<Set<string>>(new Set());
  const prevTipRef = useRef<VideoTip | null>(null);

  // Find the single active tip for current time
  const updateActiveTip = useCallback(() => {
    // Only show one tip at a time - find the first matching tip
    const currentTip = tips.find((tip) => {
      const tipStart = tip.timestamp;
      const tipEnd = tip.timestamp + tip.duration;
      return currentTime >= tipStart && currentTime <= tipEnd;
    });

    // Mark as shown when first entering range
    if (currentTip && !shownTipIds.has(currentTip.id)) {
      setShownTipIds((prev) => new Set([...prev, currentTip.id]));
    }

    // Notify parent when tip changes
    if (currentTip?.id !== prevTipRef.current?.id) {
      prevTipRef.current = currentTip || null;
      onTipChange?.(currentTip || null);
    }

    setActiveTip(currentTip || null);
  }, [currentTime, tips, shownTipIds, onTipChange]);

  useEffect(() => {
    updateActiveTip();
  }, [updateActiveTip]);

  // Reset when video restarts
  useEffect(() => {
    if (currentTime < 0.5) {
      setShownTipIds(new Set());
      setActiveTip(null);
      prevTipRef.current = null;
      onTipChange?.(null);
    }
  }, [currentTime, onTipChange]);

  // Stroke tips take priority; fall back to liveTip when no stroke tip active
  const displayTitle = activeTip?.title ?? liveTip?.title;
  const displayMessage = activeTip?.message ?? liveTip?.message;

  if (!displayTitle) {
    return null;
  }

  return (
    <div
      className="absolute top-6 left-1/2 -translate-x-1/2 pointer-events-none"
      style={{
        zIndex: 100,
        isolation: 'isolate',
      }}
    >
      <div
        className="glass-shot-card px-5 py-3 animate-in fade-in slide-in-from-top-2 duration-300"
        style={{
          willChange: 'transform, opacity',
          minWidth: '280px',
          maxWidth: '480px',
        }}
      >
        <div className="relative z-10 flex flex-col gap-1">
          <span className="text-xs font-medium text-[#E8E6E3] leading-tight">
            {displayTitle}
          </span>
          {displayMessage && (
            <span className="text-[11px] text-[#8A8885] leading-snug">
              {displayMessage}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
