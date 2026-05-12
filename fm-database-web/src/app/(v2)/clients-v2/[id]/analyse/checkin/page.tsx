import { notFound } from "next/navigation";
import { loadAllPlans } from "@/lib/fmdb/loader";
import { loadClientById } from "@/lib/fmdb/loader-extras";
import { FmPageHeader } from "@/components/fm";
import { AnalysePageShell } from "../analyse-page-shell";
import { CheckInForm } from "./checkin-form";

export const dynamic = "force-dynamic";

interface PlanRow {
  slug: string;
  client_id?: string;
  status?: string;
  _bucket?: string;
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
      />
    </AnalysePageShell>
  );
}
