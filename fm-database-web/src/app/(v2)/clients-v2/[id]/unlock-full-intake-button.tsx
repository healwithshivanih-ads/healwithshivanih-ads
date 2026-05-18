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
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { unlockFullIntake } from "@/lib/server-actions/intake";

interface Props {
  clientId: string;
  intakeSubmittedAt?: string | null;
  intakeFullUnlockedAt?: string | null;
}

export function UnlockFullIntakeButton({
  clientId,
  intakeSubmittedAt,
  intakeFullUnlockedAt,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Hide until client has filled at least the pre-discovery
  if (!intakeSubmittedAt) return null;

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

  // Already unlocked — show confirmation, no click action
  if (intakeFullUnlockedAt) {
    return (
      <div
        style={{
          padding: "10px 14px",
          background: "rgba(34, 197, 94, 0.08)",
          border: "1px solid rgba(34, 197, 94, 0.35)",
          borderRadius: "var(--fm-radius-md)",
          fontSize: 12.5,
          color: "#15803d",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span>✅</span>
        <div>
          <strong>Full intake unlocked</strong>{" "}
          <span style={{ color: "var(--fm-text-secondary)", fontSize: 11.5 }}>
            · {fmtTime(intakeFullUnlockedAt)}
          </span>
          <div style={{ fontSize: 11.5, color: "var(--fm-text-secondary)", marginTop: 2 }}>
            Same /intake/&lt;token&gt; URL — the client now sees the deeper
            sections (FM body systems, ACE, timeline, etc.) on top of their
            pre-discovery answers.
          </div>
        </div>
      </div>
    );
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
            fontSize: 12.5,
            fontWeight: 700,
            color: "#9a3412",
          }}
        >
          Client has signed up for the package?
        </div>
      </div>
      <div
        style={{
          fontSize: 11.5,
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
          fontSize: 12.5,
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
