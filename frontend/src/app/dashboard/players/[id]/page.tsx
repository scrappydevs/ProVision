"use client";

import { useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardFooter, ScrollShadow } from "@heroui/react";
import {
  ArrowLeft, Edit2, Loader2, Search, Upload, Plus, Play,
  Clock, CheckCircle, XCircle, Gamepad2, Calendar, ChevronRight,
  RefreshCw, Trophy, Scissors, Film,
  Video, Clapperboard, Trash2,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  usePlayer, usePlayerGames, useUploadAvatar, useUpdatePlayer,
  useSyncITTF, usePlayerRecordings, useCreateRecording,
  useDeleteRecording, useCreateClip, useAnalyzeRecording,
} from "@/hooks/usePlayers";
import { GameTimeline } from "@/components/players/GameTimeline";
import { createSession, GamePlayerInfo, RecordingType, Recording } from "@/lib/api";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { playerKeys } from "@/hooks/usePlayers";
import { sessionKeys } from "@/hooks/useSessions";
import ClipSelector from "@/components/players/ClipSelector";

type Tab = "recordings" | "games";
type RecordingFilter = "all" | RecordingType;
type InsightKind = "strength" | "weakness";

type InsightClip = {
  id: string;
  label: string;
  sessionId?: string;
  videoUrl?: string;
  timestamp?: string;
  startSeconds?: number;
};

type Insight = {
  id: string;
  kind: InsightKind;
  title: string;
  summary: string;
  metric?: string;
  tipMatch?: string;
  clips: InsightClip[];
};

const RECORDING_TYPES: { value: RecordingType; label: string; icon: React.ReactNode }[] = [
  { value: "match", label: "Match", icon: <Trophy className="w-3.5 h-3.5" /> },
  { value: "informal", label: "Informal", icon: <Video className="w-3.5 h-3.5" /> },
  { value: "clip", label: "Clip", icon: <Scissors className="w-3.5 h-3.5" /> },
  { value: "highlight", label: "Highlight", icon: <Clapperboard className="w-3.5 h-3.5" /> },
];

const TYPE_COLORS: Record<RecordingType, string> = {
  match: "bg-[#9B7B5B]/20 text-primary",
  informal: "bg-[#6B8E6B]/20 text-[#6B8E6B]",
  clip: "bg-[#7B8ECE]/20 text-[#7B8ECE]",
  highlight: "bg-[#CE7B9B]/20 text-[#CE7B9B]",
};

export default function PlayerProfilePage() {
  const params = useParams();
  const router = useRouter();
  const playerId = params.id as string;
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<Tab>("recordings");
  const [recordingFilter, setRecordingFilter] = useState<RecordingFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [expandedRecordingId, setExpandedRecordingId] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [gameName, setGameName] = useState("");
  const [gameDate, setGameDate] = useState(new Date().toISOString().split("T")[0]);
  const [recordingType, setRecordingType] = useState<RecordingType>("match");
  const [recordingDescription, setRecordingDescription] = useState("");
  const [analyzingRecordingId, setAnalyzingRecordingId] = useState<string | null>(null);
  const { data: player, isLoading: playerLoading } = usePlayer(playerId);
  const { data: games, isLoading: gamesLoading } = usePlayerGames(playerId, {
    search: searchQuery || undefined,
    status: statusFilter || undefined,
  });
  const { data: recordings, isLoading: recordingsLoading } = usePlayerRecordings(
    playerId,
    recordingFilter === "all" ? undefined : recordingFilter
  );
  const uploadAvatarMutation = useUploadAvatar();
  const updatePlayerMutation = useUpdatePlayer();
  const syncITTFMutation = useSyncITTF();
  const createRecordingMutation = useCreateRecording();
  const deleteRecordingMutation = useDeleteRecording();
  const createClipMutation = useCreateClip();
  const analyzeRecordingMutation = useAnalyzeRecording();

  const createGameMutation = useMutation({
    mutationFn: async ({ file, name }: { file: File; name: string }) => {
      const formData = new FormData();
      formData.append("video", file);
      formData.append("name", name);
      formData.append("player_ids", playerId);
      return createSession(formData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: playerKeys.games(playerId) });
      queryClient.invalidateQueries({ queryKey: playerKeys.detail(playerId) });
      queryClient.invalidateQueries({ queryKey: sessionKeys.lists() });
      setUploadOpen(false);
      setSelectedFile(null);
      setGameName("");
    },
  });

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadAvatarMutation.mutate({ playerId, file });
  };

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") setDragActive(true);
    else if (e.type === "dragleave") setDragActive(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files?.[0]) setSelectedFile(e.dataTransfer.files[0]);
  }, []);

  const handleUpload = () => {
    if (!selectedFile || !gameName.trim()) return;

    if (activeTab === "recordings" || recordingType !== "match") {
      const formData = new FormData();
      formData.append("video", selectedFile);
      formData.append("title", gameName.trim());
      formData.append("player_id", playerId);
      formData.append("type", recordingType);
      if (recordingDescription.trim()) {
        formData.append("description", recordingDescription.trim());
      }
      createRecordingMutation.mutate(formData, {
        onSuccess: () => {
          setUploadOpen(false);
          setSelectedFile(null);
          setGameName("");
          setRecordingDescription("");
        },
      });
    } else {
      createGameMutation.mutate({ file: selectedFile, name: gameName.trim() });
    }
  };

  const handleClipCreate = (recordingId: string, title: string) => (startTime: number, endTime: number) => {
    const formData = new FormData();
    formData.append("title", `${title} - Clip`);
    formData.append("clip_start_time", startTime.toString());
    formData.append("clip_end_time", endTime.toString());
    createClipMutation.mutate(
      { recordingId, data: formData },
      {
        onSuccess: () => {
          setExpandedRecordingId(null);
        },
      }
    );
  };

  const handleAnalyze = (recordingId: string) => (startTime: number, endTime: number) => {
    const formData = new FormData();
    formData.append("clip_start_time", startTime.toString());
    formData.append("clip_end_time", endTime.toString());
    analyzeRecordingMutation.mutate(
      { recordingId, data: formData },
      {
        onSuccess: (result) => {
          router.push(`/dashboard/games/${result.session_id}`);
        },
      }
    );
  };

  if (playerLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  if (!player) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <p className="text-sm text-foreground/60">Player not found</p>
        <Button variant="outline" className="mt-4" onClick={() => router.push("/dashboard")}>
          Back to Players
        </Button>
      </div>
    );
  }

  const initials = player.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const gameCount = player.game_count ?? 0;
  const lastGame = games?.[0];

  const statusOptions = [
    { value: "", label: "All" },
    { value: "pending", label: "Pending" },
    { value: "processing", label: "Processing" },
    { value: "completed", label: "Ready" },
    { value: "failed", label: "Failed" },
  ];

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "pending": return <Clock className="w-3.5 h-3.5 text-foreground/60" />;
      case "processing": return <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />;
      case "completed": return <CheckCircle className="w-3.5 h-3.5 text-[#6B8E6B]" />;
      case "failed": return <XCircle className="w-3.5 h-3.5 text-[#C45C5C]" />;
      default: return null;
    }
  };

  const getStatusLabel = (status: string) =>
    statusOptions.find((o) => o.value === status)?.label ?? status;

  const ittfData = player.ittf_data;

  const formatTime = (seconds?: number) => {
    if (seconds === undefined || Number.isNaN(seconds)) return null;
    const minutes = Math.floor(seconds / 60);
    const remainder = Math.floor(seconds % 60);
    return `${minutes}:${remainder.toString().padStart(2, "0")}`;
  };

  const clipCandidates = (recordings ?? []).filter(
    (rec) => !!rec.session_id || !!rec.video_path
  );

  const clipRefs: InsightClip[] = clipCandidates.slice(0, 3).map((rec) => {
    const start = formatTime(rec.clip_start_time);
    const end = formatTime(rec.clip_end_time);
    const timestamp = start && end ? `${start} - ${end}` : start ?? undefined;
    const safeStart = Math.max(0, (rec.clip_start_time ?? 0) - 0.1);

    return {
      id: rec.id,
      label: rec.title,
      sessionId: rec.session_id,
      videoUrl: rec.video_path,
      timestamp,
      startSeconds: safeStart,
    };
  });

  const insights: Insight[] = [
    {
      id: "strength-forehand",
      kind: "strength",
      title: "Forehand power",
      summary: "Explosive hip rotation and clean wrist snap on fast rallies",
      metric: "Maintain in multi-ball and shadow drills",
      tipMatch: "forehand",
      clips: clipRefs,
    },
    {
      id: "strength-footwork",
      kind: "strength",
      title: "Recovery speed",
      summary: "Quick reset to neutral stance after wide exchanges",
      metric: "Add lateral recovery between shots in drills",
      clips: clipRefs,
    },
    {
      id: "strength-placement",
      kind: "strength",
      title: "Shot placement",
      summary: "Consistent targeting of opponent's weak zones",
      metric: "Target corners and body in practice games",
      clips: clipRefs,
    },
    {
      id: "strength-anticipation",
      kind: "strength",
      title: "Ball anticipation",
      summary: "Early read on opponent's shot direction",
      metric: "Watch opponent racket angle before contact",
      clips: clipRefs,
    },
    {
      id: "weakness-backhand",
      kind: "weakness",
      title: "Backhand depth",
      summary: "Contact point drifts high under pressure",
      metric: "Contact ball earlier, in front of body",
      tipMatch: "backhand",
      clips: clipRefs,
    },
    {
      id: "weakness-serve",
      kind: "weakness",
      title: "Serve variation",
      summary: "Limited spin variation on second serve",
      metric: "Add topspin, backspin, or sidespin to second serve",
      clips: clipRefs,
    },
  ];

  const handleClipOpen = (clip: InsightClip, tipMatch?: string) => {
    if (clip.sessionId) {
      const params = new URLSearchParams();
      if (clip.startSeconds != null) params.set("t", clip.startSeconds.toFixed(2));
      if (tipMatch) params.set("tip", tipMatch);
      const query = params.toString() ? `?${params.toString()}` : "";
      router.push(`/dashboard/games/${clip.sessionId}${query}`);
      return;
    }
    if (clip.videoUrl) {
      const params = new URLSearchParams({ url: clip.videoUrl });
      if (clip.startSeconds != null) params.set("t", clip.startSeconds.toFixed(2));
      router.push(`/dashboard/watch?${params.toString()}`);
    }
  };

  return (
    <div className="-m-6 h-[calc(100vh-4rem)] relative overflow-hidden player-profile">
      {/* Hero background with smaller profile picture */}
      <div className="absolute inset-0">
        {/* Cool animated gradient background - adapts to light/dark mode */}
        <div className="absolute inset-0 bg-gradient-to-br from-background via-muted to-background" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_20%_30%,rgba(155,123,91,0.12),transparent_50%),radial-gradient(ellipse_at_80%_70%,rgba(91,123,155,0.08),transparent_50%),radial-gradient(circle_at_50%_50%,rgba(155,91,123,0.06),transparent_60%)]" />
        
        {/* Profile picture - smaller, positioned on right side */}
        {player.avatar_url && (
          <div className="absolute right-0 top-0 bottom-0 w-[95%] overflow-hidden">
            <img 
              src={player.avatar_url} 
              alt="" 
              className="w-full h-full object-cover object-center opacity-60 dark:opacity-95"
            />
            {/* Gradient overlay for smooth blend */}
            <div className="absolute inset-0 bg-gradient-to-l from-transparent via-background/10 to-background/60" />
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-background/40" />
          </div>
        )}
        
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/30 to-background/10 player-hero-gradient-top" />
        <div className="absolute inset-0 bg-gradient-to-r from-background via-background/15 to-transparent player-hero-gradient-side" />
      </div>

      {/* Content overlay */}
      <div className="relative h-full flex flex-col">
        {/* Top nav bar */}
        <div className="flex items-center justify-between px-10 pt-7">
          <button
            className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.25em] text-foreground/60 hover:text-foreground transition-colors"
            onClick={() => router.push("/dashboard")}
          >
            <ArrowLeft className="w-4 h-4" />
            All Players
          </button>
          <input id="avatar-upload" type="file" accept="image/*" onChange={handleAvatarUpload} className="hidden" />
        </div>

        {/* Center: large name overlay */}
        <div className="flex-1 flex items-start pt-20 px-10 pb-48">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-foreground/50 mb-3">{player.position || "Player"}</p>
            <h1 className="text-5xl md:text-6xl font-light text-foreground tracking-tight leading-[1.1]">
              {player.name.split(" ").map((word, i) => (
                <span key={i}>{word}{i < player.name.split(" ").length - 1 ? <br /> : ""}</span>
              ))}
            </h1>
            <div className="flex items-center gap-3 mt-4">
              {player.team && (
                <span className="text-sm text-foreground/70">{player.team}</span>
              )}
              {player.team && <span className="w-1 h-1 rounded-full bg-content3" />}
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wide ${
                  player.is_active ? "bg-[#6B8E6B]/15 text-[#6B8E6B]" : "bg-muted-foreground/15 text-foreground/60"
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${player.is_active ? "bg-[#6B8E6B]" : "bg-muted-foreground"}`} />
                {player.is_active ? "Active" : "Inactive"}
              </span>
              <span className="w-1 h-1 rounded-full bg-content3" />
              <button
                onClick={() => {
                  const next = player.handedness === "right" ? "left" : "right";
                  updatePlayerMutation.mutate({ id: playerId, data: { handedness: next } });
                }}
                className="flex items-center gap-1.5 text-xs text-foreground/60 hover:text-foreground transition-colors"
              >
                <span className={player.handedness === "left" ? "text-primary font-semibold" : ""}>Left</span>
                <span className="mx-1 text-foreground/60 dark:text-foreground/30">/</span>
                <span className={player.handedness === "right" ? "text-primary font-semibold" : ""}>Right</span>
              </button>
            </div>
          </div>
        </div>

        {/* Bottom-left: key stats */}
        <div className="player-stats-card absolute bottom-8 left-10">
          <div className="grid grid-cols-3 gap-10">
            <div>
              <p className="text-3xl font-light text-foreground">{gameCount}</p>
              <p className="text-xs uppercase tracking-[0.25em] text-foreground/50 mt-2">Games</p>
            </div>
            <div>
              <p className="text-3xl font-light text-foreground">{recordings?.length ?? 0}</p>
              <p className="text-xs uppercase tracking-[0.25em] text-foreground/50 mt-2">Recordings</p>
            </div>
            <div>
              <p className="text-3xl font-light text-foreground">
                {lastGame
                  ? new Date(lastGame.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                  : "—"}
              </p>
              <p className="text-xs uppercase tracking-[0.25em] text-foreground/50 mt-2">Last Active</p>
            </div>
          </div>
        </div>

        {/* Left: tips summary */}
        <div className="absolute left-10 bottom-24 w-[480px] flex flex-col gap-2">
          {recordingsLoading ? (
            <div className="flex items-center justify-center h-20 bg-content1/30 backdrop-blur-xl rounded-xl">
              <Loader2 className="w-3 h-3 text-primary animate-spin" />
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {/* Strengths Section */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 px-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#6B8E6B]" />
                  <span className="text-[10px] uppercase tracking-wider text-[#6B8E6B] font-semibold">Strengths</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {insights.filter(i => i.kind === "strength").map((insight) => (
                    <div key={insight.id} className="relative group">
                      <div className="text-left p-2.5 rounded-lg bg-content1/30 backdrop-blur-xl hover:bg-content1/40 transition-all">
                        <h4 className="text-xs font-semibold text-foreground/95 mb-0.5 leading-tight">
                          {insight.title}
                        </h4>
                        <p className="text-[10px] text-foreground/60 line-clamp-2 leading-snug mb-1.5">
                          {insight.summary}
                        </p>
                        {insight.metric && (
                          <div className="flex items-center gap-1">
                            <p className="text-[9px] text-[#6B8E6B] font-medium flex-1">
                              {insight.metric}
                            </p>
                            {insight.clips.length > 0 && (
                              <span className="text-[8px] text-foreground/40">
                                {insight.clips.length} clip{insight.clips.length > 1 ? 's' : ''}
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Hover panel for clips */}
                      {insight.clips.length > 0 && (
                        <div className="absolute left-full top-0 ml-2 z-50 w-56 rounded-lg bg-content1/95 backdrop-blur-xl shadow-2xl overflow-hidden opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200">
                          <div className="p-2 space-y-1">
                            <div className="px-2 py-1 text-[9px] uppercase tracking-wider text-foreground/60 font-semibold">
                              Source clips
                            </div>
                            {insight.clips.map((clip) => (
                              <button
                                key={clip.id}
                                onClick={() => handleClipOpen(clip, insight.tipMatch)}
                                className="w-full flex items-center gap-2 rounded-md bg-content1/40 p-1.5 text-left hover:bg-content1/60 transition-colors"
                              >
                                {clip.videoUrl && (
                                  <div className="relative w-12 h-9 rounded overflow-hidden shrink-0 bg-background">
                                    <video src={clip.videoUrl} className="w-full h-full object-cover" muted />
                                    <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                                      <Play className="w-3 h-3 text-white/80" />
                                    </div>
                                  </div>
                                )}
                                <div className="flex-1 min-w-0">
                                  <p className="text-[10px] text-foreground/90 truncate font-medium">{clip.label}</p>
                                  {clip.timestamp && (
                                    <p className="text-[8px] text-foreground/50">{clip.timestamp}</p>
                                  )}
                                </div>
                                <ChevronRight className="w-3 h-3 text-foreground/40 shrink-0" />
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Weaknesses Section */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 px-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#C45C5C]" />
                  <span className="text-[10px] uppercase tracking-wider text-[#C45C5C] font-semibold">Areas to improve</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {insights.filter(i => i.kind === "weakness").map((insight) => (
                    <div key={insight.id} className="relative group">
                      <div className="text-left p-2.5 rounded-lg bg-content1/30 backdrop-blur-xl hover:bg-content1/40 transition-all">
                        <h4 className="text-xs font-semibold text-foreground/95 mb-0.5 leading-tight">
                          {insight.title}
                        </h4>
                        <p className="text-[10px] text-foreground/60 line-clamp-2 leading-snug mb-1.5">
                          {insight.summary}
                        </p>
                        {insight.metric && (
                          <div className="flex items-center gap-1">
                            <p className="text-[9px] text-[#C45C5C] font-medium flex-1">
                              {insight.metric}
                            </p>
                            {insight.clips.length > 0 && (
                              <span className="text-[8px] text-foreground/40">
                                {insight.clips.length} clip{insight.clips.length > 1 ? 's' : ''}
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Hover panel for clips */}
                      {insight.clips.length > 0 && (
                        <div className="absolute left-full top-0 ml-2 z-50 w-56 rounded-lg bg-content1/95 backdrop-blur-xl shadow-2xl overflow-hidden opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200">
                          <div className="p-2 space-y-1">
                            <div className="px-2 py-1 text-[9px] uppercase tracking-wider text-foreground/60 font-semibold">
                              Source clips
                            </div>
                            {insight.clips.map((clip) => (
                              <button
                                key={clip.id}
                                onClick={() => handleClipOpen(clip, insight.tipMatch)}
                                className="w-full flex items-center gap-2 rounded-md bg-content1/40 p-1.5 text-left hover:bg-content1/60 transition-colors"
                              >
                                {clip.videoUrl && (
                                  <div className="relative w-12 h-9 rounded overflow-hidden shrink-0 bg-background">
                                    <video src={clip.videoUrl} className="w-full h-full object-cover" muted />
                                    <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                                      <Play className="w-3 h-3 text-white/80" />
                                    </div>
                                  </div>
                                )}
                                <div className="flex-1 min-w-0">
                                  <p className="text-[10px] text-foreground/90 truncate font-medium">{clip.label}</p>
                                  {clip.timestamp && (
                                    <p className="text-[8px] text-foreground/50">{clip.timestamp}</p>
                                  )}
                                </div>
                                <ChevronRight className="w-3 h-3 text-foreground/40 shrink-0" />
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right: recordings — larger and more prominent */}
        <div className="absolute right-6 top-[15%] bottom-6 w-[420px] flex flex-col z-20">
          {/* Header with enhanced styling */}
          <div className="flex flex-col gap-3 mb-5 px-4 py-3 bg-content1/30 backdrop-blur-xl rounded-3xl border border-foreground/15">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-xs uppercase tracking-[0.25em] text-foreground/70">Recordings</span>
                {recordings && recordings.length > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-primary/15 text-primary text-[10px] font-medium">{recordings.length}</span>
                )}
              </div>
              <button
                onClick={() => setUploadOpen(true)}
                className="flex items-center gap-1.5 text-[10px] px-2.5 py-1.5 rounded-full transition-all font-medium uppercase tracking-[0.2em] text-foreground/60 hover:text-primary hover:bg-primary/10"
              >
                <Plus className="w-3.5 h-3.5" />
                Add
              </button>
            </div>
            <div className="flex items-center gap-2">
              {(["all", "match", "informal", "clip"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setRecordingFilter(f)}
                  className={`text-[10px] px-2.5 py-1.5 rounded-full transition-all font-medium uppercase tracking-[0.15em] whitespace-nowrap ${
                    recordingFilter === f
                      ? "bg-primary/15 text-primary backdrop-blur-sm"
                      : "text-foreground/40 hover:text-foreground/70 hover:bg-foreground/5"
                  }`}
                >
                  {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Recording cards — larger with more details */}
          <div className="flex-1 overflow-y-auto space-y-4 pr-2 scrollbar-thin">
            {recordingsLoading ? (
              <div className="flex items-center justify-center h-20">
                <Loader2 className="w-4 h-4 text-primary animate-spin" />
              </div>
            ) : recordings && recordings.length > 0 ? (
              recordings.map((rec: Recording) => (
                <div
                  key={rec.id}
                  onClick={() => {
                    if (rec.session_id) {
                      router.push(`/dashboard/games/${rec.session_id}`);
                    } else if (!analyzingRecordingId) {
                      setAnalyzingRecordingId(rec.id);
                      const dur = rec.duration ?? 30;
                      const formData = new FormData();
                      formData.append("clip_start_time", "0");
                      formData.append("clip_end_time", Math.min(dur, 45).toString());
                      analyzeRecordingMutation.mutate(
                        { recordingId: rec.id, data: formData },
                        {
                          onSuccess: (result) => {
                            setAnalyzingRecordingId(null);
                            router.push(`/dashboard/games/${result.session_id}`);
                          },
                          onError: () => setAnalyzingRecordingId(null),
                        }
                      );
                    }
                  }}
                  className="group cursor-pointer flex gap-5 items-start p-4 rounded-2xl transition-colors bg-content1/30 backdrop-blur-xl border border-foreground/10 hover:border-foreground/20 hover:bg-content1/40"
                >
                  {rec.video_path && (
                    <div className="relative w-36 h-24 rounded-xl overflow-hidden shrink-0 ring-1 ring-white/10">
                      <video src={rec.video_path} className="w-full h-full object-cover" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0 pt-1">
                    <p className="text-base font-semibold text-foreground/95 truncate mb-1.5">{rec.title}</p>
                    <div className="flex items-center gap-2.5 mb-2">
                      <span className="text-[10px] uppercase tracking-[0.2em] text-primary font-semibold px-2 py-0.5 rounded-md bg-primary/15">{rec.type}</span>
                      <span className="w-1 h-1 rounded-full bg-foreground/20" />
                      <span className="text-xs text-foreground/40">
                        {new Date(rec.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </span>
                    </div>
                    {rec.session_id ? (
                      <div className="flex items-center gap-1.5">
                        <CheckCircle className="w-3.5 h-3.5 text-success/80" />
                        <span className="text-xs text-success/80 font-medium">Ready to view</span>
                      </div>
                    ) : analyzingRecordingId === rec.id ? (
                      <div className="flex items-center gap-1.5">
                        <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />
                        <span className="text-xs text-primary/80 font-medium">Analyzing...</span>
                      </div>
                    ) : (
                      <span className="text-xs text-foreground/30 group-hover:text-primary/70 font-medium transition-colors">Click to analyze</span>
                    )}
                  </div>
                  <ChevronRight className="w-5 h-5 text-foreground/20 group-hover:text-primary/60 shrink-0 transition-all group-hover:translate-x-1" />
                </div>
              ))
            ) : (
              <div className="text-center py-16">
                <p className="text-xs text-foreground/30">No recordings yet</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Upload modal (unchanged) */}
      <AnimatePresence>
        {uploadOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
            onClick={() => setUploadOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-content1 rounded-2xl w-full max-w-md p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-base font-medium text-foreground mb-1">New recording</h2>
              <p className="text-[11px] text-foreground/45 mb-4">Upload footage for {player.name}</p>

              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] uppercase tracking-[0.2em] text-foreground/50 mb-2">Type</label>
                  <div className="grid grid-cols-4 gap-2">
                    {RECORDING_TYPES.map((rt) => (
                      <button
                        key={rt.value}
                        onClick={() => setRecordingType(rt.value)}
                        className={`flex flex-col items-center gap-1.5 px-2 py-2.5 rounded-lg border transition-all text-[11px] ${
                          recordingType === rt.value
                            ? "border-[#9B7B5B] bg-[#9B7B5B]/10 text-primary"
                            : "border-content3 text-foreground/40 hover:border-[#9B7B5B]/50 hover:text-foreground/60"
                        }`}
                      >
                        {rt.icon}
                        {rt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] uppercase tracking-[0.2em] text-foreground/50 mb-1.5">Title</label>
                  <input
                    type="text"
                    value={gameName}
                    onChange={(e) => setGameName(e.target.value)}
                    placeholder={recordingType === "match" ? "Opponent, round" : "Practice session"}
                    className="w-full px-3 py-2 bg-background rounded-lg text-foreground placeholder-muted-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                </div>

                <div>
                  <label className="block text-[10px] uppercase tracking-[0.2em] text-foreground/50 mb-1.5">Notes</label>
                  <textarea
                    value={recordingDescription}
                    onChange={(e) => setRecordingDescription(e.target.value)}
                    placeholder="Key moments, context..."
                    rows={2}
                    className="w-full px-3 py-2 bg-background rounded-lg text-foreground placeholder-muted-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none"
                  />
                </div>

                <div>
                  <label className="block text-[10px] uppercase tracking-[0.2em] text-foreground/50 mb-1.5">Video</label>
                  <div
                    className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
                      dragActive ? "border-[#9B7B5B] bg-[#9B7B5B]/10" : "border-content3 hover:border-[#9B7B5B]/50"
                    }`}
                    onDragEnter={handleDrag}
                    onDragLeave={handleDrag}
                    onDragOver={handleDrag}
                    onDrop={handleDrop}
                  >
                    {selectedFile ? (
                      <div className="flex items-center justify-between gap-3 w-full">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <Play className="w-6 h-6 text-primary shrink-0" />
                          <div className="text-left min-w-0">
                            <p className="text-xs text-foreground truncate">{selectedFile.name}</p>
                            <p className="text-[10px] text-foreground/40">{(selectedFile.size / 1024 / 1024).toFixed(1)} MB</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <label className="cursor-pointer">
                            <span className="text-[10px] text-primary hover:text-[#B8956D] px-2 py-1 rounded border border-content3 hover:border-[#9B7B5B]/50 transition-colors">Change</span>
                            <input type="file" accept="video/*" onChange={(e) => { if (e.target.files?.[0]) setSelectedFile(e.target.files[0]); }} className="hidden" />
                          </label>
                          <button onClick={() => setSelectedFile(null)} className="text-[10px] text-foreground/40 hover:text-[#C45C5C] px-2 py-1 rounded hover:bg-[#C45C5C]/10 transition-colors">
                            Remove
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <Upload className="w-6 h-6 text-foreground/40 mx-auto mb-2" />
                        <p className="text-xs text-foreground/40 mb-1">Drag and drop or</p>
                        <label>
                          <span className="text-xs text-primary hover:text-[#B8956D] cursor-pointer">browse files</span>
                          <input type="file" accept="video/*" onChange={(e) => { if (e.target.files?.[0]) setSelectedFile(e.target.files[0]); }} className="hidden" />
                        </label>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <Button variant="ghost" className="flex-1" onClick={() => setUploadOpen(false)}>Cancel</Button>
                <Button
                  className="flex-1"
                  onClick={handleUpload}
                  disabled={!selectedFile || !gameName.trim() || createRecordingMutation.isPending || createGameMutation.isPending}
                >
                  {createRecordingMutation.isPending || createGameMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    "Upload"
                  )}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
