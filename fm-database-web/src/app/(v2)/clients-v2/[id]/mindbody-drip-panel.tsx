"use client";

/* Coach view of the client's mind-body journey. The app unlocks relaxation
   techniques one at a time as the prior one becomes a habit (breathing → EFT →
   sleep wind-down). This panel SHOWS where the client is right now (status is
   computed server-side from their practice log in mindbody-status.ts) and lets
   the coach override the pace per technique — Automatic / Release now / Hold.
   Writes client.yaml#mindbody_<tech> via setMindbodyOverride; the per-minute
   reconcile projects it to the Fly app. */

import { useState, useTransition } from "react";
import { setMindbodyOverride } from "@/lib/server-actions/clients";
import type { MbStep, Override } from "@/lib/fmdb/mindbody-status";

const CONTROLS: { value: Override; label: string; hint: string }[] = [
  { value: "auto", label: "Automatic", hint: "Opens on its own when the client is ready" },
  { value: "unlocked", label: "Release now", hint: "Show it to the client today" },
  { value: "locked", label: "Hold", hint: "Keep it hidden for now" },
];

const BADGE: Record<MbStep["status"], { text: string; bg: string; fg: string }> = {
  habit: { text: "Habit ✓", bg: "rgba(95,140,96,0.12)", fg: "#3f6b40" },
  building: { text: "Building", bg: "rgba(176,151,107,0.14)", fg: "#8a6f3e" },
  open: { text: "Open in app", bg: "rgba(95,140,96,0.12)", fg: "#3f6b40" },
  waiting: { text: "Waiting", bg: "rgba(111,106,93,0.10)", fg: "#6f6a5d" },
  released: { text: "Released by you", bg: "rgba(176,107,107,0.12)", fg: "#8a4f50" },
  held: { text: "Held by you", bg: "rgba(176,107,107,0.12)", fg: "#8a4f50" },
};

function StepRow({ clientId, step }: { clientId: string; step: MbStep }) {
  const [override, setOverride] = useState<Override>(step.override ?? "auto");
  const [detail, setDetail] = useState(step.detail);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const badge = BADGE[step.status];

  const choose = (next: Override) => {
    if (step.alwaysOn || next === override || pending) return;
    const prev = override;
    setOverride(next);
    setErr(null);
    // optimistic sentence so the row reads right immediately; the server
    // re-renders the authoritative status on revalidate.
    setDetail(
      next === "unlocked"
        ? "Released by you — visible in the client's app now."
        : next === "locked"
          ? "Held by you — hidden from the client for now."
          : "Back to automatic — recalculating from the client's progress…",
    );
    start(async () => {
      const r = await setMindbodyOverride(clientId, step.key as "eft" | "sleep", next);
      if (!r.ok) {
        setOverride(prev);
        setDetail(step.detail);
        setErr(r.error);
      }
    });
  };

  return (
    <div style={{ display: "flex", gap: 12 }}>
      {/* numbered rail */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: "0 0 auto" }}>
        <div
          style={{
            width: 26,
            height: 26,
            borderRadius: "50%",
            display: "grid",
            placeItems: "center",
            fontSize: 13,
            fontWeight: 700,
            color: "#7a5b3a",
            background: "rgba(176,151,107,0.16)",
          }}
        >
          {step.n}
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 0, paddingBottom: 2 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: "var(--fm-ink, #262219)" }}>{step.label}</span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: "1.5px 8px",
              borderRadius: 999,
              background: badge.bg,
              color: badge.fg,
            }}
          >
            {badge.text}
          </span>
          {step.alwaysOn && (
            <span style={{ fontSize: 11, color: "var(--fm-muted, #6f6a5d)" }}>always available</span>
          )}
        </div>

        <div style={{ fontSize: 12.5, color: "var(--fm-muted, #6f6a5d)", marginTop: 4, lineHeight: 1.45 }}>
          {detail}
        </div>

        {/* override control — only for the graduated techniques */}
        {!step.alwaysOn && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 9 }}>
            {CONTROLS.map((c) => {
              const on = override === c.value;
              return (
                <button
                  key={c.value}
                  onClick={() => choose(c.value)}
                  disabled={pending}
                  title={c.hint}
                  style={{
                    flex: "1 1 0",
                    minWidth: 104,
                    textAlign: "left",
                    cursor: pending ? "default" : "pointer",
                    padding: "7px 11px",
                    borderRadius: 11,
                    border: on ? "1.5px solid #b06b6b" : "1px solid var(--fm-line, #e3ddd1)",
                    background: on ? "rgba(176,107,107,0.09)" : "#fff",
                    opacity: pending && !on ? 0.55 : 1,
                  }}
                >
                  <span
                    style={{
                      display: "block",
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: on ? "#8a4f50" : "var(--fm-ink, #262219)",
                    }}
                  >
                    {c.label}
                  </span>
                  <span style={{ display: "block", fontSize: 10.5, color: "var(--fm-muted, #6f6a5d)", marginTop: 1 }}>
                    {c.hint}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {err && <div style={{ fontSize: 12, color: "#b3402a", marginTop: 6 }}>{err}</div>}
      </div>
    </div>
  );
}

export function MindbodyDripPanel({ clientId, steps }: { clientId: string; steps: MbStep[] }) {
  if (!steps.length) return null;
  return (
    <div>
      <div style={{ fontSize: 12.5, color: "var(--fm-muted, #6f6a5d)", marginBottom: 12, lineHeight: 1.5 }}>
        Relaxation practices open one at a time as the client builds each into a habit. This is automatic — only step
        in if you want to release a practice early or hold one back.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {steps.map((s) => (
          <StepRow key={s.key} clientId={clientId} step={s} />
        ))}
      </div>
    </div>
  );
}
