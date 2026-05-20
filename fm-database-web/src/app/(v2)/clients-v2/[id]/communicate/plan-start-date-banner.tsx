"use client";

/**
 * PlanStartDateBanner — the coach sets the client's actual Day 1 here,
 * BEFORE generating letters.
 *
 * Why this exists: letters and the fortnight cards number every week
 * relative to a single anchor date. Until 2026-05-20 that anchor silently
 * defaulted to plan_period_start (= the date the plan was generated), so
 * a plan built on the 19th told the client "Week 1: 19 May" even when she
 * said on the call she'd start the 24th.
 *
 * One date drives everything: Week N = startDate + (N-1)x7, the recheck
 * date, and every letter's timeline copy. Written to BOTH
 * meal_plan_started_on and supplements_started_on so the meal-plan and
 * supplement letters anchor to the same Day 1 (coach can still fine-tune
 * the supplement date separately in the plan editor if she wants the
 * ordering-lag).
 *
 * - Not set  → amber nudge: "set this before generating letters".
 * - Set      → calm green confirmation with the date + Week 1 range.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { updatePlanStartDates } from "@/lib/server-actions/plans";

interface Props {
  planSlug: string | null;
  /** Coach-asserted start date already on the plan (null = never set). */
  mealPlanStartedOn: string | null;
  /** plan_period_start — the silent fallback when nothing is set. */
  planPeriodStart: string | null;
  planPeriodWeeks: number;
}

function fmtHuman(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/** Default suggestion for the date picker: next Monday from today —
 *  most clients start their plan on a Monday. */
function nextMonday(): string {
  const d = new Date();
  const day = d.getDay(); // 0 Sun .. 6 Sat
  const delta = day === 1 ? 7 : (8 - day) % 7 || 7;
  d.setDate(d.getDate() + delta);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export function PlanStartDateBanner({
  planSlug,
  mealPlanStartedOn,
  planPeriodStart,
  planPeriodWeeks,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(
    mealPlanStartedOn || planPeriodStart || nextMonday(),
  );

  // No active plan → nothing to anchor.
  if (!planSlug) return null;

  const isSet = !!mealPlanStartedOn;
  const effective = mealPlanStartedOn || planPeriodStart;

  const save = () => {
    if (!draft) {
      toast.error("Pick a start date first");
      return;
    }
    startTransition(async () => {
      // One date anchors both the meal plan and the supplements so every
      // letter counts weeks from the same Day 1.
      const res = await updatePlanStartDates(planSlug, {
        meal_plan_started_on: draft,
        supplements_started_on: draft,
      });
      if (res.ok) {
        toast.success(`📅 Plan start date set — ${fmtHuman(draft)}`);
        setEditing(false);
        router.refresh();
      } else {
        toast.error(res.error ?? "Could not save start date", {
          duration: 10000,
        });
      }
    });
  };

  const recheck = effective
    ? addDays(effective, planPeriodWeeks * 7)
    : null;

  // ── Editing form ─────────────────────────────────────────────────
  if (editing) {
    return (
      <div
        style={{
          marginBottom: 16,
          padding: "14px 16px",
          background: "var(--fm-surface)",
          border: "1.5px solid var(--fm-primary)",
          borderRadius: "var(--fm-radius-md)",
          display: "grid",
          gap: 10,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 700 }}>
          📅 When does {isSet ? "the client restart" : "the client start"}{" "}
          this plan?
        </div>
        <div
          style={{
            fontSize: 12,
            color: "var(--fm-text-secondary)",
            lineHeight: 1.5,
          }}
        >
          This is Day 1. Every letter numbers its weeks from here — Week 1
          is this date, Week 2 is a week later, and so on. Ask the client
          on the call and set it before you generate letters.
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <input
            type="date"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            style={{
              padding: "7px 10px",
              fontSize: 13,
              border: "1px solid var(--fm-border)",
              borderRadius: "var(--fm-radius-sm)",
              fontFamily: "inherit",
            }}
          />
          {draft && (
            <span style={{ fontSize: 11.5, color: "var(--fm-text-tertiary)" }}>
              Week 1: {addDays(draft, 0)} – {addDays(draft, 6)} ·
              Recheck ~{addDays(draft, planPeriodWeeks * 7)}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={save}
            disabled={pending}
            style={{
              padding: "6px 14px",
              fontSize: 12.5,
              fontWeight: 700,
              background: pending ? "#94a3b8" : "var(--fm-primary)",
              color: "#fff",
              border: "none",
              borderRadius: "var(--fm-radius-sm)",
              cursor: pending ? "wait" : "pointer",
              fontFamily: "inherit",
            }}
          >
            {pending ? "Saving…" : "Save start date"}
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            disabled={pending}
            style={{
              padding: "6px 14px",
              fontSize: 12.5,
              fontWeight: 600,
              background: "transparent",
              color: "var(--fm-text-secondary)",
              border: "1px solid var(--fm-border)",
              borderRadius: "var(--fm-radius-sm)",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // ── Not set — amber nudge ────────────────────────────────────────
  if (!isSet) {
    return (
      <div
        style={{
          marginBottom: 16,
          padding: "12px 16px",
          background: "rgba(245, 158, 11, 0.10)",
          border: "1.5px solid rgba(245, 158, 11, 0.45)",
          borderRadius: "var(--fm-radius-md)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ fontSize: 12.5, color: "#92400e", lineHeight: 1.5 }}>
          <strong>⚠ Plan start date not set.</strong> Letters will assume the
          client starts{" "}
          <strong>
            {planPeriodStart ? fmtHuman(planPeriodStart) : "the day the plan was generated"}
          </strong>{" "}
          — usually wrong. Set the real Day 1 before generating.
        </div>
        <button
          type="button"
          onClick={() => setEditing(true)}
          style={{
            padding: "6px 14px",
            fontSize: 12.5,
            fontWeight: 700,
            background: "var(--fm-primary)",
            color: "#fff",
            border: "none",
            borderRadius: "var(--fm-radius-sm)",
            cursor: "pointer",
            fontFamily: "inherit",
            whiteSpace: "nowrap",
          }}
        >
          📅 Set start date
        </button>
      </div>
    );
  }

  // ── Set — calm confirmation ──────────────────────────────────────
  return (
    <div
      style={{
        marginBottom: 16,
        padding: "10px 16px",
        background: "rgba(34, 197, 94, 0.08)",
        border: "1px solid rgba(34, 197, 94, 0.35)",
        borderRadius: "var(--fm-radius-md)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        flexWrap: "wrap",
      }}
    >
      <div style={{ fontSize: 12.5, color: "#15803d", lineHeight: 1.5 }}>
        📅 <strong>Plan starts {fmtHuman(mealPlanStartedOn!)}</strong> — Week 1
        begins here.{" "}
        <span style={{ color: "var(--fm-text-tertiary)" }}>
          All letter weeks + recheck (~{recheck}) count from this date.
        </span>
      </div>
      <button
        type="button"
        onClick={() => setEditing(true)}
        style={{
          padding: "5px 12px",
          fontSize: 11.5,
          fontWeight: 600,
          background: "transparent",
          color: "#15803d",
          border: "1px solid rgba(34, 197, 94, 0.4)",
          borderRadius: "var(--fm-radius-sm)",
          cursor: "pointer",
          fontFamily: "inherit",
          whiteSpace: "nowrap",
        }}
      >
        ✎ Change
      </button>
    </div>
  );
}
