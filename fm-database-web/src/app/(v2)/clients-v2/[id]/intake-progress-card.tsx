/**
 * IntakeProgressCard — at-a-glance "where are they in the intake?" card.
 *
 * Use case: coach wants to know quickly — "Has Sudarshan opened the
 * form? Started filling it? Have they submitted?" — without opening the
 * SendIntakeFormButton panel or looking at IntakeInsightsCard (which
 * only renders meaningful state after submit).
 *
 * Surfaces one of seven lifecycle stages computed from client.yaml fields:
 *   🚫 Not invited                — no intake_token on file
 *   📨 Sent, not opened           — token exists, intake_first_opened_at is null
 *   👀 Opened, not started        — first_opened_at set, draft is empty
 *   ✍  In progress                — draft has N non-empty fields
 *   📥 Submitted (still editable) — intake_submitted_at set, not finalised
 *   🔒 Finalised                  — coach locked
 *   ⏰ Link expired               — token present but expires_at is past
 *
 * Coach reads this top-of-overview, no clicks required.
 */
import Link from "next/link";
import { FmPanel } from "@/components/fm";

interface Props {
  clientId: string;
  firstName: string;
  intakeToken?: string | null;
  intakeTokenExpiresAt?: string | null;
  intakeFirstOpenedAt?: string | null;
  intakeFormDraft?: Record<string, unknown> | null;
  intakeFormDraftSavedAt?: string | null;
  intakeSubmittedAt?: string | null;
  intakeLastSubmittedAt?: string | null;
  intakeFinalisedAt?: string | null;
  intakeRemindersSentAt?: string[] | null;
}

/** Friendly "3 hours ago" / "2 days ago" — keeps the panel readable for
 *  glance-checks. Falls back to absolute date if > 7 days. */
function relativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const diffMs = Date.now() - t;
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin} min${diffMin === 1 ? "" : "s"} ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? "" : "s"} ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return `${diffDay} day${diffDay === 1 ? "" : "s"} ago`;
  return new Date(t).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Count meaningful (non-empty) entries in the draft dict. The intake
 *  form auto-saves the whole payload every section change so empty
 *  string / null / empty array fields are normal — we want a sense of
 *  "real progress", not raw key count. */
function countFilledFields(draft: Record<string, unknown> | null | undefined): number {
  if (!draft || typeof draft !== "object") return 0;
  let n = 0;
  for (const v of Object.values(draft)) {
    if (v == null) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === "object" && Object.keys(v as object).length === 0) continue;
    if (typeof v === "boolean" && v === false) continue; // unchecked checkboxes
    n++;
  }
  return n;
}

interface Stage {
  emoji: string;
  label: string;
  hint: string;
  tone: "neutral" | "info" | "progress" | "success" | "warn";
}

function deriveStage(p: Props): Stage {
  const now = Date.now();
  const expired =
    p.intakeTokenExpiresAt &&
    !p.intakeSubmittedAt &&
    Date.parse(p.intakeTokenExpiresAt) < now;

  if (p.intakeFinalisedAt) {
    return {
      emoji: "🔒",
      label: "Finalised",
      hint: `Locked ${relativeTime(p.intakeFinalisedAt)} — ${p.firstName} can no longer edit.`,
      tone: "success",
    };
  }
  if (p.intakeSubmittedAt || p.intakeLastSubmittedAt) {
    const ts = p.intakeLastSubmittedAt ?? p.intakeSubmittedAt!;
    return {
      emoji: "📥",
      label: "Submitted — still editable",
      hint: `${p.firstName} submitted ${relativeTime(ts)}. Path A: they can keep editing until you click Finalise.`,
      tone: "success",
    };
  }
  if (!p.intakeToken) {
    return {
      emoji: "🚫",
      label: "Not invited yet",
      hint: `No intake form has been generated for ${p.firstName}. Use Send intake form below.`,
      tone: "neutral",
    };
  }
  if (expired) {
    return {
      emoji: "⏰",
      label: "Link expired",
      hint: `The intake link expired before ${p.firstName} submitted. Regenerate to send a fresh one.`,
      tone: "warn",
    };
  }
  if (p.intakeFirstOpenedAt) {
    const filled = countFilledFields(p.intakeFormDraft ?? undefined);
    if (filled > 0) {
      return {
        emoji: "✍",
        label: "In progress",
        hint: `${p.firstName} has filled ${filled} field${filled === 1 ? "" : "s"} so far. Last save ${
          p.intakeFormDraftSavedAt ? relativeTime(p.intakeFormDraftSavedAt) : "—"
        }.`,
        tone: "progress",
      };
    }
    return {
      emoji: "👀",
      label: "Opened, not started",
      hint: `${p.firstName} clicked the link ${relativeTime(p.intakeFirstOpenedAt)} but hasn't filled anything yet.`,
      tone: "info",
    };
  }
  // Token sent, never opened.
  const reminders = p.intakeRemindersSentAt ?? [];
  const reminderHint = reminders.length > 0
    ? ` (${reminders.length} reminder${reminders.length === 1 ? "" : "s"} sent)`
    : "";
  return {
    emoji: "📨",
    label: "Sent, not yet opened",
    hint: `${p.firstName} hasn't clicked the link yet${reminderHint}.`,
    tone: "info",
  };
}

const TONE_BG: Record<Stage["tone"], string> = {
  neutral:  "rgba(148, 163, 184, 0.08)",
  info:     "rgba(59, 130, 246, 0.08)",
  progress: "rgba(245, 158, 11, 0.10)",
  success:  "rgba(16, 185, 129, 0.10)",
  warn:     "rgba(239, 68, 68, 0.08)",
};
const TONE_BORDER: Record<Stage["tone"], string> = {
  neutral:  "rgba(148, 163, 184, 0.30)",
  info:     "rgba(59, 130, 246, 0.30)",
  progress: "rgba(245, 158, 11, 0.40)",
  success:  "rgba(16, 185, 129, 0.35)",
  warn:     "rgba(239, 68, 68, 0.40)",
};

export function IntakeProgressCard(props: Props) {
  const stage = deriveStage(props);
  const reminderCount = props.intakeRemindersSentAt?.length ?? 0;

  return (
    <FmPanel
      title="📝 Intake form progress"
      subtitle="What stage of the intake is the client at right now?"
    >
      <div
        style={{
          padding: "12px 14px",
          background: TONE_BG[stage.tone],
          border: `1px solid ${TONE_BORDER[stage.tone]}`,
          borderRadius: 8,
          display: "grid",
          gap: 6,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 8,
            fontSize: 14,
            fontWeight: 700,
          }}
        >
          <span style={{ fontSize: 18 }}>{stage.emoji}</span>
          {stage.label}
        </div>
        <div style={{ fontSize: 12, lineHeight: 1.55, color: "var(--fm-text-secondary)" }}>
          {stage.hint}
        </div>

        {/* Inline timestamp ledger — gives coach the full audit trail
            without expanding anything. Reads top-to-bottom in the order
            events happen, so blanks are easy to spot. */}
        <div
          style={{
            marginTop: 6,
            paddingTop: 8,
            borderTop: `1px dashed ${TONE_BORDER[stage.tone]}`,
            display: "grid",
            gap: 3,
            fontSize: 10.5,
            color: "var(--fm-text-tertiary)",
          }}
        >
          <Row
            icon="📨"
            label="Invite sent"
            value={props.intakeToken ? "Active link on file" : "—"}
          />
          {reminderCount > 0 && (
            <Row
              icon="🔔"
              label={`Reminders sent (${reminderCount})`}
              value={
                props.intakeRemindersSentAt
                  ? relativeTime(props.intakeRemindersSentAt[props.intakeRemindersSentAt.length - 1])
                  : "—"
              }
            />
          )}
          <Row
            icon="👀"
            label="First opened"
            value={
              props.intakeFirstOpenedAt
                ? relativeTime(props.intakeFirstOpenedAt)
                : "—"
            }
          />
          <Row
            icon="✍"
            label="Last save"
            value={
              props.intakeFormDraftSavedAt
                ? relativeTime(props.intakeFormDraftSavedAt)
                : "—"
            }
          />
          <Row
            icon="📥"
            label="Submitted"
            value={
              props.intakeLastSubmittedAt
                ? relativeTime(props.intakeLastSubmittedAt)
                : props.intakeSubmittedAt
                  ? relativeTime(props.intakeSubmittedAt)
                  : "—"
            }
          />
          {props.intakeFinalisedAt && (
            <Row
              icon="🔒"
              label="Finalised"
              value={relativeTime(props.intakeFinalisedAt)}
            />
          )}
        </div>

        {(stage.label === "Submitted — still editable" ||
          stage.label === "In progress" ||
          stage.label === "Opened, not started") && (
          <Link
            href={`/clients-v2/${props.clientId}/intake-view`}
            style={{
              marginTop: 6,
              fontSize: 11.5,
              fontWeight: 600,
              color: "var(--fm-primary)",
              textDecoration: "none",
            }}
          >
            See what they&apos;ve filled →
          </Link>
        )}
      </div>
    </FmPanel>
  );
}

function Row({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
      <span style={{ width: 14, textAlign: "center", fontSize: 10 }}>{icon}</span>
      <span style={{ flex: 1, color: "var(--fm-text-secondary)" }}>{label}</span>
      <span style={{ fontWeight: 600, color: "var(--fm-text-primary)" }}>{value}</span>
    </div>
  );
}
