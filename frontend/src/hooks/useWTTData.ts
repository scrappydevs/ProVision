import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getWTTTournaments,
  getWTTTournament,
  getWTTTournamentMatches,
  getWTTMatch,
  getWTTPlayers,
  getWTTPlayer,
  getWTTPlayerMatches,
  syncWTTTournament,
  syncWTTRecent,
  syncWTTVideos,
  enrichWTTPlayer,
} from "@/lib/api";

export const wttKeys = {
  all: ["wtt"] as const,
  tournaments: () => [...wttKeys.all, "tournaments"] as const,
  tournamentList: (params?: Record<string, unknown>) =>
    [...wttKeys.tournaments(), params ?? {}] as const,
  tournamentDetail: (id: string) =>
    [...wttKeys.tournaments(), "detail", id] as const,
  tournamentMatches: (id: string, round?: string) =>
    [...wttKeys.tournaments(), id, "matches", round ?? "all"] as const,
  matches: () => [...wttKeys.all, "matches"] as const,
  matchDetail: (id: string) => [...wttKeys.matches(), id] as const,
  players: () => [...wttKeys.all, "players"] as const,
  playerList: (params?: Record<string, unknown>) =>
    [...wttKeys.players(), params ?? {}] as const,
  playerDetail: (id: string) => [...wttKeys.players(), "detail", id] as const,
  playerMatches: (id: string) =>
    [...wttKeys.players(), id, "matches"] as const,
};

// ── Tournament Hooks ────────────────────────────────────────────────

export function useWTTTournaments(params?: {
  tier?: string;
  year?: number;
  search?: string;
  limit?: number;
  offset?: number;
}) {
  return useQuery({
    queryKey: wttKeys.tournamentList(params as Record<string, unknown>),
    queryFn: async () => {
      const response = await getWTTTournaments(params);
      return response.data;
    },
    staleTime: 60 * 1000,
  });
}

export function useWTTTournament(id: string) {
  return useQuery({
    queryKey: wttKeys.tournamentDetail(id),
    queryFn: async () => {
      const response = await getWTTTournament(id);
      return response.data;
    },
    enabled: !!id,
    staleTime: 60 * 1000,
  });
}

export function useWTTTournamentMatches(tournamentId: string, round?: string) {
  return useQuery({
    queryKey: wttKeys.tournamentMatches(tournamentId, round),
    queryFn: async () => {
      const response = await getWTTTournamentMatches(tournamentId, round);
      return response.data;
    },
    enabled: !!tournamentId,
    staleTime: 60 * 1000,
  });
}

// ── Match Hooks ─────────────────────────────────────────────────────

export function useWTTMatch(id: string) {
  return useQuery({
    queryKey: wttKeys.matchDetail(id),
    queryFn: async () => {
      const response = await getWTTMatch(id);
      return response.data;
    },
    enabled: !!id,
    staleTime: 60 * 1000,
  });
}

// ── Player Hooks ────────────────────────────────────────────────────

export function useWTTPlayers(params?: {
  search?: string;
  country?: string;
  limit?: number;
  offset?: number;
}) {
  return useQuery({
    queryKey: wttKeys.playerList(params as Record<string, unknown>),
    queryFn: async () => {
      const response = await getWTTPlayers(params);
      return response.data;
    },
    staleTime: 60 * 1000,
  });
}

export function useWTTPlayer(id: string) {
  return useQuery({
    queryKey: wttKeys.playerDetail(id),
    queryFn: async () => {
      const response = await getWTTPlayer(id);
      return response.data;
    },
    enabled: !!id,
    staleTime: 60 * 1000,
  });
}

export function useWTTPlayerMatches(playerId: string) {
  return useQuery({
    queryKey: wttKeys.playerMatches(playerId),
    queryFn: async () => {
      const response = await getWTTPlayerMatches(playerId);
      return response.data;
    },
    enabled: !!playerId,
    staleTime: 60 * 1000,
  });
}

// ── Sync Mutations ──────────────────────────────────────────────────

export function useSyncWTTTournament() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (externalId: number) => syncWTTTournament(externalId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: wttKeys.tournaments() });
    },
  });
}

export function useSyncWTTRecent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (days?: number) => syncWTTRecent(days),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: wttKeys.tournaments() });
    },
  });
}

export function useSyncWTTVideos() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tournamentId: string) => syncWTTVideos(tournamentId),
    onSuccess: (_data, tournamentId) => {
      queryClient.invalidateQueries({
        queryKey: wttKeys.tournamentMatches(tournamentId),
      });
    },
  });
}

export function useEnrichWTTPlayer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (playerId: string) => enrichWTTPlayer(playerId),
    onSuccess: (_data, playerId) => {
      queryClient.invalidateQueries({
        queryKey: wttKeys.playerDetail(playerId),
      });
    },
  });
}
