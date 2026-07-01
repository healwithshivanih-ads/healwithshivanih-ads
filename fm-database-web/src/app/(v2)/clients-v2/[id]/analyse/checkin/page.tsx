import { notFound } from "next/navigation";
import { loadAllPlans } from "@/lib/fmdb/loader";
import { loadClientById } from "@/lib/fmdb/loader-extras";
import { latestMeasurements } from "@/lib/fmdb/measurements";
import { FmPageHeader } from "@/components/fm";
import { AnalysePageShell } from "../analyse-page-shell";
import {
  CheckInForm,
  type PreviousMeasurementSnapshot,
} from "./checkin-form";

export const dynamic = "force-dynamic";

interface PlanRow {
  slug: string;
  client_id?: string;
  status?: string;
  _bucket?: string;
  plan_period_recheck_date?: string;
}

const ACTIVE_BUCKETS = new Set(["draft", "ready_to_publish", "published"]);

export default async function CheckInPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [client, allPlans] = await Promise.all([
    loadClientById(id),
    loadAllPlans(),
  ]);
  if (!client) notFound();

  const displayName = client.display_name ?? client.client_id;
  const activePlan =
    (allPlans as unknown as PlanRow[]).find(
      (p) =>
        p.client_id === id &&
        ACTIVE_BUCKETS.has(p._bucket ?? p.status ?? ""),
    ) ?? null;

  // Surface the most recent measurements as read-only context above the
  // input fields on the form. Coach reviews + types new values manually
  // — never auto-extracted from WhatsApp / parsed text. The "safe path"
  // per coach decision 2026-05-18.
  // Priority order: measurements_log (newest first) → latest
  // health_snapshot with any measurements → legacy flat .measurements
  // dict on client.yaml.
  const clientAny = client as Record<string, unknown>;
  // Canonical reader unions all three stores (measurements_log = coach weight
  // editor, health_snapshots = app/labs, flat bio) with field-level merge, so
  // the newest value of each field surfaces regardless of which store it's in.
  const _lm = latestMeasurements(client as Parameters<typeof latestMeasurements>[0]);
  const previousMeasurements: PreviousMeasurementSnapshot | null = _lm
    ? {
        date: _lm.date,
        weight_kg: _lm.measurements.weight_kg,
        waist_cm: _lm.measurements.waist_cm,
        hip_cm: _lm.measurements.hip_cm,
        bp_systolic: _lm.measurements.bp_systolic,
        bp_diastolic: _lm.measurements.bp_diastolic,
        hr_bpm: _lm.measurements.hr_bpm,
      }
    : null;

  // Protein focus — show the protein-intake check-in question only for
  // cohorts where protein is a priority: vegetarian/vegan (non-meat
  // eaters under-eat protein), insulin resistance / PCOS / diabetes,
  // an active weight-loss goal, or peri/menopause (muscle preservation).
  const diet = String(clientAny.dietary_preference ?? "").toLowerCase();
  const condBlob = [
    ...(Array.isArray(clientAny.active_conditions)
      ? clientAny.active_conditions
      : []),
    ...(Array.isArray(clientAny.medical_history)
      ? clientAny.medical_history
      : []),
  ]
    .map(String)
    .join(" ")
    .toLowerCase();
  const isVeg =
    /veg|vegan|jain|plant|egg|lacto|ovo/.test(diet) &&
    !/non.?veg|omnivore|meat/.test(diet);
  const isInsulinResistance =
    /insulin resist|pcos|prediabet|diabet|metabolic syndrome/.test(condBlob);
  const wl = clientAny.weight_loss as { enabled?: boolean } | undefined;
  const isWeightLoss = !!wl?.enabled;
  const isPeriMeno = /peri.?menopaus|menopaus/.test(condBlob);
  const proteinFocus =
    isVeg || isInsulinResistance || isWeightLoss || isPeriMeno;

  return (
    <AnalysePageShell
      clientId={id}
      formLabel="Check-in"
      formHint={
        activePlan
          ? `💬 Check-in · active plan ${activePlan.slug}`
          : "💬 Check-in · no active plan — captures still save"
      }
    >
      <FmPageHeader
        as="h2"
        size="md"
        title={<span style={{ color: "#1E8449" }}>💬 Check-in</span>}
        subtitle="30-min between-cycle pulse. Adherence + measurements + Five Pillars + lab tweaks."
      />
      <CheckInForm
        clientId={id}
        displayName={displayName}
        activePlanSlug={activePlan?.slug}
        activePlanRecheckDate={
          activePlan?.plan_period_recheck_date ?? undefined
        }
        previousMeasurements={previousMeasurements}
        proteinFocus={proteinFocus}
      />
    </AnalysePageShell>
  );
}
