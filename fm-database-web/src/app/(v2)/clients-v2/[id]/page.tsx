/**
 * /clients-v2/[id] — Phase 2 client detail page in the v2 shell.
 *
 * Same data sources as the legacy /clients/[id] page; renders through the
 * new shell + primitives:
 *   - FmClientHeader (with FmWorkflowBanner colour-per-state)
 *   - FmDepletionBanner (when client meds match catalogue depletions)
 *   - FmMarkerPanel (smart-collapse + flagged-only toggle)
 *   - FmBodyCompGrid (sparkline + baseline toggle)
 *   - FmContactPanel (pinned + disclosure)
 *   - FmFivePillars (with stale state)
 *
 * 5-tab subnav is rendered but only Overview is wired in this commit;
 * Analyse / Plan / Communicate / Catalogue tabs each link to the legacy
 * /clients/[id]?tab=… as a fallback until Phases 3+ rebuild them.
 */
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  loadClientById,
  markCoachTabViewed,
  loadClientBookings,
} from "@/lib/fmdb/loader-extras";
import { loadClientJourney } from "@/lib/fmdb/client-journey";
import {
  loadClientSessions,
  type ClientWithMeta,
  type ClientSession,
} from "@/lib/fmdb/loader-extras";
import { loadAllPlans } from "@/lib/fmdb/loader";
import { checkMedicationImpactsAction } from "@/lib/server-actions/clients";
import { ClientIdentityEditor } from "./client-identity-editor";
import { CoachNotesButton } from "@/components/client-widgets/coach-notes-launcher";
import { SendIntakeFormButton } from "./send-intake-form-button";
import { OverviewSendLabsCard } from "./overview-send-labs-card";
import { OverviewPlanLabsCard } from "./overview-plan-labs-card";
import { IntakeInsightsCard } from "./intake-insights-card";
import { Tier1AdvisoryCard } from "./tier1-advisory-card";
import { detectTier1Advisory } from "@/lib/fmdb/tier1-advisory";
import { IntakeProgressCard } from "./intake-progress-card";
import { loadIntakeInsights } from "@/lib/server-actions/intake-insights";
import { EngagementPicker } from "./engagement-picker";
import { UnlockFullIntakeButton } from "./unlock-full-intake-button";
import { NasaLeanTestPanel } from "./nasa-lean-test-panel";
import { BeightonVerifyPanel } from "./beighton-verify-panel";
import { TierOneSuspicionsPanel } from "./tier-one-suspicions-panel";
import { computeSuspectedSignals } from "@/lib/fmdb/retrospective-tier1";
import { ClientMemoryPanel } from "./client-memory-panel";
import { PlanModulesPanel } from "@/components/client-widgets/plan-modules-panel";
import { MindbodyDripPanel } from "./mindbody-drip-panel";
import { SupplementCheckWidget } from "@/components/client-widgets/supplement-check-widget";
import { WeightLossCard } from "@/components/client-widgets/weight-loss-card";
import { WeightProgressPanel } from "@/components/client-widgets/weight-progress-panel";
import { WeightLossReadinessPanel } from "@/components/client-widgets/weight-loss-readiness-panel";
import { assessWeightProgress, estimateObservedTdee } from "@/lib/fmdb/weight-progress";
import { computeCaloriePhases } from "@/lib/fmdb/calorie-phases";
import type { WeightLossGoal, MeasurementEntry } from "@/lib/fmdb/types";
import { parseSessionType, lastTemplateSentAt } from "@/lib/fmdb/session-utils";
import { formatLongDate } from "@/lib/fmdb/format-date";
import {
  FmAppShell,
  FmClientHeader,
  FmClientJourneyStrip,
  FmContactPanel,
  FmGroupedPanel,
  FmDepletionBanner,
  FmMarkerPanel,
  FmBodyCompGrid,
  FmPanel,
  FmInfoRow,
  FmChip,
  type FmWorkflowStage,
  type FmContactRow,
  type FmMarkerGroup,
  type FmMarker,
  type MarkerFlag,
  type BodyCompMetric,
  type DepletionRow,
  type FivePillarsValue,
  type DerivedFivePillars,
} from "@/components/fm";
import { FmFivePillarsWithSendCheckIn } from "./five-pillars-bridge";
// MemoryPanel import removed 2026-05-19 — it duplicated ClientMemoryPanel
// (above in the left column). File `./memory-panel.tsx` left on disk in
// case we want to revive a read-only twin later; not imported anywhere
// after this change.
import { SOAPNotePanel } from "@/components/client-widgets/soap-note-panel";
import { MedicationImpactPanel } from "@/components/client-widgets/medication-impact-panel";
import { PregnancySafetyPanel } from "@/components/client-widgets/pregnancy-safety-panel";
import { ReworkBanner } from "@/components/client-widgets/rework-banner";
import { BookingDueBanner } from "@/components/client-widgets/booking-due-banner";
import { ClientBookingsPanel } from "@/components/client-widgets/client-bookings-panel";
import { PreSessionBrief } from "@/components/client-widgets/pre-session-brief";
import { loadClientSessionsAction } from "@/lib/server-actions/assess";
import { clientQuickActions } from "./client-quick-actions";
import { clientSubnavTabs } from "./client-subnav";
import { MarkerPanelWithRecompute } from "./marker-panel-with-recompute";
import { ClientQuickChatPanel } from "./client-quick-chat-panel";
import { HandoutDripPanel } from "./handout-drip-panel";
import { loadClientApiSpend } from "@/lib/server-actions/usage";
import { IfmBaselineCard, type IfmBaseline } from "./ifm-baseline-card";
import { CycleTrackingPanel } from "./cycle-tracking-panel";
import { StageGate } from "./stage-gate";

export const dynamic = "force-dynamic";

interface PlanRow {
  slug: string;
  client_id?: string;
  status?: string;
  _bucket?: string;
  plan_period_recheck_date?: string;
  plan_period_start?: string;
  plan_period_weeks?: number;
}

const ACTIVE_BUCKETS = new Set(["draft", "ready_to_publish", "published"]);

/** Map our internal lab_marker.flag strings → FM v2 marker flag taxonomy. */
function mapFlag(raw: string | undefined): MarkerFlag {
  const f = (raw ?? "").toLowerCase();
  if (f === "high" || f === "elevated") return "high";
  if (f === "low" || f === "deficient") return "low";
  if (f === "watch" || f === "borderline" || f === "suboptimal") return "watch";
  return "ok";
}

/**
 * Group flat lab_markers into the 8 FM categories. We pattern-match marker
 * names since current YAML stores them as free strings (panel field exists
 * but isn't reliably set on older entries).
 */
function groupLabMarkers(
  markers: NonNullable<ClientWithMeta["lab_markers"]>,
): FmMarkerGroup[] {
  const groups: { title: string; icon: string; patterns: RegExp }[] = [
    {
      title: "Metabolic & insulin",
      icon: "🔀",
      patterns: /glucose|hba1c|insulin|homa|uric|c-peptide|leptin|adiponectin|fructosamine/i,
    },
    {
      title: "Lipid profile",
      icon: "🪶",
      patterns: /cholesterol|ldl|hdl|triglyceride|apob|apo-?a|lp\(a\)|sdldl|oxldl|non-?hdl|tc\/?hdl|tg\s*\/?\s*hdl|ldl\/?hdl|aip|atherogenic/i,
    },
    {
      title: "Thyroid",
      icon: "🦋",
      patterns: /tsh|free t[34]|reverse t3|rt3|tpo|tg ab|thyroglobulin|t3|t4/i,
    },
    {
      title: "Inflammation",
      icon: "🔥",
      patterns: /crp|esr|nlr|fibrinogen|neutrophil|lymphocyte|ferritin\s*\(acute\)|il-?6/i,
    },
    {
      title: "HPA axis",
      icon: "🌑",
      patterns: /cortisol|dhea/i,
    },
    {
      title: "Iron, B-vitamins, vitamin D",
      icon: "🧬",
      patterns: /ferritin|iron|transferrin|hemoglobin|hgb|mch|rdw|b12|b-?12|folate|vitamin d|25-?oh|homocysteine|mma/i,
    },
    {
      title: "Liver, kidney, electrolytes",
      icon: "🪫",
      patterns: /alt|ast|ggt|alkaline|albumin|bun|creatinine|egfr|sodium|potassium|chloride|bicarb|calcium|magnesium|phosphate|urea|sgot|sgpt/i,
    },
  ];

  const buckets: Record<string, FmMarker[]> = {};
  const order: string[] = [];
  for (const m of markers) {
    const fm: FmMarker = {
      name: m.marker_name,
      value: typeof m.value === "number" ? m.value : String(m.value),
      unit: m.unit ?? "",
      range: m.reference_range,
      flag: mapFlag(m.flag),
      computed: !!m.computed,
      meta: m.fm_interpretation,
    };
    const match = groups.find((g) => g.patterns.test(m.marker_name));
    const key = match?.title ?? "Other";
    if (!buckets[key]) {
      buckets[key] = [];
      order.push(key);
    }
    buckets[key].push(fm);
  }

  // Sort to match the canonical order, then append "Other" at end.
  const ordered: FmMarkerGroup[] = [];
  for (const g of groups) {
    if (buckets[g.title]) {
      ordered.push({ title: g.title, icon: g.icon, markers: buckets[g.title] });
    }
  }
  if (buckets["Other"]) {
    ordered.push({ title: "Other", icon: "🧪", markers: buckets["Other"] });
  }
  return ordered;
}

type MeasurementKey =
  | "height_cm"
  | "weight_kg"
  | "bp_systolic"
  | "bp_diastolic"
  | "hr_bpm"
  | "waist_cm"
  | "hip_cm";

type SnapshotMeasurements = Partial<Record<MeasurementKey, number | null | undefined>>;
type DatedMeasurement = { date: string; measurements: SnapshotMeasurements; source?: string };

/** Normalise a flat client.measurements object (legacy key names) to the
 *  snapshot's MeasurementKey shape. Returns undefined if no values present. */
function flatMeasurementsToSnapshot(
  flat: Record<string, unknown> | undefined,
): SnapshotMeasurements | undefined {
  if (!flat) return undefined;
  const mapped: SnapshotMeasurements = {
    height_cm: typeof flat.height_cm === "number" ? flat.height_cm : undefined,
    weight_kg: typeof flat.weight_kg === "number" ? flat.weight_kg : undefined,
    waist_cm: typeof flat.waist_cm === "number" ? flat.waist_cm : undefined,
    hip_cm: typeof flat.hip_cm === "number" ? flat.hip_cm : undefined,
    bp_systolic:
      typeof flat.bp_systolic === "number"
        ? flat.bp_systolic
        : typeof flat.blood_pressure_systolic === "number"
          ? flat.blood_pressure_systolic
          : undefined,
    bp_diastolic:
      typeof flat.bp_diastolic === "number"
        ? flat.bp_diastolic
        : typeof flat.blood_pressure_diastolic === "number"
          ? flat.blood_pressure_diastolic
          : undefined,
    hr_bpm:
      typeof flat.hr_bpm === "number"
        ? flat.hr_bpm
        : typeof flat.resting_heart_rate === "number"
          ? flat.resting_heart_rate
          : undefined,
  };
  const hasAny = (Object.keys(mapped) as MeasurementKey[]).some(
    (k) => typeof mapped[k] === "number",
  );
  return hasAny ? mapped : undefined;
}

/** Build the unified time-series of body measurements by merging:
 *    - every health_snapshots entry that has a `measurements` block
 *    - the flat client.measurements object (synthesized as a snapshot dated
 *      by client.measurements.measured_on or today) when it has fresh values
 *      not already represented in any snapshot.
 *
 *  This handles three real cases:
 *    1. Manual entry via /assess → update-client-data.py writes BOTH
 *       (snapshot + flat). Snapshot wins.
 *    2. Old transcript-parser runs that only updated client.measurements
 *       (no snapshot appended). Flat is synthesized so values surface.
 *    3. Legacy clients with only the flat object (no snapshot history).
 */
function buildBodyCompMetrics(
  snapshots: NonNullable<ClientWithMeta["health_snapshots"]>,
  flat: Record<string, unknown> | undefined,
  log: Array<Record<string, unknown>> | undefined,
): BodyCompMetric[] {
  const allDated: DatedMeasurement[] = [];

  // Real snapshots first.
  for (const s of snapshots) {
    if (s.measurements) {
      allDated.push({
        date: s.date,
        measurements: s.measurements as SnapshotMeasurements,
        source: s.source,
      });
    }
  }

  // measurements_log entries — the time-series field that addMeasurementAction
  // writes to from FmBodyCompGrid's "+ Log entry" button. Without this branch,
  // any entry the coach added via the dashboard tile would never surface in
  // the trend, because buildBodyCompMetrics previously only knew about
  // health_snapshots + flat measurements. Real bug surfaced on cl-004
  // 2026-05-18: coach saved weight 79 kg via Log entry, UI kept showing the
  // intake 80 kg from the flat measurements field.
  for (const entry of log ?? []) {
    const d = typeof entry.date === "string" ? entry.date : null;
    if (!d) continue;
    const measurementKeys: Partial<Record<MeasurementKey, number>> = {};
    if (typeof entry.weight_kg === "number") measurementKeys.weight_kg = entry.weight_kg;
    if (typeof entry.waist_cm === "number") measurementKeys.waist_cm = entry.waist_cm;
    if (typeof entry.hip_cm === "number") measurementKeys.hip_cm = entry.hip_cm;
    if (typeof entry.height_cm === "number") measurementKeys.height_cm = entry.height_cm;
    if (typeof entry.blood_pressure_systolic === "number")
      measurementKeys.bp_systolic = entry.blood_pressure_systolic;
    if (typeof entry.blood_pressure_diastolic === "number")
      measurementKeys.bp_diastolic = entry.blood_pressure_diastolic;
    if (typeof entry.resting_heart_rate === "number")
      measurementKeys.hr_bpm = entry.resting_heart_rate;
    if (Object.keys(measurementKeys).length === 0) continue;
    // Merge into an existing snapshot for the same date if one exists,
    // otherwise push a fresh row. Log entries WIN over snapshot values
    // for the same date (the log is the explicit coach-recorded source).
    const existing = allDated.find((x) => x.date === d);
    if (existing) {
      Object.assign(existing.measurements, measurementKeys);
    } else {
      allDated.push({
        date: d,
        measurements: measurementKeys as SnapshotMeasurements,
        source: "measurements_log",
      });
    }
  }

  // Synthesize a snapshot from flat measurements if any field is present.
  // Use measured_on as the date, else today. If a snapshot with the same
  // date already exists, MERGE the flat values into it (per-field) so we
  // don't lose anything from the flat layer.
  const flatSnap = flatMeasurementsToSnapshot(flat);
  if (flatSnap) {
    const flatDate =
      typeof flat?.measured_on === "string" && flat.measured_on
        ? (flat.measured_on as string)
        : new Date().toISOString().slice(0, 10);
    const existing = allDated.find((d) => d.date === flatDate);
    if (existing) {
      for (const k of Object.keys(flatSnap) as MeasurementKey[]) {
        if (
          existing.measurements[k] == null &&
          typeof flatSnap[k] === "number"
        ) {
          existing.measurements[k] = flatSnap[k];
        }
      }
    } else {
      allDated.push({
        date: flatDate,
        measurements: flatSnap,
        source: "client-profile",
      });
    }
  }

  allDated.sort((a, b) => a.date.localeCompare(b.date));

  function series(key: MeasurementKey): number[] {
    const out: number[] = [];
    for (const s of allDated) {
      const v = s.measurements[key];
      if (typeof v === "number" && !Number.isNaN(v)) out.push(v);
    }
    return out;
  }

  /** Same as series() but returns the per-point ISO dates, so the tile
   *  can show the real elapsed window for the delta ("−8 kg in 10 days"
   *  instead of the hardcoded "−8 kg in 8 wks"). */
  function seriesWithDates(key: MeasurementKey): { values: number[]; dates: string[] } {
    const values: number[] = [];
    const dates: string[] = [];
    for (const s of allDated) {
      const v = s.measurements[key];
      if (typeof v === "number" && !Number.isNaN(v)) {
        values.push(v);
        dates.push(s.date);
      }
    }
    return { values, dates };
  }

  const weight = seriesWithDates("weight_kg");
  const height = series("height_cm");
  const bmi: number[] = weight.values.length
    ? weight.values.map((w, i) => {
        const h = height[i] ?? height[0];
        if (!h) return NaN;
        const m = h / 100;
        return w / (m * m);
      })
    : [];
  // BMI dates align with weight dates (BMI is derived from weight at each point).
  const bmiDates = weight.dates.slice(0, bmi.length);

  // Waist + hip: display in inches because that's what clients enter
  // in the form (storage stays metric — only the readout is converted).
  // 1 cm = 0.3937 in.
  const CM_TO_IN = 0.3937;
  const waist = seriesWithDates("waist_cm");
  const hip = seriesWithDates("hip_cm");
  const waistIn = waist.values.map((v) => Math.round(v * CM_TO_IN * 10) / 10);
  const hipIn = hip.values.map((v) => Math.round(v * CM_TO_IN * 10) / 10);
  const bpSys = seriesWithDates("bp_systolic");
  const bpDia = seriesWithDates("bp_diastolic");
  const hr = seriesWithDates("hr_bpm");

  return [
    {
      label: "Weight",
      unit: "kg",
      series: weight.values,
      seriesDates: weight.dates,
      goalDirection: "down",
    },
    {
      label: "BMI",
      unit: "",
      series: bmi.filter((v) => !Number.isNaN(v)),
      seriesDates: bmiDates.filter((_, i) => !Number.isNaN(bmi[i])),
      goalDirection: "down",
    },
    {
      label: "Waist",
      unit: "in",
      series: waistIn,
      seriesDates: waist.dates,
      goalDirection: "down",
    },
    {
      label: "Hip",
      unit: "in",
      series: hipIn,
      seriesDates: hip.dates,
      goalDirection: "neutral",
    },
    // Blood pressure rendered as one compound tile "<sys>/<dia>" instead of
    // two separate cards — easier to read at a glance + matches how BP is
    // always communicated. Sparkline + delta track systolic (the more
    // load-bearing number); diastolic shown alongside in muted colour.
    {
      label: "Blood pressure",
      unit: "",
      series: bpSys.values,
      seriesDates: bpSys.dates,
      secondarySeries: bpDia.values,
      goalDirection: "down",
    },
    {
      label: "Resting HR",
      unit: "bpm",
      series: hr.values,
      seriesDates: hr.dates,
      goalDirection: "down",
    },
  ];
}

function derivedAge(client: ClientWithMeta): number | undefined {
  if (client.date_of_birth) {
    const dob = new Date(client.date_of_birth);
    if (!Number.isNaN(dob.getTime())) {
      const today = new Date();
      let age = today.getFullYear() - dob.getFullYear();
      const m = today.getMonth() - dob.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
      return age;
    }
  }
  // age_band like "45-50" → midpoint
  if (client.age_band) {
    const parts = client.age_band.split("-").map((n) => parseInt(n, 10));
    if (parts.length === 2 && !parts.some((n) => Number.isNaN(n))) {
      return Math.round((parts[0] + parts[1]) / 2);
    }
  }
  return undefined;
}

function deriveStage(
  plans: PlanRow[],
  todayStr: string,
  ctx?: {
    hasDiscoverySession: boolean;
    hasIntakeSession: boolean;
    engagement?: "pending" | "signed_up" | "declined";
  },
): {
  stage: FmWorkflowStage;
  title: React.ReactNode;
  detail?: React.ReactNode;
  cta?: React.ReactNode;
} {
  const active = plans.filter((p) => ACTIVE_BUCKETS.has(p._bucket ?? p.status ?? ""));
  if (active.length === 0) {
    // No plan yet — the message depends on where they are in the funnel.
    // Coach feedback (2026-05-13): "Sudarshan has discovery done but the
    // overview still says 'Run a Discovery or Full Assessment'." Use the
    // session record + engagement_status to give a more useful next-step.
    if (ctx?.engagement === "declined") {
      return {
        stage: "no_plan",
        title: "Discovery only — declined",
        detail: "Client politely passed after discovery. No further action queued.",
        cta: "View discovery",
      };
    }
    if (ctx?.hasDiscoverySession && ctx.engagement !== "signed_up" && !ctx.hasIntakeSession) {
      return {
        stage: "no_plan",
        title: "Awaiting sign-up confirmation",
        detail: "Discovery captured. Mark whether the client is signing up before scheduling intake.",
        cta: "Confirm sign-up",
      };
    }
    if (ctx?.hasDiscoverySession && ctx.engagement === "signed_up" && !ctx.hasIntakeSession) {
      return {
        stage: "no_plan",
        title: "Discovery done · schedule intake",
        detail: "Client signed up. Run a Full Assessment / Intake to capture full history.",
        cta: "Start intake",
      };
    }
    if (ctx?.hasIntakeSession) {
      return {
        stage: "no_plan",
        title: "Intake captured · draft a plan",
        detail: "Run the Full Assessment AI synthesis on this intake to draft a protocol.",
        cta: "Run Full Assessment",
      };
    }
    return {
      stage: "no_plan",
      title: "No plan yet",
      detail: "Run a Discovery or Full Assessment to draft one.",
      cta: "Start a session",
    };
  }
  const draft = active.find((p) => (p._bucket ?? p.status) !== "published");
  const published = active.find((p) => (p._bucket ?? p.status) === "published");

  if (published) {
    // Overdue → recheck. On-time → active.
    let recheckDate: string | undefined = published.plan_period_recheck_date;
    if (!recheckDate && published.plan_period_start && published.plan_period_weeks) {
      const d = new Date(published.plan_period_start + "T00:00:00");
      d.setDate(d.getDate() + published.plan_period_weeks * 7);
      recheckDate = d.toISOString().slice(0, 10);
    }
    if (recheckDate && recheckDate < todayStr) {
      return {
        stage: "recheck",
        title: "Re-check due",
        detail: `Protocol ended ${recheckDate} · generate a follow-up plan.`,
        cta: "Generate follow-up plan",
      };
    }
    return {
      stage: "active",
      title: `Plan active — ${published.slug}`,
      detail: recheckDate ? `Next follow-up ${recheckDate}.` : undefined,
      cta: "Generate letters",
    };
  }

  // Has a draft, no published yet.
  if (draft) {
    return {
      stage: "draft",
      title: "Plan in draft",
      detail: `${draft.slug} · not sent to client.`,
      cta: "Activate plan",
    };
  }

  return {
    stage: "no_plan",
    title: "No active plan",
    cta: "Start a session",
  };
}

export default async function ClientV2Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const todayStr = new Date().toISOString().slice(0, 10);

  // Mark the Overview tab as viewed — clears the "bookings" bucket in the
  // unread badge on this client. Async fire-and-forget; never blocks render.
  void markCoachTabViewed(id, "overview");

  const [client, sessions, allPlans, sessionSummaries, journey, intakeInsights, clientBookings] = await Promise.all([
    loadClientById(id),
    loadClientSessions(id),
    loadAllPlans(),
    loadClientSessionsAction(id),
    loadClientJourney(id, todayStr),
    loadIntakeInsights(id),
    loadClientBookings(id),
  ]);

  if (!client) notFound();

  const plansForClient = (allPlans as unknown as PlanRow[]).filter(
    (p) => p.client_id === id,
  );

  // Active published plan — used by PreSessionBrief to load supplements +
  // practices + plan period when the coach is prepping for a session.
  const publishedPlan = plansForClient.find(
    (p) => (p._bucket ?? p.status) === "published",
  );

  // Mind-body drip — show the EFT unlock control only when tapping is prescribed.
  const eftPrescribed = !!(
    publishedPlan as unknown as
      | { lifestyle_practices?: Array<{ name?: string; details?: string }> }
      | undefined
  )?.lifestyle_practices?.some((p) =>
    /\beft\b|tapping|emotional freedom/i.test(`${p?.name ?? ""} ${p?.details ?? ""}`),
  );
  const mindbodyEft =
    (((client as unknown as { mindbody_eft?: string }).mindbody_eft as "auto" | "unlocked" | "locked") || "auto");
  const sleepPrescribed = !!(
    publishedPlan as unknown as
      | { lifestyle_practices?: Array<{ name?: string; details?: string }> }
      | undefined
  )?.lifestyle_practices?.some((p) =>
    /wind.?down|body scan|sleep relaxation|relaxation for sleep|yoga nidra|progressive relaxation|sleep meditation|bedtime relaxation/i.test(
      `${p?.name ?? ""} ${p?.details ?? ""}`,
    ),
  );
  const mindbodySleep =
    (((client as unknown as { mindbody_sleep?: string }).mindbody_sleep as "auto" | "unlocked" | "locked") || "auto");

  // Has the client done a discovery / intake session yet? Used by
  // deriveStage to give a more accurate "next step" banner than the
  // plans-only signal. parseSessionType reads the [session_type: xxx]
  // tag the discovery + intake forms both prefix into
  // presenting_complaints.
  const _sessionTypes = sessions.map((s) =>
    parseSessionType(
      (s as unknown as Record<string, unknown>).presenting_complaints as
        | string
        | undefined,
    ),
  );
  const hasDiscoverySession = _sessionTypes.some((t) => t === "discovery");
  const hasIntakeSession = _sessionTypes.some((t) => t === "intake");

  // Persisted last-sent timestamps per template — every "send X" button
  // on this page reads these to render "✓ Sent X ago · Resend" idle state
  // instead of looking fresh after every page reload. Durable coach rule
  // 2026-05-23 (see feedback-send-buttons-persist-state memory). Source of
  // truth: `recordOutboundMessageAction` tags
  //   [template: <name>] [sent_at: <ISO>]
  // into a quick_note session for each successful WA/email send.
  const sessRecords = sessions as ReadonlyArray<{ presenting_complaints?: string }>;
  const lastIntakeSentAt = lastTemplateSentAt(sessRecords, "fm_intake_invite");
  const lastLabsSentAt = lastTemplateSentAt(sessRecords, "fm_lab_reminder");
  // 2026-05-23 send-button audit — UnlockFullIntakeButton's "Notify client"
  // CTA fires either fm_intake_unlocked_v1 OR fm_intake_invite (env-switched
  // fallback). Take the latest of the two so the badge survives a flag flip.
  const _u1 = lastTemplateSentAt(sessRecords, "fm_intake_unlocked_v1");
  const _u2 = lastTemplateSentAt(sessRecords, "fm_intake_invite");
  const lastUnlockNotifyAt =
    !_u1 && !_u2 ? null : (_u1 || "") > (_u2 || "") ? _u1 : _u2;

  // Most-recent discovery session that has a parsed requested_labs list —
  // feeds the OverviewSendLabsCard so the coach can send labs straight from
  // Overview without bouncing to the Analyse tab. Older sessions embed labs
  // inside coach_notes as "[Requested labs: A, B, C]"; we parse that shape
  // (the only shape on disk right now) and the future top-level field too.
  const latestDiscoveryWithLabs: {
    sessionId: string;
    labs: string[];
    date: string | null;
  } | null = (() => {
    const sorted = [...sessions].sort((a, b) =>
      String(b.date ?? "").localeCompare(String(a.date ?? "")),
    );
    for (const s of sorted) {
      const sr = s as Record<string, unknown>;
      const t = parseSessionType(sr.presenting_complaints as string | undefined);
      if (t !== "discovery") continue;
      const top = (sr as { requested_labs?: unknown }).requested_labs;
      let labs: string[] = [];
      if (Array.isArray(top) && top.length > 0) {
        labs = top.map((x) => String(x)).filter(Boolean);
      } else {
        const notes = String((sr as { coach_notes?: string }).coach_notes ?? "");
        const m = notes.match(/\[Requested labs:\s*([^\]]+)\]/);
        // Split on the commas BETWEEN markers, not commas inside a marker's
        // own parentheses (e.g. "Morning Cortisol (8am, fasting)").
        if (m) labs = m[1].split(/,\s*(?![^()]*\))/).map((x) => x.trim()).filter(Boolean);
      }
      if (labs.length === 0) continue;
      return {
        sessionId: String(sr.session_id ?? ""),
        labs,
        date: (sr.date as string | undefined) ?? null,
      };
    }
    return null;
  })();
  const engagementRaw = (client as unknown as { engagement_status?: string }).engagement_status;
  const engagement =
    engagementRaw === "signed_up" || engagementRaw === "declined" || engagementRaw === "pending"
      ? (engagementRaw as "signed_up" | "declined" | "pending")
      : undefined;

  // Has the client moved beyond "just created"? Any of: a discovery or
  // intake session on file, the client submitted the online intake form,
  // or a plan already exists. Used to decide whether to prompt for the
  // sign-up decision. Previously the sign-up control was gated ONLY on a
  // recorded discovery session — so a client like Archana (intake form
  // submitted, draft plan, but no [session_type: discovery] session)
  // had NO way for the coach to mark her signed up. See engagement
  // callout + the always-visible Sign-up status panel below.
  const hasAnyJourneySignal =
    hasDiscoverySession ||
    hasIntakeSession ||
    Boolean((client as { intake_submitted_at?: string | null }).intake_submitted_at) ||
    plansForClient.length > 0;

  // Workflow stage
  const stageInfo = deriveStage(plansForClient, todayStr, {
    hasDiscoverySession,
    hasIntakeSession,
    engagement,
  });

  // Last contact date — the date of the most recent ACTUAL touch point
  // with the client, as entered by the coach. Priority cascade (not max):
  //   1. The newest session.date — coach types this on save (discovery /
  //      intake / check-in / quick note).
  //   2. Fall back to client.intake_date when no sessions exist yet but
  //      an intake date was recorded on the client record itself.
  //   3. Otherwise show "Never" — don't fall back to created_at, which
  //      is just the system clock when the YAML was first written and
  //      doesn't represent an actual contact.
  //
  // Bug fixed 2026-05-13: previously this took the MAX across all three,
  // so Sudarshan's 2026-05-05 discovery call lost to his 2026-05-13
  // created_at and rendered as "13 May 2026" instead of "5 May 2026".
  const sortedSessions = [...sessions].sort((a, b) =>
    (a.date ?? "").localeCompare(b.date ?? ""),
  );
  const newestSession = sortedSessions[sortedSessions.length - 1]?.date as
    | string
    | undefined;
  const _intakeDate = (client as unknown as { intake_date?: string }).intake_date;
  const lastSessionDate: string | undefined =
    newestSession?.trim()
      ? newestSession
      : _intakeDate?.trim()
        ? _intakeDate
        : undefined;
  const age = derivedAge(client);

  // Pinned + more contact rows
  const pinned: FmContactRow[] = [
    { label: "Phone", value: client.mobile_number ?? "—" },
    { label: "Email", value: client.email ?? "—" },
    {
      label: "Location",
      value:
        [client.city, client.state, client.country].filter(Boolean).join(", ") ||
        "—",
    },
    {
      label: "Next contact",
      value: client.next_contact_date ?? "Not scheduled",
      strong: !!client.next_contact_date,
    },
    { label: "Diet", value: client.dietary_preference ?? "—" },
    { label: "Avoids", value: client.foods_to_avoid || "—" },
  ];

  const mthfrSummary = (client as unknown as Record<string, unknown>).mthfr_summary as
    | string
    | undefined;
  const apoeSummary = (client as unknown as Record<string, unknown>).apoe_summary as
    | string
    | undefined;
  const comtSummary = (client as unknown as Record<string, unknown>).comt_summary as
    | string
    | undefined;

  const more: FmContactRow[] = [
    {
      label: "Address",
      value:
        [client.address_line1, client.address_line2, client.pincode]
          .filter(Boolean)
          .join(", ") || "—",
    },
    { label: "Non-negotiables", value: client.non_negotiables || "—" },
    { label: "Family history", value: client.family_history || "—" },
    { label: "MTHFR", value: mthfrSummary ?? "No genome report on file" },
    { label: "APOE", value: apoeSummary ?? "No genome report on file" },
    { label: "COMT", value: comtSummary ?? "No genome report on file" },
    { label: "Cycle status", value: client.cycle_status ?? "—" },
    { label: "Pregnancy", value: client.pregnancy_status ?? "No" },
    {
      label: "Reported triggers",
      value: client.reported_triggers || "—",
    },
  ];

  // FM markers
  const labMarkers = (client.lab_markers ?? []).map((m) => ({
    ...m,
    value: typeof m.value === "string" ? parseFloat(m.value) || m.value : m.value,
  }));
  const markerGroups = groupLabMarkers(labMarkers);

  // Body comp — pulls from health_snapshots, measurements_log (time-series
  // written by + Log entry), AND legacy flat measurements. measurements_log
  // entries win over snapshot values for the same date.
  const bodyComp = buildBodyCompMetrics(
    client.health_snapshots ?? [],
    client.measurements,
    (client as unknown as { measurements_log?: Array<Record<string, unknown>> })
      .measurements_log,
  );

  // B2 — collect ALL body-comp snapshots from both storage paths so the
  // "Manage entries" expander on the FmBodyCompGrid can offer per-row
  // delete. Same shape both sides: {origin, date, source?, values[]}.
  const bodyCompSnapshots: Array<{
    origin: "measurements_log" | "health_snapshots";
    date: string;
    source?: string;
    values: Array<{ label: string; text: string }>;
  }> = [];
  const _CM_TO_IN = 0.3937;
  const _formatHsValues = (
    m: Record<string, unknown>,
  ): Array<{ label: string; text: string }> => {
    const out: Array<{ label: string; text: string }> = [];
    if (typeof m.weight_kg === "number") out.push({ label: "Weight", text: `${m.weight_kg} kg` });
    if (typeof m.height_cm === "number") {
      const totalIn = m.height_cm * _CM_TO_IN;
      const ft = Math.floor(totalIn / 12);
      const inches = Math.round((totalIn - ft * 12) * 10) / 10;
      out.push({ label: "Height", text: `${ft} ft ${inches} in` });
    }
    if (typeof m.waist_cm === "number") out.push({ label: "Waist", text: `${Math.round(m.waist_cm * _CM_TO_IN * 10) / 10} in` });
    if (typeof m.hip_cm === "number") out.push({ label: "Hip", text: `${Math.round(m.hip_cm * _CM_TO_IN * 10) / 10} in` });
    if (typeof m.bp_systolic === "number" && typeof m.bp_diastolic === "number") {
      out.push({ label: "BP", text: `${m.bp_systolic}/${m.bp_diastolic}` });
    } else if (typeof m.blood_pressure_systolic === "number" && typeof m.blood_pressure_diastolic === "number") {
      out.push({ label: "BP", text: `${m.blood_pressure_systolic}/${m.blood_pressure_diastolic}` });
    }
    if (typeof m.hr_bpm === "number") out.push({ label: "HR", text: `${m.hr_bpm} bpm` });
    else if (typeof m.resting_heart_rate === "number") out.push({ label: "HR", text: `${m.resting_heart_rate} bpm` });
    return out;
  };
  for (const s of client.health_snapshots ?? []) {
    const m = (s.measurements as Record<string, unknown>) ?? {};
    const values = _formatHsValues(m);
    if (values.length > 0) {
      bodyCompSnapshots.push({
        origin: "health_snapshots",
        date: s.date,
        source: s.source,
        values,
      });
    }
  }
  const _log =
    (client as unknown as { measurements_log?: Array<Record<string, unknown>> })
      .measurements_log ?? [];
  for (const e of _log) {
    if (typeof e.date !== "string") continue;
    bodyCompSnapshots.push({
      origin: "measurements_log",
      date: e.date,
      values: _formatHsValues(e),
    });
  }

  // Five pillars — latest from sessions, else from client.five_pillars.
  const sessionsWithPillars = sortedSessions.filter(
    (s) => (s as Record<string, unknown>).five_pillars,
  );
  const latestPillarsSession = sessionsWithPillars[sessionsWithPillars.length - 1];
  const latestPillars =
    ((latestPillarsSession as Record<string, unknown> | undefined)?.five_pillars as
      | FivePillarsValue
      | undefined) ?? (client.five_pillars as FivePillarsValue | undefined);
  const pillarsDate = latestPillarsSession?.date;
  const daysSincePillars = pillarsDate
    ? Math.round(
        (new Date(todayStr).getTime() - new Date(pillarsDate).getTime()) /
          (1000 * 60 * 60 * 24),
      )
    : null;

  // Tier 1 derived-pillar rollup — written by update-derived-pillar.py
  // on every weekly-poll button reply. Read raw from client.yaml (the
  // Pydantic Client model is extra="ignore" so it'd drop this field on
  // model load; the TS loader keeps it lenient). Per-pillar entries
  // override the latestPillars session on a per-pillar basis whenever
  // their `received_at` is newer — see mergedRow() in FmFivePillars.
  const derivedFivePillars =
    ((client as Record<string, unknown>).derived_five_pillars as
      | DerivedFivePillars
      | null
      | undefined) ?? null;

  // Drug-nutrient depletions.
  //
  // D9 fix 2026-05-23 — also pull from the STRUCTURED medication-category
  // fields the intake form captures (psych_medications, statins_bp_diabetes,
  // glp1_medications, acid_suppressants, nsaids_daily, antibiotics_last_12mo,
  // hormonal_contraception_hrt, thyroid_medication, biologics_immunosuppressants,
  // thyroid_medication). Without this, Kshitija cl-010's SSRI + unnamed 40mg
  // drug were invisible in the Active medications panel because the form
  // wrote them into category arrays, not into current_medications.
  //
  // Each entry can be either a string OR a dict {name, dose, started,
  // still_taking, side_effects}. We surface the name with metadata
  // inline ("Telma 40 — 40 mg, started 3 years ago"). Stopped entries
  // (still_taking === false) get a "stopped" suffix so they're visible
  // but de-emphasised.
  type StructuredMed = {
    name?: string;
    dose?: string;
    started?: string;
    still_taking?: boolean;
    side_effects?: string;
  };
  const _formatStructuredMed = (entry: StructuredMed | string): string | null => {
    if (typeof entry === "string") return entry.trim() || null;
    if (!entry || typeof entry !== "object") return null;
    const name = (entry.name ?? "").trim();
    const dose = (entry.dose ?? "").trim();
    const started = (entry.started ?? "").trim();
    const stopped = entry.still_taking === false;
    if (!name && !dose && !started) return null;
    const bits: string[] = [];
    bits.push(name || "(unnamed)");
    const meta: string[] = [];
    if (dose) meta.push(dose);
    if (started) meta.push(`started ${started}`);
    if (stopped) meta.push("stopped");
    if (meta.length > 0) bits.push(`— ${meta.join(", ")}`);
    return bits.join(" ");
  };
  const _structuredMedFields: Array<keyof typeof client | string> = [
    "psych_medications",
    "statins_bp_diabetes",
    "glp1_medications",
    "acid_suppressants",
    "nsaids_daily",
    "antibiotics_last_12mo",
    "hormonal_contraception_hrt",
    "thyroid_medication",
    "biologics_immunosuppressants",
  ];
  const _structuredMeds: string[] = [];
  for (const f of _structuredMedFields) {
    const raw = (client as unknown as Record<string, unknown>)[f as string];
    if (!Array.isArray(raw)) continue;
    for (const entry of raw) {
      const formatted = _formatStructuredMed(entry as StructuredMed | string);
      if (formatted) _structuredMeds.push(formatted);
    }
  }
  const _rawMeds = [
    ...(client.current_medications ?? []),
    ...(((client as unknown as { medications?: string[] }).medications) ?? []),
    ..._structuredMeds,
  ];
  // Dedup — case-insensitive on the FIRST WORD (the drug name). Prevents
  // "Telma 40" (from current_medications) duplicating "Telma 40 — 40 mg,
  // started 3 years ago" (from statins_bp_diabetes). Keeps the longer
  // entry (more metadata) when the first-word matches.
  const _seenMed = new Map<string, string>();
  for (const m of _rawMeds) {
    const key = String(m).trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    if (!key) continue;
    const existing = _seenMed.get(key);
    if (!existing || String(m).length > existing.length) {
      _seenMed.set(key, String(m));
    }
  }
  const meds = Array.from(_seenMed.values());
  const depletionResult = meds.length > 0
    ? await checkMedicationImpactsAction(id)
    : { ok: true, matches: [] as Array<{ drug_name: string; depletes: Array<{ nutrient: string; severity?: string }> }> };
  const depletionRows: DepletionRow[] =
    depletionResult.ok && Array.isArray(depletionResult.matches)
      ? depletionResult.matches.map((imp) => ({
          drug: imp.drug_name,
          nutrients: (imp.depletes ?? []).map((d) => d.nutrient),
          severity:
            (imp.depletes ?? []).some(
              (d) => d.severity === "high" || d.severity === "severe",
            )
              ? "flag"
              : "watch",
        }))
      : [];

  // Compose page

  const conditionChips = (client.active_conditions ?? []).slice(0, 8);
  const medList = meds.slice(0, 8);
  const allergyChips = (client.known_allergies ?? []).slice(0, 8);

  // API spend logged against this client (all-time) — surfaced as a header chip.
  const apiSpend = await loadClientApiSpend(client.client_id);

  return (
    <FmAppShell
      activeNavId="clients"
      quickActions={clientQuickActions(client.client_id)}
      crumbs={[
        { label: "Clients", href: "/clients-v2" },
        { label: client.display_name ?? client.client_id },
      ]}
    >
      <FmClientJourneyStrip journey={journey} />

      <FmClientHeader
        clientId={client.client_id}
        displayName={client.display_name ?? client.client_id}
        age={age}
        lastSessionDate={lastSessionDate}
        photoUrl={client.photo_filename ? `/api/client-photo/${client.client_id}` : null}
        // Fix F5 2026-05-23 — surface intake_insights.root_cause.label
        // directly under the name as a one-line keystone strip.
        rootCauseLabel={
          (client as unknown as {
            intake_insights?: { root_cause?: { label?: string } | null } | null;
          }).intake_insights?.root_cause?.label ?? null
        }
        stage={stageInfo.stage}
        stageTitle={stageInfo.title}
        stageDetail={stageInfo.detail}
        stageCta={stageInfo.cta}
        stageCtaHref={
          stageInfo.stage === "no_plan"
            ? `/clients-v2/${id}/analyse`
            : stageInfo.stage === "draft"
              ? `/clients-v2/${id}/plan/edit/${plansForClient.find((p) => (p._bucket ?? p.status) !== "published")?.slug ?? ""}`
              : stageInfo.stage === "active"
                ? // CTA reads "Generate letters" — must land on the
                  // Communicate tab (where letters are generated/sent),
                  // not the plan editor. Coach fix 2026-05-20.
                  `/clients-v2/${id}/communicate`
                : stageInfo.stage === "recheck"
                  ? `/clients-v2/${id}/plan#follow-up-panel`
                  : `/clients-v2/${id}/analyse`
        }
        quickActions={
          <>
            {/* Audit O6 (2026-05-20): the "📝 Record session" and
                "📊 View plan" chips duplicated the Record + Plan tabs
                two rows below in the subnav. Coach got two paths to the
                same destination plus a noisier header. Removed; kept
                "💬 Send message" because Communicate is a distinct
                destination from any subnav action. */}
            <CoachNotesButton clientId={client.client_id} />
            <QuickActionLink href={`/clients-v2/${id}/communicate`}>
              💬 Send message
            </QuickActionLink>
            {/* Inline identity editor — opens a panel above with prefilled
                name / DOB / sex / contact fields. Mounted in quickActions
                so it's always visible right under the client name in the
                page header (coach surfaced 2026-05-13 that it was hidden
                in the right column under FmContactPanel). */}
            <ClientIdentityEditor
              clientId={client.client_id}
              initial={{
                display_name: client.display_name,
                date_of_birth: client.date_of_birth ?? undefined,
                sex:
                  client.sex === "F" || client.sex === "M" || client.sex === "other"
                    ? (client.sex as "F" | "M" | "other")
                    : undefined,
                mobile_number: (client as unknown as { mobile_number?: string }).mobile_number,
                email: (client as unknown as { email?: string }).email,
                city: (client as unknown as { city?: string }).city,
                state: (client as unknown as { state?: string }).state,
                country: (client as unknown as { country?: string }).country,
              }}
            />
          </>
        }
      />

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: -2, marginBottom: 4 }}>
        <span
          title={`${apiSpend.all_time_calls} AI calls logged · $${apiSpend.this_month_usd} this month`}
          style={{
            fontSize: 11,
            color: "#64748b",
            background: "#f1f5f9",
            border: "1px solid #e2e8f0",
            borderRadius: 999,
            padding: "2px 10px",
            fontWeight: 600,
          }}
        >
          💸 API spend: ₹{apiSpend.all_time_inr.toLocaleString("en-IN")} (${apiSpend.all_time_usd}) · {apiSpend.all_time_calls} calls
        </span>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 0,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <SubNav id={id} active="overview" />
        </div>
        <div style={{ paddingBottom: 8 }}>
          <PreSessionBrief
            client={client}
            clientId={id}
            sessions={sessionSummaries}
            activePlanSlug={publishedPlan?.slug}
            activePlanStart={publishedPlan?.plan_period_start}
            activePlanRecheck={publishedPlan?.plan_period_recheck_date}
          />
        </div>
      </div>

      {client.rework_suggestion && (
        <div style={{ marginBottom: 16 }}>
          <ReworkBanner
            clientId={id}
            suggestion={client.rework_suggestion}
          />
        </div>
      )}

      {/* 📅 Booking-due banner — surfaces when this client is ≥12 days
          since their last session OR plan_period_recheck_date is overdue.
          Same scanner the dashboard's bulk panel uses; per-client view
          gives a one-click route to the booking picker with the
          recommended event type pre-selected. Renders null when not
          due, so most pageviews see nothing. */}
      <BookingDueBanner
        clientId={id}
        clientYaml={client as unknown as Record<string, unknown>}
        plansForClient={plansForClient as unknown as Array<Record<string, unknown>>}
        todayStr={todayStr}
      />

      <ClientBookingsPanel rows={clientBookings} />

      <ClientQuickChatPanel
        clientId={client.client_id}
        clientName={client.display_name ?? client.client_id}
      />

      <HandoutDripPanel clientId={client.client_id} />

      <div className="fm-two-col">
        {/* LEFT COLUMN */}
        <div style={{ display: "grid", gap: 16, minWidth: 0 }}>
          <FmPanel title="Clinical summary">
            <div style={{ display: "grid", gap: 0 }}>
              <FmInfoRow
                label="Active conditions"
                value={
                  conditionChips.length > 0 ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {conditionChips.map((c) => (
                        <FmChip key={c} outline>
                          {c}
                        </FmChip>
                      ))}
                    </div>
                  ) : (
                    "—"
                  )
                }
              />
              <FmInfoRow
                label="Medical history"
                value={
                  (client.medical_history ?? []).length > 0
                    ? (client.medical_history ?? []).join("; ")
                    : "—"
                }
              />
              <FmInfoRow
                label="Goals"
                value={
                  (client.goals ?? []).length > 0
                    ? (client.goals ?? []).join(" · ")
                    : "—"
                }
              />
              <FmInfoRow
                label="Sessions"
                value={`${sessions.length} (last: ${lastSessionDate ?? "—"})`}
              />
            </div>
          </FmPanel>

          {/* Drug-nutrient depletion banner — only shows if meds match catalogue */}
          {depletionRows.length > 0 && (
            <FmDepletionBanner rows={depletionRows} />
          )}

          <FmBodyCompGrid
            metrics={bodyComp}
            clientId={client.client_id}
            snapshots={bodyCompSnapshots}
            prefill={(() => {
              // Pre-fill the "+ Log entry" form from the canonical
              // measurements block. (The old code read flat client.*
              // fields — height_cm, weight_now_kg, … — which are never
              // persisted, so the form always opened empty.)
              const m = (client.measurements ?? {}) as Record<
                string,
                number | undefined
              >;
              return {
                height_cm: m.height_cm ?? null,
                weight_kg: m.weight_kg ?? null,
                waist_cm: m.waist_cm ?? null,
                hip_cm: m.hip_cm ?? null,
                blood_pressure_systolic: m.blood_pressure_systolic ?? null,
                blood_pressure_diastolic: m.blood_pressure_diastolic ?? null,
              };
            })()}
            lastEntryDate={
              // Latest entry from EITHER health_snapshots OR
              // measurements_log — both contribute to the trend, so the
              // "Last entry" caption needs to reflect whichever is newer.
              // Previously only checked snapshots, so a fresh Log entry
              // saved to measurements_log wouldn't update the caption.
              (() => {
                const snapDates = (client.health_snapshots ?? [])
                  .filter(
                    (s) =>
                      s.measurements &&
                      Object.keys(s.measurements).length > 0,
                  )
                  .map((s) => s.date);
                const logDates = (
                  (client as unknown as {
                    measurements_log?: Array<{ date?: string }>;
                  }).measurements_log ?? []
                )
                  .map((e) => e.date)
                  .filter((d): d is string => typeof d === "string");
                const all = [...snapDates, ...logDates].sort();
                return all.pop() ?? undefined;
              })()
            }
          />

          {markerGroups.length > 0 ? (
            <MarkerPanelWithRecompute
              clientId={client.client_id}
              groups={markerGroups}
              subtitle={
                client.lab_markers_date
                  ? `Lab values from ${client.lab_markers_date}. Computed ratios highlighted. Use 🔄 to rebuild from snapshots if anything looks off.`
                  : "Use 🔄 Re-run markers to compute from any uploaded lab snapshots."
              }
            />
          ) : (
            <FmPanel
              title="Functional medicine markers & ratios"
              subtitle="No labs uploaded yet."
            >
              <div
                style={{
                  padding: "24px 16px",
                  textAlign: "center",
                  background: "var(--fm-bg-warm)",
                  border: "2px dashed var(--fm-border)",
                  borderRadius: "var(--fm-radius-md)",
                }}
              >
                <div style={{ fontSize: 24, marginBottom: 8 }}>🧬</div>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
                  No labs uploaded yet
                </div>
                <p
                  style={{
                    fontSize: 12,
                    color: "var(--fm-text-secondary)",
                    margin: "0 auto 14px",
                    maxWidth: 380,
                  }}
                >
                  Upload a lab PDF and we&apos;ll parse markers, compute ratios, and flag
                  out-of-range values.
                </p>
                <Link
                  href={`/clients-v2/${id}/sessions`}
                  style={{
                    display: "inline-block",
                    padding: "8px 14px",
                    background: "var(--fm-primary)",
                    color: "#fff",
                    borderRadius: "var(--fm-radius-sm)",
                    fontSize: 12,
                    fontWeight: 600,
                    textDecoration: "none",
                  }}
                >
                  📎 Upload lab PDF
                </Link>
              </div>
            </FmPanel>
          )}

          {/* 🧭 IFM 7-node baseline — rendered from client.ifm_baseline
              (coach / AI functional-medicine mapping). Self-hides when no
              baseline has been captured for this client. */}
          <IfmBaselineCard
            baseline={
              (client as unknown as { ifm_baseline?: IfmBaseline })
                .ifm_baseline ?? null
            }
          />

          {/* 🩸 Coach-owned menstrual-cycle dates — self-hides unless the
              client is menstruating / perimenopausal. Foundation for the
              cycle-aware test recommender. */}
          <CycleTrackingPanel
            clientId={client.client_id}
            cycleStatus={client.cycle_status}
            lastMenstrualPeriod={client.last_menstrual_period}
            lastPeriodEndDate={client.last_period_end_date}
            cycleLengthDays={client.cycle_length_days}
            cycleRegularity={client.cycle_regularity}
            lastCycleAskSent={client.last_cycle_ask_sent}
            sex={client.sex as string | undefined}
            ageYears={derivedAge(client)}
            menstrualNotes={(client as unknown as { menstrual_notes?: string }).menstrual_notes}
          />
        </div>

        {/* RIGHT COLUMN */}
        <div style={{ display: "grid", gap: 16, minWidth: 0 }}>
          {/* ── Wave J 2026-05-20: right rail re-architected from 11
              stacked panels into 4 grouped panels. FmGroupedPanel gives
              each group an eyebrow title + (where tabbed) a pill tab
              strip; the active child keeps its own native card chrome.
              Tab choice persists per-group in sessionStorage. ── */}

          {/* 🔬 Labs panel. Two variants, mutually exclusive:
              - If there's an active (published) plan: show the plan's
                upcoming retest labs ("New labs to be ordered"). Calm
                read-only until a due date is ≤2 days away, then amber
                actionable.
              - Otherwise (pre-plan onboarding): show the Discovery labs
                send card so coach can email/WhatsApp the discovery lab
                list to the client.
              Coach asked 2026-05-23: showing Discovery labs forever on
              an active-plan client is wrong — they were already ordered;
              the relevant question is "what retest is next?". */}
          {/* Demoted to a quiet collapsible pill (coach 2026-06-13): the
              labs panel is a signal, not a primary surface. Auto-opens when
              there's a discovery list pending to send (actionable); the
              calm active-plan "next retest" reminder stays collapsed until
              the coach expands it. */}
          {(publishedPlan || latestDiscoveryWithLabs) && (
            <StageGate
              demoted
              initialOpen={!publishedPlan && !!latestDiscoveryWithLabs}
              label={publishedPlan ? "🔬 Labs — upcoming retest schedule" : "🔬 Labs — discovery list to send"}
              storageKey={`fm.stagegate.labs.${client.client_id ?? id}`}
            >
              {publishedPlan ? (
                <OverviewPlanLabsCard plan={publishedPlan} today={todayStr} />
              ) : (
                latestDiscoveryWithLabs && (
                  <OverviewSendLabsCard
                    clientId={client.client_id}
                    sessionId={latestDiscoveryWithLabs.sessionId}
                    labCount={latestDiscoveryWithLabs.labs.length}
                    clientEmail={(client as unknown as { email?: string | null }).email ?? null}
                    discoveryDateLabel={
                      latestDiscoveryWithLabs.date
                        ? formatLongDate(latestDiscoveryWithLabs.date)
                        : null
                    }
                    lastSentAt={lastLabsSentAt}
                  />
                )
              )}
            </StageGate>
          )}

          {/* 📲 App-tools pointer removed (coach 2026-06-13): redundant with
              the Plan tab already in the subnav; app tools live there since
              the Plan & App studio (Option A, 2026-06-12). */}

          {/* 🧩 Plan modules — the optional layers to weave into this client's
              plan (Ayurveda, meal-plan type, Schüssler's salts, peptides, …).
              Surfaced high on Overview so nothing is missed when authoring. */}
          <FmGroupedPanel
            id="overview.plan-modules"
            icon="🧩"
            title="Plan modules"
          >
            <PlanModulesPanel
              clientId={client.client_id}
              ayurvedaEnabled={(client as unknown as { ayurveda_enabled?: boolean }).ayurveda_enabled}
              ayurvedaConstitution={(client as unknown as { ayurveda_constitution?: string }).ayurveda_constitution}
              ayurvedaAssessment={(client as unknown as { ayurveda_assessment?: Record<string, unknown> | null }).ayurveda_assessment}
              mealPlanStyle={(client as unknown as { meal_plan_style?: "detailed" | "principles" | "hybrid" }).meal_plan_style}
              planModules={(client as unknown as { plan_modules?: string[] }).plan_modules}
            />
          </FmGroupedPanel>

          {(eftPrescribed || sleepPrescribed) && (
            <FmGroupedPanel id="overview.mindbody" icon="🌿" title="Mind-body — drip unlock">
              {eftPrescribed && (
                <MindbodyDripPanel
                  clientId={client.client_id}
                  technique="eft"
                  blurb="EFT tapping unlocks once breathing is a habit. Override the pace for this client."
                  initial={mindbodyEft}
                />
              )}
              {sleepPrescribed && (
                <div style={{ marginTop: eftPrescribed ? 14 : 0 }}>
                  <MindbodyDripPanel
                    clientId={client.client_id}
                    technique="sleep"
                    blurb="Sleep wind-down unlocks once the prior technique is a habit. Override the pace for this client."
                    initial={mindbodySleep}
                  />
                </div>
              )}
            </FmGroupedPanel>
          )}

          {/* 📋 Intake — progress / insights / send & unlock / coach exam.
              Demoted to a quiet pill once a plan is published (intake is
              done by then); one click re-opens, nothing removed. */}
          <StageGate
            demoted={!!publishedPlan}
            label="📋 Intake tools — from before this client's plan"
            storageKey={`fm.stagegate.intake.${client.client_id ?? id}`}
          >
          <FmGroupedPanel
            id="overview.intake"
            icon="📋"
            title="Intake"
            tabs={[
              {
                id: "progress",
                label: "Progress",
                content: (
                            <IntakeProgressCard
                              clientId={client.client_id}
                              firstName={(client.display_name ?? client.client_id).split(" ")[0]}
                              intakeToken={
                                (client as unknown as { intake_token?: string | null }).intake_token
                              }
                              intakeTokenExpiresAt={
                                (client as unknown as { intake_token_expires_at?: string | null })
                                  .intake_token_expires_at
                              }
                              intakeFirstOpenedAt={
                                (client as unknown as { intake_first_opened_at?: string | null })
                                  .intake_first_opened_at
                              }
                              intakeFormDraft={
                                (client as unknown as { intake_form_draft?: Record<string, unknown> | null })
                                  .intake_form_draft
                              }
                              intakeFormDraftSavedAt={
                                (client as unknown as { intake_form_draft_saved_at?: string | null })
                                  .intake_form_draft_saved_at
                              }
                              intakeSubmittedAt={
                                (client as unknown as { intake_submitted_at?: string | null })
                                  .intake_submitted_at
                              }
                              intakeLastSubmittedAt={
                                (client as unknown as { intake_last_submitted_at?: string | null })
                                  .intake_last_submitted_at
                              }
                              intakeFinalisedAt={
                                (client as unknown as { intake_finalised_at?: string | null })
                                  .intake_finalised_at
                              }
                              intakeRemindersSentAt={
                                (client as unknown as { intake_reminders_sent_at?: string[] | null })
                                  .intake_reminders_sent_at
                              }
                              intakeFullUnlockedAt={
                                (client as unknown as { intake_full_unlocked_at?: string | null })
                                  .intake_full_unlocked_at
                              }
                              intakeInsightsGeneratedAt={
                                (
                                  client as unknown as {
                                    intake_insights?: { generated_at?: string | null } | null;
                                  }
                                ).intake_insights?.generated_at ?? null
                              }
                            />
                ),
              },
              {
                id: "insights",
                label: "Insights",
                content: (
                  <div style={{ display: "grid", gap: 12 }}>
                    {/* Coach feedback 2026-05-24: Section 11 (Tier 1 — Beighton,
                        NASA lean, PEM, mould) was removed from the default
                        intake. Detection now happens here — when the submitted
                        intake has triggering signals, flash an advisory with a
                        one-click "Reissue Tier 1" button (fires the existing
                        fm_intake_topup_v1 template). Self-hides cleanly when
                        no signals OR when client already filled Tier 1. */}
                    <Tier1AdvisoryCard
                      clientId={client.client_id}
                      advisory={detectTier1Advisory(client as unknown as Record<string, unknown>)}
                    />
                            <IntakeInsightsCard
                              clientId={client.client_id}
                              initial={intakeInsights}
                              submittedAt={
                                (client as unknown as { intake_submitted_at?: string })
                                  .intake_submitted_at ?? null
                              }
                            />
                  </div>
                ),
              },
              {
                id: "send",
                label: "Send & unlock",
                content: (
                  <div style={{ display: "grid", gap: 12 }}>
                              <SendIntakeFormButton
                                clientId={client.client_id}
                                mobileNumber={
                                  (client as unknown as { mobile_number?: string }).mobile_number
                                }
                                displayName={
                                  (client as unknown as { display_name?: string }).display_name
                                }
                                existingToken={
                                  (client as unknown as { intake_token?: string }).intake_token
                                }
                                existingExpiresAt={
                                  (client as unknown as { intake_token_expires_at?: string })
                                    .intake_token_expires_at
                                }
                                submittedAt={
                                  (client as unknown as { intake_submitted_at?: string })
                                    .intake_submitted_at
                                }
                                lastSubmittedAt={
                                  (client as unknown as { intake_last_submitted_at?: string })
                                    .intake_last_submitted_at
                                }
                                finalisedAt={
                                  (client as unknown as { intake_finalised_at?: string })
                                    .intake_finalised_at
                                }
                                lastIntakeSentAt={lastIntakeSentAt}
                              />
                              <UnlockFullIntakeButton
                                clientId={client.client_id}
                                intakeSubmittedAt={
                                  (client as unknown as { intake_submitted_at?: string | null })
                                    .intake_submitted_at
                                }
                                intakeFullUnlockedAt={
                                  (client as unknown as { intake_full_unlocked_at?: string | null })
                                    .intake_full_unlocked_at
                                }
                                intakeFinalisedAt={
                                  (client as unknown as { intake_finalised_at?: string | null })
                                    .intake_finalised_at ?? null
                                }
                                engagementStatus={
                                  (client as unknown as { engagement_status?: string | null })
                                    .engagement_status ?? null
                                }
                                intakeInsightsGeneratedAt={
                                  (
                                    client as unknown as {
                                      intake_insights?: { generated_at?: string | null } | null;
                                    }
                                  ).intake_insights?.generated_at ?? null
                                }
                                lastUnlockNotifyAt={lastUnlockNotifyAt}
                              />
                  </div>
                ),
              },
              {
                id: "exam",
                label: "Coach exam",
                content: (
                  (() => {
                              const c2 = client as unknown as {
                                physical_exam_findings?: Array<{
                                  kind: string;
                                  assessed_at: string;
                                  result?: Record<string, unknown>;
                                }>;
                                lean_test_supine_hr?: string;
                                lean_test_standing_hr?: string;
                                lean_test_symptoms?: string[];
                                beighton_self_score?: string[];
                                date_of_birth?: string;
                              };
                              const findings = c2.physical_exam_findings ?? [];
                              const latestOf = (kind: string) =>
                                findings
                                  .filter((f) => f.kind === kind)
                                  .sort((a, b) => (b.assessed_at ?? "").localeCompare(a.assessed_at ?? ""))[0];
                              const latestLean = latestOf("nasa_lean_test");
                              const latestBeighton = latestOf("beighton");
                              const leanDelta = latestLean?.result?.delta_hr as number | undefined;
                              const leanPots = latestLean?.result?.pots_pattern as boolean | undefined;
                              const beightonScore = latestBeighton?.result?.score as number | undefined;
                              const ageYears = c2.date_of_birth
                                ? Math.floor(
                                    (Date.now() - new Date(c2.date_of_birth).getTime()) /
                                      (365.25 * 24 * 3600 * 1000),
                                  )
                                : null;
                              // Default-collapse the three coach physical-exam panels under
                              // a single `<details>` disclosure 2026-05-20. For most client
                              // views these are advanced / situational — surfacing them all
                              // at full height stacked ~600px of mostly-empty cards above
                              // the fold. Coach opens the disclosure when she's actually
                              // doing a Tier-1 / orthostatic exam. Existing test-result
                              // captions inside each panel stay intact when open.
                              const inference = computeSuspectedSignals(
                                client as unknown as Record<string, unknown>,
                              );
                              const hasSavedExamData = !!(
                                latestLean ||
                                latestBeighton ||
                                (inference.suspicions && inference.suspicions.length > 0)
                              );
                              return (
                                <details
                                  open={hasSavedExamData}
                                  style={{
                                    background: "var(--fm-surface)",
                                    border: "1px solid var(--fm-border-light)",
                                    borderRadius: "var(--fm-radius-md)",
                                    padding: "10px 14px",
                                  }}
                                >
                                  <summary
                                    style={{
                                      cursor: "pointer",
                                      fontSize: 12,
                                      fontWeight: 700,
                                      color: "var(--fm-text-secondary)",
                                      listStyle: "none",
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 8,
                                    }}
                                  >
                                    <span>▾ Coach physical exam</span>
                                    <span
                                      style={{
                                        fontSize: 11,
                                        fontWeight: 500,
                                        color: "var(--fm-text-tertiary)",
                                      }}
                                    >
                                      NASA lean · Beighton · Tier-1 suspicions
                                      {hasSavedExamData ? " — data on file" : ""}
                                    </span>
                                  </summary>
                                  <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                                    <NasaLeanTestPanel
                                      clientId={client.client_id}
                                      selfReportSupineHr={c2.lean_test_supine_hr}
                                      selfReportStandingHr={c2.lean_test_standing_hr}
                                      selfReportSymptoms={c2.lean_test_symptoms}
                                      latestSavedAt={latestLean?.assessed_at}
                                      latestDeltaHr={leanDelta}
                                      latestPotsFlag={leanPots}
                                    />
                                    <BeightonVerifyPanel
                                      clientId={client.client_id}
                                      selfReportTicks={c2.beighton_self_score}
                                      latestSavedAt={latestBeighton?.assessed_at}
                                      latestScore={beightonScore}
                                      ageYears={ageYears}
                                    />
                                    {/* v0.75.7 — retrospective Tier 1 suspicions for legacy
                                        clients (submitted pre-v0.75.2). Deterministic
                                        inference, zero API cost. Hides when client has
                                        structured Tier 1 data OR no suspicions inferred. */}
                                    <TierOneSuspicionsPanel
                                      clientId={client.client_id}
                                      suspicions={inference.suspicions}
                                      hasStructuredTierOne={inference.has_structured_tier_one}
                                    />
                                  </div>
                                </details>
                              );
                            })()
                ),
              },
            ]}
          />
          </StageGate>

          {/* 🌿 Client state — five pillars / weight loss / memory */}
          <FmGroupedPanel
            id="overview.state"
            icon="🌿"
            title="Client state"
            tabs={[
              {
                id: "pillars",
                label: "Five Pillars",
                content: (
                            <FmFivePillarsWithSendCheckIn
                              latest={latestPillars ?? null}
                              latestSessionAt={pillarsDate ?? null}
                              derived={derivedFivePillars}
                              daysSinceLastEntry={daysSincePillars}
                              clientId={id}
                            />
                ),
              },
              {
                id: "weight",
                label: "Weight loss",
                content: (
                          <div className="space-y-3">
                            {/* Readiness gate (#4) — metabolic/hormonal
                                blockers that make a deficit fail (thyroid,
                                insulin, weight-gain meds, sleep/stress,
                                perimenopause). Shown only when a goal exists. */}
                            {Boolean(
                              (client as unknown as { weight_loss?: { enabled?: boolean } })
                                .weight_loss,
                            ) &&
                              (client as unknown as { weight_loss?: { enabled?: boolean } })
                                .weight_loss?.enabled !== false && (
                                <WeightLossReadinessPanel
                                  client={client as unknown as Parameters<typeof WeightLossReadinessPanel>[0]["client"]}
                                />
                              )}
                            {/* Verdict banner — on-track / behind / plateau /
                                regain / overdue weigh-in + one-click rework.
                                Hides itself when there's no goal. Unions all
                                three weigh-in sources (app, log, flat). */}
                            <WeightProgressPanel
                              clientId={client.client_id}
                              result={assessWeightProgress(
                                client as unknown as Parameters<typeof assessWeightProgress>[0],
                              )}
                              tdee={estimateObservedTdee(
                                client as unknown as Parameters<typeof estimateObservedTdee>[0],
                              )}
                            />
                            <WeightLossCard
                              clientId={client.client_id}
                              goal={
                                (client as unknown as { weight_loss?: WeightLossGoal })
                                  .weight_loss
                              }
                              measurementsLog={
                                (client as unknown as {
                                  measurements_log?: MeasurementEntry[];
                                }).measurements_log
                              }
                              currentWeightKg={
                                (client as unknown as { weight_now_kg?: number | null })
                                  .weight_now_kg ??
                                (client as unknown as { measurements?: { weight_kg?: number | null } })
                                  .measurements?.weight_kg ??
                                null
                              }
                              caloriePhases={computeCaloriePhases(
                                client as unknown as Parameters<typeof computeCaloriePhases>[0],
                                (client as unknown as { weight_loss?: WeightLossGoal })
                                  .weight_loss,
                              )}
                            />
                          </div>
                ),
              },
              {
                id: "memory",
                label: "Memory",
                content: (
                          <div className="space-y-3">
                            <SupplementCheckWidget clientId={client.client_id} />
                            <ClientMemoryPanel
                              clientId={client.client_id}
                              initial={{
                                dietary_preference: (client as unknown as { dietary_preference?: string }).dietary_preference,
                                animal_derived_supplements_ok: (client as unknown as { animal_derived_supplements_ok?: string }).animal_derived_supplements_ok,
                                foods_to_avoid: (client as unknown as { foods_to_avoid?: string }).foods_to_avoid,
                                non_negotiables: (client as unknown as { non_negotiables?: string }).non_negotiables,
                                reported_triggers: (client as unknown as { reported_triggers?: string }).reported_triggers,
                                family_history: (client as unknown as { family_history?: string }).family_history,
                                meal_plan_style: (
                                  client as unknown as {
                                    meal_plan_style?: "detailed" | "principles" | "hybrid";
                                  }
                                ).meal_plan_style,
                              }}
                              lastUpdatedAt={(client as unknown as { updated_at?: string }).updated_at}
                            />
                          </div>
                ),
              },
            ]}
          />

          {/* 📞 Contact & engagement — plain stack, no tabs */}
          <FmGroupedPanel id="overview.contact" icon="📞" title="Contact & engagement">
                      <FmContactPanel pinned={pinned} more={more} />
                      {hasAnyJourneySignal && (
                        <div
                          style={{
                            padding: "10px 12px",
                            background: "var(--fm-surface)",
                            border: "1px solid var(--fm-border-light)",
                            borderRadius: "var(--fm-radius-md)",
                            display: "grid",
                            gap: 6,
                          }}
                        >
                          <div
                            style={{
                              fontSize: 11,
                              fontWeight: 700,
                              textTransform: "uppercase",
                              letterSpacing: 0.6,
                              color: "var(--fm-text-tertiary)",
                            }}
                          >
                            Sign-up status
                          </div>
                          <EngagementPicker
                            clientId={client.client_id}
                            current={engagement}
                          />
                        </div>
                      )}
          </FmGroupedPanel>

          {/* ⚠ Clinical flags — meds + allergies. Each already hides
              itself when empty (Wave F.8); kept as standalone
              conditional panels rather than a forced group. */}
                    {medList.length > 0 && (
                      <FmPanel title="Active medications">
                        <div style={{ display: "grid", gap: 4 }}>
                          {medList.map((m, i) => (
                            <div
                              key={i}
                              style={{
                                fontSize: 13,
                                padding: "5px 0",
                                borderBottom:
                                  i < medList.length - 1
                                    ? "1px dashed var(--fm-border-light)"
                                    : "none",
                              }}
                            >
                              {m}
                            </div>
                          ))}
                        </div>
                      </FmPanel>
                    )}
                    {(() => {
                      const showsContext =
                        !!mthfrSummary ||
                        (client.pregnancy_status &&
                          client.pregnancy_status !== "not_applicable" &&
                          client.pregnancy_status !== "not_pregnant") ||
                        !!client.lactation_started;
                      if (allergyChips.length === 0 && !showsContext) return null;
                      return (
                        <FmPanel title="Allergies & flags">
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                            {allergyChips.map((a) => (
                              <FmChip key={a} tone="warning">
                                {a}
                              </FmChip>
                            ))}
                            {mthfrSummary && (
                              <FmChip tone="secondary">MTHFR {mthfrSummary}</FmChip>
                            )}
                            {client.pregnancy_status &&
                              client.pregnancy_status !== "not_applicable" &&
                              client.pregnancy_status !== "not_pregnant" && (
                                <FmChip tone="primary">
                                  {client.pregnancy_status.replace(/_/g, " ")}
                                </FmChip>
                              )}
                            {client.lactation_started && (
                              <FmChip tone="primary">lactating</FmChip>
                            )}
                          </div>
                        </FmPanel>
                      );
                    })()}
                    {/* Drug-nutrient depletions for current meds +
                        pregnancy/lactation supplement-safety flags. Both
                        self-hide when nothing applies. Re-wired here
                        during the main→v2 merge audit — the components
                        survived the v1→v2 migration but lost their page
                        wiring (PRs #33 + #36). */}
                    <MedicationImpactPanel clientId={id} />
                    <PregnancySafetyPanel clientId={id} />
        </div>
      </div>

      {/* SOAP notes — full-width below the two columns. Auto-generated
          from the latest session's data; coach can edit + persist. */}
      <div style={{ marginTop: 24 }}>
        <SOAPNotePanel
          client={client as unknown as Record<string, unknown>}
          clientName={client.display_name ?? client.client_id}
          clientId={id}
          sessions={sessionSummaries}
        />
      </div>
    </FmAppShell>
  );
}

function QuickActionLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "7px 12px",
        background: "var(--fm-surface)",
        color: "var(--fm-text-primary)",
        border: "1px solid var(--fm-border)",
        borderRadius: "var(--fm-radius-sm)",
        fontSize: 12,
        fontWeight: 600,
        textDecoration: "none",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </Link>
  );
}

function SubNav({ id, active }: { id: string; active: string }) {
  const tabs = clientSubnavTabs(id);
  return (
    <div
      style={{
        display: "flex",
        gap: 4,
        marginBottom: 20,
        borderBottom: "1px solid var(--fm-border)",
        overflowX: "auto",
        WebkitOverflowScrolling: "touch" as React.CSSProperties["WebkitOverflowScrolling"],
        scrollbarWidth: "none",
        msOverflowStyle: "none",
      } as React.CSSProperties}
    >
      {tabs.map((t) => (
        <Link
          key={t.id}
          href={t.href}
          style={{
            padding: "9px 16px",
            fontSize: 13,
            fontWeight: t.id === active ? 700 : 500,
            color:
              t.id === active ? "var(--fm-text-primary)" : "var(--fm-text-tertiary)",
            borderBottom: `2px solid ${t.id === active ? "var(--fm-primary)" : "transparent"}`,
            textDecoration: "none",
            marginBottom: -1,
            // Keep each tab at its natural width and let the strip scroll
            // horizontally (overflowX:auto above) instead of letting the
            // labels squish/wrap on narrow screens.
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
