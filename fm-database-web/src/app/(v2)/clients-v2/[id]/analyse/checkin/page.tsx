import { notFound } from "next/navigation";
import { loadAllPlans } from "@/lib/fmdb/loader";
import { loadClientById } from "@/lib/fmdb/loader-extras";
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
  let previousMeasurements: PreviousMeasurementSnapshot | null = null;
  const log = clientAny.measurements_log as
    | Array<Record<string, unknown>>
    | undefined;
  if (Array.isArray(log) && log.length > 0) {
    const sorted = [...log].sort((a, b) => {
      const da = String(a.date ?? "");
      const db = String(b.date ?? "");
      return db.localeCompare(da);
    });
    const latest = sorted[0];
    previousMeasurements = {
      date: latest.date as string | undefined,
      weight_kg: latest.weight_kg as number | undefined,
      waist_cm: latest.waist_cm as number | undefined,
      hip_cm: latest.hip_cm as number | undefined,
      bp_systolic: latest.blood_pressure_systolic as number | undefined,
      bp_diastolic: latest.blood_pressure_diastolic as number | undefined,
      hr_bpm: latest.resting_heart_rate as number | undefined,
    };
  }
  if (!previousMeasurements) {
    const snapshots = clientAny.health_snapshots as
      | Array<Record<string, unknown>>
      | undefined;
    if (Array.isArray(snapshots) && snapshots.length > 0) {
      // Sort by date desc, pick first one with non-empty measurements
      const sorted = [...snapshots].sort((a, b) =>
        String(b.date ?? "").localeCompare(String(a.date ?? "")),
      );
      for (const snap of sorted) {
        const m = (snap.measurements ?? {}) as Record<string, unknown>;
        const hasAny =
          m.weight_kg != null ||
          m.waist_cm != null ||
          m.hip_cm != null ||
          m.bp_systolic != null ||
          m.hr_bpm != null;
        if (hasAny) {
          previousMeasurements = {
            date: snap.date as string | undefined,
            weight_kg: m.weight_kg as number | undefined,
            waist_cm: m.waist_cm as number | undefined,
            hip_cm: m.hip_cm as number | undefined,
            bp_systolic: m.bp_systolic as number | undefined,
            bp_diastolic: m.bp_diastolic as number | undefined,
            hr_bpm: m.hr_bpm as number | undefined,
          };
          break;
        }
      }
    }
  }
  if (!previousMeasurements) {
    const m = clientAny.measurements as Record<string, unknown> | undefined;
    if (m) {
      previousMeasurements = {
        date: m.measured_on as string | undefined,
        weight_kg: m.weight_kg as number | undefined,
        waist_cm: m.waist_cm as number | undefined,
        hip_cm: m.hip_cm as number | undefined,
        bp_systolic: m.blood_pressure_systolic as number | undefined,
        bp_diastolic: m.blood_pressure_diastolic as number | undefined,
        hr_bpm: m.resting_heart_rate as number | undefined,
      };
    }
  }

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
      />
    </AnalysePageShell>
  );
}
