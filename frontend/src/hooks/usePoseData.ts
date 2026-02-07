import { useQuery } from "@tanstack/react-query";
import { getPoseAnalysis, getPoseSummary } from "@/lib/api";

export interface PoseKeypoint {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

export interface PoseFrame {
  frame_number: number;
  timestamp: number;
  person_id?: number;
  keypoints: Record<string, PoseKeypoint>;
  joint_angles: Record<string, number>;
  body_metrics: Record<string, number>;
}

export interface PoseAnalysisData {
  session_id: string;
  frame_count: number;
  frames: PoseFrame[];
}

export interface PoseSummaryData {
  session_id: string;
  frame_count: number;
  duration: number;
  average_joint_angles: Record<string, { mean: number; min: number; max: number }>;
  average_body_metrics: Record<string, { mean: number; min: number; max: number }>;
  status: string;
}

export const poseKeys = {
  all: ["pose"] as const,
  analysis: (sessionId: string) => [...poseKeys.all, "analysis", sessionId] as const,
  summary: (sessionId: string) => [...poseKeys.all, "summary", sessionId] as const,
};

export function usePoseAnalysis(sessionId: string, limit = 1000, offset = 0) {
  return useQuery({
    queryKey: [...poseKeys.analysis(sessionId), limit, offset],
    queryFn: async () => {
      const response = await getPoseAnalysis(sessionId, limit, offset);
      return response.data as PoseAnalysisData;
    },
    enabled: !!sessionId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function usePoseSummary(sessionId: string) {
  return useQuery({
    queryKey: poseKeys.summary(sessionId),
    queryFn: async () => {
      const response = await getPoseSummary(sessionId);
      return response.data as PoseSummaryData;
    },
    enabled: !!sessionId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}
