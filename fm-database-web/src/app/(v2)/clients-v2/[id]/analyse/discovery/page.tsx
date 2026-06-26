import { notFound } from "next/navigation";
import { loadClientById, loadClientSessions } from "@/lib/fmdb/loader-extras";
import { loadAllPlans } from "@/lib/fmdb/loader";
import { loadClientOrders } from "@/lib/fmdb/lab-orders";
import { resolveAppTier, resolveDiscoveryStage } from "@/lib/fmdb/discovery-tier";
import { parseSessionType, lastTemplateSentAt } from "@/lib/fmdb/session-utils";
import { FmPageHeader } from "@/components/fm";
import { AnalysePageShell } from "../analyse-page-shell";
import { DiscoveryForm } from "./discovery-form";
import { DiscoveryWorkspace } from "./discovery-workspace";
import { buildDiscoveryPrefill } from "@/lib/fmdb/discovery-prefill";

/** Coerce a YAML date field (js-yaml may give a Date) to YYYY-MM-DD or null. */
function asYmd(v: unknown): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === "string") {
    const m = v.match(/^\d{4}-\d{2}-\d{2}/);
    return m ? m[0] : null;
  }
  return null;
}

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

  // Single source of truth for the lab selection: the most-recent saved
  // discovery session's requested_labs. When present, the form hydrates
  // from this instead of the condition→panel prefill — so the checkboxes
  // here always match what's stored and what the Overview "send labs" card
  // will send. Parses both the top-level requested_labs field and the
  // legacy "[Requested labs: …]" coach_notes shape.
  const latestDiscovery: { sid: string; labs: string[] } = (() => {
    const sorted = [...sessions].sort((a, b) =>
      String((b as { date?: string }).date ?? "").localeCompare(
        String((a as { date?: string }).date ?? ""),
      ),
    );
    for (const s of sorted) {
      const sr = s as Record<string, unknown>;
      if (parseSessionType(sr.presenting_complaints as string | undefined) !== "discovery")
        continue;
      const sid = String(sr.session_id ?? "");
      const top = sr.requested_labs;
      if (Array.isArray(top) && top.length > 0)
        return { sid, labs: top.map((x) => String(x)).filter(Boolean) };
      const notes = String((sr.coach_notes as string | undefined) ?? "");
      const m = notes.match(/\[Requested labs:\s*([^\]]+)\]/);
      if (m) {
        const labs = m[1]
          .split(/,\s*(?![^()]*\))/)
          .map((x) => x.trim())
          .filter(Boolean);
        if (labs.length > 0) return { sid, labs };
      }
    }
    return { sid: "", labs: [] };
  })();
  const savedLabs: string[] = latestDiscovery.labs;
  // Single send surface: the bundle the workspace's Labs block needs to email
  // the requisition (with the in-app booking path + a "why" from the panels).
  const _c = client as unknown as { app_token?: string; email?: string };
  const labSend = {
    sessionId: latestDiscovery.sid,
    appToken: typeof _c.app_token === "string" ? _c.app_token : null,
    clientEmail: typeof _c.email === "string" ? _c.email : null,
    lastSentAt: lastTemplateSentAt(
      sessions as ReadonlyArray<{ presenting_complaints?: string | null }>,
      "fm_lab_reminder",
    ),
  };

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

  // ── Discovery workspace: tier + onboarding stage ──────────────────────────
  // The Acumen recommend + Starting-Map authoring only make sense for a
  // consult-tier ("discovery") client (no published plan, not signed up). Resolve
  // the same stage the client app uses so this page mirrors what the client sees.
  const [allPlans, orders] = await Promise.all([loadAllPlans(), loadClientOrders(id)]);
  const hasPublishedPlan = (allPlans as Array<{ client_id?: string; status?: string; _bucket?: string }>).some(
    (p) => p.client_id === id && ((p._bucket ?? p.status) === "published"),
  );
  const istToday = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const discoveryCallDate = asYmd(cAny.discovery_call_date);
  const tier = resolveAppTier(
    {
      engagementStatus: typeof cAny.engagement_status === "string" ? cAny.engagement_status : null,
      hasPublishedPlan,
      discoveryCallDate,
    },
    istToday,
  ).tier;

  const intakeSubmitted = !!String((cAny.intake_submitted_at as string | undefined) ?? "").trim();
  const hasRecommendedOrder = orders.some((o) => o.status === "recommended");
  const hasActiveOrder = orders.some(
    (o) => o.status === "paid" || o.status === "booked" || o.status === "sample_collected",
  );
  const hasResults =
    (Array.isArray(cAny.health_snapshots) && cAny.health_snapshots.length > 0) ||
    orders.some((o) => o.status === "results_in");
  const discoveryStage = resolveDiscoveryStage({
    intakeSubmitted,
    hasRecommendedOrder,
    hasActiveOrder,
    hasResults,
    callDone: !!discoveryCallDate,
  });

  // Existing Starting Map → editor prefill (snake_case on disk → camelCase props).
  const rawSummary = (cAny.discovery_summary ?? {}) as Record<string, unknown>;
  const points = (v: unknown): { title: string; note: string }[] =>
    Array.isArray(v)
      ? v.map((it) => {
          const o = (it ?? {}) as Record<string, unknown>;
          return { title: typeof o.title === "string" ? o.title : "", note: typeof o.note === "string" ? o.note : "" };
        })
      : [];
  const existingSummary = {
    headline: typeof rawSummary.headline === "string" ? rawSummary.headline : "",
    hypotheses: points(rawSummary.hypotheses),
    foundationalChanges: points(rawSummary.foundational_changes),
    journeyPreview: Array.isArray(rawSummary.journey_preview) ? rawSummary.journey_preview.map(String) : [],
  };

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
      {!hasPublishedPlan && (
        <DiscoveryWorkspace
          clientId={id}
          tier={tier}
          stage={discoveryStage}
          intakeSubmitted={intakeSubmitted}
          callDate={discoveryCallDate}
          savedLabs={savedLabs}
          labSend={labSend}
          existingSummary={existingSummary}
        />
      )}
    </AnalysePageShell>
  );
}
