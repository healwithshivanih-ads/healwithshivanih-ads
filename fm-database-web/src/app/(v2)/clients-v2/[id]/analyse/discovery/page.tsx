import { notFound } from "next/navigation";
import { loadClientById } from "@/lib/fmdb/loader-extras";
import { FmPageHeader } from "@/components/fm";
import { AnalysePageShell } from "../analyse-page-shell";
import { DiscoveryForm } from "./discovery-form";

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
      />
    </AnalysePageShell>
  );
}
