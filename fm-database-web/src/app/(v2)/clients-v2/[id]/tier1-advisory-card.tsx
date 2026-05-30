"use client";

/**
 * Tier1AdvisoryCard — coach-side flash that appears on the Overview
 * when something in the submitted intake suggests the Tier 1 screen
 * (Beighton + NASA lean + PEM + mould) would be worth re-issuing.
 *
 * Coach feedback 2026-05-24: Section 11 was removed from the default
 * intake form. Detection now happens HERE (server-side via
 * detectTier1Advisory) and the coach gets a single-tap "Reissue Tier 1"
 * button that fires the existing fm_intake_topup_v1 WhatsApp template
 * with ?focus=tier1.
 *
 * Self-hides when detector returns null (no signals) or when the client
 * has already filled the Tier 1 fields.
 */

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { FmPanel, FmChip } from "@/components/fm";
import type { Tier1Advisory } from "@/lib/fmdb/tier1-advisory";
import { getLastSentAtAction } from "@/app/api/whatsapp/actions";
import { relativeTimeShort } from "@/lib/fmdb/session-utils";

interface Props {
  clientId: string;
  advisory: Tier1Advisory | null;
}

export function Tier1AdvisoryCard({ clientId, advisory }: Props) {
  const [pending, startTransition] = useTransition();
  const [dismissed, setDismissed] = useState(false);
  const [sent, setSent] = useState<"idle" | "sent" | "failed">("idle");
  // Persisted sent_at loaded from disk — survives page reload.
  // Durable rule: feedback_send_buttons_persist_state 2026-05-23.
  const [lastSentAt, setLastSentAt] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { sentAt } = await getLastSentAtAction(clientId, "fm_intake_topup_v1");
      setLastSentAt(sentAt);
    })();
  }, [clientId]);

  if (!advisory || dismissed) return null;

  const handleReissue = () => {
    startTransition(async () => {
      const { reissueTierOneIntakeAction } = await import(
        "@/lib/server-actions/intake"
      );
      const res = await reissueTierOneIntakeAction(clientId);
      if (res.ok) {
        setSent("sent");
        setLastSentAt(new Date().toISOString());
        toast.success(
          res.via === "free_text"
            ? "📨 Tier 1 link sent via free-text (template fallback)"
            : "📨 Tier 1 intake re-issued via fm_intake_topup_v1",
        );
      } else {
        setSent("failed");
        toast.error(res.error, { duration: 10000 });
      }
    });
  };

  // Amber flash — between rose (urgent / red flag) and indigo (informational).
  // Always-open: the whole point is that coach sees this without expanding.
  return (
    <FmPanel
      title={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span>⚡ Consider Tier 1 screen</span>
          <FmChip tone="warning">{advisory.signal_count} signal{advisory.signal_count === 1 ? "" : "s"}</FmChip>
        </span>
      }
      tight
    >
      <div
        style={{
          background: "rgba(245, 158, 11, 0.07)",
          border: "1px solid rgba(245, 158, 11, 0.30)",
          borderRadius: 6,
          padding: "10px 12px",
          display: "grid",
          gap: 10,
        }}
      >
        <div
          style={{
            fontSize: 12.5,
            lineHeight: 1.5,
            color: "var(--fm-text-primary)",
          }}
        >
          {advisory.headline}. Tier 1 captures Beighton hypermobility,
          NASA-lean orthostatic check, PEM screen, and mould exposure —
          relevant before any aggressive detox, exercise prescription,
          or stimulant supplementation.
        </div>

        <ul
          style={{
            margin: 0,
            paddingLeft: 0,
            display: "grid",
            gap: 6,
            listStyle: "none",
          }}
        >
          {advisory.signals.map((s, i) => (
            <li
              key={i}
              style={{
                fontSize: 12,
                lineHeight: 1.45,
                background: "var(--fm-surface)",
                border: "1px solid var(--fm-border-light)",
                borderRadius: 4,
                padding: "6px 9px",
                display: "grid",
                gap: 2,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <strong style={{ color: "#92400e", fontSize: 12 }}>
                  {s.label}
                </strong>
                <span
                  style={{
                    fontSize: 10,
                    color: "var(--fm-text-tertiary)",
                    fontStyle: "italic",
                  }}
                >
                  {s.source_field}
                </span>
              </div>
              <div
                style={{
                  fontSize: 11.5,
                  color: "var(--fm-text-secondary)",
                  fontStyle: "italic",
                }}
              >
                &ldquo;…{s.evidence}…&rdquo;
              </div>
            </li>
          ))}
        </ul>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={handleReissue}
            disabled={pending}
            style={{
              padding: "6px 14px",
              fontSize: 12,
              fontWeight: 700,
              background:
                sent === "sent" || lastSentAt
                  ? "rgba(34, 197, 94, 0.18)"
                  : pending
                    ? "#94a3b8"
                    : "#f59e0b",
              color: sent === "sent" || lastSentAt ? "#15803d" : "#fff",
              border: sent === "sent" || lastSentAt ? "1px solid rgba(34,197,94,0.35)" : "none",
              borderRadius: 5,
              cursor: pending ? "default" : "pointer",
              fontFamily: "inherit",
            }}
          >
            {sent === "sent"
              ? "✓ Tier 1 re-issued"
              : pending
                ? "Sending…"
                : lastSentAt
                  ? `✓ Sent ${relativeTimeShort(lastSentAt)} · Resend`
                  : "📨 Reissue intake with Tier 1 screen"}
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            style={{
              padding: "5px 10px",
              fontSize: 11,
              background: "transparent",
              color: "var(--fm-text-tertiary)",
              border: "1px solid var(--fm-border)",
              borderRadius: 5,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
            title="Hide this card until next reload — won't change anything on disk"
          >
            Dismiss for now
          </button>
        </div>
      </div>
    </FmPanel>
  );
}
