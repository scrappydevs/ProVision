import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getTournaments,
  getUpcomingTournaments,
  getPastTournaments,
  getTournament,
  createTournament,
  updateTournament,
  deleteTournament,
  getTournamentMatchups,
  createMatchup,
  updateMatchup,
  deleteMatchup,
  getTournamentStats,
  Tournament,
  TournamentCreate,
  TournamentUpdate,
  TournamentStatus,
  Matchup,
  MatchupCreate,
  MatchupUpdate,
} from "@/lib/api";

export const tournamentKeys = {
  all: ["tournaments"] as const,
  lists: () => [...tournamentKeys.all, "list"] as const,
  listByStatus: (status?: TournamentStatus) =>
    [...tournamentKeys.lists(), status ?? "all"] as const,
  upcoming: () => [...tournamentKeys.all, "upcoming"] as const,
  past: () => [...tournamentKeys.all, "past"] as const,
  details: () => [...tournamentKeys.all, "detail"] as const,
  detail: (id: string) => [...tournamentKeys.details(), id] as const,
  matchups: (id: string) => [...tournamentKeys.detail(id), "matchups"] as const,
  stats: () => [...tournamentKeys.all, "stats"] as const,
};

export function useTournaments(status?: TournamentStatus) {
  return useQuery({
    queryKey: tournamentKeys.listByStatus(status),
    queryFn: async () => {
      const response = await getTournaments(status);
      return response.data;
    },
    staleTime: 30 * 1000,
  });
}

export function useUpcomingTournaments() {
  return useQuery({
    queryKey: tournamentKeys.upcoming(),
    queryFn: async () => {
      const response = await getUpcomingTournaments();
      return response.data;
    },
    staleTime: 30 * 1000,
  });
}

export function usePastTournaments() {
  return useQuery({
    queryKey: tournamentKeys.past(),
    queryFn: async () => {
      const response = await getPastTournaments();
      return response.data;
    },
    staleTime: 30 * 1000,
  });
}

export function useTournament(id: string) {
  return useQuery({
    queryKey: tournamentKeys.detail(id),
    queryFn: async () => {
      const response = await getTournament(id);
      return response.data;
    },
    staleTime: 60 * 1000,
    enabled: !!id,
  });
}

export function useTournamentMatchups(tournamentId: string) {
  return useQuery({
    queryKey: tournamentKeys.matchups(tournamentId),
    queryFn: async () => {
      const response = await getTournamentMatchups(tournamentId);
      return response.data;
    },
    staleTime: 30 * 1000,
    enabled: !!tournamentId,
  });
}

export function useTournamentStats() {
  return useQuery({
    queryKey: tournamentKeys.stats(),
    queryFn: async () => {
      const response = await getTournamentStats();
      return response.data;
    },
    staleTime: 30 * 1000,
  });
}

export function useCreateTournament() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: TournamentCreate) => {
      const response = await createTournament(data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tournamentKeys.lists() });
      queryClient.invalidateQueries({ queryKey: tournamentKeys.upcoming() });
      queryClient.invalidateQueries({ queryKey: tournamentKeys.past() });
      queryClient.invalidateQueries({ queryKey: tournamentKeys.stats() });
    },
  });
}

export function useUpdateTournament() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: TournamentUpdate }) => {
      const response = await updateTournament(id, data);
      return response.data;
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: tournamentKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: tournamentKeys.lists() });
      queryClient.invalidateQueries({ queryKey: tournamentKeys.upcoming() });
      queryClient.invalidateQueries({ queryKey: tournamentKeys.past() });
      queryClient.invalidateQueries({ queryKey: tournamentKeys.stats() });
    },
  });
}

export function useDeleteTournament() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteTournament,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tournamentKeys.lists() });
      queryClient.invalidateQueries({ queryKey: tournamentKeys.upcoming() });
      queryClient.invalidateQueries({ queryKey: tournamentKeys.past() });
      queryClient.invalidateQueries({ queryKey: tournamentKeys.stats() });
    },
  });
}

export function useCreateMatchup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      tournamentId,
      data,
    }: {
      tournamentId: string;
      data: MatchupCreate;
    }) => {
      const response = await createMatchup(tournamentId, data);
      return response.data;
    },
    onSuccess: (matchup) => {
      queryClient.invalidateQueries({
        queryKey: tournamentKeys.matchups(matchup.tournament_id),
      });
      queryClient.invalidateQueries({ queryKey: tournamentKeys.lists() });
      queryClient.invalidateQueries({ queryKey: tournamentKeys.stats() });
    },
  });
}

export function useUpdateMatchup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      tournamentId,
      data,
    }: {
      id: string;
      tournamentId: string;
      data: MatchupUpdate;
    }) => {
      const response = await updateMatchup(id, data);
      return { ...response.data, tournamentId };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({
        queryKey: tournamentKeys.matchups(result.tournamentId),
      });
      queryClient.invalidateQueries({ queryKey: tournamentKeys.lists() });
      queryClient.invalidateQueries({ queryKey: tournamentKeys.stats() });
    },
  });
}

export function useDeleteMatchup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      tournamentId,
    }: {
      id: string;
      tournamentId: string;
    }) => {
      await deleteMatchup(id);
      return tournamentId;
    },
    onSuccess: (tournamentId) => {
      queryClient.invalidateQueries({
        queryKey: tournamentKeys.matchups(tournamentId),
      });
      queryClient.invalidateQueries({ queryKey: tournamentKeys.lists() });
      queryClient.invalidateQueries({ queryKey: tournamentKeys.stats() });
    },
  });
}
