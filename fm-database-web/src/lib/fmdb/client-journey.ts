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

export type JourneyStepStatus =
  | "done"
  | "active"
  | "pending"
  | "na"
  | "declined";

export interface JourneyStep {
  id:
    | "discovery"
    | "engagement"
    | "intake"
    | "plan"
    | "week"
    | "next_phase"
    | "plan_end";
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
  // We need the client.yaml for the engagement_status field. Lazy import
  // to avoid a circular load — `loader-extras` is already imported here
  // for sessions; `loadClientById` lives in the same module.
  const { loadClientById } = await import("./loader-extras");
  const client = await loadClientById(clientId);

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

  // ── Compute next-phase-letter window (mid-cycle communication).
  //     Convention from PhaseLetterPanel: phases are 2 weeks long
  //     (weeks 1-2 ship with the consolidated letter; weeks 3-4 is the
  //     first phase letter; weeks 5-6 second; etc.). The "next batch"
  //     step shows the date when the upcoming phase letter is due —
  //     i.e. the start of the next 2-week pair after the current week.
  let nextPhaseStartIso: string | null = null;
  let nextPhaseRange: { start: number; end: number } | null = null;
  if (publishedPlan && currentWeek != null && planWeeks && planStart) {
    const start = new Date(`${planStart}T00:00:00`);
    // Phase pairs: [1,2], [3,4], [5,6], ...
    // The phase currently active = ceil(currentWeek / 2)
    // The NEXT phase = currentPhase + 1, starting at week = currentPhase*2 + 1
    const currentPhase = Math.ceil(currentWeek / 2);
    const nextPhaseStartWeek = currentPhase * 2 + 1;
    const nextPhaseEndWeek = Math.min(nextPhaseStartWeek + 1, planWeeks);
    if (nextPhaseStartWeek <= planWeeks) {
      const d = new Date(start);
      // The phase letter is sent at the END of the previous phase (i.e. at the
      // start of the new phase). Subtract a couple of days so the coach has
      // breathing room — convention: send 2 days before the new phase starts.
      d.setDate(d.getDate() + (nextPhaseStartWeek - 1) * 7 - 2);
      nextPhaseStartIso = d.toISOString().slice(0, 10);
      nextPhaseRange = { start: nextPhaseStartWeek, end: nextPhaseEndWeek };
    }
  }

  // Plan completion date — end of the protocol window.
  let planEndIso: string | null = null;
  if (publishedPlan && planStart && planWeeks) {
    const start = new Date(`${planStart}T00:00:00`);
    start.setDate(start.getDate() + planWeeks * 7);
    planEndIso = start.toISOString().slice(0, 10);
  } else if (recheckDateIso) {
    planEndIso = recheckDateIso;
  }

  const todayMs = new Date(`${todayIso}T00:00:00`).getTime();

  // ── Build the steps array.
  const steps: JourneyStep[] = [];

  // Step 1 — Discovery
  steps.push({
    id: "discovery",
    label: "Discovery",
    status: discovery ? "done" : "pending",
    caption: (asString(pluck(discovery, "date")) as string | undefined) ?? "—",
  });

  // Step 2 — Engagement decision. Sits between Discovery and Intake
  // because not every discovery client signs up — coach explicitly
  // flagged this gap 2026-05-13. Three states:
  //   pending  — discovery done, waiting for the coach to mark it
  //   signed_up — moving forward
  //   declined — politely passed
  const engagementRaw = asString(pluck(client, "engagement_status"));
  const engagement =
    engagementRaw === "signed_up"
      ? "signed_up"
      : engagementRaw === "declined"
        ? "declined"
        : "pending";
  if (!discovery) {
    // No discovery yet — engagement step is just an upcoming slot.
    steps.push({
      id: "engagement",
      label: "Sign-up",
      status: "pending",
      caption: "—",
    });
  } else if (engagement === "signed_up") {
    steps.push({
      id: "engagement",
      label: "Sign-up",
      status: "done",
      caption: "Confirmed",
    });
  } else if (engagement === "declined") {
    steps.push({
      id: "engagement",
      label: "Sign-up",
      status: "declined",
      caption: "Declined",
    });
  } else {
    // Discovery done but no decision yet.
    steps.push({
      id: "engagement",
      label: "Sign-up · decide?",
      status: "active",
      caption: "Click to confirm",
    });
  }

  // If client declined after discovery, the rest of the journey is N/A.
  const declined = engagement === "declined";

  // Step 3 — Intake
  steps.push({
    id: "intake",
    label: "Intake",
    status: declined
      ? "na"
      : intake
        ? "done"
        : engagement === "signed_up"
          ? "active"
          : "pending",
    caption: (asString(pluck(intake, "date")) as string | undefined) ?? "—",
  });

  // Step 3 — Plan active (start date)
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

  // Step 4 — Week N progress. No date — start date already shown on step 3.
  if (publishedPlan && currentWeek != null && planWeeks) {
    // "X days in" caption is cleaner than restating the start date.
    let daysIn: number | null = null;
    if (planStart) {
      const start = new Date(`${planStart}T00:00:00`).getTime();
      daysIn = Math.max(0, Math.floor((todayMs - start) / (24 * 60 * 60 * 1000)));
    }
    steps.push({
      id: "week",
      label: `Week ${currentWeek} of ${planWeeks}`,
      status: "active",
      caption: daysIn != null ? `${daysIn} day${daysIn === 1 ? "" : "s"} in` : undefined,
    });
  } else {
    steps.push({
      id: "week",
      label: "Week —",
      status: "na",
      caption: publishedPlan ? "no start date" : "—",
    });
  }

  // Step 5 — Next phase letter due (mid-cycle communication batch).
  //   If no published plan, this step is n/a.
  //   If we're past the last phase, it folds into "Plan complete".
  if (nextPhaseStartIso && nextPhaseRange) {
    const due = new Date(`${nextPhaseStartIso}T00:00:00`).getTime();
    const overdue = due < todayMs;
    steps.push({
      id: "next_phase",
      label: overdue
        ? `Phase letter overdue (wk ${nextPhaseRange.start}–${nextPhaseRange.end})`
        : `Next phase letter (wk ${nextPhaseRange.start}–${nextPhaseRange.end})`,
      status: overdue ? "active" : "pending",
      caption: nextPhaseStartIso,
    });
  } else {
    steps.push({
      id: "next_phase",
      label: "Next phase letter",
      status: "na",
      caption: publishedPlan ? "final phase" : "—",
    });
  }

  // Step 6 — Plan completion (recheck / supersede window).
  if (planEndIso) {
    const endMs = new Date(`${planEndIso}T00:00:00`).getTime();
    const overdue = endMs < todayMs;
    steps.push({
      id: "plan_end",
      label: overdue ? "Plan complete — reassess" : "Plan completion",
      status: overdue ? "active" : "pending",
      caption: planEndIso,
    });
  } else {
    steps.push({
      id: "plan_end",
      label: "Plan completion",
      status: "na",
      caption: "—",
    });
  }

  return { steps };
}
