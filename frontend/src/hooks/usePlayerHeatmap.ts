import { useQuery } from "@tanstack/react-query";
import { api, TrajectoryPoint } from "@/lib/api";

export interface PlayerHeatmapGame {
  session_id: string;
  session_name: string;
  created_at: string;
  trajectory_frames: TrajectoryPoint[];
  frame_count: number;
  video_info?: {
    width: number;
    height: number;
    fps: number;
  };
}

export interface PlayerHeatmapData {
  player_id: string;
  player_name: string;
  games: PlayerHeatmapGame[];
  games_count: number;
  total_frames: number;
}

export function usePlayerHeatmap(playerId: string, limit: number = 10) {
  return useQuery<PlayerHeatmapData>({
    queryKey: ["player-heatmap", playerId, limit],
    queryFn: async () => {
      const response = await api.get(`/api/players/${playerId}/heatmap-data`, {
        params: { limit },
      });
      return response.data;
    },
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    enabled: !!playerId,
  });
}
