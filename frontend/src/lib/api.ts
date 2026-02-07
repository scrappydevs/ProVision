import axios from "axios";
import { getSupabaseClient } from "./supabase/client";

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000",
  headers: {
    "Content-Type": "application/json",
  },
});

api.interceptors.request.use(async (config) => {
  const supabase = await getSupabaseClient();
  if (supabase) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session?.access_token) {
      config.headers.Authorization = `Bearer ${session.access_token}`;
    }
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      console.error("Unauthorized request");
    }
    return Promise.reject(error);
  }
);

export interface TrajectoryPoint {
  frame: number;
  x: number;
  y: number;
  confidence: number;
  bbox?: [number, number, number, number]; // [x1, y1, x2, y2]
}

export interface TrajectoryData {
  frames: TrajectoryPoint[];
  velocity: number[];
  spin_estimate?: string;
  video_info?: { width: number; height: number; fps: number };
}

export interface PoseData {
  frames?: Array<{
    frame: number;
    landmarks: Array<{ x: number; y: number; z: number; visibility: number }>;
  }>;
  joint_angles?: Record<string, number[]>;
}

export interface PlayerBBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlayerCenter {
  x: number;
  y: number;
}

export interface DetectedPlayer {
  player_idx: number;
  bbox: PlayerBBox;
  center: PlayerCenter;
  confidence: number;
  has_keypoints?: boolean;
}

export interface SelectedPlayer {
  player_idx: number;
  bbox: PlayerBBox;
  center: PlayerCenter;
  confidence?: number;
}

export interface PlayerBrief {
  id: string;
  name: string;
  avatar_url?: string;
}

export interface ITTFData {
  ranking?: number;
  career_best_ranking?: number;
  nationality?: string;
  birth_year?: number;
  playing_style?: string;
  career_wins?: number;
  career_losses?: number;
  senior_titles?: number;
  headshot_url?: string;
  recent_matches?: Array<{
    tournament: string;
    opponent: string;
    score: string;
    result: string;
  }>;
}

export interface Player {
  id: string;
  coach_id: string;
  name: string;
  avatar_url?: string;
  position?: string;
  team?: string;
  notes?: string;
  handedness: "left" | "right";
  is_active: boolean;
  ittf_id?: number;
  ittf_data?: ITTFData;
  ittf_last_synced?: string;
  created_at: string;
  updated_at?: string;
  game_count?: number;
}

export interface PlayerCreate {
  name: string;
  position?: string;
  team?: string;
  notes?: string;
  is_active?: boolean;
  ittf_id?: number;
}

export interface PlayerUpdate {
  name?: string;
  position?: string;
  team?: string;
  notes?: string;
  handedness?: "left" | "right";
  is_active?: boolean;
  ittf_id?: number;
}

export interface GamePlayerInfo {
  id: string;
  name: string;
  video_path?: string;
  status: string;
  created_at: string;
  players?: PlayerBrief[];
}

export interface Session {
  id: string;
  user_id: string;
  name: string;
  description?: string;
  video_path?: string;
  ego_video_path?: string;
  pose_video_path?: string;
  preview_frame_url?: string;
  selected_player?: SelectedPlayer;
  trajectory_data?: TrajectoryData;
  pose_data?: PoseData;
  stroke_summary?: {
    average_form_score: number;
    best_form_score: number;
    consistency_score: number;
    total_strokes: number;
    forehand_count: number;
    backhand_count: number;
    serve_count: number;
  };
  status: "pending" | "processing" | "completed" | "failed";
  created_at: string;
  players?: PlayerBrief[];
}

export const createSession = (data: FormData) =>
  api.post<Session>("/api/sessions", data, {
    headers: { "Content-Type": "multipart/form-data" },
  });

export const getSessions = () => api.get<Session[]>("/api/sessions");

export const getSession = (id: string) => api.get<Session>(`/api/sessions/${id}`);

export const deleteSession = (id: string) => api.delete(`/api/sessions/${id}`);

export const initSAM2 = (sessionId: string) =>
  api.post(`/api/sam2/init`, { session_id: sessionId });

export interface BallDetection {
  bbox: [number, number, number, number];
  confidence: number;
  class_name: string;
  center: [number, number];
  size: [number, number];
}

export const detectBalls = (sessionId: string, frame: number) =>
  api.post<{ detections: BallDetection[]; frame: number; width: number; height: number; preview_image: string }>(`/api/sam2/detect`, { session_id: sessionId, frame });

export const previewSegmentation = (sessionId: string, x: number, y: number, frame: number) =>
  api.post<{ success: boolean; bbox?: number[]; center?: number[]; area_pixels?: number; preview_image?: string; width?: number; height?: number }>(`/api/sam2/preview`, { session_id: sessionId, x, y, frame });

export const trackBall = (sessionId: string, x: number, y: number, frame: number, detectionBox?: number[]) =>
  api.post(`/api/sam2/track-ball`, { session_id: sessionId, x, y, frame, detection_box: detectionBox });

export const trackWithTrackNet = (sessionId: string, frame: number = 0) =>
  api.post(`/api/sam2/tracknet`, { session_id: sessionId, frame });

export interface PoseKeypoint {
  name: string;
  x: number;
  y: number;
  conf: number;
}

export interface PersonPose {
  id: number;
  bbox: [number, number, number, number];
  confidence: number;
  keypoints: PoseKeypoint[];
}

export const detectPoses = (sessionId: string, frame: number) =>
  api.post<{ persons: PersonPose[]; frame: number; width: number; height: number; preview_image: string }>(
    `/api/sam2/pose-detect`, { session_id: sessionId, frame }
  );

export const getTrajectory = (sessionId: string) =>
  api.get(`/api/sam2/trajectory/${sessionId}`);

export const generateEgo = (sessionId: string) =>
  api.post(`/api/egox/generate`, { session_id: sessionId });

export const getEgoStatus = (id: string) => api.get(`/api/egox/status/${id}`);

export const getEgoResult = (id: string) => api.get(`/api/egox/result/${id}`);

// Pose analysis is now auto-triggered on video upload
// Player selection for pose analysis
export interface PlayerPreviewResponse {
  session_id: string;
  preview_url: string;
  video_info: {
    fps: number;
    frame_count: number;
    width: number;
    height: number;
    duration: number;
  };
  players: DetectedPlayer[];
  player_count: number;
}

export const getPlayerPreview = (sessionId: string) =>
  api.post<PlayerPreviewResponse>(`/api/pose/preview/${sessionId}`);

export const selectPlayer = (sessionId: string, player: DetectedPlayer) =>
  api.post(`/api/pose/select-player/${sessionId}`, {
    player_idx: player.player_idx,
    bbox: player.bbox,
    center: player.center,
    confidence: player.confidence,
  });

export const clearPlayerSelection = (sessionId: string) =>
  api.delete(`/api/pose/select-player/${sessionId}`);

export const analyzePose = (sessionId: string) => api.post(`/api/pose/analyze/${sessionId}`);

// Get pose analysis results
export const getPoseAnalysis = (sessionId: string, limit = 100, offset = 0) =>
  api.get(`/api/pose/analysis/${sessionId}`, { params: { limit, offset } });

export const getPoseSummary = (sessionId: string) =>
  api.get(`/api/pose/summary/${sessionId}`);

export const retryPoseAnalysis = (sessionId: string) =>
  api.post(`/api/pose/retry/${sessionId}`);

// Legacy endpoint (kept for backward compatibility)
export const getPoseData = (sessionId: string) =>
  api.get(`/api/pose/data/${sessionId}`);

// Stroke analytics API functions
export interface StrokeMetrics {
  elbow_angle: number;
  shoulder_angle: number;
  knee_angle: number;
  hip_angle: number;
  hip_rotation: number;
  shoulder_rotation: number;
  spine_lean: number;
  elbow_range: number;
  hip_rotation_range: number;
  shoulder_rotation_range: number;
}

export interface Stroke {
  id: string;
  session_id: string;
  start_frame: number;
  end_frame: number;
  peak_frame: number;
  stroke_type: "forehand" | "backhand" | "serve" | "unknown";
  duration: number;
  max_velocity: number;
  form_score: number;
  metrics: StrokeMetrics;
}

export interface StrokeSummary {
  session_id: string;
  average_form_score: number;
  best_form_score: number;
  consistency_score: number;
  total_strokes: number;
  forehand_count: number;
  backhand_count: number;
  serve_count: number;
  strokes: Stroke[];
}

export const analyzeStrokes = (sessionId: string) =>
  api.post(`/api/stroke/analyze/${sessionId}`);

export const getStrokeSummary = (sessionId: string) =>
  api.get<StrokeSummary>(`/api/stroke/summary/${sessionId}`);

export const getStrokes = (sessionId: string, strokeType?: string) =>
  api.get(`/api/stroke/strokes/${sessionId}`, {
    params: strokeType ? { stroke_type: strokeType } : undefined,
  });

export const getStrokeDetail = (strokeId: string) =>
  api.get(`/api/stroke/stroke/${strokeId}`);

// SAM3D API functions
export interface SAM3DSegmentRequest {
  session_id: string;
  object_id: string;
  video_path?: string;
  masks_dir?: string;
  start_frame?: number;
  end_frame?: number;
}

export interface SAM3DJob {
  job_id: string;
  session_id: string;
  object_id: string;
  status: "pending" | "processing" | "completed" | "failed" | "cancelled";
  created_at: string;
  completed_at?: string;
  result?: {
    point_cloud_path?: string;
    metadata?: {
      total_points: number;
      frames_processed: number;
    };
  };
  error?: string;
}

export const segment3D = (
  sessionId: string,
  objectId: string,
  startFrame?: number,
  endFrame?: number
) =>
  api.post<{ status: string; job_id: string }>(`/api/sam3d/segment`, {
    session_id: sessionId,
    object_id: objectId,
    start_frame: startFrame ?? 0,
    end_frame: endFrame,
  });

export const getSAM3DStatus = (jobId: string) =>
  api.get<SAM3DJob>(`/api/sam3d/status/${jobId}`);

export const getSAM3DResult = (sessionId: string, objectId: string) =>
  api.get(`/api/sam3d/result/${sessionId}/${objectId}`);

export const listSAM3DJobs = (sessionId?: string) =>
  api.get<{ jobs: SAM3DJob[]; total: number }>(`/api/sam3d/jobs`, {
    params: sessionId ? { session_id: sessionId } : undefined,
  });

export const cancelSAM3DJob = (jobId: string) =>
  api.post(`/api/sam3d/cancel/${jobId}`);

// Match Analytics API functions
export interface StrokeEvent {
  frame: number;
  timestamp: number;
  type: "forehand" | "backhand";
  hand: "left" | "right";
  elbow_angle: number;
  shoulder_angle: number;
  confidence: number;
  wrist_velocity: number;
  elbow_velocity: number;
  shoulder_rotation_delta: number;
}

export interface WeaknessAnalysis {
  forehand: {
    count: number;
    percentage: number;
    avg_elbow_angle: number;
    avg_confidence: number;
    avg_shoulder_rotation: number;
  };
  backhand: {
    count: number;
    percentage: number;
    avg_elbow_angle: number;
    avg_confidence: number;
    avg_shoulder_rotation: number;
  };
  weaker_side: string | null;
  total_strokes: number;
}

export interface MatchAnalytics {
  session_id: string;
  strokes: StrokeEvent[];
  stroke_count: number;
  dominant_hand: string;
  weakness_analysis: WeaknessAnalysis;
  status?: string;
}

export interface PoseSummary {
  session_id: string;
  frame_count: number;
  duration: number;
  average_joint_angles: Record<string, { mean: number; min: number; max: number }>;
  average_body_metrics: Record<string, { mean: number; min: number; max: number }>;
  status?: string;
}

export const getMatchAnalytics = (sessionId: string) =>
  api.get<MatchAnalytics>(`/api/pose/match-analytics/${sessionId}`);

export const getPoseStrokes = (sessionId: string) =>
  api.get<{ session_id: string; strokes: StrokeEvent[]; count: number }>(
    `/api/pose/strokes/${sessionId}`
  );

// Player API functions
export const getPlayers = () => api.get<Player[]>("/api/players");

export const getPlayer = (id: string) => api.get<Player>(`/api/players/${id}`);

export const createPlayer = (data: PlayerCreate) =>
  api.post<Player>("/api/players", data);

export const updatePlayer = (id: string, data: PlayerUpdate) =>
  api.put<Player>(`/api/players/${id}`, data);

export const deletePlayer = (id: string) => api.delete(`/api/players/${id}`);

export const uploadPlayerAvatar = (playerId: string, file: File) => {
  const formData = new FormData();
  formData.append("avatar", file);
  return api.post<Player>(`/api/players/${playerId}/avatar`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
};

export const getPlayerGames = (
  playerId: string,
  params?: { search?: string; status?: string }
) =>
  api.get<GamePlayerInfo[]>(`/api/players/${playerId}/games`, { params });

// AI Chat
export interface AIChatRequest {
  message: string;
  session_id: string;
  history?: Array<{ role: string; content: string }>;
}

export interface AIChatResponse {
  response: string;
  tool_calls: Array<{ name: string; input: Record<string, string>; result: string }>;
}

export const aiChat = (data: AIChatRequest) =>
  api.post<AIChatResponse>("/api/ai/chat", data);

export const syncPlayerITTF = (playerId: string) =>
  api.post<Player>(`/api/players/${playerId}/sync-ittf`);

export const getPlayerITTFStats = (playerId: string) =>
  api.get<{ ittf_id: number | null; ittf_data: ITTFData | null; ittf_last_synced: string | null }>(
    `/api/players/${playerId}/ittf-stats`
  );

// Recording types
export type RecordingType = "match" | "informal" | "clip" | "highlight";

export interface Recording {
  id: string;
  session_id?: string;
  player_id: string;
  coach_id: string;
  title: string;
  description?: string;
  video_path?: string;
  thumbnail_path?: string;
  type: RecordingType;
  source_recording_id?: string;
  clip_start_time?: number;
  clip_end_time?: number;
  duration?: number;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at?: string;
}

export interface RecordingCreate {
  player_id: string;
  title: string;
  description?: string;
  type: RecordingType;
  source_recording_id?: string;
  clip_start_time?: number;
  clip_end_time?: number;
  duration?: number;
  metadata?: Record<string, unknown>;
}

export interface RecordingUpdate {
  title?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

// Recording API functions
export const createRecording = (data: FormData) =>
  api.post<Recording>("/api/recordings", data, {
    headers: { "Content-Type": "multipart/form-data" },
  });

export const getPlayerRecordings = (
  playerId: string,
  type?: RecordingType
) =>
  api.get<Recording[]>(`/api/recordings/player/${playerId}`, {
    params: type ? { type } : undefined,
  });

export const getRecording = (id: string) =>
  api.get<Recording>(`/api/recordings/${id}`);

export const updateRecording = (id: string, data: RecordingUpdate) =>
  api.put<Recording>(`/api/recordings/${id}`, data);

export const deleteRecording = (id: string) =>
  api.delete(`/api/recordings/${id}`);

export const createClip = (recordingId: string, data: FormData) =>
  api.post<Recording>(`/api/recordings/${recordingId}/clip`, data, {
    headers: { "Content-Type": "multipart/form-data" },
  });

export interface AnalyzeResponse {
  session_id: string;
  recording_id: string;
  clip_start_time: number;
  clip_end_time: number;
}

export const analyzeRecording = (recordingId: string, data: FormData) =>
  api.post<AnalyzeResponse>(`/api/recordings/${recordingId}/analyze`, data, {
    headers: { "Content-Type": "multipart/form-data" },
  });

// Tournament types
export type TournamentLevel = "local" | "regional" | "national" | "international" | "world";
export type TournamentStatus = "upcoming" | "ongoing" | "completed" | "cancelled";
export type MatchupResult = "win" | "loss" | "draw" | "pending" | "walkover" | "retired";

export interface Tournament {
  id: string;
  coach_id: string;
  name: string;
  location?: string;
  start_date?: string;
  end_date?: string;
  level?: TournamentLevel;
  status: TournamentStatus;
  surface?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at?: string;
  matchup_count?: number;
  win_count?: number;
  loss_count?: number;
}

export interface TournamentCreate {
  name: string;
  location?: string;
  start_date?: string;
  end_date?: string;
  level?: TournamentLevel;
  status?: TournamentStatus;
  surface?: string;
  notes?: string;
}

export interface TournamentUpdate {
  name?: string;
  location?: string;
  start_date?: string;
  end_date?: string;
  level?: TournamentLevel;
  status?: TournamentStatus;
  surface?: string;
  notes?: string;
}

export interface Matchup {
  id: string;
  tournament_id: string;
  coach_id: string;
  player_id?: string;
  player_name?: string;
  opponent_name: string;
  opponent_club?: string;
  opponent_ranking?: string;
  round?: string;
  scheduled_at?: string;
  result?: MatchupResult;
  score?: string;
  session_id?: string;
  notes?: string;
  youtube_url?: string;
  created_at: string;
  updated_at?: string;
}

export interface MatchupCreate {
  tournament_id: string;
  player_id?: string;
  opponent_name: string;
  opponent_club?: string;
  opponent_ranking?: string;
  round?: string;
  scheduled_at?: string;
  result?: MatchupResult;
  score?: string;
  session_id?: string;
  notes?: string;
  youtube_url?: string;
}

export interface MatchupUpdate {
  player_id?: string;
  opponent_name?: string;
  opponent_club?: string;
  opponent_ranking?: string;
  round?: string;
  scheduled_at?: string;
  result?: MatchupResult;
  score?: string;
  session_id?: string;
  notes?: string;
  youtube_url?: string;
}

export interface TournamentStats {
  total_tournaments: number;
  upcoming_tournaments: number;
  completed_tournaments: number;
  total_matchups: number;
  wins: number;
  losses: number;
  pending_matchups: number;
  win_rate: number;
}

// Tournament API functions
export const getTournaments = (status?: TournamentStatus) =>
  api.get<Tournament[]>("/api/tournaments", { params: status ? { status } : undefined });

export const getUpcomingTournaments = () =>
  api.get<Tournament[]>("/api/tournaments/upcoming");

export const getPastTournaments = () =>
  api.get<Tournament[]>("/api/tournaments/past");

export const getTournament = (id: string) =>
  api.get<Tournament>(`/api/tournaments/${id}`);

export const createTournament = (data: TournamentCreate) =>
  api.post<Tournament>("/api/tournaments", data);

export const updateTournament = (id: string, data: TournamentUpdate) =>
  api.put<Tournament>(`/api/tournaments/${id}`, data);

export const deleteTournament = (id: string) =>
  api.delete(`/api/tournaments/${id}`);

export const getTournamentMatchups = (tournamentId: string) =>
  api.get<Matchup[]>(`/api/tournaments/${tournamentId}/matchups`);

export const createMatchup = (tournamentId: string, data: MatchupCreate) =>
  api.post<Matchup>(`/api/tournaments/${tournamentId}/matchups`, data);

export const updateMatchup = (id: string, data: MatchupUpdate) =>
  api.put<Matchup>(`/api/tournaments/matchups/${id}`, data);

export const deleteMatchup = (id: string) =>
  api.delete(`/api/tournaments/matchups/${id}`);

export const getTournamentStats = () =>
  api.get<TournamentStats>("/api/tournaments/stats/summary");

// ITTF Calendar
export interface ITTFCalendarEvent {
  name: string;
  location?: string;
  date_text?: string;
  level?: string;
}

export const getITTFCalendar = (year?: number) =>
  api.get<{ events: ITTFCalendarEvent[]; count: number }>("/api/tournaments/ittf-calendar", {
    params: year ? { year } : undefined,
  });

export const importITTFTournaments = (events: ITTFCalendarEvent[]) =>
  api.post<Tournament[]>("/api/tournaments/import-ittf", { events });

// ITTF Player Search
export interface ITTFSearchResult {
  ittf_id?: number;
  name?: string;
  nationality?: string;
  ranking?: number;
}

export const searchITTFPlayers = (query: string) =>
  api.get<{ query: string; results: ITTFSearchResult[]; count: number }>(
    "/api/players/search-ittf",
    { params: { q: query } }
  );

// Video types
export interface Video {
  id: string;
  coach_id: string;
  url: string;
  youtube_video_id?: string;
  title?: string;
  thumbnail_url?: string;
  duration?: string;
  source: "youtube" | "upload" | "other";
  matchup_id?: string;
  tournament_id?: string;
  player_id?: string;
  session_id?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at?: string;
}

export interface VideoCreate {
  url: string;
  title?: string;
  thumbnail_url?: string;
  duration?: string;
  source?: string;
  matchup_id?: string;
  tournament_id?: string;
  player_id?: string;
  metadata?: Record<string, unknown>;
}

export interface VideoUpdate {
  title?: string;
  url?: string;
  thumbnail_url?: string;
  duration?: string;
  matchup_id?: string;
  tournament_id?: string;
  player_id?: string;
  metadata?: Record<string, unknown>;
}

// Video API functions
export const createVideo = (data: VideoCreate) =>
  api.post<Video>("/api/videos", data);

export const getVideos = (filters?: {
  matchup_id?: string;
  tournament_id?: string;
  player_id?: string;
}) => api.get<Video[]>("/api/videos", { params: filters });

export const getVideo = (id: string) =>
  api.get<Video>(`/api/videos/${id}`);

export const updateVideo = (id: string, data: VideoUpdate) =>
  api.put<Video>(`/api/videos/${id}`, data);

export const deleteVideo = (id: string) =>
  api.delete(`/api/videos/${id}`);

export const getYouTubeMetadata = (url: string) =>
  api.get<{
    title: string;
    thumbnail_url: string;
    duration: string;
    duration_seconds: number;
    channel: string;
    view_count: number;
    upload_date: string;
    description: string;
    youtube_video_id: string;
  }>("/api/videos/youtube-metadata", { params: { url } });

export const analyzeVideo = (videoId: string) =>
  api.post<{ message: string; video_id: string }>(`/api/videos/${videoId}/analyze`);


// ── WTT Database Types ──────────────────────────────────────────────

export interface WTTTournament {
  id: string;
  external_id?: string;
  name: string;
  season_name?: string;
  location?: string;
  start_date?: string;
  end_date?: string;
  tier?: string;
  league_name?: string;
  status?: string;
  match_count?: number;
  created_at: string;
  updated_at?: string;
}

export interface WTTPlayer {
  id: string;
  external_id?: string;
  ittf_id?: number;
  name: string;
  country?: string;
  ranking?: number;
  grip_style?: string;
  handedness?: string;
  photo_url?: string;
  birth_year?: number;
  playing_style?: string;
  career_wins?: number;
  career_losses?: number;
  created_at: string;
  updated_at?: string;
}

export interface WTTMatch {
  id: string;
  external_id?: string;
  tournament_id: string;
  tournament_name?: string;
  player_1_id?: string;
  player_1_name?: string;
  player_1_country?: string;
  player_2_id?: string;
  player_2_name?: string;
  player_2_country?: string;
  winner_id?: string;
  round?: string;
  score_summary?: string;
  score_detail?: string;
  scores_json?: Array<{ set: number; p1: number; p2: number }>;
  status?: string;
  start_time?: string;
  duration_seconds?: number;
  video_url?: string;
  created_at: string;
  updated_at?: string;
}

// ── WTT Database API Functions ──────────────────────────────────────

export const getWTTTournaments = (params?: {
  tier?: string;
  year?: number;
  search?: string;
  limit?: number;
  offset?: number;
}) => api.get<WTTTournament[]>("/api/wtt/tournaments", { params });

export const getWTTTournament = (id: string) =>
  api.get<WTTTournament>(`/api/wtt/tournaments/${id}`);

export const getWTTTournamentMatches = (
  tournamentId: string,
  round?: string,
) =>
  api.get<WTTMatch[]>(`/api/wtt/tournaments/${tournamentId}/matches`, {
    params: round ? { round } : undefined,
  });

export const getWTTMatch = (id: string) =>
  api.get<WTTMatch>(`/api/wtt/matches/${id}`);

export const getWTTPlayers = (params?: {
  search?: string;
  country?: string;
  limit?: number;
  offset?: number;
}) => api.get<WTTPlayer[]>("/api/wtt/players", { params });

export const getWTTPlayer = (id: string) =>
  api.get<WTTPlayer>(`/api/wtt/players/${id}`);

export const getWTTPlayerMatches = (playerId: string, limit?: number) =>
  api.get<WTTMatch[]>(`/api/wtt/players/${playerId}/matches`, {
    params: limit ? { limit } : undefined,
  });

export const syncWTTTournament = (externalTournamentId: number) =>
  api.post("/api/wtt/sync/tournament", {
    external_tournament_id: externalTournamentId,
  });

export const syncWTTRecent = (days?: number) =>
  api.post("/api/wtt/sync/recent", undefined, {
    params: days ? { days } : undefined,
  });

export const syncWTTVideos = (tournamentId: string) =>
  api.post(`/api/wtt/sync/videos/${tournamentId}`);

export const enrichWTTPlayer = (playerId: string) =>
  api.post(`/api/wtt/players/${playerId}/enrich`);

export default api;
