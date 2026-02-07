"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Check, X, RefreshCw, Users } from "lucide-react";
import {
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

  const loadPreview = async () => {
    setLoading(true);
    setError(null);
    setSelectedPlayers([]);
    try {
      console.log("[PlayerSelection] Loading preview for session:", sessionId);
      const response = await getPlayerPreview(sessionId);
      console.log("[PlayerSelection] Preview loaded:", response.data);
      setPreviewData(response.data);

      // Auto-select up to 2 players
      if (response.data.players.length > 0) {
        const toSelect = response.data.players.slice(0, Math.min(2, response.data.players.length));
        setSelectedPlayers([
          { player: toSelect[0], role: "player" as const },
          ...(toSelect[1] ? [{ player: toSelect[1], role: "opponent" as const }] : []),
        ]);
      }
    } catch (err: any) {
      console.error("[PlayerSelection] Error loading preview:", err);
      const errorMessage = err?.response?.data?.detail || err?.message || "Failed to load player preview";
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  // Load preview when dialog opens or in video overlay mode
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

  const handleRoleChange = (playerIdx: number, role: "player" | "opponent") => {
    setSelectedPlayers((prev) => {
      const existing = prev.find((p) => p.player.player_idx === playerIdx);
      if (existing) {
        // Update role
        return prev.map((p) =>
          p.player.player_idx === playerIdx ? { ...p, role } : p
        );
      } else {
        // Add new selection
        const player = previewData?.players.find((p) => p.player_idx === playerIdx);
        if (!player) return prev;
        if (prev.length >= 2) {
          // Replace oldest
          return [...prev.slice(1), { player, role }];
        }
        return [...prev, { player, role }];
      }
    });
  };

  const handleRemovePlayer = (playerIdx: number) => {
    setSelectedPlayers((prev) => prev.filter((p) => p.player.player_idx !== playerIdx));
  };

  const handleConfirm = async () => {
    if (selectedPlayers.length === 0) return;

    setSubmitting(true);
    try {
      // Save primary player selection (first selected)
      await selectPlayer(sessionId, selectedPlayers[0].player);

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

  // Video overlay mode - render highlights on video (returned separately, not as main component)
  const renderVideoOverlays = () => {
    if (!isVideoOverlay || !previewData || loading) return null;
    const video = videoRef.current;
    const viewport = videoViewportRef.current;
    if (!video || !viewport) return null;

    // Calculate actual video display size (accounting for object-contain)
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
      // Video is wider - fit to width
      displayWidth = containerRect.width;
      displayHeight = containerRect.width / videoAspect;
      offsetX = 0;
      offsetY = (containerRect.height - displayHeight) / 2;
    } else {
      // Video is taller - fit to height
      displayHeight = containerRect.height;
      displayWidth = containerRect.height * videoAspect;
      offsetX = (containerRect.width - displayWidth) / 2;
      offsetY = 0;
    }
    
    const scaleX = displayWidth / videoWidth;
    const scaleY = displayHeight / videoHeight;

    return (
      <>
        {/* Player highlights on video */}
        {previewData.players.map((player) => {
          const selection = selectedPlayers.find((p) => p.player.player_idx === player.player_idx);
          const isSelected = !!selection;

          const left = offsetX + player.bbox.x * scaleX;
          const top = offsetY + player.bbox.y * scaleY;
          const width = player.bbox.width * scaleX;
          const height = player.bbox.height * scaleY;

          return (
            <div
              key={player.player_idx}
              className="absolute pointer-events-none"
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
                    : "border-[#E8E6E3]/30"
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
              {/* Role Selection Tabs */}
              <div className="flex items-center gap-2 p-1 bg-[#282729] rounded-lg border border-[#363436]">
                <button
                  onClick={() => {
                    const currentPlayer = selectedPlayers.find((p) => p.role === "player");
                    if (currentPlayer) {
                      // Already has player role selected, no action needed
                    }
                  }}
                  className={cn(
                    "flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                    selectedPlayers.some((p) => p.role === "player")
                      ? "bg-[#9B7B5B] text-[#1E1D1F]"
                      : "text-[#8A8885] hover:text-[#E8E6E3]"
                  )}
                >
                  Player
                </button>
                <button
                  onClick={() => {
                    const currentOpponent = selectedPlayers.find((p) => p.role === "opponent");
                    if (currentOpponent) {
                      // Already has opponent role selected, no action needed
                    }
                  }}
                  className={cn(
                    "flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                    selectedPlayers.some((p) => p.role === "opponent")
                      ? "bg-[#5B9B7B] text-[#1E1D1F]"
                      : "text-[#8A8885] hover:text-[#E8E6E3]"
                  )}
                >
                  Opponent
                </button>
              </div>

              {/* Player Cards - Click to assign role */}
              <div className="space-y-2">
                <p className="text-[10px] text-[#8A8885] uppercase tracking-wider">Click to assign role</p>
                {previewData.players.map((player) => {
                  const selection = selectedPlayers.find((p) => p.player.player_idx === player.player_idx);
                  const isSelected = !!selection;
                  const role = selection?.role;

                  return (
                    <div key={player.player_idx} className="flex items-center gap-2">
                      <button
                        onClick={() => handleRoleChange(player.player_idx, "player")}
                        className={cn(
                          "flex-1 px-3 py-2 rounded-lg border transition-all text-left",
                          role === "player"
                            ? "border-[#9B7B5B] bg-[#9B7B5B]/10"
                            : "border-[#363436] bg-[#282729] hover:border-[#9B7B5B]/50"
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-[#E8E6E3]">
                            Detected #{player.player_idx + 1}
                          </span>
                          {role === "player" && (
                            <span className="text-[10px] px-2 py-0.5 rounded bg-[#9B7B5B] text-[#1E1D1F] font-semibold">
                              Player
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-[#8A8885] mt-1">
                          {(player.confidence * 100).toFixed(0)}% confidence
                        </div>
                      </button>
                      <button
                        onClick={() => handleRoleChange(player.player_idx, "opponent")}
                        className={cn(
                          "flex-1 px-3 py-2 rounded-lg border transition-all text-left",
                          role === "opponent"
                            ? "border-[#5B9B7B] bg-[#5B9B7B]/10"
                            : "border-[#363436] bg-[#282729] hover:border-[#5B9B7B]/50"
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-[#E8E6E3]">
                            Detected #{player.player_idx + 1}
                          </span>
                          {role === "opponent" && (
                            <span className="text-[10px] px-2 py-0.5 rounded bg-[#5B9B7B] text-[#1E1D1F] font-semibold">
                              Opponent
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-[#8A8885] mt-1">
                          {(player.confidence * 100).toFixed(0)}% confidence
                        </div>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 pt-2 border-t border-[#363436]/30">
              {previewData.players.length > 0 && (
                <button
                  onClick={handleSkipSelection}
                  disabled={submitting}
                  className="text-xs text-[#8A8885] hover:text-[#E8E6E3] transition-colors disabled:opacity-50"
                >
                  Auto-detect
                </button>
              )}

              <button
                onClick={handleConfirm}
                disabled={selectedPlayers.length === 0 || submitting}
                className="ml-auto text-xs px-4 py-2 rounded-lg bg-[#9B7B5B] hover:bg-[#8A6B4B] text-[#1E1D1F] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
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
  const { previewData, selectedPlayers } = usePlayerSelectionStore(sessionId);

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

        return (
          <div
            key={player.player_idx}
            className="absolute pointer-events-none"
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
                  : "border-[#E8E6E3]/30"
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
