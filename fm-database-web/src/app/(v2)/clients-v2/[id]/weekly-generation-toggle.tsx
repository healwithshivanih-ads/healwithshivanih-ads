"use client";

/**
 * WeeklyGenerationToggle — the per-client half of the dashboard's
 * "Weekly menu + recipes" switch.
 *
 * Same flag, same server action, second surface. The dashboard answers "who
 * is switched off across the roster?"; this answers "is SHE switched off?" at
 * the moment the coach is looking at her — which is when the thought usually
 * arrives ("she never opens these"), and it is a poor use of anyone's time to
 * make her go back to the dashboard and find the row.
 *
 * Lives in the Plan modules group next to meal_plan_style on purpose: that
 * field decides how structured her meal plan is, this one decides whether a
 * fresh one gets written each week. They are the same kind of standing
 * decision and they get changed for the same kind of reason.
 */

import { useEffect, useState, useTransition } from "react";
import {
  isWeeklyGenerationPausedAction,
  setWeeklyGenerationPausedAction,
} from "@/lib/server-actions/recipes";

export function WeeklyGenerationToggle({ clientId }: { clientId: string }) {
  const [paused, setPaused] = useState<boolean | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  useEffect(() => {
    let ignore = false;
    void isWeeklyGenerationPausedAction(clientId)
      .then((p) => {
        if (!ignore) setPaused(p);
      })
      .catch(() => {
        if (!ignore) setPaused(false);
      });
    return () => {
      ignore = true;
    };
  }, [clientId]);

  // Render nothing until we know — a toggle that flashes "running" before
  // settling on "paused" is worse than a beat of blank space.
  if (paused === null) return null;

  const toggle = () => {
    setErr(null);
    startTransition(() => {
      void setWeeklyGenerationPausedAction(clientId, !paused)
        .then((res) => {
          if (res.ok) setPaused(!paused);
          else setErr(res.error ?? "Could not save that.");
        })
        .catch((e: unknown) => setErr((e as Error).message));
    });
  };

  return (
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--fm-border)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Weekly menu + recipes</div>
          <div style={{ fontSize: 12, color: "var(--fm-text-secondary)", lineHeight: 1.5, marginTop: 2 }}>
            {paused
              ? "Paused — no new menu is drafted and no recipes are written. She stays on the menu she already has."
              : "Running — next week's menu drafts automatically at 07:00, and recipes follow when you approve it."}
          </div>
        </div>
        <button
          type="button"
          onClick={toggle}
          disabled={busy}
          style={{
            flexShrink: 0,
            fontSize: 12,
            padding: "5px 12px",
            borderRadius: 6,
            cursor: busy ? "default" : "pointer",
            border: "1px solid var(--fm-border)",
            background: paused ? "var(--fm-primary, #7c9070)" : "transparent",
            color: paused ? "#fff" : "var(--fm-text-secondary)",
            opacity: busy ? 0.5 : 1,
          }}
        >
          {busy ? "…" : paused ? "Resume" : "Pause"}
        </button>
      </div>
      {err && (
        <p style={{ fontSize: 12, color: "var(--fm-danger, #b3261e)", margin: "6px 0 0" }}>{err}</p>
      )}
    </div>
  );
}
