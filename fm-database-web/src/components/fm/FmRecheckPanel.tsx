"use client";

/**
 * FmRecheckPanel — surfaces the recheck workflow when a published plan's
 * 12-week protocol period has ended.
 *
 * Today (without this panel) the Plan tab just renders an amber
 * "Re-check due" line on FmWorkflowBanner and continues showing the
 * old protocol as if nothing had changed. That under-cues the actual
 * coach workflow: order recheck labs, book the recheck call, run a
 * fresh Full Assessment, draft + activate Phase 2.
 *
 * This primitive renders the locked design from
 * "FM Backlog Explorations" Group D8:
 *
 *   Title row · 🔁 Re-check workflow · "Phase N ended X days ago"
 *   5-step checklist:
 *     1 · Order recheck labs               → /clients-v2/[id]/communicate
 *     2 · Book recheck call                → /calendar
 *     3 · Confirm body composition         → /clients-v2/[id]   (Overview)
 *     4 · Run AI synthesis on new data     → /clients-v2/[id]/analyse/full
 *     5 · Activate the new draft plan      → /plans/{newDraftSlug}
 *
 *   Steps auto-light-up green when satisfied (drafts exist, sessions
 *   recorded, etc.). Per-client localStorage tracks coach-marked done.
 *
 * Used by:
 *   /clients-v2/[id]/plan when stage === "recheck"
 *
 * Plan content below the panel dims to 0.6 opacity to visually anchor
 * focus on the workflow.
 */
import { useEffect, useState } from "react";
import Link from "next/link";

export interface FmRecheckPanelProps {
  clientId: string;
  /** Currently-active (published) plan slug — used as the "Phase N" label. */
  activePlanSlug: string;
  /** ISO date the protocol period ended. */
  recheckDate?: string;
  /** Slug of the draft plan superseding the published one, if any. */
  pendingDraftSlug?: string;
  /** Coach has already kicked off a Full Assessment since the recheck date. */
  hasFreshAssessment?: boolean;
  /** Number of new lab snapshots since the recheck date. */
  freshLabSnapshots?: number;
}

interface StepDef {
  step: number;
  label: string;
  hint: string;
  cta?: { label: string; href: string };
  /** Optional auto-derived state. When `true`, step is rendered as done. */
  autoComplete?: boolean;
}

function daysSince(dateStr: string | undefined): number | null {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return null;
    const diffMs = Date.now() - d.getTime();
    return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
  } catch {
    return null;
  }
}

export function FmRecheckPanel({
  clientId,
  activePlanSlug,
  recheckDate,
  pendingDraftSlug,
  hasFreshAssessment,
  freshLabSnapshots = 0,
}: FmRecheckPanelProps) {
  const since = daysSince(recheckDate);

  // Per-client localStorage tracks which steps the coach has explicitly
  // ticked done (in addition to the auto-derived state). Coach toggles by
  // clicking the step number.
  const storageKey = `recheck-checked:${clientId}:${activePlanSlug}`;
  const [manualChecked, setManualChecked] = useState<Record<number, boolean>>({});
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) setManualChecked(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, [storageKey]);
  const toggle = (n: number) => {
    setManualChecked((cur) => {
      const next = { ...cur, [n]: !cur[n] };
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  // Build the 5-step list. Step auto-state comes from props; coach can
  // still manually tick steps that auto-detection can't infer.
  const steps: StepDef[] = [
    {
      step: 1,
      label: "Order recheck labs",
      hint:
        freshLabSnapshots > 0
          ? `${freshLabSnapshots} new lab snapshot${freshLabSnapshots === 1 ? "" : "s"} since recheck date`
          : "Send the lab list to the client — fT3 / rT3 / TPO / hs-CRP at minimum",
      cta: {
        label: "💬 Send via Communicate",
        href: `/clients-v2/${clientId}/communicate`,
      },
      autoComplete: freshLabSnapshots > 0,
    },
    {
      step: 2,
      label: "Book recheck call",
      hint: "Block a 90-minute slot for the full assessment",
      cta: { label: "📅 Calendar", href: "/calendar" },
    },
    {
      step: 3,
      label: "Confirm measurements",
      hint: "Weight, waist, BP, HR — capture at the call",
      cta: {
        label: "📐 Open Overview",
        href: `/clients-v2/${clientId}`,
      },
    },
    {
      step: 4,
      label: "Run AI synthesis on new data",
      hint: hasFreshAssessment
        ? "Fresh assessment recorded since the recheck date"
        : "Pulls the new labs + delta notes; produces draft Phase 2 plan",
      cta: {
        label: "🔬 Full assessment",
        href: `/clients-v2/${clientId}/analyse/full`,
      },
      autoComplete: !!hasFreshAssessment,
    },
    {
      step: 5,
      label: "Activate Phase 2 plan",
      hint: pendingDraftSlug
        ? `Draft ready — ${pendingDraftSlug}`
        : "Edit the draft + activate to supersede this plan",
      cta: pendingDraftSlug
        ? { label: "Open draft →", href: `/plans/${pendingDraftSlug}` }
        : undefined,
      autoComplete: false,
    },
  ];

  const completed = steps.filter(
    (s) => s.autoComplete || manualChecked[s.step],
  ).length;

  return (
    <div
      style={{
        background: "var(--fm-surface)",
        border: "1.5px solid rgba(184, 119, 10, 0.45)",
        borderRadius: "var(--fm-radius-md)",
        padding: "16px 18px",
        boxShadow: "0 4px 18px rgba(184, 119, 10, 0.08)",
        marginBottom: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 12,
        }}
      >
        <span style={{ fontSize: 22 }}>🔁</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: "#8a560a",
              letterSpacing: 0.2,
            }}
          >
            Re-check workflow
          </div>
          <div
            style={{
              fontSize: 12,
              color: "var(--fm-text-secondary)",
              marginTop: 2,
            }}
          >
            <strong style={{ fontFamily: "var(--fm-font-mono)" }}>
              {activePlanSlug}
            </strong>{" "}
            ended{" "}
            {since !== null
              ? since === 0
                ? "today"
                : since === 1
                  ? "yesterday"
                  : `${since} days ago`
              : "recently"}
            . Time for the next cycle.
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            fontSize: 11,
            fontWeight: 700,
            color: completed === steps.length ? "#1E8449" : "#8a560a",
            padding: "4px 10px",
            background:
              completed === steps.length
                ? "rgba(46,204,113,0.10)"
                : "rgba(184,119,10,0.10)",
            borderRadius: "var(--fm-radius-pill)",
            whiteSpace: "nowrap",
          }}
        >
          {completed} / {steps.length} done
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 8,
        }}
      >
        {steps.map((s) => {
          const isDone = s.autoComplete || manualChecked[s.step];
          return (
            <div
              key={s.step}
              style={{
                display: "flex",
                gap: 10,
                padding: "10px 12px",
                background: isDone
                  ? "rgba(46, 204, 113, 0.06)"
                  : "var(--fm-bg-warm)",
                border: `1px solid ${isDone ? "rgba(46,204,113,0.30)" : "rgba(184,119,10,0.20)"}`,
                borderRadius: "var(--fm-radius-sm)",
                alignItems: "flex-start",
                transition: "background 140ms ease",
              }}
            >
              <button
                type="button"
                onClick={() => toggle(s.step)}
                title={
                  s.autoComplete
                    ? "Auto-detected complete"
                    : isDone
                      ? "Coach marked done — click to undo"
                      : "Mark step as done"
                }
                style={{
                  flexShrink: 0,
                  width: 24,
                  height: 24,
                  borderRadius: "50%",
                  border: `1.5px solid ${isDone ? "#1E8449" : "#B8770A"}`,
                  background: isDone ? "#1E8449" : "var(--fm-surface)",
                  color: isDone ? "#fff" : "#B8770A",
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: s.autoComplete ? "default" : "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: "inherit",
                  padding: 0,
                }}
              >
                {isDone ? "✓" : s.step}
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: "var(--fm-text-primary)",
                    textDecoration: isDone ? "line-through" : "none",
                    textDecorationColor: "rgba(46, 204, 113, 0.5)",
                  }}
                >
                  {s.label}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--fm-text-tertiary)",
                    marginTop: 1,
                    lineHeight: 1.4,
                  }}
                >
                  {s.hint}
                </div>
                {s.cta && !isDone && (
                  <Link
                    href={s.cta.href}
                    style={{
                      display: "inline-block",
                      marginTop: 6,
                      padding: "3px 9px",
                      fontSize: 11,
                      fontWeight: 700,
                      background: "var(--fm-surface)",
                      border: "1px solid var(--fm-border)",
                      borderRadius: "var(--fm-radius-sm)",
                      color: "var(--fm-text-primary)",
                      textDecoration: "none",
                    }}
                  >
                    {s.cta.label}
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div
        style={{
          marginTop: 12,
          fontSize: 11,
          color: "var(--fm-text-tertiary)",
          lineHeight: 1.55,
        }}
      >
        Steps 1 + 4 auto-light when new lab snapshots / a fresh full
        assessment land. Tick the others as you complete them. The
        protocol below stays visible but dims — focus here until the new
        Phase 2 plan is activated.
      </div>
    </div>
  );
}
