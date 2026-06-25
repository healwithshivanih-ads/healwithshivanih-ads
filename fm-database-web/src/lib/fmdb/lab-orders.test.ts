import { describe, it, expect } from "vitest";
import { parseAcumen } from "./lab-providers";
import { buildOrder, canTransition, applyTransition, validateOrderAmount, type LabOrder } from "./lab-orders";

const provider = parseAcumen({
  provider: { slug: "acumen-diagnostics", display_name: "Acumen", phone_e164: "+91", home_collection: true },
  profiles_final: [
    { id: 1, name: "Base Panel", audience: "everyone", our_cost_inr: 8500, mrp_inr: 12500, margin_inr: 4000 },
    { id: 4, name: "Male", audience: "men", our_cost_inr: 14000, mrp_inr: 21000, margin_inr: 7000 },
  ],
  addon_tests: [{ slug: "c-peptide", name: "C-Peptide", quoted_inr: 1400, dos_list_inr: 1400 }],
});

const REC = { clientId: "cl-x", recommendedBy: "shivani", orderId: "2026-06-25-lab001", now: "2026-06-25T10:00:00.000Z" };

describe("buildOrder — coach-approved, server-derived amount", () => {
  it("profile only → catalogue MRP, our cost, recommended status", () => {
    const r = buildOrder(provider, { ...REC, profileId: 1 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.order).toMatchObject({
      amount_inr: 12500,
      our_cost_inr: 8500,
      status: "recommended",
      profile_id: 1,
      addon_slugs: [],
      fasting_required: true,
      recommended_by: "shivani",
    });
    expect(r.order.lines).toEqual([{ label: "Base Panel", inr: 12500 }]);
  });

  it("profile + coach-priced add-on → totals = MRP + coach price; cost includes add-on cost", () => {
    const r = buildOrder(provider, { ...REC, profileId: 1, addons: [{ slug: "c-peptide", inr: 900 }] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.order.amount_inr).toBe(13400); // 12500 + 900 (coach-set)
    expect(r.order.our_cost_inr).toBe(9200); // 8500 + 700 (50% of 1400 catalogue)
    expect(r.order.addon_slugs).toEqual(["c-peptide"]);
    expect(r.order.lines).toEqual([
      { label: "Base Panel", inr: 12500 },
      { label: "C-Peptide", inr: 900, slug: "c-peptide" },
    ]);
  });

  it("pure add-on order (no profile) → non-fasting, amount = add-on price", () => {
    const r = buildOrder(provider, { ...REC, profileId: null, addons: [{ slug: "c-peptide", inr: 900 }] });
    expect(r.ok && r.order).toMatchObject({ amount_inr: 900, fasting_required: false, profile_id: null });
  });

  it("rejects an empty recommendation", () => {
    expect(buildOrder(provider, { ...REC, profileId: null })).toEqual({ ok: false, error: expect.stringContaining("empty") });
  });
  it("rejects an unknown profile", () => {
    expect(buildOrder(provider, { ...REC, profileId: 99 })).toEqual({ ok: false, error: expect.stringContaining("unknown profile") });
  });
  it("rejects an unknown add-on", () => {
    expect(buildOrder(provider, { ...REC, profileId: 1, addons: [{ slug: "nope", inr: 500 }] })).toEqual({
      ok: false,
      error: expect.stringContaining("unknown add-on"),
    });
  });
  it("rejects a non-positive add-on price", () => {
    expect(buildOrder(provider, { ...REC, profileId: 1, addons: [{ slug: "c-peptide", inr: 0 }] })).toEqual({
      ok: false,
      error: expect.stringContaining("sane coach price"),
    });
  });

  // ── hardening (adversarial review 2026-06-25) ──
  it("rejects Infinity / NaN / over-ceiling add-on prices (no corrupt amount)", () => {
    for (const bad of [Infinity, -Infinity, NaN, 1e309, 200001]) {
      expect(buildOrder(provider, { ...REC, profileId: 1, addons: [{ slug: "c-peptide", inr: bad }] }).ok).toBe(false);
    }
    // exactly the ceiling is allowed
    expect(buildOrder(provider, { ...REC, profileId: 1, addons: [{ slug: "c-peptide", inr: 200000 }] }).ok).toBe(true);
  });

  it("treats a non-array `addons` as none (no throw)", () => {
    const r = buildOrder(provider, { ...REC, profileId: 1, addons: "oops" as unknown as never });
    expect(r.ok && r.order.amount_inr).toBe(12500); // profile only; bad addons ignored
    expect(buildOrder(provider, { ...REC, profileId: null, addons: "oops" as unknown as never })).toEqual({
      ok: false,
      error: expect.stringContaining("empty"),
    });
  });
});

describe("validateOrderAmount — the pay-time bound-check", () => {
  const baseOrder = () => {
    const r = buildOrder(provider, { ...REC, profileId: 1, addons: [{ slug: "c-peptide", inr: 900 }] });
    if (!r.ok) throw new Error("fixture build failed");
    return r.order;
  };

  it("passes a well-formed order (profile = catalogue MRP, lines sum, amount ≥ cost)", () => {
    expect(validateOrderAmount(provider, baseOrder())).toEqual({ ok: true });
  });
  it("rejects a tampered amount (lines no longer sum to amount_inr)", () => {
    const o = { ...baseOrder(), amount_inr: 1 };
    expect(validateOrderAmount(provider, o)).toMatchObject({ ok: false });
  });
  it("rejects a profile line that doesn't match the catalogue MRP", () => {
    // 10000 ≠ catalogue 12500, but kept above our_cost (9200) so the profile
    // check — not the cost-floor check — is what fires.
    const o = baseOrder();
    o.lines = [{ label: "Base Panel", inr: 10000 }, ...o.lines.slice(1)];
    o.amount_inr = o.lines.reduce((s, l) => s + l.inr, 0);
    expect(validateOrderAmount(provider, o)).toMatchObject({ ok: false, error: expect.stringContaining("catalogue") });
  });
  it("rejects amount below our cost", () => {
    expect(validateOrderAmount(provider, { ...baseOrder(), our_cost_inr: 999999 })).toMatchObject({ ok: false });
  });
  it("rejects an add-on line above the ceiling", () => {
    const o = baseOrder();
    const addonLine = o.lines.find((l) => l.slug);
    if (addonLine) addonLine.inr = 999999;
    o.amount_inr = o.lines.reduce((s, l) => s + l.inr, 0);
    expect(validateOrderAmount(provider, o)).toMatchObject({ ok: false });
  });
});

describe("status machine", () => {
  it("allows the forward path", () => {
    expect(canTransition("recommended", "paid")).toBe(true);
    expect(canTransition("paid", "booked")).toBe(true);
    expect(canTransition("booked", "sample_collected")).toBe(true);
    expect(canTransition("sample_collected", "results_in")).toBe(true);
  });
  it("allows cancellation from any non-terminal state", () => {
    expect(canTransition("recommended", "cancelled")).toBe(true);
    expect(canTransition("paid", "cancelled")).toBe(true);
  });
  it("rejects skips + moves out of terminal states", () => {
    expect(canTransition("recommended", "booked")).toBe(false); // can't skip paid
    expect(canTransition("results_in", "paid")).toBe(false);
    expect(canTransition("cancelled", "paid")).toBe(false);
  });

  it("applyTransition stamps the patch on a legal move, rejects an illegal one", () => {
    const order = { status: "recommended", razorpay_payment_id: null, paid_at: null } as unknown as LabOrder;
    const ok = applyTransition(order, "paid", { razorpay_payment_id: "pay_123", paid_at: "2026-06-25T11:00:00Z" });
    expect(ok).toMatchObject({ ok: true });
    if (ok.ok) expect(ok.order).toMatchObject({ status: "paid", razorpay_payment_id: "pay_123" });
    expect(applyTransition(order, "booked")).toEqual({ ok: false, error: expect.stringContaining("illegal transition") });
  });
});
