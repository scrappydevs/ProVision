"use client";

import { useQuery } from "@tanstack/react-query";
import { getSessionAnalytics, type AnalyticsData } from "@/lib/api";

/**
 * Hook to fetch comprehensive analytics for a session.
 * 
 * Includes ball performance, pose metrics, and correlations.
 */
export function useAnalytics(sessionId: string | undefined) {
  return useQuery<AnalyticsData>({
    queryKey: ["analytics", sessionId],
    queryFn: async () => {
      if (!sessionId) throw new Error("Session ID required");
      const response = await getSessionAnalytics(sessionId);
      return response.data;
    },
    enabled: !!sessionId,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    refetchOnWindowFocus: false,
  });
}
