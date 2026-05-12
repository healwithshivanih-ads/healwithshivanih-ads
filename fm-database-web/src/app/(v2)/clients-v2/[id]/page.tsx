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
  loadClientSessions,
  type ClientWithMeta,
  type ClientSession,
} from "@/lib/fmdb/loader-extras";
import { loadAllPlans } from "@/lib/fmdb/loader";
import { checkMedicationImpactsAction } from "@/app/clients/actions";
import {
  FmAppShell,
  FmClientHeader,
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
import { SOAPNotePanel } from "@/app/clients/[id]/soap-note-panel";
import { loadClientSessionsAction } from "@/app/assess/actions";

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

function deriveStage(plans: PlanRow[], todayStr: string): {
  stage: FmWorkflowStage;
  title: React.ReactNode;
  detail?: React.ReactNode;
  cta?: React.ReactNode;
} {
  const active = plans.filter((p) => ACTIVE_BUCKETS.has(p._bucket ?? p.status ?? ""));
  if (active.length === 0) {
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
        detail: `Protocol ended ${recheckDate} · order recheck panel.`,
        cta: "Time for new session",
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

  const [client, sessions, allPlans, sessionSummaries] = await Promise.all([
    loadClientById(id),
    loadClientSessions(id),
    loadAllPlans(),
    loadClientSessionsAction(id),
  ]);

  if (!client) notFound();

  const plansForClient = (allPlans as unknown as PlanRow[]).filter(
    (p) => p.client_id === id,
  );

  // Workflow stage
  const stageInfo = deriveStage(plansForClient, todayStr);

  // Last session date
  const sortedSessions = [...sessions].sort((a, b) =>
    (a.date ?? "").localeCompare(b.date ?? ""),
  );
  const lastSessionDate = sortedSessions[sortedSessions.length - 1]?.date;
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

  // Body comp
  const bodyComp = buildBodyCompMetrics(
    client.health_snapshots ?? [],
    client.measurements,
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
      crumbs={[
        { label: "Clients", href: "/clients" },
        { label: client.display_name ?? client.client_id },
      ]}
    >
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
            ? `/clients/${id}?tab=sessions`
            : stageInfo.stage === "draft"
              ? `/plans/${plansForClient.find((p) => (p._bucket ?? p.status) !== "published")?.slug ?? ""}`
              : stageInfo.stage === "active"
                ? `/plans/${plansForClient.find((p) => (p._bucket ?? p.status) === "published")?.slug ?? ""}`
                : `/clients/${id}?tab=sessions`
        }
        quickActions={
          <>
            <QuickActionLink href={`/clients/${id}?tab=sessions`}>
              📝 Record session
            </QuickActionLink>
            <QuickActionLink href={`/clients/${id}?tab=plan`}>
              💬 Send message
            </QuickActionLink>
            <QuickActionLink href={`/clients/${id}?tab=plan`}>
              📊 View plan
            </QuickActionLink>
          </>
        }
      />

      <SubNav id={id} active="overview" />

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
            lastEntryDate={
              // Latest snapshot by DATE (not array order) — snapshots are
              // appended over time but the YAML order isn't guaranteed
              // chronological. Only count snapshots that actually carry
              // measurements; lab-only snapshots aren't body-comp entries.
              (client.health_snapshots ?? [])
                .filter((s) => s.measurements && Object.keys(s.measurements).length > 0)
                .map((s) => s.date)
                .sort()
                .pop() ?? undefined
            }
          />

          {markerGroups.length > 0 ? (
            <FmMarkerPanel
              groups={markerGroups}
              subtitle={
                client.lab_markers_date
                  ? `Lab values from ${client.lab_markers_date}. Computed ratios highlighted.`
                  : undefined
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
                  href={`/clients/${id}?tab=sessions`}
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
          <FmContactPanel pinned={pinned} more={more} />

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
  const tabs = [
    { id: "overview", label: "Overview", href: `/clients-v2/${id}` },
    { id: "analyse", label: "Analyse", href: `/clients-v2/${id}/analyse` },
    { id: "plan", label: "Plan", href: `/clients/${id}?tab=plan` },
    { id: "communicate", label: "Communicate", href: `/clients/${id}?tab=plan` },
    { id: "catalogue", label: "Catalogue", href: "/catalogue" },
  ];
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
