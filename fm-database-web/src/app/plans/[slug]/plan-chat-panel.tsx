"use client";

/**
 * PlanChatPanel — AI chat for modifying a structured draft plan.
 *
 * Coaches can say things like:
 *   "Add magnesium glycinate 400mg at bedtime"
 *   "Remove the third lab test"
 *   "Change the first supplement dose to 2 capsules"
 *   "Add daily 20-min walk to lifestyle"
 *   "Add stool culture to labs"
 *
 * The AI reads the full current plan, makes the change, and returns a patch
 * that is applied immediately via updatePlan(). The editor refreshes via
 * revalidatePath on the server side so the tab UI reflects changes.
 */

import { useState, useRef, useEffect, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { planChatAction, type ChatTurn } from "./plan-chat-actions";

interface Props {
  slug: string;
  clientId: string;
  isLocked?: boolean;
}

function ChatBubble({ turn }: { turn: ChatTurn & { updated?: boolean } }) {
  const isUser = turn.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-xl px-3 py-2 text-sm leading-relaxed ${
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground border"
        }`}
      >
        {turn.content}
        {!isUser && (turn as ChatTurn & { updated?: boolean; revertedToDraft?: boolean }).updated && (
          <p className="mt-1 text-[11px] font-medium text-emerald-600">
            ✓ Plan updated
            {(turn as ChatTurn & { updated?: boolean; revertedToDraft?: boolean }).revertedToDraft && (
              <span className="ml-1 text-amber-600">· moved back to Draft</span>
            )}
          </p>
        )}
      </div>
    </div>
  );
}

export function PlanChatPanel({ slug, clientId, isLocked }: Props) {
  const [history, setHistory] = useState<(ChatTurn & { updated?: boolean })[]>([]);
  const [input, setInput] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [history.length]);

  function handleSend() {
    const msg = input.trim();
    if (!msg || pending) return;

    const userTurn: ChatTurn & { updated?: boolean } = { role: "user", content: msg };
    setHistory((h) => [...h, userTurn]);
    setInput("");
    setError(null);

    startTransition(async () => {
      // Build history for the server (plain role/content — exclude updated flag)
      const serverHistory: ChatTurn[] = history.map(({ role, content }) => ({ role, content }));

      const result = await planChatAction(slug, clientId, msg, serverHistory);

      if (!result.ok) {
        setError(result.error ?? "Something went wrong");
        return;
      }

      const assistantTurn: ChatTurn & { updated?: boolean; revertedToDraft?: boolean } = {
        role: "assistant",
        content: result.reply ?? "Done.",
        updated: result.updated,
        revertedToDraft: result.revertedToDraft,
      };
      setHistory((h) => [...h, assistantTurn]);
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Intro */}
      <div className="rounded-md bg-muted/40 border px-3 py-2.5 text-xs text-muted-foreground space-y-1">
        <p className="font-medium text-foreground/80">💬 Ask me to modify this plan</p>
        <p>Try: <em>&ldquo;Add magnesium glycinate 400mg at bedtime&rdquo;</em>, <em>&ldquo;Remove the second lab test&rdquo;</em>, <em>&ldquo;Change lifestyle to include daily 20-min walk&rdquo;</em></p>
        {isLocked ? (
          <p className="text-amber-700 font-medium">⚠ Making changes will move this plan back to Draft status.</p>
        ) : (
          <p className="text-[11px]">For meal plan letter edits, use the Export tab → Generate client documents → refinement chat.</p>
        )}
      </div>

      {/* Chat history */}
      {history.length > 0 && (
        <div
          ref={scrollRef}
          className="flex flex-col gap-2 max-h-80 overflow-y-auto rounded-lg border bg-background p-3"
        >
          {history.map((turn, i) => (
            <ChatBubble key={i} turn={turn} />
          ))}
          {pending && (
            <div className="flex justify-start">
              <div className="bg-muted border rounded-xl px-3 py-2 text-sm text-muted-foreground animate-pulse">
                Thinking…
              </div>
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Input */}
      <div className="flex gap-2">
        <textarea
          ref={textareaRef}
          rows={2}
          placeholder="e.g. Add omega-3 2g daily with lunch, or remove the last referral…"
          className="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={pending}
        />
        <Button
          onClick={handleSend}
          disabled={!input.trim() || pending}
          className="self-end"
        >
          {pending ? "…" : "Send"}
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">Enter to send · Shift+Enter for new line</p>
    </div>
  );
}
