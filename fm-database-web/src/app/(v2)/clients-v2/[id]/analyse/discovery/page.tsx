import { notFound } from "next/navigation";
import { loadClientById, loadClientSessions } from "@/lib/fmdb/loader-extras";
import { pickLatestDiscoveryWithLabs } from "@/lib/fmdb/session-utils";
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
  const [client, sessions] = await Promise.all([
    loadClientById(id),
    loadClientSessions(id),
  ]);
  if (!client) notFound();
  const displayName = client.display_name ?? client.client_id;

  // Single source of truth for the lab selection: the most-recently-SAVED
  // discovery session's requested_labs (ordered by created_at, not the
  // coach-entered call date — see pickLatestDiscoveryWithLabs). When present,
  // the form hydrates from this instead of the condition→panel prefill — so
  // the checkboxes here always match what's stored and what the Overview
  // "send labs" card will send. Handles both the top-level requested_labs
  // field and the legacy "[Requested labs: …]" coach_notes shape.
  const savedLabs: string[] =
    pickLatestDiscoveryWithLabs(sessions as ReadonlyArray<Record<string, unknown>>)
      ?.labs ?? [];

  // Pre-fill the discovery form from data the coach already entered when
  // creating the client. Maps active_conditions + notes → chief concern
  // draft + extra lab panel suggestions so the coach doesn't re-type
  // anything she's already captured at intake.
  const cAny = client as Record<string, unknown>;

  // Age (date_of_birth preferred, else age_band midpoint) + menopause age
  // — feed the prefill so the female sex-hormone panel is only auto-ticked
  // for plausibly peri/recently-menopausal clients, not women decades out.
  const clientAge: number | null = (() => {
    const dob = typeof cAny.date_of_birth === "string" ? cAny.date_of_birth : null;
    if (dob) {
      const d = new Date(dob);
      if (!Number.isNaN(d.getTime())) {
        const t = new Date();
        let a = t.getFullYear() - d.getFullYear();
        const m = t.getMonth() - d.getMonth();
        if (m < 0 || (m === 0 && t.getDate() < d.getDate())) a--;
        return a;
      }
    }
    const band = typeof cAny.age_band === "string" ? cAny.age_band : "";
    const nums = band.match(/\d+/g);
    if (nums && nums.length)
      return Math.round(nums.map(Number).reduce((s, n) => s + n, 0) / nums.length);
    return null;
  })();
  const menopauseAge: number | null = (() => {
    const s = typeof cAny.menopause_started === "string" ? cAny.menopause_started : "";
    const m = s.match(/\d{2}/);
    if (m) {
      const n = Number(m[0]);
      if (n >= 30 && n <= 62) return n;
    }
    return null;
  })();

  const prefill = buildDiscoveryPrefill({
    display_name: client.display_name,
    active_conditions: Array.isArray(cAny.active_conditions)
      ? (cAny.active_conditions as string[])
      : [],
    notes: typeof cAny.notes === "string" ? cAny.notes : undefined,
    goals: Array.isArray(cAny.goals) ? (cAny.goals as string[]) : [],
    family_history:
      typeof cAny.family_history === "string" ? cAny.family_history : null,
    age: clientAge,
    menopauseAge,
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
        savedLabs={savedLabs}
      />
    </AnalysePageShell>
  );
}
