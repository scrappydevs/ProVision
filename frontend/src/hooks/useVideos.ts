import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getVideos,
  getVideo,
  createVideo,
  updateVideo,
  deleteVideo,
  analyzeVideo,
  Video,
  VideoCreate,
  VideoUpdate,
} from "@/lib/api";

export const videoKeys = {
  all: ["videos"] as const,
  lists: () => [...videoKeys.all, "list"] as const,
  listByFilter: (filters?: {
    matchup_id?: string;
    tournament_id?: string;
    player_id?: string;
  }) => [...videoKeys.lists(), filters ?? "all"] as const,
  details: () => [...videoKeys.all, "detail"] as const,
  detail: (id: string) => [...videoKeys.details(), id] as const,
};

export function useVideos(filters?: {
  matchup_id?: string;
  tournament_id?: string;
  player_id?: string;
}) {
  return useQuery({
    queryKey: videoKeys.listByFilter(filters),
    queryFn: async () => {
      const response = await getVideos(filters);
      return response.data;
    },
    staleTime: 30 * 1000,
  });
}

export function useVideo(id: string) {
  return useQuery({
    queryKey: videoKeys.detail(id),
    queryFn: async () => {
      const response = await getVideo(id);
      return response.data;
    },
    staleTime: 60 * 1000,
    enabled: !!id,
  });
}

export function useCreateVideo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: VideoCreate) => {
      const response = await createVideo(data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: videoKeys.lists() });
    },
  });
}

export function useUpdateVideo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: VideoUpdate }) => {
      const response = await updateVideo(id, data);
      return response.data;
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: videoKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: videoKeys.lists() });
    },
  });
}

export function useDeleteVideo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await deleteVideo(id);
      return id;
    },
    onSuccess: (id) => {
      queryClient.removeQueries({ queryKey: videoKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: videoKeys.lists() });
    },
  });
}

export function useAnalyzeVideo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (videoId: string) => {
      const response = await analyzeVideo(videoId);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: videoKeys.lists() });
    },
  });
}
