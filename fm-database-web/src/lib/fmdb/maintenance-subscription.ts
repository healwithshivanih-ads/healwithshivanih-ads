/**
 * Maintenance SUBSCRIPTION — the quarterly auto-debit tier (Razorpay Subscriptions).
 *
 * Distinct from the one-time maintenance ORDER (maintenance-orders.ts): here the
 * client authorizes a mandate ONCE and Razorpay auto-charges every quarter. We
 * never compute the renewal date locally — coverage is driven solely by the
 * `current_end` Razorpay reports on each `subscription.charged` webhook (the spec's
 * hard rule: the RBI 24h pre-debit-notice delay means a charge "scheduled" for a
 * date lands days later; trust the webhook, never a local clock).
 *
 * Records live in the SAME `clients/<id>/maintenance/` dir as orders (file name
 * `sub-<subscription_id>.yaml`), so the staging reverse-mirror + the coverage
 * scan (`latestPaidMaintenanceThrough`) pick them up with no extra plumbing. The
 * shared invariant holds: `paid_through != null` ⟺ a real charge landed (set on
 * `subscription.charged`); the pre-auth `created` record has `paid_through: null`.
 *
 * Pure core (epoch→ymd, event→patch) is unit-tested without disk; fs helpers
 * dynamically import "@/…/paths" (vitest convention — see maintenance-orders.ts).
 */

import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";

/** Mirrors Razorpay subscription states we care about. */
export type MaintenanceSubscriptionStatus =
  | "created" // mandate not yet authorized
  | "authenticated"
  | "active"
  | "pending" // a charge failed; auto-retry in progress
  | "halted" // retries exhausted
  | "cancelled"
  | "completed";

export interface MaintenanceSubscription {
  subscription_id: string; // sub_xxx
  client_id: string;
  kind: "subscription";
  plan_id: string;
  status: MaintenanceSubscriptionStatus;
  /** End of the current paid cycle (YYYY-MM-DD), from Razorpay's current_end on
   *  the latest successful charge. null until the first charge lands. The shared
   *  coverage field the projection + reconcile read. */
  paid_through: string | null;
  /** Display amount (paise→INR) — informational; the real charge is the plan. */
  amount_inr: number;
  last_payment_id?: string;
  created_at: string;
  updated_at: string;
  /** Append-only log of every `subscription.charged` event, oldest first. Needed
   *  because the rest of this record is mutated in place each cycle (only the
   *  LATEST paid_through/last_payment_id survive on the top-level fields) — so
   *  without this, a past quarter's payment id/amount/date would be unrecoverable
   *  once the next charge lands, and it couldn't be invoiced individually. The
   *  webhook appends a new entry on every real charge (never overwrites a past
   *  one); invoices.ts stamps invoice_number/invoice_generated_at onto the
   *  matching entry in place (idempotent — one invoice per payment_id). */
  charge_history?: MaintenanceChargeRecord[];
}

/** One real `subscription.charged` event. See `charge_history` above. */
export interface MaintenanceChargeRecord {
  payment_id: string;
  amount_inr: number;
  charged_at: string; // ISO
  paid_through: string; // YYYY-MM-DD — the cycle this charge extended coverage to
  invoice_number?: string;
  invoice_generated_at?: string;
}

/** Razorpay current_end is epoch SECONDS — convert to a UTC YYYY-MM-DD. Pure. */
export function epochSecToYmd(sec: unknown): string | null {
  if (typeof sec !== "number" || !Number.isFinite(sec) || sec <= 0) return null;
  return new Date(sec * 1000).toISOString().slice(0, 10);
}

/** Minimal shape of the Razorpay subscription webhook event we read. */
export interface RzpSubscriptionEvent {
  event?: string;
  payload?: {
    subscription?: { entity?: { id?: string; status?: string; current_end?: number; notes?: { client_id?: string } } };
    payment?: { entity?: { id?: string } };
  };
}

export interface SubscriptionEventOutcome {
  subscriptionId: string;
  clientIdFromNotes: string | null;
  patch: Partial<MaintenanceSubscription>;
  /** the payment id for idempotency on charged events (null for non-charge events) */
  paymentId: string | null;
}

const _STATUS_BY_EVENT: Record<string, MaintenanceSubscriptionStatus> = {
  "subscription.authenticated": "authenticated",
  "subscription.activated": "active",
  "subscription.charged": "active",
  "subscription.pending": "pending",
  "subscription.halted": "halted",
  "subscription.cancelled": "cancelled",
  "subscription.completed": "completed",
};

/**
 * Translate a verified Razorpay subscription webhook event into the patch to
 * apply to our record. Pure (no I/O) — the route handles signature + persistence.
 * Returns null for events we don't track. On `subscription.charged` it sets
 * `paid_through` from current_end + stamps last_payment_id (idempotency key).
 * Non-charge lifecycle events only move `status` — they never touch paid_through,
 * so coverage lapses naturally at the last charged current_end (spec: don't
 * revoke early on halt/cancel).
 */
export function subscriptionEventOutcome(
  event: RzpSubscriptionEvent,
  nowIso: string,
): SubscriptionEventOutcome | null {
  const name = event.event ?? "";
  const status = _STATUS_BY_EVENT[name];
  if (!status) return null;
  const sub = event.payload?.subscription?.entity;
  const subscriptionId = sub?.id ?? "";
  if (!subscriptionId) return null;

  const patch: Partial<MaintenanceSubscription> = { status, updated_at: nowIso };
  let paymentId: string | null = null;

  if (name === "subscription.charged") {
    const through = epochSecToYmd(sub?.current_end);
    if (through) patch.paid_through = through;
    paymentId = event.payload?.payment?.entity?.id ?? null;
    if (paymentId) patch.last_payment_id = paymentId;
  }

  return {
    subscriptionId,
    clientIdFromNotes: sub?.notes?.client_id ?? null,
    patch,
    paymentId,
  };
}

/**
 * Forward-only coverage guard: given a webhook patch and the record's CURRENT
 * paid_through, strip a backward paid_through so an out-of-order / re-delivered
 * OLDER cycle can never regress coverage (mirrors the one-time order's
 * stack-forward discipline). Pure — mutates + returns the patch. The status /
 * last_payment_id moves are kept; only the stale date is dropped.
 */
export function dropBackwardPaidThrough(
  patch: Partial<MaintenanceSubscription>,
  currentPaidThrough: string | null | undefined,
): Partial<MaintenanceSubscription> {
  if (patch.paid_through && currentPaidThrough && patch.paid_through <= currentPaidThrough) {
    delete patch.paid_through;
  }
  return patch;
}

// ── fs helpers (dynamic-import paths to stay vitest-safe) ────────────────────

async function maintenanceDir(clientId: string): Promise<string> {
  const { getPlansRoot } = await import("@/lib/fmdb/paths");
  return path.join(getPlansRoot(), "clients", clientId, "maintenance");
}

function fileName(subscriptionId: string): string {
  return `sub-${subscriptionId}.yaml`;
}

export async function createMaintenanceSubscription(sub: MaintenanceSubscription): Promise<void> {
  const dir = await maintenanceDir(sub.client_id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, fileName(sub.subscription_id)), yaml.dump(sub), "utf8");
}

export async function loadMaintenanceSubscription(
  clientId: string,
  subscriptionId: string,
): Promise<MaintenanceSubscription | null> {
  const dir = await maintenanceDir(clientId);
  try {
    const raw = await fs.readFile(path.join(dir, fileName(subscriptionId)), "utf8");
    return yaml.load(raw) as MaintenanceSubscription;
  } catch {
    return null;
  }
}

export async function patchMaintenanceSubscription(
  clientId: string,
  subscriptionId: string,
  patch: Partial<MaintenanceSubscription>,
): Promise<MaintenanceSubscription | null> {
  const cur = await loadMaintenanceSubscription(clientId, subscriptionId);
  if (!cur) return null;
  const next = { ...cur, ...patch };
  const dir = await maintenanceDir(clientId);
  await fs.writeFile(path.join(dir, fileName(subscriptionId)), yaml.dump(next), "utf8");
  return next;
}

/** Find a subscription record by id across every client (webhook fallback when
 *  the event's notes.client_id is absent). */
export async function findMaintenanceSubscriptionById(
  subscriptionId: string,
): Promise<{ clientId: string; sub: MaintenanceSubscription } | null> {
  const { getPlansRoot } = await import("@/lib/fmdb/paths");
  const clientsDir = path.join(getPlansRoot(), "clients");
  let ids: string[];
  try {
    ids = await fs.readdir(clientsDir);
  } catch {
    return null;
  }
  for (const clientId of ids) {
    const sub = await loadMaintenanceSubscription(clientId, subscriptionId);
    if (sub) return { clientId, sub };
  }
  return null;
}

/** Does this client have a live (active/authenticated) subscription record? Used
 *  by the projection/UI to avoid offering a second one. */
export async function hasLiveSubscription(clientId: string): Promise<boolean> {
  const dir = await maintenanceDir(clientId);
  try {
    const files = await fs.readdir(dir);
    for (const f of files.filter((x) => x.startsWith("sub-") && x.endsWith(".yaml"))) {
      try {
        const rec = yaml.load(await fs.readFile(path.join(dir, f), "utf8")) as { status?: string } | null;
        if (rec?.status === "active" || rec?.status === "authenticated") return true;
      } catch {
        /* skip */
      }
    }
  } catch {
    /* no dir */
  }
  return false;
}
