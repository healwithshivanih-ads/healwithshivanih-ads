import { describe, it, expect, afterEach } from "vitest";
import {
  FOUNDATION_SESSION_PRICE_INR,
  buildFoundationOrder,
  foundationPriceFor,
  bodyAgeCreditUntil,
  todayYmdIST,
  FOUNDATION_AFTER_BODY_AGE_REPORT_INR,
  resolveFoundationRazorpay,
  foundationWebhookSecret,
  foundationCallUrl,
} from "./foundation-orders";

describe("FOUNDATION_SESSION_PRICE_INR — server-fixed, never client-trusted", () => {
  it("is ₹12,000", () => {
    expect(FOUNDATION_SESSION_PRICE_INR).toBe(12000);
  });
});

describe("buildFoundationOrder", () => {
  it("builds a pending order at the fixed price", () => {
    const o = buildFoundationOrder("foundation-2026-09-07-01", "cl-900", "2026-09-07T00:00:00Z");
    expect(o.status).toBe("pending");
    expect(o.kind).toBe("foundation_session");
    expect(o.amount_inr).toBe(FOUNDATION_SESSION_PRICE_INR);
    expect(o.client_id).toBe("cl-900");
    expect(o.razorpay_payment_id).toBeUndefined();
    expect(o.paid_at).toBeUndefined();
  });
});

describe("resolveFoundationRazorpay — shares the single RAZORPAY_* account", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("reads the single RAZORPAY_* key/secret", () => {
    process.env.RAZORPAY_KEY_ID = "rzp_live_ochre";
    process.env.RAZORPAY_KEY_SECRET = "secret_ochre";
    delete process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
    const r = resolveFoundationRazorpay();
    expect(r.keyId).toBe("rzp_live_ochre");
    expect(r.keySecret).toBe("secret_ochre");
    expect(r.publicKeyId).toBe("rzp_live_ochre"); // falls back to keyId when NEXT_PUBLIC unset
  });

  it("returns the public key id when set (never the secret to the client)", () => {
    process.env.RAZORPAY_KEY_ID = "rzp_live_ochre";
    process.env.RAZORPAY_KEY_SECRET = "secret_ochre";
    process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID = "rzp_live_public";
    expect(resolveFoundationRazorpay().publicKeyId).toBe("rzp_live_public");
  });
});

describe("foundationWebhookSecret — shared with lab + maintenance webhooks", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });
  it("reads RAZORPAY_WEBHOOK_SECRET", () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = "wh_shared";
    expect(foundationWebhookSecret()).toBe("wh_shared");
  });
});

describe("foundationCallUrl", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });
  it("uses the env override, trimmed of a trailing slash", () => {
    process.env.FOUNDATION_CALL_URL = "https://cal.com/x/foundation-session/";
    expect(foundationCallUrl()).toBe("https://cal.com/x/foundation-session");
  });
  it("defaults to the programme-intake session when unset", () => {
    delete process.env.FOUNDATION_CALL_URL;
    expect(foundationCallUrl()).toContain("cal.com/shivani-hariharan-0xyy3l/");
  });
});

describe("foundationPriceFor — the ₹999 short-call credit", () => {
  it("charges the list price with no short call on record", () => {
    expect(foundationPriceFor({}).amountInr).toBe(12000);
    expect(foundationPriceFor(null).creditInr).toBe(0);
  });
  it("takes ₹999 off when the paid short call is recorded", () => {
    const p = foundationPriceFor({ triage_call_date: "2026-09-20" });
    expect(p).toMatchObject({ amountInr: 11001, creditInr: 999 });
    expect(p.creditReason).toContain("2026-09-20");
  });
  it("reads a js-yaml Date the same way", () => {
    expect(foundationPriceFor({ triage_call_date: new Date("2026-09-20T00:00:00Z") }).amountInr).toBe(11001);
  });
  it("a funnel-reported ₹999 payment is the credit too", () => {
    const p = foundationPriceFor({ triage_paid_at: "2026-09-24T10:11:12.000Z" });
    expect(p).toMatchObject({ amountInr: 11001, creditInr: 999 });
    expect(p.creditReason).toContain("2026-09-24");
  });
  it("ignores junk rather than discounting", () => {
    expect(foundationPriceFor({ triage_call_date: "yes" }).amountInr).toBe(12000);
  });
  it("stamps the credit on the order it builds", () => {
    const o = buildFoundationOrder("f-1", "cl-1", "2026-09-25T00:00:00Z", foundationPriceFor({ triage_call_date: "2026-09-20" }));
    expect(o).toMatchObject({ amount_inr: 11001, credit_inr: 999 });
  });
});

describe("foundationPriceFor — the body age report credit", () => {
  const std = { body_age_report_kind: "standard", body_age_report_date: "2026-07-07" };
  const deep = { body_age_report_kind: "deeper", body_age_report_date: "2026-07-07" };

  it("is ₹7,000 after the standard report and ₹2,000 after the deeper one", () => {
    expect(foundationPriceFor(std, "2026-07-07")).toMatchObject({ amountInr: 7000, creditInr: 5000, creditKind: "body_age_report" });
    expect(foundationPriceFor(deep, "2026-07-10")).toMatchObject({ amountInr: 2000, creditInr: 10000 });
    expect(FOUNDATION_AFTER_BODY_AGE_REPORT_INR).toEqual({ standard: 7000, deeper: 2000 });
  });
  it("holds up to and including day 14, and is the full price from day 15", () => {
    expect(bodyAgeCreditUntil(std)).toBe("2026-07-21");
    expect(foundationPriceFor(std, "2026-07-21")).toMatchObject({ amountInr: 7000, creditUntil: "2026-07-21" });
    expect(foundationPriceFor(std, "2026-07-22")).toMatchObject({ amountInr: 12000, creditInr: 0 });
    expect(foundationPriceFor(std, "2026-07-22").creditKind).toBeUndefined();
  });
  it("does not apply before the report date", () => {
    expect(foundationPriceFor(std, "2026-07-06").amountInr).toBe(12000);
  });
  it("reads a js-yaml Date the same way", () => {
    const c = { body_age_report_kind: "deeper", body_age_report_date: new Date("2026-07-07T00:00:00Z") };
    expect(foundationPriceFor(c, "2026-07-15").amountInr).toBe(2000);
  });
  it("needs both a known type and a date, and ignores junk rather than discounting", () => {
    expect(foundationPriceFor({ body_age_report_kind: "standard" }, "2026-07-08").amountInr).toBe(12000);
    expect(foundationPriceFor({ body_age_report_date: "2026-07-07" }, "2026-07-08").amountInr).toBe(12000);
    expect(foundationPriceFor({ body_age_report_kind: "premium", body_age_report_date: "2026-07-07" }, "2026-07-08").amountInr).toBe(12000);
    expect(foundationPriceFor({ body_age_report_kind: "constructor", body_age_report_date: "2026-07-07" }, "2026-07-08").amountInr).toBe(12000);
  });
  it("does not add to the ₹999 short call: the larger credit applies, then the short call is left", () => {
    const both = { ...std, triage_call_date: "2026-07-01" };
    expect(foundationPriceFor(both, "2026-07-10")).toMatchObject({ amountInr: 7000, creditKind: "body_age_report" });
    expect(foundationPriceFor(both, "2026-07-30")).toMatchObject({ amountInr: 11001, creditKind: "triage_call" });
  });
  it("stamps the report credit on the order it builds", () => {
    const o = buildFoundationOrder("f-2", "cl-900", "2026-07-08T00:00:00Z", foundationPriceFor(deep, "2026-07-08"));
    expect(o).toMatchObject({ amount_inr: 2000, credit_inr: 10000 });
    expect(o.credit_reason).toContain("body age report");
  });
  it("counts the day in India, not in UTC", () => {
    // 21 July 23:30 IST is still 21 July in India though it is 18:00 UTC; 22 July 00:30 IST is 21 July 19:00 UTC.
    expect(todayYmdIST(new Date("2026-07-21T18:00:00Z"))).toBe("2026-07-21");
    expect(todayYmdIST(new Date("2026-07-21T19:00:00Z"))).toBe("2026-07-22");
  });
});
