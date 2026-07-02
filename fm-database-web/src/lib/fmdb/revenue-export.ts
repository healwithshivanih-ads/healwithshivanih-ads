/**
 * Revenue export (growth-system Loop 1) — fm-coach → ochre-funnel.
 *
 * One webhook, three event types: payment / programme_completed /
 * active_client_count. Contract: docs/REVENUE_EXPORT_CONTRACT.md (canonical
 * copy in ochre-funnel/docs/ — that one wins on divergence).
 *
 * Durable outbox at ~/fm-plans/_revenue_export_outbox.yaml (same discipline as
 * _pending_sends.yaml): emit appends a pending row (idempotent on event_id),
 * then best-effort flushes inline. Failures stay pending and drain on the
 * daily /api/cron/revenue-export tick. Sent rows are kept as the audit trail.
 *
 * Unconfigured (OCHRE_FUNNEL_REVENUE_URL / FM_REVENUE_EXPORT_SECRET unset) →
 * flush is a no-op; the outbox still records, so history backfills on first
 * configure.
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
// No top-level "@/" alias imports — the vitest convention (see lab-orders.ts);
// fs helpers dynamically import "@/…/paths" instead.
import { hasPlanStarted } from "./plan-timing";

export type RevenueEventType = "payment" | "programme_completed" | "active_client_count";
export type RevenueProduct = "lab" | "maintenance" | "programme" | "consultation" | "triage" | "other";

export interface RevenueClientKey {
  client_id: string | null;
  email: string | null;
  phone_e164: string | null;
}

export interface RevenueEventInput {
  event_id: string;
  event_type: RevenueEventType;
  occurred_at: string;
  data: Record<string, unknown>;
}

export interface OutboxRow extends RevenueEventInput {
  status: "pending" | "sent";
  attempts: number;
  last_error?: string | null;
  created_at: string;
  sent_at?: string | null;
}

const OUTBOX_FILE = "_revenue_export_outbox.yaml";

// ── Pure builders ────────────────────────────────────────────────────────────

export function buildPaymentEvent(input: {
  product: RevenueProduct;
  amountPaisa: number;
  razorpayPaymentId?: string | null;
  paidAt?: string | null;
  client: RevenueClientKey;
}): RevenueEventInput {
  const paidAt = input.paidAt || new Date().toISOString();
  const rzp = input.razorpayPaymentId || null;
  const event_id = rzp
    ? `payment:${rzp}`
    : `payment:manual:${input.client.client_id ?? "unknown"}:${paidAt.slice(0, 10)}:${input.product}`;
  return {
    event_id,
    event_type: "payment",
    occurred_at: paidAt,
    data: {
      product: input.product,
      amount_paisa: Math.round(input.amountPaisa),
      currency: "INR",
      razorpay_payment_id: rzp,
      paid_at: paidAt,
      client: input.client,
    },
  };
}

export function buildProgrammeCompletedEvent(input: {
  planSlug: string;
  completedAt?: string | null;
  client: RevenueClientKey;
}): RevenueEventInput {
  const completedAt = input.completedAt || new Date().toISOString();
  return {
    event_id: `programme_completed:${input.planSlug}`,
    event_type: "programme_completed",
    occurred_at: completedAt,
    data: { plan_slug: input.planSlug, completed_at: completedAt, client: input.client },
  };
}

export interface ActiveClientBreakdown {
  active_care: number;
  awaiting_start: number;
  onboarding: number;
  maintenance: number;
}

export function buildActiveClientCountEvent(
  breakdown: ActiveClientBreakdown,
  signupsThisWeek: number,
  config: { maxActiveClients: number; maxNewSignupsPerWeek: number; discoveryCallsPerWeek: number },
  asOf: string,
): RevenueEventInput {
  // Minute-resolution IST key: deterministic within a minute (dedupes double
  // fires) while allowing multiple snapshots per day — applying a snapshot is
  // idempotent on the receiver (it upserts the latest, guarded by as_of).
  const istMinute = new Date(new Date(asOf).getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 16);
  return {
    event_id: `active_client_count:${istMinute}`,
    event_type: "active_client_count",
    occurred_at: asOf,
    data: {
      active_clients: breakdown.active_care + breakdown.awaiting_start + breakdown.onboarding,
      max_active_clients: config.maxActiveClients,
      // The weekly intake throttle (coach input 2026-07-02, corrected): the
      // practice caps NEW SIGNUPS at 20/week — that, not total load, is what
      // gates lead-buying week to week. Trailing 7 days, not calendar week.
      signups_this_week: signupsThisWeek,
      max_new_signups_per_week: config.maxNewSignupsPerWeek,
      discovery_calls_per_week: config.discoveryCallsPerWeek,
      breakdown,
      as_of: asOf,
    },
  };
}

/**
 * New signups in the trailing 7 days. A signup = programme enrolment:
 * `programme_started_at` (stamped by the programme-signup handover) inside the
 * window, or — for clients the coach enrols by hand — a record created inside
 * the window that's already `engagement_status: signed_up` /
 * `lifecycle_state: programme_active`.
 */
export function countSignupsThisWeek(
  clients: Array<CountClient & { programme_started_at?: string; created_at?: string }>,
  nowIso: string,
): number {
  const windowStart = new Date(nowIso).getTime() - 7 * 24 * 3600 * 1000;
  const inWindow = (iso: string | undefined): boolean => {
    if (!iso) return false;
    const t = Date.parse(iso);
    return Number.isFinite(t) && t >= windowStart && t <= Date.parse(nowIso);
  };
  let n = 0;
  for (const c of clients) {
    if (c.engagement_status === "declined") continue;
    const enrolled =
      c.lifecycle_state === "programme_active" || c.engagement_status === "signed_up";
    if (inWindow(c.programme_started_at) || (enrolled && inWindow(c.created_at))) n += 1;
  }
  return n;
}

/** Minimal shapes for the count — both are loaded YAML, so fields are loose. */
export interface CountClient {
  client_id?: string;
  engagement_status?: string;
  lifecycle_state?: string;
  maintenance_status?: string | null;
}
export interface CountPlan {
  client_id?: string;
  slug?: string;
  status?: string;
  _bucket?: string;
  meal_plan_started_on?: string;
  plan_period_start?: string;
}

/**
 * "Committed clients" for the capacity interlock: every client the coach must
 * serve. A published-but-not-started plan still occupies a slot; maintenance
 * clients are reported but excluded from the cap (much lighter touch).
 * Maintenance plans themselves are published Plans — their slugs carry
 * "-maintenance-" (v0.68 intent picker), so they signal maintenance, not
 * active care.
 */
export function computeActiveClientCounts(
  clients: CountClient[],
  plans: CountPlan[],
  todayYmd: string,
): ActiveClientBreakdown {
  const isMaintenancePlan = (p: CountPlan) => (p.slug ?? "").includes("-maintenance-");
  const publishedBy = new Map<string, CountPlan[]>();
  const maintenancePlanClients = new Set<string>();
  const graduatedClients = new Set<string>();
  for (const p of plans) {
    const cid = p.client_id ?? "";
    if (!cid) continue;
    const state = p._bucket ?? p.status ?? "";
    if (state === "graduated") graduatedClients.add(cid);
    if (state !== "published") continue;
    if (isMaintenancePlan(p)) {
      maintenancePlanClients.add(cid);
    } else {
      const list = publishedBy.get(cid) ?? [];
      list.push(p);
      publishedBy.set(cid, list);
    }
  }

  const breakdown: ActiveClientBreakdown = { active_care: 0, awaiting_start: 0, onboarding: 0, maintenance: 0 };
  for (const c of clients) {
    const cid = c.client_id ?? "";
    if (!cid) continue;
    if (c.engagement_status === "declined") continue;
    const published = publishedBy.get(cid) ?? [];
    if (c.maintenance_status === "active" || (published.length === 0 && maintenancePlanClients.has(cid))) {
      breakdown.maintenance += 1;
    } else if (published.length > 0) {
      if (published.some((p) => hasPlanStarted(p, todayYmd))) breakdown.active_care += 1;
      else breakdown.awaiting_start += 1;
    } else if (graduatedClients.has(cid)) {
      breakdown.maintenance += 1; // alumni — reported with maintenance, off the cap
    } else if (c.lifecycle_state === "programme_active" || c.engagement_status === "signed_up") {
      breakdown.onboarding += 1;
    }
  }
  return breakdown;
}

/** Append if the event_id isn't already in the outbox. Pure. */
export function appendIfNew(rows: OutboxRow[], ev: RevenueEventInput, nowIso: string): { rows: OutboxRow[]; added: boolean } {
  if (rows.some((r) => r.event_id === ev.event_id)) return { rows, added: false };
  return {
    rows: [...rows, { ...ev, status: "pending", attempts: 0, created_at: nowIso, sent_at: null }],
    added: true,
  };
}

// ── Outbox IO ────────────────────────────────────────────────────────────────

async function outboxPath(): Promise<string> {
  const { getPlansRoot } = await import("@/lib/fmdb/paths");
  return path.join(getPlansRoot(), OUTBOX_FILE);
}

async function readOutbox(): Promise<OutboxRow[]> {
  let raw: string;
  try {
    raw = await fs.readFile(await outboxPath(), "utf-8");
  } catch (e) {
    // ENOENT → empty queue. Any OTHER read error must NOT read as empty
    // (audit Phase-1b scar: a corrupt/locked file read as [] gets overwritten).
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw e;
  }
  const parsed = yaml.load(raw);
  return Array.isArray(parsed) ? (parsed as OutboxRow[]) : [];
}

async function writeOutbox(rows: OutboxRow[]): Promise<void> {
  await fs.writeFile(await outboxPath(), yaml.dump(rows, { lineWidth: 120 }), "utf-8");
}

// ── Config + transport ───────────────────────────────────────────────────────

function exportConfig(): { url: string; secret: string } | null {
  const url = (process.env.OCHRE_FUNNEL_REVENUE_URL ?? "").replace(/\/$/, "");
  const secret = process.env.FM_REVENUE_EXPORT_SECRET ?? "";
  if (!url || !secret) return null;
  return { url, secret };
}

function capacityConfig(): { maxActiveClients: number; maxNewSignupsPerWeek: number; discoveryCallsPerWeek: number } {
  // Coach input 2026-07-02 (corrected): the practice holds 100 active clients;
  // the weekly throttle is 20 NEW SIGNUPS — that's what gates lead-buying.
  const max = Number(process.env.FM_MAX_ACTIVE_CLIENTS ?? "100");
  const signups = Number(process.env.FM_MAX_SIGNUPS_PER_WEEK ?? "20");
  const calls = Number(process.env.FM_DISCOVERY_CALLS_PER_WEEK ?? "8");
  return {
    maxActiveClients: Number.isFinite(max) && max > 0 ? max : 100,
    maxNewSignupsPerWeek: Number.isFinite(signups) && signups > 0 ? signups : 20,
    discoveryCallsPerWeek: Number.isFinite(calls) && calls > 0 ? calls : 8,
  };
}

async function postEvent(cfg: { url: string; secret: string }, ev: RevenueEventInput): Promise<{ ok: boolean; error?: string }> {
  const body = JSON.stringify({
    version: 1,
    source: "fm-coach",
    event_id: ev.event_id,
    event_type: ev.event_type,
    occurred_at: ev.occurred_at,
    data: ev.data,
  });
  const signature = crypto.createHmac("sha256", cfg.secret).update(body).digest("hex");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(cfg.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-fm-coach-signature": signature },
      body,
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, error: `HTTP ${res.status}: ${detail.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Record an event in the outbox (idempotent on event_id) and best-effort flush.
 * Never throws — a revenue-export failure must never break a payment webhook.
 */
export async function emitRevenueEvent(ev: RevenueEventInput): Promise<{ ok: boolean; added: boolean }> {
  try {
    const rows = await readOutbox();
    const { rows: next, added } = appendIfNew(rows, ev, new Date().toISOString());
    if (added) await writeOutbox(next);
    await flushRevenueOutbox();
    return { ok: true, added };
  } catch (e) {
    console.error("[revenue-export] emit failed:", (e as Error).message);
    return { ok: false, added: false };
  }
}

/** Drain every pending row. Returns counts for the cron response. */
export async function flushRevenueOutbox(): Promise<{ sent: number; failed: number; pending: number }> {
  const cfg = exportConfig();
  const rows = await readOutbox();
  const pendingRows = rows.filter((r) => r.status === "pending");
  if (!cfg || pendingRows.length === 0) {
    return { sent: 0, failed: 0, pending: pendingRows.length };
  }
  let sent = 0;
  let failed = 0;
  for (const row of pendingRows) {
    const res = await postEvent(cfg, row);
    row.attempts += 1;
    if (res.ok) {
      row.status = "sent";
      row.sent_at = new Date().toISOString();
      row.last_error = null;
      sent += 1;
    } else {
      row.last_error = res.error ?? "unknown";
      failed += 1;
      console.error(`[revenue-export] ${row.event_id} failed (attempt ${row.attempts}): ${row.last_error}`);
    }
  }
  await writeOutbox(rows);
  return { sent, failed, pending: failed };
}

/** Join key from client.yaml — best-effort; nulls when the record is thin. */
export async function clientJoinKeyFor(clientId: string): Promise<RevenueClientKey> {
  try {
    const { getPlansRoot } = await import("@/lib/fmdb/paths");
    const raw = await fs.readFile(path.join(getPlansRoot(), "clients", clientId, "client.yaml"), "utf-8");
    const c = (yaml.load(raw) ?? {}) as Record<string, unknown>;
    const email = typeof c.email === "string" && c.email.trim() ? c.email.trim().toLowerCase() : null;
    const phoneRaw = typeof c.mobile_number === "string" ? c.mobile_number.replace(/\D/g, "") : "";
    return { client_id: clientId, email, phone_e164: phoneRaw.length >= 8 ? phoneRaw : null };
  } catch {
    return { client_id: clientId, email: null, phone_e164: null };
  }
}

/** Compute the live count from disk and emit a snapshot. Never throws. */
export async function emitActiveClientCount(): Promise<{ ok: boolean }> {
  try {
    const { loadAllClients, loadAllPlans } = await import("@/lib/fmdb/loader");
    const [clients, plans] = await Promise.all([loadAllClients(), loadAllPlans()]);
    const todayYmd = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10); // IST day
    const breakdown = computeActiveClientCounts(
      clients as unknown as CountClient[],
      plans as unknown as CountPlan[],
      todayYmd,
    );
    const nowIso = new Date().toISOString();
    const signupsThisWeek = countSignupsThisWeek(
      clients as unknown as Array<CountClient & { programme_started_at?: string; created_at?: string }>,
      nowIso,
    );
    const ev = buildActiveClientCountEvent(breakdown, signupsThisWeek, capacityConfig(), nowIso);
    const r = await emitRevenueEvent(ev);
    return { ok: r.ok };
  } catch (e) {
    console.error("[revenue-export] active-client count failed:", (e as Error).message);
    return { ok: false };
  }
}

/**
 * Catch-up sweep: every graduated plan gets a programme_completed event.
 * Idempotent — the outbox dedupes on `programme_completed:<slug>`, so plans
 * already announced (e.g. by the graduatePlan action) are skipped for free.
 */
export async function sweepGraduatedPlans(): Promise<{ emitted: number }> {
  try {
    const { loadAllPlans } = await import("@/lib/fmdb/loader");
    const plans = await loadAllPlans();
    const graduated = plans.filter((p) => (p._bucket ?? p.status) === "graduated" && p.slug && p.client_id);
    let emitted = 0;
    for (const p of graduated) {
      const client = await clientJoinKeyFor(p.client_id as string);
      const updatedAt = (p as { updated_at?: string }).updated_at;
      const ev = buildProgrammeCompletedEvent({ planSlug: p.slug as string, completedAt: updatedAt ?? null, client });
      const r = await emitRevenueEvent(ev);
      if (r.added) emitted += 1;
    }
    return { emitted };
  } catch (e) {
    console.error("[revenue-export] graduation sweep failed:", (e as Error).message);
    return { emitted: 0 };
  }
}
