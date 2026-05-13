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
import { loadAllPlans } from "@/lib/fmdb/loader";
import { loadClientSessionsAction } from "@/app/assess/actions";
import { SessionsPageShell } from "./sessions-page-shell";
import { SessionsBrowser } from "./sessions-browser";
import { SessionMarkerCharts } from "./session-marker-charts";
import { V2TrackingCharts } from "./v2-tracking-charts";
import { ReworkBanner } from "@/app/clients/[id]/rework-banner";
import type { Client } from "@/lib/fmdb/types";

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

  const [client, sessions, allPlans] = await Promise.all([
    loadClientById(id),
    loadClientSessionsAction(id),
    loadAllPlans(),
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

  // Published plan info for the pre-session brief (active supplements +
  // practices + plan period). Falls back gracefully if no published plan.
  const publishedPlan = allPlans
    .filter((p) => (p as { client_id?: string }).client_id === id)
    .find(
      (p) =>
        ((p as { status?: string; _bucket?: string }).status ??
          (p as { status?: string; _bucket?: string })._bucket) === "published",
    );

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
        // PreSessionBrief props — coach can launch the prep card right
        // here on Sessions, where she's reviewing prior session history.
        // Same modal as the one mounted on /clients-v2/[id] overview.
        client={client}
        activePlanSlug={publishedPlan?.slug as string | undefined}
        activePlanStart={
          publishedPlan?.plan_period_start as string | undefined
        }
        activePlanRecheck={
          publishedPlan?.plan_period_recheck_date as string | undefined
        }
        // All known plan slugs (across every bucket) — used by the
        // inspector to detect a stale generated_plan_slug ref and show
        // "plan deleted" instead of a Link that 404s on the v2 editor.
        knownPlanSlugs={allPlans.map((p) => p.slug as string)}
        // Client-relevant clinical-marker trend charts above the 2-col grid.
        markerChartsSlot={
          <SessionMarkerCharts clientId={id} client={client as unknown as Client} />
        }
        // Longitudinal tracking surface — outcome progress, protocol adherence,
        // IFM trend, lab comparison. Each panel self-hides until its data
        // threshold is met. Design punchlist refs #16-19.
        trackingChartsSlot={
          <V2TrackingCharts
            clientId={id}
            client={client as unknown as Client}
            sessions={sortedDesc}
          />
        }
      />
    </SessionsPageShell>
  );
}
