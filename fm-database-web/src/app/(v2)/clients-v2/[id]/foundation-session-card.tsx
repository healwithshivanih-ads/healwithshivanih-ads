"use client";

/**
 * FoundationSessionCard — coach-side control for the ₹12,000 "foundation
 * session" (the paid front door to the discovery flow). One click prepares the
 * client (app_token + full intake token, projected to Fly) and returns a public
 * pay link + a ready-to-send WhatsApp message. The client pays on
 * /foundation/<token>; that page then auto-surfaces their intake form + the
 * booking link. Payment lands in the separate "Ochre Life" Razorpay account.
 *
 * v1 is manual-send (copy link / open WhatsApp draft). Auto-send over WhatsApp
 * is a follow-up once the foundation templates are approved on Meta.
 */

import { useEffect, useState } from "react";
import { FmPanel } from "@/components/fm";
import { copyText } from "@/lib/copy-text";

interface FoundationStatus {
  paid: boolean;
  paidAt: string | null;
  intakeSubmitted: boolean;
  callBooked: boolean;
  callBookedFor: string | null;
}

interface Props {
  clientId: string;
  mobileNumber?: string | null;
  initialStatus?: FoundationStatus | null;
}

function whatsappHref(phone: string, text: string): string {
  const clean = phone.replace(/\D+/g, "");
  const e164 = clean.length === 10 ? `91${clean}` : clean;
  return `https://wa.me/${e164}?text=${encodeURIComponent(text)}`;
}

function humanDateTime(v: string | null): string {
  if (!v) return "";
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? v
    : d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function StepChip({ done, label }: { done: boolean; label: string }) {
  return (
    <span
      style={{
        fontSize: 12,
        padding: "3px 9px",
        borderRadius: 999,
        background: done ? "rgba(47,122,63,0.12)" : "rgba(0,0,0,0.05)",
        color: done ? "#2f7a3f" : "var(--fm-muted, #6f6a5d)",
        border: `1px solid ${done ? "rgba(47,122,63,0.25)" : "var(--fm-border-light, #e6e1d6)"}`,
      }}
    >
      {done ? "✓ " : "○ "}
      {label}
    </span>
  );
}

export function FoundationSessionCard({ clientId, mobileNumber, initialStatus }: Props) {
  const [payUrl, setPayUrl] = useState<string | null>(null);
  const [waText, setWaText] = useState<string>("");
  const [status, setStatus] = useState<FoundationStatus | null>(initialStatus ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  // Show progress at a glance without a click (paid / intake / booked).
  useEffect(() => {
    let live = true;
    if (initialStatus) return;
    (async () => {
      try {
        const { foundationSessionStatus } = await import("@/lib/server-actions/foundation-session");
        const out = await foundationSessionStatus(clientId);
        if (live && out.ok) {
          setStatus({
            paid: out.paid,
            paidAt: out.paidAt,
            intakeSubmitted: out.intakeSubmitted,
            callBooked: out.callBooked,
            callBookedFor: out.callBookedFor,
          });
        }
      } catch {
        /* non-fatal — the coach can still generate a link */
      }
    })();
    return () => {
      live = false;
    };
  }, [clientId, initialStatus]);

  const generate = async () => {
    setBusy(true);
    setError("");
    try {
      const { startFoundationSession } = await import("@/lib/server-actions/foundation-session");
      const out = await startFoundationSession(clientId);
      if (!out.ok) throw new Error(out.error);
      setPayUrl(out.payUrl);
      setWaText(out.waText);
      setStatus((s) => ({
        paid: out.paid,
        paidAt: s?.paidAt ?? null,
        intakeSubmitted: s?.intakeSubmitted ?? false,
        callBooked: s?.callBooked ?? false,
        callBookedFor: s?.callBookedFor ?? null,
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not generate link");
    } finally {
      setBusy(false);
    }
  };

  const refresh = async () => {
    setBusy(true);
    setError("");
    try {
      const { foundationSessionStatus } = await import("@/lib/server-actions/foundation-session");
      const out = await foundationSessionStatus(clientId);
      if (!out.ok) throw new Error(out.error);
      setStatus({
        paid: out.paid,
        paidAt: out.paidAt,
        intakeSubmitted: out.intakeSubmitted,
        callBooked: out.callBooked,
        callBookedFor: out.callBookedFor,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not refresh");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!payUrl) return;
    try {
      await copyText(payUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard denied */
    }
  };

  return (
    <FmPanel
      title="🌿 Foundation session"
      subtitle="Send the ₹12,000 pay link — the client then gets their intake form + booking link"
    >
      <div style={{ display: "grid", gap: 10 }}>
        {status && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <StepChip done={status.paid} label={status.paid ? `Paid${status.paidAt ? " " + humanDateTime(status.paidAt) : ""}` : "Payment"} />
            <StepChip done={status.intakeSubmitted} label="Intake" />
            <StepChip done={status.callBooked} label={status.callBooked && status.callBookedFor ? `Booked ${humanDateTime(status.callBookedFor)}` : "Call booked"} />
            <button className="fm-btn" onClick={refresh} disabled={busy} style={{ marginLeft: "auto", fontSize: 12 }}>
              {busy ? "…" : "↻ Refresh"}
            </button>
          </div>
        )}

        {!payUrl ? (
          <>
            <div style={{ fontSize: 13, color: "var(--fm-muted, #6f6a5d)", lineHeight: 1.45 }}>
              Prepares the client (app link + intake form, ready) and gives you a pay link to send. The
              moment they pay, that page walks them into their intake form and booking a call — no
              further action from you.
            </div>
            <button className="fm-btn" onClick={generate} disabled={busy} style={{ justifySelf: "start" }}>
              {busy ? "Preparing…" : "🌿 Generate foundation pay link"}
            </button>
          </>
        ) : (
          <>
            <code
              style={{ fontSize: 12, wordBreak: "break-all", background: "rgba(0,0,0,0.04)", borderRadius: 8, padding: "8px 10px" }}
            >
              {payUrl}
            </code>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <button className="fm-btn" onClick={copy}>
                {copied ? "✓ Copied" : "📋 Copy pay link"}
              </button>
              {mobileNumber && waText && (
                <a className="fm-btn" href={whatsappHref(mobileNumber, waText)} target="_blank" rel="noreferrer">
                  💬 Send on WhatsApp
                </a>
              )}
            </div>
            <div style={{ fontSize: 12, color: "var(--fm-muted, #6f6a5d)" }}>
              After payment the client is taken straight to their intake form and booking link — nothing
              more to do here. Tap ↻ Refresh to see their progress.
            </div>
          </>
        )}
        {error && <div style={{ fontSize: 12.5, color: "#b3402a" }}>{error}</div>}
      </div>
    </FmPanel>
  );
}
