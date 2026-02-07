"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Check, X, RefreshCw } from "lucide-react";
import {
  getPlayerPreview,
  selectPlayer,
  analyzePose,
  DetectedPlayer,
  PlayerPreviewResponse,
} from "@/lib/api";
import { cn } from "@/lib/utils";

interface PlayerSelectionProps {
  sessionId: string;
  isOpen?: boolean;
  onClose?: () => void;
  onAnalysisStarted: () => void;
  variant?: "modal" | "inline";
  className?: string;
}

export function PlayerSelection({
  sessionId,
  isOpen = false,
  onClose,
  onAnalysisStarted,
  variant = "modal",
  className,
}: PlayerSelectionProps) {
  const [loading, setLoading] = useState(false);
  const [previewData, setPreviewData] = useState<PlayerPreviewResponse | null>(null);
  const [selectedPlayers, setSelectedPlayers] = useState<DetectedPlayer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const isModal = variant === "modal";

  const loadPreview = async () => {
    setLoading(true);
    setError(null);
    setSelectedPlayers([]);
    try {
      console.log("[PlayerSelection] Loading preview for session:", sessionId);
      const response = await getPlayerPreview(sessionId);
      console.log("[PlayerSelection] Preview loaded:", response.data);
      setPreviewData(response.data);

      // Auto-select up to 2 players (for player vs opponent analysis)
      if (response.data.players.length > 0) {
        const toSelect = response.data.players.slice(0, Math.min(2, response.data.players.length));
        setSelectedPlayers(toSelect);
      }
    } catch (err: any) {
      console.error("[PlayerSelection] Error loading preview:", err);
      const errorMessage = err?.response?.data?.detail || err?.message || "Failed to load player preview";
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  // Load preview when dialog opens
  useEffect(() => {
    const shouldLoad = isModal ? isOpen : true;
    if (shouldLoad && !previewData && !loading) {
      loadPreview();
    }
  }, [isOpen, isModal, previewData, loading]);

  // Reset state when dialog closes
  useEffect(() => {
    if (isModal && !isOpen) {
      setPreviewData(null);
      setSelectedPlayers([]);
      setError(null);
    }
  }, [isOpen, isModal]);

  const handlePlayerClick = (player: DetectedPlayer) => {
    setSelectedPlayers((prev) => {
      const isCurrentlySelected = prev.some(p => p.player_idx === player.player_idx);

      if (isCurrentlySelected) {
        // Deselect
        return prev.filter(p => p.player_idx !== player.player_idx);
      } else {
        // Select (max 2 players)
        if (prev.length >= 2) {
          // Replace the oldest selection
          return [...prev.slice(1), player];
        }
        return [...prev, player];
      }
    });
  };

  const handleConfirm = async () => {
    if (selectedPlayers.length === 0) return;

    setSubmitting(true);
    try {
      // Save primary player selection (first selected)
      await selectPlayer(sessionId, selectedPlayers[0]);

      // Start pose analysis (backend will skip if already done)
      const response = await analyzePose(sessionId);

      if (response.data?.status === "already_complete") {
        // Pose already exists, just close
        onAnalysisStarted();
        onClose?.();
        return;
      }

      onAnalysisStarted();
      onClose?.();
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Failed to start analysis";
      setError(errorMessage);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSkipSelection = async () => {
    setSubmitting(true);
    try {
      // Start pose analysis without player selection (backend will skip if already done)
      const response = await analyzePose(sessionId);
      
      if (response.data?.status === "already_complete") {
        onAnalysisStarted();
        onClose?.();
        return;
      }
      
      onAnalysisStarted();
      onClose?.();
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Failed to start analysis";
      setError(errorMessage);
    } finally {
      setSubmitting(false);
    }
  };

  // Handle dialog open/close
  const handleOpenChange = (open: boolean) => {
    if (!open) onClose?.();
  };

  const header = (
    <div className="flex items-center justify-between mb-3">
      {isModal ? (
        <DialogTitle className="text-sm font-medium text-[#E8E6E3]">Select Player</DialogTitle>
      ) : (
        <div className="text-sm font-medium text-[#E8E6E3]">Select Player</div>
      )}
      {onClose && (
        <button
          onClick={onClose}
          className="text-[#8A8885] hover:text-[#E8E6E3] transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );

  const content = (
    <>
      {/* Content */}
      <div className={cn(
        "relative bg-[#282729]/40 backdrop-blur-sm rounded-xl overflow-hidden",
        isModal ? "min-h-[400px]" : "min-h-[260px]"
      )}>
        {(loading || (!previewData && !error)) && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-[#9B7B5B]" />
              <p className="text-xs text-[#8A8885]">Detecting players...</p>
            </div>
          </div>
        )}

        {error && !loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-center px-4">
              <X className="w-6 h-6 text-[#C45C5C]" />
              <p className="text-xs text-[#C45C5C]">{error}</p>
              <button
                onClick={loadPreview}
                className="text-xs text-[#9B7B5B] hover:text-[#B8956D] transition-colors flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" />
                Retry
              </button>
            </div>
          </div>
        )}

        {previewData && !loading && (
          <div className="space-y-3">
            {/* Preview image with clickable overlays */}
            <div className="relative rounded-lg overflow-hidden">
              <img
                ref={imageRef}
                src={previewData.preview_url}
                alt="Player detection"
                className="w-full h-auto"
              />
              
              {/* Clickable player boxes */}
              {previewData.players.map((player) => {
                const img = imageRef.current;
                if (!img) return null;

                const videoWidth = previewData.video_info.width;
                const videoHeight = previewData.video_info.height;

                const leftPct = (player.bbox.x / videoWidth) * 100;
                const topPct = (player.bbox.y / videoHeight) * 100;
                const widthPct = (player.bbox.width / videoWidth) * 100;
                const heightPct = (player.bbox.height / videoHeight) * 100;

                const isSelected = selectedPlayers.some(p => p.player_idx === player.player_idx);
                const selectionIndex = selectedPlayers.findIndex(p => p.player_idx === player.player_idx);
                const isPrimary = selectionIndex === 0;
                const isOpponent = selectionIndex === 1;

                return (
                  <button
                    key={player.player_idx}
                    onClick={() => handlePlayerClick(player)}
                    className={`absolute rounded transition-all cursor-pointer ${
                      isSelected
                        ? "border-2 border-[#9B7B5B] bg-[#9B7B5B]/10"
                        : "border border-[#E8E6E3]/30 hover:border-[#9B7B5B]/50"
                    }`}
                    style={{
                      left: `${leftPct}%`,
                      top: `${topPct}%`,
                      width: `${widthPct}%`,
                      height: `${heightPct}%`,
                    }}
                  >
                    {isSelected && (
                      <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-[#9B7B5B] text-[#1E1D1F] px-2 py-0.5 rounded text-[10px] font-medium whitespace-nowrap">
                        <Check className="w-2.5 h-2.5 inline mr-0.5" />
                        {isPrimary ? "Player" : isOpponent ? "Opponent" : "Selected"}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Player list */}
            <div className="flex flex-wrap gap-2 px-3">
              {previewData.players.map((player) => {
                const isSelected = selectedPlayers.some(p => p.player_idx === player.player_idx);
                const selectionIndex = selectedPlayers.findIndex(p => p.player_idx === player.player_idx);
                const isPrimary = selectionIndex === 0;
                const isOpponent = selectionIndex === 1;

                return (
                  <button
                    key={player.player_idx}
                    onClick={() => handlePlayerClick(player)}
                    className={`text-[10px] px-2.5 py-1.5 rounded-lg transition-all font-medium flex items-center gap-1.5 ${
                      isSelected
                        ? "bg-[#9B7B5B] text-[#1E1D1F]"
                        : "text-[#E8E6E3]/70 hover:text-[#9B7B5B] hover:bg-[#9B7B5B]/10"
                    }`}
                  >
                    {isSelected && <Check className="w-3 h-3" />}
                    Player {player.player_idx + 1}
                    {isPrimary && <span className="text-[9px] opacity-70">(P)</span>}
                    {isOpponent && <span className="text-[9px] opacity-70">(O)</span>}
                    <span className="ml-0.5 opacity-60">
                      {(player.confidence * 100).toFixed(0)}%
                    </span>
                  </button>
                );
              })}
            </div>

            {previewData.players.length === 0 && (
              <div className="text-center py-8 text-[#8A8885] text-xs">
                <p>No players detected</p>
                <p className="text-[10px] mt-1 opacity-70">
                  Analysis will attempt to track any person that appears
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-3 border-t border-[#363436]/30">
        <div className="text-[10px] text-[#8A8885]">
          {previewData && (
            <>
              <span>{previewData.video_info.duration.toFixed(1)}s</span>
              <span className="mx-2">•</span>
              <span>{previewData.video_info.width}x{previewData.video_info.height}</span>
              <span className="mx-2">•</span>
              <span>{previewData.video_info.fps.toFixed(0)} FPS</span>
            </>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          {previewData && previewData.players.length > 0 && (
            <button
              onClick={handleSkipSelection}
              disabled={submitting}
              className="text-[10px] text-[#8A8885] hover:text-[#E8E6E3] transition-colors disabled:opacity-50"
            >
              Auto-detect
            </button>
          )}
          
          <button
            onClick={handleConfirm}
            disabled={!selectedPlayer || submitting}
            className="text-[10px] px-3 py-1.5 rounded-lg bg-[#9B7B5B] hover:bg-[#8A6B4B] text-[#1E1D1F] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
          >
            {submitting ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                Starting...
              </>
            ) : (
              <>
                <Check className="w-3 h-3" />
                Confirm
              </>
            )}
          </button>
        </div>
      </div>
    </>
  );

  if (isModal) {
    return (
      <Dialog open={isOpen} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-4xl bg-[#1E1D1F]/95 backdrop-blur-xl border-[#363436]/50">
          {header}
          {content}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <div className={cn(
      "rounded-xl bg-[#1E1D1F]/70 border border-[#363436]/40 p-3",
      className
    )}>
      {header}
      {content}
    </div>
  );
}
