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
  Clock,
  ChevronRight,
  Search,
  Globe,
  Download,
  X,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tournament, TournamentCreate, getITTFCalendar, importITTFTournaments, ITTFCalendarEvent } from "@/lib/api";
import {
  useTournaments,
  useTournamentStats,
  useCreateTournament,
} from "@/hooks/useTournaments";
import { useQueryClient } from "@tanstack/react-query";
import { tournamentKeys } from "@/hooks/useTournaments";
import { TournamentForm } from "@/components/tournaments/TournamentForm";
import { TournamentDetail } from "@/components/tournaments/TournamentDetail";

type TabKey = "all" | "upcoming" | "past";

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

export default function TournamentsPage() {
  const [formOpen, setFormOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("all");
  const [selectedTournament, setSelectedTournament] = useState<Tournament | null>(null);
  const [search, setSearch] = useState("");
  const [ittfImportOpen, setIttfImportOpen] = useState(false);
  const [ittfEvents, setIttfEvents] = useState<ITTFCalendarEvent[]>([]);
  const [ittfLoading, setIttfLoading] = useState(false);
  const [selectedEvents, setSelectedEvents] = useState<Set<number>>(new Set());
  const [importing, setImporting] = useState(false);

  const { data: tournaments, isLoading } = useTournaments();
  const { data: stats } = useTournamentStats();
  const createMutation = useCreateTournament();
  const queryClient = useQueryClient();

  const handleOpenITTFImport = async () => {
    setIttfImportOpen(true);
    setIttfLoading(true);
    setSelectedEvents(new Set());
    try {
      const response = await getITTFCalendar();
      setIttfEvents(response.data.events);
    } catch {
      setIttfEvents([]);
    } finally {
      setIttfLoading(false);
    }
  };

  const handleImportSelected = async () => {
    const eventsToImport = Array.from(selectedEvents).map((i) => ittfEvents[i]);
    if (!eventsToImport.length) return;
    setImporting(true);
    try {
      await importITTFTournaments(eventsToImport);
      queryClient.invalidateQueries({ queryKey: tournamentKeys.lists() });
      queryClient.invalidateQueries({ queryKey: tournamentKeys.stats() });
      setIttfImportOpen(false);
    } catch {
      // error handled silently
    } finally {
      setImporting(false);
    }
  };

  const toggleEvent = (index: number) => {
    setSelectedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const filteredTournaments = useMemo(() => {
    if (!tournaments) return [];
    let filtered = tournaments;

    if (activeTab === "upcoming") {
      filtered = filtered.filter((t) => t.status === "upcoming" || t.status === "ongoing");
    } else if (activeTab === "past") {
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

  const upcomingCount = tournaments?.filter((t) => t.status === "upcoming" || t.status === "ongoing").length ?? 0;
  const pastCount = tournaments?.filter((t) => t.status === "completed" || t.status === "cancelled").length ?? 0;

  const handleCreate = async (data: TournamentCreate) => {
    await createMutation.mutateAsync(data);
    setFormOpen(false);
  };

  if (selectedTournament) {
    return (
      <TournamentDetail
        tournament={selectedTournament}
        onBack={() => setSelectedTournament(null)}
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
            variant="outline"
            onClick={handleOpenITTFImport}
            className="text-sm gap-1.5"
          >
            <Globe className="w-4 h-4" />
            Import from ITTF
          </Button>
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
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-xl bg-card border border-border p-3.5">
            <div className="flex items-center gap-2 mb-1.5">
              <Trophy className="w-3.5 h-3.5 text-[#9B7B5B]" />
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Tournaments</span>
            </div>
            <p className="text-xl font-light text-foreground">{stats.total_tournaments}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {stats.upcoming_tournaments} upcoming
            </p>
          </div>
          <div className="rounded-xl bg-card border border-border p-3.5">
            <div className="flex items-center gap-2 mb-1.5">
              <Swords className="w-3.5 h-3.5 text-[#9B7B5B]" />
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Matches</span>
            </div>
            <p className="text-xl font-light text-foreground">{stats.total_matchups}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {stats.pending_matchups} pending
            </p>
          </div>
          <div className="rounded-xl bg-card border border-border p-3.5">
            <div className="flex items-center gap-2 mb-1.5">
              <TrendingUp className="w-3.5 h-3.5 text-green-400" />
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Win Rate</span>
            </div>
            <p className="text-xl font-light text-foreground">{stats.win_rate}%</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {stats.wins}W – {stats.losses}L
            </p>
          </div>
          <div className="rounded-xl bg-card border border-border p-3.5">
            <div className="flex items-center gap-2 mb-1.5">
              <Clock className="w-3.5 h-3.5 text-blue-400" />
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Next Up</span>
            </div>
            <p className="text-sm font-light text-foreground truncate">
              {tournaments?.find((t) => t.status === "upcoming")?.name || "—"}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
              {formatDate(tournaments?.find((t) => t.status === "upcoming")?.start_date) || "No upcoming"}
            </p>
          </div>
        </div>
      )}

      {/* Tabs + Search */}
      <div className="flex items-center gap-4">
        <div className="flex items-center bg-card rounded-lg border border-border p-0.5">
          {(
            [
              { key: "all", label: "All", count: tournaments?.length ?? 0 },
              { key: "upcoming", label: "Upcoming", count: upcomingCount },
              { key: "past", label: "Past", count: pastCount },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                activeTab === tab.key
                  ? "bg-[#9B7B5B]/20 text-[#9B7B5B]"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
              <span className="ml-1 text-[10px] opacity-60">{tab.count}</span>
            </button>
          ))}
        </div>

        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tournaments..."
            className="w-full bg-card border border-border rounded-lg pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
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
              : "Create tournaments to track upcoming events, matchups, and results."}
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
        <div className="space-y-2">
          {filteredTournaments.map((tournament, i) => (
            <motion.div
              key={tournament.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              onClick={() => setSelectedTournament(tournament)}
              className="rounded-xl bg-card border border-border hover:border-primary/30 p-4 cursor-pointer transition-all group"
            >
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
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

                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
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
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground">{tournament.matchup_count ?? 0} matches</span>
                      {(tournament.win_count ?? 0) + (tournament.loss_count ?? 0) > 0 && (
                        <span>
                          <span className="text-green-400">{tournament.win_count}W</span>
                          <span className="text-muted-foreground mx-0.5">–</span>
                          <span className="text-red-400">{tournament.loss_count}L</span>
                        </span>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-border group-hover:text-[#9B7B5B] transition-colors" />
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

        {ittfImportOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
            onClick={() => setIttfImportOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-card border border-border rounded-xl w-full max-w-xl overflow-hidden max-h-[80vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-4 border-b border-border">
                <div className="flex items-center gap-2">
                  <Globe className="w-4 h-4 text-[#9B7B5B]" />
                  <h2 className="text-sm font-medium text-foreground">Import from ITTF Calendar</h2>
                </div>
                <button onClick={() => setIttfImportOpen(false)}>
                  <X className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4">
                {ittfLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-5 h-5 text-[#9B7B5B] animate-spin" />
                    <span className="ml-2 text-xs text-muted-foreground">Fetching WTT events...</span>
                  </div>
                ) : ittfEvents.length === 0 ? (
                  <div className="text-center py-12">
                    <Calendar className="w-8 h-8 text-border mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">No events found</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Could not fetch WTT calendar data</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {ittfEvents.map((event, i) => (
                      <button
                        key={i}
                        onClick={() => toggleEvent(i)}
                        className={`w-full text-left rounded-lg border p-3 transition-all ${
                          selectedEvents.has(i)
                            ? "border-[#9B7B5B] bg-[#9B7B5B]/5"
                            : "border-border hover:border-[#9B7B5B]/30"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-foreground truncate">
                              {event.name}
                            </p>
                            <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground">
                              {event.location && (
                                <span className="flex items-center gap-1">
                                  <MapPin className="w-3 h-3" />
                                  {event.location}
                                </span>
                              )}
                              {event.date_text && (
                                <span className="flex items-center gap-1">
                                  <Calendar className="w-3 h-3" />
                                  {event.date_text}
                                </span>
                              )}
                              {event.level && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-medium text-[#9B7B5B] bg-[#9B7B5B]/10">
                                  {event.level}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ml-3 transition-colors ${
                            selectedEvents.has(i)
                              ? "border-[#9B7B5B] bg-[#9B7B5B]"
                              : "border-border"
                          }`}>
                            {selectedEvents.has(i) && (
                              <Check className="w-3 h-3 text-[#1E1D1F]" />
                            )}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {ittfEvents.length > 0 && (
                <div className="flex items-center justify-between p-4 border-t border-border">
                  <span className="text-xs text-muted-foreground">
                    {selectedEvents.size} event{selectedEvents.size !== 1 ? "s" : ""} selected
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setIttfImportOpen(false)}
                      className="text-xs"
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleImportSelected}
                      disabled={selectedEvents.size === 0 || importing}
                      className="bg-[#9B7B5B] hover:bg-[#8A6B4B] text-[#1E1D1F] text-xs gap-1"
                    >
                      {importing ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Download className="w-3 h-3" />
                      )}
                      Import Selected
                    </Button>
                  </div>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
