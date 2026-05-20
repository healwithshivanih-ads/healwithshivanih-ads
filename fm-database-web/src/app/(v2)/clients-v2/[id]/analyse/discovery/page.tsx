import { notFound } from "next/navigation";
import { loadClientById } from "@/lib/fmdb/loader-extras";
import { FmPageHeader } from "@/components/fm";
import { AnalysePageShell } from "../analyse-page-shell";
import { DiscoveryForm } from "./discovery-form";
import { buildDiscoveryPrefill } from "@/lib/fmdb/discovery-prefill";

export const dynamic = "force-dynamic";

export default async function DiscoveryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const client = await loadClientById(id);
  if (!client) notFound();
  const displayName = client.display_name ?? client.client_id;

  // Pre-fill the discovery form from data the coach already entered when
  // creating the client. Maps active_conditions + notes → chief concern
  // draft + extra lab panel suggestions so the coach doesn't re-type
  // anything she's already captured at intake.
  const cAny = client as Record<string, unknown>;
  const prefill = buildDiscoveryPrefill({
    display_name: client.display_name,
    active_conditions: Array.isArray(cAny.active_conditions)
      ? (cAny.active_conditions as string[])
      : [],
    notes: typeof cAny.notes === "string" ? cAny.notes : undefined,
    goals: Array.isArray(cAny.goals) ? (cAny.goals as string[]) : [],
    family_history:
      typeof cAny.family_history === "string" ? cAny.family_history : null,
  });

  return (
    <AnalysePageShell
      clientId={id}
      formLabel="Discovery"
      formHint="🔍 Discovery · 15-min fit conversation · sets the lab order in motion"
    >
      <FmPageHeader
        as="h2"
        size="md"
        title={<span style={{ color: "#B8770A" }}>🔍 Discovery</span>}
        subtitle="Free 15-minute fit call. Capture the presenting concern, pick the FM lab panel, and decide on a food journal."
      />
      <DiscoveryForm
        clientId={id}
        displayName={displayName}
        clientSex={
          client.sex === "F" || client.sex === "M" ? client.sex : null
        }
        clientEmail={client.email ?? null}
        prefillChiefConcern={prefill.chiefConcernDraft}
        prefillExtraPanels={prefill.extraPanels}
        prefillDetectionLabel={prefill.detectionLabel}
      />
    </AnalysePageShell>
  );
}
