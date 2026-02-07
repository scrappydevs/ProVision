"use client";

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus,
  Trophy,
  Loader2,
  Calendar,
  MapPin,
  Swords,
  TrendingUp,
  ChevronRight,
  Search,
  Play,
  Video,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tournament, TournamentCreate } from "@/lib/api";
import {
  useTournaments,
  useTournamentStats,
  useCreateTournament,
} from "@/hooks/useTournaments";
import { useAuth } from "@/hooks/useAuth";
import { TournamentForm } from "@/components/tournaments/TournamentForm";
import { TournamentDetail } from "@/components/tournaments/TournamentDetail";

type TabKey = "all" | "past";

const levelLabels: Record<string, string> = {
  local: "Local",
  regional: "Regional",
  national: "National",
  international: "Int'l",
  world: "World",
};

const statusStyles: Record<string, string> = {
  upcoming: "text-blue-400 bg-blue-400/10",
  ongoing: "text-green-400 bg-green-400/10",
  completed: "text-muted-foreground bg-muted",
  cancelled: "text-red-400 bg-red-400/10",
};

const formatDate = (d?: string) => {
  if (!d) return "";
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const extractYouTubeId = (url: string) => {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
};

const getMetaString = (meta: Record<string, unknown> | undefined, key: string) => {
  const value = meta?.[key];
  if (typeof value === "string" && value.trim()) return value;
  return null;
};

const getTournamentPreview = (tournament: Tournament) => {
  const meta = tournament.metadata;
  
  // Check for YouTube URL first and use it as preview source
  const youtubeUrl = 
    getMetaString(meta, "youtube_url") ||
    getMetaString(meta, "hero_video_url") ||
    getMetaString(meta, "preview_video_url") ||
    getMetaString(meta, "video_url");
  
  const youtubeId = youtubeUrl ? extractYouTubeId(youtubeUrl) : null;
  
  // Use thumbnail from metadata or generate from YouTube ID
  let imageUrl =
    getMetaString(meta, "thumbnail_url") ||
    getMetaString(meta, "cover_url") ||
    getMetaString(meta, "preview_image_url");
  
  if (!imageUrl && youtubeId) {
    imageUrl = `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`;
  }

  return { videoUrl: youtubeUrl, imageUrl, youtubeId };
};

const getTournamentInitials = (name: string) => {
  const parts = name.split(" ").filter(Boolean);
  const initials = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() || "").join("");
  return initials || "TT";
};

export default function TournamentsPage() {
  const [formOpen, setFormOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("all");
  const [selectedTournament, setSelectedTournament] = useState<Tournament | null>(null);
  const [search, setSearch] = useState("");

  const { user } = useAuth();
  const { data: tournaments, isLoading } = useTournaments();
  const { data: stats } = useTournamentStats();
  const createMutation = useCreateTournament();

  const filteredTournaments = useMemo(() => {
    if (!tournaments) return [];
    let filtered = tournaments.filter(
      (t) => (t.matchup_count ?? 0) > 0 || t.status !== "upcoming"
    );

    if (activeTab === "past") {
      filtered = filtered.filter((t) => t.status === "completed" || t.status === "cancelled");
    }

    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.location?.toLowerCase().includes(q)
      );
    }

    return filtered;
  }, [tournaments, activeTab, search]);

  const pastCount = filteredTournaments.filter((t) => t.status === "completed" || t.status === "cancelled").length;

  const handleCreate = async (data: TournamentCreate) => {
    await createMutation.mutateAsync(data);
    setFormOpen(false);
  };

  if (selectedTournament) {
    return (
      <TournamentDetail
        tournament={selectedTournament}
        onBack={() => setSelectedTournament(null)}
        currentUserId={user?.id}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-light text-foreground">Tournaments</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Track events, matchups, and results</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => setFormOpen(true)}
            className="bg-[#9B7B5B] hover:bg-[#8A6B4B] text-primary-foreground text-sm gap-1.5"
          >
            <Plus className="w-4 h-4" />
            New Tournament
          </Button>
        </div>
      </div>

      {/* Stats Bar */}
      {stats && (
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-3">
            <Trophy className="w-3.5 h-3.5 text-[#9B7B5B]" />
            <div>
              <p className="text-[10px] text-foreground/40 uppercase tracking-wider">Tournaments</p>
              <p className="text-xl font-light text-foreground">{stats.total_tournaments}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Swords className="w-3.5 h-3.5 text-[#9B7B5B]" />
            <div>
              <p className="text-[10px] text-foreground/40 uppercase tracking-wider">Matches</p>
              <p className="text-xl font-light text-foreground">{stats.total_matchups}</p>
              <p className="text-[10px] text-foreground/40 mt-0.5">{stats.pending_matchups} pending</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <TrendingUp className="w-3.5 h-3.5 text-green-400" />
            <div>
              <p className="text-[10px] text-foreground/40 uppercase tracking-wider">Win Rate</p>
              <p className="text-xl font-light text-foreground">{stats.win_rate}%</p>
              <p className="text-[10px] text-foreground/40 mt-0.5">{stats.wins}W – {stats.losses}L</p>
            </div>
          </div>
        </div>
      )}

      {/* Tabs + Search */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          {(
            [
              { key: "all", label: "All", count: filteredTournaments.length },
              { key: "past", label: "Past", count: pastCount },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-1.5 pb-1 text-xs transition-colors border-b ${
                activeTab === tab.key
                  ? "border-[#9B7B5B] text-[#9B7B5B]"
                  : "border-transparent text-foreground/40 hover:text-foreground"
              }`}
            >
              {tab.label}
              <span className="ml-1 text-[10px] opacity-60">{tab.count}</span>
            </button>
          ))}
        </div>

        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-0 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground/30" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tournaments..."
            className="w-full bg-transparent border-b border-white/10 pl-6 pr-3 py-1.5 text-xs text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-[#9B7B5B]/60 transition-colors"
          />
        </div>
      </div>

      {/* Loading */}
      {isLoading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="w-8 h-8 text-[#9B7B5B] animate-spin" />
        </div>
      ) : !filteredTournaments.length ? (
        <div className="flex flex-col items-center justify-center py-16">
          <div className="w-16 h-16 rounded-2xl bg-card flex items-center justify-center mb-4">
            <Trophy className="w-8 h-8 text-[#9B7B5B]/40" />
          </div>
          <h3 className="text-base font-light text-foreground mb-1">
            {search ? "No tournaments found" : "No tournaments yet"}
          </h3>
          <p className="text-xs text-muted-foreground mb-4 text-center max-w-sm">
            {search
              ? "Try a different search term"
              : "Create tournaments to track events, matchups, and results."}
          </p>
          {!search && (
            <Button
              onClick={() => setFormOpen(true)}
              className="bg-[#9B7B5B] hover:bg-[#8A6B4B] text-primary-foreground text-sm gap-1.5"
            >
              <Plus className="w-4 h-4" />
              Create First Tournament
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredTournaments.map((tournament, i) => (
            <motion.div
              key={tournament.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              onClick={() => setSelectedTournament(tournament)}
              className="rounded-2xl bg-foreground/[0.02] hover:bg-foreground/5 ring-1 ring-white/5 p-4 cursor-pointer transition-all group"
            >
              <div className="flex flex-col gap-4">
                {(() => {
                  const preview = getTournamentPreview(tournament);
                  return (
                    <div className="relative w-full aspect-video overflow-hidden rounded-xl bg-foreground/10 group/preview">
                      {preview.imageUrl ? (
                        <>
                          <img
                            src={preview.imageUrl}
                            alt={`${tournament.name} preview`}
                            className="h-full w-full object-cover transition-transform duration-300 group-hover/preview:scale-105"
                          />
                          {preview.youtubeId && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover/preview:opacity-100 transition-opacity">
                              <div className="w-12 h-12 rounded-full bg-red-600/90 flex items-center justify-center">
                                <Play className="w-6 h-6 text-white ml-0.5" fill="white" />
                              </div>
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="h-full w-full flex items-center justify-center bg-gradient-to-br from-[#1C1B1D] via-[#242326] to-[#1A191B]">
                          <span className="text-2xl font-light text-foreground/30">
                            {getTournamentInitials(tournament.name)}
                          </span>
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-background/70 via-transparent to-transparent pointer-events-none" />
                      {preview.youtubeId && (
                        <div className="absolute bottom-2 left-2 flex items-center gap-1 text-[10px] text-foreground/70 pointer-events-none">
                          <Video className="w-3 h-3" />
                          Video available
                        </div>
                      )}
                    </div>
                  );
                })()}

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1.5">
                    <h3 className="text-sm font-medium text-foreground truncate">
                      {tournament.name}
                    </h3>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${statusStyles[tournament.status]}`}>
                      {tournament.status}
                    </span>
                    {tournament.level && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium text-[#9B7B5B] bg-[#9B7B5B]/10 shrink-0">
                        {levelLabels[tournament.level] || tournament.level}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-3 text-[11px] text-foreground/45">
                    {tournament.location && (
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3 h-3" />
                        {tournament.location}
                      </span>
                    )}
                    {tournament.start_date && (
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {formatDate(tournament.start_date)}
                        {tournament.end_date && ` – ${formatDate(tournament.end_date)}`}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-4 shrink-0">
                  <div className="text-right">
                    <span className="text-xs text-foreground/45">{tournament.matchup_count ?? 0} matches</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-foreground/20 group-hover:text-[#9B7B5B] transition-colors" />
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {formOpen && (
          <TournamentForm
            onSubmit={handleCreate}
            onClose={() => setFormOpen(false)}
            isPending={createMutation.isPending}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
