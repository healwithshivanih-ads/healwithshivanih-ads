/**
 * /calendar — month-view calendar of sessions + follow-up reminders +
 * plan-recheck dates across every client.
 *
 * Server: loads all clients, all plans, all sessions per client. Walks
 * them into a flat CalendarEvent[] keyed by date, hands to the client
 * grid component for navigation. URL-driven month (?ym=YYYY-MM).
 *
 * Design punch-list #32.
 */
import { FmAppShell, FmPageHeader, FmPanel } from "@/components/fm";
import { loadAllClients, loadAllPlans } from "@/lib/fmdb/loader";
import { loadClientSessions } from "@/lib/fmdb/loader-extras";
import { effectiveRecheckDate } from "@/lib/fmdb/plan-timing";
import { CalendarMonthGrid, type CalendarEvent } from "./calendar-month-grid";

export const dynamic = "force-dynamic";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function isYm(s: string | undefined): s is string {
  return !!s && /^\d{4}-\d{2}$/.test(s);
}

function shortName(c: { display_name?: string; client_id: string }): string {
  const dn = (c.display_name ?? "").trim();
  if (!dn) return c.client_id;
  // First name (display_name is "First Last" or pseudonym) — first whitespace token.
  return dn.split(/\s+/)[0] ?? dn;
}

function parseSessionType(presenting_complaints?: string): string {
  if (!presenting_complaints) return "session";
  const m = presenting_complaints.match(/^\[session_type:\s*([^\]]+)\]/);
  const t = m?.[1]?.trim();
  if (!t) return "session";
  // Pretty short labels for the chip
  return t === "discovery_consultation"
    ? "discovery"
    : t === "full_assessment"
      ? "intake"
      : t === "pre_intake"
        ? "intake"
        : t === "check_in"
          ? "check-in"
          : t === "quick_note"
            ? "quick note"
            : t;
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ ym?: string }>;
}) {
  const { ym: ymRaw } = await searchParams;
  const todayStr = todayISO();
  const ym = isYm(ymRaw) ? ymRaw : todayStr.slice(0, 7);

  const [clients, plans] = await Promise.all([
    loadAllClients(),
    loadAllPlans(),
  ]);

  // Load sessions for every client in parallel.
  // ClientSession YAMLs are small; this is fast even for 50+ clients.
  const sessionsByClient = await Promise.all(
    clients.map(async (c) => {
      const sessions = await loadClientSessions(c.client_id);
      return { client: c, sessions };
    }),
  );

  const events: CalendarEvent[] = [];

  // ── Past + today sessions across all clients ─────────────────────────
  for (const { client, sessions } of sessionsByClient) {
    const name = shortName(client);
    for (const s of sessions) {
      const date = (s as { date?: string }).date;
      if (!date) continue;
      const sessionId = (s as { session_id?: string }).session_id ?? "";
      const stype = parseSessionType((s as { presenting_complaints?: string }).presenting_complaints);
      events.push({
        date,
        kind: "session",
        label: `${name} · ${stype}`,
        clientId: client.client_id,
        href: `/clients-v2/${client.client_id}/sessions?sid=${sessionId}`,
        tooltip: `${client.display_name ?? client.client_id} — ${stype} on ${date}`,
      });
    }
  }

  // ── Follow-up reminders ──────────────────────────────────────────────
  // next_contact_date on the client → overdue (<= today) | upcoming (next 7d)
  // | future (any later date). The design punchlist says red for overdue +
  // amber for upcoming-7d; future dates beyond 7d we still surface as
  // upcoming so they're visible in their month.
  for (const c of clients) {
    const next = c.next_contact_date;
    if (!next) continue;
    const isOverdue = next < todayStr;
    const isUpcoming7d = !isOverdue && next <= addDays(todayStr, 7);
    events.push({
      date: next,
      kind: isOverdue ? "follow_up_due" : (isUpcoming7d ? "follow_up_upcoming" : "follow_up_upcoming"),
      label: `${shortName(c)} · follow-up`,
      clientId: c.client_id,
      href: `/clients-v2/${c.client_id}`,
      tooltip: `Follow-up due ${next} — ${c.display_name ?? c.client_id}`,
    });
  }

  // ── Plan recheck dates ───────────────────────────────────────────────
  // Uses EFFECTIVE recheck (lib/fmdb/plan-timing.ts) which accounts for
  // the 3-day meal-plan-adoption lag, or coach-asserted meal_plan_started_on.
  for (const p of plans) {
    const status = (p as { status?: string; _bucket?: string }).status
      ?? (p as { _bucket?: string })._bucket;
    if (status !== "published") continue;
    const clientId = (p as { client_id?: string }).client_id;
    if (!clientId) continue;
    const recheck = effectiveRecheckDate(p as Parameters<typeof effectiveRecheckDate>[0]);
    if (!recheck) continue;
    const client = clients.find((c) => c.client_id === clientId);
    events.push({
      date: recheck,
      kind: "recheck_due",
      label: `${client ? shortName(client) : clientId} · recheck`,
      clientId,
      href: `/clients-v2/${clientId}/plan`,
      tooltip: `Plan ${p.slug} recheck due ${recheck}`,
    });
  }

  return (
    <FmAppShell
      activeNavId="calendar"
      crumbs={[{ label: "Calendar" }]}
    >
      <FmPageHeader
        title="Calendar"
        subtitle="Sessions on record, follow-up reminders, and active-plan recheck dates across every client."
      />
      <FmPanel>
        <CalendarMonthGrid ym={ym} events={events} todayStr={todayStr} />
      </FmPanel>
    </FmAppShell>
  );
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
