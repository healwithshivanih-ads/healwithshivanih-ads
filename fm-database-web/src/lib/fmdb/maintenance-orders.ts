/**
 * Maintenance subscription orders — the graduation "Maintain" checkout.
 *
 * Distinct from lab orders: a maintenance order is a FIXED-PRICE, client-initiated
 * one-time payment (NOT auto-debit — spec PLAN_END_GAME_SPEC.md) that buys a block
 * of months. Paying extends the client's `maintenance_paid_through`.
 *
 * Lifecycle: pending → paid (+ cancelled). The amount is a SERVER CONSTANT keyed
 * to the term — never client-trusted. "Paid" is set ONLY by the verified webhook.
 *
 * State home: the maintenance window ultimately lives on client.yaml
 * (maintenance_paid_through), a one-way Mac→Fly projection. So the Fly webhook
 * can't write client.yaml directly — instead it writes a payment RECORD here
 * (clients/<id>/maintenance/<id>.yaml) which:
 *   - the app projection reads to compute the EFFECTIVE paid-through immediately
 *     (record-derived OR client.yaml, newest wins), so the app reflects payment; and
 *   - the staging reverse-mirror folds back into the Mac's client.yaml (authoritative).
 *
 * Pure core (price/term/extend) is unit-testable without disk; fs helpers
 * dynamically import "@/…/paths" so this module stays free of top-level path-alias
 * imports (the vitest convention — see lab-orders.ts / lab-providers.ts).
 */

import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";

export type MaintenanceOrderStatus = "pending" | "paid" | "cancelled";

/** Allowed terms → fixed INR price for the ONE-TIME (manual) maintenance block.
 *  The 6-month prepaid block is ₹10,000 (the manual option). Quarterly auto-renewal
 *  is a separate Razorpay SUBSCRIPTION (see maintenance-subscription.ts), NOT a
 *  one-time term. Changing a price here is the ONLY way to change what a client is
 *  charged for the one-time block. */
export const MAINTENANCE_PRICING: Record<number, number> = {
  6: 10000,
};

export const DEFAULT_MAINTENANCE_TERM_MONTHS = 6;

export interface MaintenanceOrder {
  order_id: string;
  client_id: string;
  kind: "maintenance";
  term_months: number;
  amount_inr: number;
  status: MaintenanceOrderStatus;
  /** the window this payment extends coverage to, computed at pay time from the
   *  client's existing paid-through (so back-to-back renewals stack cleanly). */
  paid_through: string | null; // YYYY-MM-DD
  razorpay_order_id?: string;
  razorpay_payment_id?: string;
  created_at: string;
  paid_at?: string;
  /** Stamped once a receipt is generated. See fm-database-web/src/lib/fmdb/invoices.ts. */
  invoice_number?: string;
  invoice_generated_at?: string;
}

/** The fixed price for a term, or null if the term isn't offered. Pure. */
export function maintenancePrice(termMonths: number): number | null {
  return MAINTENANCE_PRICING[termMonths] ?? null;
}

/**
 * Extend a paid-through date by `termMonths`, anchored at max(existing, today) so
 * an early renewal stacks on top of remaining time rather than resetting it. Pure
 * — date math only, no I/O. `today` + `existing` are YYYY-MM-DD.
 */
export function extendPaidThrough(existing: string | null, today: string, termMonths: number): string {
  const anchor = existing && existing > today ? existing : today;
  const [y, m, d] = anchor.split("-").map((n) => parseInt(n, 10));
  // JS Date month math, clamped to a valid day (e.g. 31 Aug + 6mo → 28/29 Feb).
  const base = new Date(Date.UTC(y, (m - 1) + termMonths, d));
  if (base.getUTCDate() !== d) base.setUTCDate(0); // overflowed → last day of prev month
  return base.toISOString().slice(0, 10);
}

export type BuildMaintenanceResult =
  | { ok: true; order: MaintenanceOrder }
  | { ok: false; error: string };

/**
 * Build a `pending` maintenance order with the server-fixed price for the term.
 * Pure — caller persists. `paid_through` is deliberately null here: it is set
 * AUTHORITATIVELY by the webhook on capture (so a pending/unpaid order never
 * counts toward coverage — the single invariant the projection + reconcile rely
 * on: paid_through != null ⟺ a real payment landed).
 */
export function buildMaintenanceOrder(
  orderId: string,
  clientId: string,
  termMonths: number,
  createdAtIso: string,
): BuildMaintenanceResult {
  const price = maintenancePrice(termMonths);
  if (price == null) return { ok: false, error: `term ${termMonths} not offered` };
  return {
    ok: true,
    order: {
      order_id: orderId,
      client_id: clientId,
      kind: "maintenance",
      term_months: termMonths,
      amount_inr: price,
      status: "pending",
      paid_through: null,
      created_at: createdAtIso,
    },
  };
}

// ── fs helpers (dynamic-import paths to stay vitest-safe) ────────────────────

async function maintenanceDir(clientId: string): Promise<string> {
  const { getPlansRoot } = await import("@/lib/fmdb/paths");
  return path.join(getPlansRoot(), "clients", clientId, "maintenance");
}

export async function nextMaintenanceOrderId(clientId: string, ymd: string): Promise<string> {
  const dir = await maintenanceDir(clientId);
  let n = 1;
  try {
    const files = await fs.readdir(dir);
    const today = files.filter((f) => f.startsWith(`maint-${ymd}-`));
    n = today.length + 1;
  } catch {
    /* dir absent → first order */
  }
  return `maint-${ymd}-${String(n).padStart(2, "0")}`;
}

export async function createMaintenanceOrder(order: MaintenanceOrder): Promise<void> {
  const dir = await maintenanceDir(order.client_id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${order.order_id}.yaml`), yaml.dump(order), "utf8");
}

export async function loadMaintenanceOrder(clientId: string, orderId: string): Promise<MaintenanceOrder | null> {
  const dir = await maintenanceDir(clientId);
  try {
    const raw = await fs.readFile(path.join(dir, `${orderId}.yaml`), "utf8");
    return yaml.load(raw) as MaintenanceOrder;
  } catch {
    return null;
  }
}

export async function loadClientMaintenanceOrders(clientId: string): Promise<MaintenanceOrder[]> {
  const dir = await maintenanceDir(clientId);
  try {
    const files = await fs.readdir(dir);
    const out: MaintenanceOrder[] = [];
    for (const f of files.filter((x) => x.endsWith(".yaml"))) {
      try {
        out.push(yaml.load(await fs.readFile(path.join(dir, f), "utf8")) as MaintenanceOrder);
      } catch {
        /* skip unreadable */
      }
    }
    return out.sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  } catch {
    return [];
  }
}

export async function patchMaintenanceOrder(
  clientId: string,
  orderId: string,
  patch: Partial<MaintenanceOrder>,
): Promise<MaintenanceOrder | null> {
  const order = await loadMaintenanceOrder(clientId, orderId);
  if (!order) return null;
  const next = { ...order, ...patch };
  const dir = await maintenanceDir(clientId);
  await fs.writeFile(path.join(dir, `${orderId}.yaml`), yaml.dump(next), "utf8");
  return next;
}

/** Scan every client's maintenance dir for a matching razorpay_order_id (the
 *  webhook fallback when notes are absent). */
export async function findMaintenanceOrderByRazorpayOrderId(
  rzpOrderId: string,
): Promise<{ clientId: string; order: MaintenanceOrder } | null> {
  const { getPlansRoot } = await import("@/lib/fmdb/paths");
  const clientsDir = path.join(getPlansRoot(), "clients");
  let ids: string[];
  try {
    ids = await fs.readdir(clientsDir);
  } catch {
    return null;
  }
  for (const clientId of ids) {
    const orders = await loadClientMaintenanceOrders(clientId);
    const hit = orders.find((o) => o.razorpay_order_id === rzpOrderId);
    if (hit) return { clientId, order: hit };
  }
  return null;
}

/**
 * The latest paid-through across ALL of this client's maintenance records — both
 * one-time orders AND subscription records (same dir, both carry `paid_through`,
 * set only when a real payment landed). Generic dir scan so it is agnostic to
 * record shape. null if nothing paid. Used by the app projection to reflect a
 * payment immediately, before the Mac reconcile folds it into client.yaml.
 */
export async function latestPaidMaintenanceThrough(clientId: string): Promise<string | null> {
  const dir = await maintenanceDir(clientId);
  let best: string | null = null;
  try {
    const files = await fs.readdir(dir);
    for (const f of files.filter((x) => x.endsWith(".yaml"))) {
      try {
        const rec = yaml.load(await fs.readFile(path.join(dir, f), "utf8")) as { paid_through?: unknown } | null;
        const pt = rec?.paid_through;
        if (typeof pt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(pt) && (!best || pt > best)) best = pt;
      } catch {
        /* skip unreadable */
      }
    }
  } catch {
    /* no maintenance dir → nothing paid */
  }
  return best;
}

/**
 * The client's effective current maintenance window: the later of
 * client.yaml#maintenance_paid_through and the latest PAID record (records may be
 * ahead on Fly before the Mac reconcile folds them into client.yaml). Drives
 * renewal stacking. Returns null when the client has never had maintenance.
 */
export async function effectiveExistingThrough(clientId: string): Promise<string | null> {
  let fromClient: string | null = null;
  try {
    const { getPlansRoot } = await import("@/lib/fmdb/paths");
    const raw = await fs.readFile(path.join(getPlansRoot(), "clients", clientId, "client.yaml"), "utf8");
    const c = yaml.load(raw) as { maintenance_paid_through?: string } | null;
    const v = c?.maintenance_paid_through;
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) fromClient = v;
  } catch {
    /* no client record → treat as none */
  }
  const fromRecord = await latestPaidMaintenanceThrough(clientId);
  if (!fromClient) return fromRecord;
  if (!fromRecord) return fromClient;
  return fromRecord > fromClient ? fromRecord : fromClient;
}
