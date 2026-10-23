/**
 * /practice — roster-level views that are NOT decisions.
 *
 * Split out of /dashboard-v2 on 2026-10-23 so the dashboard can be a short
 * inbox. Everything here is a read: how the roster breaks down by lifecycle,
 * the practice overview (on track / watch / stalled), the cohort MSQ rollup,
 * the client-app adoption table, the weekly-menu pause roster, and the
 * catalogue guardrail chips.
 *
 * Counts come from the one lifecycle resolver; nothing here re-derives who is
 * in care from "has a published plan".
 */
import { loadAllClients, loadAllPlans } from "@/lib/fmdb/loader";
import { loadClientSessions, getClientHealthSignals } from "@/lib/fmdb/loader-extras";
import { resolveLifecycles, LIFECYCLE_META, isInCare, type LifecycleState } from "@/lib/fmdb/lifecycle";
import { loadDecisions as loadRenewalDecisions } from "@/lib/fmdb/renewal-queue";
import { readAppOpens } from "@/lib/fmdb/app-opens";
import { readAppInstalled } from "@/lib/fmdb/app-installed";
import { lastTemplateSentAt } from "@/lib/fmdb/session-utils";
import { getPlansRoot } from "@/lib/fmdb/paths";
import { getCohortMsqOutcomes } from "@/lib/fmdb/msq-cohort";
import { computePracticeOverview } from "@/lib/fmdb/practice-overview";
import { getRosterComposition } from "@/lib/fmdb/roster-composition";
import { getCatalogueStatus } from "@/app/catalogue-commit-action";
import { MsqCohortPanel } from "@/components/msq-cohort-panel";
import { PracticeOverviewPanel } from "@/components/practice-overview-panel";
import { ClientAppLinksPanel } from "@/components/client-app-links-panel";
import { WeeklyGenerationPausePanel } from "@/components/weekly-generation-pause-panel";
import { InterestedPeoplePanel } from "@/components/interested-people-panel";
import { loadInterestedPeopleAction } from "@/lib/server-actions/interest-tracking";
import {
  FmAlertGroup,
  FmAppShell,
  FmPageHeader,
  FmStatGrid,
  FmStatTile,
  FmCatalogueCommitBanner,
  FmCatalogueOrphanChip,
  FmCatalogueDuplicateChip,
  FmVitaoneCoverageChip,
  FmRecipeImageChip,
} from "@/components/fm";
import path from "node:path";
import fs from "node:fs/promises";

export const dynamic = "force-dynamic";

interface ClientRow {
  client_id: string;
  display_name?: string;
  active_conditions?: string[];
  mobile_number?: string;
  engagement_status?: string;
  maintenance_status?: string | null;
  archived?: boolean;
}

/** The practice-overview model still speaks the old bucket vocabulary; map
 *  lifecycle onto the three words it actually branches on. */
const BUCKET_FOR_STATE: Record<LifecycleState, string> = {
  active: "active",
  ending: "active",
  maintenance: "active",
  onboarding: "plan_to_build",
  prospect: "new_lead",
  lapsed: "lapsed",
  archived: "archived",
};

export default async function PracticePage() {
  const todayStr = new Date().toISOString().slice(0, 10);
  const [allClients, plans, catalogueStatus] = await Promise.all([loadAllClients(), loadAllPlans(), getCatalogueStatus()]);
  const clients = (allClients as unknown as ClientRow[]).filter((c) => c.archived !== true);
  const clientNameMap = new Map(clients.map((c) => [c.client_id, c.display_name ?? c.client_id]));

  const lifecycle = resolveLifecycles(
    clients as Parameters<typeof resolveLifecycles>[0],
    plans as unknown as Parameters<typeof resolveLifecycles>[1],
    todayStr,
    { decisions: loadRenewalDecisions() },
  );
  const stateCounts: Record<LifecycleState, number> = {
    active: 0,
    ending: 0,
    maintenance: 0,
    onboarding: 0,
    prospect: 0,
    lapsed: 0,
    archived: 0,
  };
  for (const l of lifecycle.values()) stateCounts[l.state] += 1;
  const inCare = clients.filter((c) => isInCare(lifecycle.get(c.client_id)?.state ?? "prospect"));
  const inCareIds = new Set(inCare.map((c) => c.client_id));

  const [signals, msqOutcomes, rosterComposition, interestedPeople] = await Promise.all([
    getClientHealthSignals([...inCareIds], { plateauThresholdKg: 0.3, plateauMinReadings: 3, regressedThresholdKg: 1.0 }),
    getCohortMsqOutcomes([...inCareIds]),
    getRosterComposition(inCare as Array<{ client_id: string }>),
    loadInterestedPeopleAction().catch(() => ({ rows: [], libraryLive: 0, contentCheckedAt: null })),
  ]);

  const bucketOf = new Map<string, string>();
  for (const c of clients) bucketOf.set(c.client_id, BUCKET_FOR_STATE[lifecycle.get(c.client_id)?.state ?? "prospect"]);
  const maintenanceIds = new Set(clients.filter((c) => lifecycle.get(c.client_id)?.state === "maintenance").map((c) => c.client_id));
  const overview = computePracticeOverview({
    clients,
    bucketOf,
    // "Active care" = in care by lifecycle, not "has a published plan".
    publishedPlanIds: new Set(inCare.filter((c) => lifecycle.get(c.client_id)?.state !== "onboarding").map((c) => c.client_id)),
    graduatedIds: maintenanceIds,
    // Dormancy (no coaching session in 14d) is NOT a stall any more: clients
    // live in the app, not in sessions, and nobody is chased for being quiet.
    dormantIds: new Set<string>(),
    plateauedIds: new Set(signals.plateaued.map((d) => d.client_id)),
    regressedIds: new Set(signals.regressed.map((d) => d.client_id)),
  });

  // 📲 Client-app links — one row per in-care client's live plan.
  const appLinkRows = (
    await Promise.all(
      clients
        .filter((c) => inCareIds.has(c.client_id))
        .map(async (c) => {
          const l = lifecycle.get(c.client_id)!;
          const slug = l.planSlug;
          if (!slug) return null;
          const p = plans.find((x) => x.slug === slug) as unknown as { letter_token?: string } | undefined;
          const sess = await loadClientSessions(c.client_id);
          const opens = await readAppOpens(c.client_id);
          const install = await readAppInstalled(c.client_id);
          const groceryReady = await fs
            .access(path.join(getPlansRoot(), "clients", c.client_id, "meal-plans", `${slug}-grocery.yaml`))
            .then(() => true)
            .catch(() => false);
          return {
            client_id: c.client_id,
            display_name: c.display_name ?? c.client_id,
            mobile_number: c.mobile_number ?? null,
            plan_slug: slug,
            token: (p?.letter_token?.length ?? 0) >= 16 ? (p!.letter_token as string) : null,
            inviteSentAt: lastTemplateSentAt(sess, "fm_app_invite_v1"),
            lastOpenedAt: opens.lastOpenedAt,
            openCount: opens.count,
            installed: install.installed,
            engaged: sess.some((s) => (s.presenting_complaints ?? "").includes("[source: client_app")),
            groceryReady,
          };
        }),
    )
  )
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => a.display_name.localeCompare(b.display_name));

  const order: LifecycleState[] = ["active", "ending", "maintenance", "onboarding", "prospect", "lapsed"];

  return (
    <FmAppShell activeNavId="practice" crumbs={[{ label: "Practice" }]}>
      <FmPageHeader title="Practice" subtitle="The roster at a glance. Decisions live on the dashboard." />

      <div style={{ display: "grid", gap: 14, marginBottom: 24 }}>
        <FmStatGrid>
          {order.map((s) => (
            <FmStatTile
              key={s}
              label={`${LIFECYCLE_META[s].icon} ${LIFECYCLE_META[s].label}`}
              value={stateCounts[s]}
              href={`/clients-v2?filter=${s}`}
            />
          ))}
        </FmStatGrid>
        <FmStatGrid>
          <FmStatTile label="In care" value={inCare.length} href="/clients-v2?filter=active" />
          <FmStatTile label="On track" value={overview.onTrackPct !== null ? `${overview.onTrackPct}%` : "—"} />
          <FmStatTile
            label="Avg MSQ"
            value={msqOutcomes.avgLatestTotal ?? msqOutcomes.avgBaselineTotal ?? "—"}
            title="Cohort Medical Symptom Questionnaire · lower is better"
          />
          <FmStatTile label="Watch + stalled" value={overview.watch + overview.stalled} highlight={overview.stalled > 0} />
        </FmStatGrid>
        <PracticeOverviewPanel data={overview} symptoms={rosterComposition.symptoms} drivers={rosterComposition.drivers} />
        <MsqCohortPanel data={msqOutcomes} />
      </div>

      <FmAlertGroup id="practice.app" tier="fyi" icon="📲" label="Client app" defaultCollapsed={false}>
        <ClientAppLinksPanel rows={appLinkRows} whatsappConfigured={!!process.env.WHATSAPP_SERVER_URL} />
        <WeeklyGenerationPausePanel names={Object.fromEntries(clientNameMap)} />
      </FmAlertGroup>

      {/* 💬 Who's interested in what — prospects' concerns and the library item
          that suits each. Roster-level; a drafted note shows on the dashboard. */}
      <FmAlertGroup id="practice.interested" tier="fyi" icon="💬" label="Prospects — interests" defaultCollapsed>
        <InterestedPeoplePanel rows={interestedPeople.rows} contentCheckedAt={interestedPeople.contentCheckedAt} />
      </FmAlertGroup>

      <FmAlertGroup id="practice.catalogue" tier="fyi" icon="📖" label="Catalogue + admin" defaultCollapsed>
        <FmCatalogueCommitBanner initialStatus={catalogueStatus} />
        <FmCatalogueOrphanChip />
        <FmCatalogueDuplicateChip />
        <FmVitaoneCoverageChip />
        <FmRecipeImageChip />
      </FmAlertGroup>
    </FmAppShell>
  );
}
