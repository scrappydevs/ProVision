"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Video, Plus, Play, Loader2, ExternalLink, Trash2, Clock, Scissors, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { listYouTubeClips, analyzeYouTubeClip, getYouTubeMetadata, deleteYouTubeClip } from "@/lib/api";
import { YouTubeClipCreator } from "@/components/youtube/YouTubeClipCreator";
import { motion, AnimatePresence } from "framer-motion";

export default function YouTubeClipsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [showCreator, setShowCreator] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [metadata, setMetadata] = useState<any>(null);
  const [fetchingMeta, setFetchingMeta] = useState(false);
  const [search, setSearch] = useState("");
  
  const { data: clips, isLoading, error } = useQuery({
    queryKey: ["youtube-clips"],
    queryFn: async () => {
      const response = await listYouTubeClips();
      console.log('[YouTubeClips] Fetched clips:', response.data);
      return response.data;
    },
    refetchInterval: 3000, // Auto-refresh every 3 seconds to show processing status
  });
  
  // Log any fetch errors
  if (error) {
    console.error('[YouTubeClips] Fetch error:', error);
  }
  
  const analyzeMutation = useMutation({
    mutationFn: analyzeYouTubeClip,
    onSuccess: (data) => {
      if (data.data.session_id) {
        router.push(`/dashboard/games/${data.data.session_id}`);
      }
    },
  });
  
  const deleteMutation = useMutation({
    mutationFn: deleteYouTubeClip,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["youtube-clips"] });
    },
  });
  
  const handleFetchMetadata = async () => {
    if (!youtubeUrl.trim()) return;
    setFetchingMeta(true);
    try {
      console.log('[YouTubeClips] Fetching metadata for:', youtubeUrl);
      const meta = await getYouTubeMetadata(youtubeUrl);
      console.log('[YouTubeClips] Metadata received:', meta.data);
      setMetadata(meta.data);
      setShowCreator(true);
    } catch (err: any) {
      console.error("[YouTubeClips] Metadata fetch failed:", err);
      const errorMsg = err?.response?.data?.detail || err?.message || "Unknown error";
      alert(`Failed to fetch video metadata: ${errorMsg}\n\nPlease check:\n1. The URL is a valid YouTube link\n2. The video is publicly accessible`);
    } finally {
      setFetchingMeta(false);
    }
  };
  
  const handleClipCreated = (clipId: string) => {
    console.log('[YouTubeClips] Clip created, refreshing list:', clipId);
    queryClient.invalidateQueries({ queryKey: ["youtube-clips"] });
    setShowCreator(false);
    setYoutubeUrl("");
    setMetadata(null);
    // Show success message
    setTimeout(() => {
      alert('Clip created! Processing will complete in ~5 seconds.');
    }, 100);
  };
  
  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "text-green-400 bg-green-400/10";
      case "processing":
        return "text-blue-400 bg-blue-400/10";
      case "pending":
        return "text-yellow-400 bg-yellow-400/10";
      case "failed":
        return "text-red-400 bg-red-400/10";
      default:
        return "text-muted-foreground bg-muted";
    }
  };
  
  // Filter clips by search
  const filteredClips = clips?.filter((clip) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      clip.title?.toLowerCase().includes(q) ||
      clip.youtube_video_id?.toLowerCase().includes(q)
    );
  });

  const completedCount = clips?.filter((c) => c.status === "completed").length || 0;
  const processingCount = clips?.filter((c) => c.status === "processing").length || 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-light text-foreground">YouTube Clips</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Create and analyze clips from YouTube videos</p>
        </div>
        {!showCreator && (
          <Button
            onClick={() => setShowCreator(true)}
            className="bg-[#9B7B5B] hover:bg-[#8A6B4B] text-primary-foreground text-sm gap-1.5"
          >
            <Plus className="w-4 h-4" />
            New Clip
          </Button>
        )}
      </div>
      
      {/* Stats Bar */}
      {clips && clips.length > 0 && (
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-3">
            <Video className="w-3.5 h-3.5 text-[#9B7B5B]" />
            <div>
              <p className="text-[10px] text-foreground/40 uppercase tracking-wider">Total Clips</p>
              <p className="text-xl font-light text-foreground">{clips.length}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Scissors className="w-3.5 h-3.5 text-green-400" />
            <div>
              <p className="text-[10px] text-foreground/40 uppercase tracking-wider">Ready</p>
              <p className="text-xl font-light text-foreground">{completedCount}</p>
            </div>
          </div>
          {processingCount > 0 && (
            <div className="flex items-center gap-3">
              <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" />
              <div>
                <p className="text-[10px] text-foreground/40 uppercase tracking-wider">Processing</p>
                <p className="text-xl font-light text-foreground">{processingCount}</p>
              </div>
            </div>
          )}
        </div>
      )}
      
      {/* Add Clip Section */}
      <AnimatePresence>
        {showCreator && !metadata && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="border-b border-white/10 pb-4 mb-2">
              <div className="flex items-center gap-2 mb-3">
                <Scissors className="w-3.5 h-3.5 text-[#9B7B5B]" />
                <span className="text-xs text-foreground/60 uppercase tracking-wider">Add YouTube Video</span>
              </div>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={youtubeUrl}
                  onChange={(e) => setYoutubeUrl(e.target.value)}
                  placeholder="https://youtube.com/watch?v=..."
                  className="flex-1 bg-transparent border-b border-white/10 px-0 py-1.5 text-sm text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-[#9B7B5B]/60 transition-colors"
                  onKeyDown={(e) => e.key === "Enter" && handleFetchMetadata()}
                  autoFocus
                />
                <Button
                  onClick={handleFetchMetadata}
                  disabled={fetchingMeta || !youtubeUrl.trim()}
                  size="sm"
                  className="bg-[#9B7B5B] hover:bg-[#8A6B4B]"
                >
                  {fetchingMeta && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
                  Continue
                </Button>
                <Button
                  onClick={() => {
                    setShowCreator(false);
                    setYoutubeUrl("");
                  }}
                  variant="ghost"
                  size="sm"
                  className="text-foreground/40"
                >
                  Cancel
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Clip Creator */}
      <AnimatePresence>
        {showCreator && metadata && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
          >
            <YouTubeClipCreator
              youtubeUrl={youtubeUrl}
              youtubeId={metadata.youtube_video_id}
              videoTitle={metadata.title}
              duration={metadata.duration_seconds}
              onClipCreated={handleClipCreated}
              onClose={() => {
                setShowCreator(false);
                setMetadata(null);
                setYoutubeUrl("");
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Search */}
      {clips && clips.length > 0 && !showCreator && (
        <div className="relative max-w-xs">
          <Search className="absolute left-0 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground/30" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search clips..."
            className="w-full bg-transparent border-b border-white/10 pl-6 pr-3 py-1.5 text-xs text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-[#9B7B5B]/60 transition-colors"
          />
        </div>
      )}
      
      {/* Clips Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {filteredClips?.map((clip) => (
          <motion.div
            key={clip.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="group relative"
          >
            <div className="bg-card border border-border/50 rounded-lg overflow-hidden hover:border-[#9B7B5B]/50 transition-all">
              {/* Thumbnail */}
              <div className="aspect-video bg-black relative overflow-hidden">
                {clip.thumbnail_url && (
                  <img
                    src={clip.thumbnail_url}
                    alt={clip.title || "YouTube clip"}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                )}
                
                {/* Duration badge */}
                <div className="absolute bottom-2 right-2 bg-black/80 backdrop-blur-sm px-2 py-0.5 rounded text-[10px] font-mono text-white">
                  {Math.floor(clip.duration)}s
                </div>
                
                {/* Status badge */}
                <div className="absolute top-2 left-2">
                  {clip.status === "processing" && (
                    <span className="flex items-center gap-1 bg-blue-400/20 backdrop-blur-sm text-blue-400 px-2 py-0.5 rounded text-[10px]">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Processing
                    </span>
                  )}
                  {clip.status === "pending" && (
                    <span className="flex items-center gap-1 bg-yellow-400/20 backdrop-blur-sm text-yellow-400 px-2 py-0.5 rounded text-[10px]">
                      <Clock className="w-3 h-3" />
                      Pending
                    </span>
                  )}
                  {clip.status === "failed" && (
                    <span className="bg-red-400/20 backdrop-blur-sm text-red-400 px-2 py-0.5 rounded text-[10px]">
                      Failed
                    </span>
                  )}
                </div>
                
                {/* Delete button on hover */}
                <button
                  onClick={() => {
                    if (confirm("Delete this clip?")) {
                      deleteMutation.mutate(clip.id);
                    }
                  }}
                  className="absolute top-2 right-2 p-1.5 bg-black/80 backdrop-blur-sm rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/80"
                >
                  <Trash2 className="w-3.5 h-3.5 text-white" />
                </button>
              </div>
              
              {/* Info */}
              <div className="p-3">
                <h4 className="text-sm font-light text-foreground line-clamp-2 mb-2">
                  {clip.title || "Untitled Clip"}
                </h4>
                
                <div className="flex items-center justify-between text-[10px] text-foreground/40 mb-3">
                  <span>{Math.floor(clip.clip_start_time)}s - {Math.floor(clip.clip_end_time)}s</span>
                  <span>{new Date(clip.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                </div>
                
                {clip.error_message && (
                  <p className="text-[10px] text-red-400 mb-2 line-clamp-2">
                    {clip.error_message}
                  </p>
                )}
                
                {/* Actions */}
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    onClick={() => analyzeMutation.mutate(clip.id)}
                    disabled={clip.status !== "completed" || analyzeMutation.isPending}
                    className="flex-1 h-7 text-xs bg-[#9B7B5B] hover:bg-[#8A6B4B] disabled:opacity-40"
                  >
                    {analyzeMutation.isPending ? (
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                    ) : (
                      <Play className="w-3 h-3 mr-1" />
                    )}
                    Analyze
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => window.open(clip.youtube_url, "_blank")}
                    className="h-7 px-2 border-white/10"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
      
      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 text-[#9B7B5B] animate-spin" />
        </div>
      )}
      
      {!isLoading && clips?.length === 0 && !showCreator && (
        <div className="flex flex-col items-center justify-center py-16">
          <div className="w-16 h-16 rounded-2xl bg-card flex items-center justify-center mb-4">
            <Video className="w-8 h-8 text-[#9B7B5B]/40" />
          </div>
          <h3 className="text-base font-light text-foreground mb-1">No clips yet</h3>
          <p className="text-xs text-foreground/40 mb-4">Create your first YouTube clip to analyze</p>
          <Button
            onClick={() => setShowCreator(true)}
            className="bg-[#9B7B5B] hover:bg-[#8A6B4B] text-sm"
          >
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            Add YouTube Video
          </Button>
        </div>
      )}
      
      {!isLoading && filteredClips && filteredClips.length === 0 && search && clips && clips.length > 0 && (
        <div className="text-center py-12 text-foreground/40">
          <p className="text-sm">No clips match "{search}"</p>
        </div>
      )}
    </div>
  );
}
