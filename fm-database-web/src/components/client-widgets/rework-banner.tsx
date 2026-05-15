"use client";

/**
 * ReworkBanner — surfaces the most recent AI plan-rework suggestion when its
 * estimated benefit is meaningful (>= 30%). Click → modal with full rationale,
 * suggested changes, and action buttons (dismiss / snooze / generate successor).
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  applyReworkSuggestionAction,
  dismissReworkSuggestionAction,
  snoozeReworkSuggestionAction,
} from "@/lib/server-actions/clients";
import type { ReworkSuggestion } from "@/lib/fmdb/types";

interface Props {
  clientId: string;
  suggestion: ReworkSuggestion | null | undefined;
}

const TRIGGER_LABEL: Record<string, string> = {
  check_in: "check-in",
  quick_note: "quick note",
  functional_test: "functional test",
  lab_snapshot: "lab upload",
  genetic_report: "genetic report",
};

export function ReworkBanner({ clientId, suggestion }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  if (!suggestion) return null;
  if (suggestion.dismissed_at) return null;
  if (suggestion.benefit_pct < 30) return null;

  // Honour snooze
  if (suggestion.snoozed_until) {
    const until = new Date(suggestion.snoozed_until);
    if (until > new Date()) return null;
  }

  const bannerColor =
    suggestion.benefit_pct >= 80
      ? "border-red-300 bg-red-50 text-red-800"
      : suggestion.benefit_pct >= 60
        ? "border-orange-300 bg-orange-50 text-orange-800"
        : "border-amber-300 bg-amber-50 text-amber-800";

  const triggerLabel = TRIGGER_LABEL[suggestion.triggered_by] ?? suggestion.triggered_by;

  const onDismiss = () => {
    start(async () => {
      const r = await dismissReworkSuggestionAction(clientId);
      if (r.ok) {
        toast.success("Suggestion dismissed");
        setOpen(false);
        router.refresh();
      } else {
        toast.error(r.error ?? "Dismiss failed");
      }
    });
  };

  const onSnooze = () => {
    start(async () => {
      const r = await snoozeReworkSuggestionAction(clientId, 7);
      if (r.ok) {
        toast.success("Snoozed for 7 days");
        setOpen(false);
        router.refresh();
      } else {
        toast.error(r.error ?? "Snooze failed");
      }
    });
  };

  const onRework = () => {
    start(async () => {
      const r = await applyReworkSuggestionAction({ clientId });
      if (r.ok && r.slug) {
        toast.success(
          `✅ ${r.successor ? "Successor" : "Draft"} plan created — ` +
            `${r.applied_count ?? 0} change${r.applied_count === 1 ? "" : "s"} applied`,
        );
        setOpen(false);
        // v2 is the default surface now — drop the coach into the v2
        // editor for the newly-created rework draft so they stay in the
        // shell they came from.
        router.push(`/clients-v2/${clientId}/plan/edit/${r.slug}`);
      } else {
        toast.error(r.error ?? "Rework failed");
      }
    });
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`w-full text-left rounded-lg border-2 px-4 py-3 transition-all hover:shadow-sm ${bannerColor}`}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="text-xl">🔄</span>
            <div>
              <p className="text-sm font-semibold">
                AI suggests plan rework — {suggestion.benefit_pct}% benefit estimated
              </p>
              <p className="text-xs opacity-80 mt-0.5">
                Triggered by {triggerLabel} · click to review →
              </p>
            </div>
          </div>
          <span className="text-[11px] opacity-70 px-2 py-0.5 rounded bg-white/60 border border-current/20">
            {suggestion.confidence} confidence
          </span>
        </div>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-background rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b px-5 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-2xl">🔄</span>
                <div>
                  <h2 className="text-base font-semibold">AI plan rework suggestion</h2>
                  <p className="text-xs text-muted-foreground">
                    Triggered by {triggerLabel} · {new Date(suggestion.generated_at).toLocaleString()}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="text-muted-foreground hover:text-foreground text-xl leading-none"
              >
                ×
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              {/* Benefit + confidence */}
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-3xl font-bold">{suggestion.benefit_pct}%</span>
                    <span className="text-xs text-muted-foreground">estimated benefit</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full ${
                        suggestion.benefit_pct >= 80 ? "bg-red-500" :
                        suggestion.benefit_pct >= 60 ? "bg-orange-500" :
                        "bg-amber-500"
                      }`}
                      style={{ width: `${suggestion.benefit_pct}%` }}
                    />
                  </div>
                </div>
                <span className={`text-xs px-2 py-1 rounded ${
                  suggestion.confidence === "high" ? "bg-emerald-50 border border-emerald-200 text-emerald-700" :
                  suggestion.confidence === "medium" ? "bg-amber-50 border border-amber-200 text-amber-700" :
                  "bg-slate-50 border border-slate-200 text-slate-600"
                }`}>
                  {suggestion.confidence} confidence
                </span>
              </div>

              {/* Rationale */}
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Rationale</h3>
                <p className="text-sm leading-relaxed">{suggestion.rationale}</p>
              </div>

              {/* Suggested changes */}
              {suggestion.suggested_changes.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                    Suggested changes ({suggestion.suggested_changes.length})
                  </h3>
                  <ul className="space-y-2">
                    {suggestion.suggested_changes.map((c, i) => (
                      <li key={i} className="rounded border bg-card px-3 py-2 text-xs space-y-1">
                        <div className="flex items-center gap-2">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${
                            c.op === "add" ? "bg-emerald-100 text-emerald-700" :
                            c.op === "remove" ? "bg-red-100 text-red-700" :
                            c.op === "escalate" ? "bg-orange-100 text-orange-700" :
                            c.op === "deescalate" ? "bg-blue-100 text-blue-700" :
                            "bg-violet-100 text-violet-700"
                          }`}>
                            {c.op}
                          </span>
                          <span className="text-[10px] text-muted-foreground uppercase">{c.target_kind}</span>
                          {c.target_slug && (
                            <span className="text-[10px] font-mono text-muted-foreground">{c.target_slug}</span>
                          )}
                        </div>
                        <p className="font-medium">{c.description}</p>
                        <p className="text-muted-foreground italic">{c.reason}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="border-t px-5 py-3 flex flex-wrap gap-2 justify-end">
              <button
                disabled={pending}
                onClick={onDismiss}
                className="px-3 py-1.5 rounded text-xs border hover:bg-muted disabled:opacity-50"
              >
                Dismiss
              </button>
              <button
                disabled={pending}
                onClick={onSnooze}
                className="px-3 py-1.5 rounded text-xs border hover:bg-muted disabled:opacity-50"
              >
                Snooze 7 days
              </button>
              <a
                href={`/clients-v2/${clientId}/analyse/full`}
                className="px-3 py-1.5 rounded text-xs border border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
              >
                🧠 Run full assessment now
              </a>
              <button
                disabled={pending}
                onClick={onRework}
                className="px-3 py-1.5 rounded text-xs bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {pending ? "⏳ Reworking…" : "🔄 Rework plan now"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
