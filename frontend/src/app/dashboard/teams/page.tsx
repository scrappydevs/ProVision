"use client";

import { useMemo } from "react";
import { usePlayers } from "@/hooks/usePlayers";
import { Player } from "@/lib/api";
import Link from "next/link";
import { Loader2, Users, User } from "lucide-react";

export default function TeamsPage() {
  const { data: players, isLoading } = usePlayers();

  const teamGroups = useMemo(() => {
    if (!players) return [];
    const groups: Record<string, Player[]> = {};
    for (const p of players) {
      const team = p.team?.trim() || "Unassigned";
      if (!groups[team]) groups[team] = [];
      groups[team].push(p);
    }
    // Sort: named teams first, then Unassigned
    return Object.entries(groups).sort(([a], [b]) => {
      if (a === "Unassigned") return 1;
      if (b === "Unassigned") return -1;
      return a.localeCompare(b);
    });
  }, [players]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="w-8 h-8 text-[#9B7B5B] animate-spin" />
      </div>
    );
  }

  if (!players?.length) {
    return (
      <div className="text-center py-16">
        <Users className="w-12 h-12 text-border mx-auto mb-4" />
        <p className="text-muted-foreground text-sm">No players yet</p>
        <p className="text-muted-foreground text-xs mt-1">
          Add players with a team field to see them grouped here
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-light text-foreground">Teams</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Players grouped by team
        </p>
      </div>

      {teamGroups.map(([teamName, members]) => (
        <div key={teamName}>
          <div className="flex items-center gap-2 mb-3">
            <Users className="w-4 h-4 text-[#9B7B5B]" />
            <h2 className="text-sm font-medium text-foreground">{teamName}</h2>
            <span className="text-xs text-muted-foreground">
              {members.length} {members.length === 1 ? "player" : "players"}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {members.map((player) => (
              <Link
                key={player.id}
                href={`/dashboard/players/${player.id}`}
                className="rounded-xl bg-card hover:bg-muted border border-border hover:border-primary/30 p-4 transition-all"
              >
                <div className="flex items-center gap-3">
                  {player.avatar_url ? (
                    <img
                      src={player.avatar_url}
                      alt={player.name}
                      className="w-10 h-10 rounded-full object-cover"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-border flex items-center justify-center">
                      <User className="w-5 h-5 text-muted-foreground" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground truncate">
                      {player.name}
                    </p>
                    {player.position && (
                      <p className="text-xs text-muted-foreground truncate">
                        {player.position}
                      </p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-muted-foreground">
                      {player.game_count ?? 0}
                    </p>
                    <p className="text-[10px] text-muted-foreground">games</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>

          {/* Team aggregate */}
          <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
            <span>
              Total games:{" "}
              {members.reduce((sum, p) => sum + (p.game_count ?? 0), 0)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
