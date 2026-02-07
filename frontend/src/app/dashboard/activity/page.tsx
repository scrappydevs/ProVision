"use client";

import { useSessions } from "@/hooks/useSessions";
import { Activity, Loader2, Gamepad2 } from "lucide-react";
import Link from "next/link";

export default function ActivityPage() {
  const { data: sessions, isLoading } = useSessions();

  const recent = (sessions ?? []).slice(0, 10);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-light text-foreground">Activity</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Recent games and analysis sessions
        </p>
      </div>

      <div className="rounded-xl bg-card border border-border divide-y divide-border">
        {recent.length === 0 ? (
          <div className="p-8 text-center">
            <Activity className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No activity yet</p>
            <p className="text-xs text-muted-foreground mt-1">Upload a game to get started</p>
          </div>
        ) : (
          recent.map((session) => (
            <Link
              key={session.id}
              href={`/dashboard/games/${session.id}`}
              className="flex items-center gap-3 p-4 hover:bg-muted/50 transition-colors"
            >
              <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                <Gamepad2 className="w-4 h-4 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground truncate">{session.name}</p>
                <p className="text-[10px] text-muted-foreground">
                  {new Date(session.created_at).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                  {" · "}
                  <span className={session.status === "ready" ? "text-green-500" : session.status === "failed" ? "text-destructive" : ""}>
                    {session.status}
                  </span>
                </p>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
