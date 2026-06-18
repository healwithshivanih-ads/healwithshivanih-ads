"use client";

/**
 * PlanStartDatesPanel — captures the EFFECTIVE start dates the client
 * actually began the meal plan + supplements.
 *
 * Background (Shivani 2026-05-14): coaches send plans on day X but clients
 * empirically take ~3 days to start the meal plan (grocery shop + prep) and
 * ~7 days to start supplements (have to be ordered + delivered + habit-built).
 * Computing recheck off plan_period_start over-runs the protocol window by
 * up to a week.
 *
 * UX:
 *   - Two date inputs, both optional.
 *   - When unset, panel displays the assumed default ("Assumed: Mon 17 May
 *     — 3 days after plan published") in muted text.
 *   - When coach learns the real date from the client, she fills it in;
 *     the recheck date on the dashboard / calendar / client overview shifts
 *     automatically.
 *   - Save button is dormant until either field changes; clears back to
 *     default by erasing the input (we send null).
 *
 * Visible on ALL plan statuses, not just draft — coach typically learns the
 * actual start dates AFTER publishing. The dedicated `updatePlanStartDates`
 * server action bypasses the draft-only gate that protects the rest of the
 * plan body.
 */

import { useState } from "react";
import { FmPanel, FmChip } from "@/components/fm";
import {
  MEAL_PLAN_DEFAULT_DELAY_DAYS,
  SUPPLEMENTS_DEFAULT_DELAY_DAYS,
  effectiveMealPlanStart,
  effectiveSupplementsStart,
  effectiveRecheckDate,
} from "@/lib/fmdb/plan-timing";

interface Props {
  planSlug: string;
  planPeriodStart: string | null;       // YYYY-MM-DD
  planPeriodWeeks: number | null;
  mealPlanStartedOn: string | null;     // YYYY-MM-DD or null
  supplementsStartedOn: string | null;
  // Date formatting is done inline via the formatHuman() helper below —
  // no need to pass a function in from the server component (which Next 16
  // refuses to serialise across the boundary).
}

function formatHuman(ymd: string | null): string {
  if (!ymd) return "—";
  // "2026-05-17" → "17 May 2026"
  try {
    const d = new Date(ymd + "T00:00:00");
    return d.toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return ymd;
  }
}

export function PlanStartDatesPanel({
  planSlug,
  planPeriodStart,
  planPeriodWeeks,
  mealPlanStartedOn,
  supplementsStartedOn,
}: Props) {
  const [mealVal, setMealVal] = useState<string>(mealPlanStartedOn ?? "");
  const [suppVal, setSuppVal] = useState<string>(supplementsStartedOn ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // What the shared helpers say the EFFECTIVE dates are right now (reflects
  // either coach-asserted values OR the default-delay fallback).
  const planLike = {
    plan_period_start: planPeriodStart ?? undefined,
    plan_period_weeks: planPeriodWeeks ?? undefined,
    meal_plan_started_on: mealVal || null,
    supplements_started_on: suppVal || null,
  };
  const mealEffective = effectiveMealPlanStart(planLike);
  const suppEffective = effectiveSupplementsStart(planLike);
  const recheck = effectiveRecheckDate(planLike);

  const isDirty =
    (mealVal || null) !== (mealPlanStartedOn ?? null) ||
    (suppVal || null) !== (supplementsStartedOn ?? null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const { updatePlanStartDates } = await import(
        "@/lib/server-actions/plans"
      );
      const r = await updatePlanStartDates(planSlug, {
        meal_plan_started_on: mealVal || null,
        supplements_started_on: suppVal || null,
      });
      if (!r.ok) {
        setError(r.error);
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 2200);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <FmPanel
      title="📅 Plan start date"
      subtitle="Day 1 of the 12-week plan. Set a future date to put the plan ON HOLD — the client's app shows a 'starts on this date' screen until then. Recheck date + letter framing key off this."
    >
      <div style={{ display: "grid", gap: 14 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
          }}
        >
          {/* Meal plan column */}
          <div style={{ display: "grid", gap: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 600 }}>
              🍽 Meal plan started on
            </label>
            <input
              type="date"
              value={mealVal}
              onChange={(e) => setMealVal(e.target.value)}
              style={{
                padding: "8px 10px",
                borderRadius: 6,
                border: "1px solid rgba(0,0,0,0.15)",
                fontSize: 14,
              }}
            />
            <div style={{ fontSize: 11, opacity: 0.7 }}>
              {mealPlanStartedOn ? (
                <FmChip tone="success">Coach-confirmed</FmChip>
              ) : (
                <>
                  Default assumption: <strong>{formatHuman(mealEffective)}</strong>
                  {" "}({MEAL_PLAN_DEFAULT_DELAY_DAYS}d after plan published — grocery shop + prep)
                </>
              )}
            </div>
            {(() => {
              if (!mealVal) return null;
              const now = new Date();
              const days = Math.ceil(
                (new Date(`${mealVal}T00:00:00Z`).getTime() -
                  Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) /
                  86_400_000,
              );
              if (days <= 0) return null;
              return (
                <div
                  style={{
                    fontSize: 11,
                    color: "#3730a3",
                    background: "rgba(99,102,241,0.12)",
                    borderRadius: 6,
                    padding: "5px 8px",
                  }}
                >
                  🔒 On hold — plan starts in {days} day{days === 1 ? "" : "s"}. The client&apos;s
                  app stays on a &ldquo;starts on this date&rdquo; screen until then.
                </div>
              );
            })()}
          </div>

          {/* Supplements column */}
          <div style={{ display: "grid", gap: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 600 }}>
              💊 Supplements started on
            </label>
            <input
              type="date"
              value={suppVal}
              onChange={(e) => setSuppVal(e.target.value)}
              style={{
                padding: "8px 10px",
                borderRadius: 6,
                border: "1px solid rgba(0,0,0,0.15)",
                fontSize: 14,
              }}
            />
            <div style={{ fontSize: 11, opacity: 0.7 }}>
              {supplementsStartedOn ? (
                <FmChip tone="success">Coach-confirmed</FmChip>
              ) : (
                <>
                  Default assumption: <strong>{formatHuman(suppEffective)}</strong>
                  {" "}({SUPPLEMENTS_DEFAULT_DELAY_DAYS}d after plan published — order + delivery)
                </>
              )}
            </div>
          </div>
        </div>

        {/* Effective recheck preview — shifts live as the coach types */}
        <div
          style={{
            padding: "8px 10px",
            borderRadius: 6,
            background: "rgba(124, 58, 237, 0.06)",
            border: "1px solid rgba(124, 58, 237, 0.2)",
            fontSize: 13,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <span>
            <strong>🟣 Effective recheck:</strong>{" "}
            {recheck ? formatHuman(recheck) : "—"}
            {planPeriodWeeks && (
              <span style={{ opacity: 0.6 }}>
                {" "}
                (effective meal-plan start + {planPeriodWeeks} weeks)
              </span>
            )}
          </span>
        </div>

        {/* Save row */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            type="button"
            onClick={handleSave}
            disabled={!isDirty || saving}
            style={{
              padding: "8px 14px",
              borderRadius: 6,
              background: isDirty && !saving ? "#059669" : "rgba(0,0,0,0.1)",
              color: "white",
              border: "none",
              fontSize: 13,
              fontWeight: 600,
              cursor: !isDirty || saving ? "not-allowed" : "pointer",
            }}
          >
            {saving ? "Saving…" : "Save start dates"}
          </button>
          {saved && <FmChip tone="success">✓ Saved</FmChip>}
          {error && (
            <span style={{ color: "#dc2626", fontSize: 12 }}>{error}</span>
          )}
          {(mealVal || suppVal) && !isDirty && !saving && (
            <button
              type="button"
              onClick={() => {
                setMealVal("");
                setSuppVal("");
              }}
              style={{
                fontSize: 12,
                background: "transparent",
                border: "none",
                color: "#6b7280",
                cursor: "pointer",
                textDecoration: "underline",
              }}
            >
              Clear (back to defaults)
            </button>
          )}
        </div>
      </div>
    </FmPanel>
  );
}
