import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { analyzeStrokes, getStrokeSummary, StrokeSummary } from "@/lib/api";

// Query key factory for stroke data
export const strokeKeys = {
  all: ["strokes"] as const,
  summaries: () => [...strokeKeys.all, "summaries"] as const,
  summary: (sessionId: string) => [...strokeKeys.summaries(), sessionId] as const,
};

/**
 * Hook to fetch stroke summary for a session
 */
export function useStrokeSummary(sessionId: string) {
  return useQuery({
    queryKey: strokeKeys.summary(sessionId),
    queryFn: async () => {
      const response = await getStrokeSummary(sessionId);
      return response.data;
    },
    enabled: !!sessionId,
    retry: false, // Don't retry if stroke analysis hasn't been run yet
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook to trigger stroke analysis for a session
 */
export function useAnalyzeStrokes(sessionId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const response = await analyzeStrokes(sessionId);
      return response.data;
    },
    onSuccess: () => {
      // Start polling for stroke data
      const pollInterval = setInterval(async () => {
        try {
          const response = await getStrokeSummary(sessionId);
          if (response.data) {
            // Successfully got stroke data, stop polling
            clearInterval(pollInterval);
            queryClient.invalidateQueries({ queryKey: strokeKeys.summary(sessionId) });
          }
        } catch (error) {
          // Still processing, continue polling
        }
      }, 2000);

      // Stop polling after 30 seconds
      setTimeout(() => clearInterval(pollInterval), 30000);
    },
  });
}
