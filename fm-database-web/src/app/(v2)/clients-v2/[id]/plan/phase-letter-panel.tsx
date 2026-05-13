"use client";

/**
 * PhaseLetterPanel — mid-cycle continuation meal-plan letters.
 *
 * Coach use case: published plan is active (12-week protocol). The
 * consolidated letter has the FULL meal plan for weeks 1-2 + teaser
 * for weeks 3-4 + roadmap for weeks 5-12. At the week-2 check-in,
 * coach wants to send Dhanishta a fresh 7-day meal plan for weeks
 * 3-4 (continues protocol + supplements, just new meals).
 *
 * Behaviour:
 *   - Visible only when the active plan is published (no point on a
 *     draft — coach would just edit the main letter).
 *   - Shows existing saved phases as a timeline with date + week range.
 *     Click any → opens the v2 letter-editor for that phase letter.
 *   - "Generate next phase →" picker: start week + end week inputs
 *     (default: next pair after the most recent saved phase, capped
 *     at plan_period_weeks).
 *   - On Generate: calls server action, redirects to the letter editor
 *     with the new phase letter loaded.
 */

import { useMemo, useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FmPanel } from "@/components/fm";
import {
  generatePhaseMealPlanAction,
  listSavedPhasesAction,
  type SavedPhase,
} from "@/app/plans/[slug]/lifecycle-actions";

interface Props {
  clientId: string;
  planSlug: string;
  planPeriodWeeks?: number;
  planPeriodStart?: string;
}

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-IN", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/** Suggest the next phase given the saved-phases list + plan length.
 *  Returns [start, end] capped at plan_period_weeks. */
function nextPhaseSuggestion(
  saved: SavedPhase[],
  planPeriodWeeks: number,
): { startWeek: number; endWeek: number } {
  // The consolidated letter implicitly covers wks 1-2. If nothing's
  // been generated separately, suggest wks 3-4.
  if (saved.length === 0) {
    return { startWeek: 3, endWeek: Math.min(4, planPeriodWeeks) };
  }
  // Highest saved endWeek → next phase starts at +1.
  const latestEnd = Math.max(...saved.map((p) => p.endWeek));
  if (latestEnd >= planPeriodWeeks) {
    // Plan exhausted — default to a 2-week phase past the end (coach
    // will likely clamp or skip).
    return { startWeek: planPeriodWeeks, endWeek: planPeriodWeeks };
  }
  const start = latestEnd + 1;
  const end = Math.min(start + 1, planPeriodWeeks);
  return { startWeek: start, endWeek: end };
}

export function PhaseLetterPanel({
  clientId,
  planSlug,
  planPeriodWeeks = 12,
  planPeriodStart,
}: Props) {
  const router = useRouter();
  const [saved, setSaved] = useState<SavedPhase[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, start] = useTransition();
  const [startWeek, setStartWeek] = useState(3);
  const [endWeek, setEndWeek] = useState(4);

  // Load saved phases on mount.
  useEffect(() => {
    let cancel = false;
    listSavedPhasesAction(planSlug, clientId)
      .then((list) => {
        if (cancel) return;
        setSaved(list);
        const next = nextPhaseSuggestion(list, planPeriodWeeks);
        setStartWeek(next.startWeek);
        setEndWeek(next.endWeek);
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [planSlug, clientId, planPeriodWeeks]);

  // Compute "current week" if plan_period_start is set — purely
  // informational, shown as a hint above the picker.
  const currentWeek = useMemo(() => {
    if (!planPeriodStart) return null;
    try {
      const start = new Date(planPeriodStart + "T00:00:00");
      const now = new Date();
      const days = Math.floor(
        (now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24),
      );
      const wk = Math.floor(days / 7) + 1;
      if (wk < 1) return null;
      if (wk > planPeriodWeeks) return planPeriodWeeks + 1;
      return wk;
    } catch {
      return null;
    }
  }, [planPeriodStart, planPeriodWeeks]);

  const onGenerate = () => {
    start(async () => {
      const res = await generatePhaseMealPlanAction(
        planSlug,
        clientId,
        startWeek,
        endWeek,
      );
      if (!res.ok) {
        toast.error(res.error ?? "Phase letter generation failed");
        return;
      }
      toast.success(
        `Phase letter ready — Week ${startWeek}${endWeek > startWeek ? `–${endWeek}` : ""}`,
      );
      // Open in editor so coach can review + edit + send
      router.push(
        `/clients-v2/${clientId}/letter-editor?plan=${planSlug}&type=meal_plan_phase&phase_start=${startWeek}&phase_end=${endWeek}`,
      );
    });
  };

  // Validation: start ≤ end, both within plan length, span ≤ 5 wks.
  const valid =
    startWeek >= 1 &&
    endWeek >= startWeek &&
    endWeek - startWeek <= 4 &&
    endWeek <= planPeriodWeeks + 4; // soft cap; coach can extend a bit past
  const validationMsg = !valid
    ? startWeek < 1
      ? "Start week must be ≥ 1"
      : endWeek < startWeek
        ? "End week must be ≥ start week"
        : endWeek - startWeek > 4
          ? "Phase span must be ≤ 5 weeks"
          : ""
    : "";

  return (
    <FmPanel
      title="🍽 Refresh meal plan — same protocol"
      subtitle="Mid-cycle inspiration: while the current 12-week protocol is still running, generate a fresh meal-plan letter for the next week range (seasonal swap, food variety). Supplements + lifestyle stay locked — only the meals change."
    >
      {currentWeek != null && (
        <div
          style={{
            fontSize: 11.5,
            color: "var(--fm-text-secondary)",
            marginBottom: 12,
            padding: "6px 10px",
            background: "var(--fm-bg-warm)",
            borderRadius: "var(--fm-radius-sm)",
          }}
        >
          🕓 Client is currently in <strong>week {currentWeek}</strong> of the{" "}
          {planPeriodWeeks}-week protocol.
        </div>
      )}

      {/* Saved phases timeline */}
      {!loading && saved.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div
            style={{
              fontSize: 10.5,
              textTransform: "uppercase",
              letterSpacing: 0.6,
              fontWeight: 700,
              color: "var(--fm-text-tertiary)",
              marginBottom: 6,
            }}
          >
            Saved phases ({saved.length})
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            {saved.map((p) => {
              const range =
                p.startWeek === p.endWeek
                  ? `Week ${p.startWeek}`
                  : `Weeks ${p.startWeek}–${p.endWeek}`;
              return (
                <a
                  key={`${p.startWeek}-${p.endWeek}`}
                  href={`/clients-v2/${clientId}/letter-editor?plan=${planSlug}&type=meal_plan_phase&phase_start=${p.startWeek}&phase_end=${p.endWeek}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    padding: "7px 10px",
                    background: "var(--fm-bg-cool)",
                    border: "1px solid var(--fm-border-light)",
                    borderRadius: "var(--fm-radius-sm)",
                    textDecoration: "none",
                    fontSize: 11.5,
                    color: "var(--fm-text-primary)",
                  }}
                >
                  <div>
                    <strong>{range}</strong>{" "}
                    <span style={{ color: "var(--fm-text-tertiary)" }}>
                      · saved {fmtDate(p.savedAt)}
                    </span>
                  </div>
                  <span
                    style={{
                      color: "var(--fm-primary)",
                      fontWeight: 600,
                    }}
                  >
                    Open →
                  </span>
                </a>
              );
            })}
          </div>
        </div>
      )}

      {/* Picker */}
      <div
        style={{
          padding: 12,
          background: "var(--fm-surface)",
          border: "1px solid var(--fm-border)",
          borderRadius: "var(--fm-radius-md)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <label
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: "var(--fm-text-secondary)",
            }}
          >
            Generate weeks
          </label>
          <input
            type="number"
            min={1}
            max={20}
            value={startWeek}
            onChange={(e) => setStartWeek(Math.max(1, parseInt(e.target.value, 10) || 1))}
            disabled={pending}
            style={{
              width: 60,
              padding: "6px 8px",
              fontSize: 13,
              fontWeight: 700,
              border: "1px solid var(--fm-border)",
              borderRadius: "var(--fm-radius-sm)",
              textAlign: "center",
            }}
          />
          <span style={{ color: "var(--fm-text-tertiary)" }}>to</span>
          <input
            type="number"
            min={1}
            max={20}
            value={endWeek}
            onChange={(e) => setEndWeek(Math.max(1, parseInt(e.target.value, 10) || 1))}
            disabled={pending}
            style={{
              width: 60,
              padding: "6px 8px",
              fontSize: 13,
              fontWeight: 700,
              border: "1px solid var(--fm-border)",
              borderRadius: "var(--fm-radius-sm)",
              textAlign: "center",
            }}
          />
          <button
            onClick={onGenerate}
            disabled={pending || !valid}
            style={{
              marginLeft: "auto",
              padding: "8px 16px",
              background: valid ? "var(--fm-primary)" : "var(--fm-border)",
              color: "#fff",
              border: 0,
              borderRadius: "var(--fm-radius-sm)",
              fontSize: 12,
              fontWeight: 700,
              cursor: pending || !valid ? "not-allowed" : "pointer",
              fontFamily: "inherit",
              opacity: pending ? 0.7 : 1,
            }}
          >
            {pending
              ? "⏳ Generating (~60-90s)…"
              : startWeek === endWeek
                ? `🍽 Generate Week ${startWeek} meal plan →`
                : `🍽 Generate Weeks ${startWeek}–${endWeek} meal plan →`}
          </button>
        </div>
        {validationMsg && (
          <div
            style={{
              fontSize: 11,
              color: "#c0392b",
              marginTop: 8,
            }}
          >
            ⚠ {validationMsg}
          </div>
        )}
        <p
          style={{
            fontSize: 11,
            color: "var(--fm-text-tertiary)",
            marginTop: 10,
            lineHeight: 1.5,
          }}
        >
          ✦ The AI references the client&apos;s current supplement protocol +
          dietary preferences + reported triggers + season + city. Phase
          letters reference the existing routine — they don&apos;t re-prescribe.
        </p>
      </div>
    </FmPanel>
  );
}
