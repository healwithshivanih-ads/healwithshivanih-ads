import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sentMail: Array<{ to: string; subject: string; text: string }> = [];
vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail: async (m: { to: string; subject: string; text: string }) => void sentMail.push(m) }) },
}));

import {
  ageOn,
  bodyAgePriceInr,
  buildBodyAgeOrder,
  canMoveOrder,
  loadBodyAgeOrder,
  loadBodyAgeOrders,
  orderPageMode,
  orderRazorpayKeys,
  patchBodyAgeOrder,
  sanitizeOrderInput,
  saveBodyAgeOrder,
} from "../body-age-orders";
import { EMBARGO_UNTIL_MS } from "../body-age-send";
import { coachEmail, receiptIsGenuine, settleBodyAgePayment } from "../body-age-payment";
import { isPublicPath } from "../middleware-policy";
import { COPY } from "../../../app/order/body-age/order-copy";

const OPTS = { todayYmd: "2027-01-05", minDateYmd: "2027-01-07" };
const ASHA = { full_name: "Asha Rao", date_of_birth: "1980-03-02", sex: "F", email: "Asha@Example.com", phone: "+91 98200 00000" };
const RAVI = { full_name: "Ravi Rao", date_of_birth: "1978-11-20", sex: "M", email: "ravi@example.com", phone: "9820000001" };
const VISIT = { address: "12 Palm Grove, Bandra West, Mumbai", pincode: "400050", preferred_date: "2027-01-08", preferred_slot: "morning", notes: "" };
const form = (over: Record<string, unknown> = {}) => ({ report_kind: "standard", people: [ASHA], visit: VISIT, consent: true, ...over });

describe("body age order: price and switch", () => {
  it("charges the four agreed prices and nothing else", () => {
    expect(bodyAgePriceInr("standard", 1)).toBe(4999);
    expect(bodyAgePriceInr("deeper", 1)).toBe(9999);
    expect(bodyAgePriceInr("standard", 2)).toBe(8999);
    expect(bodyAgePriceInr("deeper", 2)).toBe(17999);
    expect(bodyAgePriceInr("standard", 3)).toBeNull();
    expect(bodyAgePriceInr("other" as "standard", 1)).toBeNull();
  });

  it("the page is off unless switched on, and 'live' does nothing before the launch moment", () => {
    expect(orderPageMode(undefined, EMBARGO_UNTIL_MS + 1)).toBe("off");
    expect(orderPageMode("", 0)).toBe("off");
    expect(orderPageMode("yes", EMBARGO_UNTIL_MS + 1)).toBe("off");
    expect(orderPageMode("test", 0)).toBe("test");
    expect(orderPageMode("live", EMBARGO_UNTIL_MS - 1)).toBe("off");
    expect(orderPageMode("LIVE", EMBARGO_UNTIL_MS)).toBe("live");
  });

  it("test mode can only ever use a test payment key; live mode never uses one", () => {
    const live = { RAZORPAY_KEY_ID: "rzp_live_abc", RAZORPAY_KEY_SECRET: "s" };
    expect(orderRazorpayKeys("test", live).ok).toBe(false); // real money impossible in test mode
    expect(orderRazorpayKeys("test", { ...live, RAZORPAY_TEST_KEY_ID: "rzp_live_zzz", RAZORPAY_TEST_KEY_SECRET: "t" }).ok).toBe(false);
    expect(orderRazorpayKeys("test", { ...live, RAZORPAY_TEST_KEY_ID: "rzp_test_1", RAZORPAY_TEST_KEY_SECRET: "t" })).toEqual({ ok: true, keyId: "rzp_test_1", keySecret: "t" });
    expect(orderRazorpayKeys("test", { RAZORPAY_KEY_ID: "rzp_test_2", RAZORPAY_KEY_SECRET: "u" })).toEqual({ ok: true, keyId: "rzp_test_2", keySecret: "u" });
    expect(orderRazorpayKeys("test", { NEXT_PUBLIC_RAZORPAY_KEY_ID: "rzp_test_3", RAZORPAY_KEY_SECRET: "v" })).toEqual({ ok: true, keyId: "rzp_test_3", keySecret: "v" });
    expect(orderRazorpayKeys("live", { NEXT_PUBLIC_RAZORPAY_KEY_ID: "rzp_live_3", RAZORPAY_KEY_SECRET: "v" }).ok).toBe(false);
    expect(orderRazorpayKeys("live", live)).toEqual({ ok: true, keyId: "rzp_live_abc", keySecret: "s" });
    expect(orderRazorpayKeys("live", { RAZORPAY_KEY_ID: "rzp_test_2", RAZORPAY_KEY_SECRET: "u" }).ok).toBe(false);
    expect(orderRazorpayKeys("off", live).ok).toBe(false);
  });
});

describe("body age order: the form", () => {
  it("accepts one person or two, and takes the price from the choice, never from the form", () => {
    const one = sanitizeOrderInput(form({ amount_inr: 1 }), OPTS);
    expect(one.ok && one.amountInr).toBe(4999);
    expect(one.ok && one.input.people[0]).toEqual({ ...ASHA, email: "asha@example.com", phone: "+919820000000" });
    const two = sanitizeOrderInput(form({ report_kind: "deeper", people: [ASHA, RAVI] }), OPTS);
    expect(two.ok && two.amountInr).toBe(17999);
  });

  it("refuses without consent, under 18, or with a detail missing", () => {
    const bad = [
      form({ consent: false }),
      form({ consent: "true" }),
      form({ people: [] }),
      form({ people: [ASHA, RAVI, RAVI] }),
      form({ report_kind: "premium" }),
      form({ people: [{ ...ASHA, date_of_birth: "2010-01-06" }] }),
      form({ people: [{ ...ASHA, date_of_birth: "2009-01-06" }] }), // 17 on the day
      form({ people: [{ ...ASHA, date_of_birth: "1980-02-31" }] }),
      form({ people: [{ ...ASHA, sex: "" }] }),
      form({ people: [{ ...ASHA, email: "asha@" }] }),
      form({ people: [{ ...ASHA, phone: "12345" }] }),
      form({ people: [ASHA, { ...RAVI, full_name: "" }] }),
      form({ visit: { ...VISIT, pincode: "4000" } }),
      form({ visit: { ...VISIT, preferred_date: "2027-01-06" } }), // inside the 36 hours
      form({ visit: { ...VISIT, preferred_slot: "midnight" } }),
      null,
    ];
    for (const b of bad) expect(sanitizeOrderInput(b, OPTS).ok, JSON.stringify(b)).toBe(false);
    expect(sanitizeOrderInput(form({ people: [{ ...ASHA, date_of_birth: "2009-01-05" }] }), OPTS).ok).toBe(true); // 18 today
    expect(ageOn("1980-03-02", "2027-03-01")).toBe(46);
    expect(ageOn("1980-03-02", "2027-03-02")).toBe(47);
  });

  it("an order only moves forward", () => {
    expect(canMoveOrder("pending", "paid")).toBe(true);
    expect(canMoveOrder("paid", "booked")).toBe(true);
    expect(canMoveOrder("pending", "booked")).toBe(false);
    expect(canMoveOrder("collected", "cancelled")).toBe(false);
    expect(canMoveOrder("report_sent", "paid")).toBe(false);
  });
});

describe("body age order: getting paid", () => {
  let root: string;
  let prev: NodeJS.ProcessEnv;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ba-orders-"));
    prev = { ...process.env };
    process.env.FMDB_PLANS_DIR = root;
    process.env.GMAIL_USER = "ops@example.com";
    process.env.GMAIL_APP_PASSWORD = "x";
    delete process.env.COACH_DIGEST_EMAIL;
    sentMail.length = 0;
  });
  afterEach(() => {
    process.env = prev;
    fs.rmSync(root, { recursive: true, force: true });
  });

  async function placed(test = true) {
    const ok = sanitizeOrderInput(form({ people: [ASHA, RAVI] }), OPTS);
    if (!ok.ok) throw new Error(ok.error);
    const o = buildBodyAgeOrder("ba-20270105-ab12cd34", "key-123", ok.input, ok.amountInr, "2027-01-05T05:00:00.000Z", test);
    await saveBodyAgeOrder(o);
    await patchBodyAgeOrder(o.order_id, { razorpay_order_id: "order_X" });
    return o;
  }

  it("a signed receipt is genuine only with the right secret, order and payment", () => {
    const sig = crypto.createHmac("sha256", "secret").update("order_X|pay_1").digest("hex");
    expect(receiptIsGenuine("order_X", "pay_1", sig, "secret")).toBe(true);
    expect(receiptIsGenuine("order_X", "pay_2", sig, "secret")).toBe(false);
    expect(receiptIsGenuine("order_Y", "pay_1", sig, "secret")).toBe(false);
    expect(receiptIsGenuine("order_X", "pay_1", sig, "other")).toBe(false);
    expect(receiptIsGenuine("order_X", "pay_1", "", "secret")).toBe(false);
    expect(receiptIsGenuine("order_X", "pay_1", sig, "")).toBe(false);
  });

  it("marks the order paid once, emails the coach once, and never the buyer", async () => {
    const o = await placed();
    const first = await settleBodyAgePayment({ orderId: o.order_id, rzpOrderId: "order_X", rzpPaymentId: "pay_1" });
    expect(first.ok && first.already).toBe(false);
    const again = await settleBodyAgePayment({ orderId: o.order_id, rzpOrderId: "order_X", rzpPaymentId: "pay_1" });
    expect(again.ok && again.already).toBe(true);
    const saved = await loadBodyAgeOrder(o.order_id);
    expect(saved?.status).toBe("paid");
    expect(saved?.razorpay_payment_id).toBe("pay_1");
    expect(sentMail).toHaveLength(1);
    expect(sentMail[0].to).toBe("ops@example.com");
    expect(sentMail[0].to).not.toMatch(/asha|ravi/);
    expect(sentMail[0].subject).toMatch(/^\[TEST\]/);
    expect((await loadBodyAgeOrders()).map((x) => x.order_id)).toEqual([o.order_id]);
  });

  it("ignores a payment for another order, an unknown order, and an order that has moved on", async () => {
    const o = await placed();
    expect((await settleBodyAgePayment({ orderId: o.order_id, rzpOrderId: "order_OTHER", rzpPaymentId: "pay_1" })).ok).toBe(false);
    expect((await settleBodyAgePayment({ orderId: "ba-20270105-zzzzzzzz", rzpOrderId: "order_X", rzpPaymentId: "pay_1" })).ok).toBe(false);
    expect((await settleBodyAgePayment({ orderId: "../../x", rzpOrderId: "order_X", rzpPaymentId: "pay_1" })).ok).toBe(false);
    await patchBodyAgeOrder(o.order_id, { status: "cancelled" });
    expect((await settleBodyAgePayment({ orderId: o.order_id, rzpOrderId: "order_X", rzpPaymentId: "pay_1" })).ok).toBe(false);
    expect(sentMail).toHaveLength(0);
  });

  it("a real order's coach email is not marked test and says nothing was sent", async () => {
    const o = await placed(false);
    const m = coachEmail({ ...o, status: "paid" });
    expect(m.subject).not.toMatch(/TEST/);
    expect(m.text).toMatch(/Nothing has been sent to them/);
    expect(m.text).toMatch(/₹8,999/);
  });
});

describe("body age order: what is public and what a buyer reads", () => {
  it("the order page and its routes are public; the coach-only report files are not", () => {
    expect(isPublicPath("/order/body-age")).toBe(true);
    expect(isPublicPath("/api/body-age/order")).toBe(true);
    expect(isPublicPath("/api/body-age/webhook")).toBe(true);
    expect(isPublicPath("/api/body-age-file/cl-900/BA-1/report.pdf")).toBe(false);
    expect(isPublicPath("/api/body-age")).toBe(false);
    expect(isPublicPath("/orders")).toBe(false);
  });

  it("the page's words keep her rules", () => {
    const all = JSON.stringify(COPY);
    for (const banned of [/urgent/i, /rings/i, /sequoya/i, /thyrocare/i, /acumen/i, /\bfree\b(?! thyroid)/i, /programme/i, /85,?000/, /twelve|12[- ]week/i, /not a doctor/i, /in person|we meet|see you/i]) {
      expect(all, String(banned)).not.toMatch(banned);
    }
    expect(all).toMatch(/body age report/i);
  });
});
