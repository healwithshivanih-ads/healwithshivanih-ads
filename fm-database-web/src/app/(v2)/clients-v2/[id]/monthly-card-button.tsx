"use client";

/**
 * Coach control to draft + save the maintenance tier's monthly do's & don'ts
 * card. Deterministic seasonal + condition generator (no API) — see
 * generate-monthly-card.py. The card is written onto the latest published plan
 * at monthly_cards[YYYY-MM] and renders on the app's maintenance home. Shown only
 * when the client has a published plan. Idempotent per month.
 */

import { useState } from "react";
import { generateMonthlyCardAction, type MonthlyCard } from "@/lib/server-actions/clients";

const SEC = "var(--fm-text-secondary, #6f6a5d)";
const INK = "var(--fm-text-primary, #2c2a24)";
const LINE = "var(--fm-border, #e6e1d6)";
const FOREST = "#2d5a3d";

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function MonthlyCardButton({ clientId }: { clientId: string }) {
  const [month, setMonth] = useState<string>(currentMonth());
  const [card, setCard] = useState<MonthlyCard | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState<"preview" | "save" | null>(null);
  const [err, setErr] = useState("");

  const run = async (dry: boolean) => {
    setBusy(dry ? "preview" : "save");
    setErr("");
    const r = await generateMonthlyCardAction(clientId, month, dry);
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
      <div style={{ fontSize: 14, fontWeight: 600, color: INK }}>🗓 Month&apos;s do&apos;s &amp; don&apos;ts</div>
      <p style={{ fontSize: 12.5, color: SEC, lineHeight: 1.5, margin: "5px 0 10px" }}>
        The living card for maintenance clients — seasonal + condition-aware. Drafted from this client&apos;s plan;
        saved onto the plan and shown on their app&apos;s maintenance home.
      </p>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <label style={{ fontSize: 12.5, color: SEC }}>Month</label>
        <input
          type="month"
          value={month}
          onChange={(e) => {
            setMonth(e.target.value || currentMonth());
            setSaved(false);
            setCard(null);
          }}
          style={{ fontSize: 12.5, padding: "6px 9px", borderRadius: 8, border: `1px solid ${LINE}`, color: INK, background: "transparent" }}
        />
      </div>

      {card && (
        <div style={{ border: `1px solid ${LINE}`, borderRadius: 10, padding: "10px 12px", marginBottom: 10, background: "var(--fm-surface-2, #faf8f3)" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: FOREST }}>{card.title}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 6 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: FOREST, textTransform: "uppercase", letterSpacing: 0.4 }}>Do</div>
              <ul style={{ margin: "4px 0 0", paddingLeft: 16, fontSize: 12, color: INK, lineHeight: 1.5 }}>
                {card.dos.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#a8472f", textTransform: "uppercase", letterSpacing: 0.4 }}>Don&apos;t</div>
              <ul style={{ margin: "4px 0 0", paddingLeft: 16, fontSize: 12, color: INK, lineHeight: 1.5 }}>
                {card.donts.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <button
          onClick={() => run(true)}
          disabled={busy !== null}
          style={{ fontSize: 12.5, padding: "7px 13px", borderRadius: 9, border: `1px solid ${LINE}`, background: "transparent", color: INK, cursor: "pointer" }}
        >
          {busy === "preview" ? "Drafting…" : card ? "Re-draft" : "Draft this month"}
        </button>
        {card && !saved && (
          <button
            onClick={() => run(false)}
            disabled={busy !== null}
            style={{ fontSize: 12.5, padding: "7px 13px", borderRadius: 9, border: "none", background: FOREST, color: "#fff", cursor: "pointer" }}
          >
            {busy === "save" ? "Saving…" : "Save to plan"}
          </button>
        )}
        {saved && <span style={{ fontSize: 12.5, color: FOREST, fontWeight: 600 }}>✓ Saved</span>}
      </div>
      {err && <div style={{ fontSize: 12, color: "#b3402a", marginTop: 7 }}>{err}</div>}
    </div>
  );
}
