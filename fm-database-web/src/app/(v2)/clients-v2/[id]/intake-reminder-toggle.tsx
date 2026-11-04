"use client";

/**
 * IntakeReminderToggle — the coach's switch for the automatic intake
 * reminders (`/api/cron/intake-reminders`, at most 2 per link, ≥5 days apart).
 *
 * Off unless the coach turns it on: a new link no longer switches reminders
 * on by itself, because the cron cannot tell a one-off Foundation client whose
 * call is done from someone still being onboarded.
 */
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

interface Props {
  clientId: string;
  enabled: boolean;
}

export function IntakeReminderToggle({ clientId, enabled }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const onToggle = () => {
    startTransition(async () => {
      const { setIntakeReminders } = await import("@/lib/server-actions/intake");
      const res = await setIntakeReminders(clientId, !enabled);
      if (res.ok) {
        toast.success(res.intake_reminder_enabled ? "Reminders on" : "Reminders off");
        router.refresh();
      } else {
        toast.error(`Couldn't change reminders — ${res.error}`);
      }
    });
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
      <span style={{ fontSize: 12, color: "var(--fm-text-secondary)" }}>
        {enabled
          ? "🔔 Automatic reminders on (up to 2, five days apart)"
          : "🔕 No automatic reminders"}
      </span>
      <button
        type="button"
        onClick={onToggle}
        disabled={pending}
        style={{
          padding: "4px 10px",
          fontSize: 11,
          fontWeight: 600,
          background: "transparent",
          color: "var(--fm-text-primary)",
          border: "1px solid var(--fm-border)",
          borderRadius: "var(--fm-radius-sm)",
          cursor: pending ? "wait" : "pointer",
          fontFamily: "inherit",
        }}
      >
        {pending ? "Saving…" : enabled ? "Turn off" : "Turn on"}
      </button>
    </div>
  );
}
