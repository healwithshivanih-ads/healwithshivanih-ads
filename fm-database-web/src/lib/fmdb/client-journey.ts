import "server-only";
import { loadClientSessions } from "./loader-extras";
import { loadAllPlans } from "./loader";
import { parseSessionType } from "./session-utils";

/**
 * ClientJourney — the workflow-stage snapshot rendered as the
 * breadcrumb-style strip on top of every client subpage. Tracks:
 *
 *   Discovery  →  Intake  →  Plan active  →  Week N  →  Next plan due
 *
 * Each step has a status:
 *   done      — completed; shows date.
 *   active    — currently in progress; shows date / context.
 *   pending   — not yet started.
 *   na        — n/a (e.g. plan-not-published → "Week N" is irrelevant).
 *
 * Computed server-side so every PageShell can mount the strip without
 * each one re-running session/plan loads.
 */

export type JourneyStepStatus = "done" | "active" | "pending" | "na";

export interface JourneyStep {
  id: "discovery" | "intake" | "plan" | "week" | "next_plan";
  label: string;
  status: JourneyStepStatus;
  /** Free-text caption beneath the label — usually a date. */
  caption?: string;
}

export interface ClientJourney {
  steps: JourneyStep[];
}

const PUBLISHED_BUCKET = new Set(["published"]);
const DRAFT_BUCKETS = new Set(["draft", "ready_to_publish"]);

function pluck(rec: unknown, key: string): unknown {
  return (rec as Record<string, unknown> | null | undefined)?.[key];
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** "12th July 2026" → done by FmClientJourneyStrip; here we keep ISO. */

export async function loadClientJourney(
  clientId: string,
  todayIso: string,
): Promise<ClientJourney> {
  const [sessions, allPlans] = await Promise.all([
    loadClientSessions(clientId),
    loadAllPlans(),
  ]);

  const plans = allPlans.filter(
    (p) => (p as unknown as { client_id?: string }).client_id === clientId,
  );

  // ── Discovery / Intake — find earliest session of each type.
  const discovery = sessions
    .filter(
      (s) =>
        parseSessionType(
          pluck(s, "presenting_complaints") as string | undefined,
        ) === "discovery",
    )
    .sort((a, b) =>
      String(pluck(a, "date") ?? "").localeCompare(String(pluck(b, "date") ?? "")),
    )[0];

  const intake = sessions
    .filter(
      (s) =>
        parseSessionType(
          pluck(s, "presenting_complaints") as string | undefined,
        ) === "intake",
    )
    .sort((a, b) =>
      String(pluck(a, "date") ?? "").localeCompare(String(pluck(b, "date") ?? "")),
    )[0];

  // ── Plan — prefer published, fall back to most-recent draft.
  const publishedPlan = plans.find((p) =>
    PUBLISHED_BUCKET.has(String(pluck(p, "status") ?? pluck(p, "_bucket"))),
  );
  const draftPlan = plans
    .filter((p) =>
      DRAFT_BUCKETS.has(String(pluck(p, "status") ?? pluck(p, "_bucket"))),
    )
    .sort((a, b) =>
      String(pluck(b, "updated_at") ?? "").localeCompare(
        String(pluck(a, "updated_at") ?? ""),
      ),
    )[0];

  // ── Week N — only meaningful if plan published with start + period.
  const planStart = asString(pluck(publishedPlan, "plan_period_start"));
  const planWeeks = asNumber(pluck(publishedPlan, "plan_period_weeks"));
  let currentWeek: number | null = null;
  let recheckDateIso: string | null = null;
  if (planStart && planWeeks) {
    const start = new Date(`${planStart}T00:00:00`);
    const today = new Date(`${todayIso}T00:00:00`);
    const msPerWeek = 7 * 24 * 60 * 60 * 1000;
    currentWeek = Math.max(
      1,
      Math.min(planWeeks, Math.floor((today.getTime() - start.getTime()) / msPerWeek) + 1),
    );
    const recheck = new Date(start);
    recheck.setDate(recheck.getDate() + planWeeks * 7);
    recheckDateIso = recheck.toISOString().slice(0, 10);
  } else {
    recheckDateIso = asString(pluck(publishedPlan, "plan_period_recheck_date")) ?? null;
  }

  // ── Build the steps array.
  const steps: JourneyStep[] = [];

  // Step 1 — Discovery
  steps.push({
    id: "discovery",
    label: "Discovery",
    status: discovery ? "done" : "pending",
    caption: (asString(pluck(discovery, "date")) as string | undefined) ?? "—",
  });

  // Step 2 — Intake
  steps.push({
    id: "intake",
    label: "Intake",
    status: intake ? "done" : discovery ? "active" : "pending",
    caption: (asString(pluck(intake, "date")) as string | undefined) ?? "—",
  });

  // Step 3 — Plan
  if (publishedPlan) {
    steps.push({
      id: "plan",
      label: "Plan active",
      status: "done",
      caption: planStart ?? "active",
    });
  } else if (draftPlan) {
    steps.push({
      id: "plan",
      label: "Plan draft",
      status: "active",
      caption: asString(pluck(draftPlan, "updated_at"))?.slice(0, 10) ?? "in progress",
    });
  } else {
    steps.push({
      id: "plan",
      label: "Plan",
      status: intake ? "active" : "pending",
      caption: "—",
    });
  }

  // Step 4 — Week N (only if a published plan with start + period)
  if (publishedPlan && currentWeek != null && planWeeks) {
    steps.push({
      id: "week",
      label: `Week ${currentWeek} of ${planWeeks}`,
      status: "active",
      caption: planStart ? `started ${planStart}` : undefined,
    });
  } else {
    steps.push({
      id: "week",
      label: "Week —",
      status: "na",
      caption: publishedPlan ? "no start date" : "—",
    });
  }

  // Step 5 — Next plan due (recheck)
  if (recheckDateIso) {
    const today = new Date(`${todayIso}T00:00:00`).getTime();
    const rec = new Date(`${recheckDateIso}T00:00:00`).getTime();
    const overdue = rec < today;
    steps.push({
      id: "next_plan",
      label: overdue ? "Next plan overdue" : "Next plan due",
      status: overdue ? "active" : "pending",
      caption: recheckDateIso,
    });
  } else {
    steps.push({
      id: "next_plan",
      label: "Next plan due",
      status: "na",
      caption: "—",
    });
  }

  return { steps };
}
