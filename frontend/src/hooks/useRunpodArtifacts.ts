"use client";

import { useQuery } from "@tanstack/react-query";
import { getRunpodArtifacts, type RunpodDashboardData } from "@/lib/api";

/**
 * Poll RunPod dashboard artifacts for a session.
 *
 * - Polls every 30 seconds while no artifacts have arrived yet.
 * - Once artifacts are present, switches to a 5-minute stale time
 *   (effectively stops polling).
 */
export function useRunpodArtifacts(sessionId: string | undefined) {
  return useQuery<RunpodDashboardData>({
    queryKey: ["runpod-artifacts", sessionId],
    queryFn: async () => {
      if (!sessionId) throw new Error("Session ID required");
      const response = await getRunpodArtifacts(sessionId);
      return response.data;
    },
    enabled: !!sessionId,
    // Poll every 30s while empty; once filled, cache for 5 min
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data || data.artifacts.length === 0) return 30_000;
      return false; // stop polling
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}
