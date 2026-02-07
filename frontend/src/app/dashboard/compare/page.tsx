"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import { useQueries } from "@tanstack/react-query";
import { RotateCw } from "lucide-react";
import { usePlayers, usePlayerGames } from "@/hooks/usePlayers";
import { tournamentKeys, useTournaments } from "@/hooks/useTournaments";
import { analyzePlayerMatchup, getTournamentMatchups, Matchup, MatchupAnalysisResponse, Player } from "@/lib/api";
import { useMutation } from "@tanstack/react-query";
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer,
  Legend,
  Tooltip,
} from "recharts";

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
  return parts.join(" · ");
};

const getSafeDescription = (value?: string) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return null;
  return trimmed;
};

const tryParseJsonString = (value?: string) => {
  if (!value) return null;
  // Strip markdown code fences
  let cleaned = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  // Extract from first { to last }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1) return null;
  if (end > start) cleaned = cleaned.slice(start, end + 1);
  else cleaned = cleaned.slice(start);
  try {
    return JSON.parse(cleaned);
  } catch {
    // Repair truncated JSON using a bracket stack
    const stack: string[] = [];
    let inStr = false;
    let esc = false;
    let lastSafe = 0; // position after last complete value/comma
    for (let i = 0; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (esc) { esc = false; continue; }
      if (ch === "\\" && inStr) { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === "{") stack.push("}");
      else if (ch === "[") stack.push("]");
      else if ((ch === "}" || ch === "]") && stack.length) stack.pop();
      if (ch === "," || ch === "}" || ch === "]") lastSafe = i;
    }
    if (stack.length === 0) return null; // wasn't a truncation issue
    let repaired = cleaned.slice(0, lastSafe + 1).replace(/,\s*$/, "");
    // Re-scan to get current stack state after truncation
    const stack2: string[] = [];
    let inStr2 = false;
    let esc2 = false;
    for (let i = 0; i < repaired.length; i++) {
      const ch = repaired[i];
      if (esc2) { esc2 = false; continue; }
      if (ch === "\\" && inStr2) { esc2 = true; continue; }
      if (ch === '"') { inStr2 = !inStr2; continue; }
      if (inStr2) continue;
      if (ch === "{") stack2.push("}");
      else if (ch === "[") stack2.push("]");
      else if ((ch === "}" || ch === "]") && stack2.length) stack2.pop();
    }
    while (stack2.length) repaired += stack2.pop();
    try {
      return JSON.parse(repaired);
    } catch {
      return null;
    }
  }
};

const normalizeMatchupAnalysis = (data?: MatchupAnalysisResponse | null) => {
  if (!data) return null;
  let base: MatchupAnalysisResponse = data;

  // Collect candidate strings that might contain the full JSON response
  const candidates: string[] = [];
  if (typeof data.raw === "string" && data.raw.includes("{")) candidates.push(data.raw);
  if (typeof data.headline === "string" && data.headline.includes("{")) candidates.push(data.headline);
  // Backend puts raw JSON into tactical_advantage as ["<json>"] when parsing fails
  const ta = data.tactical_advantage;
  if (typeof ta === "string" && ta.includes("{")) candidates.push(ta);
  if (Array.isArray(ta) && ta.length === 1 && typeof ta[0] === "string" && ta[0].includes("{")) {
    candidates.push(ta[0]);
  }

  for (const candidate of candidates) {
    const parsed = tryParseJsonString(candidate);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && (parsed.headline || parsed.tactical_advantage)) {
      base = { ...data, ...(parsed as MatchupAnalysisResponse) };
      break;
    }
  }

  const normalizeList = (value: unknown) => {
    if (Array.isArray(value)) return value.filter(Boolean) as string[];
    if (typeof value === "string") return [value];
    return [];
  };

  return {
    ...base,
    tactical_advantage: normalizeList(base.tactical_advantage),
    key_edges: normalizeList(base.key_edges),
    serve_receive_plan: normalizeList(base.serve_receive_plan),
    rally_length_bias: normalizeList(base.rally_length_bias),
  };
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

const buildMatchupInsights = ({
  leftPlayer,
  rightPlayer,
  leftSummary,
  rightSummary,
  sharedGames,
  lastShared,
  leftGames,
  rightGames,
}: {
  leftPlayer?: Player;
  rightPlayer?: Player;
  leftSummary: ResultSummary;
  rightSummary: ResultSummary;
  sharedGames: { created_at: string }[];
  lastShared: { created_at: string } | null;
  leftGames?: { created_at: string }[];
  rightGames?: { created_at: string }[];
}) => {
  if (!leftPlayer || !rightPlayer) return [];
  const insights: string[] = [];

  if (sharedGames.length) {
    insights.push(
      `Head-to-head: ${sharedGames.length} shared sessions, last on ${formatDate(lastShared?.created_at)}.`
    );
  } else {
    insights.push("Head-to-head: no shared sessions recorded yet.");
  }

  const leftRank = leftPlayer.ittf_data?.ranking;
  const rightRank = rightPlayer.ittf_data?.ranking;
  if (leftRank && rightRank) {
    const edge =
      leftRank < rightRank
        ? `${leftPlayer.name} has the ranking edge (#${leftRank} vs #${rightRank}).`
        : rightRank < leftRank
        ? `${rightPlayer.name} has the ranking edge (#${rightRank} vs #${leftRank}).`
        : `Both players are ranked #${leftRank}.`;
    insights.push(edge);
  }

  if (leftPlayer.handedness && rightPlayer.handedness) {
    if (leftPlayer.handedness !== rightPlayer.handedness) {
      insights.push(
        `Handedness split: ${leftPlayer.name} is ${leftPlayer.handedness}-handed, ${rightPlayer.name} is ${rightPlayer.handedness}-handed.`
      );
    } else {
      insights.push(`Both players are ${leftPlayer.handedness}-handed.`);
    }
  }

  if (leftSummary.streak || rightSummary.streak) {
    const leftStreak = leftSummary.streak
      ? `${leftPlayer.name} is on a ${leftSummary.streak.count} ${leftSummary.streak.kind} streak.`
      : `${leftPlayer.name} has ${getRecentActivity(leftGames)} sessions in 30 days.`;
    const rightStreak = rightSummary.streak
      ? `${rightPlayer.name} is on a ${rightSummary.streak.count} ${rightSummary.streak.kind} streak.`
      : `${rightPlayer.name} has ${getRecentActivity(rightGames)} sessions in 30 days.`;
    insights.push(leftStreak, rightStreak);
  }

  const leftStyle = leftPlayer.ittf_data?.playing_style;
  const rightStyle = rightPlayer.ittf_data?.playing_style;
  if (leftStyle || rightStyle) {
    insights.push(
      `Style matchup: ${leftPlayer.name}${leftStyle ? ` (${leftStyle})` : ""} vs ${rightPlayer.name}${rightStyle ? ` (${rightStyle})` : ""}.`
    );
  }

  return insights;
};

export default function ComparePage() {
  const { data: players, isLoading: playersLoading } = usePlayers();
  const { data: tournaments } = useTournaments();
  const [leftId, setLeftId] = useState("");
  const [rightId, setRightId] = useState("");
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [analysisData, setAnalysisData] = useState<MatchupAnalysisResponse | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const lastAnalysisKey = useRef<string | null>(null);

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

  const canCompare = leftPlayer && rightPlayer && leftId !== rightId;
  const matchupInsights = useMemo(
    () =>
      buildMatchupInsights({
        leftPlayer,
        rightPlayer,
        leftSummary,
        rightSummary,
        sharedGames,
        lastShared,
        leftGames,
        rightGames,
      }),
    [leftPlayer, rightPlayer, leftSummary, rightSummary, sharedGames, lastShared, leftGames, rightGames]
  );
  const normalizedAnalysis = useMemo(
    () => normalizeMatchupAnalysis(analysisData),
    [analysisData]
  );

  const filteredPlayers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return players ?? [];
    return (players ?? []).filter((p) => {
      const name = p.name.toLowerCase();
      const team = p.team?.toLowerCase() ?? "";
      return name.includes(query) || team.includes(query);
    });
  }, [players, searchQuery]);

  const handleRosterPick = (playerId: string) => {
    if (!leftId) {
      setLeftId(playerId);
      return;
    }
    if (!rightId) {
      if (playerId !== leftId) setRightId(playerId);
      return;
    }
    if (playerId === leftId) return;
    setRightId(playerId);
  };

  const analyzeMatchupMutation = useMutation({
    mutationFn: async () => {
      if (!leftId || !rightId) {
        throw new Error("Missing player ids");
      }
      const response = await analyzePlayerMatchup(leftId, rightId);
      return response.data;
    },
    onSuccess: (data) => {
      setAnalysisData(data);
      setAnalysisError(null);
    },
    onError: (err: unknown) => {
      setAnalysisError(err instanceof Error ? err.message : "Failed to analyze matchup.");
    },
  });

  useEffect(() => {
    if (!canCompare) return;
    const key = `${leftId}:${rightId}`;
    if (lastAnalysisKey.current === key) return;
    lastAnalysisKey.current = key;
    setAnalysisOpen(true);
    setAnalysisData(null);
    setAnalysisError(null);
    analyzeMatchupMutation.mutate();
  }, [canCompare, leftId, rightId, analyzeMatchupMutation]);

  // Collect analysis sections
  const analysisSections = useMemo(() => {
    if (!normalizedAnalysis) return [];
    const sections: { title: string; items: string[] }[] = [];
    if (normalizedAnalysis.tactical_advantage?.length) {
      sections.push({ title: "Tactical Advantage", items: normalizedAnalysis.tactical_advantage });
    }
    if (normalizedAnalysis.key_edges?.length) {
      sections.push({ title: "Key Edges", items: normalizedAnalysis.key_edges });
    }
    if (normalizedAnalysis.serve_receive_plan?.length) {
      sections.push({ title: "Serve & Receive", items: normalizedAnalysis.serve_receive_plan });
    }
    if (normalizedAnalysis.rally_length_bias?.length) {
      sections.push({ title: "Rally Length", items: normalizedAnalysis.rally_length_bias });
    }
    return sections;
  }, [normalizedAnalysis]);

  // Player card helper
  const renderPlayerSlot = (
    label: string,
    player: Player | undefined,
    id: string,
    setId: (v: string) => void
  ) => (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs uppercase tracking-widest text-foreground/40">{label}</p>
        <select
          value={id}
          onChange={(e) => setId(e.target.value)}
          className="px-3 py-1 bg-foreground/5 rounded-lg text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
        >
          <option value="">Select</option>
          {(players ?? []).map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>
      {player ? (
        <div>
          <p className="text-base font-medium text-foreground mb-1">{player.name}</p>
          <p className="text-sm text-foreground/50 mb-2">{buildStyleSummary(player)}</p>
          {getSafeDescription(player.description ?? player.notes) && (
            <p className="text-sm text-foreground/60 leading-relaxed">
              {getSafeDescription(player.description ?? player.notes)}
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-foreground/20 py-3">No player selected</p>
      )}
    </div>
  );

  return (
    <div className="-m-6 h-[calc(100vh-4rem)] overflow-y-auto relative">
      {/* Background player images */}
      {canCompare && (leftPlayer?.avatar_url || rightPlayer?.avatar_url) && (
        <div className="fixed inset-0 pointer-events-none">
          <div className="absolute inset-y-0 left-0 w-1/2">
            {leftPlayer?.avatar_url && (
              <img src={leftPlayer.avatar_url} alt="" className="w-full h-full object-cover object-center opacity-[0.07]" />
            )}
          </div>
          <div className="absolute inset-y-0 right-0 w-1/2">
            {rightPlayer?.avatar_url && (
              <img src={rightPlayer.avatar_url} alt="" className="w-full h-full object-cover object-center opacity-[0.07]" />
            )}
          </div>
          <div className="absolute inset-y-0 left-1/2 w-32 -translate-x-1/2 bg-gradient-to-r from-transparent via-background to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-b from-background/60 via-transparent to-background" />
        </div>
      )}

      <div className="relative px-8 py-6 max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-medium text-foreground">Compare</h1>
          {canCompare && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setAnalysisData(null);
                  setAnalysisError(null);
                  analyzeMatchupMutation.mutate();
                }}
                disabled={analyzeMatchupMutation.isPending}
                className="text-xs text-foreground/40 hover:text-foreground/70 transition-colors disabled:opacity-30 flex items-center gap-1"
              >
                <RotateCw className={`w-3 h-3 ${analyzeMatchupMutation.isPending ? "animate-spin" : ""}`} />
                Refresh
              </button>
              <span className="text-foreground/10">|</span>
              <button
                onClick={() => {
                  setLeftId("");
                  setRightId("");
                  setAnalysisOpen(false);
                  setAnalysisData(null);
                  lastAnalysisKey.current = null;
                }}
                className="text-xs text-foreground/40 hover:text-foreground/70 transition-colors"
              >
                Clear
              </button>
            </div>
          )}
        </div>

        {/* Player Selection */}
        <div className="grid grid-cols-2 gap-8">
          {renderPlayerSlot("Player A", leftPlayer, leftId, setLeftId)}
          {renderPlayerSlot("Player B", rightPlayer, rightId, setRightId)}
        </div>

        {/* Roster Grid (only when not both selected) */}
        {!canCompare && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search roster..."
                className="flex-1 px-4 py-2 bg-foreground/5 rounded-lg text-sm text-foreground placeholder:text-foreground/20 focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
              <p className="text-xs text-foreground/30 shrink-0">
                Next: {!leftId ? "Player A" : "Player B"}
              </p>
            </div>
            <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
              {(filteredPlayers ?? []).map((player) => {
                const isLeft = player.id === leftId;
                const isRight = player.id === rightId;
                return (
                  <button
                    key={player.id}
                    onClick={() => handleRosterPick(player.id)}
                    className={`group relative overflow-hidden rounded-xl transition-all ${
                      isLeft || isRight
                        ? "ring-2 ring-primary/50"
                        : "hover:ring-1 hover:ring-foreground/20"
                    }`}
                  >
                    <div className="relative aspect-[3/4]">
                      {player.avatar_url ? (
                        <img
                          src={player.avatar_url}
                          alt={player.name}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        />
                      ) : (
                        <div className="w-full h-full bg-foreground/5 flex items-center justify-center">
                          <span className="text-xl font-light text-foreground/15 select-none">
                            {player.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                          </span>
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-transparent to-transparent" />
                    </div>
                    <div className="absolute bottom-2 left-2 right-2">
                      {(isLeft || isRight) && (
                        <p className="text-[10px] uppercase tracking-wider text-primary font-medium">
                          {isLeft ? "Player A" : "Player B"}
                        </p>
                      )}
                      <p className="text-xs text-foreground font-medium truncate">{player.name}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {!playersLoading && leftId === rightId && leftId && (
          <p className="text-sm text-red-400">Select two different players to compare.</p>
        )}

        {/* Matchup Analysis */}
        {canCompare && analysisOpen && (
          <div className="space-y-5">
            {/* Loading / Error */}
            {analyzeMatchupMutation.isPending && (
              <p className="text-sm text-foreground/40">Generating matchup analysis...</p>
            )}
            {analysisError && (
              <p className="text-sm text-red-400">{analysisError}</p>
            )}

            {normalizedAnalysis && (
              <>
                {/* Headline */}
                {normalizedAnalysis.headline && (
                  <p className="text-base text-foreground/70 leading-relaxed">
                    {normalizedAnalysis.headline}
                  </p>
                )}

                {/* Radar + Analysis sections */}
                <div className="grid grid-cols-5 gap-6 items-start">
                  {/* Combined radar chart */}
                  {normalizedAnalysis.scores?.axes?.length ? (
                    <div className="col-span-2">
                      <p className="text-xs uppercase tracking-widest text-foreground/30 mb-2">Player Profiles</p>
                      <ResponsiveContainer width="100%" height={260}>
                        <RadarChart data={normalizedAnalysis.scores.axes}>
                          <PolarGrid stroke="#363436" />
                          <PolarAngleAxis
                            dataKey="axis"
                            tick={{ fill: "#8A8885", fontSize: 11 }}
                          />
                          <PolarRadiusAxis
                            angle={90}
                            domain={[0, 100]}
                            tick={{ fill: "#6A6865", fontSize: 9 }}
                          />
                          <Radar
                            name={leftPlayer?.name ?? "Player A"}
                            dataKey="left"
                            stroke="#9B7B5B"
                            fill="#9B7B5B"
                            fillOpacity={0.2}
                            strokeWidth={2}
                          />
                          <Radar
                            name={rightPlayer?.name ?? "Player B"}
                            dataKey="right"
                            stroke="#6B8E6B"
                            fill="#6B8E6B"
                            fillOpacity={0.15}
                            strokeWidth={2}
                            strokeDasharray="4 4"
                          />
                          <Legend wrapperStyle={{ fontSize: "12px" }} iconSize={10} />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: "#1E1D1F",
                              border: "1px solid #363436",
                              borderRadius: "8px",
                              fontSize: "12px",
                              color: "#E8E6E3",
                            }}
                          />
                        </RadarChart>
                      </ResponsiveContainer>
                    </div>
                  ) : null}

                  {/* Analysis sections */}
                  <div className={normalizedAnalysis.scores?.axes?.length ? "col-span-3 space-y-5" : "col-span-5 grid grid-cols-2 gap-5"}>
                    {analysisSections.map((section) => (
                      <div key={section.title}>
                        <p className="text-xs font-medium uppercase tracking-widest text-foreground/30 mb-2">
                          {section.title}
                        </p>
                        <ul className="space-y-1.5">
                          {section.items.map((item, idx) => (
                            <li key={idx} className="flex gap-2.5 text-sm text-foreground/60 leading-relaxed">
                              <span className="mt-2 h-1 w-1 rounded-full bg-primary/50 shrink-0" />
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Head-to-head insights — only after analysis finishes */}
            {!analyzeMatchupMutation.isPending && matchupInsights.length > 0 && (
              <div className="pt-2">
                <p className="text-xs uppercase tracking-widest text-foreground/30 mb-2">Head-to-Head</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {matchupInsights.map((insight, idx) => (
                    <p key={idx} className="text-sm text-foreground/50">{insight}</p>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
