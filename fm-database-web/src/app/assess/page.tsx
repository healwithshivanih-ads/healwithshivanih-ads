import { loadAllOfKind, loadAllClients } from "@/lib/fmdb/loader";
import type { Symptom, Topic, Client } from "@/lib/fmdb/types";
import { AssessClient } from "./assess-client";
import { loadClientSessionsAction, type SessionSummary } from "./actions";

export const dynamic = "force-dynamic";

export default async function AssessPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string }>;
}) {
  const { client: clientParam } = await searchParams;
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
      category: (s as unknown as { category?: string }).category || "other",
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const topicOpts = topics
    .map((t) => ({ slug: t.slug, label: t.display_name || t.slug }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const clientOpts: Client[] = [...clients].sort((a, b) =>
    a.client_id.localeCompare(b.client_id)
  );

  // Determine which client is shown on first render and pre-load their sessions
  const initialClientId = clientParam && clientOpts.find(c => c.client_id === clientParam)
    ? clientParam
    : clientOpts[0]?.client_id ?? "";

  const initialSessions: SessionSummary[] = initialClientId
    ? await loadClientSessionsAction(initialClientId)
    : [];

  // Returning client context — shown when a client with prior intake
  // is arriving after 28+ days (typically via "Start return assessment" CTA).
  const returningContext = (() => {
    if (!clientParam || initialSessions.length === 0) return null;
    const hadIntake = initialSessions.some((s) => s.session_type === "intake");
    if (!hadIntake) return null;
    const mostRecent = initialSessions[0];
    if (!mostRecent.date) return null;
    const daysSince = Math.round(
      (Date.now() - new Date(mostRecent.date).getTime()) / (1000 * 60 * 60 * 24)
    );
    if (daysSince < 28) return null;
    return { daysSince, lastSession: mostRecent };
  })();

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold">🧠 Assess &amp; Suggest</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Pick a client, drop in symptoms / conditions / lab reports / food log, and the
          tool synthesizes possible drivers + interventions drawn from the catalogue.
          Each Analyze run is saved as a session for the client.
        </p>
      </div>

      {/* Returning client context — shown when navigating from the welcome-back banner */}
      {returningContext && (
        <div
          className="rounded-xl border-2 px-5 py-4 space-y-3"
          style={{ borderColor: "var(--brand-indigo)", background: "var(--brand-bone)" }}
        >
          <div className="flex items-center gap-2">
            <span className="text-lg">📋</span>
            <span className="font-bold text-base" style={{ color: "var(--brand-indigo)" }}>
              Returning client — {returningContext.daysSince} days since last session
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="rounded-lg border bg-white/60 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">Last seen</div>
              <div className="font-medium">{returningContext.lastSession.date}</div>
              <div className="text-muted-foreground capitalize">{returningContext.lastSession.session_type.replace("_", " ")}</div>
            </div>
            {returningContext.lastSession.driver_count > 0 && (
              <div className="rounded-lg border bg-white/60 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">Prior drivers</div>
                <div className="font-medium">{returningContext.lastSession.driver_count} identified</div>
                <div className="text-muted-foreground">in last assessment</div>
              </div>
            )}
            {returningContext.lastSession.supplement_count > 0 && (
              <div className="rounded-lg border bg-white/60 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">Prior protocol</div>
                <div className="font-medium">{returningContext.lastSession.supplement_count} supplement{returningContext.lastSession.supplement_count !== 1 ? "s" : ""}</div>
                <div className="text-muted-foreground">in last plan</div>
              </div>
            )}
          </div>
          {returningContext.lastSession.synthesis_notes && (
            <div className="rounded-lg border bg-white/60 px-3 py-2 text-xs">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">
                AI synthesis — last assessment
              </div>
              <p className="text-muted-foreground italic line-clamp-3">
                {returningContext.lastSession.synthesis_notes}
              </p>
            </div>
          )}
          <p className="text-xs" style={{ color: "var(--brand-lavender)" }}>
            💡 The AI will automatically see prior session history and frame this as a return assessment with continuity.
          </p>
        </div>
      )}

      <AssessClient
        clients={clientOpts}
        symptoms={symptomOpts}
        topics={topicOpts}
        initialClientId={initialClientId}
        initialSessions={initialSessions}
      />
    </div>
  );
}
