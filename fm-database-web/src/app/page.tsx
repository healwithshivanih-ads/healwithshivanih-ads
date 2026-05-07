import Link from "next/link";
import { loadAllClients, loadAllPlans } from "@/lib/fmdb/loader";
import { loadClientSessions, getRecentAisensyMessages } from "@/lib/fmdb/loader-extras";
import { parseSessionType, parseRequestedLabs } from "@/lib/fmdb/session-utils";
import { getCatalogueStatus } from "./catalogue-commit-action";
import { CatalogueCommitButton } from "./catalogue-commit-button";
import { BroadcastPanel } from "./broadcast-panel";

export const dynamic = "force-dynamic";

// ── Types ─────────────────────────────────────────────────────────────────────

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
  plan_period_start?: string;
  plan_period_weeks?: number;
}

type TriageSignal =
  | { kind: "labs_pending";       labs: string[]; sessionDate?: string }
  | { kind: "protocol_complete";  planSlug: string; recheckDate: string }
  | { kind: "returning";          daysSince: number; lastDate: string }
  | { kind: "follow_up_due";      dueDate: string; daysOverdue: number }
  | { kind: "new_client";         sessionDate?: string }
  | { kind: "active";             planSlug: string; recheckDate?: string };

interface TriageClient {
  client: ClientRow;
  signal: TriageSignal;
}

const ACTIVE_BUCKETS = new Set(["draft", "ready_to_publish", "published"]);

// ── Data helpers ──────────────────────────────────────────────────────────────

async function computeSignal(
  client: ClientRow,
  clientPlans: PlanRow[],
  todayStr: string,
): Promise<TriageSignal> {
  const activePlans = clientPlans.filter((p) =>
    ACTIVE_BUCKETS.has(p._bucket ?? p.status ?? "")
  );

  // Explicit coach follow-up reminder (highest priority — coach set it intentionally)
  if (client.next_contact_date && client.next_contact_date <= todayStr) {
    const daysOverdue = Math.round(
      (new Date(todayStr).getTime() - new Date(client.next_contact_date).getTime()) / (1000 * 60 * 60 * 24)
    );
    return { kind: "follow_up_due", dueDate: client.next_contact_date, daysOverdue };
  }

  // Published plan past recheck → highest priority (still active but needs reassessment)
  // Also compute recheck date from plan_period_start + plan_period_weeks when explicit date not set.
  const overduePlan = clientPlans.find((p) => {
    if ((p._bucket ?? p.status) !== "published") return false;
    // Explicit recheck date
    if (p.plan_period_recheck_date) return p.plan_period_recheck_date < todayStr;
    // Compute from start + weeks
    const start = p.plan_period_start;
    const weeks = p.plan_period_weeks;
    if (start && weeks && weeks > 0) {
      const recheckDate = new Date(start + "T00:00:00");
      recheckDate.setDate(recheckDate.getDate() + weeks * 7);
      return recheckDate.toISOString().slice(0, 10) < todayStr;
    }
    return false;
  });
  if (overduePlan) {
    // Resolve a display recheck date
    let recheckDate = overduePlan.plan_period_recheck_date;
    if (!recheckDate) {
      const start = overduePlan.plan_period_start;
      const weeks = overduePlan.plan_period_weeks;
      if (start && weeks) {
        const d = new Date(start + "T00:00:00");
        d.setDate(d.getDate() + weeks * 7);
        recheckDate = d.toISOString().slice(0, 10);
      }
    }
    return {
      kind: "protocol_complete",
      planSlug: overduePlan.slug,
      recheckDate: recheckDate ?? todayStr,
    };
  }

  // Active plans without overdue recheck → stable
  if (activePlans.length > 0) {
    const published = activePlans.find((p) => (p._bucket ?? p.status) === "published");
    return {
      kind: "active",
      planSlug: published?.slug ?? activePlans[0].slug,
      recheckDate: published?.plan_period_recheck_date,
    };
  }

  // No active plans — need session data for the rest
  let sessions: Record<string, unknown>[] = [];
  try {
    sessions = (await loadClientSessions(client.client_id)) as Record<string, unknown>[];
  } catch {
    return { kind: "new_client" };
  }

  if (sessions.length === 0) return { kind: "new_client" };

  // Pending labs: most recent session with requested_labs, no full_assessment after
  const labIdx = sessions.findIndex((s) => {
    const labs = parseRequestedLabs(s.coach_notes as string | undefined);
    return labs.length > 0;
  });
  if (labIdx !== -1) {
    const hasAssessmentAfter = sessions
      .slice(0, labIdx)
      .some((s) => parseSessionType(s.presenting_complaints as string | undefined) === "full_assessment");
    if (!hasAssessmentAfter) {
      return {
        kind: "labs_pending",
        labs: parseRequestedLabs(sessions[labIdx].coach_notes as string | undefined),
        sessionDate: sessions[labIdx].date as string | undefined,
      };
    }
  }

  // Returning: had full assessment, 28+ days since any session
  const hadFullAssessment = sessions.some(
    (s) => parseSessionType(s.presenting_complaints as string | undefined) === "full_assessment"
  );
  const mostRecentDate = sessions[0]?.date as string | undefined;
  if (hadFullAssessment && mostRecentDate) {
    const daysSince = Math.round(
      (Date.now() - new Date(mostRecentDate).getTime()) / (1000 * 60 * 60 * 24)
    );
    if (daysSince >= 28) {
      return { kind: "returning", daysSince, lastDate: mostRecentDate };
    }
  }

  // Pre-intake done but no full assessment
  const hadPreIntake = sessions.some(
    (s) => parseSessionType(s.presenting_complaints as string | undefined) === "pre_intake"
  );
  if (hadPreIntake && !hadFullAssessment) {
    return { kind: "new_client", sessionDate: sessions[0]?.date as string | undefined };
  }

  return { kind: "new_client" };
}

// ── Dashboard sections config ─────────────────────────────────────────────────

const SECTION_ORDER = ["follow_up_due", "protocol_complete", "labs_pending", "returning", "new_client", "active"] as const;
type SectionKind = (typeof SECTION_ORDER)[number];

const SECTION_META: Record<SectionKind, { title: string; icon: string; accent: string; cta: string; ctaHref: (c: TriageClient) => string }> = {
  follow_up_due: {
    title: "Follow-ups due",
    icon: "📅",
    accent: "border-violet-300 bg-violet-50",
    cta: "📞 Contact",
    ctaHref: (c) => `/clients/${c.client.client_id}`,
  },
  protocol_complete: {
    title: "Protocol complete — reassess",
    icon: "✅",
    accent: "border-emerald-300 bg-emerald-50",
    cta: "🧠 Record session",
    ctaHref: (c) => `/clients/${c.client.client_id}?tab=sessions`,
  },
  labs_pending: {
    title: "Labs pending",
    icon: "🧪",
    accent: "border-[#D6A2A2] bg-[#D6A2A2]/10",
    cta: "🧪 Record results",
    ctaHref: (c) => `/clients/${c.client.client_id}?tab=sessions`,
  },
  returning: {
    title: "Returning clients",
    icon: "🔄",
    accent: "border-blue-200 bg-blue-50",
    cta: "🗓 Record session",
    ctaHref: (c) => `/clients/${c.client.client_id}?tab=sessions`,
  },
  new_client: {
    title: "New — awaiting full assessment",
    icon: "🆕",
    accent: "border-amber-200 bg-amber-50",
    cta: "🗓 Record session",
    ctaHref: (c) => `/clients/${c.client.client_id}?tab=sessions`,
  },
  active: {
    title: "Active protocols",
    icon: "📋",
    accent: "border-border bg-muted/20",
    cta: "View plan",
    ctaHref: (c) => {
      const sig = c.signal as { kind: "active"; planSlug: string };
      return `/plans/${sig.planSlug}`;
    },
  },
};

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function Dashboard() {
  const todayStr = new Date().toISOString().slice(0, 10);
  const [clients, plans, catalogueStatus] = await Promise.all([
    loadAllClients(),
    loadAllPlans(),
    getCatalogueStatus(),
  ]);

  // AiSensy inbound messages (last 7 days)
  const clientNameMap = new Map(
    (clients as ClientRow[]).map((c) => [c.client_id, c.display_name ?? c.client_id])
  );
  const aisensyMessages = await getRecentAisensyMessages(
    (clients as ClientRow[]).map((c) => c.client_id),
    clientNameMap,
    7
  );

  // Build per-client plan lookup
  const plansByClient = new Map<string, PlanRow[]>();
  for (const p of plans) {
    const cid = (p as Record<string, unknown>).client_id as string | undefined;
    if (!cid) continue;
    if (!plansByClient.has(cid)) plansByClient.set(cid, []);
    plansByClient.get(cid)!.push(p as unknown as PlanRow);
  }

  // Compute signal for every client in parallel
  const triageRows: TriageClient[] = await Promise.all(
    (clients as ClientRow[]).map(async (c) => ({
      client: c,
      signal: await computeSignal(c, plansByClient.get(c.client_id) ?? [], todayStr),
    }))
  );

  // Group by section
  const sections = new Map<SectionKind, TriageClient[]>();
  for (const kind of SECTION_ORDER) sections.set(kind, []);
  for (const row of triageRows) sections.get(row.signal.kind as SectionKind)!.push(row);

  // Stats
  const totalClients = clients.length;
  const totalPlans = plans.length;
  const needsAttention = (sections.get("follow_up_due")?.length ?? 0)
    + (sections.get("protocol_complete")?.length ?? 0)
    + (sections.get("labs_pending")?.length ?? 0)
    + (sections.get("returning")?.length ?? 0);

  // Broadcast panel — only shown when AISENSY_API_KEY is configured
  const aisensyApiKeySet = !!(process.env.AISENSY_API_KEY);
  const broadcastClientRows = (clients as ClientRow[]).map((c) => ({
    client_id: c.client_id,
    display_name: c.display_name,
    mobile_number: (c as unknown as Record<string, unknown>).mobile_number as string | undefined,
    next_contact_date: c.next_contact_date,
  }));
  const followUpDueIds = (sections.get("follow_up_due") ?? []).map((r) => r.client.client_id);
  const recheckDueIds = (sections.get("protocol_complete") ?? []).map((r) => r.client.client_id);
  const activeIds = [
    ...(sections.get("active") ?? []).map((r) => r.client.client_id),
    ...(sections.get("protocol_complete") ?? []).map((r) => r.client.client_id),
  ];

  // Upcoming follow-ups (next 7 days, not yet due)
  const in7 = new Date(todayStr);
  in7.setDate(in7.getDate() + 7);
  const in7Str = in7.toISOString().slice(0, 10);
  const upcomingFollowUps = (clients as ClientRow[]).filter(
    (c) => c.next_contact_date && c.next_contact_date > todayStr && c.next_contact_date <= in7Str
  ).sort((a, b) => (a.next_contact_date ?? "").localeCompare(b.next_contact_date ?? ""));

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold" style={{ color: "var(--brand-indigo)" }}>
            FM Coach
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          </p>
        </div>
        {/* Quick stats */}
        <div className="flex gap-3 shrink-0">
          {[
            { label: "Clients",        value: totalClients },
            { label: "Plans",          value: totalPlans   },
            { label: "Need attention", value: needsAttention, highlight: needsAttention > 0 },
          ].map(({ label, value, highlight }) => (
            <div
              key={label}
              className={`text-center px-4 py-2 rounded-lg border ${highlight ? "bg-red-50 border-red-200" : "bg-muted/30 border-border"}`}
            >
              <div className={`text-xl font-bold ${highlight ? "text-red-700" : ""}`}>{value}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Catalogue commit widget — shows only when uncommitted changes exist */}
      <CatalogueCommitButton initialStatus={catalogueStatus} />

      {/* AiSensy inbound WhatsApp messages (last 7 days) */}
      {aisensyMessages.length > 0 && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-wide text-emerald-800 flex items-center gap-1.5 mb-1">
                <span>💬</span>
                <span>{aisensyMessages.length} new WhatsApp message{aisensyMessages.length !== 1 ? "s" : ""} (last 7 days)</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {aisensyMessages.slice(0, 5).map((msg, i) => (
                  <Link
                    key={i}
                    href={`/clients/${msg.client_id}?tab=sessions`}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-emerald-200 text-xs hover:bg-emerald-50 transition-colors max-w-[240px]"
                  >
                    <span className="font-medium text-emerald-800 shrink-0">{msg.display_name ?? msg.client_id}</span>
                    <span className="text-emerald-400">·</span>
                    <span className="text-emerald-700 truncate">{msg.text || "—"}</span>
                  </Link>
                ))}
                {aisensyMessages.length > 5 && (
                  <span className="text-xs text-emerald-700 self-center">+{aisensyMessages.length - 5} more</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Upcoming follow-ups strip (next 7 days, not yet overdue) */}
      {upcomingFollowUps.length > 0 && (
        <div className="rounded-xl border border-violet-200 bg-violet-50/50 px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-violet-700 mb-2 flex items-center gap-1.5">
            <span>📅</span> Upcoming this week
          </div>
          <div className="flex flex-wrap gap-2">
            {upcomingFollowUps.map((c) => (
              <Link
                key={c.client_id}
                href={`/clients/${c.client_id}`}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-violet-200 text-xs hover:bg-violet-50 transition-colors"
              >
                <span className="font-medium text-violet-800">{c.display_name ?? c.client_id}</span>
                <span className="text-violet-400">·</span>
                <span className="text-violet-600">{c.next_contact_date}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Triage sections */}
      {SECTION_ORDER.map((kind) => {
        const rows = sections.get(kind) ?? [];
        if (rows.length === 0) return null;
        const meta = SECTION_META[kind];
        return (
          <section key={kind}>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3 flex items-center gap-2">
              <span>{meta.icon}</span>
              <span>{meta.title}</span>
              <span className="ml-1 text-xs px-1.5 rounded-full bg-muted">{rows.length}</span>
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {rows.map(({ client, signal }) => (
                <div
                  key={client.client_id}
                  className={`rounded-xl border-2 px-4 py-3 flex flex-col gap-2 ${meta.accent}`}
                >
                  {/* Client identity */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link
                        href={`/clients/${client.client_id}`}
                        className="text-sm font-semibold hover:underline truncate block"
                        style={{ color: "var(--brand-indigo)" }}
                      >
                        {client.display_name ?? client.client_id}
                      </Link>
                      <div className="text-[11px] text-muted-foreground font-mono">
                        {client.client_id}
                      </div>
                    </div>
                    {/* Signal detail */}
                    <div className="text-xs text-right shrink-0">
                      {signal.kind === "follow_up_due" && (
                        <span className="text-violet-700 font-medium">
                          {(signal as { daysOverdue: number }).daysOverdue === 0
                            ? "due today"
                            : `${(signal as { daysOverdue: number }).daysOverdue}d overdue`}
                        </span>
                      )}
                      {signal.kind === "protocol_complete" && (
                        <span className="text-emerald-700 font-medium">
                          recheck {(signal as { recheckDate: string }).recheckDate}
                        </span>
                      )}
                      {signal.kind === "labs_pending" && (
                        <span className="text-[#7A3D3D] font-medium">
                          {(signal as { labs: string[] }).labs.length} test{(signal as { labs: string[] }).labs.length !== 1 ? "s" : ""}
                        </span>
                      )}
                      {signal.kind === "returning" && (
                        <span className="text-blue-700 font-medium">
                          {(signal as { daysSince: number }).daysSince}d ago
                        </span>
                      )}
                      {signal.kind === "new_client" && (signal as { sessionDate?: string }).sessionDate && (
                        <span className="text-amber-700 font-medium">
                          {(signal as { sessionDate: string }).sessionDate}
                        </span>
                      )}
                      {signal.kind === "active" && (signal as { recheckDate?: string }).recheckDate && (
                        <span className="text-muted-foreground">
                          recheck {(signal as { recheckDate: string }).recheckDate}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Conditions */}
                  {(client.active_conditions ?? []).length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {(client.active_conditions ?? []).slice(0, 3).map((c) => (
                        <span
                          key={c}
                          className="text-[10px] px-1.5 py-0.5 rounded border bg-white/60 text-muted-foreground"
                        >
                          {c}
                        </span>
                      ))}
                      {(client.active_conditions ?? []).length > 3 && (
                        <span className="text-[10px] text-muted-foreground">
                          +{(client.active_conditions ?? []).length - 3}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Labs pending detail */}
                  {signal.kind === "labs_pending" && (
                    <div className="flex flex-wrap gap-1">
                      {(signal as { labs: string[] }).labs.slice(0, 3).map((lab) => (
                        <span
                          key={lab}
                          className="text-[10px] px-1.5 py-0.5 rounded border border-[#D6A2A2] bg-white/60 text-[#7A3D3D]"
                        >
                          {lab}
                        </span>
                      ))}
                      {(signal as { labs: string[] }).labs.length > 3 && (
                        <span className="text-[10px] text-[#7A3D3D]">
                          +{(signal as { labs: string[] }).labs.length - 3} more
                        </span>
                      )}
                    </div>
                  )}

                  {/* CTA */}
                  <div className="flex items-center gap-2 mt-auto pt-1 flex-wrap">
                    <Link
                      href={meta.ctaHref({ client, signal })}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-all hover:opacity-90"
                      style={{ background: "var(--brand-indigo)", color: "#fff" }}
                    >
                      {meta.cta}
                    </Link>
                    <Link
                      href={`/clients/${client.client_id}`}
                      className="text-xs text-muted-foreground hover:underline"
                    >
                      View →
                    </Link>
                    {client.email && (
                      <a
                        href={`mailto:${client.email}`}
                        className="text-xs text-muted-foreground hover:text-blue-600 hover:underline"
                        title={`Email ${client.display_name ?? client.client_id}`}
                      >
                        ✉ Email
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}

      {totalClients === 0 && (
        <div className="rounded-xl border-2 border-dashed border-border p-12 text-center">
          <p className="text-muted-foreground text-sm">No clients yet.</p>
          <Link href="/clients" className="mt-3 inline-block text-sm font-medium underline">
            Add your first client →
          </Link>
        </div>
      )}

      {/* Broadcast panel — WhatsApp outbound to groups of clients */}
      {aisensyApiKeySet && (
        <BroadcastPanel
          clients={broadcastClientRows}
          followUpDueIds={followUpDueIds}
          recheckDueIds={recheckDueIds}
          activeIds={activeIds}
        />
      )}
    </div>
  );
}
