import { notFound } from "next/navigation";
import { loadClientById } from "@/lib/fmdb/loader-extras";
import { loadAllOfKind } from "@/lib/fmdb/loader";
import type { Symptom } from "@/lib/fmdb/types";
import { FmPageHeader, type FmSymptomOption } from "@/components/fm";
import { AnalysePageShell } from "../analyse-page-shell";
import { IntakeForm } from "./intake-form";

export const dynamic = "force-dynamic";

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
        symptomCatalogue={symptomCatalogue}
        existingConditions={client.active_conditions ?? []}
        existingAllergies={
          (client.known_allergies as string[] | undefined) ??
          (client.allergies as string[] | undefined) ??
          []
        }
      />
    </AnalysePageShell>
  );
}
