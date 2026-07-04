"use client";

/**
 * WelcomeEmailCard — manual send/resend for the static welcome email
 * (the no-AI onboarding guide that replaced the Sonnet welcome letter).
 *
 * Auto-send fires once on FIRST plan publish (plan-lifecycle.ts); this
 * card covers everyone else: clients published before the feature
 * existed (backfill) and deliberate re-sends. Sent state is PERSISTED —
 * derived server-side from _send_log.yaml (letter_types includes
 * "welcome") and passed in as `lastSentAt`, so it survives reloads
 * (send-buttons-persist rule).
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { sendWelcomeEmailAction } from "@/lib/server-actions/welcome-email";

export function WelcomeEmailCard({
  clientId,
  planSlug,
  firstName,
  clientEmail,
  lastSentAt,
}: {
  clientId: string;
  /** Active published plan slug — the email's /app link resolves via its
   *  letter_token. Null → no published plan yet, card shows why. */
  planSlug: string | null;
  firstName: string;
  clientEmail?: string;
  /** ISO timestamp of the last recorded "welcome" send, or null. */
  lastSentAt: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Optimistic local stamp so the card flips instantly; server truth
  // re-arrives on refresh().
  const [justSent, setJustSent] = useState<string | null>(null);
  const sentAt = justSent ?? lastSentAt;

  const email = (clientEmail ?? "").trim();
  const blocked = !planSlug
    ? "Publish the plan first — the email carries their app link."
    : !email
      ? "No email on file — add one on the Overview tab."
      : null;

  const send = () =>
    startTransition(async () => {
      if (!planSlug) return;
      const res = await sendWelcomeEmailAction(clientId, planSlug);
      if (res.ok) {
        setJustSent(new Date().toISOString());
        toast.success(`Welcome email sent to ${email}`);
        router.refresh();
      } else {
        toast.error(res.error, { duration: 9000 });
      }
    });

  const stamp = sentAt
    ? new Date(sentAt).toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
        border: "1px solid var(--fm-border, #DED8C9)",
        borderLeft: "4px solid #B85C3E",
        borderRadius: 10,
        background: "#FFFDF8",
        padding: "12px 16px",
        margin: "10px 0",
      }}
    >
      <div style={{ flex: "1 1 260px", minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: "#3E5641" }}>
          📬 Welcome email — the app guide
        </div>
        <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
          {sentAt
            ? `Sent ${stamp}${email ? ` to ${email}` : ""}. Tab-by-tab guide + ${firstName}'s app link.`
            : blocked
              ? blocked
              : `Sends ${firstName} the tab-by-tab app guide with their personal app link. Auto-sends on first publish; use this for clients from before, or to re-send.`}
        </div>
      </div>
      <button
        type="button"
        onClick={send}
        disabled={pending || !!blocked}
        style={{
          fontSize: 12.5,
          fontWeight: 700,
          padding: "8px 16px",
          borderRadius: 8,
          border: "none",
          cursor: pending || blocked ? "default" : "pointer",
          background: sentAt ? "transparent" : "#B85C3E",
          color: sentAt ? "#047857" : "#fff",
          boxShadow: sentAt ? "inset 0 0 0 1px rgba(4,120,87,.35)" : undefined,
          whiteSpace: "nowrap",
          opacity: blocked ? 0.55 : 1,
        }}
        title={blocked ?? undefined}
      >
        {pending ? "Sending…" : sentAt ? "✓ Sent · Resend" : "Send welcome email"}
      </button>
    </div>
  );
}
