import { notFound } from "next/navigation";
import { loadClientById } from "@/lib/fmdb/loader-extras";
import { FmPageHeader } from "@/components/fm";
import { AnalysePageShell } from "../analyse-page-shell";
import { IntakeForm } from "./intake-form";

export const dynamic = "force-dynamic";

export default async function IntakePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const client = await loadClientById(id);
  if (!client) notFound();
  const displayName = client.display_name ?? client.client_id;

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
      <IntakeForm clientId={id} displayName={displayName} />
    </AnalysePageShell>
  );
}
