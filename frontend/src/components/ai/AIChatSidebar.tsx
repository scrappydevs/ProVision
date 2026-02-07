"use client";

import { useState, useRef, useEffect } from "react";
import { useAIChat } from "@/contexts/AIChatContext";
import {
  X,
  Send,
  Sparkles,
  Loader2,
  Trash2,
  User,
  Gamepad2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

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

  const handleSend = async () => {
    if (!input.trim() || isThinking) return;
    const text = input;
    setInput("");
    await sendMessage(text);
  };

  const hasContext = !!(context.playerName || context.sessionName);

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
          <div className="w-[380px] h-full flex flex-col bg-background">
            {/* Header */}
            <div className="px-4 py-3 border-b border-border flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center">
                  <Sparkles className="w-3.5 h-3.5 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">
                    AI Coach
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {hasContext
                      ? `Viewing ${context.playerName ?? context.sessionName}`
                      : "Ask anything"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={clearMessages}
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  title="Clear chat"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={close}
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  title="Close"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Context chips */}
            {hasContext && (
              <div className="px-4 py-2 border-b border-border/50 flex items-center gap-2 flex-wrap shrink-0">
                {context.playerName && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-[10px] font-medium">
                    <User className="w-3 h-3" />
                    {context.playerName}
                  </span>
                )}
                {context.sessionName && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-chart-2/10 text-chart-2 text-[10px] font-medium">
                    <Gamepad2 className="w-3 h-3" />
                    {context.sessionName}
                  </span>
                )}
                {context.recordings && context.recordings.length > 0 && (
                  <span className="text-[10px] text-muted-foreground">
                    {context.recordings.length} recording
                    {context.recordings.length !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
            )}

            {/* Messages */}
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
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary/10 text-[10px] text-primary w-full">
                      <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                      <span className="font-mono truncate">
                        {msg.toolName}
                      </span>
                    </div>
                  ) : (
                    <div
                      className={cn(
                        "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed",
                        msg.role === "user"
                          ? "bg-primary text-primary-foreground rounded-br-md"
                          : "bg-muted text-foreground rounded-bl-md"
                      )}
                    >
                      {msg.content.split("\n").map((line, j) => (
                        <p key={j} className={j > 0 ? "mt-1.5" : ""}>
                          {line.split("**").map((part, k) =>
                            k % 2 === 1 ? (
                              <strong
                                key={k}
                                className={
                                  msg.role === "user"
                                    ? "font-semibold"
                                    : "text-primary font-medium"
                                }
                              >
                                {part}
                              </strong>
                            ) : (
                              part
                            )
                          )}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              ))}

              {isThinking && (
                <div className="flex justify-start">
                  <div className="bg-muted rounded-2xl rounded-bl-md px-4 py-3 flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                    <div
                      className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"
                      style={{ animationDelay: "0.15s" }}
                    />
                    <div
                      className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"
                      style={{ animationDelay: "0.3s" }}
                    />
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Quick suggestions when empty */}
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
                        "Key strengths and weaknesses",
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

            {/* Input */}
            <div className="p-3 border-t border-border shrink-0">
              <div className="flex items-center gap-2 bg-muted/50 rounded-xl px-3.5 py-1 focus-within:ring-1 focus-within:ring-primary/30 transition-all">
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
                      : "Ask anything..."
                  }
                  className="flex-1 py-2.5 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
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
