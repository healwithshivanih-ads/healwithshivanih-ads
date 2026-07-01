/**
 * /dashboard-v2 — Phase 1 dashboard.
 *
 * Server-fetches client + plan + API spend + WhatsApp inbox + catalogue commit
 * data; renders inside <FmAppShell>. Triage sections are collapsible (client
 * component) with zero-count buckets showing a green badge + dashed empty
 * panel.
 *
 * All four engine surfaces from the legacy dashboard are preserved:
 *  - Catalogue commit banner (when files are uncommitted)
 *  - WhatsApp inbound message strip (last 7 days)
 *  - Upcoming follow-ups strip (next 7 days)
 *  - Broadcast panel (when WHATSAPP_SERVER_URL is set)
 */
import Link from "next/link";
import path from "node:path";
import fs from "node:fs/promises";
import { getPlansRoot } from "@/lib/fmdb/paths";
import { loadAllClients, loadAllPlans } from "@/lib/fmdb/loader";
import {
  loadClientSessions,
  getRecentInboundMessages,
  getRecentIntakeActivity,
  getStrandedIntakeDrafts,
  getClientHealthSignals,
} from "@/lib/fmdb/loader-extras";
import { parseRequestedLabs, parseSessionType, lastTemplateSentAt } from "@/lib/fmdb/session-utils";
import { readAppOpens } from "@/lib/fmdb/app-opens";
import { readAppInstalled } from "@/lib/fmdb/app-installed";
import { effectiveRecheckDate, isRecheckOverdue, hasPlanStarted, effectiveMealPlanStart } from "@/lib/fmdb/plan-timing";
import { getCohortMsqOutcomes } from "@/lib/fmdb/msq-cohort";
import { MsqCohortPanel } from "@/components/msq-cohort-panel";
import { computePracticeOverview } from "@/lib/fmdb/practice-overview";
import { getRosterComposition } from "@/lib/fmdb/roster-composition";
import { PracticeOverviewPanel } from "@/components/practice-overview-panel";
import { getCatalogueStatus } from "@/app/catalogue-commit-action";
import { BroadcastPanel } from "@/app/broadcast-panel";
import { BookSessionButton } from "@/components/client-widgets/book-session-modal";
import { WeeklyPollPanel } from "@/components/weekly-poll-panel";
// CatalogueIngestPanel moved to /ingest page 2026-05-15 — coach feedback:
// belongs next to the file-upload flow, not on the dashboard.
import { StartDateReminderPanel } from "@/components/start-date-reminder-panel";
import { ReviewNudgePanel } from "@/components/review-nudge-panel";
import { ClientAppLinksPanel } from "@/components/client-app-links-panel";
import { WeeklyMenuQueuePanel } from "@/components/weekly-menu-queue-panel";
import { CycleDateReminderPanel } from "@/components/cycle-date-reminder-panel";
import { DeferredPlanItemsPanel } from "@/components/deferred-plan-items-panel";
import {
  FmAlertGroup,
  FmAppShell,
  FmPageHeader,
  FmPanel,
  FmStatTile,
  FmStatGrid,
  FmChip,
  FmCatalogueCommitBanner,
  FmCatalogueOrphanChip,
  FmRecipeImageChip,
  FmInboundMessagesBanner,
  FmIntakeActivityBanner,
  FmStrandedIntakeBanner,
  FmScheduleDuePanel,
  FmUpcomingBookingsPanel,
  FmCancellationAlertBanner,
} from "@/components/fm";
import { TriageSections, type TriageRow, type SignalKind } from "./triage-sections";

export const dynamic = "force-dynamic";

interface ClientRow {
  client_id: string;
  display_name?: string;
  active_conditions?: string[];
  next_contact_date?: string;
  mobile_number?: string;
  email?: string;
  /** Lifecycle fields — drive the triage bucket a client lands in.
   *  engagement_status: "signed_up" | "declined" | "pending" (default). */
  engagement_status?: string;
  intake_submitted_at?: string | null;
  /** Rework markers — any of generated / applied / dismissed counts as a
   *  "review happened" signal for the plan_review_due cadence check. */
  rework_suggestion?: {
    generated_at?: string;
    applied_at?: string;
    dismissed_at?: string;
  } | null;
}

interface PlanRow {
  slug: string;
  client_id?: string;
  status?: string;
  _bucket?: string;
  plan_period_recheck_date?: string;
  plan_period_start?: string;
  plan_period_weeks?: number;
  // Coach-asserted actual start dates (delivery-to-adoption lag).
  // When unset, effectiveRecheckDate() falls back to plan_period_start
  // + 3 days for the meal plan. See lib/fmdb/plan-timing.ts.
  meal_plan_started_on?: string | null;
  supplements_started_on?: string | null;
  /** Bumped on every plan edit / quick-edit — anchors the review cadence. */
  updated_at?: string;
}

const PUBLISHED_BUCKET = new Set(["published"]);
const DRAFT_BUCKETS = new Set(["draft", "ready_to_publish"]);

/**
 * computeSignal — maps a client to exactly ONE triage bucket.
 *
 * The buckets mirror the client lifecycle:
 *   new lead → discovery → [sign-up decision] → intake → plan build →
 *   plan active → recheck
 *
 * Priority ladder (first match wins) — most urgent first:
 *   1. follow_up_due      — coach set an explicit contact date, it passed
 *   2. protocol_complete  — published plan past its recheck date
 *   3. active             — published plan still in-flight
 *   4. plan_to_build      — a draft/ready plan is open (mid-build)
 *   5. labs_pending       — labs requested 7d+ ago, no results back
 *   6. plan_to_build      — client signed up but has no plan yet
 *   7. declined           — discovery done, client declined the programme
 *   8. awaiting_signup    — discovery done, sign-up decision still pending
 *   9. returning          — last session 30d+ ago, no plan
 *  10. new_lead           — created, no discovery call yet
 */
async function computeSignal(
  client: ClientRow,
  clientPlans: PlanRow[],
  todayStr: string,
): Promise<TriageRow["signal"]> {
  // 1. Explicit follow-up date set by coach takes highest priority.
  if (client.next_contact_date && client.next_contact_date <= todayStr) {
    const daysOverdue = Math.round(
      (new Date(todayStr).getTime() - new Date(client.next_contact_date).getTime()) /
        (1000 * 60 * 60 * 24),
    );
    return { kind: "follow_up_due", daysOverdue };
  }

  // 2. Published plan past its EFFECTIVE recheck → protocol complete.
  const overduePlan = clientPlans.find((p) => {
    if ((p._bucket ?? p.status) !== "published") return false;
    return isRecheckOverdue(p, todayStr);
  });
  if (overduePlan) {
    return {
      kind: "protocol_complete",
      planSlug: overduePlan.slug,
      recheckDate: effectiveRecheckDate(overduePlan) ?? overduePlan.plan_period_recheck_date,
    };
  }

  // Load sessions once — needed both for the plan-review cadence check
  // below and the engagement-based signals further down.
  const sessions = await loadClientSessions(client.client_id);

  // 3. Published plan still in-flight. Two sub-states:
  //    - plan_review_due — ≥21 days since the last review touch (plan
  //      edit / quick-edit, check-in, or an applied rework). Coach
  //      decision 2026-05-20: a 3-week cadence so a plan doesn't sit
  //      frozen between data events ("stuck on the same supplements").
  //    - active — reviewed recently; steady, weekly glance.
  const publishedPlan = clientPlans.find((p) =>
    PUBLISHED_BUCKET.has(p._bucket ?? p.status ?? ""),
  );
  if (publishedPlan) {
    // Plan published but not begun yet (effective meal-plan start is in the
    // future) → its own calm "Starting soon" bucket, NOT active/needs-attention.
    // Coach ask 2026-07-01: not-started clients (e.g. Krittika) were cluttering
    // client status.
    if (!hasPlanStarted(publishedPlan, todayStr)) {
      return {
        kind: "awaiting_start",
        planSlug: publishedPlan.slug,
        startDate: effectiveMealPlanStart(publishedPlan) ?? undefined,
      };
    }
    const recheckDate =
      effectiveRecheckDate(publishedPlan) ?? publishedPlan.plan_period_recheck_date;

    // Phase-letter drip retired 2026-06-25 — client letters are no longer
    // sent; a published plan flows straight to the review-cadence check below.

    // "Last review" = most recent of: plan updated_at (edits + quick-edits
    // bump it), the latest check-in session, an applied rework — else the
    // plan start date as the anchor.
    const reviewDates: string[] = [];
    if (publishedPlan.updated_at) {
      reviewDates.push(publishedPlan.updated_at.slice(0, 10));
    }
    let lastCheckin = "";
    for (const s of sessions) {
      const pc = String((s as Record<string, unknown>).presenting_complaints ?? "");
      if (/\[session_type:\s*check_in\]/i.test(pc)) {
        const d = String((s as Record<string, unknown>).date ?? "");
        if (d > lastCheckin) lastCheckin = d;
      }
    }
    if (lastCheckin) reviewDates.push(lastCheckin);
    // Any rework engagement — generating, applying or dismissing one —
    // counts as a review. Generating resets the cadence immediately so
    // the "Run rework now" button clears the nudge on click.
    const rw = client.rework_suggestion;
    for (const d of [rw?.generated_at, rw?.applied_at, rw?.dismissed_at]) {
      if (d) reviewDates.push(d.slice(0, 10));
    }
    if (reviewDates.length === 0 && publishedPlan.plan_period_start) {
      reviewDates.push(publishedPlan.plan_period_start);
    }
    reviewDates.sort();
    const lastReview = reviewDates[reviewDates.length - 1];
    const daysSinceReview = lastReview
      ? Math.round(
          (new Date(todayStr).getTime() - new Date(lastReview).getTime()) /
            86_400_000,
        )
      : 0;
    const REVIEW_CADENCE_DAYS = 21;
    if (daysSinceReview >= REVIEW_CADENCE_DAYS) {
      // Read the last fm_checkin_nudge send time off the sessions so the
      // triage card's "Send check-in" button renders "✓ Sent X ago ·
      // Resend" (with confirm). Durable rule
      // feedback-send-buttons-persist-state. lastTemplateSentAt scans
      // for the [template: fm_checkin_nudge] [sent_at: ISO] tag that
      // recordOutboundMessageAction writes.
      const lastCheckinNudgeAt = lastTemplateSentAt(
        sessions as ReadonlyArray<{ presenting_complaints?: string }>,
        "fm_checkin_nudge",
      );
      return {
        kind: "plan_review_due",
        planSlug: publishedPlan.slug,
        recheckDate,
        daysSinceReview,
        lastCheckinNudgeAt,
      };
    }
    return { kind: "active", planSlug: publishedPlan.slug, recheckDate };
  }

  // A draft / ready-to-publish plan may be open — resolve it now but
  // DON'T classify on it yet. Per coach decision (2026-05-20) intake
  // gates everything: a draft without a completed coach intake means the
  // intake still needs doing, so the draft alone cannot promote a client
  // to a plan bucket. Acted on after the intake check below.
  const draftPlan = clientPlans.find((p) =>
    DRAFT_BUCKETS.has(p._bucket ?? p.status ?? ""),
  );

  // ── Engagement-based signals (sessions loaded above) ─────────────────
  const presentingOf = (s: unknown) =>
    String((s as Record<string, unknown>).presenting_complaints ?? "");
  const sessionType = (s: unknown) => parseSessionType(presentingOf(s));

  const discoverySessions = sessions
    .filter((s) => sessionType(s) === "discovery")
    .sort((a, b) =>
      String((a as Record<string, unknown>).date ?? "").localeCompare(
        String((b as Record<string, unknown>).date ?? ""),
      ),
    );
  const hasDiscovery = discoverySessions.length > 0;
  const discoveryDate =
    (discoverySessions[0] as Record<string, unknown> | undefined)?.date as
      | string
      | undefined;

  // "Intake done" = a COACH intake session exists — a session whose
  // presenting_complaints carries the LITERAL [session_type: intake] (or
  // legacy [session_type: full_assessment]) tag. That is exactly what the
  // v2 /analyse/intake flow writes. It deliberately does NOT count:
  //   - the client's online questionnaire ([source: client_intake_form],
  //     which has NO session_type tag), nor
  //   - untagged legacy assessment notes — parseSessionType DEFAULTS
  //     untagged sessions to "intake", which previously produced false
  //     "intake done" positives (e.g. Archana's leukopenia note).
  const hasCoachIntake = sessions.some((s) => {
    // 1. The explicit tag (what the /analyse flow now writes).
    if (/\[session_type:\s*(intake|full_assessment)\]/i.test(presentingOf(s))) return true;
    const so = s as unknown as Record<string, unknown>;
    // 2. The structured session_type field, when set.
    const st = String(so.session_type ?? "").toLowerCase();
    if (st === "intake" || st === "full_assessment") return true;
    // 3. A completed AI synthesis IS a coach intake even if the session was
    //    never tagged — assess.py historically persisted ai_analysis with no
    //    [session_type] tag, leaving fully-assessed clients (e.g. cl-013)
    //    stuck in "intake to do". Source is now fixed; this covers existing
    //    sessions retroactively without a data migration.
    const ai = so.ai_analysis as Record<string, unknown> | undefined;
    const drivers = ai?.likely_drivers;
    if (Array.isArray(drivers) && drivers.length > 0) return true;
    return false;
  });

  const engagement =
    client.engagement_status === "signed_up"
      ? "signed_up"
      : client.engagement_status === "declined"
        ? "declined"
        : "pending";

  // Truly brand-new — created but no contact recorded at all.
  if (sessions.length === 0 && !hasDiscovery) {
    return { kind: "new_lead" };
  }

  // 4. INTAKE GATE. A client who is committed (signed up OR already has a
  //    draft plan started) but has NO coach intake session on file lands
  //    in "Intake to do". Intake gates every plan bucket — even a draft
  //    plan cannot move a client to "programme owed" until the coach has
  //    actually run the intake. (Coach decision 2026-05-20.)
  const committed = engagement === "signed_up" || Boolean(draftPlan);
  if (committed && !hasCoachIntake) {
    let microStep: string;
    if (draftPlan && engagement !== "signed_up") {
      microStep =
        "A draft plan exists but no intake is on record — run the intake first";
    } else if (client.intake_submitted_at) {
      microStep =
        "Signed up · client submitted the intake form — run the intake session";
    } else {
      microStep = "Signed up — run the 60-minute intake session";
    }
    return { kind: "intake_to_do", microStep, draftSlug: draftPlan?.slug };
  }

  // 5. Coach intake done, no published plan.
  //    BEFORE saying "build the plan", check if labs were requested at
  //    discovery but never received. Coach feedback 2026-05-24: Pranati +
  //    Kshitija had their labs requested at discovery + intake-assessment
  //    done from chat-ingest, but labs never came back — they were
  //    showing as "programme owed" when really they're blocked on labs.
  //    Labs-pending takes precedence over plan_to_build when present.
  //
  //    NO grace period in this branch — once intake is done, the coach
  //    is genuinely waiting for labs to build the protocol regardless of
  //    how recently they were requested. The grace at step 6 below is
  //    for the pre-intake "labs chase" case (where 7-day grace prevents
  //    the dashboard nagging the same week of request).
  if (hasCoachIntake) {
    const clientAny2 = client as unknown as Record<string, unknown>;
    const latestResultDate2 = (() => {
      let best = "";
      const log = (clientAny2.measurements_log as Array<Record<string, unknown>>) ?? [];
      for (const e of log) {
        const d = e.date as string | undefined;
        if (d && d > best) best = d;
      }
      const snaps = (clientAny2.health_snapshots as Array<Record<string, unknown>>) ?? [];
      for (const e of snaps) {
        const d = e.date as string | undefined;
        if (d && d > best) best = d;
      }
      const markersUpdatedAt = (clientAny2.lab_markers_updated_at as string | undefined);
      if (markersUpdatedAt && markersUpdatedAt.slice(0, 10) > best) {
        best = markersUpdatedAt.slice(0, 10);
      }
      return best;
    })();
    for (const s of sessions) {
      const labs = parseRequestedLabs(s.coach_notes as string | undefined);
      if (labs.length === 0) continue;
      const requestDate = (s.date as string | undefined) ?? "";
      if (!requestDate) continue;
      // Results already back? Skip (look only at lab_markers / snapshots
      // dated on or after the request — older lab data doesn't count as
      // the response to a fresh request).
      if (latestResultDate2 && latestResultDate2 >= requestDate) continue;
      return { kind: "labs_pending", labs, labCount: labs.length };
    }
    if (draftPlan) {
      return {
        kind: "plan_to_build",
        draftSlug: draftPlan.slug,
        microStep:
          (draftPlan._bucket ?? draftPlan.status) === "ready_to_publish"
            ? "Plan is ready — activate it to make it live"
            : "Finish the draft plan + activate it",
      };
    }
    return {
      kind: "plan_to_build",
      microStep: "Intake complete — build the protocol from the AI synthesis",
    };
  }

  // 6. Labs requested but not yet uploaded.
  // Fires ONLY when:
  //   - a session has a [requested labs: …] tag in coach_notes
  //   - that session is at least LABS_GRACE_DAYS old (default 7) so we
  //     don't flag the coach the same hour she sends the requisition
  //   - the client has no lab_markers / health_snapshots dated after
  //     the request (= no results have come back yet)
  const LABS_GRACE_DAYS = 7;
  const todayMs = new Date(todayStr).getTime();
  const clientAny = client as unknown as Record<string, unknown>;
  // Latest "I have results" signal — pick the newest date across
  // measurements_log + health_snapshots + lab_markers updated_at.
  const latestResultDate = (() => {
    let best = "";
    const log = (clientAny.measurements_log as Array<Record<string, unknown>>) ?? [];
    for (const e of log) {
      const d = e.date as string | undefined;
      if (d && d > best) best = d;
    }
    const snaps = (clientAny.health_snapshots as Array<Record<string, unknown>>) ?? [];
    for (const e of snaps) {
      const d = e.date as string | undefined;
      if (d && d > best) best = d;
    }
    const markersUpdatedAt = (clientAny.lab_markers_updated_at as string | undefined);
    if (markersUpdatedAt && markersUpdatedAt.slice(0, 10) > best) {
      best = markersUpdatedAt.slice(0, 10);
    }
    return best;
  })();
  for (const s of sessions) {
    const labs = parseRequestedLabs(s.coach_notes as string | undefined);
    if (labs.length === 0) continue;
    const requestDate = (s.date as string | undefined) ?? "";
    if (!requestDate) continue;
    // Grace period — wait LABS_GRACE_DAYS before nagging.
    const daysSinceRequest = Math.round(
      (todayMs - new Date(requestDate).getTime()) / 86_400_000,
    );
    if (daysSinceRequest < LABS_GRACE_DAYS) continue;
    // Results already back? Skip.
    if (latestResultDate && latestResultDate >= requestDate) continue;
    return {
      kind: "labs_pending",
      labs,
      labCount: labs.length,
    };
  }

  // 7. Declined the programme after discovery.
  if (engagement === "declined") {
    return { kind: "declined", discoveryDate };
  }

  // 8. Discovery done, sign-up decision still pending → prospect to
  //    convert. This is where a client like Pranati belongs — she had a
  //    discovery call but hasn't committed to the programme, so she is
  //    NOT "awaiting assessment" (that wrongly implied she's signed up).
  if (hasDiscovery) {
    return { kind: "awaiting_signup", discoveryDate };
  }

  // 9. Returning — last session 30d+ ago, no plan, no discovery on file.
  const lastSession = sessions[sessions.length - 1] as Record<string, unknown>;
  const lastDate = (lastSession?.date as string) ?? "";
  if (lastDate) {
    const days = Math.round(
      (new Date(todayStr).getTime() - new Date(lastDate).getTime()) / (1000 * 60 * 60 * 24),
    );
    if (days >= 30) return { kind: "returning", daysSince: days, sessionDate: lastDate };
  }

  // 10. Fallback — a lead with some activity but no discovery yet.
  return { kind: "new_lead" };
}

export default async function DashboardV2() {
  const todayStr = new Date().toISOString().slice(0, 10);
  // apiMtd no longer rendered on the dashboard (tile demoted 2026-05-19)
  // but kept in the parallel-load batch — small + cached, and the data
  // is referenced by /settings via a separate loader so removing it
  // here has no UX impact. If the /settings page later inlines its own
  // loader, this can be dropped.
  // apiMtd was fetched here historically; moved to /settings 2026-05-19
  // where the spend counter now lives. The dashboard no longer needs it.
  const [clients, plans, catalogueStatus] = await Promise.all([
    loadAllClients(),
    loadAllPlans(),
    getCatalogueStatus(),
  ]);

  // WhatsApp inbound (last 7 days)
  const clientNameMap = new Map(
    (clients as ClientRow[]).map((c) => [c.client_id, c.display_name ?? c.client_id]),
  );
  const inboundMessages = await getRecentInboundMessages(
    (clients as ClientRow[]).map((c) => c.client_id),
    clientNameMap,
    7,
  );

  // Per-client plan lookup — needed both for triage signals AND for the
  // intake-activity banner (so we can drop "Nidhi submitted" chips once
  // a plan has been generated from her intake).
  const plansByClient = new Map<string, PlanRow[]>();
  for (const p of plans) {
    const cid = (p as Record<string, unknown>).client_id as string | undefined;
    if (!cid) continue;
    if (!plansByClient.has(cid)) plansByClient.set(cid, []);
    plansByClient.get(cid)!.push(p as unknown as PlanRow);
  }

  // Latest plan-update timestamp per client (any status). When this is
  // newer than a client's intake_submitted_at, the coach has clearly
  // actioned the intake — the banner drops them.
  const latestPlanUpdateByClient = new Map<string, string>();
  for (const [cid, rows] of plansByClient.entries()) {
    let latest = "";
    for (const r of rows) {
      const ts = (r as unknown as Record<string, unknown>).updated_at;
      if (typeof ts === "string" && ts > latest) latest = ts;
    }
    if (latest) latestPlanUpdateByClient.set(cid, latest);
  }

  // Intake-form activity (submitted in last 7d / started or opened in last 24h).
  // Reads off client.yaml fields — no extra fs walks. Sits next to the
  // WhatsApp inbound banner so coach has a single "what's new" strip
  // at the top of the dashboard.
  const intakeActivity = await getRecentIntakeActivity(
    clients as Array<Record<string, unknown>>,
    7,
    latestPlanUpdateByClient,
  );

  // Stranded intake drafts — substantial answers sitting in
  // intake_form_draft, never promoted to a real submit. (Pranati cl-009
  // hit this 2026-05-23, 63 fields lost in plain sight.) Banner appears
  // only when ≥1 client has ≥5 filled fields un-promoted.
  const strandedIntakeDrafts = await getStrandedIntakeDrafts(
    clients as Array<Record<string, unknown>>,
    5,
  );

  // 🔔 Proactive client-health detectors (2026-05-19): dormant clients
  // (no sessions in 14d), plateaued (3+ measurements within ±0.3kg),
  // regressed (≥1kg above starting weight). Each surfaces as a banner
  // strip above the triage cards. Cheap — fs.readdir per client +
  // existing client.yaml reads.
  // 2026-05-20 — collapsed 3 separate scans (each reading client.yaml
  // independently for 50+ clients) into one batched walk. Same return
  // shape, ~30% faster dashboard render.
  const allClientIds = (clients as ClientRow[]).map((c) => c.client_id);
  const {
    dormant: dormantClients,
    plateaued: plateauedClients,
    regressed: regressedClients,
  } = await getClientHealthSignals(allClientIds, {
    dormantDays: 14,
    plateauThresholdKg: 0.3,
    plateauMinReadings: 3,
    regressedThresholdKg: 1.0,
  });

  // 📊 Cohort MSQ outcomes (Phase 1 MIS) — practice-level symptom rollup
  // from the Progress-tab Medical Symptom Questionnaire. Pure read of
  // msq_response across clients; baseline-only until the first 21-day
  // retakes land, then flips to per-system trajectory automatically.
  const msqOutcomes = await getCohortMsqOutcomes(allClientIds);

  // "Time to schedule next session" rows — clients ≥12d since last
  // session OR with plan_period_recheck_date overdue. Each row carries
  // its own auto-picked event type so the bulk-send button respects
  // per-client journey state (active programme → Coaching, intake
  // pending → Programme Intake, prospect → Discovery).
  const { getSchedulingDueRows } = await import("@/lib/fmdb/scheduling-due");
  const scheduleDueRows = await getSchedulingDueRows(
    clients as Array<Record<string, unknown> & { client_id: string }>,
    plans as Array<Record<string, unknown>>,
    todayStr,
  );

  // Per-client unread-activity counts (drives the numbered chips on every
  // client surface). Reuses the scheduling-due set so the alerts bucket
  // is consistent with what's already shown on the dashboard.
  const { getClientUnreadCounts } = await import("@/lib/fmdb/loader-extras");
  const alertSet = new Set(scheduleDueRows.map((r) => r.client_id));
  // Per-alert triggered_at — newest of (last_session_date + 12d) and
  // plan_period_recheck_date for each due client. Lets the Plan tab
  // clear the chip surgically (only when seen-at >= triggered-at)
  // instead of the today-midnight 1-day-granularity proxy.
  const alertTriggeredAt = new Map<string, string>();
  for (const r of scheduleDueRows) {
    const candidates: string[] = [];
    if (r.last_session_date) {
      const t = new Date(r.last_session_date + "T00:00:00Z");
      t.setUTCDate(t.getUTCDate() + 12);
      candidates.push(t.toISOString());
    }
    if (r.plan_period_recheck_date) {
      candidates.push(new Date(r.plan_period_recheck_date + "T00:00:00Z").toISOString());
    }
    if (candidates.length > 0) {
      candidates.sort();
      alertTriggeredAt.set(r.client_id, candidates[candidates.length - 1]);
    }
  }
  const unreadMap = await getClientUnreadCounts(
    clients as Array<Record<string, unknown>>,
    { alertClientIds: alertSet, alertTriggeredAt },
  );
  const unreadByClient: Record<string, import("@/lib/fmdb/loader-extras").ClientUnreadCounts> = {};
  unreadMap.forEach((v, k) => {
    if (v.total > 0) unreadByClient[k] = v;
  });

  // Upcoming cal.com bookings — current state per uid, soonest first.
  // webhookConfigured is a heuristic for the empty-state copy: if the
  // file exists at all, the webhook has run at least once and "no
  // bookings" means "nothing scheduled", not "setup missing".
  const { loadUpcomingBookings, loadRecentCancellations } = await import("@/lib/fmdb/loader-extras");
  const clientNames = new Map<string, string>();
  for (const c of clients as Array<Record<string, unknown>>) {
    const cid = c.client_id as string | undefined;
    if (cid) clientNames.set(cid, (c.display_name as string | undefined) ?? cid);
  }
  const upcomingBookings = await loadUpcomingBookings(clientNames);
  const recentCancellations = await loadRecentCancellations(clientNames);
  let bookingsWebhookConfigured = false;
  try {
    const { getPlansRoot } = await import("@/lib/fmdb/paths");
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    await fs.access(path.join(getPlansRoot(), "_calcom_bookings.yaml"));
    bookingsWebhookConfigured = true;
  } catch { /* file missing → false */ }

  // ⏳ Deferred / revisit-later plan items (e.g. seed cycling held back behind a
  // lab gate). Server-rendered so it lands in the visible "Actions today" tier
  // and counts toward the header pill — these are clinical decisions, not nudges.
  const { listDeferredItemsAction } = await import("@/lib/server-actions/deferred-items");
  const deferredRes = await listDeferredItemsAction();
  const deferredItems = deferredRes.ok ? deferredRes.rows : [];

  // Compute signals
  const rows: TriageRow[] = await Promise.all(
    (clients as ClientRow[]).map(async (c) => ({
      client_id: c.client_id,
      display_name: c.display_name,
      active_conditions: c.active_conditions,
      signal: await computeSignal(c, plansByClient.get(c.client_id) ?? [], todayStr),
    })),
  );

  // Group by section
  const grouped = {
    follow_up_due: [],
    protocol_complete: [],
    intake_to_do: [],
    plan_to_build: [],
    labs_pending: [],
    booking_link_pending: [],
    awaiting_signup: [],
    phase_letter_due: [],
    plan_review_due: [],
    active: [],
    awaiting_start: [],
    returning: [],
    new_lead: [],
    declined: [],
  } as Record<SignalKind, TriageRow[]>;
  for (const r of rows) grouped[r.signal.kind].push(r);

  // ── Booking-link-pending overlay ─────────────────────────────────────
  // Reads ~/fm-plans/_calcom_send_log.yaml: clients who got a cal.com
  // booking link via WhatsApp ≥2 days ago AND have NO booking received
  // since the link was sent. Surfaces as its own section (📨 Booking
  // link sent — no response) so the coach knows to nudge.
  //
  // Coach bug 2026-05-20: Sudarshan was sent a booking link 3 days ago
  // and the dashboard didn't surface him as needing attention.
  try {
    const { default: yaml } = await import("js-yaml");
    const { default: fs } = await import("node:fs/promises");
    const { default: pathMod } = await import("node:path");
    const { getPlansRoot } = await import("@/lib/fmdb/paths");
    const root = getPlansRoot();
    type SendLogEntry = {
      sent_at?: string;
      client_id?: string;
      display_name?: string;
      slug?: string;
    };
    type BookingEntry = {
      type?: string;
      received_at?: string;
      start_time?: string;
    };
    let sendLog: SendLogEntry[] = [];
    try {
      const raw = await fs.readFile(
        pathMod.join(root, "_calcom_send_log.yaml"),
        "utf-8",
      );
      const parsed = yaml.load(raw);
      if (Array.isArray(parsed)) sendLog = parsed as SendLogEntry[];
    } catch {
      /* file may not exist on a fresh setup */
    }
    let bookings: Record<string, BookingEntry[]> = {};
    try {
      const raw = await fs.readFile(
        pathMod.join(root, "_calcom_bookings.yaml"),
        "utf-8",
      );
      const parsed = yaml.load(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        bookings = parsed as Record<string, BookingEntry[]>;
      }
    } catch {
      /* no bookings yet */
    }

    // Pick the LATEST send per client (clients can have multiple sends
    // if coach retried). Then check whether any non-cancelled booking
    // arrived AFTER that send.
    const latestSendByClient = new Map<string, SendLogEntry>();
    for (const entry of sendLog) {
      if (!entry.client_id || !entry.sent_at) continue;
      const existing = latestSendByClient.get(entry.client_id);
      if (!existing || (entry.sent_at > (existing.sent_at ?? ""))) {
        latestSendByClient.set(entry.client_id, entry);
      }
    }

    const BOOKING_LINK_GRACE_DAYS = 2;
    const todayMs = new Date(todayStr).getTime();
    for (const [clientId, entry] of latestSendByClient) {
      const sentAt = entry.sent_at ?? "";
      const daysSinceSent = Math.round(
        (todayMs - new Date(sentAt).getTime()) / 86_400_000,
      );
      if (daysSinceSent < BOOKING_LINK_GRACE_DAYS) continue;
      const clientBookings = bookings[clientId] ?? [];
      // Did ANY booking_created event arrive after the send? Cancellations
      // don't count (coach still needs to nudge).
      const respondedAfter = clientBookings.some(
        (b) =>
          (b.received_at ?? "") > sentAt &&
          (b.type ?? "") !== "booking_cancelled",
      );
      if (respondedAfter) continue;
      // Don't double-surface clients already in higher-priority buckets.
      const alreadySurfaced =
        grouped.follow_up_due.some((r) => r.client_id === clientId) ||
        grouped.protocol_complete.some((r) => r.client_id === clientId) ||
        grouped.intake_to_do.some((r) => r.client_id === clientId) ||
        grouped.plan_to_build.some((r) => r.client_id === clientId) ||
        grouped.active.some((r) => r.client_id === clientId) ||
        grouped.labs_pending.some((r) => r.client_id === clientId);
      if (alreadySurfaced) continue;
      const clientRecord = (clients as ClientRow[]).find(
        (c) => c.client_id === clientId,
      );
      if (!clientRecord) continue;
      grouped.booking_link_pending.push({
        client_id: clientId,
        display_name: clientRecord.display_name ?? clientId,
        active_conditions: undefined,
        signal: {
          kind: "booking_link_pending",
          daysSinceLinkSent: daysSinceSent,
          bookingLinkSlug: entry.slug,
        },
      });
    }
    grouped.booking_link_pending.sort(
      (a, b) =>
        (b.signal.daysSinceLinkSent ?? 0) - (a.signal.daysSinceLinkSent ?? 0),
    );
  } catch {
    /* booking-link overlay is best-effort; never block the dashboard */
  }

  const totalClients = clients.length;
  const monthLabel = new Date().toLocaleDateString("en-GB", { month: "short" });
  // "Needs attention" = everything in the 🔴 Needs action + 🟡 Pipeline
  // tiers (active / returning / new_lead / declined are steady or cold,
  // not attention-now). Mirrors the tier split in triage-sections.tsx.
  // awaiting_signup intentionally excluded — "still deciding" prospects are
  // in the marketing pipeline, not action items the coach needs to fix today.
  const needsAttention =
    grouped.follow_up_due.length +
    grouped.protocol_complete.length +
    grouped.intake_to_do.length +
    grouped.plan_to_build.length +
    grouped.labs_pending.length +
    grouped.booking_link_pending.length;

  // 📊 Practice overview model (MIS Phase 3) — composes the client-status
  // band, pipeline and composition from signals already computed above
  // (lifecycle buckets + dormant/plateau/regression sets + published plans).
  // Pure re-shape; no extra I/O.
  const bucketOf = new Map<string, string>();
  for (const [kind, arr] of Object.entries(grouped)) {
    for (const r of arr) bucketOf.set(r.client_id, kind);
  }
  const publishedPlanIds = new Set<string>();
  const graduatedPlanIds = new Set<string>();
  for (const [cid, pl] of plansByClient) {
    if (pl.some((p) => p.status === "published" || p._bucket === "published")) publishedPlanIds.add(cid);
    if (pl.some((p) => p.status === "graduated" || p._bucket === "graduated")) graduatedPlanIds.add(cid);
  }
  const overview = computePracticeOverview({
    clients: clients as ClientRow[],
    bucketOf,
    publishedPlanIds,
    graduatedIds: graduatedPlanIds,
    dormantIds: new Set(dormantClients.map((d) => d.client_id)),
    plateauedIds: new Set(plateauedClients.map((d) => d.client_id)),
    regressedIds: new Set(regressedClients.map((d) => d.client_id)),
  });
  // Composition extras (symptoms + root causes) — a roster-wide session scan,
  // ported from the Phase 3 work onto the merged Practice overview.
  const rosterComposition = await getRosterComposition(clients as Array<{ client_id: string }>);

  // When there's exactly ONE attention item, the dashboard tile should
  // link DIRECTLY to the relevant tab on that client (not scroll to the
  // triage list). Coach feedback 2026-05-19: "I should be able to click
  // and get to the real issue, not try to go everywhere and figure out
  // what does." Bucket → tab map mirrors triage-sections.tsx SECTION_META:
  //   follow_up_due    → /clients-v2/<id>            (Overview — needs contact)
  //   protocol_complete → /clients-v2/<id>/sessions  (Record recheck session)
  //   labs_pending     → /clients-v2/<id>/sessions   (Record lab results)
  //   returning        → /clients-v2/<id>/sessions   (Record new session)
  let singleAttentionHref: string | undefined;
  let singleAttentionWhy: string | undefined;
  if (needsAttention === 1) {
    const findOne = () => {
      if (grouped.follow_up_due[0])
        return {
          href: `/clients-v2/${grouped.follow_up_due[0].client_id}`,
          why: `Follow-up due with ${grouped.follow_up_due[0].display_name ?? grouped.follow_up_due[0].client_id}`,
        };
      if (grouped.protocol_complete[0])
        return {
          href: `/clients-v2/${grouped.protocol_complete[0].client_id}/sessions`,
          why: `Recheck due for ${grouped.protocol_complete[0].display_name ?? grouped.protocol_complete[0].client_id}`,
        };
      if (grouped.intake_to_do[0]) {
        const r = grouped.intake_to_do[0];
        return {
          href: `/clients-v2/${r.client_id}/analyse/intake`,
          why: `Intake to do for ${r.display_name ?? r.client_id} — ${r.signal.microStep ?? "run the intake"}`,
        };
      }
      if (grouped.plan_to_build[0]) {
        const r = grouped.plan_to_build[0];
        return {
          href: r.signal.draftSlug
            ? `/clients-v2/${r.client_id}/plan/edit/${r.signal.draftSlug}`
            : `/clients-v2/${r.client_id}/analyse`,
          why: `Programme owed to ${r.display_name ?? r.client_id} — ${r.signal.microStep ?? "build the plan"}`,
        };
      }
      if (grouped.labs_pending[0]) {
        const r = grouped.labs_pending[0];
        // Show a COUNT, not the full list. Old code embedded all 45
        // marker names into the stat-tile delta which blew out the
        // page-header grid column to ~1100px. The full list is one
        // click away on the client's sessions tab.
        const count = r.signal.labs?.length ?? 0;
        const labs = count > 0 ? ` (${count} marker${count === 1 ? "" : "s"})` : "";
        return {
          href: `/clients-v2/${r.client_id}/sessions`,
          why: `Labs pending for ${r.display_name ?? r.client_id}${labs}`,
        };
      }
      if (grouped.booking_link_pending[0]) {
        const r = grouped.booking_link_pending[0];
        const days = r.signal.daysSinceLinkSent ?? 0;
        return {
          href: `/clients-v2/${r.client_id}/communicate`,
          why: `Booking link sent ${days}d ago — no response from ${r.display_name ?? r.client_id}`,
        };
      }
      if (grouped.awaiting_signup[0]) {
        const r = grouped.awaiting_signup[0];
        return {
          href: `/clients-v2/${r.client_id}`,
          why: `${r.display_name ?? r.client_id} had a discovery call — confirm if they're signing up`,
        };
      }
      if (grouped.returning[0])
        return {
          href: `/clients-v2/${grouped.returning[0].client_id}/sessions`,
          why: `${grouped.returning[0].display_name ?? grouped.returning[0].client_id} returned after ${grouped.returning[0].signal.daysSince} days`,
        };
      return null;
    };
    const one = findOne();
    if (one) {
      singleAttentionHref = one.href;
      singleAttentionWhy = one.why;
    }
  }

  // Upcoming follow-ups (next 7 days)
  const in7 = new Date(todayStr);
  in7.setDate(in7.getDate() + 7);
  const in7Str = in7.toISOString().slice(0, 10);
  const upcoming = (clients as ClientRow[])
    .filter(
      (c) =>
        c.next_contact_date &&
        c.next_contact_date > todayStr &&
        c.next_contact_date <= in7Str,
    )
    .sort((a, b) => (a.next_contact_date ?? "").localeCompare(b.next_contact_date ?? ""));

  // Outbound WhatsApp flows via the self-hosted whatsapp-server-shivani
  // Fly app. The broadcast / weekly-poll / start-date-reminder UIs surface
  // as "configured" when WHATSAPP_SERVER_URL is set in .env.local.
  // AiSensy fully decommissioned 2026-05-15.
  const whatsappConfigured = !!process.env.WHATSAPP_SERVER_URL;
  const broadcastClientRows = (clients as ClientRow[]).map((c) => ({
    client_id: c.client_id,
    display_name: c.display_name,
    mobile_number: c.mobile_number,
    email: c.email,
    next_contact_date: c.next_contact_date,
  }));
  const followUpDueIds = grouped.follow_up_due.map((r) => r.client_id);
  const recheckDueIds = grouped.protocol_complete.map((r) => r.client_id);
  // 📲 Client-app links — one row per published plan. The token is the
  // plan's letter_token (issued lazily in-panel when missing). Adoption
  // columns (rollout 2026-06-12): invite-sent from the outbound record's
  // [template: fm_app_invite_v1] tag, last-opened from _app_opens.yaml
  // (Fly-logged, cron-mirrored), engaged from app-written sessions.
  const appLinkRows = (
    await Promise.all(
      (plans as PlanRow[])
        .filter((p) => (p._bucket ?? p.status) === "published" && p.client_id && p.slug)
        .map(async (p) => {
          const c = (clients as ClientRow[]).find((x) => x.client_id === p.client_id);
          const clientId = p.client_id as string;
          const sess = await loadClientSessions(clientId);
          const opens = await readAppOpens(clientId);
          const install = await readAppInstalled(clientId);
          const groceryReady = await fs
            .access(path.join(getPlansRoot(), "clients", clientId, "meal-plans", `${p.slug}-grocery.yaml`))
            .then(() => true)
            .catch(() => false);
          return {
            client_id: clientId,
            display_name: c?.display_name ?? clientId,
            mobile_number: c?.mobile_number ?? null,
            plan_slug: p.slug as string,
            token:
              ((p as unknown as { letter_token?: string }).letter_token?.length ?? 0) >= 16
                ? ((p as unknown as { letter_token?: string }).letter_token as string)
                : null,
            inviteSentAt: lastTemplateSentAt(sess, "fm_app_invite_v1"),
            lastOpenedAt: opens.lastOpenedAt,
            openCount: opens.count,
            installed: install.installed,
            engaged: sess.some((s) =>
              (s.presenting_complaints ?? "").includes("[source: client_app"),
            ),
            groceryReady,
          };
        }),
    )
  ).sort((a, b) => a.display_name.localeCompare(b.display_name));
  const activeIds = [
    ...grouped.active.map((r) => r.client_id),
    ...grouped.protocol_complete.map((r) => r.client_id),
  ];
  // Weekly poll eligibility — same gating rule the send action uses
  // server-side: must have a published plan AND a mobile number on file.
  // Surface those clients pre-checked so coach sees who'd receive the
  // poll and can untick anyone they don't want to include this round.
  const activeIdSet = new Set(activeIds);
  const pollClients = (clients as ClientRow[])
    .filter(
      (c) =>
        activeIdSet.has(c.client_id) &&
        typeof c.mobile_number === "string" &&
        c.mobile_number.trim().length > 0,
    )
    .map((c) => ({
      client_id: c.client_id,
      display_name: c.display_name,
      mobile_number: c.mobile_number,
    }));

  // Persisted-send state for WeeklyPollPanel (Fix 2026-05-24 — durable rule
  // "every send button shows ✓ Sent X ago · Resend on reload").
  // Read the canonical send-log file (~/fm-plans/_weekly_poll_log.yaml,
  // append-only, one row per campaign send) and reduce to the most-recent
  // sent_at per campaign name. WeeklyPollPanel uses this to flip each
  // variant tile from "Send" to "↻ Resend (last X ago)".
  const lastPollSentByCampaign: Record<string, string> = await (async () => {
    try {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const yaml = (await import("js-yaml")).default;
      const root = process.env.FMDB_PLANS_DIR ?? path.join(process.env.HOME ?? "", "fm-plans");
      const raw = await fs.readFile(path.join(root, "_weekly_poll_log.yaml"), "utf-8");
      const entries = yaml.load(raw) as Array<{ sent_at?: string; campaign?: string }> | null;
      if (!Array.isArray(entries)) return {};
      const out: Record<string, string> = {};
      for (const e of entries) {
        if (!e?.campaign || !e?.sent_at) continue;
        if (!out[e.campaign] || e.sent_at > out[e.campaign]) {
          out[e.campaign] = e.sent_at;
        }
      }
      return out;
    } catch {
      // file may not exist yet
      return {};
    }
  })();

  const dateLabel = new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <FmAppShell activeNavId="dashboard" crumbs={[{ label: "Dashboard" }]}>
      <FmPageHeader
        title="Dashboard"
        subtitle={`Welcome back, Shivani. ${dateLabel}.`}
        rightSlot={
          // API-spend tile removed from dashboard 2026-05-19 (audit
          // finding — useful to engineering, not actionable for coach).
          // Two essential tiles only: total clients + needs-attention
          // count. The MTD spend is still computed (apiMtd above) and
          // available in /settings for when coach wants to glance.
          // Cap the stat row at 420px so a long "Need attention" delta
          // string can NEVER blow out the page-header grid like it did
          // on 2026-05-20 (a 45-marker labs list ended up in the tile).
          <div
            style={{
              width: "100%",
              maxWidth: 420,
              display: "flex",
              flexDirection: "column",
              gap: 10,
              alignItems: "flex-end",
            }}
          >
          {/* 📅 Book a session — dashboard-level booking entry point.
              Restored 2026-05-20: a UI-audit pass removed the amber
              "Schedule a session" strip on the wrong assumption that the
              button lived elsewhere on the dashboard — it did not. This
              is the single dashboard-level book button the coach asked
              for. The picker's first step is a client-select. */}
          <BookSessionButton
            allClients={(clients as ClientRow[]).map((c) => ({
              client_id: c.client_id,
              display_name: c.display_name,
              email: c.email,
              mobile_number: c.mobile_number,
            }))}
            label="📅 Book a session"
            variant="header"
          />
          <FmStatGrid cols={2}>
            <FmStatTile label="Clients" value={totalClients} href="/clients-v2" />
            <FmStatTile
              label="Need attention"
              value={needsAttention}
              highlight={needsAttention > 0}
              href={
                needsAttention === 0
                  ? undefined
                  : singleAttentionHref ?? "#needs-attention"
              }
              title={
                needsAttention === 0
                  ? undefined
                  : singleAttentionWhy
                    ? `${singleAttentionWhy} — click to open`
                    : [
                        grouped.follow_up_due.length > 0 && `${grouped.follow_up_due.length} follow-up due`,
                        grouped.protocol_complete.length > 0 && `${grouped.protocol_complete.length} recheck due`,
                        grouped.intake_to_do.length > 0 && `${grouped.intake_to_do.length} intake session${grouped.intake_to_do.length === 1 ? "" : "s"} to do`,
                        grouped.plan_to_build.length > 0 && `${grouped.plan_to_build.length} programme${grouped.plan_to_build.length === 1 ? "" : "s"} owed`,
                        grouped.labs_pending.length > 0 && `${grouped.labs_pending.length} labs pending`,
                        grouped.booking_link_pending.length > 0 && `${grouped.booking_link_pending.length} booking link${grouped.booking_link_pending.length === 1 ? "" : "s"} unanswered`,
                      ]
                        .filter(Boolean)
                        .join(" · ") + " — click to jump"
              }
              delta={
                needsAttention === 0
                  ? undefined
                  : singleAttentionWhy
                    ? { trend: "warn", text: singleAttentionWhy }
                    : {
                        trend: "warn",
                        text: [
                          grouped.follow_up_due.length > 0 && `${grouped.follow_up_due.length} follow-up`,
                          grouped.protocol_complete.length > 0 && `${grouped.protocol_complete.length} recheck`,
                          grouped.intake_to_do.length > 0 && `${grouped.intake_to_do.length} intake`,
                          grouped.plan_to_build.length > 0 && `${grouped.plan_to_build.length} to build`,
                          grouped.labs_pending.length > 0 && `${grouped.labs_pending.length} labs`,
                          grouped.booking_link_pending.length > 0 && `${grouped.booking_link_pending.length} booking`,
                        ]
                          .filter(Boolean)
                          .join(" · "),
                      }
              }
            />
          </FmStatGrid>
          </div>
        }
      />

      {/* 🗓 Weekly menu approvals — pinned to the TOP so the coach can never
          miss a menu waiting for approval (clients stay frozen until she
          approves). Loud amber banner; self-hides when nothing is pending.
          Hoisted here 2026-06-30 from the bottom of the page. */}
      <WeeklyMenuQueuePanel names={Object.fromEntries(clientNameMap)} />

      {/* 📊 Practice overview (MIS) — the headline management layer: vitals,
          who's on track, what the practice is made of, pipeline, and the MSQ
          outcome rollup. Operational triage stays below in the alert groups. */}
      <div style={{ display: "grid", gap: 14, marginBottom: 24 }}>
        {/* auto-fit (not a hard 5 cols) so the strip wraps to 4/3/2 on
            narrower laptop widths instead of clipping the last tile. */}
        <FmStatGrid>
          <FmStatTile label="Active care" value={overview.activeCare} href="/clients-v2" />
          <FmStatTile label="On track" value={overview.onTrackPct !== null ? `${overview.onTrackPct}%` : "—"} />
          <FmStatTile
            label="Avg MSQ"
            value={msqOutcomes.avgLatestTotal ?? msqOutcomes.avgBaselineTotal ?? "—"}
            title="Cohort Medical Symptom Questionnaire · lower is better"
          />
          <FmStatTile
            label="Rechecks due"
            value={grouped.protocol_complete.length}
            highlight={grouped.protocol_complete.length > 0}
            href={grouped.protocol_complete.length > 0 ? "#needs-attention" : undefined}
          />
          <FmStatTile
            label="Watch + stalled"
            value={overview.watch + overview.stalled}
            highlight={overview.stalled > 0}
          />
        </FmStatGrid>
        <PracticeOverviewPanel data={overview} symptoms={rosterComposition.symptoms} drivers={rosterComposition.drivers} />
        <MsqCohortPanel data={msqOutcomes} />
      </div>

      {/* Banners + strips above the triage sections.
          The standalone amber "Schedule a session" strip was dropped
          2026-05-19; the BookSessionButton now lives in the page-header
          rightSlot above the stat tiles (restored 2026-05-20 after the
          strip removal accidentally left the dashboard with no booking
          entry point at all). */}
      {/* Banner stack restructured 2026-05-20 (UI audit theme #3 +
          investment #4). Previously 11 sibling banners rendered at uniform
          visual weight; after 3-4 they became wallpaper. Now bundled into
          two collapsible groups via FmAlertGroup:
            🚨 Actions today  — urgent, defaults OPEN
            📋 FYI + outbound — admin / outbound nudges, defaults COLLAPSED
          Each group persists its open/closed state in sessionStorage
          (per-tab) so coach's choices stick across refreshes. */}
      <div style={{ display: "grid", gap: 14, marginBottom: 24 }}>
        <FmAlertGroup
          id="dashboard.today"
          tier="today"
          icon="🚨"
          label="Actions today"
          count={
            recentCancellations.length +
            upcomingBookings.length +
            inboundMessages.length +
            scheduleDueRows.length +
            dormantClients.length +
            plateauedClients.length +
            regressedClients.length +
            upcoming.length +
            deferredItems.length
          }
          defaultCollapsed={false}
        >
          {/* Cancellation alert — surfaces above upcoming so coach can't miss
              a silent cancel. Auto-clears once she opens the client's overview. */}
          <FmCancellationAlertBanner cancellations={recentCancellations} />

          {/* Upcoming cal.com bookings — fed by /api/cal-com-webhook */}
          <FmUpcomingBookingsPanel rows={upcomingBookings} webhookConfigured={bookingsWebhookConfigured} />

          {/* WhatsApp inbound messages — design 10A with unread badges */}
          <FmScheduleDuePanel rows={scheduleDueRows} unread={unreadByClient} />
          {/* FmIntakeActivityBanner retired 2026-05-17 — its info now folds
              into the per-client unread badge on the schedule-due rows + the
              clients-v2 grid. */}
          {/* Stranded intake drafts — clients who filled the form but
              never tapped Submit. One-click Promote per row. Auto-hides
              when none. */}
          <FmStrandedIntakeBanner drafts={strandedIntakeDrafts} />

          <FmInboundMessagesBanner messages={inboundMessages} windowDays={7} inboxHref="/messages" />

          {/* 🔔 Proactive client-health banners (dormant / plateau /
            regression) — added 2026-05-19. These surface as compact
            colored strips ONLY when there's at least one match; each
            client is a clickable chip linking to their Overview. */}
        {(dormantClients.length > 0 || plateauedClients.length > 0 || regressedClients.length > 0) && (
          <FmPanel
            style={{
              background: "rgba(229, 62, 62, 0.04)",
              borderColor: "rgba(229, 62, 62, 0.20)",
              padding: "10px 14px",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div
                style={{
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: 0.7,
                  fontWeight: 700,
                  color: "#c0392b",
                }}
              >
                🔔 Needs your eyes
              </div>

              {dormantClients.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: "var(--fm-text-secondary)", marginRight: 4 }}>
                    💤 <strong>{dormantClients.length}</strong>{" "}
                    {dormantClients.length === 1 ? "client" : "clients"} silent for 14d+:
                  </span>
                  {dormantClients.slice(0, 8).map((d) => (
                    <Link
                      key={d.client_id}
                      href={`/clients-v2/${d.client_id}`}
                      style={{
                        fontSize: 11,
                        padding: "2px 8px",
                        background: "rgba(120, 113, 108, 0.10)",
                        border: "1px solid rgba(120, 113, 108, 0.30)",
                        borderRadius: 999,
                        textDecoration: "none",
                        color: "var(--fm-text-primary)",
                        fontWeight: 600,
                      }}
                      title={`Last signal: ${d.lastSignalAt ?? "no sessions on record"}`}
                    >
                      {d.display_name} · {d.daysSilent}d
                    </Link>
                  ))}
                  {dormantClients.length > 8 && (
                    <span style={{ fontSize: 11, color: "var(--fm-text-tertiary)" }}>
                      +{dormantClients.length - 8} more
                    </span>
                  )}
                </div>
              )}

              {plateauedClients.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: "var(--fm-text-secondary)", marginRight: 4 }}>
                    ⏸ <strong>{plateauedClients.length}</strong>{" "}
                    {plateauedClients.length === 1 ? "client" : "clients"} plateaued (3+ readings static):
                  </span>
                  {plateauedClients.slice(0, 8).map((p) => (
                    <Link
                      key={p.client_id}
                      href={`/clients-v2/${p.client_id}`}
                      style={{
                        fontSize: 11,
                        padding: "2px 8px",
                        background: "rgba(245, 158, 11, 0.10)",
                        border: "1px solid rgba(245, 158, 11, 0.30)",
                        borderRadius: 999,
                        textDecoration: "none",
                        color: "#92400e",
                        fontWeight: 600,
                      }}
                      title={`Latest ${p.latestWeightKg}kg on ${p.latestDate} · range ${p.rangeKg}kg across last ${p.consecutiveStaticReadings} readings`}
                    >
                      {p.display_name} · {p.latestWeightKg}kg
                    </Link>
                  ))}
                  {plateauedClients.length > 8 && (
                    <span style={{ fontSize: 11, color: "var(--fm-text-tertiary)" }}>
                      +{plateauedClients.length - 8} more
                    </span>
                  )}
                </div>
              )}

              {regressedClients.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: "var(--fm-text-secondary)", marginRight: 4 }}>
                    📈 <strong>{regressedClients.length}</strong>{" "}
                    {regressedClients.length === 1 ? "client" : "clients"} above starting weight:
                  </span>
                  {regressedClients.slice(0, 8).map((r) => (
                    <Link
                      key={r.client_id}
                      href={`/clients-v2/${r.client_id}`}
                      style={{
                        fontSize: 11,
                        padding: "2px 8px",
                        background: "rgba(229, 62, 62, 0.10)",
                        border: "1px solid rgba(229, 62, 62, 0.30)",
                        borderRadius: 999,
                        textDecoration: "none",
                        color: "#c0392b",
                        fontWeight: 700,
                      }}
                      title={`Started ${r.startingKg}kg → now ${r.latestKg}kg (${r.latestDate})`}
                    >
                      {r.display_name} · +{r.gainedKg}kg
                    </Link>
                  ))}
                  {regressedClients.length > 8 && (
                    <span style={{ fontSize: 11, color: "var(--fm-text-tertiary)" }}>
                      +{regressedClients.length - 8} more
                    </span>
                  )}
                </div>
              )}
            </div>
          </FmPanel>
        )}

          {/* Upcoming follow-ups (next 7 days, not yet due) */}
          {upcoming.length > 0 && (
            <FmPanel
              style={{
                background: "rgba(155, 89, 182, 0.06)",
                borderColor: "rgba(155, 89, 182, 0.25)",
                padding: "12px 16px",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div
                  style={{
                    fontSize: 11,
                    textTransform: "uppercase",
                    letterSpacing: 0.7,
                    fontWeight: 700,
                    color: "#7d3c98",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <span>📅</span>
                  <span>Upcoming this week ({upcoming.length})</span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {upcoming.map((c) => (
                    <Link
                      key={c.client_id}
                      href={`/clients-v2/${c.client_id}`}
                      style={{
                        display: "inline-flex",
                        gap: 6,
                        alignItems: "center",
                        padding: "4px 10px",
                        background: "var(--fm-surface)",
                        border: "1px solid rgba(155, 89, 182, 0.25)",
                        borderRadius: "var(--fm-radius-pill)",
                        textDecoration: "none",
                        fontSize: 12,
                      }}
                    >
                      <span style={{ color: "#7d3c98", fontWeight: 600 }}>
                        {c.display_name ?? c.client_id}
                      </span>
                      <span style={{ color: "var(--fm-text-tertiary)" }}>·</span>
                      <FmChip tone="primary">{c.next_contact_date}</FmChip>
                    </Link>
                  ))}
                </div>
              </div>
            </FmPanel>
          )}

          {/* ⏳ Deferred / revisit-later plan items — interventions the assess
              AI held back behind a clinical gate (e.g. seed cycling pending a
              day-21 progesterone result). A clinical decision, so it lives in
              the visible "Actions today" tier. Self-hides when empty. */}
          <DeferredPlanItemsPanel initialRows={deferredItems} />
        </FmAlertGroup>

        {/* ── FYI + outbound group ────────────────────────────────────
            Outbound nudges (broadcast / weekly poll / start-date reminders)
            + admin signals (catalogue commit). Defaults COLLAPSED — coach
            opens when she wants to send something proactive, not on every
            page load. Each child still self-hides when empty (so a coach
            with nothing pending sees the group header alone). */}
        <FmAlertGroup
          id="dashboard.fyi"
          tier="fyi"
          icon="📋"
          label="Outbound + admin"
          defaultCollapsed={true}
        >
          {/* Broadcast — outbound WhatsApp to groups of clients. */}
          {whatsappConfigured && (
            <BroadcastPanel
              clients={broadcastClientRows}
              followUpDueIds={followUpDueIds}
              recheckDueIds={recheckDueIds}
              activeIds={activeIds}
            />
          )}

          {/* 📣 Weekly check-in poll + 3-strike adherence-drop scan. */}
          {whatsappConfigured && (
            <WeeklyPollPanel
              whatsappConfigured={whatsappConfigured}
              pollClients={pollClients}
              lastSentByCampaign={lastPollSentByCampaign}
            />
          )}

          {/* 📅 Start-date reminders — clients whose plan published >5d ago
              but haven't confirmed meal_plan_started_on. */}
          {whatsappConfigured && (
            <StartDateReminderPanel whatsappConfigured={whatsappConfigured} />
          )}

          {/* 🌿 Plan end-game — clients at their recheck / maintenance renewal,
              with a one-tap nudge to review + decide what's next. Self-hides. */}
          <ReviewNudgePanel whatsappConfigured={whatsappConfigured} />

          {/* 📲 Client-app links — share the Ochre Tree companion app
              (/app/<letter_token>) per published plan. Copy works even
              without WhatsApp configured, so not gated. */}
          <ClientAppLinksPanel rows={appLinkRows} whatsappConfigured={whatsappConfigured} />


          {/* Meal-plan drip retired 2026-06-25 — client letters no longer sent. */}

          {/* WeeklyMenuQueuePanel moved to the TOP of the page 2026-06-30
              (was here, easy to miss). See the mount under FmPageHeader. */}

          <CycleDateReminderPanel whatsappConfigured={whatsappConfigured} />


          {/* Catalogue commit — design 9A with change list disclosure */}
          <FmCatalogueCommitBanner initialStatus={catalogueStatus} />

          {/* Catalogue ↔ assessment wiring guardrail — self-loading, hides
              when every entity is reachable. Surfaces orphans like the
              beta-glucuronidase gap before they strand silently. */}
          <FmCatalogueOrphanChip />

          {/* Recipe-image coverage guardrail — self-loading, hides when every
              recipe has a photo. Flags recipes that would show a plain tile in
              the client app so new images get sourced periodically. */}
          <FmRecipeImageChip />
        </FmAlertGroup>
      </div>

      {/* Triage sections — collapsible, zero-count gets faded green badge */}
      {totalClients === 0 ? (
        <FmPanel>
          <div
            style={{
              textAlign: "center",
              padding: "40px 16px",
              color: "var(--fm-text-secondary)",
            }}
          >
            <div style={{ fontSize: 32, marginBottom: 12 }}>👋</div>
            <h2
              style={{
                fontFamily: "var(--fm-font-display)",
                fontSize: 22,
                margin: "0 0 8px",
                color: "var(--fm-text-primary)",
              }}
            >
              Your practice begins here
            </h2>
            <p
              style={{
                fontSize: 13,
                margin: "0 auto 20px",
                maxWidth: 380,
                lineHeight: 1.55,
              }}
            >
              Add your first client to start. Every triage bucket, lab dashboard and
              protocol view fills in from real client data — nothing is faked.
            </p>
            <Link
              href="/clients-v2/new"
              style={{
                display: "inline-block",
                padding: "11px 22px",
                background: "var(--fm-primary)",
                color: "#fff",
                borderRadius: "var(--fm-radius-md)",
                textDecoration: "none",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              + Add first client
            </Link>
          </div>
        </FmPanel>
      ) : (
        <div id="needs-attention" style={{ scrollMarginTop: 80 }}>
          <TriageSections grouped={grouped} />
        </div>
      )}

      {/* (Broadcast panel moved to the top — above triage sections.) */}
    </FmAppShell>
  );
}
