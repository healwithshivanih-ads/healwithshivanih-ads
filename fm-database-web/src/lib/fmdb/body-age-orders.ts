/**
 * Body age report orders: what a buyer places on the public order page (/body-age).
 *
 * One order = one payment for one report, for one person or for two (a joint report). The order is created on
 * the public server when the buyer presses Pay and is marked `paid` ONLY by the verified payment webhook
 * (body-age-payment.ts), never by the browser. It lives at <plans root>/body-age-orders/<order id>.yaml: on the
 * public server that is the synced tree, so the coach's Mac receives it, turns a paid order into a person's
 * record and takes it from there (booking the home visit by hand, results, the report).
 *
 * Nothing here sends anything to the buyer. The buyer-facing words on the page were approved by Shivani on
 * 21 Nov 2026 (a change needs her yes again), and the page is OFF unless `BODY_AGE_ORDER_PAGE` says otherwise:
 *   off  (default) the page and its routes answer 404.
 *   test           the page works with Razorpay TEST keys only; a live key is refused. Orders are marked `test`.
 *   live           real orders. Refused before the launch moment (Sat 2 Jan 2027, 20:00 IST) whatever the setting.
 *
 * Pure core first (prices, mode, validation, build); fs helpers below import paths lazily (vitest convention).
 */

import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { dumpYaml } from "./yaml-dump";
import { LOGISTICS_SLOTS, sanitizeLogistics, type LogisticsSlot } from "./lab-orders";
import { tidyVoucher } from "./body-age-voucher";
import { EMBARGO_UNTIL_MS } from "./body-age-send";

export type ReportKind = "standard" | "deeper";
export type OrderPageMode = "off" | "test" | "live";
export type BodyAgeOrderStatus = "pending" | "paid" | "booked" | "collected" | "results_in" | "report_sent" | "cancelled";

/** What a buyer pays, home collection included (Shivani, Nov 2026). Index 1 = one person, 2 = two people. */
export const BODY_AGE_PRICE_INR: Record<ReportKind, Record<1 | 2, number>> = {
  standard: { 1: 4999, 2: 8999 },
  deeper: { 1: 9999, 2: 17999 },
};

export const BODY_AGE_ORDER_KIND = "body_age_report";
export const MIN_AGE_YEARS = 18;

export function bodyAgePriceInr(kind: ReportKind, people: number): number | null {
  if (kind !== "standard" && kind !== "deeper") return null;
  return people === 1 || people === 2 ? BODY_AGE_PRICE_INR[kind][people] : null;
}

/** The page's mode right now. `live` before the launch moment reads as `off`: the date is not a setting. */
export function orderPageMode(setting: string | undefined, nowMs: number): OrderPageMode {
  const v = (setting ?? "").trim().toLowerCase();
  if (v === "test") return "test";
  if (v === "live") return nowMs >= EMBARGO_UNTIL_MS ? "live" : "off";
  return "off";
}

/**
 * The Razorpay keys an order may be charged with, or why not. Test mode takes ONLY a test key
 * (`RAZORPAY_TEST_KEY_ID` / `RAZORPAY_TEST_KEY_SECRET`, else the main pair when that is itself a test key), so a
 * test order can never take real money. Live mode takes the one live account every other payment uses.
 */
export function orderRazorpayKeys(
  mode: OrderPageMode,
  env: Record<string, string | undefined>,
): { ok: true; keyId: string; keySecret: string } | { ok: false; error: string } {
  if (mode === "off") return { ok: false, error: "not available" };
  const main = { id: (env.RAZORPAY_KEY_ID ?? "").trim(), secret: (env.RAZORPAY_KEY_SECRET ?? "").trim() };
  if (mode === "live") {
    if (!main.id || !main.secret) return { ok: false, error: "payments not configured" };
    if (main.id.startsWith("rzp_test_")) return { ok: false, error: "payments not configured" };
    return { ok: true, keyId: main.id, keySecret: main.secret };
  }
  const test = { id: (env.RAZORPAY_TEST_KEY_ID ?? "").trim(), secret: (env.RAZORPAY_TEST_KEY_SECRET ?? "").trim() };
  // This Mac's .env.local names its test key NEXT_PUBLIC_RAZORPAY_KEY_ID; accept it, as a test key only.
  const local = { id: main.id || (env.NEXT_PUBLIC_RAZORPAY_KEY_ID ?? "").trim(), secret: main.secret };
  const pick = test.id && test.secret ? test : local;
  if (!pick.id || !pick.secret || !pick.id.startsWith("rzp_test_")) {
    return { ok: false, error: "test payment keys are not set" };
  }
  return { ok: true, keyId: pick.id, keySecret: pick.secret };
}

export interface OrderPerson {
  full_name: string;
  date_of_birth: string; // YYYY-MM-DD
  sex: "F" | "M";
  email: string;
  phone: string;
}

export interface OrderVisit {
  address: string;
  pincode: string;
  preferred_date: string; // YYYY-MM-DD
  preferred_slot: LogisticsSlot;
  notes: string;
}

export interface BodyAgeOrder {
  order_id: string;
  kind: typeof BODY_AGE_ORDER_KIND;
  report_kind: ReportKind;
  people: OrderPerson[];
  visit: OrderVisit;
  amount_inr: number;
  status: BodyAgeOrderStatus;
  /** True for an order placed in test mode: never booked with the laboratory, never counted as revenue. */
  test: boolean;
  /** Shown to nobody: lets the buyer's own browser ask "has my payment landed?" for this order only. */
  access_key: string;
  /** When the buyer ticked the consent box, and the wording version they saw. */
  consent_at: string;
  consent_version: string;
  created_at: string;
  razorpay_order_id?: string;
  razorpay_payment_id?: string;
  paid_at?: string;
  /** Set on the coach's Mac once the order has been turned into records, one per person, in order. */
  client_ids?: string[];
  /** The buyer ticked "also send my report on WhatsApp" on the order form (consent, given at `consent_at`). The
   *  report still goes by email; WhatsApp is the extra copy. Absent = not asked for: never send it there. */
  report_on_whatsapp?: true;
  /** The body age check's voucher, when one was used: `amount_inr` is already the reduced price. */
  voucher_code?: string;
  discount_inr?: number;
  booked_for?: string;
  collected_on?: string;
}

export interface OrderInput {
  report_kind: ReportKind;
  people: OrderPerson[];
  visit: OrderVisit;
  /** The buyer asked for a copy of the report on WhatsApp too (their own tick; false or absent = no). */
  report_on_whatsapp?: true;
  /** As typed, tidied. NOT yet checked: the order route checks it (it needs the secret and the paid orders). */
  voucher_code?: string;
}

const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

function realYmd(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Completed years between a date of birth and a day, both YYYY-MM-DD. */
export function ageOn(dobYmd: string, onYmd: string): number {
  const [by, bm, bd] = dobYmd.split("-").map(Number);
  const [y, m, d] = onYmd.split("-").map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

/**
 * Validate what the order form sent. Pure. Every message is safe to show the buyer. The price is never read
 * from the form: it is worked out from the report and the number of people.
 */
export function sanitizeOrderInput(
  raw: unknown,
  opts: { todayYmd: string; minDateYmd: string },
): { ok: true; input: OrderInput; amountInr: number } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Please fill in the form." };
  const r = raw as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const report_kind = s(r.report_kind) as ReportKind;
  const rawPeople = Array.isArray(r.people) ? r.people : [];
  const amountInr = bodyAgePriceInr(report_kind, rawPeople.length);
  if (amountInr === null) return { ok: false, error: "Please choose a report, for one person or for two." };
  if (r.consent !== true) return { ok: false, error: "Please tick the box to confirm before you pay." };

  const people: OrderPerson[] = [];
  for (const [i, p] of rawPeople.entries()) {
    const who = rawPeople.length === 1 ? "your" : i === 0 ? "the first person's" : "the second person's";
    const q = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
    const full_name = s(q.full_name);
    const date_of_birth = s(q.date_of_birth);
    const sex = s(q.sex).toUpperCase();
    const email = s(q.email).toLowerCase();
    const phone = s(q.phone).replace(/[^\d+]/g, "");
    if (full_name.length < 2 || full_name.length > 120) return { ok: false, error: `Please enter ${who} full name.` };
    if (!realYmd(date_of_birth) || date_of_birth > opts.todayYmd) return { ok: false, error: `Please enter ${who} date of birth.` };
    const age = ageOn(date_of_birth, opts.todayYmd);
    if (age < MIN_AGE_YEARS) return { ok: false, error: `This report is for adults aged ${MIN_AGE_YEARS} and over.` };
    if (age > 110) return { ok: false, error: `Please check ${who} date of birth.` };
    if (sex !== "F" && sex !== "M") return { ok: false, error: `Please choose ${who} sex as recorded for laboratory ranges.` };
    if (!EMAIL.test(email) || email.length > 200) return { ok: false, error: `Please enter ${who} email address.` };
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 15) return { ok: false, error: `Please enter ${who} WhatsApp number.` };
    people.push({ full_name, date_of_birth, sex, email, phone });
  }

  const v = (r.visit && typeof r.visit === "object" ? r.visit : {}) as Record<string, unknown>;
  const checked = sanitizeLogistics(
    { ...v, full_name: people[0].full_name, phone: people[0].phone },
    { minDateYmd: opts.minDateYmd },
  );
  if (!checked.ok) {
    const e = checked.error;
    return { ok: false, error: e.charAt(0).toUpperCase() + e.slice(1) + (e.endsWith(".") ? "" : ".") };
  }
  const l = checked.logistics;
  const voucher_code = tidyVoucher(r.voucher_code);
  return {
    ok: true,
    amountInr,
    input: {
      ...(voucher_code ? { voucher_code } : {}),
      ...(r.report_on_whatsapp === true ? { report_on_whatsapp: true as const } : {}),
      report_kind,
      people,
      visit: { address: l.address, pincode: l.pincode, preferred_date: l.preferred_date, preferred_slot: l.preferred_slot, notes: l.notes },
    },
  };
}

/** The wording version of the consent line on the order page. Bump when Shivani changes that line. */
export const CONSENT_VERSION = "approved-2026-11-21";

export function buildBodyAgeOrder(
  orderId: string,
  accessKey: string,
  input: OrderInput,
  amountInr: number,
  nowIso: string,
  test: boolean,
  voucher?: { code: string; offInr: number },
): BodyAgeOrder {
  return {
    ...(voucher ? { voucher_code: voucher.code, discount_inr: voucher.offInr } : {}),
    ...(input.report_on_whatsapp ? { report_on_whatsapp: true as const } : {}),
    order_id: orderId,
    kind: BODY_AGE_ORDER_KIND,
    report_kind: input.report_kind,
    people: input.people,
    visit: input.visit,
    amount_inr: amountInr,
    status: "pending",
    test,
    access_key: accessKey,
    consent_at: nowIso,
    consent_version: CONSENT_VERSION,
    created_at: nowIso,
  };
}

const NEXT: Record<BodyAgeOrderStatus, BodyAgeOrderStatus[]> = {
  pending: ["paid", "cancelled"],
  paid: ["booked", "cancelled"],
  booked: ["collected", "booked", "cancelled"],
  collected: ["results_in"],
  results_in: ["report_sent"],
  report_sent: [],
  cancelled: [],
};

export function canMoveOrder(from: BodyAgeOrderStatus, to: BodyAgeOrderStatus): boolean {
  return (NEXT[from] ?? []).includes(to);
}

export const ORDER_ID = /^ba-\d{8}-[a-z0-9]{8}$/;
export { LOGISTICS_SLOTS };

// ── fs ───────────────────────────────────────────────────────────────────────

async function ordersDir(): Promise<string> {
  const { getPlansRoot } = await import("@/lib/fmdb/paths");
  return path.join(getPlansRoot(), "body-age-orders");
}

export async function saveBodyAgeOrder(order: BodyAgeOrder): Promise<void> {
  if (!ORDER_ID.test(order.order_id)) throw new Error("bad order id");
  const dir = await ordersDir();
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${order.order_id}.yaml`);
  const tmp = `${file}.tmp-${process.pid}`;
  await fs.writeFile(tmp, dumpYaml(order, { sortKeys: false }), "utf8");
  await fs.rename(tmp, file);
}

export async function loadBodyAgeOrder(orderId: string): Promise<BodyAgeOrder | null> {
  if (!ORDER_ID.test(orderId)) return null;
  try {
    const o = yaml.load(await fs.readFile(path.join(await ordersDir(), `${orderId}.yaml`), "utf8")) as BodyAgeOrder;
    return o && o.kind === BODY_AGE_ORDER_KIND ? o : null;
  } catch {
    return null;
  }
}

export async function loadBodyAgeOrders(): Promise<BodyAgeOrder[]> {
  let files: string[];
  try {
    files = await fs.readdir(await ordersDir());
  } catch {
    return [];
  }
  const out: BodyAgeOrder[] = [];
  for (const f of files) {
    if (!f.endsWith(".yaml")) continue;
    const o = await loadBodyAgeOrder(f.slice(0, -5));
    if (o) out.push(o);
  }
  return out.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

export async function patchBodyAgeOrder(orderId: string, patch: Partial<BodyAgeOrder>): Promise<BodyAgeOrder | null> {
  const order = await loadBodyAgeOrder(orderId);
  if (!order) return null;
  const next = { ...order, ...patch };
  await saveBodyAgeOrder(next);
  return next;
}
