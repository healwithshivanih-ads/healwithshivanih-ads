import { notFound } from "next/navigation";
import { loadClientById, loadClientSessions } from "@/lib/fmdb/loader-extras";
import { loadAllOfKind } from "@/lib/fmdb/loader";
import { parseSessionType } from "@/lib/fmdb/session-utils";
import type { Symptom } from "@/lib/fmdb/types";
import { FmPageHeader, type FmSymptomOption } from "@/components/fm";
import { AnalysePageShell } from "../analyse-page-shell";
import { IntakeForm } from "./intake-form";

export const dynamic = "force-dynamic";

type StrOrUndef = string | undefined;
function s(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function asStrArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export default async function IntakePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [client, symptoms, sessions] = await Promise.all([
    loadClientById(id),
    loadAllOfKind<Symptom>("symptoms"),
    loadClientSessions(id),
  ]);
  if (!client) notFound();
  const displayName = client.display_name ?? client.client_id;

  // Detect whether this is the first intake or an update of an existing one.
  // Intake sessions (per the v0.59 rename) include any session whose
  // [session_type:] tag parses to "intake". Sorted newest-first for the
  // "last captured" timestamp.
  const intakeSessions = sessions
    .map((sess) => ({
      session_id: sess.session_id,
      date: sess.date as string | undefined,
      type: parseSessionType(
        (sess as unknown as Record<string, unknown>).presenting_complaints as
          | string
          | undefined,
      ),
    }))
    .filter((sess) => sess.type === "intake")
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const isUpdate = intakeSessions.length > 0;
  const lastIntakeDate = intakeSessions[0]?.date;

  // Project the symptom catalogue down to the shape FmSymptomPicker needs.
  // Keeping just slug/label/aliases/category/severity keeps payload small.
  const symptomCatalogue: FmSymptomOption[] = symptoms
    .filter((s) => s.slug)
    .map((s) => ({
      slug: s.slug,
      label: s.display_name ?? s.slug,
      aliases: (s as unknown as { aliases?: string[] }).aliases,
      category: s.category,
      severity: s.severity,
    }));

  // Cycle / pregnancy / FM fields are stringly-typed coming off the YAML.
  // Cast through unknown for safety.
  const c = client as unknown as Record<string, unknown>;
  const cycleStatus = (c.cycle_status as StrOrUndef) ?? null;
  const cycleRegularity = (c.cycle_regularity as StrOrUndef) ?? null;
  const pregnancyStatus = (c.pregnancy_status as StrOrUndef) ?? null;

  // ── Pre-fill body composition from client.measurements + latest health_snapshot.
  //     Snapshot wins per-field when present (it's the more recent capture).
  const flatMeas = (c.measurements as Record<string, unknown> | undefined) ?? {};
  const snaps = (c.health_snapshots as Array<{ date?: string; measurements?: Record<string, unknown> }> | undefined) ?? [];
  const latestSnap = snaps
    .filter((s) => s.measurements && Object.keys(s.measurements).length > 0)
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))
    .pop();
  const snapMeas = latestSnap?.measurements ?? {};
  const numOrEmpty = (k: string): string => {
    const v = snapMeas[k] ?? flatMeas[k];
    return typeof v === "number" && !Number.isNaN(v) ? String(v) : "";
  };
  // measurement field naming differs between the snapshot schema and the legacy
  // flat schema (blood_pressure_systolic vs bp_systolic) — try both.
  const bpSysVal =
    numOrEmpty("bp_systolic") ||
    (typeof flatMeas.blood_pressure_systolic === "number"
      ? String(flatMeas.blood_pressure_systolic)
      : "");
  const bpDiaVal =
    numOrEmpty("bp_diastolic") ||
    (typeof flatMeas.blood_pressure_diastolic === "number"
      ? String(flatMeas.blood_pressure_diastolic)
      : "");
  const hrVal =
    numOrEmpty("hr_bpm") ||
    (typeof flatMeas.resting_heart_rate === "number"
      ? String(flatMeas.resting_heart_rate)
      : "");

  const existingMeasurements = {
    height_cm: numOrEmpty("height_cm"),
    weight_kg: numOrEmpty("weight_kg"),
    waist_cm: numOrEmpty("waist_cm"),
    hip_cm: numOrEmpty("hip_cm"),
    bp_systolic: bpSysVal,
    bp_diastolic: bpDiaVal,
    hr_bpm: hrVal,
  };

  // Current meds: prefer `current_medications`, fall back to `medications`.
  const medsList = asStrArray(c.current_medications).length > 0
    ? asStrArray(c.current_medications)
    : asStrArray(c.medications);

  // Timeline events
  const timelineEvents = Array.isArray(c.timeline_events)
    ? (c.timeline_events as Array<{ year?: number | string; category?: string; event?: string }>)
        .filter((e) => e && typeof e.event === "string" && e.event.trim().length > 0)
        .map((e) => ({
          year: e.year != null ? String(e.year) : "",
          category: e.category ?? "",
          event: e.event ?? "",
        }))
    : [];

  return (
    <AnalysePageShell
      clientId={id}
      formLabel={isUpdate ? "Update intake" : "Intake"}
      formHint={
        isUpdate
          ? `📋 Update intake · last captured ${lastIntakeDate ?? "earlier"} · ${intakeSessions.length} prior intake${intakeSessions.length === 1 ? "" : "s"} on file`
          : "📋 Intake · first deep history call · 60 min"
      }
    >
      <FmPageHeader
        as="h2"
        size="md"
        title={
          <span style={{ color: "#3a4250" }}>
            {isUpdate ? "📋 Update intake" : "📋 Intake"}
          </span>
        }
        subtitle={
          isUpdate
            ? `This client already has an intake on file (last ${lastIntakeDate}). Everything below is pre-filled with what we know — edit any field that's changed (new diagnosis, life event, meds, etc.). Saving updates the living profile and appends an intake-update record.`
            : "First deep history call — full history, meds, family hx, lifestyle baseline, supplement history. The Full Assessment runs the AI synthesis on top of this."
        }
      />
      <IntakeForm
        clientId={id}
        displayName={displayName}
        clientSex={client.sex === "F" || client.sex === "M" ? client.sex : null}
        symptomCatalogue={symptomCatalogue}
        existingConditions={asStrArray(c.active_conditions)}
        existingAllergies={
          asStrArray(c.known_allergies).length > 0
            ? asStrArray(c.known_allergies)
            : asStrArray(c.allergies)
        }
        existingGoals={asStrArray(c.goals)}
        existingMedicalHistory={asStrArray(c.medical_history)}
        existingFm={{
          digestion_notes: s(c.digestion_notes),
          sleep_notes: s(c.sleep_notes),
          energy_pattern: s(c.energy_pattern),
          menstrual_notes: s(c.menstrual_notes),
          stress_response: s(c.stress_response),
          childhood_history: s(c.childhood_history),
          toxic_exposures: s(c.toxic_exposures),
        }}
        existingCycle={{
          cycle_status: cycleStatus,
          last_menstrual_period: s(c.last_menstrual_period),
          cycle_length_days:
            typeof c.cycle_length_days === "number" ? c.cycle_length_days : null,
          cycle_regularity: cycleRegularity,
          menopause_started: s(c.menopause_started),
        }}
        existingPregnancy={{
          pregnancy_status: pregnancyStatus,
          pregnancy_due_date: s(c.pregnancy_due_date),
          lactation_started: s(c.lactation_started),
        }}
        existingMeasurements={existingMeasurements}
        existingMedications={medsList.join("\n")}
        existingFamilyHistory={s(c.family_history)}
        existingPrefs={{
          dietary_preference: s(c.dietary_preference),
          foods_to_avoid: s(c.foods_to_avoid),
          non_negotiables: s(c.non_negotiables),
          reported_triggers: s(c.reported_triggers),
        }}
        existingTimeline={timelineEvents}
      />
    </AnalysePageShell>
  );
}
