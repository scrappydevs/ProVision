"use client";

import { useCallback, useEffect, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

export default function WatchPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const hasSeeked = useRef(false);

  const videoUrl = searchParams.get("url");
  const startTimeParam = searchParams.get("t");
  const startTime = startTimeParam ? Math.max(0, Number.parseFloat(startTimeParam) || 0) : 0;

  const seekAndPlay = useCallback(() => {
    const video = videoRef.current;
    if (!video || hasSeeked.current) return;
    if (!Number.isFinite(video.duration) || video.duration <= 0) return;
    hasSeeked.current = true;
    const safeTime = Math.min(Math.max(0, startTime), video.duration - 0.05);
    video.currentTime = safeTime;
    video.play().catch(() => undefined);
  }, [startTime]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.readyState >= 1) {
      seekAndPlay();
      return;
    }
    video.addEventListener("loadedmetadata", seekAndPlay, { once: true });
    return () => video.removeEventListener("loadedmetadata", seekAndPlay);
  }, [seekAndPlay, videoUrl]);

  if (!videoUrl) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
        <p className="text-[#8A8885]">No video URL provided</p>
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 text-sm text-[#9B7B5B] hover:text-[#B8956B]"
        >
          <ArrowLeft className="w-4 h-4" />
          Go back
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <div className="absolute top-4 left-4 z-10">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-black/50 hover:bg-black/70 text-[#E8E6E3] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="text-sm">Back</span>
        </button>
      </div>
      <div className="flex-1 flex items-center justify-center min-h-0 p-4">
        <video
          ref={videoRef}
          src={videoUrl}
          className="max-w-full max-h-full object-contain"
          controls
          playsInline
        />
      </div>
    </div>
  );
}
