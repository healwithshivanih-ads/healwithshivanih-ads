"use client";

/**
 * MealPlanChat — natural-language editor for the client's meal plan.
 *
 * Sits underneath the inline letter viewer. Coach types things like:
 *   "swap ragi porridge on day 1 to ragi dosa"
 *   "drop dinner protein on day 3, replace with paneer"
 *   "make week 1 dinners lighter — no rice after 7pm"
 *
 * Server-side `refineLetter` (Sonnet, ~$0.04 per turn) reads the current
 * meal-plan markdown + the coach's instruction, rewrites the affected
 * sections only, and persists the new markdown + HTML back to the same
 * `meal-plans/{slug}.{md,html}` files the viewer reads from. After the
 * save the parent bumps a viewer key so iframes re-fetch and show the
 * edit immediately.
 *
 * History is localStorage-backed (keyed by plan slug) so a refresh
 * doesn't wipe a long edit thread.
 */

import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  refineLetter,
  loadMealPlan,
  type LetterType,
} from "@/lib/server-actions/plan-lifecycle";

type Turn = {
  role: "user" | "assistant";
  content: string;
  changes?: Array<{ kind: string; summary: string }>;
  /** When this assistant turn came back in discuss mode, the pending
   *  list it produced. Used to show the running queue per turn. */
  pending?: string[];
};

interface Props {
  clientId: string;
  planSlug: string;
  letterType: LetterType;
  /** Bumped by parent after a successful save so the iframe viewer re-renders. */
  onSaved: () => void;
}

/**
 * Renamed from MealPlanChat — the same discuss→finalise chat works for
 * every letter type (meal plan, supplement plan, lifestyle guide,
 * consolidated). Each instance scopes its localStorage thread by plan
 * slug + letterType so the coach can have a separate edit conversation
 * per document.
 */
export function LetterRefinementChat({ clientId, planSlug, letterType, onSaved }: Props) {
  const storageKey = `fm-letter-chat:${planSlug}:${letterType}`;
  const [history, setHistory] = useState<Turn[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [input, setInput] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Rehydrate from localStorage AFTER first commit to avoid hydration
  // mismatch (server renders []; client lifts the stored thread). Same
  // pattern as the plan-chat panel.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setHistory(parsed as Turn[]);
        }
      }
    } catch { /* ignore */ }
    setHydrated(true);
  }, [storageKey]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      if (history.length === 0) window.localStorage.removeItem(storageKey);
      else window.localStorage.setItem(storageKey, JSON.stringify(history));
    } catch { /* storage blocked */ }
  }, [history, hydrated, storageKey]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [history.length]);

  function clearHistory() {
    if (history.length === 0) return;
    if (!confirm("Clear this chat thread? You can't undo this.")) return;
    setHistory([]);
    setError(null);
  }

  // Pending edits the coach has queued through the chat. Latest assistant
  // turn's <pending> block wins (the AI re-emits the full list every turn).
  const pendingEdits =
    [...history].reverse().find((t) => t.role === "assistant" && t.pending)?.pending ?? [];

  function send() {
    const msg = input.trim();
    if (!msg || pending) return;
    setError(null);
    setHistory((h) => [...h, { role: "user", content: msg }]);
    setInput("");

    startTransition(async () => {
      // Pull latest saved markdown from disk so the AI's context is
      // fresh even after a refresh mid-thread.
      const current = await loadMealPlan(planSlug, clientId, letterType);
      if (!current.ok || !current.markdown) {
        setError(current.error ?? "Couldn't load current meal plan");
        return;
      }
      const serverHistory = history.map(({ role, content }) => ({ role, content }));
      const res = await refineLetter(
        current.markdown,
        msg,
        serverHistory,
        planSlug,
        clientId,
        "discuss",
      );
      if (!res.ok) {
        setError((res as { error?: string }).error ?? "Refine failed");
        toast.error("Refine failed");
        return;
      }
      const reply = res.reply ?? "Got it.";
      setHistory((h) => [...h, { role: "assistant", content: reply, pending: res.pending ?? [] }]);
    });
  }

  function finalise() {
    if (pending || pendingEdits.length === 0) return;
    setError(null);

    startTransition(async () => {
      const current = await loadMealPlan(planSlug, clientId, letterType);
      if (!current.ok || !current.markdown) {
        setError(current.error ?? "Couldn't load current meal plan");
        return;
      }
      const serverHistory = history.map(({ role, content }) => ({ role, content }));
      const res = await refineLetter(
        current.markdown,
        "", // empty — finalise reads pending list from history
        serverHistory,
        planSlug,
        clientId,
        "finalise",
      );
      if (!res.ok) {
        const errMsg = (res as { error?: string }).error ?? "Finalise failed";
        setError(errMsg);
        toast.error("Finalise failed");
        setHistory((h) => [
          ...h,
          { role: "assistant", content: `⚠ Couldn't apply changes: ${errMsg}` },
        ]);
        return;
      }
      const reply = res.reply ?? `Applied ${pendingEdits.length} change${pendingEdits.length === 1 ? "" : "s"}.`;
      setHistory((h) => [
        ...h,
        { role: "assistant", content: `✅ ${reply}`, pending: [] },
      ]);
      toast.success(`Meal plan updated · ${pendingEdits.length} change${pendingEdits.length === 1 ? "" : "s"} applied`);
      onSaved();
    });
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div
      style={{
        display: "grid",
        gap: 8,
        padding: "10px 12px",
        border: "1px solid var(--fm-border-light)",
        borderRadius: "var(--fm-radius-md)",
        background: "var(--fm-surface)",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>
          💬 Edit this {letterType === "meal_plan" || letterType === "meal_plan_phase"
            ? "meal plan"
            : letterType === "supplement_plan"
              ? "supplement plan"
              : letterType === "lifestyle_guide"
                ? "lifestyle guide"
                : letterType === "exercise_plan"
                  ? "exercise plan"
                  : "letter"}
        </span>
        <span style={{ fontSize: 11, color: "var(--fm-text-tertiary)" }}>
          Discuss edits, queue them up, then commit in one go
        </span>
        {history.length > 0 && (
          <button
            type="button"
            onClick={clearHistory}
            style={{
              marginLeft: "auto",
              fontSize: 10.5,
              background: "none",
              border: 0,
              color: "var(--fm-text-tertiary)",
              cursor: "pointer",
              textDecoration: "underline",
            }}
          >
            🗑 Clear ({history.length})
          </button>
        )}
      </div>

      {/* Pending-edits queue — shows the running list the AI is tracking.
          Coach can review before clicking Finalise. */}
      {pendingEdits.length > 0 && (
        <div
          style={{
            display: "grid",
            gap: 6,
            padding: "8px 10px",
            background: "rgba(243,156,18,0.08)",
            border: "1px solid rgba(243,156,18,0.30)",
            borderRadius: 6,
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#8a5a08", textTransform: "uppercase", letterSpacing: 0.5 }}>
              📋 Pending changes ({pendingEdits.length})
            </span>
            <span style={{ fontSize: 10.5, color: "#8a5a08", opacity: 0.85 }}>
              Click Finalise to apply all to the meal plan in one rewrite (~$0.05)
            </span>
            <button
              type="button"
              onClick={finalise}
              disabled={pending}
              style={{
                marginLeft: "auto",
                fontSize: 11,
                fontWeight: 700,
                padding: "5px 11px",
                background: pending ? "var(--fm-border)" : "var(--fm-success, #1E8449)",
                color: "white",
                border: 0,
                borderRadius: 5,
                cursor: pending ? "wait" : "pointer",
                fontFamily: "inherit",
                whiteSpace: "nowrap",
              }}
            >
              {pending ? "⏳ Applying…" : "✅ Finalise & apply"}
            </button>
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11.5, color: "#1f1f1f", lineHeight: 1.55 }}>
            {pendingEdits.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      {history.length > 0 && (
        <div
          ref={scrollRef}
          style={{
            maxHeight: 240,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 6,
            padding: "6px 4px",
            background: "var(--fm-bg-warm, rgba(0,0,0,0.02))",
            borderRadius: 6,
          }}
        >
          {history.map((t, i) => (
            <div
              key={i}
              style={{
                alignSelf: t.role === "user" ? "flex-end" : "flex-start",
                maxWidth: "82%",
                fontSize: 12,
                lineHeight: 1.45,
                padding: "6px 10px",
                borderRadius: 10,
                background:
                  t.role === "user"
                    ? "var(--fm-primary, #1E8449)"
                    : "var(--fm-surface)",
                color: t.role === "user" ? "white" : "var(--fm-text-primary)",
                border:
                  t.role === "assistant"
                    ? "1px solid var(--fm-border-light)"
                    : "none",
                whiteSpace: "pre-wrap",
              }}
            >
              {t.content}
            </div>
          ))}
          {pending && (
            <div
              style={{
                alignSelf: "flex-start",
                fontSize: 11,
                color: "var(--fm-text-tertiary)",
                fontStyle: "italic",
                padding: "4px 10px",
              }}
            >
              ⏳ Rewriting…
            </div>
          )}
        </div>
      )}

      {error && (
        <div style={{ fontSize: 11.5, color: "var(--fm-danger, #b04646)" }}>{error}</div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKey}
          disabled={pending}
          rows={2}
          placeholder={
            'e.g. "Swap ragi porridge on Day 1 to ragi dosa" · "Drop the paneer at dinner on Day 4 — she\'s avoiding dairy this week" · "Make Week 2 breakfasts lighter"'
          }
          style={{
            flex: 1,
            fontSize: 12,
            padding: "6px 8px",
            border: "1px solid var(--fm-border-light)",
            borderRadius: 6,
            resize: "vertical",
            minHeight: 44,
            fontFamily: "inherit",
            background: "var(--fm-surface)",
          }}
        />
        <button
          type="button"
          onClick={send}
          disabled={pending || !input.trim()}
          style={{
            fontSize: 12,
            fontWeight: 700,
            padding: "8px 14px",
            background: pending ? "var(--fm-border)" : "var(--fm-primary, #1E8449)",
            color: "white",
            border: 0,
            borderRadius: 6,
            cursor: pending ? "wait" : "pointer",
            fontFamily: "inherit",
            whiteSpace: "nowrap",
          }}
        >
          {pending ? "…" : "✨ Apply"}
        </button>
      </div>
      <div style={{ fontSize: 10.5, color: "var(--fm-text-tertiary)", lineHeight: 1.5 }}>
        Chat is free-form — propose edits, retract them, change your mind.
        The AI keeps a running pending-changes list. Nothing touches the
        meal plan on disk until you click <strong>Finalise & apply</strong>.
        Discussion: ~$0.005/turn (Haiku) · Finalise: ~$0.05 (Sonnet, single rewrite).
      </div>
    </div>
  );
}
