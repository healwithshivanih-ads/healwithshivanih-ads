import { notFound } from "next/navigation";
import { loadClientById } from "@/lib/fmdb/loader-extras";
import { loadAllOfKind } from "@/lib/fmdb/loader";
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
  const [client, symptoms] = await Promise.all([
    loadClientById(id),
    loadAllOfKind<Symptom>("symptoms"),
  ]);
  if (!client) notFound();
  const displayName = client.display_name ?? client.client_id;

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

  return (
    <AnalysePageShell
      clientId={id}
      formLabel="Intake"
      formHint="📋 Intake · one-time deep history call · 60 min"
    >
      <FmPageHeader
        as="h2"
        size="md"
        title={<span style={{ color: "#3a4250" }}>📋 Intake</span>}
        subtitle="First paid session — full history, meds, family hx, lifestyle baseline, supplement history. No plan yet; that's Full assessment."
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
      />
    </AnalysePageShell>
  );
}
