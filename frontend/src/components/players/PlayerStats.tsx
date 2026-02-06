"use client";

import { Gamepad2, Calendar, TrendingUp } from "lucide-react";

interface PlayerStatsProps {
  gameCount: number;
  lastActive?: string;
}

export function PlayerStats({ gameCount, lastActive }: PlayerStatsProps) {
  return (
    <div className="grid grid-cols-3 gap-4">
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <Gamepad2 className="w-4 h-4 text-[#9B7B5B]" />
          <span className="text-xs text-muted-foreground">Total Games</span>
        </div>
        <p className="text-2xl font-light text-foreground">{gameCount}</p>
      </div>

      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <Calendar className="w-4 h-4 text-[#9B7B5B]" />
          <span className="text-xs text-muted-foreground">Last Active</span>
        </div>
        <p className="text-sm font-light text-foreground">
          {lastActive
            ? new Date(lastActive).toLocaleDateString()
            : "No games yet"}
        </p>
      </div>

      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <TrendingUp className="w-4 h-4 text-[#9B7B5B]" />
          <span className="text-xs text-muted-foreground">Status</span>
        </div>
        <p className="text-sm font-light text-foreground">
          {gameCount > 0 ? "Active" : "New"}
        </p>
      </div>
    </div>
  );
}
