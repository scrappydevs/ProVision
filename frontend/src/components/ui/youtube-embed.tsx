"use client";

import { useState } from "react";
import { Play } from "lucide-react";

interface YouTubeEmbedProps {
  youtubeVideoId: string;
  url?: string;
  className?: string;
}

export function YouTubeEmbed({ youtubeVideoId, className }: YouTubeEmbedProps) {
  const [loaded, setLoaded] = useState(false);
  const thumbnailUrl = `https://img.youtube.com/vi/${youtubeVideoId}/hqdefault.jpg`;

  if (!loaded) {
    return (
      <button
        onClick={() => setLoaded(true)}
        className={`relative w-full aspect-video bg-black/50 group cursor-pointer ${className ?? ""}`}
      >
        <img
          src={thumbnailUrl}
          alt="Video thumbnail"
          className="w-full h-full object-cover"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-black/30 group-hover:bg-black/20 transition-colors flex items-center justify-center">
          <div className="w-14 h-14 rounded-full bg-[#9B7B5B] flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
            <Play className="w-6 h-6 text-[#1E1D1F] ml-0.5" fill="currentColor" />
          </div>
        </div>
      </button>
    );
  }

  return (
    <div className={`relative w-full aspect-video ${className ?? ""}`}>
      <iframe
        src={`https://www.youtube.com/embed/${youtubeVideoId}?autoplay=1&rel=0`}
        title="YouTube video"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        className="w-full h-full"
      />
    </div>
  );
}
