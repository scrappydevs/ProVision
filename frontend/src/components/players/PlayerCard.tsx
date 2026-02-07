"use client";

import { Player } from "@/lib/api";
import { Card, CardBody, CardFooter, Chip } from "@heroui/react";
import { Gamepad2 } from "lucide-react";

interface PlayerCardProps {
  player: Player;
  onClick: () => void;
}

export function PlayerCard({ player, onClick }: PlayerCardProps) {
  const initials = player.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const gameCount = player.game_count ?? 0;

  // Show handedness as the badge (e.g. "Right Handed")
  const badge = player.handedness
    ? `${player.handedness === "right" ? "Right" : "Left"} Handed`
    : null;

  return (
    <Card
      isPressable
      isHoverable
      isBlurred
      className="bg-content1/60 dark:bg-content1/60 overflow-hidden"
      onPress={onClick}
    >
      {/* Full-bleed avatar / initials background */}
      <div className="relative w-full aspect-[4/5] overflow-hidden">
        {player.avatar_url ? (
          <>
            <img
              src={player.avatar_url}
              alt={player.name}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-background via-background/30 to-transparent" />
          </>
        ) : (
          <>
            <div className="absolute inset-0 bg-gradient-to-b from-content2 to-content1" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_35%,rgba(155,123,91,0.1),transparent_60%)]" />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-3xl font-light text-primary/30 select-none">
                {initials}
              </span>
            </div>
            <div className="absolute inset-0 bg-gradient-to-t from-content1 via-transparent to-transparent" />
          </>
        )}

        {/* Style / grip badge */}
        {badge && (
          <Chip
            size="sm"
            variant="flat"
            className="absolute top-2.5 right-2.5 bg-black/40 backdrop-blur-sm text-primary uppercase text-[9px]"
          >
            {badge}
          </Chip>
        )}

        {/* Active indicator */}
        <div className="absolute top-2.5 left-2.5">
          <span
            className={`w-2 h-2 rounded-full block ${
              player.is_active ? "bg-success shadow-[0_0_4px_rgba(107,142,107,0.5)]" : "bg-foreground/30"
            }`}
          />
        </div>
      </div>

      {/* Info overlaid at bottom */}
      <CardBody className="px-3 pb-3 pt-0 -mt-6 relative z-10">
        <h3 className="text-xs font-medium text-foreground truncate">
          {player.name}
        </h3>
        <div className="flex items-center justify-between mt-0.5">
          {player.team ? (
            <p className="text-[10px] text-foreground/40 truncate">{player.team}</p>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-0.5 shrink-0">
            <Gamepad2 className="w-2.5 h-2.5 text-foreground/40" />
            <span className="text-[10px] text-foreground/60">{gameCount}</span>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
