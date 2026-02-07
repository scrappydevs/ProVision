"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Loader2, Users, Check, X, RefreshCw } from "lucide-react";
import {
  getPlayerPreview,
  selectPlayer,
  analyzePose,
  DetectedPlayer,
  PlayerPreviewResponse,
} from "@/lib/api";

interface PlayerSelectionProps {
  sessionId: string;
  isOpen: boolean;
  onClose: () => void;
  onAnalysisStarted: () => void;
}

export function PlayerSelection({
  sessionId,
  isOpen,
  onClose,
  onAnalysisStarted,
}: PlayerSelectionProps) {
  const [loading, setLoading] = useState(false);
  const [previewData, setPreviewData] = useState<PlayerPreviewResponse | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState<DetectedPlayer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);

  const loadPreview = async () => {
    setLoading(true);
    setError(null);
    setSelectedPlayer(null);
    try {
      console.log("[PlayerSelection] Loading preview for session:", sessionId);
      const response = await getPlayerPreview(sessionId);
      console.log("[PlayerSelection] Preview loaded:", response.data);
      setPreviewData(response.data);
      
      // Auto-select if only one player
      if (response.data.players.length === 1) {
        setSelectedPlayer(response.data.players[0]);
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
    if (isOpen && !previewData && !loading) {
      loadPreview();
    }
  }, [isOpen]);

  // Reset state when dialog closes
  useEffect(() => {
    if (!isOpen) {
      setPreviewData(null);
      setSelectedPlayer(null);
      setError(null);
    }
  }, [isOpen]);

  const handlePlayerClick = (player: DetectedPlayer) => {
    setSelectedPlayer(player);
  };

  const handleConfirm = async () => {
    if (!selectedPlayer) return;

    setSubmitting(true);
    try {
      // Save player selection
      await selectPlayer(sessionId, selectedPlayer);
      
      // Start pose analysis (backend will skip if already done)
      const response = await analyzePose(sessionId);
      
      if (response.data?.status === "already_complete") {
        // Pose already exists, just close
        onAnalysisStarted();
        onClose();
        return;
      }
      
      onAnalysisStarted();
      onClose();
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
        onClose();
        return;
      }
      
      onAnalysisStarted();
      onClose();
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Failed to start analysis";
      setError(errorMessage);
    } finally {
      setSubmitting(false);
    }
  };

  // Handle dialog open/close
  const handleOpenChange = (open: boolean) => {
    if (!open) {
      onClose();
    }
  };

  const getPlayerColor = (idx: number, isSelected: boolean) => {
    if (isSelected) return "border-[#9B7B5B] bg-[#9B7B5B]/20";
    const colors = [
      "border-blue-500 hover:border-blue-400",
      "border-green-500 hover:border-green-400",
      "border-purple-500 hover:border-purple-400",
      "border-orange-500 hover:border-orange-400",
      "border-pink-500 hover:border-pink-400",
    ];
    return colors[idx % colors.length];
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-4xl bg-background border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <Users className="w-5 h-5 text-[#9B7B5B]" />
            Select Player to Track
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Click on a player to select them for pose analysis. The selected player will be tracked throughout the video.
          </DialogDescription>
        </DialogHeader>

        <div className="relative min-h-[400px] bg-card rounded-lg">
          {(loading || (!previewData && !error)) && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="w-8 h-8 animate-spin text-[#9B7B5B]" />
                <p className="text-muted-foreground">Detecting players...</p>
              </div>
            </div>
          )}

          {error && !loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-card rounded-lg">
              <div className="flex flex-col items-center gap-3 text-center px-4">
                <X className="w-8 h-8 text-[#C45C5C]" />
                <p className="text-[#C45C5C]">{error}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={loadPreview}
                  className="border-border hover:border-primary"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Retry
                </Button>
              </div>
            </div>
          )}

          {previewData && !loading && (
            <div className="space-y-4">
              {/* Preview image with clickable overlays */}
              <div className="relative bg-card rounded-lg overflow-hidden">
                <img
                  ref={imageRef}
                  src={previewData.preview_url}
                  alt="Player detection preview"
                  className="w-full h-auto"
                />
                
                {/* Clickable player boxes */}
                {previewData.players.map((player) => {
                  const img = imageRef.current;
                  if (!img) return null;
                  
                  // Calculate position as percentage
                  const videoWidth = previewData.video_info.width;
                  const videoHeight = previewData.video_info.height;
                  
                  const leftPct = (player.bbox.x / videoWidth) * 100;
                  const topPct = (player.bbox.y / videoHeight) * 100;
                  const widthPct = (player.bbox.width / videoWidth) * 100;
                  const heightPct = (player.bbox.height / videoHeight) * 100;

                  const isSelected = selectedPlayer?.player_idx === player.player_idx;

                  return (
                    <button
                      key={player.player_idx}
                      onClick={() => handlePlayerClick(player)}
                      className={`absolute border-2 rounded transition-all cursor-pointer ${getPlayerColor(
                        player.player_idx,
                        isSelected
                      )} ${isSelected ? "border-4" : ""}`}
                      style={{
                        left: `${leftPct}%`,
                        top: `${topPct}%`,
                        width: `${widthPct}%`,
                        height: `${heightPct}%`,
                      }}
                    >
                      {isSelected && (
                        <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground px-2 py-1 rounded text-xs font-medium whitespace-nowrap">
                          <Check className="w-3 h-3 inline mr-1" />
                          Selected
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Player list */}
              <div className="flex flex-wrap gap-2">
                {previewData.players.map((player) => {
                  const isSelected = selectedPlayer?.player_idx === player.player_idx;
                  return (
                    <Button
                      key={player.player_idx}
                      variant={isSelected ? "default" : "outline"}
                      size="sm"
                      onClick={() => handlePlayerClick(player)}
                      className={
                        isSelected
                          ? "bg-primary hover:bg-primary/90 text-primary-foreground"
                          : "border-border hover:border-primary"
                      }
                    >
                      Player {player.player_idx + 1}
                      <span className="ml-2 text-xs opacity-70">
                        {(player.confidence * 100).toFixed(0)}%
                      </span>
                    </Button>
                  );
                })}
              </div>

              {previewData.players.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  <p>No players detected in the first frame.</p>
                  <p className="text-sm mt-1">
                    The analysis will attempt to track any person that appears later.
                  </p>
                </div>
              )}

              {/* Video info */}
              <div className="text-xs text-muted-foreground flex gap-4">
                <span>Duration: {previewData.video_info.duration.toFixed(1)}s</span>
                <span>
                  Resolution: {previewData.video_info.width}x{previewData.video_info.height}
                </span>
                <span>FPS: {previewData.video_info.fps.toFixed(0)}</span>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={submitting}
            className="hover:bg-muted"
          >
            Cancel
          </Button>
          
          {previewData && previewData.players.length > 0 && (
            <Button
              variant="outline"
              onClick={handleSkipSelection}
              disabled={submitting}
              className="border-border hover:border-primary"
            >
              Skip (Auto-detect)
            </Button>
          )}
          
          <Button
            onClick={handleConfirm}
            disabled={!selectedPlayer || submitting}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Starting...
              </>
            ) : (
              <>
                <Check className="w-4 h-4 mr-2" />
                Confirm & Analyze
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
