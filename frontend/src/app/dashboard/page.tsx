"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Plus, Users, Loader2, Trash2, Search, Globe, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { PlayerCard } from "@/components/players/PlayerCard";
import { PlayerForm } from "@/components/players/PlayerForm";
import {
  usePlayers,
  useCreatePlayer,
  useDeletePlayer,
  useUploadAvatar,
  useSearchITTF,
  useSyncITTF,
} from "@/hooks/usePlayers";
import { PlayerCreate, ITTFSearchResult } from "@/lib/api";

export default function DashboardPage() {
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(false);
  const [ittfSearch, setIttfSearch] = useState("");
  const [ittfSearchOpen, setIttfSearchOpen] = useState(false);
  const { data: players, isLoading } = usePlayers();
  const createMutation = useCreatePlayer();
  const deleteMutation = useDeletePlayer();
  const uploadAvatarMutation = useUploadAvatar();
  const syncITTFMutation = useSyncITTF();
  const { data: ittfResults, isLoading: ittfLoading } = useSearchITTF(
    ittfSearchOpen ? ittfSearch : ""
  );

  const handleCreatePlayer = async (data: PlayerCreate, avatarFile?: File) => {
    const player = await createMutation.mutateAsync(data);
    if (avatarFile && player.id) {
      await uploadAvatarMutation.mutateAsync({
        playerId: player.id,
        file: avatarFile,
      });
    }
    setFormOpen(false);
  };

  const handleAddFromITTF = async (result: ITTFSearchResult) => {
    const player = await createMutation.mutateAsync({
      name: result.name || "Unknown Player",
      ittf_id: result.ittf_id,
    });
    if (player.id && result.ittf_id) {
      syncITTFMutation.mutate(player.id);
    }
    setIttfSearchOpen(false);
    setIttfSearch("");
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-light text-foreground">Your Roster</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setIttfSearchOpen(!ittfSearchOpen)}
            className="gap-2"
          >
            <Globe className="w-4 h-4" />
            ITTF Search
          </Button>
          <Button onClick={() => setFormOpen(true)} className="gap-2">
            <Plus className="w-4 h-4" />
            Add Player
          </Button>
        </div>
      </div>

      {/* ITTF Player Search Panel */}
      <AnimatePresence>
        {ittfSearchOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden mb-6"
          >
            <div className="bg-card rounded-xl border border-border p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Globe className="w-4 h-4 text-primary" />
                  <span className="text-sm font-medium text-foreground">Search ITTF Players</span>
                </div>
                <button onClick={() => { setIttfSearchOpen(false); setIttfSearch(""); }}>
                  <X className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                </button>
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  value={ittfSearch}
                  onChange={(e) => setIttfSearch(e.target.value)}
                  placeholder="Search by player name (e.g., Fan Zhendong)..."
                  className="w-full pl-10 pr-4 py-2.5 bg-background rounded-lg text-foreground placeholder-muted-foreground text-sm focus:outline-none focus:ring-1 focus:ring-[#9B7B5B]/50"
                />
              </div>
              {ittfLoading && ittfSearch.length >= 2 && (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="w-4 h-4 text-primary animate-spin" />
                  <span className="ml-2 text-xs text-muted-foreground">Searching ITTF database...</span>
                </div>
              )}
              {ittfResults && ittfResults.results.length > 0 && (
                <div className="mt-3 space-y-2 max-h-64 overflow-y-auto">
                  {ittfResults.results.map((result, i) => (
                    <div
                      key={result.ittf_id ?? i}
                      className="flex items-center justify-between p-3 rounded-lg bg-background hover:bg-muted transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-[#9B7B5B]/10 flex items-center justify-center">
                          <Globe className="w-4 h-4 text-primary/60" />
                        </div>
                        <div>
                          <p className="text-sm text-foreground">{result.name || "Unknown"}</p>
                          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                            {result.nationality && <span>{result.nationality}</span>}
                            {result.ranking && <span>Rank #{result.ranking}</span>}
                            {result.ittf_id && <span>ID: {result.ittf_id}</span>}
                          </div>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => handleAddFromITTF(result)}
                        disabled={createMutation.isPending}
                        className="text-xs"
                      >
                        {createMutation.isPending ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          "Add to Roster"
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              {ittfResults && ittfResults.results.length === 0 && ittfSearch.length >= 2 && !ittfLoading && (
                <p className="text-xs text-muted-foreground text-center py-4">
                  No ITTF players found for &quot;{ittfSearch}&quot;
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      ) : players && players.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4 auto-rows-fr">
          {players.map((player, i) => (
            <motion.div
              key={player.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="relative group/card"
            >
              <PlayerCard
                player={player}
                onClick={() => router.push(`/dashboard/players/${player.id}`)}
              />
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-3 left-3 opacity-0 group-hover/card:opacity-100 transition-opacity h-7 w-7 rounded-full bg-black/40 backdrop-blur-sm text-muted-foreground hover:text-destructive hover:bg-destructive/20"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteMutation.mutate(player.id);
                }}
                disabled={deleteMutation.isPending}
              >
                <Trash2 className="w-3 h-3" />
              </Button>
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-24">
          <div className="w-20 h-20 rounded-2xl bg-card flex items-center justify-center mb-6">
            <Users className="w-10 h-10 text-primary/60" />
          </div>
          <h3 className="text-xl font-light text-foreground mb-2">
            Build your roster
          </h3>
          <p className="text-sm text-muted-foreground mb-6 text-center max-w-sm">
            Add players to start uploading game footage, tracking performance, and generating analytics.
          </p>
          <Button onClick={() => setFormOpen(true)} className="gap-2 h-11 px-6">
            <Plus className="w-4 h-4" />
            Add First Player
          </Button>
        </div>
      )}

      <AnimatePresence>
        {formOpen && (
          <PlayerForm
            onSubmit={handleCreatePlayer}
            onClose={() => setFormOpen(false)}
            isPending={createMutation.isPending || uploadAvatarMutation.isPending}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
