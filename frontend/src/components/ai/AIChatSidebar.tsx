"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useAIChat } from "@/contexts/AIChatContext";
import { useRouter } from "next/navigation";
import {
  Send,
  Loader2,
  Gamepad2,
  ChevronRight,
  Play,
  ArrowUpRight,
  MessageCircle,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

/* ── Country name → ISO 3166-1 alpha-2 mapping (common TT nations) ── */
const COUNTRY_CODES: Record<string, string> = {
  china: "CN",
  japan: "JP",
  "south korea": "KR",
  korea: "KR",
  "korea republic": "KR",
  germany: "DE",
  sweden: "SE",
  france: "FR",
  brazil: "BR",
  "chinese taipei": "TW",
  taiwan: "TW",
  "hong kong": "HK",
  singapore: "SG",
  india: "IN",
  egypt: "EG",
  nigeria: "NG",
  portugal: "PT",
  romania: "RO",
  austria: "AT",
  england: "GB",
  "united states": "US",
  usa: "US",
  canada: "CA",
  australia: "AU",
  denmark: "DK",
  croatia: "HR",
  slovenia: "SI",
  serbia: "RS",
  poland: "PL",
  "czech republic": "CZ",
  czechia: "CZ",
  hungary: "HU",
  belgium: "BE",
  luxembourg: "LU",
  spain: "ES",
  italy: "IT",
  netherlands: "NL",
  iran: "IR",
  thailand: "TH",
  vietnam: "VN",
  indonesia: "ID",
  malaysia: "MY",
  philippines: "PH",
  "puerto rico": "PR",
};

/** Convert ISO alpha-2 code to flag emoji */
function countryFlag(code: string) {
  return code
    .toUpperCase()
    .split("")
    .map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65))
    .join("");
}

/** Resolve a nationality string to a flag emoji (or null) */
function flagForNationality(nationality?: string): string | null {
  if (!nationality) return null;
  const key = nationality.toLowerCase().trim();
  const code = COUNTRY_CODES[key];
  if (code) return countryFlag(code);
  // If it's already a 2-letter code
  if (/^[A-Za-z]{2}$/.test(key)) return countryFlag(key.toUpperCase());
  return null;
}

/** Format duration in seconds to m:ss */
function fmtDuration(seconds?: number) {
  if (!seconds) return null;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/* ── Tool name → human-readable label ── */
const TOOL_LABELS: Record<string, string> = {
  get_player_profile: "Looking up player profile",
  search_players: "Searching roster",
  get_player_recordings: "Fetching recordings",
  get_session_details: "Loading session details",
  get_session_strokes: "Analyzing strokes",
  get_session_pose_analysis: "Reading pose data",
  compare_strokes_across_sessions: "Comparing sessions",
  get_stroke_detail: "Inspecting stroke",
  get_player_tournament_history: "Checking tournament history",
  get_tournament_details: "Loading tournament",
  get_session_analytics: "Crunching analytics",
  compare_players: "Comparing players",
  get_recording_context: "Loading recording",
};

/* ── Action parsing from AI response ── */
type ParsedAction = {
  type: "NAVIGATE" | "ASK";
  value: string;
  label: string;
};

type ParsedSegment =
  | { kind: "text"; content: string }
  | { kind: "action"; action: ParsedAction };

const ACTION_REGEX = /\[\[ACTION:(NAVIGATE|ASK):([^|]+)\|([^\]]+)\]\]/g;

/** Split a message into text segments and action blocks */
function parseMessageContent(content: string): ParsedSegment[] {
  const segments: ParsedSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  // Reset regex state
  ACTION_REGEX.lastIndex = 0;

  while ((match = ACTION_REGEX.exec(content)) !== null) {
    // Text before this action
    if (match.index > lastIndex) {
      segments.push({ kind: "text", content: content.slice(lastIndex, match.index) });
    }
    segments.push({
      kind: "action",
      action: {
        type: match[1] as "NAVIGATE" | "ASK",
        value: match[2].trim(),
        label: match[3].trim(),
      },
    });
    lastIndex = match.index + match[0].length;
  }

  // Remaining text
  if (lastIndex < content.length) {
    segments.push({ kind: "text", content: content.slice(lastIndex) });
  }

  return segments;
}

/** Render inline markdown: **bold**, `code`, and plain text */
function renderInline(text: string, isUser: boolean) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className={isUser ? "font-semibold" : "text-primary font-medium"}>
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={i} className="px-1 py-0.5 rounded bg-foreground/10 text-[12px] font-mono">
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

export function AIChatSidebar() {
  const {
    isOpen,
    close,
    messages,
    isThinking,
    sendMessage,
    context,
    clearMessages,
  } = useAIChat();

  const router = useRouter();
  const [input, setInput] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [isOpen]);

  const handleClose = () => {
    clearMessages();
    close();
  };

  const handleSend = async () => {
    if (!input.trim() || isThinking) return;
    const text = input;
    setInput("");
    await sendMessage(text);
  };

  const flag = useMemo(() => flagForNationality(context.playerNationality), [context.playerNationality]);

  // Get match recordings for player context preview (with video)
  const matchRecordings = useMemo(
    () =>
      (context.recordings ?? []).filter(
        (r) => r.type === "match" || r.session_id
      ),
    [context.recordings]
  );

  const hasConversation = messages.length > 1;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.aside
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 380, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration: 0.3, ease: [0.17, 0.67, 0.27, 1] }}
          className="h-[calc(100vh-4rem)] sticky top-16 shrink-0 overflow-hidden z-30 border-l border-border"
        >
          {/* Close notch — left edge */}
          <button
            onClick={handleClose}
            className="absolute left-0 top-1/2 -translate-y-1/2 z-40 w-1.5 h-12 rounded-r-full bg-foreground/10 hover:bg-foreground/25 hover:w-2 transition-all cursor-pointer"
            title="Close"
          />

          <div className="w-[380px] h-full flex flex-col bg-background">
            {/* ── Player header ── */}
            {context.playerName && (
              <div className="px-5 pt-5 pb-3 shrink-0 border-b border-border/40">
                <div className="flex items-center gap-3">
                  {context.playerAvatar && (
                    <img
                      src={context.playerAvatar}
                      alt={context.playerName}
                      className="w-10 h-10 rounded-full object-cover ring-2 ring-primary/20"
                    />
                  )}
                  <div className="min-w-0">
                    <h2 className="text-lg font-bold text-foreground truncate leading-tight">
                      {context.playerName}
                    </h2>
                    {context.playerNationality && (
                      <p className="text-[12px] text-muted-foreground flex items-center gap-1.5 mt-0.5">
                        {flag && <span className="text-sm">{flag}</span>}
                        <span>{context.playerNationality}</span>
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ── Session chip (when in a game, not a player) ── */}
            {!context.playerName && context.sessionName && (
              <div className="px-4 pt-3 pb-2 shrink-0">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-chart-2/10 text-chart-2 text-[10px] font-medium">
                  <Gamepad2 className="w-3 h-3" />
                  {context.sessionName}
                </span>
              </div>
            )}

            {/* ── Recording previews (shown before conversation starts) ── */}
            {context.playerName && matchRecordings.length > 0 && !hasConversation && (
              <div className="px-4 pt-3 pb-2 shrink-0">
                <div className="space-y-1.5">
                  {matchRecordings.slice(0, 3).map((rec) => (
                    <button
                      key={rec.id}
                      onClick={() => {
                        if (rec.session_id) {
                          router.push(`/dashboard/games/${rec.session_id}`);
                        }
                      }}
                      className="w-full flex items-center gap-3 px-2.5 py-2 rounded-xl bg-muted/30 hover:bg-muted/60 border border-transparent hover:border-primary/15 transition-all text-left group"
                    >
                      {/* Video thumbnail or play icon */}
                      {rec.video_path || rec.thumbnail_path ? (
                        <div className="relative w-14 h-10 rounded-lg overflow-hidden shrink-0 bg-black/20 ring-1 ring-white/5">
                          {rec.thumbnail_path ? (
                            <img src={rec.thumbnail_path} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <video src={rec.video_path} className="w-full h-full object-cover" muted />
                          )}
                          <div className="absolute inset-0 flex items-center justify-center bg-black/25">
                            <Play className="w-3 h-3 text-white/80" />
                          </div>
                          {rec.duration && (
                            <span className="absolute bottom-0.5 right-0.5 text-[8px] bg-black/60 text-white/80 px-1 rounded">
                              {fmtDuration(rec.duration)}
                            </span>
                          )}
                        </div>
                      ) : (
                        <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                          <Play className="w-3 h-3 text-primary" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] text-foreground/80 truncate font-medium">{rec.title}</p>
                        <span className="text-[10px] text-foreground/30 uppercase">{rec.type}</span>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-foreground/15 group-hover:text-primary/50 transition-colors" />
                    </button>
                  ))}
                </div>
                {matchRecordings.length > 3 && (
                  <p className="text-[10px] text-foreground/25 text-center mt-1.5">
                    +{matchRecordings.length - 3} more
                  </p>
                )}
              </div>
            )}

            {/* ── Messages ── */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex",
                    msg.role === "user" ? "justify-end" : "justify-start"
                  )}
                >
                  {msg.role === "tool" ? (
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary/5 text-[11px] text-foreground/40 w-full">
                      <Check className="w-3 h-3 shrink-0 text-primary/60" />
                      <span className="truncate">
                        {(msg.toolName && TOOL_LABELS[msg.toolName]) || msg.toolName || "Done"}
                      </span>
                    </div>
                  ) : (
                    <div className={cn(
                      "max-w-[85%]",
                      msg.role === "user" ? "" : "space-y-2"
                    )}>
                      {(() => {
                        const isUser = msg.role === "user";
                        // For user messages, just render text bubble directly
                        if (isUser) {
                          return (
                            <div className="rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed bg-primary text-primary-foreground rounded-br-md">
                              {msg.content.split("\n").map((line, j) => {
                                if (!line.trim()) return <div key={j} className="h-2" />;
                                return (
                                  <p key={j} className={j > 0 ? "mt-1.5" : ""}>
                                    {renderInline(line, true)}
                                  </p>
                                );
                              })}
                            </div>
                          );
                        }

                        // For assistant messages, parse actions
                        const segments = parseMessageContent(msg.content);

                        return segments.map((seg, si) => {
                          if (seg.kind === "action") {
                            const { action } = seg;
                            if (action.type === "NAVIGATE") {
                              return (
                                <button
                                  key={`action-${si}`}
                                  onClick={() => router.push(action.value)}
                                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-primary/8 hover:bg-primary/15 border border-primary/15 hover:border-primary/30 transition-all text-left group"
                                >
                                  <div className="w-7 h-7 rounded-lg bg-primary/15 flex items-center justify-center shrink-0 group-hover:bg-primary/25 transition-colors">
                                    <ArrowUpRight className="w-3.5 h-3.5 text-primary" />
                                  </div>
                                  <span className="text-[12px] font-medium text-primary flex-1 truncate">
                                    {action.label}
                                  </span>
                                  <ChevronRight className="w-3 h-3 text-primary/40 group-hover:text-primary/70 transition-colors" />
                                </button>
                              );
                            }
                            if (action.type === "ASK") {
                              return (
                                <button
                                  key={`action-${si}`}
                                  onClick={() => sendMessage(action.value)}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted hover:bg-muted/80 border border-border/50 hover:border-primary/20 transition-all text-left"
                                >
                                  <MessageCircle className="w-3 h-3 text-muted-foreground shrink-0" />
                                  <span className="text-[11px] text-muted-foreground hover:text-foreground transition-colors">
                                    {action.label}
                                  </span>
                                </button>
                              );
                            }
                            return null;
                          }

                          // Text segment — render as a bubble
                          const text = seg.content.trim();
                          if (!text) return null;

                          return (
                            <div
                              key={`text-${si}`}
                              className="rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed bg-muted text-foreground rounded-bl-md"
                            >
                              {text.split("\n").map((line, j) => {
                                if (!line.trim()) return <div key={j} className="h-2" />;

                                if (/^#{1,3}\s/.test(line)) {
                                  const heading = line.replace(/^#{1,3}\s+/, "");
                                  return (
                                    <p key={j} className={cn("font-semibold text-foreground", j > 0 && "mt-2")}>
                                      {heading}
                                    </p>
                                  );
                                }

                                const listMatch = line.match(/^(\s*)([-*]|\d+[.)]) (.+)/);
                                if (listMatch) {
                                  const indent = listMatch[1].length > 0;
                                  const content = listMatch[3];
                                  return (
                                    <div key={j} className={cn("flex gap-1.5", j > 0 && "mt-1", indent && "ml-3")}>
                                      <span className="text-muted-foreground shrink-0 mt-px">&#x2022;</span>
                                      <span>{renderInline(content, false)}</span>
                                    </div>
                                  );
                                }

                                return (
                                  <p key={j} className={j > 0 ? "mt-1.5" : ""}>
                                    {renderInline(line, false)}
                                  </p>
                                );
                              })}
                            </div>
                          );
                        });
                      })()}
                    </div>
                  )}
                </div>
              ))}

              {isThinking && (
                <div className="flex justify-start">
                  <div className="bg-muted rounded-2xl rounded-bl-md px-4 py-3 flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                    <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" style={{ animationDelay: "0.15s" }} />
                    <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" style={{ animationDelay: "0.3s" }} />
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* ── Quick suggestions when empty ── */}
            {messages.length <= 1 && !isThinking && (
              <div className="px-4 pb-2 shrink-0">
                <div className="grid grid-cols-2 gap-1.5">
                  {(context.sessionId
                    ? [
                        "Analyze my technique",
                        "What's my forehand form like?",
                        "How can I improve?",
                        "Compare FH vs BH",
                      ]
                    : context.playerName
                    ? [
                        "Summarize this player",
                        "What should they work on?",
                        "Training plan for the week",
                        "Review their last match",
                      ]
                    : [
                        "How does table tennis scoring work?",
                        "Tips for better serves",
                        "Forehand loop technique",
                        "Common beginner mistakes",
                      ]
                  ).map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => sendMessage(suggestion)}
                      className="text-[11px] text-left px-3 py-2 rounded-xl border border-border/50 text-muted-foreground hover:text-foreground hover:border-primary/30 hover:bg-primary/5 transition-all"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ── Input ── */}
            <div className="px-4 pt-3 pb-5 border-t border-border shrink-0">
              <div className="flex items-center gap-2 bg-muted/50 rounded-xl px-4 py-2 focus-within:ring-1 focus-within:ring-primary/30 transition-all">
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder={
                    context.playerName
                      ? `Ask about ${context.playerName}...`
                      : "Message..."
                  }
                  className="flex-1 py-2 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
                />
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || isThinking}
                  className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground disabled:opacity-20 hover:opacity-90 transition-all shrink-0"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
