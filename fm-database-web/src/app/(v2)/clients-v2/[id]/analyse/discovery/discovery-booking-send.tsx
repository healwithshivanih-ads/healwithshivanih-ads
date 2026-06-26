"use client";

/**
 * DiscoveryBookingSend — the ONE send surface. Emails the client a single email
 * built from the recommended Acumen package (matches exactly what they book + pay
 * in the app), with any markers our partner can't run listed as "for your own
 * lab". Two-step flow: disabled until a package is recommended above.
 */

import { useState, type CSSProperties } from "react";
import { toast } from "sonner";
import { relativeTimeShort } from "@/lib/fmdb/session-utils";

const FIELD: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "7px 10px",
  fontSize: 13,
  fontFamily: "inherit",
  border: "1px solid var(--fm-border-light, #e6e1d6)",
  borderRadius: 8,
};

export function DiscoveryBookingSend({
  clientId,
  clientEmail,
  requestedLabs,
  hasOrder,
  lastSentAt,
}: {
  clientId: string;
  clientEmail: string | null;
  requestedLabs: string[];
  /** True once a (non-cancelled) package has been recommended for this client. */
  hasOrder: boolean;
  lastSentAt: string | null;
}) {
  const [to, setTo] = useState(clientEmail ?? "");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sentAt, setSentAt] = useState<string | null>(lastSentAt ?? null);

  if (!hasOrder) {
    return (
      <div style={{ fontSize: 12.5, color: "var(--fm-text-secondary, #6f6a5d)", lineHeight: 1.5 }}>
        Recommend a package above first — the email is built from it, so it matches exactly what the client books in the app.
      </div>
    );
  }

  const send = async () => {
    const addr = to.trim();
    if (!addr) {
      setOpen(true);
      toast.message("Add the client's email to send.");
      return;
    }
    if (sentAt && !confirm(`Already emailed ${relativeTimeShort(sentAt)} ago. Send again?`)) return;
    setBusy(true);
    try {
      const { emailLabBookingAction } = await import("@/lib/server-actions/lab-requisition");
      const r = await emailLabBookingAction({ clientId, to: addr, requestedLabs });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setSentAt(new Date().toISOString());
      setOpen(false);
      toast.success(`✓ Emailed ${addr} — books in their app, with any own-lab tests listed.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "send failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {(open || !clientEmail) && (
        <input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="client@email.com" style={FIELD} disabled={busy} />
      )}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button
          type="button"
          className="fm-btn"
          onClick={send}
          disabled={busy}
          style={sentAt ? undefined : { background: "var(--fm-accent, #2d5a3d)", color: "#fff" }}
        >
          {busy ? "Sending…" : sentAt ? `↻ Resend (sent ${relativeTimeShort(sentAt)})` : "📧 Email the client their booking"}
        </button>
        {sentAt && !busy && (
          <span style={{ fontSize: 11.5, color: "#2f7a3f", fontWeight: 600 }}>✓ Sent {relativeTimeShort(sentAt)}</span>
        )}
      </div>
      <div style={{ fontSize: 11.5, color: "var(--fm-text-tertiary, #8a8378)" }}>
        One email: book + pay in the app for the package, plus any tests to do at their own lab.
      </div>
    </div>
  );
}
