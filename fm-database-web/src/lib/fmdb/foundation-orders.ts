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

export interface FoundationOrder {
  order_id: string;
  client_id: string;
  kind: "foundation_session";
  amount_inr: number;
  status: FoundationOrderStatus;
  razorpay_order_id?: string;
  razorpay_payment_id?: string;
  created_at: string;
  paid_at?: string;
}

/** Build a `pending` foundation order at the server-fixed price. Pure — caller
 *  persists. Status flips to `paid` ONLY via the verified webhook. */
export function buildFoundationOrder(
  orderId: string,
  clientId: string,
  createdAtIso: string,
): FoundationOrder {
  return {
    order_id: orderId,
    client_id: clientId,
    kind: "foundation_session",
    amount_inr: FOUNDATION_SESSION_PRICE_INR,
    status: "pending",
    created_at: createdAtIso,
  };
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
