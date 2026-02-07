"use client";

import { useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronLeft,
  Plus,
  Trash2,
  Pencil,
  Trophy,
  XCircle,
  Clock,
  Swords,
  MapPin,
  Calendar,
  Play,
  Sparkles,
  X,
  Video,
  Loader2,
  Scissors,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tournament, Matchup, MatchupResult, Player, createAndAnalyzeVideo, getYouTubeMetadata } from "@/lib/api";
import {
  useTournamentMatchups,
  useCreateMatchup,
  useUpdateMatchup,
  useDeleteMatchup,
  useUpdateTournament,
  useDeleteTournament,
  useBackfillVideos,
} from "@/hooks/useTournaments";
import { usePlayers } from "@/hooks/usePlayers";
import { MatchupForm } from "./MatchupForm";
import { TournamentForm } from "./TournamentForm";

interface TournamentDetailProps {
  tournament: Tournament;
  onBack: () => void;
}

const resultColors: Record<string, string> = {
  win: "text-green-400 bg-green-400/10",
  loss: "text-red-400 bg-red-400/10",
  draw: "text-yellow-400 bg-yellow-400/10",
  pending: "text-muted-foreground bg-muted",
  walkover: "text-blue-400 bg-blue-400/10",
  retired: "text-orange-400 bg-orange-400/10",
};

const levelLabels: Record<string, string> = {
  local: "Local",
  regional: "Regional",
  national: "National",
  international: "International",
  world: "World",
};

const statusStyles: Record<string, string> = {
  upcoming: "text-blue-400 bg-blue-400/10",
  ongoing: "text-green-400 bg-green-400/10",
  completed: "text-muted-foreground bg-muted",
  cancelled: "text-red-400 bg-red-400/10",
};

const formatDate = (d?: string) => {
  if (!d) return "—";
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

function extractYouTubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function groupMatchupsByRound(matchups: Matchup[]) {
  const groups: Record<string, Matchup[]> = {};
  for (const m of matchups) {
    const key = m.round || "Other";
    if (!groups[key]) groups[key] = [];
    groups[key].push(m);
  }
  return groups;
}

function parseNotesPlayers(notes?: string): { p1: string; p2: string; summary: string; winner: string } | null {
  if (!notes) return null;
  // Format: "P1 vs P2 | 4-2 | Winner: P1"
  const parts = notes.split("|").map((s) => s.trim());
  if (parts.length < 3) return null;
  const matchPart = parts[0];
  const summary = parts[1] || "";
  const winnerPart = parts[2] || "";
  const vs = matchPart.split(" vs ");
  if (vs.length !== 2) return null;
  const winner = winnerPart.replace("Winner:", "").trim();
  return { p1: vs[0].trim(), p2: vs[1].trim(), summary, winner };
}

/** Check if a tournament was created by WTT sync (read-only reference data). */
function isWTTSynced(tournament: Tournament): boolean {
  return tournament.metadata?.source === "wtt_sync";
}

const CLIP_THRESHOLD_SECONDS = 45;

export function TournamentDetail({ tournament, onBack }: TournamentDetailProps) {
  const router = useRouter();
  const [matchupFormOpen, setMatchupFormOpen] = useState(false);
  const [editFormOpen, setEditFormOpen] = useState(false);
  const [editingMatchup, setEditingMatchup] = useState<Matchup | null>(null);
  const [expandedVideo, setExpandedVideo] = useState<string | null>(null);

  // Clip selector state
  const [clipMatchup, setClipMatchup] = useState<Matchup | null>(null);
  const [clipDuration, setClipDuration] = useState(0);
  const [clipTitle, setClipTitle] = useState("");
  const [fetchingMeta, setFetchingMeta] = useState(false);

  const handleAnalyzeWithClipCheck = useCallback(async (matchup: Matchup) => {
    if (!matchup.youtube_url) return;
    setFetchingMeta(true);
    try {
      const meta = await getYouTubeMetadata(matchup.youtube_url);
      const dur = meta.data.duration_seconds;
      if (dur > CLIP_THRESHOLD_SECONDS) {
        setClipMatchup(matchup);
        setClipDuration(dur);
        setClipTitle(meta.data.title || "");
        setFetchingMeta(false);
        return;
      }
      // Short video — analyze directly
      const { sessionId } = await createAndAnalyzeVideo(matchup.youtube_url, {
        matchupId: matchup.id,
        tournamentId: matchup.tournament_id,
        playerId: matchup.player_id || undefined,
      });
      if (sessionId) router.push(`/dashboard/games/${sessionId}`);
    } catch (err) {
      console.error("Analysis failed:", err);
    } finally {
      setFetchingMeta(false);
    }
  }, [router]);

  const { data: matchups, isLoading } = useTournamentMatchups(tournament.id);
  const { data: players } = usePlayers();
  const createMatchup = useCreateMatchup();
  const updateMatchup = useUpdateMatchup();
  const deleteMatchup = useDeleteMatchup();
  const updateTournament = useUpdateTournament();
  const deleteTournament = useDeleteTournament();
  const backfillVideos = useBackfillVideos();

  const readOnly = isWTTSynced(tournament);

  const groupedMatchups = useMemo(() => {
    if (!matchups) return {};
    return groupMatchupsByRound(matchups);
  }, [matchups]);

  const roundOrder = [
    "R32",
    "R16",
    "Quarterfinal",
    "Semifinal",
    "Bronze Medal",
    "Final",
    "Group Stage",
    "Qualification",
    "Other",
  ];

  const sortedRounds = Object.keys(groupedMatchups).sort(
    (a, b) => roundOrder.indexOf(a) - roundOrder.indexOf(b)
  );

  const videosFound = matchups?.filter((m) => m.youtube_url).length ?? 0;
  const videosMissing = (matchups?.length ?? 0) - videosFound;

  return (
    <div>
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-4"
      >
        <ChevronLeft className="w-3.5 h-3.5" />
        Back to Tournaments
      </button>

      {/* Event Banner */}
      <div className="rounded-xl bg-gradient-to-r from-[#9B7B5B]/10 via-card to-card border border-border overflow-hidden mb-6">
        <div className="p-6">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${statusStyles[tournament.status]}`}>
                  {tournament.status.toUpperCase()}
                </span>
                {tournament.level && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-medium text-[#9B7B5B] bg-[#9B7B5B]/10">
                    {levelLabels[tournament.level] || tournament.level}
                  </span>
                )}
                {readOnly && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-medium text-blue-400 bg-blue-400/10">
                    WTT Reference
                  </span>
                )}
              </div>
              <h2 className="text-2xl font-light text-foreground mb-2">{tournament.name}</h2>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                {tournament.location && (
                  <span className="flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5" />
                    {tournament.location}
                  </span>
                )}
                {tournament.start_date && (
                  <span className="flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5" />
                    {formatDate(tournament.start_date)}
                    {tournament.end_date && ` – ${formatDate(tournament.end_date)}`}
                  </span>
                )}
              </div>
            </div>

            {!readOnly && (
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditFormOpen(true)}
                  className="h-8 text-xs text-muted-foreground hover:text-foreground"
                >
                  <Pencil className="w-3 h-3 mr-1" />
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (confirm("Delete this tournament and all its matchups?")) {
                      deleteTournament.mutate(tournament.id, { onSuccess: onBack });
                    }
                  }}
                  className="h-8 text-xs text-muted-foreground hover:text-[#C45C5C]"
                >
                  <Trash2 className="w-3 h-3 mr-1" />
                  Delete
                </Button>
              </div>
            )}
          </div>

          {/* Stats bar */}
          <div className="flex items-center gap-6 mt-5 pt-4 border-t border-border/50">
            <div className="flex items-center gap-2">
              <Swords className="w-4 h-4 text-muted-foreground" />
              <span className="text-lg font-light text-foreground">{matchups?.length ?? 0}</span>
              <span className="text-xs text-muted-foreground">matches</span>
            </div>
            <div className="flex items-center gap-2">
              <Video className="w-4 h-4 text-[#9B7B5B]" />
              <span className="text-lg font-light text-[#9B7B5B]">{videosFound}</span>
              <span className="text-xs text-muted-foreground">videos</span>
            </div>
          </div>
        </div>
      </div>

      {/* Matches Section */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-foreground">Matches</h3>
        <div className="flex items-center gap-2">
          {readOnly && videosMissing > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => backfillVideos.mutate()}
              disabled={backfillVideos.isPending}
              className="text-xs h-8 gap-1 border-[#363436] hover:border-[#9B7B5B] text-[#E8E6E3]"
            >
              {backfillVideos.isPending ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Video className="w-3 h-3" />
              )}
              Find Videos ({videosMissing})
            </Button>
          )}
          {!readOnly && (
            <Button
              onClick={() => { setEditingMatchup(null); setMatchupFormOpen(true); }}
              size="sm"
              className="bg-[#9B7B5B] hover:bg-[#8A6B4B] text-[#1E1D1F] text-xs h-8 gap-1"
            >
              <Plus className="w-3 h-3" />
              Add Match
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground text-xs">Loading matches...</div>
      ) : !matchups?.length ? (
        <div className="text-center py-12 rounded-xl bg-card border border-border">
          <Swords className="w-8 h-8 text-border mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No matches yet</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {readOnly ? "This event has no match data" : "Add matches to track results"}
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {sortedRounds.map((round) => (
            <div key={round}>
              <div className="flex items-center gap-2 mb-4">
                <div className="h-px flex-1 bg-border/50" />
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  {round}
                </span>
                <div className="h-px flex-1 bg-border/50" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {groupedMatchups[round].map((matchup) => (
                  <MatchCard
                    key={matchup.id}
                    matchup={matchup}
                    readOnly={readOnly}
                    onEdit={readOnly ? undefined : () => {
                      setEditingMatchup(matchup);
                      setMatchupFormOpen(true);
                    }}
                    onDelete={readOnly ? undefined : () => deleteMatchup.mutate({ id: matchup.id, tournamentId: tournament.id })}
                    onExpand={() => setExpandedVideo(matchup.id)}
                    onAnalyze={handleAnalyzeWithClipCheck}
                    fetchingMeta={fetchingMeta}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Expanded Video Modal */}
      <AnimatePresence>
        {expandedVideo && (
          <VideoModal
            matchup={matchups?.find((m) => m.id === expandedVideo) ?? null}
            onClose={() => setExpandedVideo(null)}
            onAnalyze={handleAnalyzeWithClipCheck}
            fetchingMeta={fetchingMeta}
          />
        )}
      </AnimatePresence>

      {/* Clip Selector Modal */}
      <AnimatePresence>
        {clipMatchup && (
          <ClipSelectorModal
            matchup={clipMatchup}
            duration={clipDuration}
            title={clipTitle}
            onClose={() => setClipMatchup(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {matchupFormOpen && !readOnly && (
          <MatchupForm
            tournamentId={tournament.id}
            players={players || []}
            initialData={editingMatchup ? {
              player_id: editingMatchup.player_id,
              opponent_name: editingMatchup.opponent_name,
              opponent_club: editingMatchup.opponent_club || undefined,
              opponent_ranking: editingMatchup.opponent_ranking || undefined,
              round: editingMatchup.round || undefined,
              scheduled_at: editingMatchup.scheduled_at || undefined,
              result: editingMatchup.result as MatchupResult,
              score: editingMatchup.score || undefined,
              notes: editingMatchup.notes || undefined,
              youtube_url: editingMatchup.youtube_url || undefined,
            } : undefined}
            onSubmit={(data) => {
              if (editingMatchup) {
                updateMatchup.mutate(
                  { id: editingMatchup.id, tournamentId: tournament.id, data },
                  { onSuccess: () => { setMatchupFormOpen(false); setEditingMatchup(null); } }
                );
              } else {
                createMatchup.mutate(
                  { tournamentId: tournament.id, data },
                  { onSuccess: () => setMatchupFormOpen(false) }
                );
              }
            }}
            onClose={() => { setMatchupFormOpen(false); setEditingMatchup(null); }}
            isPending={createMatchup.isPending || updateMatchup.isPending}
          />
        )}

        {editFormOpen && !readOnly && (
          <TournamentForm
            title="Edit Tournament"
            initialData={{
              name: tournament.name,
              location: tournament.location || undefined,
              start_date: tournament.start_date || undefined,
              end_date: tournament.end_date || undefined,
              level: tournament.level as any,
              status: tournament.status as any,
              notes: tournament.notes || undefined,
            }}
            onSubmit={(data) => {
              updateTournament.mutate(
                { id: tournament.id, data },
                { onSuccess: () => setEditFormOpen(false) }
              );
            }}
            onClose={() => setEditFormOpen(false)}
            isPending={updateTournament.isPending}
          />
        )}
      </AnimatePresence>
    </div>
  );
}


function MatchCard({
  matchup,
  readOnly,
  onEdit,
  onDelete,
  onExpand,
  onAnalyze,
  fetchingMeta,
}: {
  matchup: Matchup;
  readOnly: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  onExpand: () => void;
  onAnalyze: (m: Matchup) => void;
  fetchingMeta: boolean;
}) {
  const youtubeId = matchup.youtube_url ? extractYouTubeId(matchup.youtube_url) : null;
  const thumbnailUrl = youtubeId
    ? `https://img.youtube.com/vi/${youtubeId}/maxresdefault.jpg`
    : null;

  const parsed = parseNotesPlayers(matchup.notes);
  const p1 = parsed?.p1 || matchup.player_name || "";
  const p2 = parsed?.p2 || matchup.opponent_name;
  const winnerName = parsed?.winner || "";
  const scoreSummary = parsed?.summary || null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl bg-card border border-border hover:border-[#9B7B5B]/30 transition-all group overflow-hidden flex flex-col"
    >
      {/* Thumbnail / Video preview */}
      <button
        onClick={onExpand}
        className="relative w-full aspect-video bg-[#1a191b] cursor-pointer overflow-hidden"
      >
        {thumbnailUrl ? (
          <>
            <img
              src={thumbnailUrl}
              alt={`${p1} vs ${p2}`}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              loading="lazy"
              onError={(e) => {
                const img = e.currentTarget;
                if (img.src.includes("maxresdefault")) {
                  img.src = img.src.replace("maxresdefault", "hqdefault");
                }
              }}
            />
            <div className="absolute inset-0 bg-black/20 group-hover:bg-black/10 transition-colors flex items-center justify-center">
              <div className="w-12 h-12 rounded-full bg-[#9B7B5B]/90 flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                <Play className="w-5 h-5 text-[#1E1D1F] ml-0.5" fill="currentColor" />
              </div>
            </div>
          </>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-[#363436]">
            <Play className="w-8 h-8" />
            <span className="text-[10px] text-[#8A8885]">No video yet</span>
          </div>
        )}

        {/* Score badge on thumbnail */}
        {scoreSummary && (
          <span className="absolute top-2 right-2 px-2 py-0.5 rounded bg-black/70 text-white text-[11px] font-mono font-bold">
            {scoreSummary}
          </span>
        )}

        {/* Round badge */}
        {matchup.round && (
          <span className="absolute bottom-2 left-2 px-2 py-0.5 rounded bg-black/60 text-white/90 text-[10px] font-medium">
            {matchup.round}
          </span>
        )}
      </button>

      {/* Match info */}
      <div className="p-3 flex-1 flex flex-col">
        <p className="text-sm font-medium text-[#E8E6E3] leading-tight">
          <span className={winnerName === p1 ? "text-[#9B7B5B]" : ""}>{p1}</span>
          <span className="text-[#8A8885] mx-1.5">vs</span>
          <span className={winnerName === p2 ? "text-[#9B7B5B]" : ""}>{p2}</span>
        </p>
        <div className="flex items-center gap-2 mt-1.5 text-[10px] text-[#8A8885]">
          {matchup.score && <span className="font-mono truncate">{matchup.score}</span>}
        </div>
        {winnerName && (
          <p className="text-[10px] text-[#9B7B5B] mt-1">
            Winner: {winnerName}
          </p>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-1.5 mt-auto pt-3">
          {youtubeId && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onAnalyze(matchup)}
              disabled={fetchingMeta}
              className="h-7 text-[10px] gap-1 border-[#363436] hover:border-[#9B7B5B] text-[#E8E6E3] flex-1"
            >
              {fetchingMeta ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Sparkles className="w-3 h-3" />
              )}
              {fetchingMeta ? "Loading..." : "Analyze"}
            </Button>
          )}
          {!readOnly && onEdit && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-[#8A8885] hover:text-[#E8E6E3] opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
              onClick={onEdit}
            >
              <Pencil className="w-3 h-3" />
            </Button>
          )}
          {!readOnly && onDelete && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-[#8A8885] hover:text-[#C45C5C] opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
              onClick={onDelete}
            >
              <Trash2 className="w-3 h-3" />
            </Button>
          )}
        </div>
      </div>
    </motion.div>
  );
}


function ClipSelectorModal({
  matchup,
  duration,
  title,
  onClose,
}: {
  matchup: Matchup;
  duration: number;
  title: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const maxClip = Math.min(duration, 45);
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(Math.min(maxClip, duration));
  const [analyzing, setAnalyzing] = useState(false);

  const youtubeId = matchup.youtube_url ? extractYouTubeId(matchup.youtube_url) : null;
  const clipDuration = endTime - startTime;
  const isValid = clipDuration > 0 && clipDuration <= 45;

  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const handleClipAnalyze = async () => {
    if (!matchup.youtube_url || analyzing || !isValid) return;
    setAnalyzing(true);
    try {
      const { sessionId } = await createAndAnalyzeVideo(matchup.youtube_url, {
        matchupId: matchup.id,
        tournamentId: matchup.tournament_id,
        playerId: matchup.player_id || undefined,
        startTime,
        endTime,
      });
      if (sessionId) {
        router.push(`/dashboard/games/${sessionId}`);
      }
    } catch (err) {
      console.error("Clip analysis failed:", err);
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="relative w-full max-w-2xl z-10 bg-[#1E1D1F] border border-[#363436] rounded-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#363436]">
          <div className="flex items-center gap-2">
            <Scissors className="w-4 h-4 text-[#9B7B5B]" />
            <span className="text-sm font-medium text-[#E8E6E3]">Select Clip to Analyze</span>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg hover:bg-[#2D2C2E] flex items-center justify-center text-[#8A8885] hover:text-[#E8E6E3] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* YouTube Preview */}
        {youtubeId && (
          <div className="aspect-video bg-black">
            <iframe
              src={`https://www.youtube.com/embed/${youtubeId}?start=${Math.floor(startTime)}&rel=0`}
              title={title}
              allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="w-full h-full"
            />
          </div>
        )}

        <div className="px-5 py-4 space-y-4">
          {/* Info */}
          <div className="flex items-center justify-between">
            <p className="text-xs text-[#8A8885]">
              Video is <span className="text-[#E8E6E3] font-mono">{fmtTime(duration)}</span> long.
              Max clip length is <span className="text-[#9B7B5B] font-mono">0:45</span>.
            </p>
            <p className={`text-xs font-mono ${isValid ? "text-[#9B7B5B]" : "text-[#C45C5C]"}`}>
              {fmtTime(clipDuration)} selected
            </p>
          </div>

          {/* Timeline */}
          <div className="space-y-3">
            {/* Visual timeline bar */}
            <div className="relative h-2 bg-[#2D2C2E] rounded-full overflow-hidden">
              <div
                className="absolute h-full bg-[#9B7B5B]/40 rounded-full"
                style={{
                  left: `${(startTime / duration) * 100}%`,
                  width: `${((endTime - startTime) / duration) * 100}%`,
                }}
              />
            </div>

            {/* Start time slider */}
            <div className="flex items-center gap-3">
              <span className="text-[10px] text-[#8A8885] w-10 shrink-0">Start</span>
              <input
                type="range"
                min={0}
                max={duration}
                step={1}
                value={startTime}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  setStartTime(v);
                  if (endTime - v > 45) setEndTime(v + 45);
                  if (v >= endTime) setEndTime(Math.min(v + 5, duration));
                }}
                className="flex-1 h-1 bg-[#363436] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-[#9B7B5B] [&::-webkit-slider-thumb]:rounded-full"
              />
              <span className="text-xs text-[#E8E6E3] font-mono w-12 text-right">{fmtTime(startTime)}</span>
            </div>

            {/* End time slider */}
            <div className="flex items-center gap-3">
              <span className="text-[10px] text-[#8A8885] w-10 shrink-0">End</span>
              <input
                type="range"
                min={0}
                max={duration}
                step={1}
                value={endTime}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  setEndTime(v);
                  if (v - startTime > 45) setStartTime(v - 45);
                  if (v <= startTime) setStartTime(Math.max(v - 5, 0));
                }}
                className="flex-1 h-1 bg-[#363436] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-[#9B7B5B] [&::-webkit-slider-thumb]:rounded-full"
              />
              <span className="text-xs text-[#E8E6E3] font-mono w-12 text-right">{fmtTime(endTime)}</span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            <Button
              variant="ghost"
              onClick={onClose}
              className="flex-1 h-9 text-xs text-[#8A8885] hover:text-[#E8E6E3]"
            >
              Cancel
            </Button>
            <Button
              onClick={handleClipAnalyze}
              disabled={!isValid || analyzing}
              className="flex-1 h-9 text-xs bg-[#9B7B5B] hover:bg-[#8A6B4B] text-[#1E1D1F] disabled:opacity-50 gap-1.5"
            >
              {analyzing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              {analyzing ? "Analyzing..." : `Analyze Clip (${fmtTime(clipDuration)})`}
            </Button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}


function VideoModal({
  matchup,
  onClose,
  onAnalyze,
  fetchingMeta,
}: {
  matchup: Matchup | null;
  onClose: () => void;
  onAnalyze: (m: Matchup) => void;
  fetchingMeta: boolean;
}) {
  if (!matchup) return null;

  const youtubeId = matchup.youtube_url ? extractYouTubeId(matchup.youtube_url) : null;
  const parsed = parseNotesPlayers(matchup.notes);
  const label = parsed ? `${parsed.p1} vs ${parsed.p2}` : matchup.opponent_name;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="relative w-full max-w-4xl z-10"
      >
        <button
          onClick={onClose}
          className="absolute -top-10 right-0 w-8 h-8 rounded-lg bg-[#282729] flex items-center justify-center text-[#8A8885] hover:text-[#E8E6E3] transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {youtubeId ? (
          <div className="rounded-xl overflow-hidden bg-black">
            <div className="relative w-full aspect-video">
              <iframe
                src={`https://www.youtube.com/embed/${youtubeId}?autoplay=1&rel=0`}
                title={label}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="w-full h-full"
              />
            </div>
            <div className="flex items-center justify-between p-4 bg-[#1E1D1F]">
              <div>
                <p className="text-sm font-medium text-[#E8E6E3]">{label}</p>
                {matchup.score && (
                  <p className="text-xs text-[#8A8885] mt-1 font-mono">{matchup.score}</p>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => { onClose(); onAnalyze(matchup); }}
                disabled={fetchingMeta}
                className="h-8 text-xs gap-1.5 border-[#363436] hover:border-[#9B7B5B] text-[#E8E6E3]"
              >
                {fetchingMeta ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
                {fetchingMeta ? "Loading..." : "Analyze Match"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="rounded-xl bg-[#1E1D1F] border border-[#363436] p-8 text-center">
            <Play className="w-12 h-12 text-[#363436] mx-auto mb-3" />
            <p className="text-sm text-[#8A8885]">No video available for this match</p>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
