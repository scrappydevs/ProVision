"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { GamePlayerInfo } from "@/lib/api";
import { Gamepad2, Play, Clock, CheckCircle, XCircle, Loader2, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface GameTimelineProps {
  games: GamePlayerInfo[];
}

const statusConfig: Record<string, { icon: React.ComponentType<{ className?: string }>; color: string; bg: string; hex: string; label: string }> = {
  pending: { icon: Clock, color: "text-muted-foreground", bg: "bg-muted-foreground", hex: "#8A8885", label: "Pending" },
  processing: { icon: Loader2, color: "text-[#9B7B5B]", bg: "bg-[#9B7B5B]", hex: "#9B7B5B", label: "Processing" },
  completed: { icon: CheckCircle, color: "text-[#6B8E6B]", bg: "bg-[#6B8E6B]", hex: "#6B8E6B", label: "Ready" },
  failed: { icon: XCircle, color: "text-[#C45C5C]", bg: "bg-[#C45C5C]", hex: "#C45C5C", label: "Failed" },
};

interface DateGroup {
  dateKey: string;
  dateLabel: string;
  games: GamePlayerInfo[];
}

export function GameTimeline({ games }: GameTimelineProps) {
  const router = useRouter();
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const [progressWidth, setProgressWidth] = useState(0);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Group by date
  const dateGroups = useMemo((): DateGroup[] => {
    const sorted = [...games].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
    const groups: DateGroup[] = [];
    for (const game of sorted) {
      const date = new Date(game.created_at);
      const dateKey = date.toISOString().split("T")[0];
      const dateLabel = date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      const existing = groups.find((g) => g.dateKey === dateKey);
      if (existing) existing.games.push(game);
      else groups.push({ dateKey, dateLabel, games: [game] });
    }
    return groups;
  }, [games]);

  const allGames = useMemo(() => dateGroups.flatMap((g) => g.games), [dateGroups]);

  useEffect(() => {
    if (allGames.length === 0) return;
    const completed = allGames.filter((g) => g.status === "completed").length;
    const target = (completed / allGames.length) * 100;
    const timer = setTimeout(() => setProgressWidth(target), 100);
    return () => clearTimeout(timer);
  }, [allGames]);

  // Close popover on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setExpandedDate(null);
      }
    };
    if (expandedDate) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [expandedDate]);

  const handleClick = useCallback(
    (id: string) => { setExpandedDate(null); router.push(`/dashboard/games/${id}`); },
    [router]
  );

  if (games.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <Gamepad2 className="w-5 h-5 text-border mb-2" />
        <p className="text-xs text-muted-foreground">No games yet</p>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="overflow-x-auto pb-2">
        <div className="relative min-w-max">
          {/* Progress track */}
          <div className="absolute top-[38px] left-0 right-0 mx-8">
            <div className="h-[2px] bg-border rounded-full w-full" />
            <div
              className="h-[2px] bg-gradient-to-r from-[#9B7B5B] to-[#6B8E6B] rounded-full -mt-[2px] transition-all duration-1000 ease-out"
              style={{ width: `${progressWidth}%` }}
            />
          </div>

          {/* Date groups — all same height */}
          <div className="flex">
            {dateGroups.map((group) => {
              const hasMultiple = group.games.length > 1;
              const isExpanded = expandedDate === group.dateKey;
              const singleGame = !hasMultiple ? group.games[0] : null;

              const bestStatus = group.games.some((g) => g.status === "completed") ? "completed"
                : group.games.some((g) => g.status === "processing") ? "processing"
                : group.games.some((g) => g.status === "failed") ? "failed" : "pending";
              const nodeStatus = statusConfig[bestStatus];
              const NodeIcon = nodeStatus.icon;
              const singleStatus = singleGame ? (statusConfig[singleGame.status] || statusConfig.pending) : null;

              return (
                <div key={group.dateKey} className="relative flex flex-col items-center" style={{ width: 140 }}>
                  {/* Date */}
                  <p className="text-[10px] text-muted-foreground mb-3">{group.dateLabel}</p>

                  {/* Node */}
                  <div className="relative z-10 mb-2">
                    <div
                      className={cn(
                        "w-[18px] h-[18px] rounded-full flex items-center justify-center transition-all duration-200",
                        bestStatus === "completed" ? "bg-[#6B8E6B]" : bestStatus === "processing" ? "bg-[#9B7B5B]" : "bg-border",
                        hasMultiple && "cursor-pointer hover:scale-125"
                      )}
                      onClick={hasMultiple ? () => setExpandedDate(isExpanded ? null : group.dateKey) : undefined}
                    >
                      <NodeIcon className={cn(
                        "w-[9px] h-[9px]",
                        bestStatus === "completed" || bestStatus === "processing" ? "text-primary-foreground" : "text-muted-foreground",
                        bestStatus === "processing" && "animate-spin"
                      )} />
                    </div>
                    {hasMultiple && (
                      <div className="absolute -top-1 -right-2.5 w-4 h-4 rounded-full bg-[#9B7B5B] flex items-center justify-center">
                        <span className="text-[7px] font-bold text-primary-foreground">{group.games.length}</span>
                      </div>
                    )}
                  </div>

                  {/* Summary line — always compact */}
                  {hasMultiple ? (
                    <button
                      onClick={() => setExpandedDate(isExpanded ? null : group.dateKey)}
                      className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {group.games.length} games
                    </button>
                  ) : singleGame ? (
                    <button
                      onClick={() => handleClick(singleGame.id)}
                      className="text-[10px] text-foreground hover:text-[#9B7B5B] transition-colors truncate max-w-[120px]"
                    >
                      {singleGame.name}
                    </button>
                  ) : null}

                  {/* Single game status */}
                  {singleGame && singleStatus && (
                    <div className="flex items-center gap-1 mt-0.5">
                      <div className="w-1 h-1 rounded-full" style={{ background: singleStatus.hex }} />
                      <span className="text-[8px]" style={{ color: singleStatus.hex }}>{singleStatus.label}</span>
                    </div>
                  )}

                  {/* Expanded popover for multi-game dates */}
                  {isExpanded && hasMultiple && (
                    <div
                      ref={popoverRef}
                      className="absolute top-[80px] left-1/2 -translate-x-1/2 z-50 w-56 rounded-xl bg-card border border-border/50 shadow-xl shadow-black/30 overflow-hidden"
                    >
                      <div className="px-3 py-2 border-b border-border/30">
                        <p className="text-[10px] text-muted-foreground">{group.dateLabel} — {group.games.length} games</p>
                      </div>
                      <div className="max-h-48 overflow-y-auto">
                        {group.games.map((game) => {
                          const status = statusConfig[game.status] || statusConfig.pending;
                          return (
                            <button
                              key={game.id}
                              onClick={() => handleClick(game.id)}
                              className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-muted transition-colors text-left"
                            >
                              <div className="w-10 h-7 rounded bg-background flex items-center justify-center overflow-hidden shrink-0">
                                {game.video_path ? (
                                  <video src={game.video_path} className="w-full h-full object-cover" muted />
                                ) : (
                                  <Play className="w-2.5 h-2.5 text-border" />
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-[10px] text-foreground truncate">{game.name}</p>
                                <div className="flex items-center gap-1">
                                  <div className="w-1 h-1 rounded-full" style={{ background: status.hex }} />
                                  <span className="text-[8px]" style={{ color: status.hex }}>{status.label}</span>
                                </div>
                              </div>
                              <ChevronRight className="w-3 h-3 text-border shrink-0" />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
