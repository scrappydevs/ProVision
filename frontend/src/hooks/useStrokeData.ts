import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { analyzeStrokes, getStrokeDebugRuns, getStrokeProgress, getStrokeSummary } from "@/lib/api";
import { sessionKeys } from "@/hooks/useSessions";
import { readStrokeClaudeClassifierEnabledSetting } from "@/lib/appSettings";

// Query key factory for stroke data
export const strokeKeys = {
  all: ["strokes"] as const,
  summaries: () => [...strokeKeys.all, "summaries"] as const,
  summary: (sessionId: string) => [...strokeKeys.summaries(), sessionId] as const,
  debugRuns: (sessionId: string) => [...strokeKeys.all, "debug-runs", sessionId] as const,
  progress: (sessionId: string) => [...strokeKeys.all, "progress", sessionId] as const,
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
      const useClaude = readStrokeClaudeClassifierEnabledSetting();
      const response = await analyzeStrokes(sessionId, { use_claude_classifier: useClaude });
      return response.data;
    },
    onSuccess: () => {
      // Re-sync session state so UI can immediately reflect processing status.
      queryClient.invalidateQueries({ queryKey: sessionKeys.detail(sessionId) });
      // Drop stale progress/summary while fresh recompute starts.
      queryClient.invalidateQueries({ queryKey: strokeKeys.progress(sessionId) });
      queryClient.invalidateQueries({ queryKey: strokeKeys.summary(sessionId) });
    },
  });
}

/**
 * Hook to fetch latest stroke debug run (used for live pipeline stage status)
 */
export function useLatestStrokeDebugRun(sessionId: string, enabled: boolean = true) {
  return useQuery({
    queryKey: strokeKeys.debugRuns(sessionId),
    queryFn: async () => {
      const response = await getStrokeDebugRuns(sessionId, 1);
      return (response.data?.runs && response.data.runs.length > 0) ? response.data.runs[0] : null;
    },
    enabled: !!sessionId && enabled,
    staleTime: 0,
    retry: false,
    refetchInterval: enabled ? 1500 : false,
  });
}

/**
 * Hook to fetch live in-memory stroke pipeline progress.
 */
export function useStrokeProgress(sessionId: string, enabled: boolean = true) {
  return useQuery({
    queryKey: strokeKeys.progress(sessionId),
    queryFn: async () => {
      const response = await getStrokeProgress(sessionId);
      return response.data?.progress ?? null;
    },
    enabled: !!sessionId && enabled,
    staleTime: 0,
    retry: false,
    refetchInterval: enabled ? 1000 : false,
  });
}
