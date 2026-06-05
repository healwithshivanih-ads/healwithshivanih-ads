import "server-only";
import { loadClientSessions } from "./loader-extras";
import { loadAllPlans } from "./loader";
import { parseSessionType } from "./session-utils";
import { effectiveMealPlanStart, effectiveRecheckDate } from "./plan-timing";

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
  /** Click target. When set, FmClientJourneyStrip renders the chip as a
   *  link to this URL so the coach can jump from any step into the
   *  relevant surface (e.g. discovery → run/review the discovery form,
   *  plan → the plan editor, week → check-in form). */
  href?: string;
}

/** A single concrete "do this next" recommendation surfaced above the
 *  session-type picker. Computed from the same journey state — saves the
 *  coach from staring at five generic Run-X buttons and guessing. */
export interface NextStep {
  label: string;
  href: string;
  /** One-line explanation of why this is the suggested next move. */
  reason: string;
}

export interface ClientJourney {
  steps: JourneyStep[];
  nextStep: NextStep | null;
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

  // "Intake done" = a COACH intake session exists — a session whose
  // presenting_complaints carries the LITERAL [session_type: intake] (or
  // legacy [session_type: full_assessment]) tag, which is what the v2
  // /analyse/intake flow writes. It must NOT count the client's online
  // questionnaire ([source: client_intake_form], no session_type tag) or
  // untagged legacy notes — parseSessionType DEFAULTS untagged sessions
  // to "intake", which produced false "intake done" positives. Mirrors
  // the dashboard-v2 computeSignal hasCoachIntake rule so the journey
  // strip and the triage buckets agree.
  const intake = sessions
    .filter((s) =>
      /\[session_type:\s*(intake|full_assessment)\]/i.test(
        String(pluck(s, "presenting_complaints") ?? ""),
      ),
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
  // Use the same priority chain as the Plan tab's planStartAnchor:
  //   meal_plan_started_on → supplements_started_on → plan_period_start
  // Without this the Analyse banner shows "Week 1 of 8" on the date a
  // plan revision was published even though the client has been on the
  // protocol for weeks (cl-004 Dhanishta hit this — plan #2 published
  // 12 May, real start 6 May; Analyse banner said week 1 on 18 May
  // instead of correct week 2).
  // Day-1 + recheck come from the SINGLE source of truth (plan-timing.ts) —
  // the same helper the dashboard / calendar / drip panel use. This file used
  // to have its own divergent chain (…→ supplements_started_on →
  // plan_period_start, no +3d), so the journey strip showed a different
  // week/recheck than every other surface for some clients (audit Phase-1 H1).
  const planLike = {
    meal_plan_started_on: asString(pluck(publishedPlan, "meal_plan_started_on")) ?? undefined,
    plan_period_start: asString(pluck(publishedPlan, "plan_period_start")) ?? undefined,
    plan_period_weeks: asNumber(pluck(publishedPlan, "plan_period_weeks")) ?? undefined,
    plan_period_recheck_date:
      asString(pluck(publishedPlan, "plan_period_recheck_date")) ?? undefined,
  };
  const planStart = effectiveMealPlanStart(planLike);
  const planWeeks = planLike.plan_period_weeks ?? null;
  let currentWeek: number | null = null;
  const recheckDateIso: string | null =
    effectiveRecheckDate(planLike) ?? planLike.plan_period_recheck_date ?? null;
  if (planStart && planWeeks) {
    const start = new Date(`${planStart}T00:00:00Z`);
    const today = new Date(`${todayIso}T00:00:00Z`);
    const msPerWeek = 7 * 24 * 60 * 60 * 1000;
    currentWeek = Math.max(
      1,
      Math.min(planWeeks, Math.floor((today.getTime() - start.getTime()) / msPerWeek) + 1),
    );
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
      // Coach rule 2026-06-04: send the next fortnight letter 3 days BEFORE
      // the current fortnight expires. Current fortnight = currentPhase,
      // covering days [(cp-1)*14+1 .. cp*14]; expiry offset from Day 1 =
      // cp*14 - 1, minus the 3-day lead → cp*14 - 4. Since
      // (nextPhaseStartWeek-1)*7 == cp*14, that's the same as -4 here.
      // Matches MealPlanDripPanel + the dashboard phase_letter_due signal.
      d.setDate(d.getDate() + (nextPhaseStartWeek - 1) * 7 - 4);
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

  // Fix F6 2026-05-23 — legacy / direct-intake clients have intake
  // submitted but no discovery session on record. The Discovery step
  // used to render as "pending — —", reading as "stuff is missing"
  // when it actually isn't. If intake is done and discovery is null,
  // mark the Discovery step as N/A with "(joined directly)" caption.
  // This is INDEPENDENT of engagement_status — a signed-up client can
  // still have skipped the discovery step.
  const intakeDoneNoDiscovery = !!intake && !discovery;

  // Step 1 — Discovery
  steps.push({
    id: "discovery",
    label: "Discovery",
    status: discovery ? "done" : intakeDoneNoDiscovery ? "na" : "pending",
    caption:
      (asString(pluck(discovery, "date")) as string | undefined) ??
      (intakeDoneNoDiscovery ? "joined directly" : "—"),
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
    // No discovery yet — engagement step is just an upcoming slot UNLESS
    // engagement was explicitly recorded (signed_up / declined) or this
    // is a legacy direct-intake client.
    // Fix F6 2026-05-23 — collapse the "—" caption to a clearer state.
    if (engagement === "signed_up") {
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
      const isLegacyNoSignup = intakeDoneNoDiscovery;
      steps.push({
        id: "engagement",
        label: "Sign-up",
        status: isLegacyNoSignup ? "na" : "pending",
        caption: isLegacyNoSignup ? "joined directly" : "—",
      });
    }
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
  // Status logic:
  //   "active"  — published plan, no check-in logged YET this week → coach
  //               needs to log this week's check-in (this is the prompt)
  //   "done"    — check-in already logged within the last 7 days → coach
  //               has done this week's pulse; surface a different next step
  //   "na"      — no published plan / no start date
  //
  // Previously every published-plan client showed the week step as
  // "active", so the nextStep banner kept saying "log this week's
  // check-in" even right after the coach finished one. Bug surfaced
  // for cl-004 18 May 2026.
  if (publishedPlan && currentWeek != null && planWeeks) {
    // Fix F10 2026-05-23 — daysIn used to clamp at 0, so plans
    // published with a future plan_period_start showed "0 days in"
    // on the day they were prepared. Now we surface a "Starts in N
    // days" caption when the plan hasn't begun yet, and only flip to
    // "N days in" once start ≤ today.
    let daysIn: number | null = null;
    let daysUntilStart: number | null = null;
    if (planStart) {
      const start = new Date(`${planStart}T00:00:00`).getTime();
      const diffDays = Math.floor((todayMs - start) / (24 * 60 * 60 * 1000));
      if (diffDays >= 0) {
        daysIn = diffDays;
      } else {
        daysUntilStart = -diffDays;
      }
    }

    // Most recent check-in date (any session whose presenting_complaints
    // carries [session_type: check_in]).
    let lastCheckinIso: string | null = null;
    for (const s of sessions) {
      const rec = s as Record<string, unknown>;
      const tag = typeof rec.presenting_complaints === "string"
        ? (rec.presenting_complaints as string)
        : "";
      if (tag.includes("session_type: check_in")) {
        const d = asString(rec.date);
        if (d && (!lastCheckinIso || d > lastCheckinIso)) {
          lastCheckinIso = d;
        }
      }
    }
    let checkinDoneThisWeek = false;
    if (lastCheckinIso) {
      const last = new Date(`${lastCheckinIso}T00:00:00`).getTime();
      const daysSince = Math.floor((todayMs - last) / (24 * 60 * 60 * 1000));
      checkinDoneThisWeek = daysSince >= 0 && daysSince < 7;
    }

    // Fix F10 — when plan hasn't started yet, the "Week N of M" step is
    // pre-active rather than active; caption explains the wait.
    const notStartedYet = daysUntilStart != null;
    steps.push({
      id: "week",
      label: notStartedYet ? `Week 1 of ${planWeeks}` : `Week ${currentWeek} of ${planWeeks}`,
      status: notStartedYet ? "pending" : checkinDoneThisWeek ? "done" : "active",
      caption: notStartedYet
        ? daysUntilStart === 1
          ? "Starts tomorrow"
          : daysUntilStart === 0
            ? "Starts today"
            : `Starts in ${daysUntilStart} days`
        : checkinDoneThisWeek
          ? `Check-in logged${lastCheckinIso ? ` ${lastCheckinIso}` : ""}`
          : daysIn != null
            ? daysIn === 0
              ? "Day 1 today"
              : `${daysIn} day${daysIn === 1 ? "" : "s"} in`
            : undefined,
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

  // ── Wire every step to its natural destination so the chip is
  //    clickable (coach asked: "these should be clickable"). Each
  //    step's href is computed once we know what plan / sessions
  //    exist on disk.
  // clientId is already a parameter on this function.
  const draftSlug = asString(pluck(draftPlan, "slug"));
  const publishedSlug = asString(pluck(publishedPlan, "slug"));

  const hrefByStep: Record<string, string | undefined> = {
    discovery: `/clients-v2/${clientId}/analyse/discovery`,
    engagement: `/clients-v2/${clientId}`,
    intake: intake
      ? `/clients-v2/${clientId}/intake-view`
      : `/clients-v2/${clientId}/analyse/intake`,
    plan: publishedSlug
      ? `/clients-v2/${clientId}/plan/edit/${publishedSlug}`
      : draftSlug
        ? `/clients-v2/${clientId}/plan/edit/${draftSlug}`
        : `/clients-v2/${clientId}/plan`,
    week: `/clients-v2/${clientId}/analyse/checkin`,
    next_phase: `/clients-v2/${clientId}/communicate`,
    plan_end: publishedSlug
      ? `/clients-v2/${clientId}/plan/edit/${publishedSlug}`
      : `/clients-v2/${clientId}/plan`,
  };
  for (const s of steps) {
    s.href = hrefByStep[s.id];
  }

  // ── nextStep: the single recommendation the coach should see at the
  //    top of the analyse page. Picks the FIRST step that's "active"
  //    (in progress / overdue) or, if everything's done so far, the
  //    first "pending" one. Stops the "hunting for what next" feeling.
  const candidate =
    steps.find((s) => s.status === "active") ??
    steps.find((s) => s.status === "pending");
  let nextStep: NextStep | null = null;
  if (candidate && candidate.href) {
    const reasonByStep: Record<string, string> = {
      discovery: "No discovery session on file yet — run the 15-minute fit call.",
      engagement: "Discovery captured. Mark whether the client is signing up.",
      intake: intake
        ? "Intake submitted — review the filled form."
        : "Client signed up. Run the 60-minute intake.",
      plan: draftSlug
        ? "Draft plan ready — activate it to make it live for the client."
        : "Build the protocol from the AI synthesis.",
      week: "Plan is live — log this week's check-in.",
      next_phase: "Phase letter due — generate and send.",
      plan_end: "Plan period complete — reassess and supersede.",
    };
    nextStep = {
      label: candidate.label,
      href: candidate.href,
      reason: reasonByStep[candidate.id] ?? "Continue from here.",
    };
  }

  return { steps, nextStep };
}
