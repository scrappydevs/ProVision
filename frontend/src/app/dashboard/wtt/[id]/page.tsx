"use client";

import { useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  Loader2,
  Trophy,
  MapPin,
  Calendar,
  Swords,
  Search as SearchIcon,
  Video,
  User,
  ChevronDown,
  ChevronUp,
  X,
  Play,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useWTTTournament,
  useWTTTournamentMatches,
  useSyncWTTVideos,
} from "@/hooks/useWTTData";
import { WTTMatch, WTTPlayer } from "@/lib/api";
import { YouTubeEmbed } from "@/components/ui/youtube-embed";
import { MatchModal } from "@/components/wtt/MatchModal";

const tierGradients: Record<string, string> = {
  "Grand Smash": "from-amber-900/40 via-amber-800/20 to-transparent",
  Champions: "from-purple-900/40 via-purple-800/20 to-transparent",
  "Star Contender": "from-blue-900/40 via-blue-800/20 to-transparent",
  Contender: "from-emerald-900/40 via-emerald-800/20 to-transparent",
  Finals: "from-red-900/40 via-red-800/20 to-transparent",
  Other: "from-[#282729] via-[#282729]/50 to-transparent",
};

const ROUND_ORDER = [
  "Final",
  "Semifinal",
  "Quarterfinal",
  "R16",
  "R32",
  "R64",
  "Round 1",
  "Round 2",
  "Round 3",
  "Round 4",
  "Group",
  "Qualification",
  "Unknown",
];

const formatDate = (d?: string) => {
  if (!d) return "";
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

export default function WTTTournamentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const { data: tournament, isLoading: tLoading } = useWTTTournament(id);
  const { data: matches, isLoading: mLoading, refetch } = useWTTTournamentMatches(id);
  const syncVideos = useSyncWTTVideos();

  const [selectedMatch, setSelectedMatch] = useState<WTTMatch | null>(null);
  const [expandedRounds, setExpandedRounds] = useState<Set<string>>(new Set(["Final", "Semifinal", "Quarterfinal"]));

  // Group matches by round
  const matchesByRound = useMemo(() => {
    if (!matches) return new Map<string, WTTMatch[]>();
    const map = new Map<string, WTTMatch[]>();
    for (const m of matches) {
      const round = m.round || "Unknown";
      if (!map.has(round)) map.set(round, []);
      map.get(round)!.push(m);
    }
    // Sort by round order
    const sorted = new Map<string, WTTMatch[]>();
    for (const round of ROUND_ORDER) {
      if (map.has(round)) sorted.set(round, map.get(round)!);
    }
    // Add any remaining rounds not in our order
    for (const [round, ms] of map) {
      if (!sorted.has(round)) sorted.set(round, ms);
    }
    return sorted;
  }, [matches]);

  const handleSyncVideos = () => {
    syncVideos.mutate(id, {
      onSuccess: () => refetch(),
    });
  };

  const toggleRound = (round: string) => {
    setExpandedRounds((prev) => {
      const next = new Set(prev);
      if (next.has(round)) next.delete(round);
      else next.add(round);
      return next;
    });
  };

  if (tLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-6 h-6 animate-spin text-[#9B7B5B]" />
      </div>
    );
  }

  if (!tournament) {
    return (
      <div className="text-center py-24">
        <p className="text-muted-foreground">Tournament not found.</p>
        <Button
          variant="ghost"
          onClick={() => router.push("/dashboard/wtt")}
          className="mt-4"
        >
          Back to WTT Database
        </Button>
      </div>
    );
  }

  const tier = tournament.tier || "Other";
  const gradient = tierGradients[tier] || tierGradients.Other;

  return (
    <div className="space-y-6">
      {/* Back button */}
      <button
        onClick={() => router.push("/dashboard/wtt")}
        className="flex items-center gap-1.5 text-sm text-[#8A8885] hover:text-[#E8E6E3] transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        WTT Database
      </button>

      {/* Tournament Header */}
      <div
        className={`relative rounded-xl border border-[#363436] overflow-hidden bg-gradient-to-br ${gradient}`}
      >
        <div className="p-6 sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="px-2 py-0.5 text-[11px] font-semibold rounded-md bg-[#9B7B5B]/20 text-[#9B7B5B] border border-[#9B7B5B]/30">
                  {tier}
                </span>
                <span className="px-2 py-0.5 text-[11px] font-medium rounded-md bg-[#2D2C2E] text-[#8A8885] capitalize">
                  {tournament.status}
                </span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold text-[#E8E6E3]">
                {tournament.name}
              </h1>
              <div className="flex flex-wrap items-center gap-4 mt-3 text-sm text-[#8A8885]">
                {tournament.location && (
                  <span className="flex items-center gap-1.5">
                    <MapPin className="w-4 h-4" />
                    {tournament.location}
                  </span>
                )}
                {tournament.start_date && (
                  <span className="flex items-center gap-1.5">
                    <Calendar className="w-4 h-4" />
                    {formatDate(tournament.start_date)}
                    {tournament.end_date &&
                      ` – ${formatDate(tournament.end_date)}`}
                  </span>
                )}
                {tournament.match_count != null && (
                  <span className="flex items-center gap-1.5">
                    <Swords className="w-4 h-4" />
                    {tournament.match_count} matches
                  </span>
                )}
              </div>
            </div>
            <Button
              onClick={handleSyncVideos}
              disabled={syncVideos.isPending}
              variant="outline"
              size="sm"
              className="border-[#363436] hover:border-[#9B7B5B] text-[#E8E6E3] shrink-0"
            >
              {syncVideos.isPending ? (
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              ) : (
                <Video className="w-4 h-4 mr-1.5" />
              )}
              Find Videos
            </Button>
          </div>
        </div>
      </div>

      {/* Matches by Round */}
      {mLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-[#9B7B5B]" />
        </div>
      ) : matchesByRound.size === 0 ? (
        <div className="text-center py-16 text-[#8A8885]">
          <Swords className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">No matches found for this tournament.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {Array.from(matchesByRound.entries()).map(([round, roundMatches]) => (
            <RoundGroup
              key={round}
              round={round}
              matches={roundMatches}
              expanded={expandedRounds.has(round)}
              onToggle={() => toggleRound(round)}
              onMatchClick={setSelectedMatch}
            />
          ))}
        </div>
      )}

      {/* Match Modal */}
      {selectedMatch && (
        <MatchModal
          match={selectedMatch}
          onClose={() => setSelectedMatch(null)}
        />
      )}
    </div>
  );
}

function RoundGroup({
  round,
  matches,
  expanded,
  onToggle,
  onMatchClick,
}: {
  round: string;
  matches: WTTMatch[];
  expanded: boolean;
  onToggle: () => void;
  onMatchClick: (m: WTTMatch) => void;
}) {
  const finishedCount = matches.filter((m) => m.status === "finished").length;
  const videoCount = matches.filter((m) => m.video_url).length;

  return (
    <div className="bg-[#282729] border border-[#363436] rounded-xl overflow-hidden">
      {/* Round header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 hover:bg-[#2D2C2E] transition-colors"
      >
        <div className="flex items-center gap-3">
          <Trophy className="w-4 h-4 text-[#9B7B5B]" />
          <span className="text-sm font-semibold text-[#E8E6E3]">{round}</span>
          <span className="text-xs text-[#8A8885]">
            {matches.length} match{matches.length !== 1 ? "es" : ""}
          </span>
          {videoCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-[#9B7B5B]">
              <Video className="w-3 h-3" />
              {videoCount}
            </span>
          )}
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-[#8A8885]" />
        ) : (
          <ChevronDown className="w-4 h-4 text-[#8A8885]" />
        )}
      </button>

      {/* Match rows */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-t border-[#363436]">
              {matches.map((m) => (
                <MatchRow key={m.id} match={m} onClick={() => onMatchClick(m)} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MatchRow({
  match: m,
  onClick,
}: {
  match: WTTMatch;
  onClick: () => void;
}) {
  const isP1Winner = m.winner_id && m.winner_id === m.player_1_id;
  const isP2Winner = m.winner_id && m.winner_id === m.player_2_id;

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#2D2C2E] transition-colors border-b border-[#363436] last:border-b-0 text-left"
    >
      {/* Player 1 */}
      <div className="flex-1 text-right min-w-0">
        <span
          className={`text-sm truncate ${
            isP1Winner ? "font-semibold text-[#E8E6E3]" : "text-[#8A8885]"
          }`}
        >
          {m.player_1_name || "TBD"}
        </span>
        {m.player_1_country && (
          <span className="ml-1.5 text-[10px] text-[#8A8885]">
            {m.player_1_country}
          </span>
        )}
      </div>

      {/* Score */}
      <div className="flex items-center gap-2 shrink-0">
        {m.score_summary ? (
          <span className="px-3 py-1 rounded-md bg-[#1E1D1F] text-sm font-mono font-semibold text-[#E8E6E3] min-w-[48px] text-center">
            {m.score_summary}
          </span>
        ) : (
          <span className="px-3 py-1 rounded-md bg-[#1E1D1F] text-xs text-[#8A8885] min-w-[48px] text-center">
            {m.status === "upcoming" ? "vs" : "—"}
          </span>
        )}
      </div>

      {/* Player 2 */}
      <div className="flex-1 min-w-0">
        {m.player_2_country && (
          <span className="mr-1.5 text-[10px] text-[#8A8885]">
            {m.player_2_country}
          </span>
        )}
        <span
          className={`text-sm truncate ${
            isP2Winner ? "font-semibold text-[#E8E6E3]" : "text-[#8A8885]"
          }`}
        >
          {m.player_2_name || "TBD"}
        </span>
      </div>

      {/* Video indicator */}
      {m.video_url && (
        <Play className="w-3.5 h-3.5 text-[#9B7B5B] shrink-0" />
      )}
    </button>
  );
}
