import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getSession,
  getSessions,
  createSession,
  deleteSession,
  trackBall,
  getTrajectory,
  retryPoseAnalysis,
  segment3D,
  getSAM3DStatus,
  getSAM3DResult,
  listSAM3DJobs,
  cancelSAM3DJob,
  Session,
  TrajectoryData,
  SAM3DJob,
} from "@/lib/api";

// ============================================================================
// Query Key Factory
// Centralized key management for cache invalidation
// ============================================================================

export const sessionKeys = {
  all: ["sessions"] as const,
  lists: () => [...sessionKeys.all, "list"] as const,
  list: (filters?: object) => [...sessionKeys.lists(), filters] as const,
  details: () => [...sessionKeys.all, "detail"] as const,
  detail: (id: string) => [...sessionKeys.details(), id] as const,
  trajectory: (id: string) => [...sessionKeys.detail(id), "trajectory"] as const,
  sam3d: (id: string) => [...sessionKeys.detail(id), "sam3d"] as const,
  sam3dJobs: (id?: string) => [...sessionKeys.all, "sam3d-jobs", id] as const,
  sam3dJob: (jobId: string) => [...sessionKeys.all, "sam3d-job", jobId] as const,
};

// ============================================================================
// Session Queries
// ============================================================================

/**
 * Fetch all sessions for the current user
 */
export function useSessions() {
  return useQuery({
    queryKey: sessionKeys.lists(),
    queryFn: async () => {
      const response = await getSessions();
      return response.data;
    },
    staleTime: 30 * 1000, // 30 seconds
  });
}

/**
 * Fetch a single session by ID
 */
export function useSession(id: string) {
  return useQuery({
    queryKey: sessionKeys.detail(id),
    queryFn: async () => {
      const response = await getSession(id);
      return response.data;
    },
    staleTime: 60 * 1000, // 1 minute
    enabled: !!id,
  });
}

/**
 * Fetch trajectory data for a session
 */
export function useTrajectory(sessionId: string, enabled: boolean = true) {
  return useQuery({
    queryKey: sessionKeys.trajectory(sessionId),
    queryFn: async () => {
      const response = await getTrajectory(sessionId);
      return response.data as TrajectoryData;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes (trajectory data doesn't change often)
    enabled: !!sessionId && enabled,
  });
}

// ============================================================================
// Session Mutations
// ============================================================================

/**
 * Create a new session with video upload
 */
export function useCreateSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (formData: FormData) => {
      const response = await createSession(formData);
      return response.data;
    },
    onSuccess: () => {
      // Invalidate session list to refetch
      queryClient.invalidateQueries({ queryKey: sessionKeys.lists() });
    },
  });
}

/**
 * Delete a session
 */
export function useDeleteSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteSession,
    onSuccess: (_, sessionId) => {
      // Remove from cache
      queryClient.removeQueries({ queryKey: sessionKeys.detail(sessionId) });
      // Invalidate list
      queryClient.invalidateQueries({ queryKey: sessionKeys.lists() });
    },
  });
}

// ============================================================================
// Pose Analysis Mutations
// ============================================================================

/**
 * Retry failed pose analysis for a session
 */
export function useRetryPoseAnalysis(sessionId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const response = await retryPoseAnalysis(sessionId);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sessionKeys.detail(sessionId) });
    },
  });
}

// ============================================================================
// SAM2 Tracking Mutations
// ============================================================================

/**
 * Track an object (ball) in a session
 */
export function useTrackObject(sessionId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ x, y, frame, detection_box }: { x: number; y: number; frame: number; detection_box?: number[] }) => {
      const response = await trackBall(sessionId, x, y, frame, detection_box);
      return response.data;
    },
    onSuccess: () => {
      // Invalidate trajectory data
      queryClient.invalidateQueries({ queryKey: sessionKeys.trajectory(sessionId) });
      // Also invalidate session detail (it may contain trajectory_data)
      queryClient.invalidateQueries({ queryKey: sessionKeys.detail(sessionId) });
    },
  });
}

// ============================================================================
// SAM3D Queries and Mutations
// ============================================================================

/**
 * Start SAM3D 3D segmentation
 */
export function useSegment3D(sessionId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      objectId,
      startFrame,
      endFrame,
    }: {
      objectId: string;
      startFrame?: number;
      endFrame?: number;
    }) => {
      const response = await segment3D(sessionId, objectId, startFrame, endFrame);
      return response.data;
    },
    onSuccess: () => {
      // Invalidate SAM3D jobs list
      queryClient.invalidateQueries({ queryKey: sessionKeys.sam3dJobs(sessionId) });
    },
  });
}

/**
 * Poll SAM3D job status
 */
export function useSAM3DJobStatus(jobId: string, isProcessing: boolean = false) {
  return useQuery({
    queryKey: sessionKeys.sam3dJob(jobId),
    queryFn: async () => {
      const response = await getSAM3DStatus(jobId);
      return response.data;
    },
    enabled: !!jobId,
    // Poll every 2 seconds while processing
    refetchInterval: isProcessing ? 2000 : false,
    staleTime: 0, // Always fetch fresh status
  });
}

/**
 * Get SAM3D result for a session/object
 */
export function useSAM3DResult(sessionId: string, objectId: string, enabled: boolean = true) {
  return useQuery({
    queryKey: [...sessionKeys.sam3d(sessionId), objectId],
    queryFn: async () => {
      const response = await getSAM3DResult(sessionId, objectId);
      return response.data;
    },
    enabled: !!sessionId && !!objectId && enabled,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * List SAM3D jobs, optionally filtered by session
 */
export function useSAM3DJobs(sessionId?: string) {
  return useQuery({
    queryKey: sessionKeys.sam3dJobs(sessionId),
    queryFn: async () => {
      const response = await listSAM3DJobs(sessionId);
      return response.data;
    },
    staleTime: 30 * 1000,
  });
}

/**
 * Cancel a SAM3D job
 */
export function useCancelSAM3DJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: cancelSAM3DJob,
    onSuccess: (_, jobId) => {
      // Invalidate job status
      queryClient.invalidateQueries({ queryKey: sessionKeys.sam3dJob(jobId) });
      // Invalidate jobs list
      queryClient.invalidateQueries({ queryKey: sessionKeys.sam3dJobs() });
    },
  });
}
