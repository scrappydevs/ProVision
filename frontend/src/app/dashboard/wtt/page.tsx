"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Database,
  Loader2,
  Search,
  RefreshCw,
  Trophy,
  MapPin,
  Calendar,
  ChevronRight,
  Swords,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWTTTournaments, useSyncWTTRecent } from "@/hooks/useWTTData";
import { WTTTournament } from "@/lib/api";
import Link from "next/link";

const tierColors: Record<string, string> = {
  "Grand Smash": "text-amber-400 bg-amber-400/10 border-amber-400/20",
  Champions: "text-purple-400 bg-purple-400/10 border-purple-400/20",
  "Star Contender": "text-blue-400 bg-blue-400/10 border-blue-400/20",
  Contender: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
  Finals: "text-red-400 bg-red-400/10 border-red-400/20",
  Other: "text-muted-foreground bg-muted border-muted",
};

const statusDot: Record<string, string> = {
  upcoming: "bg-blue-400",
  ongoing: "bg-green-400 animate-pulse",
  completed: "bg-muted-foreground",
  cancelled: "bg-red-400",
};

const tiers = [
  "All",
  "Grand Smash",
  "Champions",
  "Star Contender",
  "Contender",
  "Finals",
];

const formatDate = (d?: string) => {
  if (!d) return "";
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

export default function WTTDatabasePage() {
  const [search, setSearch] = useState("");
  const [selectedTier, setSelectedTier] = useState("All");

  const { data: tournaments, isLoading, refetch } = useWTTTournaments({
    tier: selectedTier === "All" ? undefined : selectedTier,
    search: search || undefined,
  });

  const syncRecent = useSyncWTTRecent();

  const handleSync = () => {
    syncRecent.mutate(30, {
      onSuccess: () => refetch(),
    });
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-light text-foreground flex items-center gap-2">
            <Database className="w-5 h-5 text-primary" />
            WTT Match Database
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Browse professional WTT tournament results, match scores, and player
            data
          </p>
        </div>
        <Button
          onClick={handleSync}
          disabled={syncRecent.isPending}
          variant="outline"
          className="shrink-0"
        >
          {syncRecent.isPending ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4 mr-2" />
          )}
          Sync Recent
        </Button>
      </div>

      {/* Tier Filter + Search */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex gap-1 overflow-x-auto pb-1">
          {tiers.map((tier) => (
            <button
              key={tier}
              onClick={() => setSelectedTier(tier)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                selectedTier === tier
                  ? "bg-primary text-primary-foreground"
                  : "bg-card text-muted-foreground hover:text-foreground border border-border"
              }`}
            >
              {tier}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search tournaments..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-card border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
          />
        </div>
      </div>

      {/* Tournament Grid */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      ) : !tournaments?.length ? (
        <EmptyState onSync={handleSync} syncing={syncRecent.isPending} />
      ) : (
        <div className="grid gap-2">
          <AnimatePresence mode="popLayout">
            {tournaments.map((t, i) => (
              <TournamentCard key={t.id} tournament={t} index={i} />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

function TournamentCard({
  tournament: t,
  index,
}: {
  tournament: WTTTournament;
  index: number;
}) {
  const tier = t.tier || "Other";
  const tierStyle = tierColors[tier] || tierColors.Other;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ delay: index * 0.03 }}
    >
      <Link href={`/dashboard/wtt/${t.id}`}>
        <div className="group bg-card border border-border rounded-xl p-3 hover:border-primary/50 transition-all cursor-pointer">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0">
              {/* Tier badge */}
              <div
                className={`px-2.5 py-1 rounded-md text-[11px] font-semibold border whitespace-nowrap ${tierStyle}`}
              >
                {tier}
              </div>

              {/* Tournament info */}
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
                    {t.name}
                  </h3>
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      statusDot[t.status || "completed"]
                    }`}
                  />
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                  {t.location && (
                    <span className="flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      {t.location}
                    </span>
                  )}
                  {t.start_date && (
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {formatDate(t.start_date)}
                      {t.end_date && ` – ${formatDate(t.end_date)}`}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Right side */}
            <div className="flex items-center gap-4 shrink-0">
              {t.match_count != null && t.match_count > 0 && (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Swords className="w-3.5 h-3.5" />
                  {t.match_count} matches
                </span>
              )}
              <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
            </div>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}

function EmptyState({
  onSync,
  syncing,
}: {
  onSync: () => void;
  syncing: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-14 h-14 rounded-xl bg-card flex items-center justify-center mb-3">
        <Trophy className="w-7 h-7 text-primary" />
      </div>
      <h3 className="text-lg font-light text-foreground mb-1">
        No tournaments synced yet
      </h3>
      <p className="text-sm text-muted-foreground mb-4 max-w-md">
        Sync recent WTT tournaments to browse match results, scores, and find
        match videos from the official WTT YouTube channel.
      </p>
      <Button
        onClick={onSync}
        disabled={syncing}
        className="bg-primary hover:bg-primary/90 text-primary-foreground"
      >
        {syncing ? (
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
        ) : (
          <RefreshCw className="w-4 h-4 mr-2" />
        )}
        Sync Recent Tournaments
      </Button>
    </div>
  );
}
