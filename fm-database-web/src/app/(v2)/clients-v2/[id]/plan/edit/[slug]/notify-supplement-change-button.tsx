"use client";

/**
 * NotifySupplementChangeButton — one coach button that tells a client "your
 * supplements changed" through BOTH channels at once:
 *
 *   • sets the in-app "Plan updated" banner on the published plan
 *   • sends the fm_supplement_order_v2 WhatsApp with the supplement-order link
 *
 * Use it after editing the supplement protocol on a live plan (swap an item,
 * change a dose, add a new supplement). Reuses notifySupplementChangeAction —
 * no new template, no new send plumbing.
 *
 * Durable send-state (feedback-send-buttons-persist-state): on mount it reads
 * the last fm_supplement_order_v2 send from the WhatsApp thread and renders
 * "✓ Notified · {ago}" so the coach can see it already went out (and Resend if
 * needed) instead of a transient toast that vanishes on reload.
 *
 * Published plans only — there's nothing for the client to be "notified" about
 * until the plan is live. The parent page mounts it inside the same
 * status === "published" block as StartConfirmLinkButton.
 */

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { FmPanel, FmChip } from "@/components/fm";
import { notifySupplementChangeAction } from "@/lib/server-actions/supplement-change-notify";
import { getLastSentAtAction } from "@/app/api/whatsapp/actions";
import { relativeTimeShort } from "@/lib/fmdb/session-utils";

interface Props {
  clientId: string;
  planSlug: string;
  /** Whether the client has a mobile number on file — drives the WA note. */
  hasPhone?: boolean;
}

export function NotifySupplementChangeButton({ clientId, planSlug, hasPhone }: Props) {
  const [pending, start] = useTransition();
  const [whatChanged, setWhatChanged] = useState("");
  const [why, setWhy] = useState("");
  // Persisted send state — most recent supplement-change / order send.
  const [sentAt, setSentAt] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [a, b] = await Promise.all([
        getLastSentAtAction(clientId, "fm_supplement_change_v1"),
        getLastSentAtAction(clientId, "fm_supplement_order_v2"),
      ]);
      const latest = [a.sentAt, b.sentAt].filter(Boolean).sort().reverse()[0] ?? null;
      setSentAt(latest);
    })();
  }, [clientId]);

  const canSendDetailed = whatChanged.trim().length > 0 && why.trim().length > 0;

  const onNotify = () => {
    start(async () => {
      const r = await notifySupplementChangeAction({
        clientId,
        planSlug,
        whatChanged: whatChanged.trim() || undefined,
        why: why.trim() || undefined,
      });

      // Banner half — always attempted first, so surface it even on partial.
      if (r.flagged) {
        if (r.whatsapp_sent) {
          setSentAt(new Date().toISOString());
          toast.success("📦 Client notified — “Plan updated” banner set + WhatsApp sent");
        } else {
          // Banner set but WhatsApp couldn't run (no phone / send error).
          toast.warning(
            `“Plan updated” banner set, but WhatsApp didn't send${r.error ? ` — ${r.error}` : ""}`,
          );
        }
      } else {
        toast.error(r.error || "Couldn't notify the client");
      }
    });
  };

  const fieldStyle = {
    fontSize: 13,
    padding: "8px 10px",
    border: "1px solid var(--fm-border)",
    borderRadius: "var(--fm-radius-sm)",
    width: "100%",
    resize: "vertical" as const,
    fontFamily: "inherit",
  };

  return (
    <FmPanel
      title="📦 Notify client: supplements changed"
      subtitle="Sets the in-app “Plan updated” banner and sends a WhatsApp stating what changed, why, and a link to order."
    >
      <div style={{ display: "grid", gap: 10 }}>
        <label style={{ display: "grid", gap: 4 }}>
          <span style={{ fontSize: 12, color: "var(--fm-text-secondary)" }}>
            What changed this period
          </span>
          <textarea
            value={whatChanged}
            onChange={(e) => setWhatChanged(e.target.value)}
            disabled={pending}
            rows={2}
            placeholder="Your four separate B-vitamins are now one combined capsule (Homocysteine Defence B Complex)."
            style={fieldStyle}
          />
        </label>

        <label style={{ display: "grid", gap: 4 }}>
          <span style={{ fontSize: 12, color: "var(--fm-text-secondary)" }}>Why</span>
          <textarea
            value={why}
            onChange={(e) => setWhy(e.target.value)}
            disabled={pending}
            rows={2}
            placeholder="It’s simpler to take every day and gives you the same nutrients at better doses."
            style={fieldStyle}
          />
        </label>

        {!canSendDetailed && (whatChanged.trim() || why.trim()) ? (
          <FmChip tone="neutral">
            Fill in both “what changed” and “why” to send the detailed message — otherwise a plain order link goes out.
          </FmChip>
        ) : null}

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={onNotify}
            disabled={pending}
            style={{
              padding: "9px 14px",
              borderRadius: 8,
              background: "#059669",
              color: "white",
              border: "none",
              cursor: pending ? "wait" : "pointer",
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            {pending
              ? "Notifying…"
              : sentAt
                ? `✓ Notified · ${relativeTimeShort(sentAt)} · Resend`
                : "📦 Notify client: supplements changed"}
          </button>

          {!hasPhone && (
            <FmChip tone="neutral">
              No mobile number on file — the banner is still set, WhatsApp is skipped
            </FmChip>
          )}
        </div>
      </div>
    </FmPanel>
  );
}
