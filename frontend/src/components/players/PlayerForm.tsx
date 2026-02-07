"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, X, Upload } from "lucide-react";
import { motion } from "framer-motion";
import { PlayerCreate } from "@/lib/api";

interface PlayerFormProps {
  onSubmit: (data: PlayerCreate, avatarFile?: File) => void;
  onClose: () => void;
  isPending: boolean;
  initialData?: Partial<PlayerCreate>;
  title?: string;
}

export function PlayerForm({
  onSubmit,
  onClose,
  isPending,
  initialData,
  title = "Add Player",
}: PlayerFormProps) {
  const [name, setName] = useState(initialData?.name ?? "");
  const [position, setPosition] = useState(initialData?.position ?? "");
  const [team, setTeam] = useState(initialData?.team ?? "");
  const [notes, setNotes] = useState(initialData?.notes ?? "");
  const [description, setDescription] = useState(initialData?.description ?? "");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>("/player1.png");

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setAvatarFile(file);
      const reader = new FileReader();
      reader.onloadend = () => setAvatarPreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = () => {
    if (!name.trim()) return;
    onSubmit(
      {
        name: name.trim(),
        position: position.trim() || undefined,
        team: team.trim() || undefined,
        notes: notes.trim() || undefined,
        description: description.trim() || undefined,
      },
      avatarFile ?? undefined
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-card rounded-xl border border-border w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-light text-foreground">{title}</h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="space-y-4">
          {/* Avatar upload */}
          <div className="flex items-center gap-4">
            <label className="cursor-pointer">
              <div className="w-16 h-16 rounded-full bg-muted border-2 border-dashed border-border hover:border-primary/50 flex items-center justify-center overflow-hidden transition-colors">
                {avatarPreview ? (
                  <img
                    src={avatarPreview}
                    alt="Preview"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <Upload className="w-5 h-5 text-muted-foreground" />
                )}
              </div>
              <input
                type="file"
                accept="image/*"
                onChange={handleAvatarChange}
                className="hidden"
              />
            </label>
            <div>
              <p className="text-sm text-foreground">Player Photo</p>
              <p className="text-xs text-muted-foreground">Optional</p>
            </div>
          </div>

          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., John Smith"
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary"
            />
          </div>

          {/* Position */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Position
            </label>
            <input
              type="text"
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              placeholder="e.g., Forward, Goalkeeper, etc."
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary"
            />
          </div>

          {/* Team */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Team
            </label>
            <input
              type="text"
              value={team}
              onChange={(e) => setTeam(e.target.value)}
              placeholder="e.g., Team Alpha"
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes about the player..."
              rows={2}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary resize-none"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Player Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Two short paragraphs covering strengths, weaknesses, and playing style..."
              rows={4}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary resize-none"
            />
          </div>
        </div>

        <div className="flex items-center gap-3 mt-6">
          <Button variant="outline" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="flex-1"
            onClick={handleSubmit}
            disabled={!name.trim() || isPending}
          >
            {isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              title
            )}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}
