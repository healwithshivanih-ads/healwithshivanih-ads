"use client";

/**
 * Coach control to draft + save the back-on-track (flare-reset) card from the
 * client's plan. The card renders in the client app's library floor + maintenance
 * once they graduate. Deterministic generator (no API) — see
 * generate-back-on-track.py. Shown only when the client has a published plan.
 */

import { useState } from "react";
import { generateBackOnTrackAction, type BackOnTrackCard } from "@/lib/server-actions/clients";

const SEC = "var(--fm-text-secondary, #6f6a5d)";
const INK = "var(--fm-text-primary, #2c2a24)";
const LINE = "var(--fm-border, #e6e1d6)";
const FOREST = "#2d5a3d";

export function BackOnTrackButton({ clientId, existing }: { clientId: string; existing: BackOnTrackCard | null }) {
  const [card, setCard] = useState<BackOnTrackCard | null>(existing);
  const [saved, setSaved] = useState<boolean>(!!existing);
  const [busy, setBusy] = useState<"preview" | "save" | null>(null);
  const [err, setErr] = useState("");

  const run = async (dry: boolean) => {
    setBusy(dry ? "preview" : "save");
    setErr("");
    const r = await generateBackOnTrackAction(clientId, dry);
    setBusy(null);
    if (!r.ok) {
      setErr(r.error || "generation failed");
      return;
    }
    setCard(r.card);
    setSaved(!dry);
  };

  return (
    <div style={{ border: `1px solid ${LINE}`, borderRadius: 12, padding: "13px 15px", background: "var(--fm-surface, #fff)" }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: INK }}>🌿 Back-on-track card</div>
      <p style={{ fontSize: 12.5, color: SEC, lineHeight: 1.5, margin: "5px 0 10px" }}>
        A self-serve flare-reset, drafted from this client&apos;s plan. Appears in their app&apos;s library floor once
        the programme completes. Edit it afterwards via their profile if you like.
      </p>

      {card && (
        <div style={{ border: `1px solid ${LINE}`, borderRadius: 10, padding: "10px 12px", marginBottom: 10, background: "var(--fm-surface-2, #faf8f3)" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: FOREST }}>{card.title}</div>
          <div style={{ fontSize: 12, color: SEC, lineHeight: 1.5, margin: "4px 0 6px" }}>{card.intro}</div>
          <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: INK, lineHeight: 1.55 }}>
            {card.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <button
          onClick={() => run(true)}
          disabled={busy !== null}
          style={{ fontSize: 12.5, padding: "7px 13px", borderRadius: 9, border: `1px solid ${LINE}`, background: "transparent", color: INK, cursor: "pointer" }}
        >
          {busy === "preview" ? "Drafting…" : card ? "Re-draft from plan" : "Draft from plan"}
        </button>
        {card && !saved && (
          <button
            onClick={() => run(false)}
            disabled={busy !== null}
            style={{ fontSize: 12.5, padding: "7px 13px", borderRadius: 9, border: "none", background: FOREST, color: "#fff", cursor: "pointer" }}
          >
            {busy === "save" ? "Saving…" : "Save to client"}
          </button>
        )}
        {saved && <span style={{ fontSize: 12.5, color: FOREST, fontWeight: 600 }}>✓ Saved</span>}
      </div>
      {err && <div style={{ fontSize: 12, color: "#b3402a", marginTop: 7 }}>{err}</div>}
    </div>
  );
}
