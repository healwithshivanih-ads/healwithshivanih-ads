"use client";

/**
 * CallKindRecorder — "which call was this?" Free or paid, and on what date.
 *
 * A discovery call can be the FREE 15-minute call or the PAID ₹12,000
 * Foundation session, and they must be recorded differently:
 *
 *   paid → starts the 15-day ₹12,000 credit countdown in the client's app and
 *          reveals their Starting Map; follow-up emails offer the programme.
 *   free → no credit anywhere; follow-up emails offer the Foundation session.
 *
 * The old single "Discovery call done" button could only record the paid kind,
 * so a free call marked with it silently handed the person a ₹12,000 credit in
 * their app. Nothing is pre-selected here on purpose: the coach has to choose.
 * (When a paid Foundation order exists, "free" is disabled.)
 */
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { recordDiscoveryCallAction } from "@/lib/server-actions/discovery-followup";
import { humanDate } from "@/lib/fmdb/discovery-followup";

function istToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

export function CallKindRecorder({
  clientId,
  clientName,
  foundationPaid = false,
  compact = false,
  onRecorded,
}: {
  clientId: string;
  clientName?: string;
  /** A paid Foundation order exists — free is then not a valid answer. */
  foundationPaid?: boolean;
  compact?: boolean;
  onRecorded?: (kind: "free" | "paid", date: string, creditExpiresOn: string | null) => void;
}) {
  const [kind, setKind] = useState<"free" | "paid" | null>(null);
  const [date, setDate] = useState(istToday());
  const [pending, startTransition] = useTransition();

  const save = () => {
    if (!kind) return;
    startTransition(async () => {
      const r = await recordDiscoveryCallAction(clientId, kind, date);
      if (!r.ok) {
        toast.error(r.error || "Could not record the call");
        return;
      }
      toast.success(
        kind === "paid"
          ? `Recorded as the paid Foundation session — ₹12,000 credit open until ${r.creditExpiresOn ? humanDate(r.creditExpiresOn) : "15 days from the call"}`
          : `Recorded as a free call${clientName ? ` for ${clientName}` : ""} — no credit; follow-up emails will offer the Foundation session`,
      );
      onRecorded?.(kind, date, r.creditExpiresOn ?? null);
    });
  };

  const option = (value: "free" | "paid", title: string, detail: string, disabled = false) => (
    <label
      style={{
        display: "flex",
        gap: 8,
        alignItems: "flex-start",
        padding: compact ? "5px 8px" : "8px 10px",
        border: `1px solid ${kind === value ? "#6b8e6b" : "var(--fm-border-light, #e6e1d6)"}`,
        background: kind === value ? "rgba(107,142,107,0.08)" : "transparent",
        borderRadius: 8,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        flex: "1 1 220px",
      }}
    >
      <input
        type="radio"
        name={`call-kind-${clientId}`}
        checked={kind === value}
        disabled={disabled}
        onChange={() => setKind(value)}
        style={{ marginTop: 3 }}
      />
      <span>
        <span style={{ fontSize: 12.5, fontWeight: 700, display: "block" }}>{title}</span>
        {!compact && <span style={{ fontSize: 11.5, color: "var(--fm-muted, #6f6a5d)", lineHeight: 1.4 }}>{detail}</span>}
      </span>
    </label>
  );

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700 }}>Which call did they have?</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {option(
          "free",
          "Free discovery call",
          "No credit. Follow-up emails offer the Foundation session.",
          foundationPaid,
        )}
        {option(
          "paid",
          "Paid Foundation session (₹12,000)",
          "Starts the 15-day ₹12,000 credit towards the programme in their app and reveals their Starting Map.",
        )}
      </div>
      {foundationPaid && (
        <div style={{ fontSize: 11.5, color: "var(--fm-muted, #6f6a5d)" }}>
          They have a paid Foundation order, so this can only be the paid session.
        </div>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ fontSize: 12, color: "var(--fm-muted, #6f6a5d)" }}>
          Call date{" "}
          <input
            type="date"
            value={date}
            max={istToday()}
            onChange={(e) => setDate(e.target.value)}
            style={{ fontSize: 12, padding: "3px 6px", border: "1px solid var(--fm-border)", borderRadius: 6, fontFamily: "inherit" }}
          />
        </label>
        <button type="button" className="fm-btn" onClick={save} disabled={!kind || !date || pending}>
          {pending ? "Saving…" : kind === "paid" ? "✓ Record paid session" : kind === "free" ? "✓ Record free call" : "Choose free or paid"}
        </button>
      </div>
    </div>
  );
}
