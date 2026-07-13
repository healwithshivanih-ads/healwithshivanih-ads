"use client";

/**
 * WeightLossCard — per-client weight loss goal lives here.
 *
 * One card on the Overview tab. Coach sets the goal ONCE; render-client-
 * letter.py reads it on every meal-plan generation to compute calorie
 * targets + portion control. Per-week overrides handle travel /
 * festivals / plateau breaks without re-typing.
 *
 * Visual structure (per Claude Design FM V2 spec):
 *   ┌──────────────────────────────────────────────────────┐
 *   │ Client goal · Weight loss              [Active]  ⋯   │
 *   │ ──────────────────────────────────────────────────   │
 *   │  80.0kg  →  78.4kg  ↓1.6kg  →  74.0kg                │
 *   │  Starting   Current             Goal · by 1 Aug      │
 *   │                                                      │
 *   │  Wk 2 / 12  ▓▓▓░░░░░░░░░ 1.6 of 6.0 kg                │
 *   │                                                      │
 *   │  [sparkline: blue actual line vs orange dashed goal] │
 *   │                                                      │
 *   │  Pace   Moderate · ~0.5 kg/wk                        │
 *   │  Activity   Moderate · 4d/wk · walking + light yoga  │
 *   │  Limit   ⚠ knee pain (left, intermittent)            │
 *   │                                                      │
 *   │  PER-WEEK OVERRIDES (2)                              │
 *   │  [Wks 4–5 · Maintenance — Australia travel]  ×       │
 *   │  [Wk 9 · Deeper deficit -200 — festival catch-up] ×  │
 *   │                                                      │
 *   │  [Edit goal]  [+ Add week override]                  │
 *   └──────────────────────────────────────────────────────┘
 *
 * Three variants:
 *   - default (when weight_loss.enabled)
 *   - paused  (when weight_loss.enabled === false; same shape, muted pill)
 *   - empty   (no weight_loss at all — warm-bg card with single CTA)
 *
 * Styles live in src/styles/fm-v2-communicate.css under .fm-v2 .wl-card.
 */
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  updateClientWeightLossGoal,
  addWeightLossOverride,
  removeWeightLossOverride,
  pauseWeightLossGoal,
  type WeightLossGoalPayload,
  type WeightLossWeekOverridePayload,
} from "@/lib/server-actions/clients";
import type { WeightLossGoal, MeasurementEntry } from "@/lib/fmdb/types";
import type { CaloriePhases } from "@/lib/fmdb/calorie-phases";

export interface WeightLossCardProps {
  clientId: string;
  /** Current weight_loss block from client.yaml. Null/undefined = empty
   *  state (no goal set yet). */
  goal?: WeightLossGoal | null;
  /** Time-series weight readings — drives the sparkline. We filter to
   *  entries with weight_kg present and within the goal window. */
  measurementsLog?: MeasurementEntry[];
  /** Snapshot from `client.weight_now_kg` (intake form). Used as the
   *  pre-fill default for the Edit modal's starting weight when no
   *  measurement-log reading is available. Coach can still override. */
  currentWeightKg?: number | null;
  /** Phased calorie ramp — computed server-side in page.tsx via
   *  computeCaloriePhases(). The same 40/70/100/80/60% curve the client
   *  letter uses. Null when weight loss isn't enabled or data is sparse. */
  caloriePhases?: CaloriePhases | null;
  /** Movement/exercise the client reported in the intake form
   *  (client.five_pillars). Pre-fills the Edit modal's activity + exercise
   *  fields when setting up a NEW goal, so the coach doesn't re-type what
   *  the client already told us. Coach can still override before saving. */
  intakeExercise?: IntakeExercise;
}

/** What the client filled for movement in the intake form. */
export interface IntakeExercise {
  /** five_pillars.movement_days_per_week */
  days?: number;
  /** five_pillars.movement_type — e.g. "walking, yoga" */
  type?: string;
  /** five_pillars.movement_intensity — light | moderate | intense */
  intensity?: string;
}

/** Map intake movement (days/week + intensity) → the goal form's activity
 *  level. Days drive the bucket; intensity nudges the boundary case. */
function deriveActivityFromIntake(
  ex?: IntakeExercise,
): "sedentary" | "light" | "moderate" | "active" | undefined {
  if (!ex || typeof ex.days !== "number") return undefined;
  const d = ex.days;
  let level: "sedentary" | "light" | "moderate" | "active" =
    d <= 1 ? "sedentary" : d <= 3 ? "light" : d <= 5 ? "moderate" : "active";
  const i = (ex.intensity ?? "").toLowerCase();
  if (level === "moderate" && (i.includes("intense") || i.includes("vigorous"))) level = "active";
  if (level === "moderate" && i.includes("light")) level = "light";
  return level;
}

export function WeightLossCard({
  clientId,
  goal,
  measurementsLog,
  currentWeightKg,
  caloriePhases,
  intakeExercise,
}: WeightLossCardProps) {
  const [editOpen, setEditOpen] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);

  // Treat incomplete goals (enabled but missing the numeric fields the
  // inner card needs) the same as no goal — surface the empty state so
  // the coach can finish setup. Prevents `.toFixed()` on undefined when
  // a client has e.g. {enabled: true, week_overrides: [...]} but no
  // goal_kg / starting_weight_kg / goal_target_date.
  const goalIncomplete =
    !goal ||
    typeof goal.goal_kg !== "number" ||
    typeof goal.starting_weight_kg !== "number" ||
    !goal.starting_date ||
    !goal.goal_target_date;

  if (goalIncomplete) {
    return (
      <>
        <WeightLossEmpty onSet={() => setEditOpen(true)} />
        {editOpen && (
          <EditGoalModal
            clientId={clientId}
            goal={null}
            measurementsLog={measurementsLog ?? []}
            currentWeightKg={currentWeightKg ?? null}
            intakeExercise={intakeExercise}
            onClose={() => setEditOpen(false)}
          />
        )}
      </>
    );
  }

  return (
    <>
      <WeightLossCardInner
        clientId={clientId}
        goal={goal}
        measurementsLog={measurementsLog ?? []}
        caloriePhases={caloriePhases ?? null}
        onEdit={() => setEditOpen(true)}
        onAddOverride={() => setOverrideOpen(true)}
      />
      {editOpen && (
        <EditGoalModal
          clientId={clientId}
          goal={goal}
          measurementsLog={measurementsLog ?? []}
          currentWeightKg={currentWeightKg ?? null}
          intakeExercise={intakeExercise}
          onClose={() => setEditOpen(false)}
        />
      )}
      {overrideOpen && (
        <AddOverrideModal
          clientId={clientId}
          onClose={() => setOverrideOpen(false)}
        />
      )}
    </>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Inner card — the "happy" / paused state. Variants share visual structure.
// ───────────────────────────────────────────────────────────────────────────
function WeightLossCardInner({
  clientId,
  goal,
  measurementsLog,
  caloriePhases,
  onEdit,
  onAddOverride,
}: {
  clientId: string;
  goal: WeightLossGoal;
  measurementsLog: MeasurementEntry[];
  caloriePhases: CaloriePhases | null;
  onEdit: () => void;
  onAddOverride: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Derived current weight: latest log entry with a weight reading, else
  // fall back to the starting weight (so the card never breaks on a
  // fresh client). Date sort is descending — newest first.
  const currentReading = useMemo(() => {
    const sorted = [...measurementsLog]
      .filter((m) => typeof m.weight_kg === "number")
      .sort((a, b) =>
        String(b.date ?? "").localeCompare(String(a.date ?? "")),
      );
    return sorted[0]
      ? { kg: sorted[0].weight_kg as number, date: sorted[0].date }
      : { kg: goal.starting_weight_kg, date: goal.starting_date };
  }, [measurementsLog, goal.starting_weight_kg, goal.starting_date]);

  const kgLost = +(goal.starting_weight_kg - currentReading.kg).toFixed(1);
  const totalKg = +(goal.starting_weight_kg - goal.goal_kg < 0
    ? 0
    : goal.starting_weight_kg - (goal.starting_weight_kg - goal.goal_kg)
  ).toFixed(1);
  // Coach inputs goal_kg as TOTAL to lose (e.g. 6) — derive goal weight.
  const goalWeight = +(goal.starting_weight_kg - goal.goal_kg).toFixed(1);
  const totalToLose = goal.goal_kg;
  const pct = Math.max(
    0,
    Math.min(100, (kgLost / totalToLose) * 100 || 0),
  );

  // Week numbers (current / total) — derived from starting_date + goal_target_date.
  const { weeksElapsed, weeksTotal } = useMemo(() => {
    try {
      const start = new Date(`${goal.starting_date}T00:00:00`);
      const target = new Date(`${goal.goal_target_date}T00:00:00`);
      const today = new Date();
      const wkMs = 7 * 24 * 60 * 60 * 1000;
      const elapsed = Math.max(
        0,
        Math.floor((today.getTime() - start.getTime()) / wkMs),
      );
      const total = Math.max(
        1,
        Math.round((target.getTime() - start.getTime()) / wkMs),
      );
      return { weeksElapsed: elapsed, weeksTotal: total };
    } catch {
      return { weeksElapsed: 0, weeksTotal: 12 };
    }
  }, [goal.starting_date, goal.goal_target_date]);

  // Pace label — coach picks pace tag; we surface a kg/wk estimate.
  const paceLabel = useMemo(() => {
    const map = {
      slow: "Slow · ~0.25 kg/wk",
      moderate: "Moderate · ~0.5 kg/wk",
      faster: "Faster · ~0.75 kg/wk",
    } as const;
    return map[goal.pace] ?? "Moderate · ~0.5 kg/wk";
  }, [goal.pace]);

  const activityLabel = useMemo(() => {
    const m = {
      sedentary: "Sedentary",
      light: "Light",
      moderate: "Moderate",
      active: "Active",
    } as const;
    return m[goal.activity_level] ?? "Moderate";
  }, [goal.activity_level]);

  const onRemoveOverride = (idx: number) => {
    startTransition(async () => {
      const res = await removeWeightLossOverride(clientId, idx);
      if (res.ok) {
        toast.success("Override removed");
        router.refresh();
      } else {
        toast.error(res.error ?? "Couldn't remove override");
      }
    });
  };

  const onPauseToggle = () => {
    startTransition(async () => {
      const res = await pauseWeightLossGoal(clientId, goal.enabled);
      if (res.ok) {
        toast.success(goal.enabled ? "Goal paused" : "Goal resumed");
        router.refresh();
      } else {
        toast.error(res.error ?? "Couldn't toggle");
      }
    });
  };

  const status: "active" | "paused" | "off" = goal.enabled
    ? "active"
    : "paused";

  // Build the sparkline data — normalised x positions over the goal window.
  const sparkSeries = useMemo(() => {
    try {
      const start = new Date(`${goal.starting_date}T00:00:00`).getTime();
      const target = new Date(`${goal.goal_target_date}T00:00:00`).getTime();
      const span = target - start;
      if (span <= 0) return [];
      return measurementsLog
        .filter((m) => typeof m.weight_kg === "number" && m.date)
        .map((m) => {
          const t = new Date(`${m.date}T00:00:00`).getTime();
          return {
            x: Math.max(0, Math.min(1, (t - start) / span)),
            kg: m.weight_kg as number,
            date: m.date,
          };
        })
        .sort((a, b) => a.x - b.x);
    } catch {
      return [];
    }
  }, [measurementsLog, goal.starting_date, goal.goal_target_date]);

  const todayX = useMemo(() => {
    try {
      const start = new Date(`${goal.starting_date}T00:00:00`).getTime();
      const target = new Date(`${goal.goal_target_date}T00:00:00`).getTime();
      const span = target - start;
      if (span <= 0) return null;
      return Math.max(0, Math.min(1, (Date.now() - start) / span));
    } catch {
      return null;
    }
  }, [goal.starting_date, goal.goal_target_date]);

  return (
    <div className="FmPanel" style={{ padding: 0 }}>
      <div className="wl-card" style={{ minWidth: 0, overflow: "hidden" }}>
        <div className="head">
          <div>
            <div className="FmPanel-eyebrow">Client goal</div>
            <h3>Weight loss</h3>
          </div>
          <div className="right">
            <Pill kind={status === "active" ? "active" : "paused"}>
              {status === "active" ? "Active" : "Paused"}
            </Pill>
            <button
              type="button"
              className="FmBtn FmBtn--ghost FmBtn--sm"
              title={goal.enabled ? "Pause goal" : "Resume goal"}
              onClick={onPauseToggle}
              disabled={pending}
            >
              {goal.enabled ? "Pause" : "Resume"}
            </button>
          </div>
        </div>

        {/* 3-up stats */}
        <div className="wl-stats">
          <Stat
            value={goal.starting_weight_kg}
            label="Starting"
            sub={fmtDate(goal.starting_date)}
          />
          <Stat
            value={currentReading.kg}
            label="Current"
            sub={fmtDate(currentReading.date ?? "")}
            valueClass="current"
            delta={kgLost > 0 ? `↓ ${kgLost} kg` : undefined}
          />
          <Stat
            value={goalWeight}
            label="Goal"
            sub={`by ${fmtDate(goal.goal_target_date)}`}
            valueClass="goal"
          />
        </div>

        {/* Progress bar */}
        <div className="wl-progress">
          <span
            style={{
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: 0.7,
              fontWeight: 700,
              color: "var(--fm-text-3)",
            }}
          >
            Wk {weeksElapsed} / {weeksTotal}
          </span>
          <div className="bar">
            <div className="fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="pct">
            {kgLost} of {totalToLose.toFixed(1)} kg
          </span>
        </div>

        {/* Sparkline */}
        {sparkSeries.length > 0 && (
          <div className="wl-spark-wrap">
            <div className="wl-spark-head">
              <div className="FmEyebrow">
                Weight trend · measurements log
              </div>
              <div className="legend">
                <span>
                  <span
                    className="swatch"
                    style={{ background: "var(--fm-secondary)" }}
                  />{" "}
                  actual
                </span>
                <span>
                  <span
                    className="swatch"
                    style={{
                      background: "var(--fm-primary)",
                      borderTop: "1px dashed var(--fm-primary)",
                    }}
                  />{" "}
                  goal trajectory
                </span>
              </div>
            </div>
            <Sparkline
              data={sparkSeries}
              goalStart={goal.starting_weight_kg}
              goalEnd={goalWeight}
              todayX={todayX}
              width={540}
              height={120}
            />
          </div>
        )}

        {/* Calorie phase ramp — the 40/70/100/80/60% gradual deficit
            curve the client letter uses (computeCaloriePhases, a TS port
            of _calc_calorie_targets). Read-only readout so the coach can
            sanity-check the ramp without generating a letter. */}
        {caloriePhases && (
          <div style={{ marginTop: 14 }}>
            <div className="FmEyebrow" style={{ marginBottom: 6 }}>
              Calorie phases · gradual deficit ramp
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              {[
                { k: "Wk 1–2", v: caloriePhases.phases.wk1_2 },
                { k: "Wk 3–4", v: caloriePhases.phases.wk3_4 },
                { k: "Wk 5–8", v: caloriePhases.phases.wk5_8, peak: true },
                { k: "Wk 9–10", v: caloriePhases.phases.wk9_10 },
                { k: "Wk 11–12", v: caloriePhases.phases.wk11_12 },
              ].map((p) => (
                <div
                  key={p.k}
                  style={{
                    flex: 1,
                    textAlign: "center",
                    padding: "6px 2px",
                    borderRadius: "var(--fm-radius-sm)",
                    background: p.peak
                      ? "rgba(220, 38, 38, 0.08)"
                      : "var(--fm-bg-cool)",
                    border: `1px solid ${
                      p.peak ? "rgba(220, 38, 38, 0.30)" : "var(--fm-border)"
                    }`,
                  }}
                >
                  <div
                    style={{
                      fontSize: 9.5,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: 0.4,
                      color: "var(--fm-text-tertiary)",
                    }}
                  >
                    {p.k}
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 800,
                      color: p.peak ? "#b91c1c" : "var(--fm-text-primary)",
                    }}
                  >
                    {p.v.toLocaleString()}
                  </div>
                  <div style={{ fontSize: 8.5, color: "var(--fm-text-tertiary)" }}>
                    kcal/day
                  </div>
                </div>
              ))}
            </div>
            <div
              style={{
                fontSize: 10,
                color: "var(--fm-text-tertiary)",
                marginTop: 4,
                lineHeight: 1.4,
              }}
            >
              Maintenance ≈ {caloriePhases.tdee.toLocaleString()} kcal · deficit
              ramps 40 → 70 → 100 → 80 → 60% · flows straight into the app
              menu.
            </div>
          </div>
        )}

        {/* Meta row */}
        <div className="wl-meta">
          <div className="item">
            <span className="l">Pace</span>
            <strong>{paceLabel}</strong>
          </div>
          <div className="item">
            <span className="l">Activity</span>
            <strong>{activityLabel}</strong>
            {(goal.exercise_days_per_week ||
              goal.exercise_current) && (
              <span
                className="mono"
                style={{ fontSize: 11, color: "var(--fm-text-3)" }}
              >
                {goal.exercise_days_per_week
                  ? ` · ${goal.exercise_days_per_week}d/wk`
                  : ""}
                {goal.exercise_current
                  ? ` · ${goal.exercise_current}`
                  : ""}
              </span>
            )}
          </div>
          {goal.exercise_limitations && (
            <div className="item">
              <span className="l">Limit</span>
              <span className="limitation">
                ⚠ {goal.exercise_limitations}
              </span>
            </div>
          )}
        </div>

        {/* Per-week overrides moved to the Communicate tab 2026-05-19
            (coach: travel info applies to all clients, not just
            weight-loss ones; and the natural place to set it is right
            before generating the next letter). See
            <TravelOverridesPanel/>. */}

        {/* Actions */}
        <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
          <button
            type="button"
            className="FmBtn FmBtn--primary FmBtn--sm"
            onClick={onEdit}
          >
            Edit goal
          </button>
          {/* "+ Add week override" button removed 2026-05-19 — flow now
              lives in the Communicate tab's TravelOverridesPanel. */}
          <span
            style={{
              marginLeft: "auto",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              fontSize: 11,
              color: "var(--fm-text-3)",
              fontFamily: "var(--fm-font-mono)",
            }}
          >
            Applies automatically to every app menu
          </span>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Empty state — when no weight_loss config yet.
// ───────────────────────────────────────────────────────────────────────────
function WeightLossEmpty({ onSet }: { onSet: () => void }) {
  return (
    <div className="wl-empty">
      <div className="icon">↗</div>
      <div className="FmEyebrow" style={{ marginBottom: 6 }}>
        Client goal
      </div>
      <h3>No weight-loss goal active</h3>
      <p>
        Add a goal if this client is working toward a target weight. The
        system uses it on every app menu automatically — set
        once, never re-asked.
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          className="FmBtn FmBtn--primary"
          onClick={onSet}
        >
          + Set weight loss goal
        </button>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Edit goal modal — used for both new + existing goals.
// ───────────────────────────────────────────────────────────────────────────
function EditGoalModal({
  clientId,
  goal,
  measurementsLog = [],
  currentWeightKg = null,
  intakeExercise,
  onClose,
}: {
  clientId: string;
  goal: WeightLossGoal | null;
  measurementsLog?: MeasurementEntry[];
  currentWeightKg?: number | null;
  intakeExercise?: IntakeExercise;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const isNew = !goal;

  // Pre-fill the starting weight + date from the best signal we have, so
  // creating a NEW goal isn't a blank form when the coach has already
  // captured weight at intake or via a measurement log. Order of
  // precedence (best signal first):
  //   1. existing goal record (when editing)
  //   2. most recent measurements_log entry with a weight reading
  //   3. client.weight_now_kg (intake form snapshot)
  // Coach can still override either field before saving.
  const latestMeasurement = (() => {
    const sorted = [...measurementsLog]
      .filter((m) => typeof m.weight_kg === "number" && m.date)
      .sort((a, b) =>
        String(b.date ?? "").localeCompare(String(a.date ?? "")),
      );
    return sorted[0];
  })();
  const defaultStartingKg =
    goal?.starting_weight_kg?.toString() ??
    (typeof latestMeasurement?.weight_kg === "number"
      ? String(latestMeasurement.weight_kg)
      : typeof currentWeightKg === "number"
        ? String(currentWeightKg)
        : "");
  const defaultStartingDate =
    goal?.starting_date ??
    latestMeasurement?.date ??
    new Date().toISOString().slice(0, 10);

  const [startingKg, setStartingKg] = useState(defaultStartingKg);
  const [startingDate, setStartingDate] = useState(defaultStartingDate);
  const [goalKg, setGoalKg] = useState(goal?.goal_kg?.toString() ?? "");
  const [goalTargetDate, setGoalTargetDate] = useState(
    goal?.goal_target_date ?? "",
  );
  const [pace, setPace] = useState<"slow" | "moderate" | "faster">(
    goal?.pace ?? "moderate",
  );
  // Exercise fields default to what the client reported at intake
  // (movement days / type / intensity → activity level) when setting up a
  // NEW goal, so the coach starts from the client's own answers instead of
  // a blank form. An existing goal's saved values always win. `prefilled`
  // drives the "from intake" hint shown under the section.
  const prefilledFromIntake =
    isNew &&
    !!intakeExercise &&
    (typeof intakeExercise.days === "number" ||
      !!intakeExercise.type);
  const [activity, setActivity] = useState<
    "sedentary" | "light" | "moderate" | "active"
  >(goal?.activity_level ?? deriveActivityFromIntake(intakeExercise) ?? "light");
  const [exCurrent, setExCurrent] = useState(
    goal?.exercise_current ?? intakeExercise?.type ?? "",
  );
  const [exOpenTo, setExOpenTo] = useState(goal?.exercise_open_to ?? "");
  const [exDays, setExDays] = useState(
    goal?.exercise_days_per_week?.toString() ??
      (typeof intakeExercise?.days === "number"
        ? String(intakeExercise.days)
        : ""),
  );
  const [exLimits, setExLimits] = useState(
    goal?.exercise_limitations ?? "",
  );
  const [notes, setNotes] = useState(goal?.notes_for_coach ?? "");

  const onSave = () => {
    const sw = parseFloat(startingKg);
    const gk = parseFloat(goalKg);
    const ed = exDays.trim() ? parseInt(exDays, 10) : undefined;
    if (!Number.isFinite(sw) || sw <= 0) {
      toast.error("Starting weight must be a positive number");
      return;
    }
    if (!Number.isFinite(gk) || gk <= 0) {
      toast.error("Goal kg must be a positive number");
      return;
    }
    if (!startingDate || !goalTargetDate) {
      toast.error("Starting date and goal target date are required");
      return;
    }
    const payload: WeightLossGoalPayload = {
      enabled: true,
      starting_weight_kg: sw,
      starting_date: startingDate,
      goal_kg: gk,
      goal_target_date: goalTargetDate,
      pace,
      activity_level: activity,
      exercise_current: exCurrent,
      exercise_open_to: exOpenTo,
      exercise_days_per_week: ed,
      exercise_limitations: exLimits,
      notes_for_coach: notes,
    };
    startTransition(async () => {
      const res = await updateClientWeightLossGoal(clientId, payload);
      if (res.ok) {
        toast.success(isNew ? "Goal set" : "Goal updated");
        onClose();
        router.refresh();
      } else {
        toast.error(res.error ?? "Save failed");
      }
    });
  };

  return (
    <ModalShell onClose={onClose}>
      <header>
        <h3>{isNew ? "Set weight-loss goal" : "Edit weight-loss goal"}</h3>
        <p>
          Applies automatically to every menu from the next publish onward.
        </p>
      </header>
      <div className="body">
        <div className="grid-2">
          <FmFieldShell
            label="Starting weight"
            help={
              isNew
                ? "Lock once and use Add measurement for new data points."
                : "Locked after first save — Add measurement for new data."
            }
          >
            <div className="FmInput-suffix">
              <input
                className="FmInput"
                type="number"
                step="0.1"
                value={startingKg}
                onChange={(e) => setStartingKg(e.target.value)}
                placeholder="80.0"
                readOnly={!isNew}
              />
              <span className="suffix">kg</span>
            </div>
          </FmFieldShell>
          <FmFieldShell label="Starting date">
            <input
              className="FmInput mono"
              type="date"
              value={startingDate}
              onChange={(e) => setStartingDate(e.target.value)}
              readOnly={!isNew}
            />
          </FmFieldShell>
        </div>

        <div className="grid-2">
          <FmFieldShell label="Goal — total kg to lose">
            <div className="FmInput-suffix">
              <input
                className="FmInput"
                type="number"
                step="0.1"
                value={goalKg}
                onChange={(e) => setGoalKg(e.target.value)}
                placeholder="6.0"
              />
              <span className="suffix">kg</span>
            </div>
          </FmFieldShell>
          <FmFieldShell label="Goal target date">
            <input
              className="FmInput mono"
              type="date"
              value={goalTargetDate}
              onChange={(e) => setGoalTargetDate(e.target.value)}
            />
          </FmFieldShell>
        </div>

        <FmFieldShell
          label="Pace"
          help="Slow ≈ 0.25 kg/wk · Moderate ≈ 0.5 kg/wk · Faster ≈ 0.75 kg/wk"
        >
          <div className="seg seg--primary">
            <button
              type="button"
              className={pace === "slow" ? "on" : ""}
              onClick={() => setPace("slow")}
            >
              Slow
            </button>
            <button
              type="button"
              className={pace === "moderate" ? "on" : ""}
              onClick={() => setPace("moderate")}
            >
              Moderate
            </button>
            <button
              type="button"
              className={pace === "faster" ? "on" : ""}
              onClick={() => setPace("faster")}
            >
              Faster
            </button>
          </div>
        </FmFieldShell>

        {prefilledFromIntake && (
          <p className="wl-form-hint" style={{ margin: "0 0 6px", fontSize: 12, opacity: 0.7 }}>
            ✨ Pre-filled from the client&apos;s intake form
            {typeof intakeExercise?.days === "number"
              ? ` (${intakeExercise.days} day${intakeExercise.days === 1 ? "" : "s"}/week`
              : " ("}
            {intakeExercise?.type ? `${typeof intakeExercise?.days === "number" ? " · " : ""}${intakeExercise.type}` : ""}
            ) — edit if needed.
          </p>
        )}
        <FmFieldShell label="Activity level">
          <div className="seg seg--primary">
            {(["sedentary", "light", "moderate", "active"] as const).map(
              (a) => (
                <button
                  key={a}
                  type="button"
                  className={activity === a ? "on" : ""}
                  onClick={() => setActivity(a)}
                >
                  {a.charAt(0).toUpperCase() + a.slice(1)}
                </button>
              ),
            )}
          </div>
        </FmFieldShell>

        <div className="grid-2">
          <FmFieldShell label="Current exercise">
            <input
              className="FmInput"
              value={exCurrent}
              onChange={(e) => setExCurrent(e.target.value)}
              placeholder="walking + light yoga"
            />
          </FmFieldShell>
          <FmFieldShell label="Open to">
            <input
              className="FmInput"
              value={exOpenTo}
              onChange={(e) => setExOpenTo(e.target.value)}
              placeholder="strength 2×/wk if knee allows"
            />
          </FmFieldShell>
        </div>

        <div className="grid-2">
          <FmFieldShell label="Days / wk">
            <input
              className="FmInput"
              type="number"
              min={0}
              max={7}
              value={exDays}
              onChange={(e) => setExDays(e.target.value)}
              placeholder="4"
            />
          </FmFieldShell>
          <FmFieldShell label="Limitations">
            <input
              className="FmInput"
              value={exLimits}
              onChange={(e) => setExLimits(e.target.value)}
              placeholder="knee pain (left, intermittent)"
            />
          </FmFieldShell>
        </div>

        <FmFieldShell
          label="Notes for coach"
          help="Won't be sent to client — only used internally and by the menu generator."
        >
          <textarea
            className="FmTextarea"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Sensitive about scale numbers — phrase progress as 'on track' rather than weekly weigh-ins."
          />
        </FmFieldShell>
      </div>
      <div className="footer">
        <span className="note">
          {isNew ? "Saving will enable the goal." : "Click save to apply."}
        </span>
        <button
          type="button"
          className="FmBtn FmBtn--ghost"
          onClick={onClose}
          disabled={pending}
        >
          Cancel
        </button>
        <button
          type="button"
          className="FmBtn FmBtn--primary"
          onClick={onSave}
          disabled={pending}
        >
          {pending ? "Saving…" : isNew ? "Set goal" : "Save changes"}
        </button>
      </div>
    </ModalShell>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Add per-week override modal.
// ───────────────────────────────────────────────────────────────────────────
function AddOverrideModal({
  clientId,
  onClose,
}: {
  clientId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Default date_from = today, date_to = today + 7 days (typical short trip).
  const today = new Date();
  const wkOut = new Date(today.getTime() + 7 * 86_400_000);
  const isoDate = (d: Date) => d.toISOString().slice(0, 10);
  const [dateFrom, setDateFrom] = useState(isoDate(today));
  const [dateTo, setDateTo] = useState(isoDate(wkOut));
  const [context, setContext] = useState<
    "travel" | "festival" | "illness" | "plateau_break" | "other"
  >("travel");
  const [location, setLocation] = useState("");
  const [mode, setMode] = useState<"maintenance" | "deeper_deficit" | "skip">(
    "maintenance",
  );
  const [kcalOffset, setKcalOffset] = useState("-200");
  const [reason, setReason] = useState("");

  const onSave = () => {
    if (!dateFrom || !dateTo || dateFrom > dateTo) {
      toast.error("Pick a valid date range");
      return;
    }
    if (context === "travel" && !location.trim()) {
      toast.error("Add a destination — the menu uses it for local meal swaps");
      return;
    }
    const payload: WeightLossWeekOverridePayload = {
      date_from: dateFrom,
      date_to: dateTo,
      mode,
      context,
      location: location.trim() || undefined,
      reason: reason.trim() || undefined,
    };
    if (mode === "deeper_deficit") {
      const k = parseInt(kcalOffset, 10);
      if (Number.isFinite(k)) payload.kcal_offset = k;
    }
    startTransition(async () => {
      const res = await addWeightLossOverride(clientId, payload);
      if (res.ok) {
        toast.success("Override added");
        onClose();
        router.refresh();
      } else {
        toast.error(res.error ?? "Couldn't add override");
      }
    });
  };

  return (
    <ModalShell onClose={onClose}>
      <header>
        <h3>Add override</h3>
        <p>
          Coach adds this whenever a client tells you about travel, a
          festival, illness, or you want a plateau break. The menu
          auto-applies it forever — you never re-enter.
        </p>
      </header>
      <div className="body">
        <FmFieldShell
          label="Dates"
          help="Inclusive. The menu generator maps to protocol weeks automatically."
        >
          <div className="range-pick">
            <input
              className="FmInput"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              style={{ flex: 1, minWidth: 0 }}
            />
            <span className="sep">→</span>
            <input
              className="FmInput"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              style={{ flex: 1, minWidth: 0 }}
            />
          </div>
        </FmFieldShell>

        <FmFieldShell
          label="Context"
          help="Travel triggers localised meal-swap mode. Festival relaxes restrictions. Illness skips structure."
        >
          <div className="seg seg--primary" style={{ width: "100%", flexWrap: "wrap" }}>
            {([
              ["travel", "✈ Travel"],
              ["festival", "🎉 Festival"],
              ["illness", "🤒 Illness"],
              ["plateau_break", "⏸ Plateau break"],
              ["other", "Other"],
            ] as const).map(([k, lbl]) => (
              <button
                key={k}
                type="button"
                className={context === k ? "on" : ""}
                style={{ flex: "1 1 auto" }}
                onClick={() => setContext(k)}
              >
                {lbl}
              </button>
            ))}
          </div>
        </FmFieldShell>

        {context === "travel" && (
          <FmFieldShell
            label="Destination"
            help="City + country. The app menu swaps to local cuisine + restaurant guidance for these dates."
          >
            <input
              className="FmInput"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Sydney, Australia"
            />
          </FmFieldShell>
        )}

        <FmFieldShell label="Mode">
          <div className="seg seg--primary" style={{ width: "100%" }}>
            <button
              type="button"
              className={mode === "maintenance" ? "on" : ""}
              style={{ flex: 1 }}
              onClick={() => setMode("maintenance")}
            >
              Maintenance
            </button>
            <button
              type="button"
              className={mode === "deeper_deficit" ? "on" : ""}
              style={{ flex: 1 }}
              onClick={() => setMode("deeper_deficit")}
            >
              Deeper deficit
            </button>
            <button
              type="button"
              className={mode === "skip" ? "on" : ""}
              style={{ flex: 1 }}
              onClick={() => setMode("skip")}
            >
              Skip
            </button>
          </div>
        </FmFieldShell>

        <FmFieldShell
          label="Calorie offset"
          help="Only used when mode = Deeper deficit. Negative for tighter deficit."
        >
          <div className="FmInput-suffix">
            <input
              className="FmInput"
              type="number"
              value={kcalOffset}
              onChange={(e) => setKcalOffset(e.target.value)}
              disabled={mode !== "deeper_deficit"}
              style={
                mode !== "deeper_deficit"
                  ? {
                      background: "var(--fm-surface-2)",
                      color: "var(--fm-text-3)",
                    }
                  : undefined
              }
            />
            <span className="suffix">kcal/day</span>
          </div>
        </FmFieldShell>

        <FmFieldShell
          label="Coach note"
          help="Free-text sticky note — surfaces in the menu only when context is set."
        >
          <input
            className="FmInput"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={
              context === "travel"
                ? "work trip with client lunches"
                : context === "festival"
                ? "Diwali week — family meals"
                : "extra context for future-you"
            }
          />
        </FmFieldShell>
      </div>
      <div className="footer">
        <span className="note">
          {mode === "maintenance" && "The menu in these weeks will use maintenance tables."}
          {mode === "deeper_deficit" && "Adds the kcal offset on top of base."}
          {mode === "skip" && "Weight-loss content removed from those menus."}
        </span>
        <button
          type="button"
          className="FmBtn FmBtn--ghost"
          onClick={onClose}
          disabled={pending}
        >
          Cancel
        </button>
        <button
          type="button"
          className="FmBtn FmBtn--primary"
          onClick={onSave}
          disabled={pending}
        >
          {pending ? "Saving…" : "Add override"}
        </button>
      </div>
    </ModalShell>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Small leaf components (kept inline to avoid file sprawl).
// ───────────────────────────────────────────────────────────────────────────
function Stat({
  value,
  label,
  sub,
  delta,
  valueClass,
}: {
  value: number;
  label: string;
  sub?: string;
  delta?: string;
  valueClass?: string;
}) {
  return (
    <div className="wl-stat">
      <div className={`v ${valueClass ?? ""}`.trim()}>
        {value.toFixed(1)}
        <sub>kg</sub>
      </div>
      <div className="l">{label}</div>
      {sub && <div className="s">{sub}</div>}
      {delta && <div className="delta">{delta}</div>}
    </div>
  );
}

function Pill({
  kind,
  children,
}: {
  kind: "active" | "paused" | "off";
  children: React.ReactNode;
}) {
  return (
    <span className={`pill pill--${kind}`}>
      <span className="dot" />
      {children}
    </span>
  );
}

function FmFieldShell({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="FmField">
      <label className="FmField-label">{label}</label>
      {children}
      {help && <div className="FmField-help">{help}</div>}
    </div>
  );
}

function ModalShell({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="modal-wrap"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: 24,
      }}
    >
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 560, width: "100%" }}
      >
        {children}
      </div>
    </div>
  );
}

// Sparkline — adapted from fm-v2c-primitives.jsx, ported to TSX.
function Sparkline({
  data,
  goalStart,
  goalEnd,
  width = 540,
  height = 130,
  todayX = null,
}: {
  data: { x: number; kg: number; date?: string }[];
  goalStart: number;
  goalEnd: number;
  width?: number;
  height?: number;
  todayX?: number | null;
}) {
  if (data.length === 0) return null;
  const allKg = [...data.map((d) => d.kg), goalStart, goalEnd];
  const minKg = Math.floor(Math.min(...allKg) - 0.5);
  const maxKg = Math.ceil(Math.max(...allKg) + 0.5);
  const padX = 16,
    padTop = 14,
    padBot = 22;
  const xAt = (x: number) => padX + x * (width - padX * 2);
  const yAt = (kg: number) =>
    padTop + (1 - (kg - minKg) / (maxKg - minKg)) * (height - padTop - padBot);
  const actual = data.map((d) => ({
    x: xAt(d.x),
    y: yAt(d.kg),
    kg: d.kg,
    date: d.date,
  }));
  const actualPath = actual
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");
  const goalPath = `M${xAt(0).toFixed(1)},${yAt(goalStart).toFixed(
    1,
  )} L${xAt(1).toFixed(1)},${yAt(goalEnd).toFixed(1)}`;
  return (
    <svg
      className="spark"
      // Use viewBox-driven scaling — the SVG paints into its intrinsic
      // 540x120 box but the <svg> element scales to its container.
      // Previously the `width={540}` attr forced a fixed pixel width
      // which overflowed the Overview right column on narrower
      // viewports (coach feedback 2026-05-19).
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ maxWidth: "100%", display: "block" }}
    >
      {[0.25, 0.5, 0.75].map((t) => (
        <line
          key={t}
          x1={padX}
          x2={width - padX}
          y1={padTop + t * (height - padTop - padBot)}
          y2={padTop + t * (height - padTop - padBot)}
          stroke="var(--fm-border-light)"
          strokeWidth="1"
        />
      ))}
      <text
        x="6"
        y={yAt(maxKg) + 4}
        fontSize="10"
        fill="var(--fm-text-3)"
        fontFamily="var(--fm-font-mono)"
      >
        {maxKg}
      </text>
      <text
        x="6"
        y={yAt(minKg) + 4}
        fontSize="10"
        fill="var(--fm-text-3)"
        fontFamily="var(--fm-font-mono)"
      >
        {minKg}
      </text>
      <path
        d={goalPath}
        stroke="var(--fm-primary)"
        strokeWidth="1.5"
        fill="none"
        strokeDasharray="4 4"
        opacity="0.85"
      />
      <circle
        cx={xAt(1)}
        cy={yAt(goalEnd)}
        r="4"
        fill="var(--fm-primary)"
      />
      <text
        x={xAt(1) - 4}
        y={yAt(goalEnd) - 8}
        fontSize="10"
        fill="var(--fm-primary-dark)"
        fontFamily="var(--fm-font-mono)"
        textAnchor="end"
      >
        goal {goalEnd}kg
      </text>
      <path
        d={actualPath}
        stroke="var(--fm-secondary)"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {actual.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r={i === actual.length - 1 ? 4 : 2.5}
          fill={
            i === actual.length - 1
              ? "var(--fm-secondary)"
              : "var(--fm-surface)"
          }
          stroke="var(--fm-secondary)"
          strokeWidth="1.5"
        />
      ))}
      {actual.length > 0 && (
        <text
          x={actual[actual.length - 1].x + 6}
          y={actual[actual.length - 1].y + 4}
          fontSize="10"
          fill="var(--fm-secondary-dark)"
          fontFamily="var(--fm-font-mono)"
        >
          now {actual[actual.length - 1].kg}kg
        </text>
      )}
      {todayX != null && (
        <line
          x1={xAt(todayX)}
          x2={xAt(todayX)}
          y1={padTop - 2}
          y2={height - padBot + 4}
          stroke="var(--fm-text-3)"
          strokeWidth="1"
          strokeDasharray="2 3"
          opacity="0.5"
        />
      )}
    </svg>
  );
}

function fmtDate(iso: string): string {
  if (!iso) return "";
  try {
    return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString(
      "en-GB",
      { day: "numeric", month: "short", year: "numeric" },
    );
  } catch {
    return iso;
  }
}
