import { describe, it, expect } from "vitest";
import { parseAcumen } from "./lab-providers";
import {
  buildOrder,
  canTransition,
  applyTransition,
  validateOrderAmount,
  sanitizeLogistics,
  type LabOrder,
} from "./lab-orders";

const provider = parseAcumen({
  provider: { slug: "acumen-diagnostics", display_name: "Acumen", phone_e164: "+91", home_collection: true },
  profiles_final: [
    { id: 1, name: "Base Panel", audience: "everyone", our_cost_inr: 8500, mrp_inr: 12500, margin_inr: 4000, includes: ["Full thyroid", "Iron studies"] },
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

  it("populates `includes` from the profile + add-on names (drives the personalised view)", () => {
    const r = buildOrder(provider, { ...REC, profileId: 1, addons: [{ slug: "c-peptide", inr: 900 }] });
    expect(r.ok && r.order.includes).toEqual(["Full thyroid", "Iron studies", "C-Peptide"]);
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

describe("buildOrder — drops add-ons already inside the chosen panel", () => {
  const prov = parseAcumen({
    provider: { slug: "acumen-diagnostics", display_name: "Acumen", phone_e164: "+91", home_collection: true },
    profiles_final: [
      { id: 1, name: "Base", audience: "everyone", our_cost_inr: 8500, mrp_inr: 12500, margin_inr: 4000, includes: ["x"], covered_addon_slugs: ["apob"] },
      { id: 3, name: "Perimenopause", audience: "women 40+", our_cost_inr: 13000, mrp_inr: 20000, margin_inr: 7000, includes_extra: ["y"], covered_addon_slugs: ["estradiol-e2", "fsh"] },
    ],
    addon_tests: [
      { slug: "apob", name: "ApoB", quoted_inr: 650, dos_list_inr: 685 },
      { slug: "estradiol-e2", name: "Estradiol", quoted_inr: 850, dos_list_inr: 700 },
      { slug: "dhea-s", name: "DHEA-S", quoted_inr: 1400, dos_list_inr: 1400 },
    ],
  });

  it("drops a profile-covered add-on, keeps an uncovered one", () => {
    const r = buildOrder(prov, {
      ...REC,
      profileId: 3,
      addons: [{ slug: "estradiol-e2", inr: 850 }, { slug: "dhea-s", inr: 1400 }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.order.addon_slugs).toEqual(["dhea-s"]); // estradiol dropped
    expect(r.order.amount_inr).toBe(20000 + 1400); // profile + dhea only
    expect(r.order.lines.some((l) => l.slug === "estradiol-e2")).toBe(false);
  });

  it("drops a Base-covered add-on (apob) even on the peri profile", () => {
    const r = buildOrder(prov, { ...REC, profileId: 3, addons: [{ slug: "apob", inr: 650 }] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.order.addon_slugs).toEqual([]); // apob is Base-covered
    expect(r.order.amount_inr).toBe(20000);
  });

  it("an all-covered, profile-less recommendation still charges (nothing covered without a panel)", () => {
    const r = buildOrder(prov, { ...REC, profileId: null, addons: [{ slug: "apob", inr: 650 }] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.order.addon_slugs).toEqual(["apob"]);
  });
});

describe("sanitizeLogistics — client-submitted collection details", () => {
  const good = {
    full_name: "  Asha Rao ",
    phone: "+91 98765 43210",
    address: "12B, Lotus Apartments, Indiranagar, Bengaluru",
    pincode: "560038",
    preferred_date: "2026-07-02",
    preferred_slot: "morning",
    notes: "  call before arriving ",
  };

  it("accepts a valid form, trims + normalises the phone", () => {
    const r = sanitizeLogistics(good);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.logistics.full_name).toBe("Asha Rao");
    expect(r.logistics.phone).toBe("+919876543210"); // spaces stripped, + kept
    expect(r.logistics.pincode).toBe("560038");
    expect(r.logistics.preferred_slot).toBe("morning");
    expect(r.logistics.notes).toBe("call before arriving");
  });

  it("rejects a non-object body", () => {
    expect(sanitizeLogistics(null)).toMatchObject({ ok: false });
    expect(sanitizeLogistics("nope")).toMatchObject({ ok: false });
  });

  it("rejects a missing/short name", () => {
    expect(sanitizeLogistics({ ...good, full_name: "" })).toMatchObject({ ok: false });
    expect(sanitizeLogistics({ ...good, full_name: "A" })).toMatchObject({ ok: false });
  });

  it("rejects a too-short phone (after stripping non-digits)", () => {
    expect(sanitizeLogistics({ ...good, phone: "12345" })).toMatchObject({ ok: false });
  });

  it("rejects a non-6-digit pincode", () => {
    expect(sanitizeLogistics({ ...good, pincode: "5600" })).toMatchObject({ ok: false });
    expect(sanitizeLogistics({ ...good, pincode: "56003a" })).toMatchObject({ ok: false });
  });

  it("rejects a malformed or impossible date", () => {
    expect(sanitizeLogistics({ ...good, preferred_date: "02-07-2026" })).toMatchObject({ ok: false });
    expect(sanitizeLogistics({ ...good, preferred_date: "2026-02-31" })).toMatchObject({ ok: false });
  });

  it("rejects a slot outside the allowlist", () => {
    expect(sanitizeLogistics({ ...good, preferred_slot: "midnight" })).toMatchObject({ ok: false });
    expect(sanitizeLogistics({ ...good, preferred_slot: "" })).toMatchObject({ ok: false });
  });

  it("rejects an over-long address / notes", () => {
    expect(sanitizeLogistics({ ...good, address: "x".repeat(401) })).toMatchObject({ ok: false });
    expect(sanitizeLogistics({ ...good, notes: "x".repeat(601) })).toMatchObject({ ok: false });
  });

  it("accepts an empty notes field", () => {
    const r = sanitizeLogistics({ ...good, notes: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.logistics.notes).toBe("");
  });
});
