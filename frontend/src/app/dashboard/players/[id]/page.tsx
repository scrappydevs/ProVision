"use client";

import { useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardFooter, ScrollShadow, Chip } from "@heroui/react";
import {
  ArrowLeft, Edit2, Loader2, Search, Upload, Plus, Play,
  Clock, CheckCircle, XCircle, Gamepad2, Calendar, ChevronRight,
  RefreshCw, Globe, Trophy, Scissors, Film,
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

  return (
    <div className="-m-4 md:-m-5 h-[calc(100vh-4rem)] relative overflow-hidden player-profile">
      {/* Full-bleed avatar background */}
      <div className="absolute inset-0">
        {player.avatar_url ? (
          <>
            <img src={player.avatar_url} alt="" className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-black/30 dark:bg-black/40 player-hero-dim" />
          </>
        ) : (
          <div className="w-full h-full bg-[radial-gradient(ellipse_at_30%_30%,rgba(155,123,91,0.15),transparent_60%),radial-gradient(ellipse_at_70%_70%,rgba(91,123,155,0.08),transparent_50%)]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/20 to-transparent player-hero-gradient-top" />
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-transparent to-background/40 player-hero-gradient-side" />
      </div>

      {/* Content overlay */}
      <div className="relative h-full flex flex-col">
        {/* Top nav bar */}
        <div className="flex items-center justify-between px-6 md:px-8 pt-4">
          <button
            className="flex items-center gap-1.5 text-sm text-foreground/80 dark:text-foreground/60 hover:text-foreground transition-colors"
            onClick={() => router.push("/dashboard")}
          >
            <ArrowLeft className="w-4 h-4" />
            All Players
          </button>
          <input id="avatar-upload" type="file" accept="image/*" onChange={handleAvatarUpload} className="hidden" />
        </div>

        {/* Center: large name overlay */}
        <div className="flex-1 flex items-center px-6 md:px-8">
          <div>
            <p className="text-sm text-foreground/70 dark:text-foreground/50 mb-1">{player.position || "Player"}</p>
            <h1 className="text-5xl md:text-7xl font-light text-foreground tracking-tight leading-[1.05]">
              {player.name.split(" ").map((word, i) => (
                <span key={i}>{word}{i < player.name.split(" ").length - 1 ? <br /> : ""}</span>
              ))}
            </h1>
            <div className="flex items-center gap-3 mt-3">
              {player.team && (
                <span className="text-sm text-foreground/80 dark:text-foreground/60">{player.team}</span>
              )}
              {player.team && <span className="w-1 h-1 rounded-full bg-content3" />}
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] ${
                  player.is_active ? "bg-[#6B8E6B]/20 text-[#6B8E6B]" : "bg-muted-foreground/20 text-foreground/60"
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
                className="flex items-center gap-1.5 text-xs text-foreground/70 dark:text-foreground/40 hover:text-foreground transition-colors"
              >
                <span className={player.handedness === "left" ? "text-primary font-semibold" : ""}>Left</span>
                <span className="mx-1 text-foreground/60 dark:text-foreground/30">/</span>
                <span className={player.handedness === "right" ? "text-primary font-semibold" : ""}>Right</span>
              </button>
            </div>
          </div>
        </div>

        {/* Bottom-left: floating glass stats card */}
        <Card isBlurred className="player-stats-card absolute bottom-6 left-6 md:bottom-8 md:left-8 bg-content1/40 backdrop-blur-2xl min-w-[300px] md:min-w-[340px]">
          <div className="flex items-center gap-4">
            <div className="text-center">
              <span className="text-2xl font-light text-foreground">{gameCount}</span>
              <p className="text-[10px] text-foreground/60 dark:text-foreground/40 mt-0.5">Games</p>
            </div>
            <div className="w-px h-8 bg-content3/50" />
            <div className="text-center">
              <span className="text-2xl font-light text-foreground">{recordings?.length ?? 0}</span>
              <p className="text-[10px] text-foreground/60 dark:text-foreground/40 mt-0.5">Recordings</p>
            </div>
            <div className="w-px h-8 bg-content3/50" />
            <div className="text-center">
              <span className="text-sm text-foreground/80 dark:text-foreground/60">
                {lastGame
                  ? new Date(lastGame.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                  : "—"}
              </span>
              <p className="text-[10px] text-foreground/60 dark:text-foreground/40 mt-0.5">Last Active</p>
            </div>
          </div>
          {/* Mini activity indicator */}
          <div className="flex items-center gap-1 mt-3">
            {Array.from({ length: 7 }).map((_, i) => {
              const hasActivity = i < Math.min(gameCount, 7);
              return (
                <div
                  key={i}
                  className={`flex-1 h-1.5 rounded-full ${hasActivity ? "bg-[#9B7B5B]" : "bg-content3/50"}`}
                  style={{ opacity: hasActivity ? 0.4 + (i / 7) * 0.6 : 1 }}
                />
              );
            })}
          </div>
        </Card>

        {/* ITTF Recent Matches - below stats card */}
        {ittfData?.recent_matches && ittfData.recent_matches.length > 0 && (
          <div className="absolute bottom-24 left-6 md:bottom-28 md:left-8 z-20 min-w-[280px] md:min-w-[340px] max-w-[420px]">
            <div className="bg-white/[0.07] dark:bg-white/[0.05] backdrop-blur-md rounded-2xl p-4 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
              <div className="flex items-center gap-2 mb-3">
                <Globe className="w-3.5 h-3.5 text-primary/70" />
                <span className="text-xs font-medium text-foreground/70">ITTF Recent Matches</span>
                {player.ittf_data?.ranking && (
                  <span className="ml-auto text-[10px] text-primary/60">World #{player.ittf_data.ranking}</span>
                )}
              </div>
              <div className="space-y-1.5">
                {ittfData.recent_matches.slice(0, 5).map((match, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 py-1.5 px-2 rounded-lg hover:bg-white/[0.05] transition-colors"
                  >
                    <span
                      className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                        match.result === "WON"
                          ? "bg-[#6B8E6B]/20 text-[#6B8E6B]"
                          : "bg-[#C45C5C]/20 text-[#C45C5C]"
                      }`}
                    >
                      {match.result === "WON" ? "W" : "L"}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-foreground/80 truncate">
                        vs {match.opponent || "Unknown"}
                      </p>
                      {match.tournament && (
                        <p className="text-[10px] text-foreground/30 truncate">{match.tournament}</p>
                      )}
                    </div>
                    {match.score && (
                      <span className="text-[10px] text-foreground/40 shrink-0">{match.score}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Right: recordings — inline, no container panel, individual glass cards */}
        <div className="absolute right-6 md:right-8 top-1/3 bottom-6 md:bottom-8 w-72 md:w-80 flex flex-col z-20">
          {/* Header — inline, no background */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground/80">Recordings</span>
              {recordings && recordings.length > 0 && (
                <span className="text-[10px] text-foreground/40">{recordings.length}</span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {(["all", "match", "informal", "clip"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setRecordingFilter(f)}
                  className={`text-[9px] px-2 py-1 rounded-full transition-colors ${
                    recordingFilter === f
                      ? "bg-foreground/10 text-foreground/80 backdrop-blur-sm"
                      : "text-foreground/30 hover:text-foreground/50"
                  }`}
                >
                  {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Recording cards — each one is a floating glass card */}
          <div className="flex-1 overflow-y-auto space-y-2 pr-1 scrollbar-thin">
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
                  className="group cursor-pointer flex gap-4 items-center p-3 rounded-2xl hover:scale-[1.01] transition-all duration-200 bg-white/[0.07] dark:bg-white/[0.05] backdrop-blur-md shadow-[0_2px_12px_rgba(0,0,0,0.08)]"
                >
                  {rec.video_path && (
                    <div className="w-28 h-20 rounded-xl overflow-hidden shrink-0">
                      <video src={rec.video_path} className="w-full h-full object-cover" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground/90 truncate">{rec.title}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] uppercase tracking-wider text-primary/70 font-medium">{rec.type}</span>
                      <span className="w-1 h-1 rounded-full bg-foreground/15" />
                      <span className="text-[10px] text-foreground/30">
                        {new Date(rec.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </span>
                    </div>
                    {rec.session_id ? (
                      <span className="text-[9px] text-success/70 mt-1.5 block">Ready to view</span>
                    ) : analyzingRecordingId === rec.id ? (
                      <span className="text-[9px] text-primary/70 mt-1.5 flex items-center gap-1"><Loader2 className="w-2.5 h-2.5 animate-spin" />Analyzing...</span>
                    ) : (
                      <span className="text-[9px] text-foreground/25 group-hover:text-primary/60 mt-1.5 block transition-colors">Click to analyze</span>
                    )}
                  </div>
                  <ChevronRight className="w-4 h-4 text-foreground/15 group-hover:text-foreground/40 shrink-0 transition-colors" />
                </div>
              ))
            ) : (
              <div className="text-center py-16">
                <p className="text-xs text-foreground/30">No recordings yet</p>
              </div>
            )}
          </div>

          {/* Add button — glass style, pinned at bottom */}
          <button
            onClick={() => setUploadOpen(true)}
            className="mt-4 flex items-center gap-2 text-xs text-foreground/30 hover:text-primary transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Recording
          </button>
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
              <h2 className="text-lg font-light text-foreground mb-1">Add Recording</h2>
              <p className="text-xs text-foreground/40 mb-5">Upload footage for {player.name}</p>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-foreground/60 mb-2">Type</label>
                  <div className="grid grid-cols-4 gap-2">
                    {RECORDING_TYPES.map((rt) => (
                      <button
                        key={rt.value}
                        onClick={() => setRecordingType(rt.value)}
                        className={`flex flex-col items-center gap-1.5 px-2 py-2.5 rounded-lg border transition-all text-xs ${
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
                  <label className="block text-xs font-medium text-foreground/60 mb-1.5">Title</label>
                  <input
                    type="text"
                    value={gameName}
                    onChange={(e) => setGameName(e.target.value)}
                    placeholder={recordingType === "match" ? "e.g., vs Wang Chuqin - Finals" : "e.g., Practice Session"}
                    className="w-full px-3 py-2 bg-background rounded-lg text-foreground placeholder-muted-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-foreground/60 mb-1.5">Description (optional)</label>
                  <textarea
                    value={recordingDescription}
                    onChange={(e) => setRecordingDescription(e.target.value)}
                    placeholder={recordingType === "match" ? "Tournament, opponent, key moments..." : "Notes about this recording..."}
                    rows={2}
                    className="w-full px-3 py-2 bg-background rounded-lg text-foreground placeholder-muted-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-foreground/60 mb-1.5">Video File</label>
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
