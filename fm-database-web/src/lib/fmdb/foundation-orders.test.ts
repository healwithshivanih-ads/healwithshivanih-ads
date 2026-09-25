import { describe, it, expect, afterEach } from "vitest";
import {
  FOUNDATION_SESSION_PRICE_INR,
  buildFoundationOrder,
  foundationPriceFor,
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
