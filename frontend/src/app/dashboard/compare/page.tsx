"use client";

import { useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { Card, CardBody, CardHeader } from "@heroui/react";
import { Calendar, Swords, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PlayerCard } from "@/components/players/PlayerCard";
import { usePlayers, usePlayerGames } from "@/hooks/usePlayers";
import { tournamentKeys, useTournaments, useUpcomingTournaments } from "@/hooks/useTournaments";
import { getTournamentMatchups, Matchup, Player, Tournament } from "@/lib/api";

type ResultSummary = {
  recent: string[];
  streak: { kind: "win" | "loss"; count: number } | null;
};

const RESULT_LABELS: Record<string, string> = {
  win: "W",
  loss: "L",
  draw: "D",
  pending: "P",
  walkover: "W/O",
  retired: "RET",
};

const formatDate = (value?: string) => {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const getResultSummary = (matchups: Matchup[], limit = 5): ResultSummary => {
  const sortable = matchups
    .filter((m) => m.result && m.result !== "pending")
    .sort((a, b) => {
      const aDate = new Date(a.scheduled_at || a.created_at).getTime();
      const bDate = new Date(b.scheduled_at || b.created_at).getTime();
      return bDate - aDate;
    });
  const recent = sortable.slice(0, limit).map((m) => RESULT_LABELS[m.result || "pending"] || "P");
  let streak: ResultSummary["streak"] = null;
  if (sortable.length) {
    const first = sortable[0].result;
    if (first === "win" || first === "loss") {
      let count = 0;
      for (const matchup of sortable) {
        if (matchup.result === first) count += 1;
        else break;
      }
      streak = { kind: first, count };
    }
  }
  return { recent, streak };
};

const buildStyleSummary = (player?: Player) => {
  if (!player) return "Select a player.";
  const style = player.ittf_data?.playing_style;
  const ranking = player.ittf_data?.ranking;
  const handedness = player.handedness === "left" ? "Left-handed" : "Right-handed";
  const parts = [handedness];
  if (style) parts.push(style);
  if (ranking) parts.push(`World rank #${ranking}`);
  return parts.join(" • ");
};

const filterMatchupsByPlayer = (matchups: Matchup[], playerId?: string) => {
  if (!playerId) return [];
  return matchups.filter((m) => m.player_id === playerId);
};

const getRecentActivity = (games?: { created_at: string }[]) => {
  if (!games?.length) return 0;
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  return games.filter((g) => new Date(g.created_at).getTime() >= cutoff).length;
};

const getUpcomingMatchups = (
  tournament: Tournament,
  matchups: Matchup[],
  limit = 2
) => {
  const list = matchups
    .filter((m) => m.tournament_id === tournament.id)
    .sort((a, b) => {
      const aDate = new Date(a.scheduled_at || a.created_at).getTime();
      const bDate = new Date(b.scheduled_at || b.created_at).getTime();
      return aDate - bDate;
    });
  return list.slice(0, limit);
};

export default function ComparePage() {
  const { data: players, isLoading: playersLoading } = usePlayers();
  const { data: tournaments } = useTournaments();
  const { data: upcomingTournaments } = useUpcomingTournaments();
  const [leftId, setLeftId] = useState("");
  const [rightId, setRightId] = useState("");

  const leftPlayer = players?.find((p) => p.id === leftId);
  const rightPlayer = players?.find((p) => p.id === rightId);

  const { data: leftGames } = usePlayerGames(leftId);
  const { data: rightGames } = usePlayerGames(rightId);

  const matchupQueries = useQueries({
    queries: (tournaments ?? []).map((tournament) => ({
      queryKey: tournamentKeys.matchups(tournament.id),
      queryFn: async () => {
        const response = await getTournamentMatchups(tournament.id);
        return response.data;
      },
      enabled: !!tournaments?.length,
    })),
  });

  const allMatchups = useMemo(() => {
    return matchupQueries.flatMap((q) => q.data ?? []);
  }, [matchupQueries]);

  const sharedGames = useMemo(() => {
    if (!leftGames?.length || !rightGames?.length) return [];
    const rightIds = new Set(rightGames.map((g) => g.id));
    return leftGames.filter((g) => rightIds.has(g.id));
  }, [leftGames, rightGames]);

  const lastShared = useMemo(() => {
    if (!sharedGames.length) return null;
    return [...sharedGames].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )[0];
  }, [sharedGames]);

  const leftMatchups = useMemo(() => filterMatchupsByPlayer(allMatchups, leftId), [allMatchups, leftId]);
  const rightMatchups = useMemo(() => filterMatchupsByPlayer(allMatchups, rightId), [allMatchups, rightId]);

  const leftSummary = useMemo(() => getResultSummary(leftMatchups), [leftMatchups]);
  const rightSummary = useMemo(() => getResultSummary(rightMatchups), [rightMatchups]);

  const recommendedTournaments = useMemo(() => {
    return (upcomingTournaments ?? []).filter((t) => t.level === "international" || t.level === "world");
  }, [upcomingTournaments]);

  const canCompare = leftPlayer && rightPlayer && leftId !== rightId;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-light text-foreground flex items-center gap-2">
            <Swords className="w-5 h-5 text-primary" />
            Player Comparison
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Compare head-to-head stats, style matchup, and streaks.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            setLeftId("");
            setRightId("");
          }}
        >
          Reset
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="bg-content1/60">
          <CardHeader className="text-sm text-foreground/70">Player A</CardHeader>
          <CardBody className="space-y-4">
            <select
              value={leftId}
              onChange={(e) => setLeftId(e.target.value)}
              className="w-full px-3 py-2 bg-background rounded-lg text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
            >
              <option value="">Select player</option>
              {(players ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {leftPlayer ? (
              <div className="max-w-[240px]">
                <PlayerCard player={leftPlayer} onClick={() => null} />
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Pick a player to see the card.</p>
            )}
          </CardBody>
        </Card>

        <Card className="bg-content1/60">
          <CardHeader className="text-sm text-foreground/70">Player B</CardHeader>
          <CardBody className="space-y-4">
            <select
              value={rightId}
              onChange={(e) => setRightId(e.target.value)}
              className="w-full px-3 py-2 bg-background rounded-lg text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
            >
              <option value="">Select player</option>
              {(players ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {rightPlayer ? (
              <div className="max-w-[240px]">
                <PlayerCard player={rightPlayer} onClick={() => null} />
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Pick a player to see the card.</p>
            )}
          </CardBody>
        </Card>
      </div>

      {!playersLoading && leftId === rightId && leftId && (
        <p className="text-xs text-red-400 mt-3">Select two different players to compare.</p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-8">
        <Card className="bg-content1/60">
          <CardHeader className="text-sm text-foreground/70">Head-to-Head</CardHeader>
          <CardBody className="space-y-2">
            {canCompare ? (
              <>
                <p className="text-2xl font-semibold text-foreground">{sharedGames.length}</p>
                <p className="text-xs text-muted-foreground">
                  Shared sessions • Last: {lastShared ? formatDate(lastShared.created_at) : "—"}
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                Select two players to view shared match history.
              </p>
            )}
          </CardBody>
        </Card>

        <Card className="bg-content1/60">
          <CardHeader className="text-sm text-foreground/70">Style Matchup</CardHeader>
          <CardBody className="space-y-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Player A</p>
              <p className="text-sm text-foreground/80">{buildStyleSummary(leftPlayer)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Player B</p>
              <p className="text-sm text-foreground/80">{buildStyleSummary(rightPlayer)}</p>
            </div>
            {canCompare && (leftPlayer?.description || rightPlayer?.description) && (
              <div className="pt-2 border-t border-content3 space-y-2">
                {leftPlayer?.description && (
                  <p className="text-xs text-foreground/60 whitespace-pre-line">
                    {leftPlayer.description}
                  </p>
                )}
                {rightPlayer?.description && (
                  <p className="text-xs text-foreground/60 whitespace-pre-line">
                    {rightPlayer.description}
                  </p>
                )}
              </div>
            )}
          </CardBody>
        </Card>

        <Card className="bg-content1/60">
          <CardHeader className="text-sm text-foreground/70">Streaks</CardHeader>
          <CardBody className="space-y-4">
            {canCompare ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Player A</span>
                  {leftSummary.streak ? (
                    <span className="text-xs text-foreground">
                      {leftSummary.streak.count} {leftSummary.streak.kind.toUpperCase()} streak
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {getRecentActivity(leftGames)} sessions in 30 days
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  {leftSummary.recent.length ? (
                    leftSummary.recent.map((r, i) => (
                      <span
                        key={`l-${i}`}
                        className="text-[10px] px-2 py-0.5 rounded-full bg-content2 text-foreground/70"
                      >
                        {r}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-muted-foreground">No results yet</span>
                  )}
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Player B</span>
                  {rightSummary.streak ? (
                    <span className="text-xs text-foreground">
                      {rightSummary.streak.count} {rightSummary.streak.kind.toUpperCase()} streak
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {getRecentActivity(rightGames)} sessions in 30 days
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  {rightSummary.recent.length ? (
                    rightSummary.recent.map((r, i) => (
                      <span
                        key={`r-${i}`}
                        className="text-[10px] px-2 py-0.5 rounded-full bg-content2 text-foreground/70"
                      >
                        {r}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-muted-foreground">No results yet</span>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Choose two players to compare streaks.</p>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="mt-10">
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-medium text-foreground">
            Recommended International Matchups
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {recommendedTournaments.length ? (
            recommendedTournaments.map((tournament) => {
              const matchups = getUpcomingMatchups(tournament, allMatchups);
              return (
                <Card key={tournament.id} className="bg-content1/60">
                  <CardBody className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-foreground">{tournament.name}</p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {formatDate(tournament.start_date)}
                        </p>
                      </div>
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        {tournament.level}
                      </span>
                    </div>
                    {matchups.length ? (
                      <div className="space-y-1">
                        {matchups.map((m) => (
                          <p key={m.id} className="text-xs text-foreground/70">
                            {m.player_name || "TBD"} vs {m.opponent_name}
                          </p>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Matchups will be announced soon.
                      </p>
                    )}
                  </CardBody>
                </Card>
              );
            })
          ) : (
            <Card className="bg-content1/60">
              <CardBody className="text-xs text-muted-foreground">
                No upcoming international tournaments yet.
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
