/**
 * Tests for the plan ⇆ client-payload parity checker.
 *
 * Every assertion family here must be FAILABLE — a check that cannot go red is
 * not a check. Two kinds of test do that work:
 *
 *   - doctored-payload tests: hand-built payloads that carry the exact defect
 *     that shipped (a supplement dropped, a "before bed" item in Morning, a
 *     methi link pointing at selenium). They fail the day the checker stops
 *     looking.
 *   - "through the real parser" tests: the payload slot is produced by the
 *     PRODUCTION timing→slot pipeline, while the expectation comes from the
 *     curated table. Break BEDTIME_CUE in client-app-format.ts and these go
 *     red — which is what proves the table is independent of the parser.
 */
import { describe, it, expect } from "vitest";
import {
  checkPlanAppParity,
  expectedSlotFor,
  identityTokens,
  namesShareIdentity,
  CURATED_TIMING_SLOT,
  type ParityAppData,
  type ParityFinding,
} from "./plan-app-parity";
import { timingRank, slotFromRank } from "./client-app-format";

// ── fixtures: synthetic, never a real client ───────────────────────────────

type Supp = Partial<ParityAppData["supplements"][number]>;

function supp(over: Supp = {}): ParityAppData["supplements"][number] {
  return {
    id: "s-magnesium",
    name: "Magnesium glycinate",
    dose: "200 mg",
    slot: "Bedtime",
    chronoRank: 70,
    timing: "Bedtime",
    why: "",
    startWeek: 1,
    durationWeeks: null,
    status: "current",
    ...over,
  } as ParityAppData["supplements"][number];
}

function payload(over: Partial<ParityAppData> = {}): ParityAppData {
  const s = [supp()];
  return {
    supplements: s,
    allSupplements: s,
    upcomingSupplements: [],
    weekMenus: [],
    practices: [],
    remedies: [],
    client: { week: 3 },
    seedCycling: null,
    periodCare: null,
    breathwork: null,
    eft: null,
    sleep: null,
    mindBody: null,
    ...over,
  } as unknown as ParityAppData;
}

const codes = (f: ParityFinding[]) => f.map((x) => x.code);
const errors = (f: ParityFinding[]) => f.filter((x) => x.severity === "error");

// ── PRESENCE ───────────────────────────────────────────────────────────────

describe("PRESENCE — the plan's items reach the phone", () => {
  const plan = {
    supplement_protocol: [
      { supplement_slug: "magnesium", display_name: "Magnesium glycinate", timing: "bedtime", start_week: 1 },
      { supplement_slug: "vitamin-d3", display_name: "Vitamin D3", timing: "with breakfast", start_week: 1 },
    ],
  };

  it("passes when every prescribed supplement is in the payload", () => {
    const app = payload({
      supplements: [supp(), supp({ id: "s-vitamin-d3", name: "Vitamin D3", slot: "Morning" })],
      allSupplements: [supp(), supp({ id: "s-vitamin-d3", name: "Vitamin D3", slot: "Morning" })],
    });
    expect(errors(checkPlanAppParity(plan, app))).toEqual([]);
  });

  it("goes red, naming the supplement, when the builder drops one", () => {
    // the whole defect class: the plan prescribes it, the client never sees it
    const app = payload();
    const found = checkPlanAppParity(plan, app);
    expect(codes(found)).toContain("supplement-missing");
    expect(found.find((f) => f.code === "supplement-missing")?.item).toBe("Vitamin D3");
  });

  it("does NOT flag a supplement that has not started yet", () => {
    const later = {
      supplement_protocol: [
        { supplement_slug: "magnesium", display_name: "Magnesium glycinate", timing: "bedtime", start_week: 1 },
        { supplement_slug: "berberine", display_name: "Berberine", timing: "with lunch", start_week: 9 },
      ],
    };
    const app = payload({
      allSupplements: [supp(), supp({ id: "s-berberine", name: "Berberine", slot: "With meals", startWeek: 9, status: "later" })],
    });
    expect(errors(checkPlanAppParity(later, app))).toEqual([]);
  });

  it("flags a future supplement that leaked into today's routine", () => {
    const later = {
      supplement_protocol: [
        { supplement_slug: "berberine", display_name: "Berberine", timing: "with lunch", start_week: 9 },
      ],
    };
    const leaked = supp({ id: "s-berberine", name: "Berberine", slot: "With meals", startWeek: 9, status: "later" });
    const app = payload({ supplements: [leaked], allSupplements: [leaked] });
    expect(codes(checkPlanAppParity(later, app))).toContain("supplement-leaked-into-today");
  });

  it("flags a finished course still shown as today's supplement", () => {
    const done = {
      supplement_protocol: [
        { supplement_slug: "iron", display_name: "Iron", timing: "with lunch", start_week: 1, duration_weeks: 2 },
      ],
    };
    const stale = supp({ id: "s-iron", name: "Iron", slot: "With meals", startWeek: 1, durationWeeks: 2, status: "past" });
    const app = payload({ supplements: [stale], allSupplements: [stale] });
    expect(codes(checkPlanAppParity(done, app))).toContain("supplement-leaked-into-today");
  });

  it("flags an assigned remedy the payload has no card for", () => {
    // real shape of the failure: nutrition.home_remedies carries prose instead
    // of a catalogue slug, the builder skips it, the client never sees it
    const p = { nutrition: { home_remedies: ["methi-water"] }, supplement_protocol: [] };
    const found = checkPlanAppParity(p, payload({ supplements: [], allSupplements: [] }));
    expect(codes(found)).toContain("remedy-missing");
  });

  it("accepts a remedy routed into the payload's remedy list", () => {
    const p = { nutrition: { home_remedies: ["methi-water"] }, supplement_protocol: [] };
    const app = payload({
      supplements: [],
      allSupplements: [],
      remedies: [{ slug: "methi-water", name: "Methi water" } as ParityAppData["remedies"][number]],
    });
    expect(errors(checkPlanAppParity(p, app))).toEqual([]);
  });

  it("flags a prescribed practice the client never sees", () => {
    const p = { supplement_protocol: [], lifestyle_practices: [{ name: "Post-meal walk" }] };
    const found = checkPlanAppParity(p, payload({ supplements: [], allSupplements: [] }));
    expect(codes(found)).toContain("practice-missing");
  });

  it("accepts a practice the builder routed to its own card (seed cycling)", () => {
    const p = { supplement_protocol: [], lifestyle_practices: [{ name: "Seed cycling (cycle-synced)" }] };
    const app = payload({
      supplements: [],
      allSupplements: [],
      seedCycling: { seeds: [] } as unknown as ParityAppData["seedCycling"],
    });
    expect(errors(checkPlanAppParity(p, app))).toEqual([]);
  });

  it("downgrades a hideable mind-body technique to a warning, not an error", () => {
    // the coach can set mindbody_sleep: locked, which legitimately hides it
    const p = { supplement_protocol: [], lifestyle_practices: [{ name: "Warm evening wind-down" }] };
    const found = checkPlanAppParity(p, payload({ supplements: [], allSupplements: [] }));
    expect(codes(found)).toContain("practice-missing-drippable");
    expect(errors(found)).toEqual([]);
  });
});

describe("PRESENCE — the menu the client eats is the menu the plan wrote", () => {
  const dish = "Moong dal chilla (2) + mint chutney (2 tbsp)";
  const plan = {
    supplement_protocol: [],
    app_menu: { weeks: [{ week: 1, days: [{ slots: [{ slot: "Breakfast", dish }] }] }] },
  };
  const menuPayload = (slots: unknown[]) =>
    payload({
      supplements: [],
      allSupplements: [],
      weekMenus: [{ week: 1, current: true, days: [{ dow: "Mon", slots }] }] as unknown as ParityAppData["weekMenus"],
    });

  it("passes on a faithful render", () => {
    const app = menuPayload([
      { slot: "Breakfast", dish, components: [{ title: "Moong dal chilla" }, { title: "mint chutney" }] },
    ]);
    expect(errors(checkPlanAppParity(plan, app))).toEqual([]);
  });

  it("flags a slot the client's menu never shows", () => {
    expect(codes(checkPlanAppParity(plan, menuPayload([])))).toContain("menu-slot-missing");
  });

  it("flags a dish that changed on the way to the phone", () => {
    const app = menuPayload([
      { slot: "Breakfast", dish: "Poha (1 bowl)", components: [{ title: "Poha" }] },
    ]);
    expect(codes(checkPlanAppParity(plan, app))).toContain("menu-dish-altered");
  });

  it("flags a component naming food the dish never had", () => {
    // the cross-contamination family: tokens from one component pulling in a
    // food from somewhere else entirely
    const app = menuPayload([
      { slot: "Breakfast", dish, components: [{ title: "Moong dal chilla" }, { title: "amla water" }] },
    ]);
    expect(codes(checkPlanAppParity(plan, app))).toContain("menu-component-foreign");
  });

  it("does NOT flag a component whose portion was lifted out of its middle", () => {
    // "lime juice (1 tsp) pre-meal shot" renders as "lime juice pre-meal shot":
    // correct, and not a contiguous substring of the dish
    const p = {
      supplement_protocol: [],
      app_menu: {
        weeks: [
          {
            week: 1,
            days: [{ slots: [{ slot: "Lunch", dish: "Garlic (1 clove) + lime juice (1 tsp) pre-meal shot (small cup)" }] }],
          },
        ],
      },
    };
    const app = menuPayload([
      {
        slot: "Lunch",
        dish: "Garlic (1 clove) + lime juice (1 tsp) pre-meal shot (small cup)",
        components: [{ title: "Garlic", portion: "1 clove" }, { title: "lime juice pre-meal shot" }],
      },
    ]);
    expect(errors(checkPlanAppParity(p, app))).toEqual([]);
  });

  it("ignores bedtime menu rows, which the builder drops on purpose", () => {
    const p = {
      supplement_protocol: [],
      app_menu: { weeks: [{ week: 1, days: [{ slots: [{ slot: "Bedtime", dish: "Golden milk (1 cup)" }] }] }] },
    };
    expect(errors(checkPlanAppParity(p, menuPayload([])))).toEqual([]);
  });
});

// ── PLACEMENT ──────────────────────────────────────────────────────────────

describe("PLACEMENT — ground truth is the curated table, not the parser", () => {
  it("reads 'before bed' as Bedtime — the phrase that shipped in Morning", () => {
    expect(expectedSlotFor("Before Bed")).toBe("Bedtime");
  });

  it("goes red when a bedtime supplement renders in the Morning group", () => {
    const plan = {
      supplement_protocol: [
        { supplement_slug: "magnesium", display_name: "Magnesium glycinate", timing: "Before Bed", start_week: 1 },
      ],
    };
    const wrong = supp({ slot: "Morning" });
    const found = checkPlanAppParity(plan, payload({ supplements: [wrong], allSupplements: [wrong] }));
    const f = found.find((x) => x.code === "slot-mismatch");
    expect(f).toBeTruthy();
    expect(f?.expected).toBe("Bedtime");
    expect(f?.actual).toBe("Morning");
  });

  it("reports an unrecognised phrase as unclassified instead of guessing", () => {
    const plan = {
      supplement_protocol: [
        { supplement_slug: "magnesium", display_name: "Magnesium glycinate", timing: "away from tea/coffee", start_week: 1 },
      ],
    };
    const found = checkPlanAppParity(plan, payload());
    expect(codes(found)).toContain("timing-unclassified");
    expect(errors(found)).toEqual([]);
  });

  it("refuses to classify a phrase naming two times of day", () => {
    expect(expectedSlotFor("Morning on empty stomach and at bedtime")).toBeNull();
    expect(expectedSlotFor("Evening, with dinner or at bedtime")).toBeNull();
    expect(expectedSlotFor("With breakfast and dinner")).toBeNull();
  });

  it("reads through appended detail, but not when the detail moves the time", () => {
    expect(expectedSlotFor("Bedtime, with a full glass of water")).toBe("Bedtime");
    expect(expectedSlotFor("With lunch (largest carb meal)")).toBe("With meals");
    expect(expectedSlotFor("With breakfast (fat-soluble — requires food)")).toBe("Morning");
    // "with food" alone would read as With meals; the coach said morning, so
    // there is no single safe answer and we decline
    expect(expectedSlotFor("with food (morning)")).toBeNull();
  });

  it("MUTATION GUARD: production's timing→slot pipeline agrees with the table", () => {
    // The payload slot is produced exactly as loadClientAppData produces it;
    // the expectation comes from the hand-written table. Break the parser
    // (e.g. drop \bbed\b from BEDTIME_CUE) and this goes red — which is what
    // proves the table is not derived from the parser.
    const bad: string[] = [];
    for (const [phrase, expected] of Object.entries(CURATED_TIMING_SLOT)) {
      const emptyStomach = /empty stomach|before breakfast|on waking/.test(phrase);
      const actual = slotFromRank(timingRank(phrase, "", emptyStomach, false));
      if (actual !== expected) bad.push(`${phrase}: expected ${expected}, app renders ${actual}`);
    }
    expect(bad).toEqual([]);
  });
});

// ── TARGET ─────────────────────────────────────────────────────────────────

describe("TARGET — a buy link must plausibly BE the item", () => {
  const linkPlan = {
    supplement_protocol: [{ supplement_slug: "fenugreek", display_name: "Methi (fenugreek)", timing: "with lunch", start_week: 1 }],
  };
  const linked = (name: string, url = "https://example.test/p") =>
    payload({
      supplements: [supp({ id: "s-fenugreek", name, slot: "With meals", buyUrl: url })],
      allSupplements: [supp({ id: "s-fenugreek", name, slot: "With meals", buyUrl: url })],
    });

  it("goes red on the methi → selenium incident", () => {
    const found = checkPlanAppParity(linkPlan, linked("Methi (fenugreek)"), {
      productNameForUrl: () => "LifelineDiag Selenium Point, L-seleno Methionine, Liquid",
    });
    const f = found.find((x) => x.code === "buy-link-mismatch");
    expect(f).toBeTruthy();
    expect(f?.item).toBe("Methi (fenugreek)");
  });

  it("accepts the right bottle under its trade name", () => {
    const found = checkPlanAppParity(linkPlan, linked("Methi (fenugreek)"), {
      productNameForUrl: () => "Organic Fenugreek Seed Powder",
    });
    expect(errors(found)).toEqual([]);
  });

  it("accepts label spellings of the same substance", () => {
    expect(namesShareIdentity("B12", "Methyl B-12 1000 mcg (Jarrow) — iHerb")).toBe(true);
    expect(namesShareIdentity("Probiotics", "VitaSpore Probiotic")).toBe(true);
    expect(namesShareIdentity("Vitamin D3", "Cholecalciferol 60K")).toBe(true);
    expect(namesShareIdentity("Omega-3 (EPA + DHA)", "Ultra Fish Oil 500")).toBe(true);
  });

  it("still rejects different substances that look alike", () => {
    expect(namesShareIdentity("methi", "L-seleno Methionine")).toBe(false);
    expect(namesShareIdentity("Iron", "Zinc Picolinate")).toBe(false);
    expect(namesShareIdentity("Ashwagandha", "Shatavari Churna")).toBe(false);
  });

  it("skips a link the catalogue does not own (coach override / search)", () => {
    const found = checkPlanAppParity(linkPlan, linked("Methi (fenugreek)"), {
      productNameForUrl: () => null,
    });
    expect(errors(found)).toEqual([]);
  });

  it("drops retail noise but keeps identity words", () => {
    expect(identityTokens("Now Foods Magnesium Glycinate 180 Veg Capsules")).toEqual([
      "magnesium",
      "glycinate",
    ]);
  });
});
