/**
 * Lab orders — the coach-approved booking lifecycle.
 *
 * An order is ALWAYS coach-created (the coach approves which profile + which
 * add-ons from the dashboard → status `recommended`); the client then PAYS what
 * was approved. There is no client-initiated order. See docs/LAB_BOOKING_SPEC.md
 * ("Coach-approved booking").
 *
 * Lifecycle: recommended → paid → booked → sample_collected → results_in
 *            (+ cancelled from any non-terminal state).
 *
 * The charged amount is derived HERE, server-side: the profile price comes from
 * the catalogue via priceSelection() (reviewed, never client-trusted); add-on
 * prices are the coach's per-recommendation values (trusted — coach-authored).
 *
 * Pure core (buildOrder / canTransition / applyTransition) is unit-tested without
 * disk; the fs helpers dynamically import "@/…/paths" so this module stays free of
 * top-level path-alias imports (the vitest convention — see lab-providers.ts).
 */

import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { priceSelection, type LabProvider } from "./lab-providers";

export type LabOrderStatus =
  | "recommended"
  | "paid"
  | "booked"
  | "sample_collected"
  | "results_in"
  | "cancelled";

export interface LabOrderLine {
  label: string;
  inr: number;
  /** add-on slug; absent for the profile line. */
  slug?: string;
}

export interface LabOrder {
  order_id: string;
  client_id: string;
  created_at: string;
  provider: string;
  profile_id: number | null;
  addon_slugs: string[];
  lines: LabOrderLine[];
  amount_inr: number;
  our_cost_inr: number;
  status: LabOrderStatus;
  recommended_by: string;
  recommended_at: string;
  coach_note: string | null;
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  paid_at: string | null;
  booked_with_acumen_at: string | null;
  sample_collected_on: string | null;
  results_snapshot_date: string | null;
  fasting_required: boolean;
  notes: string | null;
}

/** Each coach-set add-on line for a recommendation: slug + the client price. */
export interface RecommendAddon {
  slug: string;
  inr: number;
}

export interface RecommendInput {
  clientId: string;
  profileId: number | null;
  addons?: RecommendAddon[];
  coachNote?: string | null;
  recommendedBy: string;
  /** injected so buildOrder stays pure/testable. */
  orderId: string;
  now: string;
}

export type BuildResult = { ok: true; order: LabOrder } | { ok: false; error: string };

// ── status machine ───────────────────────────────────────────────────────────

const NEXT: Record<LabOrderStatus, LabOrderStatus[]> = {
  recommended: ["paid", "cancelled"],
  paid: ["booked", "cancelled"],
  booked: ["sample_collected", "cancelled"],
  sample_collected: ["results_in", "cancelled"],
  results_in: [],
  cancelled: [],
};

export function canTransition(from: LabOrderStatus, to: LabOrderStatus): boolean {
  return (NEXT[from] ?? []).includes(to);
}

/** Ceiling on a single coach-set add-on price — a sanity cap so a typo / hostile
 *  caller can't mint an absurd charge (no Acumen add-on is near this). */
export const MAX_ADDON_INR = 200_000;

const VALID_STATUSES = new Set<LabOrderStatus>([
  "recommended",
  "paid",
  "booked",
  "sample_collected",
  "results_in",
  "cancelled",
]);

/** Shape guard — a parsed YAML is only a real order if it has a string id and a
 *  known status. Stops a truncated/blank file being treated as a live order. */
function isValidOrder(o: unknown): o is LabOrder {
  const r = o as LabOrder | null;
  return !!r && typeof r.order_id === "string" && !!r.order_id && VALID_STATUSES.has(r.status);
}

// ── pure construction ─────────────────────────────────────────────────────────

/**
 * Build a `recommended` order from a coach recommendation. The profile price is
 * catalogue-derived (server-side); add-on prices are the coach's values. Rejects
 * empty selections, unknown profiles/add-ons, and non-positive add-on prices.
 */
export function buildOrder(provider: LabProvider, input: RecommendInput): BuildResult {
  const addons = Array.isArray(input.addons) ? input.addons : []; // non-array → none
  if (input.profileId == null && addons.length === 0) {
    return { ok: false, error: "empty recommendation — pick a profile or at least one add-on" };
  }

  const lines: LabOrderLine[] = [];
  let amountInr = 0;
  let ourCostInr = 0;

  if (input.profileId != null) {
    // Derive the profile price from the catalogue — same reviewed path the client
    // pay endpoint re-runs; never a coach- or client-typed profile price.
    const priced = priceSelection(provider, { profileId: input.profileId });
    if (!priced.ok) return { ok: false, error: priced.error };
    const p = provider.profiles.find((x) => x.id === input.profileId);
    if (!p) return { ok: false, error: `unknown profile id ${input.profileId}` };
    lines.push({ label: p.name, inr: p.mrpInr });
    amountInr += p.mrpInr;
    ourCostInr += p.ourCostInr;
  }

  for (const a of addons) {
    const cat = provider.addons.find((x) => x.slug === a.slug);
    if (!cat) return { ok: false, error: `unknown add-on "${a.slug}"` };
    // finite + positive + capped — rejects NaN/Infinity/1e309 and absurd typos.
    if (!(typeof a.inr === "number" && Number.isFinite(a.inr) && a.inr > 0 && a.inr <= MAX_ADDON_INR)) {
      return { ok: false, error: `add-on "${a.slug}" needs a sane coach price (₹1–₹${MAX_ADDON_INR})` };
    }
    lines.push({ label: cat.name, inr: a.inr, slug: a.slug });
    amountInr += a.inr;
    ourCostInr += cat.ourCostInr ?? 0;
  }

  return {
    ok: true,
    order: {
      order_id: input.orderId,
      client_id: input.clientId,
      created_at: input.now,
      provider: provider.slug,
      profile_id: input.profileId,
      addon_slugs: addons.map((a) => a.slug),
      lines,
      amount_inr: amountInr,
      our_cost_inr: ourCostInr,
      status: "recommended",
      recommended_by: input.recommendedBy,
      recommended_at: input.now,
      coach_note: input.coachNote?.trim() || null,
      razorpay_order_id: null,
      razorpay_payment_id: null,
      paid_at: null,
      booked_with_acumen_at: null,
      sample_collected_on: null,
      results_snapshot_date: null,
      // All Acumen FM profiles are fasting; a pure add-on order defaults non-fasting
      // (coach can note exceptions). profiles_final carries no per-profile flag.
      fasting_required: input.profileId != null,
      notes: null,
    },
  };
}

/**
 * Bound-check a stored order's amount before charging it (the pay endpoint MUST
 * call this — see LAB_BOOKING_SPEC.md "Add-on amounts can only be BOUND-CHECKED").
 * The PROFILE line is re-derived from the catalogue (un-manipulable); add-on lines
 * are coach-set so can't be recomputed, but are bounded: positive, ≤ MAX_ADDON_INR.
 * Also asserts lines sum to amount_inr and amount_inr ≥ our_cost_inr. Never charge
 * an amount that fails this.
 */
export function validateOrderAmount(
  provider: LabProvider,
  order: LabOrder,
): { ok: true } | { ok: false; error: string } {
  if (!Array.isArray(order.lines) || order.lines.length === 0) return { ok: false, error: "order has no line items" };
  const sum = order.lines.reduce((s, l) => s + (typeof l.inr === "number" && Number.isFinite(l.inr) ? l.inr : NaN), 0);
  if (!Number.isFinite(sum) || sum !== order.amount_inr) return { ok: false, error: "amount_inr does not match line items" };
  if (!(typeof order.our_cost_inr === "number" && order.amount_inr >= order.our_cost_inr)) {
    return { ok: false, error: "amount_inr is below our cost" };
  }
  // Profile line (the one without a slug) must equal the catalogue MRP.
  if (order.profile_id != null) {
    const priced = priceSelection(provider, { profileId: order.profile_id });
    if (!priced.ok) return { ok: false, error: `profile price not derivable: ${priced.error}` };
    const p = provider.profiles.find((x) => x.id === order.profile_id);
    const profileLine = order.lines.find((l) => l.slug === undefined);
    if (!p || !profileLine || profileLine.inr !== p.mrpInr) {
      return { ok: false, error: "profile price does not match the catalogue" };
    }
  }
  // Add-on lines: positive, finite, capped.
  for (const l of order.lines) {
    if (l.slug !== undefined && !(typeof l.inr === "number" && Number.isFinite(l.inr) && l.inr > 0 && l.inr <= MAX_ADDON_INR)) {
      return { ok: false, error: `add-on line out of bounds: ${l.label}` };
    }
  }
  return { ok: true };
}

/** Apply a status transition + patch to an order (pure). Rejects illegal moves. */
export function applyTransition(
  order: LabOrder,
  to: LabOrderStatus,
  patch: Partial<LabOrder> = {},
): { ok: true; order: LabOrder } | { ok: false; error: string } {
  if (!canTransition(order.status, to)) {
    return { ok: false, error: `illegal transition ${order.status} → ${to}` };
  }
  return { ok: true, order: { ...order, ...patch, status: to } };
}

// ── storage (fs) ──────────────────────────────────────────────────────────────

async function ordersDirFor(clientId: string): Promise<string> {
  const { getPlansRoot } = await import("@/lib/fmdb/paths");
  return path.join(getPlansRoot(), "clients", clientId, "orders");
}

/** Next `YYYY-MM-DD-labNNN` id for the day, scanning existing orders. */
export async function nextLabOrderId(clientId: string, ymd: string): Promise<string> {
  const dir = await ordersDirFor(clientId);
  let max = 0;
  try {
    const re = new RegExp(`^${ymd}-lab(\\d+)\\.ya?ml$`);
    for (const f of await fs.readdir(dir)) {
      const m = re.exec(f);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
  } catch {
    /* no orders dir yet */
  }
  return `${ymd}-lab${String(max + 1).padStart(3, "0")}`;
}

/** Coach action: create a `recommended` order on disk. */
export async function createRecommendedOrder(
  provider: LabProvider,
  input: { clientId: string; profileId: number | null; addons?: RecommendAddon[]; coachNote?: string | null; recommendedBy: string },
): Promise<BuildResult> {
  const now = new Date().toISOString();
  const ymd = now.slice(0, 10);
  const dir = await ordersDirFor(input.clientId);
  await fs.mkdir(dir, { recursive: true });
  // Exclusive write + retry: nextLabOrderId is read-max-then-write, so two
  // same-second recommendations could pick the same id. `flag: "wx"` fails on an
  // existing file (EEXIST) instead of clobbering → recompute the id + retry.
  for (let attempt = 0; attempt < 6; attempt++) {
    const orderId = await nextLabOrderId(input.clientId, ymd);
    const built = buildOrder(provider, { ...input, orderId, now });
    if (!built.ok) return built;
    try {
      await fs.writeFile(path.join(dir, `${orderId}.yaml`), yaml.dump(built.order, { sortKeys: false }), {
        encoding: "utf8",
        flag: "wx",
      });
      return built;
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code !== "EEXIST") throw e;
      // else: id was taken concurrently — loop to recompute.
    }
  }
  return { ok: false, error: "could not allocate a unique order id — try again" };
}

export async function loadOrder(clientId: string, orderId: string): Promise<LabOrder | null> {
  const dir = await ordersDirFor(clientId);
  try {
    const o = yaml.load(await fs.readFile(path.join(dir, `${orderId}.yaml`), "utf8"));
    return isValidOrder(o) ? o : null;
  } catch {
    return null;
  }
}

export async function loadClientOrders(clientId: string): Promise<LabOrder[]> {
  const dir = await ordersDirFor(clientId);
  const out: LabOrder[] = [];
  try {
    for (const f of await fs.readdir(dir)) {
      if (!f.endsWith(".yaml") && !f.endsWith(".yml")) continue;
      try {
        const o = yaml.load(await fs.readFile(path.join(dir, f), "utf8"));
        if (isValidOrder(o)) out.push(o);
      } catch {
        /* skip a malformed order file */
      }
    }
  } catch {
    /* no orders dir */
  }
  return out.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
}

/** Patch non-status fields on an order (e.g. stamp `razorpay_order_id` at
 *  pay-initiation while the order stays `recommended`). Use transitionOrder for
 *  status changes. */
export async function patchOrder(
  clientId: string,
  orderId: string,
  patch: Partial<Omit<LabOrder, "status">>,
): Promise<LabOrder | null> {
  const order = await loadOrder(clientId, orderId);
  if (!order) return null;
  const next = { ...order, ...patch, status: order.status };
  const dir = await ordersDirFor(clientId);
  await fs.writeFile(path.join(dir, `${orderId}.yaml`), yaml.dump(next, { sortKeys: false }), "utf8");
  return next;
}

/** Reverse-lookup an order by its Razorpay order id (for the webhook, which only
 *  has the Razorpay ids). Scans all clients' orders/. */
export async function findOrderByRazorpayOrderId(
  rzpOrderId: string,
): Promise<{ clientId: string; order: LabOrder } | null> {
  if (!rzpOrderId) return null;
  const { getPlansRoot } = await import("@/lib/fmdb/paths");
  const clientsDir = path.join(getPlansRoot(), "clients");
  let ids: string[];
  try {
    ids = await fs.readdir(clientsDir);
  } catch {
    return null;
  }
  for (const cid of ids) {
    const dir = path.join(clientsDir, cid, "orders");
    let files: string[];
    try {
      files = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith(".yaml") && !f.endsWith(".yml")) continue;
      try {
        const o = yaml.load(await fs.readFile(path.join(dir, f), "utf8"));
        if (isValidOrder(o) && o.razorpay_order_id === rzpOrderId) return { clientId: cid, order: o };
      } catch {
        /* skip */
      }
    }
  }
  return null;
}

/** Advance an order's status (validated) + persist. */
export async function transitionOrder(
  clientId: string,
  orderId: string,
  to: LabOrderStatus,
  patch: Partial<LabOrder> = {},
): Promise<{ ok: true; order: LabOrder } | { ok: false; error: string }> {
  const order = await loadOrder(clientId, orderId);
  if (!order) return { ok: false, error: `order not found: ${orderId}` };
  const res = applyTransition(order, to, patch);
  if (!res.ok) return res;
  const dir = await ordersDirFor(clientId);
  await fs.writeFile(path.join(dir, `${orderId}.yaml`), yaml.dump(res.order, { sortKeys: false }), "utf8");
  return res;
}
