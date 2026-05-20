"use client";

/**
 * UnlockFullIntakeButton (v0.75) — coach-side trigger to flip the intake
 * form from pre-discovery to full. Typically clicked after the client
 * signs up for the package.
 *
 * Same /intake/<token> URL the client already has now serves the full
 * 3693-line form (existing IntakeForm component) with a "welcome back,
 * a few more things now that we're working together" banner. Pre-
 * discovery answers are preserved as prefill.
 *
 * Side effect: also sets engagement_status = 'signed_up' (this IS the
 * canonical signup signal).
 *
 * Visibility:
 *  - Hidden entirely until client has submitted pre-discovery
 *    (intake_submitted_at is set)
 *  - Active state: orange "Unlock full intake" button
 *  - Already-unlocked state: green confirmation with timestamp
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { unlockFullIntake, sendIntakeUnlockedViaApi } from "@/lib/server-actions/intake";

interface Props {
  clientId: string;
  intakeSubmittedAt?: string | null;
  intakeFullUnlockedAt?: string | null;
  /** Fallback signal — Haiku-summarised insights only run after a real
   *  submission, so this proves the client submitted at some point even
   *  when intake_submitted_at got wiped by a token regen (legacy bug
   *  patched 2026-05-19; keep this fallback so historical clients still
   *  surface the unlock button correctly). */
  intakeInsightsGeneratedAt?: string | null;
}

export function UnlockFullIntakeButton({
  clientId,
  intakeSubmittedAt,
  intakeFullUnlockedAt,
  intakeInsightsGeneratedAt,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Hide until client has filled at least the pre-discovery.
  // Tolerate intake_submitted_at being wiped — insights are an
  // equivalent historical proof of submission.
  const everSubmitted = !!(intakeSubmittedAt || intakeInsightsGeneratedAt);
  if (!everSubmitted) return null;

  const fmtTime = (iso: string) => {
    try {
      const d = new Date(iso);
      return `${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })} ${d.toLocaleTimeString(
        undefined,
        { hour: "2-digit", minute: "2-digit" },
      )}`;
    } catch {
      return iso;
    }
  };

  // Already unlocked — show confirmation + optional "notify client" CTA
  if (intakeFullUnlockedAt) {
    return <UnlockedConfirmation clientId={clientId} unlockedAt={intakeFullUnlockedAt} fmtTime={fmtTime} />;
  }

  const onClick = () => {
    startTransition(async () => {
      const res = await unlockFullIntake(clientId);
      if (res.ok) {
        toast.success("🔓 Full intake unlocked + marked as signed up");
        router.refresh();
      } else {
        toast.error(res.error ?? "Unlock failed", { duration: 10000 });
      }
    });
  };

  return (
    <div
      style={{
        padding: "12px 14px",
        background: "rgba(255, 107, 53, 0.08)",
        border: "1.5px solid rgba(255, 107, 53, 0.35)",
        borderRadius: "var(--fm-radius-md)",
        display: "grid",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 16 }}>🔓</span>
        <div
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: "#9a3412",
          }}
        >
          Client has signed up for the package?
        </div>
      </div>
      <div
        style={{
          fontSize: 12,
          color: "var(--fm-text-secondary)",
          lineHeight: 1.45,
        }}
      >
        Unlock the full intake form. The client returns to the same intake
        link and sees the deeper sections (FM body systems, ACE, timeline,
        cycle deep-dive, etc.) appended below their pre-discovery answers.
        Also marks engagement_status = signed_up.
      </div>
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        style={{
          padding: "8px 14px",
          fontSize: 13,
          fontWeight: 700,
          background: pending ? "#94a3b8" : "#ff6b35",
          color: "#fff",
          border: "none",
          borderRadius: "var(--fm-radius-sm)",
          cursor: pending ? "wait" : "pointer",
          fontFamily: "inherit",
          width: "fit-content",
        }}
      >
        {pending ? "Unlocking…" : "🔓 Unlock full intake + mark signed up"}
      </button>
    </div>
  );
}

/**
 * v0.75.9 — post-unlock confirmation tile with one-click "Notify client"
 * WhatsApp send. Uses `sendIntakeUnlockedViaApi` which env-switches
 * between two templates:
 *   - fm_intake_unlocked_v1 (welcome-back copy) when
 *     FM_INTAKE_UNLOCKED_TEMPLATE_APPROVED=1
 *   - fm_intake_invite (always-approved fallback) otherwise
 *
 * Submitted to Meta 2026-05-18 (PENDING). Once it clears, flip the env
 * flag on the Mac:
 *   echo 'FM_INTAKE_UNLOCKED_TEMPLATE_APPROVED=1' >> .env.local
 *   pm2 restart fm-coach --update-env
 */
function UnlockedConfirmation({
  clientId,
  unlockedAt,
  fmtTime,
}: {
  clientId: string;
  unlockedAt: string;
  fmtTime: (iso: string) => string;
}) {
  const [notifyPending, startNotify] = useTransition();
  const [notified, setNotified] = useState<"idle" | "sent" | "failed">("idle");

  const onNotify = () => {
    startNotify(async () => {
      const res = await sendIntakeUnlockedViaApi(clientId);
      if (res.ok) {
        setNotified("sent");
        const usingUnlockTemplate = res.template === "fm_intake_unlocked_v1";
        toast.success(
          usingUnlockTemplate
            ? "📨 Client notified via fm_intake_unlocked_v1 (welcome-back copy)"
            : "📨 Client notified — using fm_intake_invite fallback (set FM_INTAKE_UNLOCKED_TEMPLATE_APPROVED=1 once the dedicated template clears Meta)",
        );
        setTimeout(() => setNotified("idle"), 8000);
      } else {
        setNotified("failed");
        toast.error(res.error ?? "WhatsApp send failed", { duration: 10000 });
      }
    });
  };

  return (
    <div
      style={{
        padding: "10px 14px",
        background: "rgba(34, 197, 94, 0.08)",
        border: "1px solid rgba(34, 197, 94, 0.35)",
        borderRadius: "var(--fm-radius-md)",
        fontSize: 13,
        color: "#15803d",
        display: "grid",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span>✅</span>
        <div>
          <strong>Full intake unlocked</strong>{" "}
          <span style={{ color: "var(--fm-text-secondary)", fontSize: 12 }}>
            · {fmtTime(unlockedAt)}
          </span>
          <div style={{ fontSize: 12, color: "var(--fm-text-secondary)", marginTop: 2 }}>
            Same /intake/&lt;token&gt; URL — client returns to it and sees
            the welcome-back screen + deeper sections (FM body systems,
            ACE, timeline, Joints &amp; standing, etc.) on top of their
            pre-discovery answers.
          </div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          type="button"
          onClick={onNotify}
          disabled={notifyPending || notified === "sent"}
          style={{
            padding: "5px 12px",
            fontSize: 12,
            fontWeight: 700,
            background:
              notified === "sent"
                ? "rgba(34, 197, 94, 0.25)"
                : notifyPending
                ? "#94a3b8"
                : "transparent",
            color: notified === "sent" ? "#15803d" : "#15803d",
            border: `1px solid ${notified === "sent" ? "transparent" : "rgba(34, 197, 94, 0.4)"}`,
            borderRadius: "var(--fm-radius-sm)",
            cursor: notifyPending || notified === "sent" ? "default" : "pointer",
            fontFamily: "inherit",
          }}
        >
          {notified === "sent"
            ? "✓ WhatsApp sent"
            : notifyPending
              ? "Sending…"
              : "📨 Notify client via WhatsApp"}
        </button>
        <span style={{ fontSize: 11, color: "var(--fm-text-tertiary)" }}>
          Re-sends the intake link with the welcome-back screen
        </span>
      </div>
    </div>
  );
}
