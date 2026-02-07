import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getPlayers,
  getPlayer,
  createPlayer,
  updatePlayer,
  deletePlayer,
  uploadPlayerAvatar,
  getPlayerGames,
  syncPlayerITTF,
  getPlayerRecordings,
  createRecording,
  deleteRecording,
  createClip,
  analyzeRecording,
  searchITTFPlayers,
  Player,
  PlayerCreate,
  PlayerUpdate,
  GamePlayerInfo,
  Recording,
  RecordingType,
} from "@/lib/api";

export const playerKeys = {
  all: ["players"] as const,
  lists: () => [...playerKeys.all, "list"] as const,
  details: () => [...playerKeys.all, "detail"] as const,
  detail: (id: string) => [...playerKeys.details(), id] as const,
  games: (id: string) => [...playerKeys.detail(id), "games"] as const,
  recordings: (id: string, type?: string) =>
    [...playerKeys.detail(id), "recordings", type ?? "all"] as const,
};

export function usePlayers() {
  return useQuery({
    queryKey: playerKeys.lists(),
    queryFn: async () => {
      const response = await getPlayers();
      return response.data;
    },
    staleTime: 30 * 1000,
  });
}

export function usePlayer(id: string) {
  return useQuery({
    queryKey: playerKeys.detail(id),
    queryFn: async () => {
      const response = await getPlayer(id);
      return response.data;
    },
    staleTime: 60 * 1000,
    enabled: !!id,
  });
}

export function usePlayerGames(
  playerId: string,
  params?: { search?: string; status?: string }
) {
  return useQuery({
    queryKey: [...playerKeys.games(playerId), params],
    queryFn: async () => {
      const response = await getPlayerGames(playerId, params);
      return response.data;
    },
    staleTime: 30 * 1000,
    enabled: !!playerId,
  });
}

export function useCreatePlayer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: PlayerCreate) => {
      const response = await createPlayer(data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: playerKeys.lists() });
    },
  });
}

export function useUpdatePlayer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: PlayerUpdate }) => {
      const response = await updatePlayer(id, data);
      return response.data;
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: playerKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: playerKeys.lists() });
    },
  });
}

export function useDeletePlayer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deletePlayer,
    onSuccess: (_, id) => {
      queryClient.removeQueries({ queryKey: playerKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: playerKeys.lists() });
    },
  });
}

export function useUploadAvatar() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ playerId, file }: { playerId: string; file: File }) => {
      const response = await uploadPlayerAvatar(playerId, file);
      return response.data;
    },
    onSuccess: (_, { playerId }) => {
      queryClient.invalidateQueries({ queryKey: playerKeys.detail(playerId) });
      queryClient.invalidateQueries({ queryKey: playerKeys.lists() });
    },
  });
}

export function useSyncITTF() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (playerId: string) => {
      const response = await syncPlayerITTF(playerId);
      return response.data;
    },
    onSuccess: (_, playerId) => {
      queryClient.invalidateQueries({ queryKey: playerKeys.detail(playerId) });
      queryClient.invalidateQueries({ queryKey: playerKeys.lists() });
    },
  });
}

export function usePlayerRecordings(
  playerId: string,
  type?: RecordingType
) {
  return useQuery({
    queryKey: playerKeys.recordings(playerId, type),
    queryFn: async () => {
      const response = await getPlayerRecordings(playerId, type);
      return response.data;
    },
    staleTime: 30 * 1000,
    enabled: !!playerId,
  });
}

export function useCreateRecording() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: FormData) => {
      const response = await createRecording(data);
      return response.data;
    },
    onSuccess: (recording) => {
      queryClient.invalidateQueries({
        queryKey: playerKeys.recordings(recording.player_id),
      });
    },
  });
}

export function useDeleteRecording() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, playerId }: { id: string; playerId: string }) => {
      await deleteRecording(id);
      return playerId;
    },
    onSuccess: (playerId) => {
      queryClient.invalidateQueries({
        queryKey: playerKeys.recordings(playerId),
      });
    },
  });
}

export function useCreateClip() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      recordingId,
      data,
    }: {
      recordingId: string;
      data: FormData;
    }) => {
      const response = await createClip(recordingId, data);
      return response.data;
    },
    onSuccess: (recording) => {
      queryClient.invalidateQueries({
        queryKey: playerKeys.recordings(recording.player_id),
      });
    },
  });
}

export function useAnalyzeRecording() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      recordingId,
      data,
    }: {
      recordingId: string;
      data: FormData;
    }) => {
      const response = await analyzeRecording(recordingId, data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: playerKeys.all });
    },
  });
}

export function useSearchITTF(query: string) {
  return useQuery({
    queryKey: [...playerKeys.all, "ittf-search", query] as const,
    queryFn: async () => {
      const response = await searchITTFPlayers(query);
      return response.data;
    },
    enabled: query.length >= 2,
    staleTime: 60 * 1000,
  });
}

export function usePlayerInsights(playerId: string) {
  return useQuery({
    queryKey: [...playerKeys.detail(playerId), "insights"],
    queryFn: async () => {
      const response = await getPlayerInsights(playerId);
      return response.data;
    },
    enabled: !!playerId,
    staleTime: 10 * 60 * 1000, // 10 minutes
  });
}
