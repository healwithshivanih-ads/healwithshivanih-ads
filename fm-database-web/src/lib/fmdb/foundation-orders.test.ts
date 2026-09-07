import { describe, it, expect, afterEach } from "vitest";
import {
  FOUNDATION_SESSION_PRICE_INR,
  buildFoundationOrder,
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

describe("resolveFoundationRazorpay — isolates the Ochre Life account", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("prefers the Ochre Life keys when set and reports it configured", () => {
    process.env.OCHRE_LIFE_RAZORPAY_KEY_ID = "rzp_live_ochre";
    process.env.OCHRE_LIFE_RAZORPAY_KEY_SECRET = "secret_ochre";
    process.env.RAZORPAY_KEY_ID = "rzp_live_crafts";
    process.env.RAZORPAY_KEY_SECRET = "secret_crafts";
    const r = resolveFoundationRazorpay();
    expect(r.keyId).toBe("rzp_live_ochre");
    expect(r.keySecret).toBe("secret_ochre");
    expect(r.ochreLifeConfigured).toBe(true);
    expect(r.live).toBe(true);
  });

  it("falls back to the default account but reports NOT configured (the pay route then refuses LIVE)", () => {
    delete process.env.OCHRE_LIFE_RAZORPAY_KEY_ID;
    delete process.env.OCHRE_LIFE_RAZORPAY_KEY_SECRET;
    process.env.RAZORPAY_KEY_ID = "rzp_live_crafts";
    process.env.RAZORPAY_KEY_SECRET = "secret_crafts";
    const r = resolveFoundationRazorpay();
    expect(r.keyId).toBe("rzp_live_crafts");
    expect(r.ochreLifeConfigured).toBe(false);
    expect(r.live).toBe(true); // live + !configured ⟹ pay route MUST refuse
  });

  it("detects test keys as not-live (fallback is safe for testing)", () => {
    delete process.env.OCHRE_LIFE_RAZORPAY_KEY_ID;
    delete process.env.OCHRE_LIFE_RAZORPAY_KEY_SECRET;
    process.env.RAZORPAY_KEY_ID = "rzp_test_crafts";
    process.env.RAZORPAY_KEY_SECRET = "secret_test";
    const r = resolveFoundationRazorpay();
    expect(r.live).toBe(false);
    expect(r.ochreLifeConfigured).toBe(false);
  });
});

describe("foundationWebhookSecret", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });
  it("prefers the Ochre Life webhook secret", () => {
    process.env.OCHRE_LIFE_RAZORPAY_WEBHOOK_SECRET = "wh_ochre";
    process.env.RAZORPAY_WEBHOOK_SECRET = "wh_crafts";
    expect(foundationWebhookSecret()).toBe("wh_ochre");
  });
  it("falls back to the default webhook secret", () => {
    delete process.env.OCHRE_LIFE_RAZORPAY_WEBHOOK_SECRET;
    process.env.RAZORPAY_WEBHOOK_SECRET = "wh_crafts";
    expect(foundationWebhookSecret()).toBe("wh_crafts");
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
