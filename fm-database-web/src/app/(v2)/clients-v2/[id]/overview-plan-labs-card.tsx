/**
 * OverviewPlanLabsCard — upcoming retest labs from the client's active
 * plan. Replaces the Discovery-labs card on the Overview for any client
 * with a published plan (the discovery-stage list is captured + sent
 * during onboarding; it shouldn't keep nagging the coach forever).
 *
 * Coach asked 2026-05-23: "Discovery labs showing on overview for a
 * client who already has an active plan doesn't make sense. Change it
 * to New Labs to be ordered and the date they should be ordered — but
 * not to show that as an actionable flag till the date is 2 days away."
 *
 * Behaviour:
 *  - Reads `plan.lab_orders` from the active plan
 *  - Only surfaces entries with `due_in_weeks` set (the retest labs).
 *    Baseline orders (no due_in_weeks) were ordered at plan start;
 *    surfacing them here would mean nagging the coach about labs
 *    she's already ordered.
 *  - Computes `dueDate = effective_meal_plan_start + due_in_weeks × 7`.
 *  - Calm read-only list when nothing's due within 2 days.
 *  - Switches to amber actionable header when ≥1 lab is due in ≤2 days
 *    (or overdue).
 */
import { FmPanel } from "@/components/fm";
import { effectiveMealPlanStart } from "@/lib/fmdb/plan-timing";

interface LabOrderLike {
  test?: string;
  reason?: string;
  kind?: string | null;
  due_in_weeks?: number | null;
}

interface PlanLike {
  slug?: string;
  plan_period_start?: string;
  meal_plan_started_on?: string;
  lab_orders?: LabOrderLike[];
}

interface Props {
  plan: PlanLike;
  /** YYYY-MM-DD; usually `todayStr` from the page. */
  today: string;
}

function addDaysIso(iso: string, days: number): string | null {
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(fromIso + "T00:00:00").getTime();
  const b = new Date(toIso + "T00:00:00").getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return NaN;
  return Math.round((b - a) / 86_400_000);
}

function fmtDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function OverviewPlanLabsCard({ plan, today }: Props) {
  const startIso =
    effectiveMealPlanStart(plan) ?? (plan.plan_period_start ?? null);
  if (!startIso) return null;

  // Only surface labs with an explicit due_in_weeks — these are the
  // retest orders the coach has explicitly scheduled. Baseline orders
  // (no due_in_weeks) were ordered at plan start; we don't want to keep
  // them as standing nags on the Overview.
  const entries: { test: string; dueIso: string; daysUntil: number; reason: string }[] = [];
  for (const lo of plan.lab_orders ?? []) {
    if (typeof lo.due_in_weeks !== "number" || lo.due_in_weeks <= 0) continue;
    if (!lo.test) continue;
    const dueIso = addDaysIso(startIso, lo.due_in_weeks * 7);
    if (!dueIso) continue;
    const daysUntil = daysBetween(today, dueIso);
    entries.push({
      test: lo.test,
      dueIso,
      daysUntil,
      reason: lo.reason ?? "",
    });
  }
  if (entries.length === 0) return null;

  // Sort by soonest first.
  entries.sort((a, b) => a.daysUntil - b.daysUntil);

  // Actionable iff anything is overdue OR due within 2 days. This
  // matches the coach's explicit ask: calm record-keeping by default,
  // amber action prompt only when she's near the order date.
  const ACTIONABLE_THRESHOLD = 2;
  const actionable = entries.some((e) => e.daysUntil <= ACTIONABLE_THRESHOLD);
  const overdueCount = entries.filter((e) => e.daysUntil < 0).length;
  const dueSoonCount = entries.filter(
    (e) => e.daysUntil >= 0 && e.daysUntil <= ACTIONABLE_THRESHOLD,
  ).length;

  const subtitle = actionable
    ? overdueCount > 0 && dueSoonCount > 0
      ? `${overdueCount} overdue · ${dueSoonCount} due in the next 2 days`
      : overdueCount > 0
        ? `${overdueCount} lab${overdueCount === 1 ? "" : "s"} overdue`
        : `${dueSoonCount} lab${dueSoonCount === 1 ? "" : "s"} due in the next 2 days`
    : `Quiet for now — soonest is ${fmtDate(entries[0].dueIso)} (in ${entries[0].daysUntil} days).`;

  return (
    <FmPanel
      title="📋 New labs to be ordered"
      subtitle={subtitle}
      style={
        actionable
          ? {
              background: "rgba(245, 158, 11, 0.06)",
              borderColor: "rgba(245, 158, 11, 0.40)",
            }
          : undefined
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {entries.map((e) => {
          const isActionable = e.daysUntil <= ACTIONABLE_THRESHOLD;
          const flag =
            e.daysUntil < 0
              ? `${Math.abs(e.daysUntil)}d overdue`
              : e.daysUntil === 0
                ? "today"
                : e.daysUntil === 1
                  ? "tomorrow"
                  : `in ${e.daysUntil} days`;
          return (
            <div
              key={`${e.test}-${e.dueIso}`}
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 10,
                padding: "6px 10px",
                background: isActionable ? "rgba(245, 158, 11, 0.10)" : "transparent",
                border: isActionable
                  ? "1px solid rgba(245, 158, 11, 0.30)"
                  : "1px solid rgba(0,0,0,0.06)",
                borderRadius: 6,
                fontSize: 13,
              }}
            >
              <span
                style={{
                  fontWeight: isActionable ? 700 : 500,
                  color: isActionable ? "#92400e" : "var(--fm-text-primary)",
                  flex: 1,
                  minWidth: 0,
                }}
              >
                {e.test}
              </span>
              <span
                style={{
                  fontSize: 12,
                  color: isActionable ? "#92400e" : "var(--fm-text-tertiary)",
                  whiteSpace: "nowrap",
                }}
              >
                {fmtDate(e.dueIso)}
              </span>
              <span
                style={{
                  fontSize: 11,
                  color: isActionable ? "#92400e" : "var(--fm-text-tertiary)",
                  whiteSpace: "nowrap",
                  fontStyle: isActionable ? "normal" : "italic",
                }}
              >
                {flag}
              </span>
            </div>
          );
        })}
      </div>
    </FmPanel>
  );
}
