"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MatchupCreate, MatchupResult, Player } from "@/lib/api";

interface MatchupFormProps {
  tournamentId: string;
  players: Player[];
  onSubmit: (data: MatchupCreate) => void;
  onClose: () => void;
  isPending?: boolean;
  initialData?: Partial<MatchupCreate>;
}

const ROUNDS = [
  "Qualification",
  "Round of 64",
  "Round of 32",
  "Round of 16",
  "Quarterfinal",
  "Semifinal",
  "Bronze Medal",
  "Final",
  "Group Stage",
];

const RESULTS: { value: MatchupResult; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "win", label: "Win" },
  { value: "loss", label: "Loss" },
  { value: "draw", label: "Draw" },
  { value: "walkover", label: "Walkover" },
  { value: "retired", label: "Retired" },
];

export function MatchupForm({
  tournamentId,
  players,
  onSubmit,
  onClose,
  isPending,
  initialData,
}: MatchupFormProps) {
  const [playerId, setPlayerId] = useState(initialData?.player_id || "");
  const [opponentName, setOpponentName] = useState(initialData?.opponent_name || "");
  const [opponentClub, setOpponentClub] = useState(initialData?.opponent_club || "");
  const [opponentRanking, setOpponentRanking] = useState(initialData?.opponent_ranking || "");
  const [round, setRound] = useState(initialData?.round || "");
  const [scheduledAt, setScheduledAt] = useState(initialData?.scheduled_at?.slice(0, 16) || "");
  const [result, setResult] = useState<MatchupResult>(initialData?.result || "pending");
  const [score, setScore] = useState(initialData?.score || "");
  const [notes, setNotes] = useState(initialData?.notes || "");
  const [youtubeUrl, setYoutubeUrl] = useState(initialData?.youtube_url || "");

  const isValidYoutubeUrl = (url: string) => {
    if (!url) return true;
    return /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)/.test(url);
  };

  const getYoutubeThumbnail = (url: string) => {
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
    return match ? `https://img.youtube.com/vi/${match[1]}/mqdefault.jpg` : null;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!opponentName.trim()) return;
    onSubmit({
      tournament_id: tournamentId,
      player_id: playerId || undefined,
      opponent_name: opponentName.trim(),
      opponent_club: opponentClub.trim() || undefined,
      opponent_ranking: opponentRanking.trim() || undefined,
      round: round || undefined,
      scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
      result,
      score: score.trim() || undefined,
      notes: notes.trim() || undefined,
      youtube_url: youtubeUrl.trim() || undefined,
    });
  };

  const inputClass =
    "w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-card border border-border rounded-xl w-full max-w-lg overflow-hidden max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-sm font-medium text-foreground">
            {initialData ? "Edit Matchup" : "Add Matchup"}
          </h2>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7">
            <X className="w-4 h-4" />
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-xs text-muted-foreground mb-1.5">Your Player</label>
            <select value={playerId} onChange={(e) => setPlayerId(e.target.value)} className={inputClass}>
              <option value="">Select player (optional)</option>
              {players.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-muted-foreground mb-1.5">Opponent Name *</label>
            <input
              type="text"
              value={opponentName}
              onChange={(e) => setOpponentName(e.target.value)}
              placeholder="e.g. FAN Zhendong"
              className={inputClass}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-muted-foreground mb-1.5">Opponent Club</label>
              <input
                type="text"
                value={opponentClub}
                onChange={(e) => setOpponentClub(e.target.value)}
                placeholder="e.g. CHN"
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1.5">Opponent Ranking</label>
              <input
                type="text"
                value={opponentRanking}
                onChange={(e) => setOpponentRanking(e.target.value)}
                placeholder="e.g. #5"
                className={inputClass}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-muted-foreground mb-1.5">Round</label>
              <select value={round} onChange={(e) => setRound(e.target.value)} className={inputClass}>
                <option value="">Select round</option>
                {ROUNDS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1.5">Scheduled Time</label>
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-muted-foreground mb-1.5">Result</label>
              <select
                value={result}
                onChange={(e) => setResult(e.target.value as MatchupResult)}
                className={inputClass}
              >
                {RESULTS.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1.5">Score</label>
              <input
                type="text"
                value={score}
                onChange={(e) => setScore(e.target.value)}
                placeholder="e.g. 3-1 (11-9, 9-11, 11-7, 11-5)"
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-muted-foreground mb-1.5">YouTube Video URL</label>
            <input
              type="url"
              value={youtubeUrl}
              onChange={(e) => setYoutubeUrl(e.target.value)}
              placeholder="https://youtube.com/watch?v=..."
              className={`${inputClass} ${youtubeUrl && !isValidYoutubeUrl(youtubeUrl) ? "border-red-400/50" : ""}`}
            />
            {youtubeUrl && isValidYoutubeUrl(youtubeUrl) && getYoutubeThumbnail(youtubeUrl) && (
              <div className="mt-2 rounded-lg overflow-hidden border border-border">
                <img
                  src={getYoutubeThumbnail(youtubeUrl)!}
                  alt="Video preview"
                  className="w-full h-32 object-cover"
                />
              </div>
            )}
            {youtubeUrl && !isValidYoutubeUrl(youtubeUrl) && (
              <p className="text-[10px] text-red-400 mt-1">Please enter a valid YouTube URL</p>
            )}
          </div>

          <div>
            <label className="block text-xs text-muted-foreground mb-1.5">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Match notes..."
              rows={2}
              className={inputClass}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose} className="text-sm">
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!opponentName.trim() || isPending}
              className="bg-[#9B7B5B] hover:bg-[#8A6B4B] text-primary-foreground text-sm"
            >
              {isPending ? "Saving..." : initialData ? "Update" : "Add Matchup"}
            </Button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}
