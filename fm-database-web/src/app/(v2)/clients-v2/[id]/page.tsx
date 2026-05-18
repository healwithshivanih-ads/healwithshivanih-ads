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
import { SendIntakeFormButton } from "./send-intake-form-button";
import { IntakeInsightsCard } from "./intake-insights-card";
import { IntakeProgressCard } from "./intake-progress-card";
import { loadIntakeInsights } from "@/lib/server-actions/intake-insights";
import { EngagementPicker } from "./engagement-picker";
import { UnlockFullIntakeButton } from "./unlock-full-intake-button";
import { NasaLeanTestPanel } from "./nasa-lean-test-panel";
import { BeightonVerifyPanel } from "./beighton-verify-panel";
import { TierOneSuspicionsPanel } from "./tier-one-suspicions-panel";
import { computeSuspectedSignals } from "@/lib/fmdb/retrospective-tier1";
import { ClientMemoryPanel } from "./client-memory-panel";
import { parseSessionType } from "@/lib/fmdb/session-utils";
import {
  FmAppShell,
  FmClientHeader,
  FmClientJourneyStrip,
  FmContactPanel,
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
} from "@/components/fm";
import { FmFivePillarsWithSendCheckIn } from "./five-pillars-bridge";
import { MemoryPanel } from "./memory-panel";
import { SOAPNotePanel } from "@/components/client-widgets/soap-note-panel";
import { ReworkBanner } from "@/components/client-widgets/rework-banner";
import { BookingDueBanner } from "@/components/client-widgets/booking-due-banner";
import { ClientBookingsPanel } from "@/components/client-widgets/client-bookings-panel";
import { PreSessionBrief } from "@/components/client-widgets/pre-session-brief";
import { loadClientSessionsAction } from "@/lib/server-actions/assess";
import { clientQuickActions } from "./client-quick-actions";
import { clientSubnavTabs } from "./client-subnav";
import { MarkerPanelWithRecompute } from "./marker-panel-with-recompute";

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

  const weight = series("weight_kg");
  const height = series("height_cm");
  const bmi: number[] = weight.length
    ? weight.map((w, i) => {
        const h = height[i] ?? height[0];
        if (!h) return NaN;
        const m = h / 100;
        return w / (m * m);
      })
    : [];

  return [
    { label: "Weight", unit: "kg", series: weight, goalDirection: "down" },
    {
      label: "BMI",
      unit: "",
      series: bmi.filter((v) => !Number.isNaN(v)),
      goalDirection: "down",
    },
    { label: "Waist", unit: "cm", series: series("waist_cm"), goalDirection: "down" },
    { label: "Hip", unit: "cm", series: series("hip_cm"), goalDirection: "neutral" },
    { label: "BP (sys)", unit: "", series: series("bp_systolic"), goalDirection: "down" },
    { label: "BP (dia)", unit: "", series: series("bp_diastolic"), goalDirection: "down" },
    { label: "Resting HR", unit: "bpm", series: series("hr_bpm"), goalDirection: "down" },
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
  const engagementRaw = (client as unknown as { engagement_status?: string }).engagement_status;
  const engagement =
    engagementRaw === "signed_up" || engagementRaw === "declined" || engagementRaw === "pending"
      ? (engagementRaw as "signed_up" | "declined" | "pending")
      : undefined;

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

  // Drug-nutrient depletions
  const meds = [
    ...(client.current_medications ?? []),
    ...(((client as unknown as { medications?: string[] }).medications) ?? []),
  ];
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

  return (
    <FmAppShell
      activeNavId="clients"
      quickActions={clientQuickActions(client.client_id)}
      crumbs={[
        { label: "Clients", href: "/clients" },
        { label: client.display_name ?? client.client_id },
      ]}
    >
      <FmClientJourneyStrip journey={journey} />

      {/* Sign-up callout — only when discovery is done AND the coach
          hasn't yet marked the client as signed_up or declined. Helps
          surface the "did they sign up?" decision so it doesn't fall
          through the cracks before intake. */}
      {hasDiscoverySession && engagement !== "signed_up" && engagement !== "declined" && (
        <div style={{ marginBottom: 12 }}>
          <EngagementPicker
            clientId={client.client_id}
            current={engagement}
            callout
          />
        </div>
      )}

      <FmClientHeader
        clientId={client.client_id}
        displayName={client.display_name ?? client.client_id}
        age={age}
        lastSessionDate={lastSessionDate}
        photoUrl={client.photo_filename ? `/api/client-photo/${client.client_id}` : null}
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
                ? `/clients-v2/${id}/plan/edit/${plansForClient.find((p) => (p._bucket ?? p.status) === "published")?.slug ?? ""}`
                : stageInfo.stage === "recheck"
                  ? `/clients-v2/${id}/plan#follow-up-panel`
                  : `/clients-v2/${id}/analyse`
        }
        quickActions={
          <>
            {/* "Record session" → /analyse, the v2 Sessions tab which
                hosts the recording forms (discovery / pre-intake / full
                assess / check-in / quick-note). The /sessions route is
                the read-only Timeline view — it's labelled "Timeline"
                in the subnav and shouldn't be the destination of a
                "Record" action. (Subnav route↔label is the confusingly
                inverted one: route `/analyse` = label "Sessions",
                route `/sessions` = label "Timeline".) */}
            <QuickActionLink href={`/clients-v2/${id}/analyse`}>
              📝 Record session
            </QuickActionLink>
            <QuickActionLink href={`/clients-v2/${id}/communicate`}>
              💬 Send message
            </QuickActionLink>
            <QuickActionLink href={`/clients-v2/${id}/plan`}>
              📊 View plan
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

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 2fr) minmax(280px, 1fr)",
          gap: 24,
        }}
      >
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
            prefill={{
              height_cm:
                (client as unknown as { height_cm?: number }).height_cm ?? null,
              weight_kg:
                (client as unknown as { weight_now_kg?: number }).weight_now_kg ?? null,
              waist_cm:
                (client as unknown as { waist_cm?: number }).waist_cm ?? null,
              hip_cm:
                (client as unknown as { hip_cm?: number }).hip_cm ?? null,
              blood_pressure_systolic:
                (client as unknown as { bp_systolic?: number }).bp_systolic ?? null,
              blood_pressure_diastolic:
                (client as unknown as { bp_diastolic?: number }).bp_diastolic ?? null,
            }}
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
        </div>

        {/* RIGHT COLUMN */}
        <div style={{ display: "grid", gap: 16, minWidth: 0 }}>
          {/* 📝 Intake form progress — at-a-glance lifecycle status:
              has the client opened the link? started filling? submitted?
              Sits ABOVE IntakeInsightsCard because the insights card only
              renders meaningful state AFTER submit; the coach needs to
              see "still not opened" / "in progress / 12 fields filled" /
              etc. while the intake is in flight. */}
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
          />

          {/* 📋 Intake insights — Haiku-summarised view of the structured
              intake. Always rendered (states: no-intake / submitted-no-AI /
              full insights). Sits ABOVE FmContactPanel so it's the first
              thing the coach sees in the right column. */}
          <IntakeInsightsCard
            clientId={client.client_id}
            initial={intakeInsights}
            submittedAt={
              (client as unknown as { intake_submitted_at?: string })
                .intake_submitted_at ?? null
            }
          />

          <FmContactPanel pinned={pinned} more={more} />

          {/* 📝 Tokenised intake form — coach clicks to generate a one-time
              link, WhatsApps to client, client fills on their phone.
              Submission writes back to client.yaml + appends a tagged
              quick_note session. See send-intake-form-button.tsx. */}
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
          />

          {/* v0.75 two-stage intake — after client submits pre-discovery,
              coach flips the gate here to unlock the full form (same URL,
              client returns to it and the deeper sections appear). */}
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
          />

          {/* v0.75.3 coach-led physical exam panels. Derive latest finding
              per kind + the client's intake self-report so panels can show
              context. Both panels are collapsed by default; coach clicks
              "Start test" / "Verify" to expand. */}
          {(() => {
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
            return (
              <>
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
                {(() => {
                  const inference = computeSuspectedSignals(
                    client as unknown as Record<string, unknown>,
                  );
                  return (
                    <TierOneSuspicionsPanel
                      clientId={client.client_id}
                      suspicions={inference.suspicions}
                      hasStructuredTierOne={inference.has_structured_tier_one}
                    />
                  );
                })()}
              </>
            );
          })()}

          {/* Identity editor moved into FmClientHeader.quickActions so
              it's always visible under the client name. */}

          {/* 🧠 Profile memory — five dietary / lifestyle fields the AI
              learns about the client over time (via plan-chat) and that
              the meal-plan letter respects as hard rules. Coach can
              inline-edit any field. */}
          <ClientMemoryPanel
            clientId={client.client_id}
            initial={{
              dietary_preference: (client as unknown as { dietary_preference?: string }).dietary_preference,
              foods_to_avoid: (client as unknown as { foods_to_avoid?: string }).foods_to_avoid,
              non_negotiables: (client as unknown as { non_negotiables?: string }).non_negotiables,
              reported_triggers: (client as unknown as { reported_triggers?: string }).reported_triggers,
              family_history: (client as unknown as { family_history?: string }).family_history,
            }}
            lastUpdatedAt={(client as unknown as { updated_at?: string }).updated_at}
          />

          {/* Sign-up status pill row — always available so the coach can
              flip the decision later (e.g. client signs up after weeks
              of deliberation). The bigger callout above only renders
              when the decision is unset / pending. */}
          {hasDiscoverySession && (
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
                  fontSize: 10.5,
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

          <FmPanel title="Active medications">
            {medList.length === 0 ? (
              <p
                style={{
                  fontSize: 12,
                  color: "var(--fm-text-tertiary)",
                  fontStyle: "italic",
                  margin: 0,
                }}
              >
                No medications recorded.
              </p>
            ) : (
              <div style={{ display: "grid", gap: 4 }}>
                {medList.map((m, i) => (
                  <div
                    key={i}
                    style={{
                      fontSize: 12.5,
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
            )}
          </FmPanel>

          <FmPanel title="Allergies & flags">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {allergyChips.length === 0 ? (
                <span
                  style={{
                    fontSize: 12,
                    color: "var(--fm-text-tertiary)",
                    fontStyle: "italic",
                  }}
                >
                  None recorded
                </span>
              ) : (
                allergyChips.map((a) => (
                  <FmChip key={a} tone="warning">
                    {a}
                  </FmChip>
                ))
              )}
              {mthfrSummary && <FmChip tone="secondary">MTHFR {mthfrSummary}</FmChip>}
              {client.pregnancy_status &&
                client.pregnancy_status !== "not_applicable" &&
                client.pregnancy_status !== "not_pregnant" && (
                  <FmChip tone="primary">
                    {client.pregnancy_status.replace(/_/g, " ")}
                  </FmChip>
                )}
              {client.lactation_started && <FmChip tone="primary">lactating</FmChip>}
            </div>
          </FmPanel>

          <FmFivePillarsWithSendCheckIn
            latest={latestPillars ?? null}
            daysSinceLastEntry={daysSincePillars}
            clientId={id}
          />

          <MemoryPanel
            dietaryPreference={client.dietary_preference}
            foodsToAvoid={client.foods_to_avoid}
            nonNegotiables={client.non_negotiables}
            reportedTriggers={
              (client as { reported_triggers?: string }).reported_triggers
            }
          />
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
      }}
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
          }}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
