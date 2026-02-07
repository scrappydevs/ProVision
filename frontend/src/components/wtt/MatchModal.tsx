"use client";

import { useEffect } from "react";
import { motion } from "framer-motion";
import {
  X,
  User,
  Trophy,
  Clock,
  Video,
  ExternalLink,
  Loader2,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { WTTMatch } from "@/lib/api";
import { useWTTPlayer, useEnrichWTTPlayer } from "@/hooks/useWTTData";
import { YouTubeEmbed } from "@/components/ui/youtube-embed";

interface MatchModalProps {
  match: WTTMatch;
  onClose: () => void;
}

function extractYouTubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

export function MatchModal({ match, onClose }: MatchModalProps) {
  const { data: player1 } = useWTTPlayer(match.player_1_id || "");
  const { data: player2 } = useWTTPlayer(match.player_2_id || "");
  const enrichP1 = useEnrichWTTPlayer();
  const enrichP2 = useEnrichWTTPlayer();

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const ytId = match.video_url ? extractYouTubeId(match.video_url) : null;
  const isP1Winner = match.winner_id === match.player_1_id;
  const isP2Winner = match.winner_id === match.player_2_id;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-[#1E1D1F] border border-[#363436] rounded-2xl shadow-2xl z-10"
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 w-8 h-8 rounded-lg bg-[#282729] flex items-center justify-center text-[#8A8885] hover:text-[#E8E6E3] transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Video embed */}
        {ytId && (
          <div className="rounded-t-2xl overflow-hidden">
            <YouTubeEmbed youtubeVideoId={ytId} />
          </div>
        )}

        <div className="p-6 space-y-6">
          {/* Round + Tournament info */}
          <div className="text-center">
            {match.round && (
              <span className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-[#9B7B5B]/20 text-[#9B7B5B]">
                {match.round}
              </span>
            )}
            {match.tournament_name && (
              <p className="text-xs text-[#8A8885] mt-2">
                {match.tournament_name}
              </p>
            )}
          </div>

          {/* Score Display */}
          <div className="flex items-center justify-center gap-6">
            {/* Player 1 */}
            <div className="flex-1 text-center">
              <div
                className={`text-lg font-bold ${
                  isP1Winner ? "text-[#9B7B5B]" : "text-[#E8E6E3]"
                }`}
              >
                {match.player_1_name || "TBD"}
              </div>
              {match.player_1_country && (
                <div className="text-xs text-[#8A8885] mt-0.5">
                  {match.player_1_country}
                </div>
              )}
              {isP1Winner && (
                <div className="flex items-center justify-center gap-1 mt-1">
                  <Trophy className="w-3 h-3 text-[#9B7B5B]" />
                  <span className="text-[10px] font-semibold text-[#9B7B5B]">
                    WINNER
                  </span>
                </div>
              )}
            </div>

            {/* Score */}
            <div className="shrink-0 text-center">
              <div className="text-3xl font-bold font-mono text-[#E8E6E3] tracking-wider">
                {match.score_summary || "vs"}
              </div>
              {match.status === "finished" && (
                <div className="text-[10px] text-[#8A8885] mt-1">FINAL</div>
              )}
            </div>

            {/* Player 2 */}
            <div className="flex-1 text-center">
              <div
                className={`text-lg font-bold ${
                  isP2Winner ? "text-[#9B7B5B]" : "text-[#E8E6E3]"
                }`}
              >
                {match.player_2_name || "TBD"}
              </div>
              {match.player_2_country && (
                <div className="text-xs text-[#8A8885] mt-0.5">
                  {match.player_2_country}
                </div>
              )}
              {isP2Winner && (
                <div className="flex items-center justify-center gap-1 mt-1">
                  <Trophy className="w-3 h-3 text-[#9B7B5B]" />
                  <span className="text-[10px] font-semibold text-[#9B7B5B]">
                    WINNER
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Set-by-Set Breakdown */}
          {match.scores_json && match.scores_json.length > 0 && (
            <div className="bg-[#282729] rounded-xl p-4">
              <div className="text-xs font-medium text-[#8A8885] mb-3 text-center">
                SET-BY-SET BREAKDOWN
              </div>
              <div className="flex justify-center gap-2">
                {match.scores_json.map((s, i) => {
                  const p1Won = s.p1 > s.p2;
                  return (
                    <div
                      key={i}
                      className="flex flex-col items-center bg-[#1E1D1F] rounded-lg px-3 py-2 min-w-[52px]"
                    >
                      <span className="text-[10px] text-[#8A8885] mb-1">
                        Set {s.set}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`text-sm font-mono font-bold ${
                            p1Won ? "text-[#9B7B5B]" : "text-[#8A8885]"
                          }`}
                        >
                          {s.p1}
                        </span>
                        <span className="text-[10px] text-[#363436]">-</span>
                        <span
                          className={`text-sm font-mono font-bold ${
                            !p1Won ? "text-[#9B7B5B]" : "text-[#8A8885]"
                          }`}
                        >
                          {s.p2}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
              {match.score_detail && (
                <div className="text-xs text-[#8A8885] text-center mt-2 font-mono">
                  {match.score_detail}
                </div>
              )}
            </div>
          )}

          {/* Player Cards */}
          <div className="grid grid-cols-2 gap-3">
            <PlayerCard
              player={player1}
              name={match.player_1_name}
              country={match.player_1_country}
              isWinner={isP1Winner}
              playerId={match.player_1_id}
              onEnrich={enrichP1}
            />
            <PlayerCard
              player={player2}
              name={match.player_2_name}
              country={match.player_2_country}
              isWinner={isP2Winner}
              playerId={match.player_2_id}
              onEnrich={enrichP2}
            />
          </div>

          {/* Video link (if no embed) */}
          {match.video_url && !ytId && (
            <a
              href={match.video_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-[#282729] text-sm text-[#9B7B5B] hover:text-[#E8E6E3] transition-colors"
            >
              <Video className="w-4 h-4" />
              Watch Video
              <ExternalLink className="w-3 h-3" />
            </a>
          )}

          {/* Duration */}
          {match.duration_seconds && match.duration_seconds > 0 && (
            <div className="flex items-center justify-center gap-1.5 text-xs text-[#8A8885]">
              <Clock className="w-3 h-3" />
              Match duration:{" "}
              {Math.floor(match.duration_seconds / 60)} min
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

function PlayerCard({
  player,
  name,
  country,
  isWinner,
  playerId,
  onEnrich,
}: {
  player: ReturnType<typeof useWTTPlayer>["data"];
  name?: string;
  country?: string;
  isWinner: boolean;
  playerId?: string;
  onEnrich: ReturnType<typeof useEnrichWTTPlayer>;
}) {
  const hasDetails = player?.handedness || player?.grip_style || player?.ranking;
  const needsEnrichment = player && !hasDetails && !player.ittf_id;

  return (
    <div
      className={`bg-[#282729] rounded-xl p-4 border ${
        isWinner ? "border-[#9B7B5B]/30" : "border-[#363436]"
      }`}
    >
      {/* Avatar/Photo */}
      <div className="flex items-center gap-3 mb-3">
        {player?.photo_url ? (
          <img
            src={player.photo_url}
            alt={name || "Player"}
            className="w-10 h-10 rounded-full object-cover bg-[#363436]"
          />
        ) : (
          <div className="w-10 h-10 rounded-full bg-[#363436] flex items-center justify-center">
            <User className="w-5 h-5 text-[#8A8885]" />
          </div>
        )}
        <div className="min-w-0">
          <div className="text-sm font-medium text-[#E8E6E3] truncate">
            {name || "TBD"}
          </div>
          <div className="text-[10px] text-[#8A8885]">{country}</div>
        </div>
      </div>

      {/* Player details */}
      {hasDetails && (
        <div className="space-y-1.5 text-xs">
          {player?.ranking && (
            <Detail label="Ranking" value={`#${player.ranking}`} />
          )}
          {player?.handedness && (
            <Detail label="Hand" value={player.handedness} />
          )}
          {player?.grip_style && (
            <Detail label="Grip" value={player.grip_style} />
          )}
          {player?.playing_style && (
            <Detail label="Style" value={player.playing_style} />
          )}
          {(player?.career_wins || player?.career_losses) && (
            <Detail
              label="Career"
              value={`${player?.career_wins ?? 0}W – ${
                player?.career_losses ?? 0
              }L`}
            />
          )}
        </div>
      )}

      {/* Enrich button */}
      {needsEnrichment && playerId && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onEnrich.mutate(playerId)}
          disabled={onEnrich.isPending}
          className="w-full mt-2 text-xs text-[#8A8885] hover:text-[#9B7B5B]"
        >
          {onEnrich.isPending ? (
            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
          ) : (
            <Sparkles className="w-3 h-3 mr-1" />
          )}
          Fetch ITTF Data
        </Button>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[#8A8885]">{label}</span>
      <span className="text-[#E8E6E3] font-medium">{value}</span>
    </div>
  );
}
