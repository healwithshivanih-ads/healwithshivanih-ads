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
  const [mode, setMode] = useState<"change" | "activate">("change");
  const [whatChanged, setWhatChanged] = useState("");
  const [why, setWhy] = useState("");
  // Persisted send state — most recent supplement-change / activate / order send.
  const [sentAt, setSentAt] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [a, b, c] = await Promise.all([
        getLastSentAtAction(clientId, "fm_supplement_change_v1"),
        getLastSentAtAction(clientId, "fm_supplement_activate_v1"),
        getLastSentAtAction(clientId, "fm_supplement_order_v2"),
      ]);
      const latest = [a.sentAt, b.sentAt, c.sentAt].filter(Boolean).sort().reverse()[0] ?? null;
      setSentAt(latest);
    })();
  }, [clientId]);

  const canSendDetailed = whatChanged.trim().length > 0 && why.trim().length > 0;

  const onNotify = () => {
    start(async () => {
      const r = await notifySupplementChangeAction({
        clientId,
        planSlug,
        mode,
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

  const isActivate = mode === "activate";
  const copy = isActivate
    ? {
        title: "📦 Notify client: supplement now starting",
        subtitle:
          "For a supplement already in the plan that's now due to start. Sets the in-app banner and sends a WhatsApp.",
        f1: "Which supplement is starting now",
        f1ph: "Magnesium glycinate — 1 capsule at bedtime.",
        f2: "Why now / how to take it",
        f2ph: "We planned to add this once your routine settled — it supports sleep and calm.",
        btn: "📦 Notify: supplement starting",
      }
    : {
        title: "📦 Notify client: supplements changed",
        subtitle:
          "For a change to the supplements (swap / new / dose). Sets the in-app banner and sends a WhatsApp.",
        f1: "What changed this period",
        f1ph: "Your four separate B-vitamins are now one combined capsule (Homocysteine Defence B Complex).",
        f2: "Why",
        f2ph: "It’s simpler to take every day and gives you the same nutrients at better doses.",
        btn: "📦 Notify: supplements changed",
      };

  const segStyle = (active: boolean) => ({
    padding: "5px 12px",
    borderRadius: 6,
    border: "none",
    fontSize: 12.5,
    fontWeight: 600,
    cursor: pending ? ("wait" as const) : ("pointer" as const),
    background: active ? "#059669" : "transparent",
    color: active ? "white" : "var(--fm-text-secondary)",
  });

  return (
    <FmPanel title={copy.title} subtitle={copy.subtitle}>
      <div style={{ display: "grid", gap: 10 }}>
        <div
          style={{
            display: "inline-flex",
            gap: 4,
            background: "var(--fm-surface-2, #f1f1f1)",
            padding: 3,
            borderRadius: 8,
            width: "fit-content",
          }}
        >
          <button type="button" onClick={() => setMode("change")} disabled={pending} style={segStyle(!isActivate)}>
            Changed
          </button>
          <button type="button" onClick={() => setMode("activate")} disabled={pending} style={segStyle(isActivate)}>
            Now starting
          </button>
        </div>

        <label style={{ display: "grid", gap: 4 }}>
          <span style={{ fontSize: 12, color: "var(--fm-text-secondary)" }}>{copy.f1}</span>
          <textarea
            value={whatChanged}
            onChange={(e) => setWhatChanged(e.target.value)}
            disabled={pending}
            rows={2}
            placeholder={copy.f1ph}
            style={fieldStyle}
          />
        </label>

        <label style={{ display: "grid", gap: 4 }}>
          <span style={{ fontSize: 12, color: "var(--fm-text-secondary)" }}>{copy.f2}</span>
          <textarea
            value={why}
            onChange={(e) => setWhy(e.target.value)}
            disabled={pending}
            rows={2}
            placeholder={copy.f2ph}
            style={fieldStyle}
          />
        </label>

        {!canSendDetailed && (whatChanged.trim() || why.trim()) ? (
          <FmChip tone="neutral">
            Fill in both fields to send the detailed message — otherwise a plain order link goes out.
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
                : copy.btn}
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
