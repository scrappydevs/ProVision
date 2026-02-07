import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getKeyMoments, recomputeKeyMoments, KeyMoment } from "@/lib/api";

// Query key factory for key moments
export const keyMomentsKeys = {
  all: ["key-moments"] as const,
  session: (sessionId: string) => [...keyMomentsKeys.all, sessionId] as const,
};

/**
 * Hook to fetch key moments for a session.
 * The backend computes on-demand if no moments exist yet (lazy with caching).
 */
export function useKeyMoments(sessionId: string) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: keyMomentsKeys.session(sessionId),
    queryFn: async () => {
      const response = await getKeyMoments(sessionId);
      return response.data;
    },
    enabled: !!sessionId,
    retry: false,
    staleTime: 5 * 60 * 1000, // 5 minutes — moments don't change unless recomputed
  });

  const recomputeMutation = useMutation({
    mutationFn: async () => {
      const response = await recomputeKeyMoments(sessionId);
      return response.data;
    },
    onSuccess: (data) => {
      // Update cache directly with the fresh data
      queryClient.setQueryData(keyMomentsKeys.session(sessionId), data);
    },
  });

  return {
    moments: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    recompute: recomputeMutation.mutateAsync,
    isRecomputing: recomputeMutation.isPending,
  };
}
