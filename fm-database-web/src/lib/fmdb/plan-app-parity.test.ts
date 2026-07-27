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
  timingStatesNoTime,
  CURATED_TIMING_SLOT,
  TIMING_NO_TIME_STATED,
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

  it("says nothing at all when the coach LOCKED that mind-body technique", () => {
    // cl-019's real shape: client.yaml has mindbody_sleep: locked, so the
    // wind-down is absent BY INSTRUCTION and the warning was a false alarm
    const p = {
      supplement_protocol: [],
      lifestyle_practices: [{ name: "Magnesium-rich foods + warm evening wind-down" }],
    };
    const app = payload({ supplements: [], allSupplements: [] });
    expect(checkPlanAppParity(p, app, { client: { mindbody_sleep: "locked" } })).toEqual([]);
  });

  it("still warns when that technique is NOT locked", () => {
    // the mutation that matters: the lock is what silences it, nothing else.
    // auto/unlocked/absent all leave the client able to see it — so its absence
    // is still something a human must look at.
    const p = {
      supplement_protocol: [],
      lifestyle_practices: [{ name: "Magnesium-rich foods + warm evening wind-down" }],
    };
    const app = payload({ supplements: [], allSupplements: [] });
    for (const client of [{ mindbody_sleep: "unlocked" }, { mindbody_sleep: "auto" }, {}, null])
      expect(codes(checkPlanAppParity(p, app, { client }))).toContain("practice-missing-drippable");
    // and a lock on the OTHER technique must not silence this one
    expect(codes(checkPlanAppParity(p, app, { client: { mindbody_eft: "locked" } }))).toContain(
      "practice-missing-drippable",
    );
  });

  it("keeps a locked EFT practice silent and an unlocked one loud", () => {
    const p = { supplement_protocol: [], lifestyle_practices: [{ name: "EFT tapping, 5 min" }] };
    const app = payload({ supplements: [], allSupplements: [] });
    expect(checkPlanAppParity(p, app, { client: { mindbody_eft: "locked" } })).toEqual([]);
    expect(codes(checkPlanAppParity(p, app, { client: { mindbody_eft: "locked" } }))).not.toContain(
      "practice-missing-drippable",
    );
    expect(codes(checkPlanAppParity(p, app, { client: { mindbody_sleep: "locked" } }))).toContain(
      "practice-missing-drippable",
    );
  });

  it("never lets a lock hide an ordinary practice", () => {
    // locks only excuse the two drip techniques; a walk is not one of them
    const p = { supplement_protocol: [], lifestyle_practices: [{ name: "Post-meal walk" }] };
    const found = checkPlanAppParity(p, payload({ supplements: [], allSupplements: [] }), {
      client: { mindbody_sleep: "locked", mindbody_eft: "locked" },
    });
    expect(codes(found)).toContain("practice-missing");
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
        { supplement_slug: "magnesium", display_name: "Magnesium glycinate", timing: "Between meals", start_week: 1 },
      ],
    };
    const found = checkPlanAppParity(plan, payload());
    expect(codes(found)).toContain("timing-unclassified");
    expect(errors(found)).toEqual([]);
  });

  it("keeps 'between meals' unclassified — mid-morning and mid-afternoon both fit", () => {
    // the one family we refuse on purpose: away-from-food says nothing about
    // WHICH gap in the day, and the app has one group per supplement
    expect(expectedSlotFor("Between Meals")).toBeNull();
    expect(expectedSlotFor("between meals")).toBeNull();
    expect(expectedSlotFor("Between meals, on an empty stomach")).toBeNull();
  });

  it("separates 'no time stated' from 'could not classify'", () => {
    // the coach left the hour open; there is nothing to be right or wrong about,
    // so it is reported apart from a phrase we merely could not read and must
    // not count against placement coverage
    const plan = {
      supplement_protocol: [
        { supplement_slug: "magnesium", display_name: "Magnesium glycinate", timing: "away from tea/coffee", start_week: 1 },
      ],
    };
    const found = checkPlanAppParity(plan, payload());
    expect(codes(found)).toContain("timing-unspecified");
    expect(codes(found)).not.toContain("timing-unclassified");
    expect(errors(found)).toEqual([]);
    expect(timingStatesNoTime("Anytime — preferably post-workout on training days")).toBe(true);
    expect(timingStatesNoTime("")).toBe(true);
    // a real dose time is NOT "no time stated"
    expect(timingStatesNoTime("with lunch")).toBe(false);
    expect(timingStatesNoTime("between meals")).toBe(false);
  });

  it("flags a supplement with no timing at all, without pretending to verify it", () => {
    const plan = {
      supplement_protocol: [{ supplement_slug: "magnesium", display_name: "Magnesium glycinate", start_week: 1 }],
    };
    const found = checkPlanAppParity(plan, payload());
    expect(codes(found)).toEqual(["timing-unspecified"]);
  });

  it("no-time phrases and slot phrases are disjoint sets", () => {
    // a phrase that appears in both tables would make coverage a lie: it would
    // be excluded from the denominator AND asserted on
    for (const phrase of TIMING_NO_TIME_STATED) expect(CURATED_TIMING_SLOT[phrase]).toBeUndefined();
  });

  it("anchors a multi-dose phrase at its EARLIEST dose", () => {
    // the plan's own prescribing contract: a twice-daily item is found where its
    // first dose falls, and the timing text on the row carries the second
    expect(expectedSlotFor("morning and evening")).toBe("Morning");
    expect(expectedSlotFor("Morning on empty stomach and at bedtime")).toBe("Morning");
    expect(expectedSlotFor("With breakfast and dinner")).toBe("Morning");
    expect(expectedSlotFor("With breakfast, lunch, and dinner")).toBe("Morning");
    expect(expectedSlotFor("On empty stomach, 30 minutes before breakfast and dinner")).toBe("Morning");
    expect(expectedSlotFor("With lunch or dinner")).toBe("With meals");
  });

  it("anchors an either/or phrase at the earlier option too", () => {
    // the client may be taking the earlier one, so that is where it must appear
    expect(expectedSlotFor("morning and/or bedtime")).toBe("Morning");
    expect(expectedSlotFor("mid-morning or with breakfast")).toBe("Morning");
    expect(expectedSlotFor("with lunch or dinner")).toBe("With meals");
    // "Evening, with dinner or at bedtime" is NOT an example here: it is in
    // TIMING_AMBIGUOUS_BY_DESIGN (two defensible readings, neither client-visible),
    // so it must refuse rather than anchor. Asserted below so the exception is
    // itself covered and cannot be quietly dropped.
    expect(expectedSlotFor("Evening, with dinner or at bedtime")).toBeNull();
  });

  it("resolves each anchor through the curated table, never by cue-word guessing", () => {
    // proof it is table-driven: every anchor in this phrase is a curated entry,
    // and the answer is exactly the earliest of their curated values
    expect(CURATED_TIMING_SLOT["mid-morning"]).toBe("Morning");
    expect(CURATED_TIMING_SLOT["evening"]).toBe("With meals");
    expect(
      expectedSlotFor("Mid-morning or evening, AWAY from tea/coffee/calcium and any thyroid medicine (4h gap)"),
    ).toBe("Morning");
    // an anchor the table does NOT know blocks the whole phrase rather than
    // being dropped from the earliest-of calculation
    expect(expectedSlotFor("with breakfast or between meals")).toBeNull();
    expect(expectedSlotFor("at bedtime or with the 4 pm snack")).toBeNull();
    // …while a clause that names no time at all is inert detail and cannot
    // change the answer
    expect(expectedSlotFor("at bedtime, always with a full glass of water")).toBe("Bedtime");
  });

  it("reads a meal-anchored dose into the meal group, whichever side of the plate", () => {
    // "with meals" was already curated as With meals; before/after the same meal
    // is the same group — the coach named food, not an hour. Naming BREAKFAST is
    // a time of day and still reads Morning.
    expect(expectedSlotFor("Before food")).toBe("With meals");
    expect(expectedSlotFor("before meals")).toBe("With meals");
    expect(expectedSlotFor("after a meal")).toBe("With meals");
    expect(expectedSlotFor("with or after a meal")).toBe("With meals");
    expect(expectedSlotFor("30 minutes before breakfast")).toBe("Morning");
  });

  it("reads through appended detail, but not when the detail moves the time", () => {
    expect(expectedSlotFor("Bedtime, with a full glass of water")).toBe("Bedtime");
    expect(expectedSlotFor("With lunch (largest carb meal)")).toBe("With meals");
    expect(expectedSlotFor("With breakfast (fat-soluble — requires food)")).toBe("Morning");
    expect(expectedSlotFor("Once daily, with lunch (your largest fat-containing meal)")).toBe("With meals");
    expect(expectedSlotFor("~20 min before meals — chew, do not swallow whole")).toBe("With meals");
    // a bracket qualifies the clause it follows, so it can only ever REFUSE,
    // never redirect: "Bedtime (with or after dinner)" may be one bedtime dose
    // taken after food or a choice between two times, and "with food (morning)"
    // reads as a meal item until you notice the coach said morning. Both stay
    // unverified rather than being decided by us.
    expect(expectedSlotFor("with food (morning)")).toBeNull();
    expect(expectedSlotFor("Bedtime (with or after dinner)")).toBeNull();
  });

  /**
   * What production renders TODAY for curated phrases where it DISAGREES with
   * the table — i.e. the open placement defects the sweep reports as
   * slot-mismatch. Listed so the guard below can still assert exact agreement
   * everywhere else, and so a parser fix cannot pass unnoticed: fix one and this
   * test goes red until its line is deleted.
   */
  const KNOWN_PRODUCTION_DIVERGENCE: Record<string, "Morning" | "With meals" | "Bedtime"> = {
    // meal-anchored, no hour named → the parser pins them to the day's first
    // meal (or its unknown-timing default) instead of the meal group
    // the parser has no clock-time reading at all, so "3 pm" falls to its
    // unknown-timing default (bare "afternoon" it does handle, and agrees)
    // a "morning" anywhere in the prose outranks the stated afternoon dose —
    // here the morning belongs to her levothyroxine, the thing iron must avoid
    "early afternoon - at least 4 hours after your morning thyronorm (iron and levothyroxine block each other). pair with a vitamin-c food (amla, lemon, tomato); keep away from tea/coffee":
      "Morning",
    // a late cue anywhere in the phrase wins, even when an earlier dose-time is
    // named ("evening ... or at bedtime"), and even when the late word belongs
    // to a different supplement ("pair with bedtime magnesium")
    // …unless the prose ALSO says "morning" (about her levothyroxine), which
    // cancels the late pin and files an evening mineral under Morning
  };

  it("MUTATION GUARD: production's timing→slot pipeline agrees with the table", () => {
    // The payload slot is produced exactly as loadClientAppData produces it;
    // the expectation comes from the hand-written table. Break the parser
    // (e.g. drop \bbed\b from BEDTIME_CUE) and this goes red — which is what
    // proves the table is not derived from the parser.
    const bad: string[] = [];
    for (const [phrase, expected] of Object.entries(CURATED_TIMING_SLOT)) {
      const emptyStomach = /empty stomach|before breakfast|on waking/.test(phrase);
      const actual = slotFromRank(timingRank(phrase, "", emptyStomach, false));
      const want = KNOWN_PRODUCTION_DIVERGENCE[phrase] ?? expected;
      if (actual !== want)
        bad.push(
          `${phrase}: table says ${expected}, app was known to render ${want}, app now renders ${actual}`,
        );
    }
    expect(bad).toEqual([]);
  });

  it("MUTATION GUARD: the divergence ledger has no stale entries", () => {
    // every listed defect must (a) be a real curated phrase and (b) really still
    // diverge — a ledger line that agrees with the table is a fixed parser we
    // failed to notice
    for (const [phrase, rendered] of Object.entries(KNOWN_PRODUCTION_DIVERGENCE)) {
      expect(CURATED_TIMING_SLOT[phrase], `${phrase} is not a curated phrase`).toBeTruthy();
      expect(rendered, `${phrase} no longer diverges`).not.toBe(CURATED_TIMING_SLOT[phrase]);
    }
  });

  it("MUTATION GUARD: multi-anchor answers still agree with production", () => {
    // Phrases resolved by earliest-anchor, checked against the real pipeline the
    // same way single phrases are — this is what goes red if the app stops
    // anchoring multi-dose items at their first dose. Third column = what the
    // app renders today where it DIVERGES, same ledger discipline as above.
    for (const [phrase, expected, appRenders] of [
      ["morning and evening", "Morning"],
      ["Morning on empty stomach and at bedtime", "Morning"],
      ["With breakfast and dinner", "Morning"],
      ["With breakfast, lunch, and dinner", "Morning"],
      ["morning and/or bedtime", "Morning"],
      ["mid-morning or with breakfast", "Morning"],
      ["With lunch or dinner", "With meals"],
      ["Mid-morning or evening, AWAY from tea/coffee/calcium and any thyroid medicine (4h gap)", "Morning"],
      // open defect: a late cue wins even when an earlier dose-time is named, so
      // this evening dose is filed at Bedtime and its row still reads "With
      // dinner". Delete the third column when the parser learns to look earlier.
    ] as [string, "Morning" | "With meals" | "Bedtime", ("Morning" | "With meals" | "Bedtime")?][]) {
      expect(expectedSlotFor(phrase), phrase).toBe(expected);
      expect(slotFromRank(timingRank(phrase, "", false, false)), phrase).toBe(appRenders ?? expected);
    }
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
