"use client";

import { usePlayers } from "@/hooks/usePlayers";
import { useTournamentStats } from "@/hooks/useTournaments";
import { useSessions } from "@/hooks/useSessions";
import { BarChart3, Users, Trophy, Gamepad2, Loader2 } from "lucide-react";

export default function StatsPage() {
  const { data: players, isLoading: playersLoading } = usePlayers();
  const { data: tournamentStats, isLoading: statsLoading } = useTournamentStats();
  const { data: sessions, isLoading: sessionsLoading } = useSessions();

  const isLoading = playersLoading || statsLoading || sessionsLoading;

  const playerCount = players?.length ?? 0;
  const gameCount = sessions?.length ?? 0;
  const totalTournaments = tournamentStats?.total_tournaments ?? 0;
  const totalMatchups = tournamentStats?.total_matchups ?? 0;
  const winRate = tournamentStats?.win_rate ?? 0;
  const wins = tournamentStats?.wins ?? 0;
  const losses = tournamentStats?.losses ?? 0;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-light text-foreground">Stats</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Overview of your roster, games, and tournament performance
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl bg-card border border-border p-4">
          <div className="flex items-center gap-2 mb-1.5">
            <Users className="w-4 h-4 text-primary" />
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Players</span>
          </div>
          <p className="text-2xl font-light text-foreground">{playerCount}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">In your roster</p>
        </div>

        <div className="rounded-xl bg-card border border-border p-4">
          <div className="flex items-center gap-2 mb-1.5">
            <Gamepad2 className="w-4 h-4 text-primary" />
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Games</span>
          </div>
          <p className="text-2xl font-light text-foreground">{gameCount}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Analyzed sessions</p>
        </div>

        <div className="rounded-xl bg-card border border-border p-4">
          <div className="flex items-center gap-2 mb-1.5">
            <Trophy className="w-4 h-4 text-primary" />
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Tournaments</span>
          </div>
          <p className="text-2xl font-light text-foreground">{totalTournaments}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">{totalMatchups} matchups</p>
        </div>

        <div className="rounded-xl bg-card border border-border p-4">
          <div className="flex items-center gap-2 mb-1.5">
            <BarChart3 className="w-4 h-4 text-primary" />
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Win Rate</span>
          </div>
          <p className="text-2xl font-light text-foreground">{winRate}%</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">{wins}W – {losses}L</p>
        </div>
      </div>

      <div className="rounded-xl bg-card border border-border p-4">
        <h2 className="text-sm font-medium text-foreground mb-3">Quick summary</h2>
        <p className="text-sm text-muted-foreground">
          {playerCount === 0 && gameCount === 0
            ? "Add players and upload game footage to start tracking your stats."
            : `You have ${playerCount} player${playerCount !== 1 ? "s" : ""} and ${gameCount} analyzed game${gameCount !== 1 ? "s" : ""}.`}
          {totalMatchups > 0 && ` Tournament record: ${wins} wins, ${losses} losses.`}
        </p>
      </div>
    </div>
  );
}
