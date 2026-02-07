"use client";

import { createContext, useContext, useState, useCallback, useRef, ReactNode } from "react";

export interface ChatMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
}

export interface AIChatContextData {
  /** Player currently being viewed (profile or game analysis) */
  playerId?: string;
  playerName?: string;
  playerNationality?: string;
  playerAvatar?: string;
  /** Current game session being viewed */
  sessionId?: string;
  sessionName?: string;
  /** Recordings for the current player */
  recordings?: Array<{
    id: string;
    title: string;
    type: string;
    session_id?: string;
    video_path?: string;
    thumbnail_path?: string;
    duration?: number;
  }>;
  /** Tips/insights available */
  tips?: Array<{ title: string; summary: string; kind: string }>;
  /** Stroke summary for current session */
  strokeSummary?: {
    total_strokes: number;
    forehand_count: number;
    backhand_count: number;
    average_form_score: number;
    best_form_score: number;
    consistency_score: number;
  };
}

interface AIChatState {
  isOpen: boolean;
  messages: ChatMessage[];
  isThinking: boolean;
  context: AIChatContextData;
}

interface AIChatActions {
  toggle: () => void;
  open: () => void;
  close: () => void;
  sendMessage: (text: string) => Promise<void>;
  setContext: (ctx: Partial<AIChatContextData>) => void;
  clearContext: () => void;
  clearMessages: () => void;
}

type AIChatContextType = AIChatState & AIChatActions;

const AIChatCtx = createContext<AIChatContextType | null>(null);

export function useAIChat() {
  const ctx = useContext(AIChatCtx);
  if (!ctx) throw new Error("useAIChat must be used within AIChatProvider");
  return ctx;
}

const WELCOME_MESSAGE: ChatMessage = {
  role: "assistant",
  content:
    "Ask me anything — technique breakdowns, training plans, match observations, or strategy tips.",
};

export function AIChatProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);
  const [isThinking, setIsThinking] = useState(false);
  const [context, setContextState] = useState<AIChatContextData>({});
  const prevContextKey = useRef("");

  const toggle = useCallback(() => setIsOpen((o) => !o), []);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  const setContext = useCallback((ctx: Partial<AIChatContextData>) => {
    setContextState((prev) => {
      const next = { ...prev, ...ctx };
      // If the player or session changed, reset messages
      const key = `${next.playerId ?? ""}:${next.sessionId ?? ""}`;
      if (key !== prevContextKey.current) {
        prevContextKey.current = key;
        setMessages([WELCOME_MESSAGE]);
      }
      return next;
    });
  }, []);

  const clearContext = useCallback(() => {
    setContextState({});
    prevContextKey.current = "";
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([WELCOME_MESSAGE]);
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isThinking) return;

      const userMsg: ChatMessage = { role: "user", content: text.trim() };
      setMessages((m) => [...m, userMsg]);
      setIsThinking(true);

      try {
        // Dynamic import to avoid circular deps
        const { aiChat } = await import("@/lib/api");

        const history = messages
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({ role: m.role, content: m.content }));

        const response = await aiChat({
          message: text.trim(),
          session_id: context.sessionId || "",
          player_id: context.playerId,
          player_name: context.playerName,
          context_summary: buildContextSummary(context),
          history,
        });

        const newMessages: ChatMessage[] = [];

        if (response.data.tool_calls?.length) {
          for (const tc of response.data.tool_calls) {
            newMessages.push({
              role: "tool",
              toolName: tc.name,
              content:
                tc.result.slice(0, 80) +
                (tc.result.length > 80 ? "..." : ""),
            });
          }
        }

        newMessages.push({ role: "assistant", content: response.data.response });
        setMessages((m) => [...m, ...newMessages]);
      } catch {
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            content:
              "Sorry, I couldn't process that. Make sure the backend is running.",
          },
        ]);
      }

      setIsThinking(false);
    },
    [isThinking, messages, context]
  );

  return (
    <AIChatCtx.Provider
      value={{
        isOpen,
        messages,
        isThinking,
        context,
        toggle,
        open,
        close,
        sendMessage,
        setContext,
        clearContext,
        clearMessages,
      }}
    >
      {children}
    </AIChatCtx.Provider>
  );
}

/** Build a short text summary of the current context to inject into the system prompt */
function buildContextSummary(ctx: AIChatContextData): string {
  const parts: string[] = [];

  if (ctx.playerName) {
    parts.push(`Player: ${ctx.playerName}`);
  }
  if (ctx.sessionName) {
    parts.push(`Game: ${ctx.sessionName}`);
  }
  if (ctx.recordings?.length) {
    parts.push(
      `Recordings (${ctx.recordings.length}): ${ctx.recordings
        .slice(0, 5)
        .map((r) => `${r.title} [${r.type}]`)
        .join(", ")}`
    );
  }
  if (ctx.tips?.length) {
    parts.push(
      `Coaching tips:\n${ctx.tips
        .map((t) => `- [${t.kind}] ${t.title}: ${t.summary}`)
        .join("\n")}`
    );
  }
  if (ctx.strokeSummary) {
    const s = ctx.strokeSummary;
    parts.push(
      `Stroke analysis: ${s.total_strokes} total (${s.forehand_count} FH, ${s.backhand_count} BH). ` +
        `Avg form: ${s.average_form_score?.toFixed(1)}, Best: ${s.best_form_score?.toFixed(1)}, Consistency: ${s.consistency_score?.toFixed(1)}`
    );
  }

  return parts.join("\n");
}
