import { loadAllOfKind, loadAllClients } from "@/lib/fmdb/loader";
import type { Symptom, Topic, Client } from "@/lib/fmdb/types";
import { AssessClient } from "./assess-client";

export const dynamic = "force-dynamic";

export default async function AssessPage() {
  const [symptoms, topics, clients] = await Promise.all([
    loadAllOfKind<Symptom>("symptoms"),
    loadAllOfKind<Topic>("topics"),
    loadAllClients(),
  ]);

  // Strip nothing here — just hand over the slim shapes the picker needs.
  const symptomOpts = symptoms
    .map((s) => ({
      slug: s.slug,
      label: s.display_name || s.slug,
      aliases: s.aliases || [],
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const topicOpts = topics
    .map((t) => ({ slug: t.slug, label: t.display_name || t.slug }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const clientOpts: Client[] = [...clients].sort((a, b) =>
    a.client_id.localeCompare(b.client_id)
  );

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold">🧠 Assess &amp; Suggest</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Pick a client, drop in symptoms / topics / lab reports / food log, and the
          tool synthesizes possible drivers + interventions drawn from the catalogue.
          Each Analyze run is saved as a session for the client.
        </p>
      </div>
      <AssessClient
        clients={clientOpts}
        symptoms={symptomOpts}
        topics={topicOpts}
      />
    </div>
  );
}
