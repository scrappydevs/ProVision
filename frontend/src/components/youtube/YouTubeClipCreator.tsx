"use client";

import { useState, useEffect } from "react";
import { Scissors, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createYouTubeClip } from "@/lib/api";

interface YouTubeClipCreatorProps {
  youtubeUrl: string;
  youtubeId: string;
  videoTitle: string;
  duration: number;
  onClipCreated: (clipId: string) => void;
  onClose: () => void;
}

export function YouTubeClipCreator({
  youtubeUrl,
  youtubeId,
  videoTitle,
  duration,
  onClipCreated,
  onClose,
}: YouTubeClipCreatorProps) {
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(Math.min(45, duration));
  const [creating, setCreating] = useState(false);
  
  const clipDuration = endTime - startTime;
  const isValid = clipDuration > 0 && clipDuration <= 45;
  
  const handleStartChange = (value: number) => {
    const newStart = Math.max(0, Math.min(value, duration - 1));
    setStartTime(newStart);
    if (newStart >= endTime) {
      setEndTime(Math.min(newStart + 10, duration));
    }
  };
  
  const handleEndChange = (value: number) => {
    const newEnd = Math.max(startTime + 1, Math.min(value, duration));
    setEndTime(newEnd);
  };
  
  const handleCreateClip = async () => {
    if (!isValid) return;
    
    setCreating(true);
    try {
      console.log('[YouTubeClip] Creating clip:', {
        url: youtubeUrl,
        start: startTime,
        end: endTime,
        duration: clipDuration,
      });
      
      const response = await createYouTubeClip({
        youtube_url: youtubeUrl,
        clip_start_time: startTime,
        clip_end_time: endTime,
        title: videoTitle,
      });
      
      console.log('[YouTubeClip] Clip created successfully:', response.data);
      onClipCreated(response.data.id);
    } catch (err: any) {
      console.error("Failed to create clip:", err);
      const errorMsg = err?.response?.data?.detail || err?.message || "Failed to create clip";
      alert(`Error: ${errorMsg}`);
    } finally {
      setCreating(false);
    }
  };
  
  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };
  
  return (
    <div className="w-full bg-card border border-border/50 rounded-lg overflow-hidden mb-6">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Scissors className="w-3.5 h-3.5 text-[#9B7B5B]" />
          <div>
            <h3 className="text-xs text-foreground/60 uppercase tracking-wider">Create Clip</h3>
            <p className="text-sm font-light text-foreground line-clamp-1 mt-0.5">{videoTitle}</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 hover:bg-white/5 rounded transition-colors text-foreground/40 hover:text-foreground"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      
      {/* Video Preview - YouTube iframe */}
      <div className="aspect-video bg-black relative">
        <iframe
          src={`https://www.youtube.com/embed/${youtubeId}?start=${Math.floor(startTime)}&end=${Math.floor(endTime)}&rel=0&controls=1&modestbranding=1`}
          className="w-full h-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
        <div className="absolute bottom-3 right-3 bg-black/80 backdrop-blur-sm px-2.5 py-1 rounded text-[10px] font-mono text-white">
          {fmtTime(startTime)} - {fmtTime(endTime)} <span className="text-[#9B7B5B]">({fmtTime(clipDuration)})</span>
        </div>
      </div>
      
      {/* Clip Controls */}
      <div className="px-4 py-4 space-y-4">
        {/* Timeline visualization */}
        <div className="relative h-8 bg-black/20 rounded overflow-hidden">
          {/* Selected range highlight */}
          <div
            className="absolute top-0 bottom-0 bg-[#9B7B5B]/30 border-l border-r border-[#9B7B5B]"
            style={{
              left: `${(startTime / duration) * 100}%`,
              width: `${((endTime - startTime) / duration) * 100}%`,
            }}
          />
        </div>
        
        {/* Start Time Slider */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[10px] text-foreground/40 uppercase tracking-wider">
              Start
            </label>
            <span className="text-xs font-mono text-foreground">{fmtTime(startTime)}</span>
          </div>
          <input
            type="range"
            min={0}
            max={duration}
            step={0.1}
            value={startTime}
            onChange={(e) => handleStartChange(parseFloat(e.target.value))}
            className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#9B7B5B] [&::-webkit-slider-thumb]:cursor-pointer"
          />
        </div>
        
        {/* End Time Slider */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[10px] text-foreground/40 uppercase tracking-wider">
              End
            </label>
            <span className="text-xs font-mono text-foreground">{fmtTime(endTime)}</span>
          </div>
          <input
            type="range"
            min={0}
            max={duration}
            step={0.1}
            value={endTime}
            onChange={(e) => handleEndChange(parseFloat(e.target.value))}
            className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#9B7B5B] [&::-webkit-slider-thumb]:cursor-pointer"
          />
        </div>
        
        {/* Info and Actions */}
        <div className="flex items-center justify-between pt-3 border-t border-white/10">
          <div className="text-xs">
            {!isValid && clipDuration > 45 && (
              <span className="text-red-400">Clip too long (max 45s)</span>
            )}
            {!isValid && clipDuration <= 0 && (
              <span className="text-red-400">Invalid range</span>
            )}
            {isValid && (
              <span className="text-foreground/60">Duration: <span className="text-[#9B7B5B] font-mono">{fmtTime(clipDuration)}</span></span>
            )}
          </div>
          
          <div className="flex gap-2">
            <Button
              variant="ghost"
              onClick={onClose}
              disabled={creating}
              size="sm"
              className="h-7 text-xs text-foreground/40 hover:text-foreground"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateClip}
              disabled={!isValid || creating}
              size="sm"
              className="h-7 text-xs bg-[#9B7B5B] hover:bg-[#8A6B4B]"
            >
              {creating && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
              {creating ? "Creating..." : "Save Clip"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
