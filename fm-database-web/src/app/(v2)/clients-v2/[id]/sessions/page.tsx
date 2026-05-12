/**
 * /clients-v2/[id]/sessions — dedicated Sessions tab in v2.
 *
 * Two-pane layout:
 *   - LEFT (sticky): filterable list of every prior session for this
 *     client. Type chips (All / Discovery / Intake / Check-in / Quick
 *     note). Each row shows date, type, age, one-line summary, and
 *     drivers / supplements counts.
 *   - RIGHT: full inspector for the selected session — AI synthesis
 *     notes, likely drivers, supplement suggestions, lab orders,
 *     uploaded files, five pillars, generated plan link, raw notes.
 *
 * Selection is URL-driven (?sid=<session_id>) so the coach can
 * deep-link to a specific session. Default selection = newest.
 *
 * Closes the "where do I see previous analyses?" gap surfaced two
 * turns ago. The Analyse tab keeps its session-timeline sidebar; this
 * page is the permanent inspector.
 */
import { loadClientById } from "@/lib/fmdb/loader-extras";
import { loadClientSessionsAction } from "@/app/assess/actions";
import { SessionsPageShell } from "./sessions-page-shell";
import { SessionsBrowser } from "./sessions-browser";
import { ReworkBanner } from "@/app/clients/[id]/rework-banner";

export const dynamic = "force-dynamic";

export default async function SessionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sid?: string; type?: string }>;
}) {
  const { id } = await params;
  const { sid, type } = await searchParams;

  const [client, sessions] = await Promise.all([
    loadClientById(id),
    loadClientSessionsAction(id),
  ]);
  if (!client) {
    return (
      <SessionsPageShell clientId={id}>
        <div>Client not found.</div>
      </SessionsPageShell>
    );
  }

  // Sort newest → oldest by date string (ISO, lexicographic-safe).
  const sortedDesc = [...sessions].sort((a, b) =>
    (b.date ?? "").localeCompare(a.date ?? ""),
  );

  const displayName = client.display_name ?? client.client_id;

  return (
    <SessionsPageShell clientId={id}>
      {client.rework_suggestion && (
        <div style={{ marginBottom: 12 }}>
          <ReworkBanner clientId={id} suggestion={client.rework_suggestion} />
        </div>
      )}
      <SessionsBrowser
        clientId={id}
        displayName={displayName}
        sessions={sortedDesc}
        selectedSid={sid}
        filterType={type}
        clientAgeBand={client.age_band ?? null}
        clientSex={client.sex ?? null}
        clientConditions={client.active_conditions ?? []}
        clientMedications={client.current_medications ?? client.medications ?? []}
      />
    </SessionsPageShell>
  );
}
