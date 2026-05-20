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
import { useState, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FmPanel } from "@/components/fm";
import {
  generateFollowUpPlan,
  type FollowUpIntent,
} from "@/lib/server-actions/plan-lifecycle";

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
  const [intent, setIntent] = useState<FollowUpIntent>("next_phase");
  const [phaseWeeks, setPhaseWeeks] = useState<string>("12");

  // Maintenance graduation gets a different slug stem (.../maintenance...)
  // and a 26-week default. Next-phase uses the original 12-week suggestion.
  const slug = useMemo(() => {
    if (intent === "maintenance") {
      return suggestedSlug.replace(/-plan-\d+-/, "-maintenance-");
    }
    return suggestedSlug;
  }, [intent, suggestedSlug]);
  const [slugOverride, setSlugOverride] = useState<string | null>(null);
  const effectiveSlug = slugOverride ?? slug;

  const phaseDefault = intent === "maintenance" ? "26" : "12";
  const effectivePhaseWeeks = phaseWeeks || phaseDefault;

  const subtitle = isOverdue
    ? `Recheck date${recheckDate ? ` (${recheckDate})` : ""} passed — time to create the next plan.`
    : "End-of-protocol: pick what comes next.";

  const onGenerate = () => {
    const trimmed = effectiveSlug.trim();
    if (!trimmed) {
      toast.error("Enter a slug for the new plan");
      return;
    }
    if (trimmed === activePlanSlug) {
      toast.error("New plan slug must differ from the current plan");
      return;
    }
    start(async () => {
      const r = await generateFollowUpPlan(
        activePlanSlug,
        trimmed,
        effectivePhaseWeeks.trim() ||
          (intent === "maintenance" ? "maintenance" : "next phase"),
        clientId,
        intent,
      );
      if (r.ok && r.newSlug) {
        toast.success(
          intent === "maintenance"
            ? `Maintenance plan created: ${r.newSlug}`
            : `Next-phase plan created: ${r.newSlug}`,
        );
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
          🚀 Create the next plan
          {isOverdue && (
            <span
              style={{
                fontSize: 10,
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
        {/* Intent picker — two distinct end-of-protocol moves */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 8,
            marginBottom: 4,
          }}
        >
          <IntentCard
            active={intent === "next_phase"}
            onClick={() => setIntent("next_phase")}
            emoji="🔁"
            title="Next phase"
            body="Continue active care with adjusted supplements + lifestyle based on check-in outcomes."
          />
          <IntentCard
            active={intent === "maintenance"}
            onClick={() => setIntent("maintenance")}
            emoji="🌿"
            title="Maintenance"
            body="Client has finished the program. Lighter plan — anchor habits, fewer supplements, quarterly check-ins."
          />
        </div>

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
            value={effectiveSlug}
            onChange={(e) => setSlugOverride(e.target.value)}
            disabled={pending}
            placeholder={
              intent === "maintenance"
                ? "e.g. firstname-maintenance-yyyy-mm-dd-cl-006"
                : "e.g. firstname-plan-2-yyyy-mm-dd-cl-006"
            }
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
            {intent === "maintenance" ? "Maintenance period (weeks)" : "Phase weeks"}
          </span>
          <input
            type="text"
            value={phaseWeeks}
            onChange={(e) => setPhaseWeeks(e.target.value)}
            disabled={pending}
            placeholder={phaseDefault}
            style={{
              fontSize: 12,
              padding: "7px 9px",
              border: "1px solid var(--fm-border)",
              borderRadius: "var(--fm-radius-sm)",
              background: "var(--fm-surface)",
              color: "var(--fm-text-primary)",
            }}
          />
          <span style={{ fontSize: 11, color: "var(--fm-text-tertiary)" }}>
            {intent === "maintenance"
              ? <>Default <code>26</code> weeks (6 months) until next reassessment. Coach can shorten or extend.</>
              : <>Default <code>12</code>. Free text — also accepts ranges like <code>3-8</code>.</>}
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
          ) : intent === "maintenance" ? (
            <>🌿 Generate maintenance plan</>
          ) : (
            <>🔁 Generate next-phase plan</>
          )}
        </button>

        <p
          style={{
            margin: 0,
            fontSize: 11,
            color: "var(--fm-text-tertiary)",
            lineHeight: 1.5,
          }}
        >
          {intent === "maintenance" ? (
            <>
              AI reads the current plan + check-in outcomes and proposes a
              lighter maintenance draft — strips symptom-targeted supplements,
              keeps anchor habits, schedules quarterly touchpoints + yearly
              labs. You land in the plan editor to review + activate.
            </>
          ) : (
            <>
              AI reads the current plan + check-in notes and proposes an
              adjusted next-phase draft (graduates doses, adds new supplements,
              progresses lifestyle). You land in the plan editor to review +
              activate.
            </>
          )}
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

function IntentCard({
  active,
  onClick,
  emoji,
  title,
  body,
}: {
  active: boolean;
  onClick: () => void;
  emoji: string;
  title: string;
  body: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        textAlign: "left",
        display: "block",
        padding: "9px 11px",
        background: active ? "rgba(255, 107, 53, 0.07)" : "var(--fm-surface)",
        border: `2px solid ${active ? "var(--fm-primary)" : "var(--fm-border)"}`,
        borderRadius: "var(--fm-radius-sm)",
        cursor: "pointer",
        fontFamily: "inherit",
        color: "var(--fm-text-primary)",
        transition: "all 120ms ease-out",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 3 }}>
        <span style={{ fontSize: 13 }}>{emoji}</span>
        <span style={{ fontSize: 13, fontWeight: 700 }}>{title}</span>
      </div>
      <div
        style={{
          fontSize: 11,
          lineHeight: 1.45,
          color: "var(--fm-text-secondary)",
        }}
      >
        {body}
      </div>
    </button>
  );
}
