"use client";

import { useState, useMemo } from "react";
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
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tournament, Matchup, MatchupResult, Player } from "@/lib/api";
import {
  useTournamentMatchups,
  useCreateMatchup,
  useUpdateMatchup,
  useDeleteMatchup,
  useUpdateTournament,
  useDeleteTournament,
} from "@/hooks/useTournaments";
import { usePlayers } from "@/hooks/usePlayers";
import { MatchupForm } from "./MatchupForm";
import { TournamentForm } from "./TournamentForm";
import { YouTubeEmbed } from "@/components/ui/youtube-embed";

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

export function TournamentDetail({ tournament, onBack }: TournamentDetailProps) {
  const [matchupFormOpen, setMatchupFormOpen] = useState(false);
  const [editFormOpen, setEditFormOpen] = useState(false);
  const [editingMatchup, setEditingMatchup] = useState<Matchup | null>(null);

  const { data: matchups, isLoading } = useTournamentMatchups(tournament.id);
  const { data: players } = usePlayers();
  const createMatchup = useCreateMatchup();
  const updateMatchup = useUpdateMatchup();
  const deleteMatchup = useDeleteMatchup();
  const updateTournament = useUpdateTournament();
  const deleteTournament = useDeleteTournament();

  const wins = matchups?.filter((m) => m.result === "win").length ?? 0;
  const losses = matchups?.filter((m) => m.result === "loss").length ?? 0;
  const pending = matchups?.filter((m) => m.result === "pending").length ?? 0;

  const groupedMatchups = useMemo(() => {
    if (!matchups) return {};
    return groupMatchupsByRound(matchups);
  }, [matchups]);

  const roundOrder = [
    "Group Stage",
    "Qualification",
    "Round of 64",
    "Round of 32",
    "Round of 16",
    "Quarterfinal",
    "Semifinal",
    "Bronze Medal",
    "Final",
    "Other",
  ];

  const sortedRounds = Object.keys(groupedMatchups).sort(
    (a, b) => roundOrder.indexOf(a) - roundOrder.indexOf(b)
  );

  return (
    <div>
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-4"
      >
        <ChevronLeft className="w-3.5 h-3.5" />
        Back to Tournaments
      </button>

      {/* WTT-Style Event Banner */}
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
              {tournament.notes && (
                <p className="text-xs text-muted-foreground mt-3 max-w-xl">{tournament.notes}</p>
              )}
            </div>

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
          </div>

          {/* Stats bar */}
          <div className="flex items-center gap-6 mt-5 pt-4 border-t border-border/50">
            <div className="flex items-center gap-2">
              <Swords className="w-4 h-4 text-muted-foreground" />
              <span className="text-lg font-light text-foreground">{matchups?.length ?? 0}</span>
              <span className="text-xs text-muted-foreground">matches</span>
            </div>
            <div className="flex items-center gap-2">
              <Trophy className="w-4 h-4 text-green-400" />
              <span className="text-lg font-light text-green-400">{wins}</span>
              <span className="text-xs text-muted-foreground">wins</span>
            </div>
            <div className="flex items-center gap-2">
              <XCircle className="w-4 h-4 text-red-400" />
              <span className="text-lg font-light text-red-400">{losses}</span>
              <span className="text-xs text-muted-foreground">losses</span>
            </div>
            {pending > 0 && (
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-muted-foreground" />
                <span className="text-lg font-light text-muted-foreground">{pending}</span>
                <span className="text-xs text-muted-foreground">pending</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Matches Section - Grouped by Round */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-foreground">Matches</h3>
        <Button
          onClick={() => { setEditingMatchup(null); setMatchupFormOpen(true); }}
          size="sm"
          className="bg-[#9B7B5B] hover:bg-[#8A6B4B] text-[#1E1D1F] text-xs h-8 gap-1"
        >
          <Plus className="w-3 h-3" />
          Add Match
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground text-xs">Loading matches...</div>
      ) : !matchups?.length ? (
        <div className="text-center py-12 rounded-xl bg-card border border-border">
          <Swords className="w-8 h-8 text-border mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No matches yet</p>
          <p className="text-xs text-muted-foreground mt-0.5">Add matches to track results</p>
        </div>
      ) : (
        <div className="space-y-6">
          {sortedRounds.map((round) => (
            <div key={round}>
              <div className="flex items-center gap-2 mb-3">
                <div className="h-px flex-1 bg-border/50" />
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  {round}
                </span>
                <div className="h-px flex-1 bg-border/50" />
              </div>

              <div className="space-y-3">
                {groupedMatchups[round].map((matchup) => {
                  const youtubeId = matchup.youtube_url
                    ? extractYouTubeId(matchup.youtube_url)
                    : null;

                  return (
                    <motion.div
                      key={matchup.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="rounded-xl bg-card border border-border hover:border-[#9B7B5B]/20 transition-all group overflow-hidden"
                    >
                      <div className="p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <span className={`px-2.5 py-1 rounded text-[11px] font-semibold shrink-0 ${resultColors[matchup.result || "pending"]}`}>
                              {(matchup.result || "pending").toUpperCase()}
                            </span>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                {matchup.player_name && (
                                  <>
                                    <span className="text-sm font-medium text-[#9B7B5B]">{matchup.player_name}</span>
                                    <span className="text-xs text-muted-foreground">vs</span>
                                  </>
                                )}
                                <span className="text-sm font-medium text-foreground">{matchup.opponent_name}</span>
                                {matchup.opponent_club && (
                                  <span className="text-[10px] text-muted-foreground">({matchup.opponent_club})</span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                                {matchup.score && (
                                  <span className="font-medium text-foreground/70">{matchup.score}</span>
                                )}
                                {matchup.opponent_ranking && <span>Rank {matchup.opponent_ranking}</span>}
                                {matchup.scheduled_at && (
                                  <span>
                                    {new Date(matchup.scheduled_at).toLocaleDateString("en-US", {
                                      month: "short",
                                      day: "numeric",
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-foreground"
                              onClick={() => {
                                setEditingMatchup(matchup);
                                setMatchupFormOpen(true);
                              }}
                            >
                              <Pencil className="w-3 h-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-[#C45C5C]"
                              onClick={() => deleteMatchup.mutate({ id: matchup.id, tournamentId: tournament.id })}
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        </div>

                        {matchup.notes && (
                          <p className="text-[10px] text-muted-foreground mt-2">{matchup.notes}</p>
                        )}
                      </div>

                      {/* YouTube Embed */}
                      {youtubeId && (
                        <div className="border-t border-border">
                          <YouTubeEmbed youtubeVideoId={youtubeId} />
                        </div>
                      )}
                    </motion.div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {matchupFormOpen && (
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

        {editFormOpen && (
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
