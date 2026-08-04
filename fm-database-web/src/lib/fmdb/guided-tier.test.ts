import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  nextMondayYmd,
  guidedWeek,
  createGuidedSubscriber,
  resolveGuidedSubscriberByToken,
  findGuidedByPaymentId,
  markGuidedUpgraded,
} from "./guided-tier";
import { GUIDED_PROTOCOLS, getGuidedProtocol, phaseForWeek, alsoActivePhases } from "./guided-protocols";
import { buildGuidedAppData } from "./guided-app";

const IST = "Asia/Kolkata";

describe("nextMondayYmd", () => {
  it("a Monday purchase starts the same day", () => {
    // 2026-08-03 is a Monday. 09:00 IST = 03:30 UTC.
    expect(nextMondayYmd(new Date("2026-08-03T03:30:00Z"), IST)).toBe("2026-08-03");
  });
  it("a Tuesday purchase starts the following Monday", () => {
    expect(nextMondayYmd(new Date("2026-08-04T03:30:00Z"), IST)).toBe("2026-08-10");
  });
  it("a Sunday-night IST purchase starts the very next day", () => {
    // Sunday 2026-08-09 23:00 IST = 17:30 UTC (still Sunday UTC too).
    expect(nextMondayYmd(new Date("2026-08-09T17:30:00Z"), IST)).toBe("2026-08-10");
  });
  it("tz matters: late Sunday IST is already Monday-adjacent while UTC says Sunday", () => {
    // 2026-08-09 20:30 UTC = Monday 02:00 IST → starts that same Monday.
    expect(nextMondayYmd(new Date("2026-08-09T20:30:00Z"), IST)).toBe("2026-08-10");
  });
});

describe("guidedWeek", () => {
  it("is 0 before the start date", () => {
    expect(guidedWeek("2026-08-10", "2026-08-08")).toBe(0);
  });
  it("is 1 on the start day and through day 6", () => {
    expect(guidedWeek("2026-08-10", "2026-08-10")).toBe(1);
    expect(guidedWeek("2026-08-10", "2026-08-16")).toBe(1);
  });
  it("rolls to 2 exactly on day 7", () => {
    expect(guidedWeek("2026-08-10", "2026-08-17")).toBe(2);
  });
  it("handles garbage without throwing", () => {
    expect(guidedWeek("", "2026-08-17")).toBe(0);
  });
});

describe("phaseForWeek — 5R's overlapping phases", () => {
  const gut = getGuidedProtocol("gut-reset")!;
  it("week 1 headlines Remove, not Replace (tie on startWeek keeps the earlier)", () => {
    expect(phaseForWeek(gut, 1).phase.name).toBe("Remove");
  });
  it("week 3 headlines Reinoculate (newest-begun wins) with Replace still in flight", () => {
    const { phase, idx } = phaseForWeek(gut, 3);
    expect(phase.name).toBe("Reinoculate");
    expect(alsoActivePhases(gut, 3, idx)).toContain("Replace");
  });
  it("week 5 headlines Repair; week 9 headlines Rebalance", () => {
    expect(phaseForWeek(gut, 5).phase.name).toBe("Repair");
    expect(phaseForWeek(gut, 9).phase.name).toBe("Rebalance");
  });
  it("past the end clamps to the final phase (+ ongoing semantics)", () => {
    expect(phaseForWeek(gut, 40).phase.name).toBe("Rebalance");
  });
});

describe("guided protocol content — public-surface rules", () => {
  it("ships exactly the four v1 protocols with real structures", () => {
    const bySlug = Object.fromEntries(GUIDED_PROTOCOLS.map((p) => [p.slug, p]));
    expect(bySlug["gut-reset"].weeks).toBe(12);
    expect(bySlug["gut-reset"].phases.length).toBe(5);
    expect(bySlug["blood-sugar-balance"].weeks).toBe(10);
    expect(bySlug["blood-sugar-balance"].phases.length).toBe(3);
    expect(bySlug["energy-stress-recovery"].weeks).toBe(12);
    expect(bySlug["anti-inflammatory-reset"].weeks).toBe(10);
  });
  it("carries NO doses anywhere in actions (mg/mcg/IU are the tell)", () => {
    for (const p of GUIDED_PROTOCOLS)
      for (const ph of p.phases)
        for (const a of ph.actions) expect(a).not.toMatch(/\d\s*(mg|mcg|iu)\b/i);
  });
  it("never uses treat/cure/reverse language in public copy", () => {
    const text = JSON.stringify(GUIDED_PROTOCOLS).toLowerCase();
    for (const banned of ["cure", "reverse your", "treats ", "treatment for"])
      expect(text).not.toContain(banned);
  });
  it("every protocol screens for pregnancy and eating-disorder history as hard stops", () => {
    for (const p of GUIDED_PROTOCOLS) {
      expect(p.screening.some((q) => /pregnant/i.test(q.q) && q.hard)).toBe(true);
      expect(p.screening.some((q) => /eating disorder/i.test(q.q) && q.hard)).toBe(true);
      expect(p.screening.some((q) => /allerg/i.test(q.q))).toBe(true);
    }
  });
});

describe("guided store — create / resolve / idempotency", () => {
  let tmp: string;
  const OLD = process.env.FMDB_PLANS_DIR;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "guided-test-"));
    process.env.FMDB_PLANS_DIR = tmp;
  });
  afterEach(async () => {
    process.env.FMDB_PLANS_DIR = OLD;
    await fs.rm(tmp, { recursive: true, force: true });
  });

  const input = {
    display_name: "Meera Test",
    email: "Meera@Example.com",
    phone: "+919999999999",
    protocol_slug: "gut-reset",
    dietary_preference: "jain" as const,
    payment_id: "pay_TEST123",
    amount_paisa: 699900,
    source: "web" as const,
  };

  it("creates once, then returns the same subscriber for the same payment", async () => {
    const a = await createGuidedSubscriber(input, new Date("2026-08-04T03:30:00Z"));
    expect(a.created).toBe(true);
    expect(a.subscriber.start_date).toBe("2026-08-10"); // Tuesday → next Monday
    expect(a.subscriber.email).toBe("meera@example.com"); // lowercased
    const b = await createGuidedSubscriber(input);
    expect(b.created).toBe(false);
    expect(b.subscriber.subscriber_id).toBe(a.subscriber.subscriber_id);
    expect(b.subscriber.app_token).toBe(a.subscriber.app_token);
  });

  it("resolves by token, rejects short tokens, finds by payment id", async () => {
    const { subscriber } = await createGuidedSubscriber(input);
    const hit = await resolveGuidedSubscriberByToken(subscriber.app_token);
    expect(hit?.subscriber_id).toBe(subscriber.subscriber_id);
    expect(hit?.dietary_preference).toBe("jain");
    expect(await resolveGuidedSubscriberByToken("short")).toBeNull();
    expect((await findGuidedByPaymentId("pay_TEST123"))?.subscriber_id).toBe(subscriber.subscriber_id);
  });
});

describe("buildGuidedAppData", () => {
  const base = {
    subscriber_id: "gd-test000001",
    display_name: "Meera Test",
    email: "meera@example.com",
    phone: "",
    app_token: "a".repeat(32),
    protocol_slug: "gut-reset",
    dietary_preference: "jain" as const,
    extra_protocols: [],
    start_date: "2026-08-10",
    payment_id: "pay_X",
    amount_paisa: 699900,
    source: "web" as const,
    status: "active" as const,
    timezone: IST,
    purchased_at: "2026-08-04T03:30:00.000Z",
    created_at: "2026-08-04T03:30:00.000Z",
    updated_at: "2026-08-04T03:30:00.000Z",
    version: 1,
  };

  it("week 1: guided tier, Remove headline, practices gated, no coach surfaces", async () => {
    const d = (await buildGuidedAppData(base, IST, new Date("2026-08-12T04:00:00Z")))!; // Wed of week 1
    expect(d.tier).toBe("guided");
    expect(d.client.week).toBe(1);
    expect(d.client.totalWeeks).toBe(12);
    expect(d.guidedWeekly?.title).toMatch(/^Remove/);
    expect(d.guidedWeekly?.alsoActive).toContain("Replace");
    expect(d.guidedWeekly?.standardNote).toMatch(/standard programme/);
    // Week 1 of gut-reset: only the first practice is open (others start wk 3/5).
    expect(d.practices.length).toBe(1); // the DAILY list stays gated by week
    expect(d.practicesComingLater).toBe(2);
    // …but the playable library rides along from day one (exemplar, issue 14)
    expect(d.somatic.length).toBeGreaterThanOrEqual(8);
    // The ₹85k boundary: no WhatsApp, no supplements, no labs, no menus.
    expect(d.coach.whatsappNumber).toBe("");
    expect(d.supplements.length).toBe(0);
    expect(d.labVault).toBeNull();
    // the sample menu now fills the food layer (exemplar, issue 13)
    expect(d.weekMenus.length).toBe(1);
    expect(d.menuIsSample).toBe(true);
    // Ribbon carries the REAL five phases.
    expect(d.planRef.phase.list.map((p) => p.name)).toEqual([
      "Remove",
      "Replace",
      "Reinoculate",
      "Repair",
      "Rebalance",
    ]);
    // Diet chip + allergy override present.
    expect(d.planRef.flags[0]?.label).toBe("Jain");
    expect(d.planRef.avoidWhy).toMatch(/allergic or intolerant/);
  });

  it("before the start date it renders week zero, not week 1 actions", async () => {
    const d = (await buildGuidedAppData(base, IST, new Date("2026-08-08T04:00:00Z")))!;
    expect(d.client.notStarted).toBe(true);
    expect(d.guidedWeekly?.title).toMatch(/^Week zero/);
    expect(d.guidedWeekly?.alsoActive).toEqual([]);
  });

  it("week 6 opens all three practices; week 40 clamps to the final phase", async () => {
    const wk6 = (await buildGuidedAppData(base, IST, new Date("2026-09-16T04:00:00Z")))!;
    expect(wk6.client.week).toBe(6);
    expect(wk6.practices.length).toBe(3);
    const late = (await buildGuidedAppData(base, IST, new Date("2027-06-01T04:00:00Z")))!;
    expect(late.client.week).toBe(12); // clamped
    expect(late.guidedWeekly?.title).toMatch(/^Rebalance/);
  });

  it("returns null for an unknown protocol", async () => {
    expect(await buildGuidedAppData({ ...base, protocol_slug: "nope" }, IST)).toBeNull();
  });
});

describe("gut-reset exemplar — menus, library, about", () => {
  const IST2 = "Asia/Kolkata";
  const base2 = {
    subscriber_id: "gd-test000002",
    display_name: "Meera Test",
    email: "m@example.com",
    phone: "",
    app_token: "b".repeat(32),
    protocol_slug: "gut-reset",
    dietary_preference: "" as const,
    extra_protocols: [],
    start_date: "2026-08-03",
    payment_id: "pay_Y",
    amount_paisa: 699900,
    source: "web" as const,
    status: "active" as const,
    timezone: IST2,
    purchased_at: "2026-08-03T03:30:00.000Z",
    created_at: "2026-08-03T03:30:00.000Z",
    updated_at: "2026-08-03T03:30:00.000Z",
    version: 1,
  };

  it("every sample-week dish is an EXACT catalogue recipe (no AI-authored food)", async () => {
    const { loadLibraryRecipes } = await import("./client-app");
    const lib = await loadLibraryRecipes();
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
    // A dish can be written under a recipe's alias, not just its title —
    // guided-app.ts's own resolver accepts both (see byTitle there), so this
    // check has to mirror that or it flags an alias-written dish as missing
    // when it actually resolves fine.
    const titles = new Set(lib.flatMap((l) => [l.recipe.title, ...(l.recipe.aliases ?? [])].map(norm)));
    const gut = getGuidedProtocol("gut-reset")!;
    const missing: string[] = [];
    for (const w of gut.sampleWeeks ?? [])
      for (const d of w.days)
        for (const s of d.slots)
          for (const part of s.dish.split(" + "))
            if (!titles.has(norm(part))) missing.push(`${w.phase}/${d.dow}: ${part}`);
    expect(missing).toEqual([]);
    // one sample week per menu era, 7 days each, 4 slots a day
    expect((gut.sampleWeeks ?? []).map((w) => w.phase)).toEqual(["Remove", "Reinoculate", "Repair", "Rebalance"]);
    for (const w of gut.sampleWeeks ?? []) {
      expect(w.days.length).toBe(7);
      for (const d of w.days) expect(d.slots.length).toBe(4);
    }
  });

  it("week 1 renders the Remove sample menu, today's meals and openable recipes", async () => {
    const d = (await buildGuidedAppData(base2, IST2, new Date("2026-08-05T04:00:00Z")))!; // Wed wk1
    expect(d.menuIsSample).toBe(true);
    expect(d.weekMenus.length).toBe(1);
    expect(d.weekMenus[0].days.length).toBe(7);
    expect(d.meals.length).toBe(4); // Breakfast/Lunch/Evening/Dinner
    // Wednesday of the Remove week
    expect(d.meals[0].pills[0]).toBe("Tofu bhurji with capsicum and tomato");
    // meal overlay has the real method for today's dishes
    expect((d.mealExtra["Lunch"]?.recipe ?? []).length).toBeGreaterThan(0);
    // the pack carries every dish used across the four sample weeks
    expect(d.recipePack.length).toBeGreaterThanOrEqual(35);
  });

  it("repair weeks switch the menu; the practice library is playable and client-voiced", async () => {
    const d = (await buildGuidedAppData(base2, IST2, new Date("2026-09-09T04:00:00Z")))!; // wk 6 → Repair
    expect(d.guidedWeekly?.title).toMatch(/^Repair/);
    expect(d.weekMenus[0].nourishment).toMatch(/lining rebuilds/);
    // library: ≥8 catalogue practices survive the motion-shape gate…
    expect(d.somatic.length).toBeGreaterThanOrEqual(8);
    // …the clinical why is replaced everywhere the library covers a slug
    const bladder = d.somatic.find((s) => /bladder/i.test(s.why));
    expect(bladder).toBeUndefined();
    // about block present with library ids that resolve to somatic entries
    expect(d.guidedAbout?.notice.length).toBeGreaterThan(2);
    for (const id of d.guidedAbout?.practiceLibraryIds ?? [])
      expect(d.somatic.some((s) => s.practiceId === id)).toBe(true);
  });
});

describe("dietary variants — coach review round 1 (3 Aug)", () => {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

  it("every dish AND every override is an exact catalogue recipe", async () => {
    const { loadLibraryRecipes } = await import("./client-app");
    const lib = await loadLibraryRecipes();
    const titles = new Set(lib.flatMap((l) => [l.recipe.title, ...(l.recipe.aliases ?? [])].map(norm)));
    const gut = getGuidedProtocol("gut-reset")!;
    const missing: string[] = [];
    for (const w of gut.sampleWeeks ?? [])
      for (const d of w.days)
        for (const s of d.slots)
          for (const dish of [s.dish, s.nonveg, s.egg, s.jain])
            if (dish)
              for (const part of dish.split(" + "))
                if (!titles.has(norm(part))) missing.push(`${w.phase}/${d.dow}/${s.slot}: ${part}`);
    expect(missing).toEqual([]);
  });

  it("what a Jain member SEES (override or fallback) never contains onion or garlic", async () => {
    const { loadLibraryRecipes } = await import("./client-app");
    const lib = await loadLibraryRecipes();
    const ingByTitle = new Map(
      lib.flatMap((l) => {
        const ing = (l.recipe.ingredients ?? []).join(" ").toLowerCase();
        return [l.recipe.title, ...(l.recipe.aliases ?? [])].map((name) => [norm(name), ing] as const);
      }),
    );
    const gut = getGuidedProtocol("gut-reset")!;
    const violations: string[] = [];
    for (const w of gut.sampleWeeks ?? [])
      for (const d of w.days)
        for (const s of d.slots) {
          for (const part of (s.jain ?? s.dish).split(" + ")) {
            const ing = ingByTitle.get(norm(part)) ?? "";
            if (/\bonion|garlic\b/.test(ing)) violations.push(`${w.phase}/${d.dow}/${s.slot}: ${part}`);
          }
        }
    expect(violations).toEqual([]);
  });

  it("the Remove week carries no rice, no dairy, and no wheat for ANY diet", async () => {
    const { loadLibraryRecipes } = await import("./client-app");
    const lib = await loadLibraryRecipes();
    const ingByTitle = new Map(
      lib.flatMap((l) => {
        const ing = (l.recipe.ingredients ?? []).join(" ").toLowerCase();
        return [l.recipe.title, ...(l.recipe.aliases ?? [])].map((name) => [norm(name), ing] as const);
      }),
    );
    const gut = getGuidedProtocol("gut-reset")!;
    const remove = (gut.sampleWeeks ?? []).find((w) => w.phase === "Remove")!;
    const bad: string[] = [];
    for (const d of remove.days)
      for (const s of d.slots)
        for (const dish of [s.dish, s.nonveg, s.egg, s.jain]) {
          if (!dish) continue;
          const ing = ingByTitle.get(norm(dish)) ?? "";
          // sama/barnyard "rice" is a millet — match rice as its own ingredient word
          if (/\b(basmati|white rice|cooked rice|rice flour|poha|curd|yogurt|paneer|milk\b|wheat|maida|suji)\b/.test(ing) || /\brice\b(?! flour)/.test(ing.replace(/sama rice|barnyard rice/g, "")))
            bad.push(`${d.dow}/${s.slot}: ${dish}`);
        }
    expect(bad).toEqual([]);
  });

  it("no ragi porridge anywhere; at most one porridge per week", () => {
    const gut = getGuidedProtocol("gut-reset")!;
    for (const w of gut.sampleWeeks ?? []) {
      const dishes = w.days.flatMap((d) => d.slots.flatMap((s) => [s.dish, s.nonveg, s.egg, s.jain].filter(Boolean)));
      expect(dishes.some((x) => /ragi porridge/i.test(x!))).toBe(false);
      expect(dishes.filter((x) => /porridge/i.test(x!)).length).toBeLessThanOrEqual(1);
    }
  });

  it("dairy appears only in the Rebalance week", () => {
    const gut = getGuidedProtocol("gut-reset")!;
    const DAIRY = /curd|raita|lassi|yogurt|paneer|buttermilk/i;
    for (const w of gut.sampleWeeks ?? []) {
      const dishes = w.days.flatMap((d) => d.slots.flatMap((s) => [s.dish, s.nonveg, s.egg, s.jain].filter(Boolean)));
      const hasDairy = dishes.some((x) => DAIRY.test(x!));
      expect(hasDairy).toBe(w.phase === "Rebalance");
    }
  });

  it("non-veg subscribers get their variant; Jain get theirs", async () => {
    const mk = (diet: "non_vegetarian" | "jain") => ({
      subscriber_id: "gd-test000003",
      display_name: "T",
      email: "t@example.com",
      phone: "",
      app_token: "c".repeat(32),
      protocol_slug: "gut-reset",
      dietary_preference: diet,
      extra_protocols: [],
      start_date: "2026-08-03",
      payment_id: "pay_Z",
      amount_paisa: 699900,
      source: "web" as const,
      status: "active" as const,
      timezone: "Asia/Kolkata",
      purchased_at: "2026-08-03T03:30:00.000Z",
      created_at: "2026-08-03T03:30:00.000Z",
      updated_at: "2026-08-03T03:30:00.000Z",
      version: 1,
    });
    // Monday of week 1 (Remove): nonveg breakfast override is the egg dish
    const nv = (await buildGuidedAppData(mk("non_vegetarian"), "Asia/Kolkata", new Date("2026-08-03T04:00:00Z")))!;
    expect(nv.meals[0].pills[0]).toBe("Masala scrambled eggs");
    const jn = (await buildGuidedAppData(mk("jain"), "Asia/Kolkata", new Date("2026-08-03T04:00:00Z")))!;
    expect(jn.meals[0].pills[0]).toBe("Foxtail millet pongal");
    const ve = (await buildGuidedAppData({ ...mk("jain"), dietary_preference: "vegetarian_egg" as const }, "Asia/Kolkata", new Date("2026-08-03T04:00:00Z")))!;
    expect(ve.meals[0].pills[0]).toBe("Masala scrambled eggs"); // egg breakfast…
    expect(ve.meals[3].pills[0]).toBe("Masoor dal khichdi"); // …vegetarian dinner
  });
});

describe("all four protocols — generalised menu enforcement", () => {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  const allDishes = (w: NonNullable<ReturnType<typeof getGuidedProtocol>>["sampleWeeks"]) =>
    (w ?? []).flatMap((wk) => wk.days.flatMap((d) => d.slots.flatMap((s) => [s.dish, s.nonveg, s.egg, s.jain].filter((x): x is string => !!x))));

  it("every protocol ships one sample week per headline phase", () => {
    for (const p of GUIDED_PROTOCOLS) {
      expect((p.sampleWeeks ?? []).map((w) => w.phase), p.slug).toEqual(p.phases.map((ph) => ph.name).filter((n, i, a) => a.indexOf(n) === i && (p.slug !== "gut-reset" || n !== "Replace")));
    }
  });

  it("every dish and override across ALL protocols is an exact catalogue recipe", async () => {
    const { loadLibraryRecipes } = await import("./client-app");
    const library = await loadLibraryRecipes();
    const titles = new Set(library.flatMap((l) => [l.recipe.title, ...(l.recipe.aliases ?? [])].map(norm)));
    const missing: string[] = [];
    for (const p of GUIDED_PROTOCOLS)
      for (const w of p.sampleWeeks ?? [])
        for (const d of w.days)
          for (const s of d.slots)
            for (const dish of [s.dish, s.nonveg, s.egg, s.jain])
              if (dish)
                for (const part of dish.split(" + "))
                  if (!titles.has(norm(part))) missing.push(`${p.slug}/${w.phase}/${d.dow}: ${part}`);
    expect(missing).toEqual([]);
  });

  it("what a Jain member sees is onion/garlic-free in EVERY protocol", async () => {
    const { loadLibraryRecipes } = await import("./client-app");
    const ing = new Map(
      (await loadLibraryRecipes()).flatMap((l) => {
        const i = (l.recipe.ingredients ?? []).join(" ").toLowerCase();
        return [l.recipe.title, ...(l.recipe.aliases ?? [])].map((name) => [norm(name), i] as const);
      }),
    );
    const bad: string[] = [];
    for (const p of GUIDED_PROTOCOLS)
      for (const w of p.sampleWeeks ?? [])
        for (const d of w.days)
          for (const s of d.slots)
            for (const part of (s.jain ?? s.dish).split(" + "))
              if (/\bonion|garlic\b/.test(ing.get(norm(part)) ?? "")) bad.push(`${p.slug}/${w.phase}/${d.dow}/${s.slot}: ${part}`);
    expect(bad).toEqual([]);
  });

  it("blood sugar: NO added-sugar ingredients and NO white-rice dishes, any week, any variant", async () => {
    const { loadLibraryRecipes } = await import("./client-app");
    const ing = new Map(
      (await loadLibraryRecipes()).flatMap((l) => {
        const i = (l.recipe.ingredients ?? []).join(" ").toLowerCase();
        return [l.recipe.title, ...(l.recipe.aliases ?? [])].map((name) => [norm(name), i] as const);
      }),
    );
    const bs = getGuidedProtocol("blood-sugar-balance")!;
    const bad: string[] = [];
    for (const cell of allDishes(bs.sampleWeeks)) for (const dish of cell.split(" + ")) {
      const i = ing.get(norm(dish)) ?? "";
      if (/\b(sugar|jaggery|honey|maple)\b/.test(i)) bad.push(`sweet: ${dish}`);
      if (/\b(basmati|white rice)\b/.test(i) || (/\brice\b/.test(i.replace(/sama rice|barnyard rice|rice flour/g, "")) && !/millet/.test(i))) bad.push(`rice: ${dish}`);
    }
    expect(bad).toEqual([]);
  });

  it("anti-inflammatory Remove week: no wheat, no added sugar, any variant", async () => {
    const { loadLibraryRecipes } = await import("./client-app");
    const ing = new Map(
      (await loadLibraryRecipes()).flatMap((l) => {
        const i = (l.recipe.ingredients ?? []).join(" ").toLowerCase();
        return [l.recipe.title, ...(l.recipe.aliases ?? [])].map((name) => [norm(name), i] as const);
      }),
    );
    const ai = getGuidedProtocol("anti-inflammatory-reset")!;
    const remove = (ai.sampleWeeks ?? []).find((w) => w.phase === "Remove")!;
    const bad: string[] = [];
    for (const d of remove.days)
      for (const s of d.slots)
        for (const cell of [s.dish, s.nonveg, s.egg, s.jain]) {
          if (!cell) continue;
          for (const dish of cell.split(" + ")) {
            const i = ing.get(norm(dish)) ?? "";
            if (/\b(wheat|maida|suji|sugar|jaggery|honey)\b/.test(i)) bad.push(`${d.dow}/${s.slot}: ${dish}`);
          }
        }
    expect(bad).toEqual([]);
  });

  it("no ragi porridge and ≤1 porridge/week holds across every protocol", () => {
    for (const p of GUIDED_PROTOCOLS)
      for (const w of p.sampleWeeks ?? []) {
        const dishes = w.days.flatMap((d) => d.slots.flatMap((s) => [s.dish, s.nonveg, s.egg, s.jain].filter(Boolean)));
        expect(dishes.some((x) => /ragi porridge/i.test(x!)), `${p.slug}/${w.phase}`).toBe(false);
        expect(dishes.filter((x) => /porridge/i.test(x!)).length, `${p.slug}/${w.phase}`).toBeLessThanOrEqual(1);
      }
  });

  it("every protocol now carries about + practice library", () => {
    for (const p of GUIDED_PROTOCOLS) {
      expect(p.about?.notice.length, p.slug).toBeGreaterThan(2);
      expect((p.practiceLibrary ?? []).length, p.slug).toBeGreaterThanOrEqual(8);
      expect(p.heroMidday, p.slug).toBeTruthy();
    }
  });
});


describe("menus are complete meals — coach review round 2 (3 Aug)", () => {
  it("no dish repeats within the same day for any diet", () => {
    const bad: string[] = [];
    for (const p of GUIDED_PROTOCOLS)
      for (const w of p.sampleWeeks ?? [])
        for (const d of w.days)
          for (const diet of ["dish", "nonveg", "egg", "jain"] as const) {
            const dayDishes = d.slots.map((s) => (diet === "dish" ? s.dish : (s[diet] ?? s.dish)));
            const seen = new Set<string>();
            for (const cell of dayDishes) {
              if (seen.has(cell)) bad.push(`${p.slug}/${w.phase}/${d.dow} (${diet}): ${cell}`);
              seen.add(cell);
            }
          }
    expect(bad).toEqual([]);
  });

  it("lunch and dinner are complete meals — never a bare side, plain grain or lone salad", () => {
    // one-pots and composed plates pass; sides must be compounded with "+"
    const COMPLETE = /\+|khichdi|kitchari|kichari|pulao|pongal|upma|bowl|biryani|curry|masala|stew|soup|rasam|sambar|dal\b.*\+|misal|kadhi|paniyaram|thayir|poha/i;
    const bad: string[] = [];
    for (const p of GUIDED_PROTOCOLS)
      for (const w of p.sampleWeeks ?? [])
        for (const d of w.days)
          for (const s of d.slots) {
            if (s.slot !== "Lunch" && s.slot !== "Dinner") continue;
            for (const cell of [s.dish, s.nonveg, s.egg, s.jain]) {
              if (!cell) continue;
              const complete = COMPLETE.test(cell) || cell.includes(" + ");
              if (!complete) bad.push(`${p.slug}/${w.phase}/${d.dow}/${s.slot}: ${cell}`);
            }
          }
    expect(bad).toEqual([]);
  });
});

describe("guided → 1:1 upgrade — token adoption at first app share", () => {
  let tmp: string;
  const OLD = process.env.FMDB_PLANS_DIR;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "guided-upgrade-"));
    process.env.FMDB_PLANS_DIR = tmp;
  });
  afterEach(async () => {
    process.env.FMDB_PLANS_DIR = OLD;
    await fs.rm(tmp, { recursive: true, force: true });
  });

  const subInput = {
    display_name: "Meera Upgrade",
    email: "upgrade@example.com",
    phone: "+911111111111",
    protocol_slug: "gut-reset",
    payment_id: "pay_UP1",
    amount_paisa: 699900,
    source: "web" as const,
  };

  async function writeClient(id: string, extra: Record<string, unknown> = {}) {
    const dir = path.join(tmp, "clients", id);
    await fs.mkdir(dir, { recursive: true });
    const yaml = (await import("js-yaml")).default;
    await fs.writeFile(
      path.join(dir, "client.yaml"),
      yaml.dump({ client_id: id, display_name: "Meera Upgrade", email: "upgrade@example.com", ...extra }),
      "utf8",
    );
  }
  async function readClient(id: string): Promise<Record<string, unknown>> {
    const yaml = (await import("js-yaml")).default;
    return yaml.load(await fs.readFile(path.join(tmp, "clients", id, "client.yaml"), "utf8")) as Record<string, unknown>;
  }

  it("adopts the active subscriber's token, records the prior id, and retires the guided record", async () => {
    const { subscriber } = await createGuidedSubscriber(subInput);
    await writeClient("cl-900");
    const { ensureClientAppToken } = await import("../server-actions/app-token");
    const res = await ensureClientAppToken("cl-900");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.token).toBe(subscriber.app_token); // same link keeps working
    const c = await readClient("cl-900");
    expect(c.app_token).toBe(subscriber.app_token);
    expect(c.guided_prior_id).toBe(subscriber.subscriber_id); // tree migration key
    // guided record retired → the guided branch stops resolving it
    const after = await resolveGuidedSubscriberByToken(subscriber.app_token);
    expect(after?.status).toBe("upgraded");
    expect(after?.upgraded_to).toBe("cl-900");
    // idempotent: second call returns the same token, changes nothing
    const again = await ensureClientAppToken("cl-900");
    expect(again.ok && again.token).toBe(subscriber.app_token);
  });

  it("a different email mints a fresh token and touches no guided record", async () => {
    const { subscriber } = await createGuidedSubscriber(subInput);
    await writeClient("cl-901", { email: "someoneelse@example.com" });
    const { ensureClientAppToken } = await import("../server-actions/app-token");
    const res = await ensureClientAppToken("cl-901");
    expect(res.ok && res.token).not.toBe(subscriber.app_token);
    const still = await resolveGuidedSubscriberByToken(subscriber.app_token);
    expect(still?.status).toBe("active");
  });

  it("never clobbers an existing client token, even when a subscriber matches", async () => {
    await createGuidedSubscriber(subInput);
    await writeClient("cl-902", { app_token: "existingtoken1234567890abcd" });
    const { ensureClientAppToken } = await import("../server-actions/app-token");
    const res = await ensureClientAppToken("cl-902");
    expect(res.ok && res.token).toBe("existingtoken1234567890abcd");
  });

  it("an upgraded or refunded subscriber is never adopted twice", async () => {
    const { subscriber } = await createGuidedSubscriber(subInput);
    await markGuidedUpgraded(subscriber.subscriber_id, "cl-old");
    await writeClient("cl-903");
    const { ensureClientAppToken } = await import("../server-actions/app-token");
    const res = await ensureClientAppToken("cl-903");
    expect(res.ok && res.token).not.toBe(subscriber.app_token); // fresh mint
  });
});
