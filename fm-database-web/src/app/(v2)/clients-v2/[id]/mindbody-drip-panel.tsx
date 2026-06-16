"use client";

/* Coach override for the mind-body drip. The app auto-unlocks EFT once the
   client has made breathing a habit (≥3 distinct days in the trailing week);
   this lets the coach release it early, or hold it, per client. Writes
   client.yaml#mindbody_eft via setMindbodyOverride; the per-minute reconcile
   projects it to the Fly app. */

import { useState, useTransition } from "react";
import { setMindbodyOverride } from "@/lib/server-actions/clients";

type State = "auto" | "unlocked" | "locked";

const OPTS: { value: State; label: string; hint: string }[] = [
  { value: "auto", label: "Auto-drip", hint: "Unlocks after ~3 days of breathing" },
  { value: "unlocked", label: "Unlock now", hint: "Show EFT immediately" },
  { value: "locked", label: "Hold", hint: "Keep EFT hidden for now" },
];

export function MindbodyDripPanel({
  clientId,
  technique = "eft",
  blurb = "EFT tapping unlocks once breathing is a habit. Override the pace for this client.",
  initial,
}: {
  clientId: string;
  technique?: "eft" | "sleep";
  blurb?: string;
  initial: State;
}) {
  const [state, setState] = useState<State>(initial);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const choose = (next: State) => {
    if (next === state || pending) return;
    const prev = state;
    setState(next);
    setErr(null);
    start(async () => {
      const r = await setMindbodyOverride(clientId, technique, next);
      if (!r.ok) {
        setState(prev);
        setErr(r.error);
      }
    });
  };

  return (
    <div>
      <div style={{ fontSize: 12.5, color: "var(--fm-muted, #6f6a5d)", marginBottom: 8 }}>{blurb}</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {OPTS.map((o) => {
          const on = state === o.value;
          return (
            <button
              key={o.value}
              onClick={() => choose(o.value)}
              disabled={pending}
              style={{
                flex: "1 1 0",
                minWidth: 120,
                textAlign: "left",
                cursor: pending ? "default" : "pointer",
                padding: "9px 12px",
                borderRadius: 12,
                border: on ? "1.5px solid #b06b6b" : "1px solid var(--fm-line, #e3ddd1)",
                background: on ? "rgba(176,107,107,0.09)" : "#fff",
                opacity: pending && !on ? 0.6 : 1,
              }}
            >
              <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: on ? "#8a4f50" : "var(--fm-ink, #262219)" }}>
                {o.label}
              </span>
              <span style={{ display: "block", fontSize: 11, color: "var(--fm-muted, #6f6a5d)", marginTop: 1 }}>{o.hint}</span>
            </button>
          );
        })}
      </div>
      {err && <div style={{ fontSize: 12, color: "#b3402a", marginTop: 6 }}>{err}</div>}
    </div>
  );
}
