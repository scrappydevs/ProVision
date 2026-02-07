"use client";

import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { LogOut, User, Sparkles } from "lucide-react";
import { useAIChat } from "@/contexts/AIChatContext";
import { cn } from "@/lib/utils";

export function Header() {
  const { user, signOut } = useAuth();
  const { isOpen: aiOpen, toggle: toggleAI } = useAIChat();

  return (
    <header className="h-16 border-b border-border bg-background fixed top-0 left-0 right-0 z-40">
      <div className="h-full flex items-center">
        {/* Left: Logo centered within sidebar-width column (w-14 = 56px) + title */}
        <div className="flex items-center shrink-0">
          <div className="w-14 flex justify-center shrink-0">
            <img src="/logo.png" alt="PROVISION" className="w-10 h-10 dark:invert" />
          </div>
          <span className="text-lg font-bold tracking-wide text-foreground">PROVISION</span>
        </div>

        {/* Spacer */}
        <div className="flex-1 min-w-0" />

        {/* Right: User controls — fixed layout to prevent shifting */}
        <div className="flex items-center gap-4 pr-6 shrink-0">
          {user && (
            <div className="flex items-center gap-3">
              {/* AI Chat toggle */}
              <button
                onClick={toggleAI}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all",
                  aiOpen
                    ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
                title="Toggle Insights"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Insights</span>
              </button>

              <div className="w-px h-6 bg-border" />

              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                  {user.user_metadata?.avatar_url ? (
                    <img
                      src={user.user_metadata.avatar_url}
                      alt=""
                      className="w-8 h-8 rounded-full"
                    />
                  ) : (
                    <User className="w-4 h-4 text-primary" />
                  )}
                </div>
                <span className="text-sm text-muted-foreground hidden sm:block">
                  {user.email}
                </span>
              </div>
              <Button variant="ghost" size="icon" onClick={signOut}>
                <LogOut className="w-4 h-4 text-muted-foreground" />
              </Button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
