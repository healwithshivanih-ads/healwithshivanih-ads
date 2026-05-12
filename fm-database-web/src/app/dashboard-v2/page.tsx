/**
 * /dashboard-v2 — Phase 0 smoke test for the new visual system.
 *
 * Same data + signal logic as the production dashboard at "/", rendered with
 * the new fm-v2 primitives (FmSidebarNav, FmTopBar, FmPanel, FmStatTile,
 * FmChip, FmStatusPill). This route renders the new shell as a full-viewport
 * overlay so the existing `/` UI stays untouched and the two can be compared
 * side-by-side.
 *
 * Phase 1 will replace this with a real shell layout once the visuals are
 * signed off.
 */
import Link from "next/link";
import { loadAllClients, loadAllPlans } from "@/lib/fmdb/loader";
import {
  FmSidebarNav,
  FmTopBar,
  FmPageHeader,
  FmPanel,
  FmStatTile,
  FmStatGrid,
  FmChip,
  type FmNavSection,
} from "@/components/fm";

export const dynamic = "force-dynamic";

// ── Types (parallel to / page) ─────────────────────────────────────────────

interface ClientRow {
  client_id: string;
  display_name?: string;
  active_conditions?: string[];
  next_contact_date?: string;
  email?: string;
}

interface PlanRow {
  slug: string;
  client_id?: string;
  status?: string;
  _bucket?: string;
  plan_period_recheck_date?: string;
}

type Signal =
  | { kind: "follow_up_due"; daysOverdue: number; dueDate: string }
  | { kind: "protocol_complete"; planSlug: string; recheckDate: string }
  | { kind: "labs_pending"; count: number }
  | { kind: "returning"; daysSince: number }
  | { kind: "new_client" }
  | { kind: "active"; planSlug: string; recheckDate?: string };

const ACTIVE_BUCKETS = new Set(["draft", "ready_to_publish", "published"]);

// Lightweight signal computation. The production dashboard at / does a richer
// version reading session_history + lab orders. For Phase 0 the goal is visual
// — we just need representative data flowing through the new primitives.
function computeSignal(
  client: ClientRow,
  plans: PlanRow[],
  todayStr: string,
): Signal {
  if (client.next_contact_date && client.next_contact_date <= todayStr) {
    const daysOverdue = Math.round(
      (new Date(todayStr).getTime() - new Date(client.next_contact_date).getTime()) /
        (1000 * 60 * 60 * 24),
    );
    return { kind: "follow_up_due", daysOverdue, dueDate: client.next_contact_date };
  }
  const overdue = plans.find(
    (p) =>
      (p._bucket ?? p.status) === "published" &&
      p.plan_period_recheck_date &&
      p.plan_period_recheck_date < todayStr,
  );
  if (overdue) {
    return {
      kind: "protocol_complete",
      planSlug: overdue.slug,
      recheckDate: overdue.plan_period_recheck_date!,
    };
  }
  const activePlan = plans.find((p) => ACTIVE_BUCKETS.has(p._bucket ?? p.status ?? ""));
  if (activePlan) {
    return {
      kind: "active",
      planSlug: activePlan.slug,
      recheckDate: activePlan.plan_period_recheck_date,
    };
  }
  return { kind: "new_client" };
}

const SECTION_META = {
  follow_up_due: {
    title: "Follow-ups due",
    icon: "📅",
    accent: "rgba(155, 89, 182, 0.10)",
    border: "rgba(155, 89, 182, 0.30)",
    badgeColor: "#7d3c98",
  },
  protocol_complete: {
    title: "Protocol complete — reassess",
    icon: "✅",
    accent: "rgba(46, 204, 113, 0.08)",
    border: "rgba(46, 204, 113, 0.30)",
    badgeColor: "var(--fm-success)",
  },
  labs_pending: {
    title: "Labs pending",
    icon: "🧪",
    accent: "rgba(214, 162, 162, 0.12)",
    border: "rgba(214, 162, 162, 0.40)",
    badgeColor: "#a85858",
  },
  returning: {
    title: "Returning clients",
    icon: "🔄",
    accent: "rgba(26, 127, 187, 0.08)",
    border: "rgba(26, 127, 187, 0.30)",
    badgeColor: "var(--fm-secondary)",
  },
  new_client: {
    title: "New — awaiting full assessment",
    icon: "🆕",
    accent: "rgba(247, 147, 30, 0.08)",
    border: "rgba(247, 147, 30, 0.30)",
    badgeColor: "var(--fm-accent-dark)",
  },
  active: {
    title: "Active protocols",
    icon: "📋",
    accent: "var(--fm-bg-cool)",
    border: "var(--fm-border)",
    badgeColor: "var(--fm-text-secondary)",
  },
} as const;

const SECTION_ORDER = [
  "follow_up_due",
  "protocol_complete",
  "labs_pending",
  "returning",
  "new_client",
  "active",
] as const;

const NAV: FmNavSection[] = [
  {
    label: "Workspace",
    items: [
      { id: "dashboard", label: "Dashboard", icon: "📊", href: "/dashboard-v2" },
      { id: "clients", label: "All clients", icon: "👥", href: "/clients" },
      { id: "calendar", label: "Calendar", icon: "🗓️", href: "/calendar" },
    ],
  },
  {
    label: "Tools",
    items: [
      { id: "new-client", label: "New client", icon: "➕", href: "/clients?new=1" },
      { id: "messages", label: "Messages", icon: "💬", href: "/messages" },
    ],
  },
  {
    label: "Knowledge base",
    items: [
      { id: "resources", label: "Resources", icon: "📚", href: "/resources" },
      { id: "mindmap", label: "Mind maps", icon: "🧭", href: "/mindmap" },
      { id: "backlog", label: "Backlog", icon: "📝", href: "/backlog" },
      { id: "ingest", label: "Ingest", icon: "⬆️", href: "/ingest" },
    ],
  },
  {
    label: "Settings",
    items: [
      { id: "settings", label: "Settings", icon: "⚙️", href: "/settings" },
      { id: "help", label: "Help", icon: "❔", href: "/help" },
    ],
  },
];

export default async function DashboardV2() {
  const todayStr = new Date().toISOString().slice(0, 10);
  const [clients, plans] = await Promise.all([loadAllClients(), loadAllPlans()]);

  const plansByClient = new Map<string, PlanRow[]>();
  for (const p of plans) {
    const cid = (p as Record<string, unknown>).client_id as string | undefined;
    if (!cid) continue;
    if (!plansByClient.has(cid)) plansByClient.set(cid, []);
    plansByClient.get(cid)!.push(p as unknown as PlanRow);
  }

  const rows = (clients as ClientRow[]).map((c) => ({
    client: c,
    signal: computeSignal(c, plansByClient.get(c.client_id) ?? [], todayStr),
  }));

  const grouped = new Map<Signal["kind"], typeof rows>();
  for (const k of SECTION_ORDER) grouped.set(k, []);
  for (const r of rows) grouped.get(r.signal.kind)!.push(r);

  const totalClients = clients.length;
  const totalPlans = plans.length;
  const needsAttention =
    (grouped.get("follow_up_due")?.length ?? 0) +
    (grouped.get("protocol_complete")?.length ?? 0) +
    (grouped.get("labs_pending")?.length ?? 0) +
    (grouped.get("returning")?.length ?? 0);

  const dateLabel = new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div
      className="fm-v2"
      style={{
        position: "fixed",
        inset: 0,
        overflow: "auto",
        zIndex: 100,
        display: "flex",
      }}
    >
      <FmSidebarNav
        sections={NAV}
        activeId="dashboard"
        brand={{ name: "shivani hari", eyebrow: "functional medicine", href: "/dashboard-v2" }}
        footer={
          <>
            <Link
              href="/"
              style={{ color: "rgba(255,255,255,0.7)", textDecoration: "underline" }}
            >
              ← Back to current UI
            </Link>
            <div style={{ marginTop: 6, fontSize: 10.5 }}>v2 preview · phase 0</div>
          </>
        }
      />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <FmTopBar
          crumbs={[{ label: "Dashboard" }]}
          user={{ initials: "SH", name: "Shivani Hari" }}
        />
        <main
          style={{
            flex: 1,
            padding: "var(--fm-page-pad)",
            overflowY: "auto",
            maxWidth: "1400px",
            width: "100%",
            margin: "0 auto",
          }}
        >
          <FmPageHeader
            title="Dashboard"
            subtitle={`Welcome back, Shivani. ${dateLabel}.`}
            rightSlot={
              <FmStatGrid cols={3}>
                <FmStatTile label="Clients" value={totalClients} />
                <FmStatTile label="Plans" value={totalPlans} />
                <FmStatTile
                  label="Need attention"
                  value={needsAttention}
                  highlight={needsAttention > 0}
                />
              </FmStatGrid>
            }
          />

          {/* Triage sections */}
          <div style={{ display: "grid", gap: 24 }}>
            {SECTION_ORDER.map((kind) => {
              const sectionRows = grouped.get(kind) ?? [];
              if (sectionRows.length === 0) return null;
              const meta = SECTION_META[kind];
              return (
                <section key={kind}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      marginBottom: 12,
                    }}
                  >
                    <span style={{ fontSize: 18 }}>{meta.icon}</span>
                    <h2
                      style={{
                        margin: 0,
                        fontSize: 13,
                        textTransform: "uppercase",
                        letterSpacing: 0.7,
                        fontWeight: 700,
                        color: "var(--fm-text-secondary)",
                        fontFamily: "var(--fm-font-body)",
                      }}
                    >
                      {meta.title}
                    </h2>
                    <span
                      style={{
                        fontSize: 11,
                        padding: "2px 8px",
                        background: meta.accent,
                        color: meta.badgeColor,
                        border: `1px solid ${meta.border}`,
                        borderRadius: "var(--fm-radius-pill)",
                        fontWeight: 700,
                      }}
                    >
                      {sectionRows.length}
                    </span>
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                      gap: 12,
                    }}
                  >
                    {sectionRows.map(({ client, signal }) => (
                      <Link
                        key={client.client_id}
                        href={`/clients/${client.client_id}`}
                        style={{ textDecoration: "none", color: "inherit" }}
                      >
                        <FmPanel
                          style={{
                            background: meta.accent,
                            borderColor: meta.border,
                            padding: "14px 16px",
                            transition: "all 200ms var(--fm-ease-out)",
                            cursor: "pointer",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "flex-start",
                              justifyContent: "space-between",
                              gap: 8,
                              marginBottom: 8,
                            }}
                          >
                            <div style={{ minWidth: 0 }}>
                              <div
                                style={{
                                  fontSize: 14,
                                  fontWeight: 700,
                                  color: "var(--fm-text-primary)",
                                  marginBottom: 2,
                                }}
                              >
                                {client.display_name ?? client.client_id}
                              </div>
                              <div
                                style={{
                                  fontFamily: "var(--fm-font-mono)",
                                  fontSize: 10.5,
                                  color: "var(--fm-text-tertiary)",
                                }}
                              >
                                {client.client_id}
                              </div>
                            </div>
                            <SignalBadge signal={signal} />
                          </div>

                          {(client.active_conditions ?? []).length > 0 && (
                            <div
                              style={{
                                display: "flex",
                                flexWrap: "wrap",
                                gap: 4,
                                marginBottom: 8,
                              }}
                            >
                              {(client.active_conditions ?? []).slice(0, 3).map((c) => (
                                <FmChip key={c} outline>
                                  {c}
                                </FmChip>
                              ))}
                              {(client.active_conditions ?? []).length > 3 && (
                                <span
                                  style={{
                                    fontSize: 10.5,
                                    color: "var(--fm-text-tertiary)",
                                    alignSelf: "center",
                                  }}
                                >
                                  +{(client.active_conditions ?? []).length - 3}
                                </span>
                              )}
                            </div>
                          )}

                          <div
                            style={{
                              fontSize: 12,
                              color: "var(--fm-primary)",
                              fontWeight: 600,
                              marginTop: 4,
                            }}
                          >
                            View client →
                          </div>
                        </FmPanel>
                      </Link>
                    ))}
                  </div>
                </section>
              );
            })}

            {totalClients === 0 && (
              <FmPanel>
                <div
                  style={{
                    textAlign: "center",
                    padding: "32px 16px",
                    color: "var(--fm-text-secondary)",
                  }}
                >
                  <p style={{ margin: "0 0 12px", fontSize: 14 }}>
                    No clients yet — add your first client to get started.
                  </p>
                  <Link
                    href="/clients?new=1"
                    style={{
                      display: "inline-block",
                      padding: "10px 18px",
                      background: "var(--fm-primary)",
                      color: "#fff",
                      borderRadius: "var(--fm-radius-md)",
                      textDecoration: "none",
                      fontSize: 13,
                      fontWeight: 600,
                    }}
                  >
                    + Add a client
                  </Link>
                </div>
              </FmPanel>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

function SignalBadge({ signal }: { signal: Signal }) {
  if (signal.kind === "follow_up_due") {
    return (
      <FmChip tone="warning">
        {signal.daysOverdue === 0 ? "due today" : `${signal.daysOverdue}d overdue`}
      </FmChip>
    );
  }
  if (signal.kind === "protocol_complete") {
    return <FmChip tone="success">recheck {signal.recheckDate}</FmChip>;
  }
  if (signal.kind === "labs_pending") {
    return <FmChip tone="danger">{signal.count} tests</FmChip>;
  }
  if (signal.kind === "returning") {
    return <FmChip tone="secondary">{signal.daysSince}d ago</FmChip>;
  }
  if (signal.kind === "new_client") {
    return <FmChip tone="primary">awaiting assessment</FmChip>;
  }
  if (signal.kind === "active" && signal.recheckDate) {
    return <FmChip>recheck {signal.recheckDate}</FmChip>;
  }
  return <FmChip>active</FmChip>;
}
