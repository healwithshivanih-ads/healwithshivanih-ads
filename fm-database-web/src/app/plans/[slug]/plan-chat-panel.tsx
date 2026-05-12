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
import { planChatAction, type ChatTurn, type ClientFieldChange } from "./plan-chat-actions";
import type { PlanChange } from "./plan-diff";

interface Props {
  slug: string;
  clientId: string;
  isLocked?: boolean;
}

type Turn = ChatTurn & {
  updated?: boolean;
  changes?: PlanChange[];
  revertedToDraft?: boolean;
  clientUpdated?: boolean;
  clientChanges?: ClientFieldChange[];
};

const CLIENT_FIELD_LABEL: Record<string, string> = {
  dietary_preference: "Dietary preference",
  foods_to_avoid: "Foods to avoid",
  non_negotiables: "Non-negotiables",
  reported_triggers: "Reported triggers",
};

function changeKindGlyph(kind: PlanChange["kind"]): string {
  if (kind === "added") return "➕";
  if (kind === "removed") return "➖";
  return "🔄";
}

function changeKindColour(kind: PlanChange["kind"]): string {
  if (kind === "added") return "text-emerald-700";
  if (kind === "removed") return "text-rose-700";
  return "text-indigo-700";
}

function ChatBubble({ turn }: { turn: Turn }) {
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
        {!isUser && turn.updated && (
          <div className="mt-2 space-y-1">
            <p className="text-[11px] font-semibold text-emerald-700">
              ✓ Plan updated
              {turn.revertedToDraft && (
                <span className="ml-1 font-medium text-amber-600">· moved back to Draft</span>
              )}
            </p>
            {turn.changes && turn.changes.length > 0 && (
              <ul className="mt-1 space-y-0.5 border-l-2 border-emerald-200 pl-2">
                {turn.changes.map((c, i) => (
                  <li key={i} className={`text-[11px] leading-snug ${changeKindColour(c.kind)}`}>
                    <span className="mr-1">{changeKindGlyph(c.kind)}</span>
                    {c.summary}
                  </li>
                ))}
              </ul>
            )}
            {turn.updated && (!turn.changes || turn.changes.length === 0) && (
              <p className="text-[10px] italic text-muted-foreground">
                Patch applied — no field-level diff produced (likely a small text edit).
              </p>
            )}
          </div>
        )}
        {!isUser && turn.clientUpdated && turn.clientChanges && turn.clientChanges.length > 0 && (
          <div className="mt-2 space-y-1">
            <p className="text-[11px] font-semibold text-violet-700">
              👤 Client profile updated · will apply to future plans
            </p>
            <ul className="mt-1 space-y-0.5 border-l-2 border-violet-200 pl-2">
              {turn.clientChanges.map((c, i) => (
                <li key={i} className="text-[11px] leading-snug text-violet-700">
                  <span className="mr-1">📝</span>
                  <span className="font-medium">{CLIENT_FIELD_LABEL[c.field] ?? c.field}:</span>{" "}
                  {c.before ? (
                    <>
                      <span className="line-through text-violet-400">{c.before}</span> →{" "}
                      <span>{c.after}</span>
                    </>
                  ) : (
                    <span>{c.after}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

export function PlanChatPanel({ slug, clientId, isLocked }: Props) {
  const [history, setHistory] = useState<Turn[]>([]);
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

    const userTurn: Turn = { role: "user", content: msg };
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

      const assistantTurn: Turn = {
        role: "assistant",
        content: result.reply ?? "Done.",
        updated: result.updated,
        changes: result.changes,
        revertedToDraft: result.revertedToDraft,
        clientUpdated: result.clientUpdated,
        clientChanges: result.clientChanges,
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
