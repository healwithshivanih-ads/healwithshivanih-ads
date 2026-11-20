/**
 * Foundation-session orders — the paid front door to the discovery flow.
 *
 * A "foundation session" is the client-facing name for the ₹12,000 discovery
 * consult. The order here is a FIXED-PRICE, one-time payment (NOT auto-debit)
 * that gates the discovery onboarding: once paid, the client's intake form and
 * their foundation-call booking link are surfaced (see /foundation/<token>).
 *
 * Modelled almost exactly on maintenance-orders.ts (fixed server-constant price,
 * webhook is the ONLY source of truth for `paid`), with two deliberate
 * differences:
 *   1. The money lands in a SEPARATE Razorpay account ("Ochre Life"), resolved
 *      via resolveFoundationRazorpay() — never the labs/maintenance account.
 *   2. There is no coverage window to extend — paying just flips the order to
 *      `paid`, which unlocks the next steps.
 *
 * State home / projection: the order record lives at
 * clients/<id>/foundation/<id>.yaml. It is CREATED on Fly at pay time (like a
 * maintenance order) and marked `paid` by the Fly webhook. The Mac reverse-mirror
 * (app-staging-action.py) folds the paid record back so the coach sees it. The
 * client app / pay page read the record directly to reflect payment immediately.
 *
 * Pure core (price/build) is unit-testable without disk; fs helpers dynamically
 * import "@/…/paths" so this module stays free of top-level path-alias imports
 * (the vitest convention — see maintenance-orders.ts / lab-orders.ts).
 */

import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";

export type FoundationOrderStatus = "pending" | "paid" | "cancelled";

/** The fixed INR price of a foundation session. Changing this is the ONLY way to
 *  change what a client is charged. Kept a named constant so a stray client-
 *  supplied amount can never override it (the pay route never trusts a body amount). */
export const FOUNDATION_SESSION_PRICE_INR = 12000;

/** The ₹999 short (triage) call. It is credited IN FULL toward the Foundation
 *  session (docs/TRIAGE_LANE.md in ochre-funnel), so someone who paid it is
 *  charged 12,000 − 999 = ₹11,001. No expiry: the credit has never had one. */
export const TRIAGE_CALL_PRICE_INR = 999;

export interface FoundationPrice {
  /** What the client is charged. */
  amountInr: number;
  /** How much came off the list price (0 when none). */
  creditInr: number;
  /** Why, in words — shown to the coach and stored on the order. */
  creditReason: string | null;
  /** Which credit it is, so each surface can word it truthfully (a report
   *  credit must never be described as "our short call"). Absent when none. */
  creditKind?: "triage_call" | "body_age_report";
  /** Last day (YYYY-MM-DD, inclusive, India time) the credit applies. Only the
   *  body age report credit has one. */
  creditUntil?: string;
}

/** The Foundation price for someone who has just had a body age report, by
 *  report type: ₹12,000 "with what you paid for this report taken off", in
 *  Shivani's round figures (19 Nov 2026: ₹7,000 after the ₹4,999 report,
 *  ₹2,000 after the ₹9,999 one). Holds for BODY_AGE_CREDIT_DAYS after the
 *  report date. Mirrors FOUNDATION_AFTER_INR in fm-database/fmdb/report/decide.py
 *  (the report prints the same figure; a test pins the two together). */
export const FOUNDATION_AFTER_BODY_AGE_REPORT_INR: Record<string, number> = { standard: 7000, deeper: 2000 };
export const BODY_AGE_CREDIT_DAYS = 14;

const ymdOf = (v: unknown): string | null =>
  v instanceof Date && !Number.isNaN(v.getTime())
    ? v.toISOString().slice(0, 10)
    : typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v.trim())
      ? v.trim().slice(0, 10)
      : null;

/** Today's date in India, as YYYY-MM-DD. The credit window is counted in the
 *  buyer's calendar days, and the pay page runs on a server set to UTC. */
export function todayYmdIST(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/** The last day (inclusive) the report fee still comes off, or null. */
export function bodyAgeCreditUntil(client: Record<string, unknown> | null | undefined): string | null {
  const date = ymdOf(client?.body_age_report_date);
  const kind = typeof client?.body_age_report_kind === "string" ? client.body_age_report_kind : "";
  if (!date || !Object.hasOwn(FOUNDATION_AFTER_BODY_AGE_REPORT_INR, kind)) return null;
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + BODY_AGE_CREDIT_DAYS);
  return d.toISOString().slice(0, 10);
}

/**
 * The Foundation price for one client, from their client.yaml.
 *
 * Two credits exist, and they do not add up: the larger one applies.
 *   1. `triage_call_date` (YYYY-MM-DD, the coach recorded the PAID ₹999 call) or
 *      `triage_paid_at` (ochre-funnel reported the ₹999 payment). No expiry. A
 *      FREE discovery call carries none.
 *   2. `body_age_report_kind` + `body_age_report_date`: the body age report fee,
 *      up to and including the 14th day after the report date (India time).
 *      After that the price is the full ₹12,000 again (or ₹11,001 with a short call).
 * Pure (pass `todayYmd` in tests); the pay route, the pay page and the coach's
 * pay-link card all go through this so they can never disagree.
 */
export function foundationPriceFor(
  client: Record<string, unknown> | null | undefined,
  todayYmd: string = todayYmdIST(),
): FoundationPrice {
  let best: FoundationPrice = { amountInr: FOUNDATION_SESSION_PRICE_INR, creditInr: 0, creditReason: null };
  // Either marker is the ₹999 credit: triage_call_date (coach recorded the call)
  // or triage_paid_at (ochre-funnel reported the ₹999 payment).
  const call = ymdOf(client?.triage_call_date);
  const paid = ymdOf(client?.triage_paid_at);
  if (call || paid) {
    best = {
      amountInr: FOUNDATION_SESSION_PRICE_INR - TRIAGE_CALL_PRICE_INR,
      creditInr: TRIAGE_CALL_PRICE_INR,
      creditReason: call
        ? `₹${TRIAGE_CALL_PRICE_INR} short call on ${call}`
        : `₹${TRIAGE_CALL_PRICE_INR} short call paid ${paid}`,
      creditKind: "triage_call",
    };
  }
  const until = bodyAgeCreditUntil(client);
  const reportDate = ymdOf(client?.body_age_report_date);
  if (until && reportDate && todayYmd >= reportDate && todayYmd <= until) {
    const after = FOUNDATION_AFTER_BODY_AGE_REPORT_INR[String(client?.body_age_report_kind)];
    const credit = FOUNDATION_SESSION_PRICE_INR - after;
    if (credit > best.creditInr) {
      best = {
        amountInr: after,
        creditInr: credit,
        creditReason: `body age report (${String(client?.body_age_report_kind)}) of ${reportDate}, until ${until}`,
        creditKind: "body_age_report",
        creditUntil: until,
      };
    }
  }
  return best;
}

export interface FoundationOrder {
  order_id: string;
  client_id: string;
  kind: "foundation_session";
  amount_inr: number;
  status: FoundationOrderStatus;
  razorpay_order_id?: string;
  razorpay_payment_id?: string;
  /** Credit taken off the list price (the ₹999 short call), for the audit trail. */
  credit_inr?: number;
  credit_reason?: string;
  created_at: string;
  paid_at?: string;
}

/** Build a `pending` foundation order at the server-fixed price. Pure — caller
 *  persists. Status flips to `paid` ONLY via the verified webhook. */
export function buildFoundationOrder(
  orderId: string,
  clientId: string,
  createdAtIso: string,
  price: FoundationPrice = { amountInr: FOUNDATION_SESSION_PRICE_INR, creditInr: 0, creditReason: null },
): FoundationOrder {
  const order: FoundationOrder = {
    order_id: orderId,
    client_id: clientId,
    kind: "foundation_session",
    amount_inr: price.amountInr,
    status: "pending",
    created_at: createdAtIso,
  };
  if (price.creditInr > 0) {
    order.credit_inr = price.creditInr;
    if (price.creditReason) order.credit_reason = price.creditReason;
  }
  return order;
}

/**
 * Foundation payments share the SINGLE Razorpay account used for labs and
 * maintenance (`RAZORPAY_*`) — one merchant, one webhook secret, everywhere.
 * (This account is the "Ochre Life" one after the 2026-09 migration off
 * Conscious Crafts; the env just points at whichever account is live.) Mirrors
 * how maintenance-orders reads the same vars. Returns the PUBLIC key id for
 * in-app Checkout; the secret never leaves the server.
 */
export function resolveFoundationRazorpay(): {
  keyId: string;
  keySecret: string;
  publicKeyId: string;
} {
  const keyId = process.env.RAZORPAY_KEY_ID || "";
  const keySecret = process.env.RAZORPAY_KEY_SECRET || "";
  const publicKeyId = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || keyId;
  return { keyId, keySecret, publicKeyId };
}

/** The webhook secret — shared with the lab + maintenance webhooks. */
export function foundationWebhookSecret(): string {
  return process.env.RAZORPAY_WEBHOOK_SECRET || "";
}

/**
 * The Cal.com booking URL for the paid foundation call. Configurable so the coach
 * can point it at a dedicated event type (recommended) without a code change.
 * Default = the 60-min programme-intake-session (the closest existing 1:1 slot).
 */
export function foundationCallUrl(): string {
  const v = (process.env.FOUNDATION_CALL_URL || "").trim();
  if (v) return v.replace(/\/+$/, "");
  return "https://cal.com/shivani-hariharan-0xyy3l/programme-intake-session";
}

// ── fs helpers (dynamic-import paths to stay vitest-safe) ────────────────────

async function foundationDir(clientId: string): Promise<string> {
  const { getPlansRoot } = await import("@/lib/fmdb/paths");
  return path.join(getPlansRoot(), "clients", clientId, "foundation");
}

export async function nextFoundationOrderId(clientId: string, ymd: string): Promise<string> {
  const dir = await foundationDir(clientId);
  let n = 1;
  try {
    const files = await fs.readdir(dir);
    n = files.filter((f) => f.startsWith(`foundation-${ymd}-`)).length + 1;
  } catch {
    /* dir absent → first order */
  }
  return `foundation-${ymd}-${String(n).padStart(2, "0")}`;
}

export async function createFoundationOrder(order: FoundationOrder): Promise<void> {
  const dir = await foundationDir(order.client_id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${order.order_id}.yaml`), yaml.dump(order), "utf8");
}

export async function loadFoundationOrder(
  clientId: string,
  orderId: string,
): Promise<FoundationOrder | null> {
  const dir = await foundationDir(clientId);
  try {
    return yaml.load(await fs.readFile(path.join(dir, `${orderId}.yaml`), "utf8")) as FoundationOrder;
  } catch {
    return null;
  }
}

export async function loadClientFoundationOrders(clientId: string): Promise<FoundationOrder[]> {
  const dir = await foundationDir(clientId);
  try {
    const files = await fs.readdir(dir);
    const out: FoundationOrder[] = [];
    for (const f of files.filter((x) => x.endsWith(".yaml"))) {
      try {
        out.push(yaml.load(await fs.readFile(path.join(dir, f), "utf8")) as FoundationOrder);
      } catch {
        /* skip unreadable */
      }
    }
    return out.sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  } catch {
    return [];
  }
}

export async function patchFoundationOrder(
  clientId: string,
  orderId: string,
  patch: Partial<FoundationOrder>,
): Promise<FoundationOrder | null> {
  const order = await loadFoundationOrder(clientId, orderId);
  if (!order) return null;
  const next = { ...order, ...patch };
  const dir = await foundationDir(clientId);
  await fs.writeFile(path.join(dir, `${orderId}.yaml`), yaml.dump(next), "utf8");
  return next;
}

/** Scan every client's foundation dir for a matching razorpay_order_id (the
 *  webhook fallback when notes are absent). */
export async function findFoundationOrderByRazorpayOrderId(
  rzpOrderId: string,
): Promise<{ clientId: string; order: FoundationOrder } | null> {
  const { getPlansRoot } = await import("@/lib/fmdb/paths");
  const clientsDir = path.join(getPlansRoot(), "clients");
  let ids: string[];
  try {
    ids = await fs.readdir(clientsDir);
  } catch {
    return null;
  }
  for (const clientId of ids) {
    const orders = await loadClientFoundationOrders(clientId);
    const hit = orders.find((o) => o.razorpay_order_id === rzpOrderId);
    if (hit) return { clientId, order: hit };
  }
  return null;
}

/** True (with the paid order) if this client has ANY paid foundation order.
 *  The single fact the pay page + coach card gate on. */
export async function foundationSessionPaid(
  clientId: string,
): Promise<{ paid: boolean; order: FoundationOrder | null }> {
  const orders = await loadClientFoundationOrders(clientId);
  const paid = orders.find((o) => o.status === "paid") ?? null;
  return { paid: !!paid, order: paid };
}
