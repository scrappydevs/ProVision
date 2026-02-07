"use client";

import { useState, useEffect } from "react";
import { Loader2, Check, X, RefreshCw } from "lucide-react";
import {
  api,
  getPlayerPreview,
  selectPlayer,
  analyzePose,
  DetectedPlayer,
  PlayerPreviewResponse,
} from "@/lib/api";
import { cn } from "@/lib/utils";

// Shared state store (module-level for simplicity)
const playerSelectionStore = new Map<string, {
  previewData: PlayerPreviewResponse | null;
  selectedPlayers: { player: DetectedPlayer; role: "player" | "opponent" }[];
  listeners: Set<() => void>;
}>();

function usePlayerSelectionStore(sessionId: string) {
  const [, forceUpdate] = useState({});
  
  useEffect(() => {
    if (!playerSelectionStore.has(sessionId)) {
      playerSelectionStore.set(sessionId, {
        previewData: null,
        selectedPlayers: [],
        listeners: new Set(),
      });
    }
    
    const store = playerSelectionStore.get(sessionId)!;
    const listener = () => forceUpdate({});
    store.listeners.add(listener);
    
    return () => {
      store.listeners.delete(listener);
    };
  }, [sessionId]);
  
  const store = playerSelectionStore.get(sessionId);
  if (!store) return { previewData: null, selectedPlayers: [], setSelectedPlayers: () => {}, setPreviewData: () => {} };
  
  return {
    previewData: store.previewData,
    selectedPlayers: store.selectedPlayers,
    setSelectedPlayers: (updater: React.SetStateAction<{ player: DetectedPlayer; role: "player" | "opponent" }[]>) => {
      const newValue = typeof updater === 'function' ? updater(store.selectedPlayers) : updater;
      store.selectedPlayers = newValue;
      store.listeners.forEach(l => l());
    },
    setPreviewData: (data: PlayerPreviewResponse | null) => {
      store.previewData = data;
      store.listeners.forEach(l => l());
    },
  };
}

interface PlayerSelectionProps {
  sessionId: string;
  isOpen?: boolean;
  onClose?: () => void;
  onAnalysisStarted: () => void;
  variant?: "modal" | "inline";
  className?: string;
  // For video overlay mode
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  videoViewportRef?: React.RefObject<HTMLDivElement | null>;
}

export function PlayerSelection({
  sessionId,
  isOpen = false,
  onClose,
  onAnalysisStarted,
  variant = "modal",
  className,
  videoRef,
  videoViewportRef,
}: PlayerSelectionProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const isModal = variant === "modal";
  const isVideoOverlay = !isModal && videoRef && videoViewportRef;
  
  const { previewData, selectedPlayers, setSelectedPlayers, setPreviewData } = usePlayerSelectionStore(sessionId);
  const hasMultiplePlayers = (previewData?.players.length ?? 0) > 1;
  const selectedPlayer = selectedPlayers.find((p) => p.role === "player");
  const selectedOpponent = selectedPlayers.find((p) => p.role === "opponent");
  // Opponent is always optional — show the step but don't block confirm
  const currentStep: "player" | "opponent" | "done" =
    selectedPlayer ? (hasMultiplePlayers ? (selectedOpponent ? "done" : "opponent") : "done") : "player";
  const hoverAccentClass =
    currentStep === "opponent"
      ? "hover:border-[#5B9B7B]/70 hover:bg-[#5B9B7B]/10"
      : currentStep === "player"
        ? "hover:border-[#9B7B5B]/70 hover:bg-[#9B7B5B]/10"
        : "hover:border-[#4A4849] hover:bg-[#2A292B]";
  const groupHoverAccentClass =
    currentStep === "opponent"
      ? "group-hover:border-[#5B9B7B] group-hover:bg-[#5B9B7B]/10"
      : currentStep === "player"
        ? "group-hover:border-[#9B7B5B] group-hover:bg-[#9B7B5B]/10"
        : "group-hover:border-[#E8E6E3]/40 group-hover:bg-[#2A292B]";

  const loadPreview = async () => {
    setLoading(true);
    setError(null);
    setSelectedPlayers([]);
    try {
      console.log("[PlayerSelection] Loading preview for session:", sessionId);
      const response = await getPlayerPreview(sessionId);
      console.log("[PlayerSelection] Preview loaded:", response.data);
      setPreviewData(response.data);
    } catch (err: any) {
      console.error("[PlayerSelection] Error loading preview:", err);
      // Distinguish connection failures from server errors
      const isNetworkError = err?.message === "Network Error" || err?.code === "ERR_NETWORK" || err?.code === "ECONNREFUSED";
      const errorMessage = isNetworkError
        ? "Backend unavailable — is the server running?"
        : (err?.response?.data?.detail || err?.message || "Failed to load player preview");
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  // Load preview when dialog opens or in video overlay mode
  // Don't auto-retry after a failure — let the user click Retry manually
  useEffect(() => {
    const shouldLoad = isModal ? isOpen : true;
    if (shouldLoad && !previewData && !loading && !error) {
      loadPreview();
    }
  }, [isOpen, isModal, previewData, loading, error]);

  // Reset state when dialog closes
  useEffect(() => {
    if (isModal && !isOpen) {
      setPreviewData(null);
      setSelectedPlayers([]);
      setError(null);
    }
  }, [isOpen, isModal]);

  const handleSelectForStep = (playerIdx: number) => {
    if (!previewData) return;
    setSelectedPlayers((prev) => {
      const selected = previewData.players.find((p) => p.player_idx === playerIdx);
      if (!selected) return prev;
      const currentPlayer = prev.find((p) => p.role === "player");
      const currentOpponent = prev.find((p) => p.role === "opponent");

      if (currentStep === "player") {
        const nextOpponent = currentOpponent && currentOpponent.player.player_idx !== playerIdx
          ? currentOpponent
          : undefined;
        return [
          { player: selected, role: "player" as const },
          ...(nextOpponent ? [nextOpponent] : []),
        ];
      }

      if (currentStep === "opponent") {
        if (currentPlayer?.player.player_idx === playerIdx) return prev;
        return [
          ...(currentPlayer ? [currentPlayer] : []),
          { player: selected, role: "opponent" as const },
        ];
      }

      return prev;
    });
  };

  const handleClearRole = (role: "player" | "opponent") => {
    setSelectedPlayers((prev) => prev.filter((p) => p.role !== role));
  };

  const handleConfirm = async () => {
    if (!selectedPlayer) return;

    setSubmitting(true);
    try {
      // Save all selected players (player + opponent if both selected)
      const playersToSend = [selectedPlayer, selectedOpponent].filter(Boolean);
      
      if (playersToSend.length > 1) {
        // Use new multi-player endpoint
        await api.post(`/api/pose/select-players/${sessionId}`, {
          players: playersToSend.map(sp => ({
            player_idx: sp!.player.player_idx,
            bbox: sp!.player.bbox,
            center: sp!.player.center,
            confidence: sp!.player.confidence,
          }))
        });
      } else {
        // Legacy single player endpoint
        await selectPlayer(sessionId, selectedPlayer.player);
      }

      // Start pose analysis
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

  const handleSkipSelection = async () => {
    setSubmitting(true);
    try {
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

  // Right panel selection UI (always render this when in video overlay mode)
  if (isVideoOverlay) {
    return (
      <div className={cn("flex flex-col gap-4", className)}>
        {loading && (
          <div className="flex items-center justify-center py-8">
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-[#9B7B5B]" />
              <p className="text-xs text-[#8A8885]">Detecting players...</p>
            </div>
          </div>
        )}

        {error && !loading && (
          <div className="flex flex-col items-center gap-3 text-center py-4">
            <X className="w-5 h-5 text-[#C45C5C]" />
            <p className="text-xs text-[#C45C5C]">{error}</p>
            <button
              onClick={loadPreview}
              className="text-xs text-[#9B7B5B] hover:text-[#B8956D] transition-colors flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" />
              Retry
            </button>
          </div>
        )}

        {previewData && !loading && (
          <>
            <div className="space-y-3">
              {/* Step Header */}
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-[10px] text-[#8A8885] uppercase tracking-wider">
                    {currentStep === "player" ? "Step 1" : currentStep === "opponent" ? "Step 2 (optional)" : "Ready"}
                  </p>
                  <p className="text-xs text-[#E8E6E3] font-medium">
                    {currentStep === "player" && "Click a box to set the Player"}
                    {currentStep === "opponent" && "Pick an opponent or confirm to continue"}
                    {currentStep === "done" && "All set. Click Confirm to proceed."}
                  </p>
                </div>
                {selectedPlayer && currentStep !== "player" && (
                  <button
                    onClick={() => handleClearRole("player")}
                    className="text-[10px] text-[#8A8885] hover:text-[#E8E6E3] transition-colors"
                  >
                    Change Player
                  </button>
                )}
                {selectedOpponent && currentStep === "done" && (
                  <button
                    onClick={() => handleClearRole("opponent")}
                    className="text-[10px] text-[#8A8885] hover:text-[#E8E6E3] transition-colors"
                  >
                    Change Opponent
                  </button>
                )}
              </div>

              {/* Current Selection */}
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-[#363436] bg-[#1E1D1F] px-2.5 py-2">
                  <p className="text-[10px] text-[#8A8885] uppercase tracking-wider">Player</p>
                  <p className="text-xs text-[#E8E6E3] mt-1">
                    {selectedPlayer ? `Detected #${selectedPlayer.player.player_idx + 1}` : "Not selected"}
                  </p>
                </div>
                <div className="rounded-lg border border-[#363436] bg-[#1E1D1F] px-2.5 py-2">
                  <p className="text-[10px] text-[#8A8885] uppercase tracking-wider">Opponent</p>
                  <p className="text-xs text-[#E8E6E3] mt-1">
                    {selectedOpponent ? `Detected #${selectedOpponent.player.player_idx + 1}` : "Optional"}
                  </p>
                </div>
              </div>

              {/* Player Cards - Click once per step */}
              <div className="space-y-2">
                  <p className="text-[10px] text-[#8A8885] uppercase tracking-wider">
                    Click a box on the video to choose
                  </p>
                {previewData.players.map((player) => {
                  const selection = selectedPlayers.find((p) => p.player.player_idx === player.player_idx);
                  const isSelected = !!selection;
                  const role = selection?.role;

                  return (
                    <button
                      key={player.player_idx}
                      onClick={() => handleSelectForStep(player.player_idx)}
                      className={cn(
                        "w-full px-3 py-2 rounded-lg border transition-all text-left",
                        role === "player"
                          ? "border-[#9B7B5B] bg-[#9B7B5B]/10"
                          : role === "opponent"
                            ? "border-[#5B9B7B] bg-[#5B9B7B]/10"
                            : cn("border-[#363436] bg-[#282729]", hoverAccentClass)
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[#E8E6E3]">
                          Detected #{player.player_idx + 1}
                        </span>
                      </div>
                      {role && (
                        <div
                          className={cn(
                            "text-[10px] mt-1 font-semibold",
                            role === "player" ? "text-[#9B7B5B]" : "text-[#5B9B7B]"
                          )}
                        >
                          {role === "player" ? "Player" : "Opponent"}
                        </div>
                      )}
                      <div className="text-[10px] text-[#8A8885] mt-1">
                        {(player.confidence * 100).toFixed(0)}% confidence
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end pt-2 border-t border-[#363436]/30">
              <button
                onClick={handleConfirm}
                disabled={!selectedPlayer || submitting}
                className="text-xs px-4 py-2 rounded-lg bg-[#9B7B5B] hover:bg-[#8A6B4B] text-[#1E1D1F] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
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
          </>
        )}
      </div>
    );
  }

  // Legacy modal/inline mode (fallback)
  return null;
}

// Separate component for rendering overlays in video container
export function PlayerSelectionOverlays({
  videoRef,
  videoViewportRef,
  sessionId,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  videoViewportRef: React.RefObject<HTMLDivElement | null>;
  sessionId: string;
}) {
  const { previewData, selectedPlayers, setSelectedPlayers } = usePlayerSelectionStore(sessionId);
  const hasMultiplePlayers = (previewData?.players.length ?? 0) > 1;
  const selectedPlayer = selectedPlayers.find((p) => p.role === "player");
  const selectedOpponent = selectedPlayers.find((p) => p.role === "opponent");
  const currentStep: "player" | "opponent" | "done" =
    selectedPlayer ? (hasMultiplePlayers ? (selectedOpponent ? "done" : "opponent") : "done") : "player";
  const groupHoverAccentClass =
    currentStep === "opponent"
      ? "group-hover:border-[#5B9B7B] group-hover:bg-[#5B9B7B]/10"
      : currentStep === "player"
        ? "group-hover:border-[#9B7B5B] group-hover:bg-[#9B7B5B]/10"
        : "group-hover:border-[#E8E6E3]/40 group-hover:bg-[#2A292B]";

  if (!previewData) return null;
  const video = videoRef.current;
  const viewport = videoViewportRef.current;
  if (!video || !viewport) return null;

  const containerRect = viewport.getBoundingClientRect();
  const videoWidth = previewData.video_info.width;
  const videoHeight = previewData.video_info.height;
  const containerAspect = containerRect.width / containerRect.height;
  const videoAspect = videoWidth / videoHeight;
  
  let displayWidth: number;
  let displayHeight: number;
  let offsetX: number;
  let offsetY: number;
  
  if (videoAspect > containerAspect) {
    displayWidth = containerRect.width;
    displayHeight = containerRect.width / videoAspect;
    offsetX = 0;
    offsetY = (containerRect.height - displayHeight) / 2;
  } else {
    displayHeight = containerRect.height;
    displayWidth = containerRect.height * videoAspect;
    offsetX = (containerRect.width - displayWidth) / 2;
    offsetY = 0;
  }
  
  const scaleX = displayWidth / videoWidth;
  const scaleY = displayHeight / videoHeight;

  return (
    <>
      {previewData.players.map((player) => {
        const selection = selectedPlayers.find((p) => p.player.player_idx === player.player_idx);
        const isSelected = !!selection;

        const left = offsetX + player.bbox.x * scaleX;
        const top = offsetY + player.bbox.y * scaleY;
        const width = player.bbox.width * scaleX;
        const height = player.bbox.height * scaleY;

        const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
          e.stopPropagation();
          if (!previewData) return;
          setSelectedPlayers((prev) => {
            const selected = previewData.players.find((p) => p.player_idx === player.player_idx);
            if (!selected) return prev;
            const currentPlayer = prev.find((p) => p.role === "player");
            const currentOpponent = prev.find((p) => p.role === "opponent");

            if (currentStep === "player") {
              const nextOpponent = currentOpponent && currentOpponent.player.player_idx !== player.player_idx
                ? currentOpponent
                : undefined;
              return [
                { player: selected, role: "player" as const },
                ...(nextOpponent ? [nextOpponent] : []),
              ];
            }

            if (currentStep === "opponent") {
              if (currentPlayer?.player.player_idx === player.player_idx) return prev;
              return [
                ...(currentPlayer ? [currentPlayer] : []),
                { player: selected, role: "opponent" as const },
              ];
            }

            return prev;
          });
        };

        return (
          <div
            key={player.player_idx}
            className="absolute cursor-pointer group"
            onClick={handleOverlayClick}
            style={{
              left: `${left}px`,
              top: `${top}px`,
              width: `${width}px`,
              height: `${height}px`,
              zIndex: 30,
            }}
          >
            <div
              className={cn(
                "absolute inset-0 rounded border-2 transition-all",
                isSelected
                  ? selection?.role === "player"
                    ? "border-[#9B7B5B] bg-[#9B7B5B]/10"
                    : "border-[#5B9B7B] bg-[#5B9B7B]/10"
                  : cn("border-[#E8E6E3]/30", groupHoverAccentClass)
              )}
            />
            {isSelected && (
              <div
                className={cn(
                  "absolute -top-7 left-0 px-2 py-1 rounded text-xs font-semibold whitespace-nowrap",
                  selection?.role === "player"
                    ? "bg-[#9B7B5B] text-[#1E1D1F]"
                    : "bg-[#5B9B7B] text-[#1E1D1F]"
                )}
              >
                {selection.role === "player" ? "Player" : "Opponent"}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
