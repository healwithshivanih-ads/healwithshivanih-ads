"use client";

/**
 * FollowUpPanel — v2 Plan tab right-rail panel that lets the coach
 * generate a phase-2 successor draft from the currently active
 * published plan.
 *
 * Visible only when the active plan is `published`. The parent server
 * component computes `isOverdue` from the recheck date and passes it
 * in — when overdue, the panel takes an amber tint + ⚠ badge so it
 * reads as "do this now". The workflow banner upstream already carries
 * the loud "Re-check due" headline, so this is the affordance, not the
 * alert.
 *
 * Mirrors the v1 follow-up workflow at
 * src/app/clients/[id]/client-tabs.tsx (~lines 1585-1615): edit the
 * suggested slug, pick a phase-weeks label, hit generate, wait ~60s
 * for Sonnet, redirect to the legacy plan editor for the new draft.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FmPanel } from "@/components/fm";
import { generateFollowUpPlan } from "@/app/plans/[slug]/lifecycle-actions";

interface Props {
  activePlanSlug: string;
  clientId: string;
  /** Coach-friendly client display name — used to seed the slug suggestion. */
  clientName?: string;
  /** ISO date string — the plan's computed recheck date. May be undefined. */
  recheckDate?: string;
  /** True when today >= recheckDate (server-computed). */
  isOverdue: boolean;
  /** Pre-computed suggested slug for the next follow-up plan. */
  suggestedSlug: string;
}

export function FollowUpPanel({
  activePlanSlug,
  clientId,
  clientName,
  recheckDate,
  isOverdue,
  suggestedSlug,
}: Props) {
  void clientName; // reserved for future copy
  const router = useRouter();
  const [pending, start] = useTransition();
  const [slug, setSlug] = useState<string>(suggestedSlug);
  const [phaseWeeks, setPhaseWeeks] = useState<string>("12");

  const subtitle = isOverdue
    ? `Recheck date${recheckDate ? ` (${recheckDate})` : ""} passed — time for a phase-2 plan.`
    : "Generate next phase when the current protocol ends.";

  const onGenerate = () => {
    const trimmed = slug.trim();
    if (!trimmed) {
      toast.error("Enter a slug for the follow-up plan");
      return;
    }
    if (trimmed === activePlanSlug) {
      toast.error("Follow-up slug must differ from the current plan");
      return;
    }
    start(async () => {
      const r = await generateFollowUpPlan(
        activePlanSlug,
        trimmed,
        phaseWeeks.trim() || "next phase",
        clientId,
      );
      if (r.ok && r.newSlug) {
        toast.success(`Follow-up plan created: ${r.newSlug}`);
        router.push(`/clients-v2/${clientId}/plan/edit/${r.newSlug}`);
      } else {
        toast.error(r.error ?? "Generation failed");
      }
    });
  };

  // Subtle amber accent when overdue — the workflow banner already
  // carries the loud headline; this is just a visual nudge.
  const panelStyle: React.CSSProperties | undefined = isOverdue
    ? {
        borderColor: "rgba(245, 158, 11, 0.55)",
        background:
          "linear-gradient(135deg, rgba(245, 158, 11, 0.06), var(--fm-surface) 70%)",
      }
    : undefined;

  return (
    <FmPanel
      title={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          🔄 Generate follow-up plan
          {isOverdue && (
            <span
              style={{
                fontSize: 9.5,
                fontWeight: 700,
                padding: "2px 6px",
                background: "#92400e",
                color: "#fff",
                borderRadius: "var(--fm-radius-pill)",
                letterSpacing: 0.4,
                textTransform: "uppercase",
              }}
            >
              ⚠ Overdue
            </span>
          )}
        </span>
      }
      subtitle={subtitle}
      style={panelStyle}
    >
      <div style={{ display: "grid", gap: 10 }}>
        <label style={{ display: "grid", gap: 4 }}>
          <span
            style={{
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: 0.6,
              fontWeight: 700,
              color: "var(--fm-text-tertiary)",
            }}
          >
            New plan slug
          </span>
          <input
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            disabled={pending}
            placeholder="e.g. firstname-plan-2-yyyy-mm-dd-cl-006"
            style={{
              fontSize: 12,
              fontFamily: "var(--fm-font-mono)",
              padding: "7px 9px",
              border: "1px solid var(--fm-border)",
              borderRadius: "var(--fm-radius-sm)",
              background: "var(--fm-surface)",
              color: "var(--fm-text-primary)",
            }}
          />
        </label>

        <label style={{ display: "grid", gap: 4 }}>
          <span
            style={{
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: 0.6,
              fontWeight: 700,
              color: "var(--fm-text-tertiary)",
            }}
          >
            Phase weeks
          </span>
          <input
            type="text"
            value={phaseWeeks}
            onChange={(e) => setPhaseWeeks(e.target.value)}
            disabled={pending}
            placeholder="12"
            style={{
              fontSize: 12,
              padding: "7px 9px",
              border: "1px solid var(--fm-border)",
              borderRadius: "var(--fm-radius-sm)",
              background: "var(--fm-surface)",
              color: "var(--fm-text-primary)",
            }}
          />
          <span style={{ fontSize: 10.5, color: "var(--fm-text-tertiary)" }}>
            Free text — flows into the AI prompt as the phase label
            (e.g. <code>12</code>, <code>3-8</code>, <code>maintenance</code>).
          </span>
        </label>

        <button
          onClick={onGenerate}
          disabled={pending || !slug.trim()}
          style={{
            fontSize: 12,
            padding: "9px 14px",
            background: pending ? "var(--fm-bg-cool)" : "var(--fm-primary)",
            color: pending ? "var(--fm-text-secondary)" : "#fff",
            border: 0,
            borderRadius: "var(--fm-radius-sm)",
            cursor: pending || !slug.trim() ? "not-allowed" : "pointer",
            fontWeight: 700,
            fontFamily: "inherit",
            opacity: !slug.trim() && !pending ? 0.5 : 1,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
          }}
        >
          {pending ? (
            <>
              <span
                style={{
                  display: "inline-block",
                  animation: "fm-spin 1s linear infinite",
                }}
              >
                ⏳
              </span>
              Generating (~60s)…
            </>
          ) : (
            <>🤖 Generate follow-up plan</>
          )}
        </button>

        <p
          style={{
            margin: 0,
            fontSize: 10.5,
            color: "var(--fm-text-tertiary)",
            lineHeight: 1.5,
          }}
        >
          AI reads the current plan + check-in notes and proposes an
          adjusted phase-2 draft. You land in the classic plan editor to
          review and activate.
        </p>
      </div>

      <style jsx>{`
        @keyframes fm-spin {
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </FmPanel>
  );
}
