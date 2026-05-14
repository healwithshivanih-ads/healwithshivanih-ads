/**
 * /dashboard-v2 — Phase 1 dashboard.
 *
 * Server-fetches client + plan + API spend + AiSensy inbox + catalogue commit
 * data; renders inside <FmAppShell>. Triage sections are collapsible (client
 * component) with zero-count buckets showing a green badge + dashed empty
 * panel.
 *
 * All four engine surfaces from the legacy dashboard are preserved:
 *  - Catalogue commit banner (when files are uncommitted)
 *  - AiSensy inbound message strip (last 7 days)
 *  - Upcoming follow-ups strip (next 7 days)
 *  - Broadcast panel (when AISENSY_API_KEY is set)
 */
import Link from "next/link";
import { loadAllClients, loadAllPlans } from "@/lib/fmdb/loader";
import { loadClientSessions, getRecentAisensyMessages } from "@/lib/fmdb/loader-extras";
import { parseRequestedLabs } from "@/lib/fmdb/session-utils";
import { loadApiUsageMtdAllClients } from "@/lib/server-actions/usage";
import { getCatalogueStatus } from "@/app/catalogue-commit-action";
import { BroadcastPanel } from "@/app/broadcast-panel";
import {
  FmAppShell,
  FmPageHeader,
  FmPanel,
  FmStatTile,
  FmStatGrid,
  FmChip,
  FmCatalogueCommitBanner,
  FmAisensyBanner,
} from "@/components/fm";
import { TriageSections, type TriageRow, type SignalKind } from "./triage-sections";

export const dynamic = "force-dynamic";

interface ClientRow {
  client_id: string;
  display_name?: string;
  active_conditions?: string[];
  next_contact_date?: string;
  mobile_number?: string;
  email?: string;
}

interface PlanRow {
  slug: string;
  client_id?: string;
  status?: string;
  _bucket?: string;
  plan_period_recheck_date?: string;
  plan_period_start?: string;
  plan_period_weeks?: number;
}

const ACTIVE_BUCKETS = new Set(["draft", "ready_to_publish", "published"]);

async function computeSignal(
  client: ClientRow,
  clientPlans: PlanRow[],
  todayStr: string,
): Promise<TriageRow["signal"]> {
  // Explicit follow-up date set by coach takes highest priority.
  if (client.next_contact_date && client.next_contact_date <= todayStr) {
    const daysOverdue = Math.round(
      (new Date(todayStr).getTime() - new Date(client.next_contact_date).getTime()) /
        (1000 * 60 * 60 * 24),
    );
    return { kind: "follow_up_due", daysOverdue };
  }

  // Published plan past its recheck → protocol complete.
  const overduePlan = clientPlans.find((p) => {
    if ((p._bucket ?? p.status) !== "published") return false;
    if (p.plan_period_recheck_date) return p.plan_period_recheck_date < todayStr;
    if (p.plan_period_start && p.plan_period_weeks && p.plan_period_weeks > 0) {
      const recheck = new Date(p.plan_period_start + "T00:00:00");
      recheck.setDate(recheck.getDate() + p.plan_period_weeks * 7);
      return recheck.toISOString().slice(0, 10) < todayStr;
    }
    return false;
  });
  if (overduePlan) {
    return {
      kind: "protocol_complete",
      planSlug: overduePlan.slug,
      recheckDate: overduePlan.plan_period_recheck_date,
    };
  }

  // Active plan trumps labs-pending. Once a plan is live, the requested
  // labs were either already factored in or the coach will revise the
  // plan when new labs land — surfacing labs-pending for an active
  // client is just dashboard noise. (This ordering matches the classic
  // dashboard at src/app/page.tsx; dashboard-v2 had the checks reversed,
  // so Geetika kept appearing in Labs pending despite plan-1 being
  // active.)
  const activePlan = clientPlans.find((p) => ACTIVE_BUCKETS.has(p._bucket ?? p.status ?? ""));
  if (activePlan) {
    return {
      kind: "active",
      planSlug: activePlan.slug,
      recheckDate: activePlan.plan_period_recheck_date,
    };
  }

  // Sessions-based signals: labs_pending, returning, new_client.
  const sessions = await loadClientSessions(client.client_id);
  if (sessions.length === 0) return { kind: "new_client" };

  // Labs requested but not yet uploaded — same heuristic as the legacy
  // dashboard: scan session coach_notes for "[requested labs: …]" tags.
  // Skipped above when an active plan exists.
  for (const s of sessions) {
    const labs = parseRequestedLabs(s.coach_notes as string | undefined);
    if (labs.length > 0) {
      return { kind: "labs_pending", labs, labCount: labs.length };
    }
  }

  // Returning if last session was > 30 days ago, otherwise still onboarding.
  const lastSession = sessions[sessions.length - 1] as Record<string, unknown>;
  const lastDate = (lastSession.date as string) ?? "";
  if (lastDate) {
    const days = Math.round(
      (new Date(todayStr).getTime() - new Date(lastDate).getTime()) / (1000 * 60 * 60 * 24),
    );
    if (days >= 30) return { kind: "returning", daysSince: days };
  }
  return { kind: "new_client", sessionDate: lastDate };
}

export default async function DashboardV2() {
  const todayStr = new Date().toISOString().slice(0, 10);
  const [clients, plans, apiMtd, catalogueStatus] = await Promise.all([
    loadAllClients(),
    loadAllPlans(),
    loadApiUsageMtdAllClients(),
    getCatalogueStatus(),
  ]);

  // AiSensy inbound (last 7 days)
  const clientNameMap = new Map(
    (clients as ClientRow[]).map((c) => [c.client_id, c.display_name ?? c.client_id]),
  );
  const aisensyMessages = await getRecentAisensyMessages(
    (clients as ClientRow[]).map((c) => c.client_id),
    clientNameMap,
    7,
  );

  // Per-client plan lookup
  const plansByClient = new Map<string, PlanRow[]>();
  for (const p of plans) {
    const cid = (p as Record<string, unknown>).client_id as string | undefined;
    if (!cid) continue;
    if (!plansByClient.has(cid)) plansByClient.set(cid, []);
    plansByClient.get(cid)!.push(p as unknown as PlanRow);
  }

  // Compute signals
  const rows: TriageRow[] = await Promise.all(
    (clients as ClientRow[]).map(async (c) => ({
      client_id: c.client_id,
      display_name: c.display_name,
      active_conditions: c.active_conditions,
      signal: await computeSignal(c, plansByClient.get(c.client_id) ?? [], todayStr),
    })),
  );

  // Group by section
  const grouped = {
    follow_up_due: [],
    protocol_complete: [],
    labs_pending: [],
    returning: [],
    new_client: [],
    active: [],
  } as Record<SignalKind, TriageRow[]>;
  for (const r of rows) grouped[r.signal.kind].push(r);

  const totalClients = clients.length;
  const monthLabel = new Date().toLocaleDateString("en-GB", { month: "short" });
  const needsAttention =
    grouped.follow_up_due.length +
    grouped.protocol_complete.length +
    grouped.labs_pending.length +
    grouped.returning.length;

  // Upcoming follow-ups (next 7 days)
  const in7 = new Date(todayStr);
  in7.setDate(in7.getDate() + 7);
  const in7Str = in7.toISOString().slice(0, 10);
  const upcoming = (clients as ClientRow[])
    .filter(
      (c) =>
        c.next_contact_date &&
        c.next_contact_date > todayStr &&
        c.next_contact_date <= in7Str,
    )
    .sort((a, b) => (a.next_contact_date ?? "").localeCompare(b.next_contact_date ?? ""));

  // Broadcast panel
  const aisensyApiKeySet = !!process.env.AISENSY_API_KEY;
  const broadcastClientRows = (clients as ClientRow[]).map((c) => ({
    client_id: c.client_id,
    display_name: c.display_name,
    mobile_number: c.mobile_number,
    email: c.email,
    next_contact_date: c.next_contact_date,
  }));
  const followUpDueIds = grouped.follow_up_due.map((r) => r.client_id);
  const recheckDueIds = grouped.protocol_complete.map((r) => r.client_id);
  const activeIds = [
    ...grouped.active.map((r) => r.client_id),
    ...grouped.protocol_complete.map((r) => r.client_id),
  ];

  const dateLabel = new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <FmAppShell activeNavId="dashboard" crumbs={[{ label: "Dashboard" }]}>
      <FmPageHeader
        title="Dashboard"
        subtitle={`Welcome back, Shivani. ${dateLabel}.`}
        rightSlot={
          <FmStatGrid cols={3}>
            <FmStatTile label="Clients" value={totalClients} />
            <FmStatTile
              label={`API spend · ${monthLabel} MTD`}
              value={
                <span>
                  <span
                    style={{
                      fontSize: 16,
                      fontWeight: 600,
                      color: "var(--fm-text-tertiary)",
                      marginRight: 2,
                    }}
                  >
                    ₹
                  </span>
                  {apiMtd.this_month_cost_inr.toLocaleString("en-IN", {
                    maximumFractionDigits: 0,
                  })}
                </span>
              }
              delta={
                apiMtd.this_month_calls > 0
                  ? {
                      text: `${apiMtd.this_month_calls} call${
                        apiMtd.this_month_calls === 1 ? "" : "s"
                      } · ${apiMtd.by_client.length} client${
                        apiMtd.by_client.length === 1 ? "" : "s"
                      }`,
                      trend: "flat",
                    }
                  : undefined
              }
            />
            <FmStatTile
              label="Need attention"
              value={needsAttention}
              highlight={needsAttention > 0}
            />
          </FmStatGrid>
        }
      />

      {/* Banners + strips above the triage sections */}
      <div style={{ display: "grid", gap: 14, marginBottom: 24 }}>
        {/* Broadcast — outbound WhatsApp to groups of clients. Promoted to
            the top per coach feedback 2026-05-13 — it's a primary daily
            action, not a "tucked at the bottom" panel. */}
        {aisensyApiKeySet && (
          <BroadcastPanel
            clients={broadcastClientRows}
            followUpDueIds={followUpDueIds}
            recheckDueIds={recheckDueIds}
            activeIds={activeIds}
          />
        )}

        {/* Catalogue commit — design 9A with change list disclosure */}
        <FmCatalogueCommitBanner initialStatus={catalogueStatus} />

        {/* AiSensy inbound messages — design 10A with unread badges */}
        <FmAisensyBanner messages={aisensyMessages} windowDays={7} inboxHref="/messages" />

        {/* Upcoming follow-ups (next 7 days, not yet due) */}
        {upcoming.length > 0 && (
          <FmPanel
            style={{
              background: "rgba(155, 89, 182, 0.06)",
              borderColor: "rgba(155, 89, 182, 0.25)",
              padding: "12px 16px",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div
                style={{
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: 0.7,
                  fontWeight: 700,
                  color: "#7d3c98",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span>📅</span>
                <span>Upcoming this week ({upcoming.length})</span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {upcoming.map((c) => (
                  <Link
                    key={c.client_id}
                    href={`/clients-v2/${c.client_id}`}
                    style={{
                      display: "inline-flex",
                      gap: 6,
                      alignItems: "center",
                      padding: "4px 10px",
                      background: "var(--fm-surface)",
                      border: "1px solid rgba(155, 89, 182, 0.25)",
                      borderRadius: "var(--fm-radius-pill)",
                      textDecoration: "none",
                      fontSize: 11.5,
                    }}
                  >
                    <span style={{ color: "#7d3c98", fontWeight: 600 }}>
                      {c.display_name ?? c.client_id}
                    </span>
                    <span style={{ color: "var(--fm-text-tertiary)" }}>·</span>
                    <FmChip tone="primary">{c.next_contact_date}</FmChip>
                  </Link>
                ))}
              </div>
            </div>
          </FmPanel>
        )}
      </div>

      {/* Triage sections — collapsible, zero-count gets faded green badge */}
      {totalClients === 0 ? (
        <FmPanel>
          <div
            style={{
              textAlign: "center",
              padding: "40px 16px",
              color: "var(--fm-text-secondary)",
            }}
          >
            <div style={{ fontSize: 32, marginBottom: 12 }}>👋</div>
            <h2
              style={{
                fontFamily: "var(--fm-font-display)",
                fontSize: 22,
                margin: "0 0 8px",
                color: "var(--fm-text-primary)",
              }}
            >
              Your practice begins here
            </h2>
            <p
              style={{
                fontSize: 13,
                margin: "0 auto 20px",
                maxWidth: 380,
                lineHeight: 1.55,
              }}
            >
              Add your first client to start. Every triage bucket, lab dashboard and
              protocol view fills in from real client data — nothing is faked.
            </p>
            <Link
              href="/clients-v2/new"
              style={{
                display: "inline-block",
                padding: "11px 22px",
                background: "var(--fm-primary)",
                color: "#fff",
                borderRadius: "var(--fm-radius-md)",
                textDecoration: "none",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              + Add first client
            </Link>
          </div>
        </FmPanel>
      ) : (
        <TriageSections grouped={grouped} />
      )}

      {/* (Broadcast panel moved to the top — above triage sections.) */}
    </FmAppShell>
  );
}
