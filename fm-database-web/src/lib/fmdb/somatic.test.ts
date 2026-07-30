/**
 * Tests for slug-resolved somatic practices.
 *
 * The failure this guards against is silent degradation: the app's older
 * mind-body derivations pattern-match the practice NAME, so a
 * gastrocolic-rhythm prescription (which contains the word "breathing") would
 * be caught by deriveBreathwork and rendered as a generic 4-in / 6-out session,
 * dropping the hand pressure that IS the practice. Half-right reaches the
 * client looking correct, which is worse than nothing rendering at all.
 *
 * These read the REAL catalogue, so they also fail if a shipped practice loses
 * its motion_shape or its steps.
 */
import { describe, it, expect } from "vitest";

import {
  deriveMindBodyReads,
  deriveSomatic,
  excludeSomaticLinked,
  loadSomaticPractice,
  MOTION_SHAPES,
  type AppSomatic,
} from "./somatic";

type Dict = Record<string, unknown>;

const P = (raw: Dict[]) =>
  raw.map((_, i) => ({ id: `p${i}`, name: `practice ${i}`, when: "Daily" }));

describe("loadSomaticPractice", () => {
  it("loads a real catalogue practice by slug", () => {
    const rec = loadSomaticPractice("gastrocolic-rhythm");
    expect(rec).not.toBeNull();
    expect(rec?.slug).toBe("gastrocolic-rhythm");
    expect(Array.isArray(rec?.steps)).toBe(true);
  });

  it("returns null for an unknown slug", () => {
    expect(loadSomaticPractice("no-such-practice-anywhere")).toBeNull();
  });

  it("refuses path traversal — the slug reaches the filesystem", () => {
    expect(loadSomaticPractice("../../../etc/passwd")).toBeNull();
    expect(loadSomaticPractice("foo/bar")).toBeNull();
    expect(loadSomaticPractice("Foo")).toBeNull();
  });
});

describe("deriveSomatic", () => {
  it("resolves a prescribed practice from the catalogue", () => {
    const raw: Dict[] = [{ name: "Morning belly rhythm", somatic_practice: "gastrocolic-rhythm" }];
    const out = deriveSomatic(P(raw), raw);
    expect(out).toHaveLength(1);
    expect(out[0].slug).toBe("gastrocolic-rhythm");
    expect(out[0].steps.length).toBeGreaterThan(0);
    expect(MOTION_SHAPES).toContain(out[0].shape);
  });

  it("returns nothing when no practice carries a slug", () => {
    const raw: Dict[] = [{ name: "4-7-8 breathing", details: "morning and night" }];
    expect(deriveSomatic(P(raw), raw)).toEqual([]);
  });

  it("returns nothing rather than a degraded card for an unresolvable slug", () => {
    const raw: Dict[] = [{ name: "x", somatic_practice: "definitely-not-a-practice" }];
    expect(deriveSomatic(P(raw), raw)).toEqual([]);
  });

  it("carries every step cue through — the cues ARE the practice", () => {
    const raw: Dict[] = [{ name: "x", somatic_practice: "gastrocolic-rhythm" }];
    const out = deriveSomatic(P(raw), raw)[0];
    const rec = loadSomaticPractice("gastrocolic-rhythm")!;
    expect(out.steps.length).toBe((rec.steps as unknown[]).length);
    for (const s of out.steps) expect(s.cue.length).toBeGreaterThan(0);
  });

  it("prefers the plain summary over the clinical why_it_works", () => {
    const raw: Dict[] = [{ name: "x", somatic_practice: "gastrocolic-rhythm" }];
    const out = deriveSomatic(P(raw), raw)[0];
    const rec = loadSomaticPractice("gastrocolic-rhythm")!;
    if (typeof rec.summary === "string" && rec.summary.trim()) {
      expect(out.why).toBe(rec.summary);
    }
  });

  it("skips unlinked practices and keeps the linked one's identity", () => {
    const raw: Dict[] = [
      { name: "4-7-8 breathing" },
      { name: "belly rhythm", somatic_practice: "gastrocolic-rhythm" },
    ];
    const out = deriveSomatic(P(raw), raw);
    expect(out).toHaveLength(1);
    expect(out[0].slug).toBe("gastrocolic-rhythm");
    expect(out[0].practiceId).toBe("p1");
    expect(out[0].sourceIndex).toBe(1);
  });

  /* The bug this whole change exists for: a second linked practice used to be
     dropped on the floor — prescribed, listed in the checklist, unopenable. */
  it("returns EVERY linked practice, in plan order", () => {
    const raw: Dict[] = [
      { name: "belly rhythm", somatic_practice: "gastrocolic-rhythm" },
      { name: "4-7-8 breathing" },
      { name: "wall rest", somatic_practice: "legs-up-the-wall" },
    ];
    const out = deriveSomatic(P(raw), raw);
    expect(out.map((s) => s.slug)).toEqual(["gastrocolic-rhythm", "legs-up-the-wall"]);
    expect(out.map((s) => s.practiceId)).toEqual(["p0", "p2"]);
    expect(out.map((s) => s.sourceIndex)).toEqual([0, 2]);
  });

  it("keeps the resolvable ones when a sibling slug is broken", () => {
    const raw: Dict[] = [
      { name: "x", somatic_practice: "definitely-not-a-practice" },
      { name: "wall rest", somatic_practice: "legs-up-the-wall" },
    ];
    const out = deriveSomatic(P(raw), raw);
    expect(out.map((s) => s.slug)).toEqual(["legs-up-the-wall"]);
    expect(out[0].sourceIndex).toBe(1);
  });

  it("carries both when two practices share one slug — morning and night", () => {
    const raw: Dict[] = [
      { name: "morning rest", somatic_practice: "constructive-rest", cadence: "Morning" },
      { name: "night rest", somatic_practice: "constructive-rest", cadence: "Bedtime" },
    ];
    const out = deriveSomatic(P(raw), raw);
    expect(out).toHaveLength(2);
    expect(out.map((s) => s.sourceIndex)).toEqual([0, 1]);
  });
});

describe("catalogue integrity, as seen by the app", () => {
  it("every shipped practice referenced here has a valid shape and renderable steps", () => {
    for (const slug of ["gastrocolic-rhythm", "legs-up-the-wall", "boundary-push", "womb-cradling"]) {
      const rec = loadSomaticPractice(slug);
      expect(rec, `${slug} missing from catalogue`).not.toBeNull();
      expect(MOTION_SHAPES, `${slug} has no valid motion_shape`).toContain(rec!.motion_shape);
      if (rec!.timed !== false) {
        expect((rec!.steps as unknown[]).length, `${slug} is timed but has no steps`).toBeGreaterThan(0);
      }
    }
  });
});

describe("excludeSomaticLinked — the guard against double-catching", () => {
  const raw: Dict[] = [
    { name: "4-7-8 breathing" },
    { name: "Morning belly rhythm", somatic_practice: "gastrocolic-rhythm" },
    { name: "EFT tapping" },
  ];

  it("drops the slug-linked practice so the name-matchers cannot see it", () => {
    const somatic = deriveSomatic(P(raw), raw);
    const { practices, raw: kept } = excludeSomaticLinked(P(raw), raw, somatic);
    expect(kept).toHaveLength(2);
    expect(kept.some((p) => p.somatic_practice === "gastrocolic-rhythm")).toBe(false);
    expect(practices).toHaveLength(2);
  });

  it("keeps the two arrays positionally aligned — the easy bug", () => {
    const somatic = deriveSomatic(P(raw), raw);
    const { practices, raw: kept } = excludeSomaticLinked(P(raw), raw, somatic);
    // p0 pairs with the breathing record, p2 with the EFT record
    expect(practices.map((p) => p.id)).toEqual(["p0", "p2"]);
    expect(kept.map((r) => r.name)).toEqual(["4-7-8 breathing", "EFT tapping"]);
  });

  it("is a no-op when nothing is slug-linked", () => {
    const plain: Dict[] = [{ name: "4-7-8 breathing" }];
    const { practices, raw: kept } = excludeSomaticLinked(P(plain), plain, []);
    expect(kept).toHaveLength(1);
    expect(practices).toHaveLength(1);
  });

  it("leaves the breathing practice available to deriveBreathwork", () => {
    const somatic = deriveSomatic(P(raw), raw);
    const { raw: kept } = excludeSomaticLinked(P(raw), raw, somatic);
    // the real 4-7-8 prescription must survive — we only remove the linked ones
    expect(kept.some((r) => String(r.name).includes("4-7-8"))).toBe(true);
  });

  it("drops ALL linked practices, not just the first", () => {
    const many: Dict[] = [
      { name: "belly rhythm", somatic_practice: "gastrocolic-rhythm" },
      { name: "4-7-8 breathing" },
      { name: "wall rest", somatic_practice: "legs-up-the-wall" },
      { name: "EFT tapping" },
    ];
    const somatic = deriveSomatic(P(many), many);
    expect(somatic).toHaveLength(2);
    const { practices, raw: kept } = excludeSomaticLinked(P(many), many, somatic);
    expect(kept.map((r) => r.name)).toEqual(["4-7-8 breathing", "EFT tapping"]);
    expect(practices.map((p) => p.id)).toEqual(["p1", "p3"]);
  });

  /* Exclusion goes by sourceIndex, not by a slug lookup. With a lookup, two
     practices sharing a slug both resolve to the FIRST index — one of them
     survives into the name-matchers and gets rendered as the wrong thing. */
  it("drops both when two practices share one slug", () => {
    const twice: Dict[] = [
      { name: "morning rest", somatic_practice: "constructive-rest" },
      { name: "4-7-8 breathing" },
      { name: "night rest", somatic_practice: "constructive-rest" },
    ];
    const somatic = deriveSomatic(P(twice), twice);
    expect(somatic).toHaveLength(2);
    const { practices, raw: kept } = excludeSomaticLinked(P(twice), twice, somatic);
    expect(kept.map((r) => r.name)).toEqual(["4-7-8 breathing"]);
    expect(practices.map((p) => p.id)).toEqual(["p1"]);
  });
});

/* ── the client-facing read ───────────────────────────────────────────────
   This is the surface that tells a client their body may be holding
   something. Every one of these tests is about what must NOT reach them. */
describe("deriveMindBodyReads — three gates, all failing closed", () => {
  const CONDS = ["Constipation", "Sleeplessness", "Endometriosis", "Migraine", "Elevated Lp(a)"];

  const prescribed = (): AppSomatic[] => {
    const raw: Dict[] = [{ name: "belly rhythm", somatic_practice: "gastrocolic-rhythm" }];
    return deriveSomatic(P(raw), raw);
  };

  it("shows NOTHING until the coach opens it for this client", () => {
    for (const depth of ["", "   ", "off", "resets_only", "FULLY", "true", "1"]) {
      expect(deriveMindBodyReads(depth, CONDS, prescribed()).reads, `depth ${JSON.stringify(depth)} leaked`).toEqual([]);
    }
  });

  it("opens at full depth, and only for the client-safe conditions", () => {
    const out = deriveMindBodyReads("full", CONDS, prescribed()).reads;
    expect(out.length).toBeGreaterThan(0);
    // endometriosis is coach_only, migraine is gated, Lp(a) has no map at all
    const titles = out.map((r) => r.title.toLowerCase()).join(" | ");
    expect(titles).not.toMatch(/endometrio|migraine/);
  });

  it("accepts the value however the coach's field is cased or padded", () => {
    expect(deriveMindBodyReads("  Full  ", CONDS, prescribed()).reads.length).toBeGreaterThan(0);
  });

  it("never emits a card with no reading in it", () => {
    for (const r of deriveMindBodyReads("full", CONDS, prescribed()).reads) {
      expect(r.reframe.length).toBeGreaterThan(0);
      expect(r.title.length).toBeGreaterThan(0);
    }
  });

  it("carries the emotional roots — the connect is the point, not just the comfort", () => {
    const [r] = deriveMindBodyReads("full", ["Constipation"], prescribed()).reads;
    expect(r.roots.length).toBeGreaterThan(0);
    expect(r.roots.length).toBeLessThanOrEqual(3);
    for (const root of r.roots) {
      expect(root.pattern.length).toBeGreaterThan(0);
      expect(root.note.length).toBeGreaterThan(0);
    }
  });

  it("attaches the practice ONLY when the coach actually prescribed it", () => {
    const withIt = deriveMindBodyReads("full", ["Constipation"], prescribed()).reads;
    expect(withIt[0].practiceSlug).toBe("gastrocolic-rhythm");
    expect(withIt[0].practice?.slug).toBe("gastrocolic-rhythm");

    // Not prescribed — the client can STILL do it. The map already passed the
    // sensitivity gate and the client passed the depth gate; a third gate made
    // the card a tease. `prescribed` now drives the label, not access.
    const without = deriveMindBodyReads("full", ["Constipation"], []).reads;
    expect(without[0].reframe).toBe(withIt[0].reframe);
    expect(without[0].practice).not.toBeNull();
    expect(without[0].practice!.slug).toBe("gastrocolic-rhythm");
    expect(without[0].prescribed).toBe(false);
    expect(withIt[0].prescribed).toBe(true);
    // a read-only run must never masquerade as a prescribed practice in the log
    expect(without[0].practice!.practiceId).toMatch(/^read-/);
  });

  it("titles the card from the map, never from the coach's raw condition text", () => {
    const messy = "Constipation — ON TREATMENT (previously unreported) — lactulose 10ml";
    const [r] = deriveMindBodyReads("full", [messy], []).reads;
    expect(r.title).not.toContain("lactulose");
    expect(r.title).not.toMatch(/previously unreported/i);
  });

  it("is empty for a client whose conditions the book does not cover", () => {
    expect(deriveMindBodyReads("full", ["Elevated Lp(a)", "Raised ApoB"], []).reads).toEqual([]);
  });
});

/* The number that makes the section honest. 57% of matched reads across the
   roster are withheld, and they are the named diagnoses — so what a client
   sees is the symptom-level remainder. Saying nothing about that turns a
   filtered view into a misleading one. */
describe("withheldCount — what the client is not being shown", () => {
  const prescribed = (): AppSomatic[] => {
    const raw: Dict[] = [{ name: "belly rhythm", somatic_practice: "gastrocolic-rhythm" }];
    return deriveSomatic(P(raw), raw);
  };

  it("counts a sensitive diagnosis that matched but cannot be shown", () => {
    const out = deriveMindBodyReads("full", ["Hypertension", "Constipation"], prescribed());
    expect(out.reads.map((r) => r.title.toLowerCase()).join(" ")).toContain("constipation");
    expect(out.reads.some((r) => /blood pressure|hypertension/i.test(r.title))).toBe(false);
    expect(out.withheldCount).toBeGreaterThan(0);
  });

  it("counts coach-only entries too", () => {
    const out = deriveMindBodyReads("full", ["Endometriosis", "Fibroids"], []);
    expect(out.reads).toEqual([]);
    expect(out.withheldCount).toBe(2);
  });

  it("is zero when nothing was held back", () => {
    expect(deriveMindBodyReads("full", ["Constipation"], []).withheldCount).toBe(0);
  });

  it("is zero — not a leak — when the gate is shut entirely", () => {
    const out = deriveMindBodyReads("off", ["Hypertension", "Endometriosis"], []);
    expect(out.reads).toEqual([]);
    expect(out.withheldCount).toBe(0);
  });
});

/* The coach's gate, not the book's. Read literally, the source hid every named
   diagnosis and left only sleep/knees/digestion — so `deep` opens the chronic
   ones as food for thought, while the twelve coach_only entries (recurrent
   pregnancy loss, infertility, pelvic-floor/sexual trauma) still need naming
   one at a time, for one person. */
describe("depth levels and per-client sharing", () => {
  const CONDS = ["Hypertension", "Constipation", "Endometriosis"];

  it("full keeps the cautious setting — general only", () => {
    const out = deriveMindBodyReads("full", CONDS, []);
    expect(out.reads.map((r) => r.title.toLowerCase()).join(" ")).toContain("constipation");
    expect(out.reads.some((r) => /blood pressure|hypertension/i.test(r.title))).toBe(false);
    expect(out.withheldCount).toBe(2);
  });

  it("deep adds the chronic diagnoses the client actually wants understood", () => {
    const out = deriveMindBodyReads("deep", CONDS, []);
    expect(out.reads.some((r) => /blood pressure|hypertension/i.test(r.title))).toBe(true);
    expect(out.reads.some((r) => /constipation/i.test(r.title))).toBe(true);
  });

  it("deep still does NOT open coach_only — that is not the same caution", () => {
    const out = deriveMindBodyReads("deep", CONDS, []);
    expect(out.reads.some((r) => /endometrio/i.test(r.title))).toBe(false);
    expect(out.withheldCount).toBe(1);
  });

  it("no depth level whatsoever opens the trauma entries", () => {
    const heavy = ["Recurrent miscarriage", "Endometriosis", "Fibroids"];
    for (const lvl of ["full", "deep", "DEEP", "  deep  "]) {
      const out = deriveMindBodyReads(lvl, heavy, []);
      expect(out.reads, `depth ${lvl} leaked a coach-only entry`).toEqual([]);
    }
  });

  it("a coach_only entry opens only when named for that client", () => {
    const shut = deriveMindBodyReads("full", ["Endometriosis"], []);
    expect(shut.reads).toEqual([]);

    const named = deriveMindBodyReads("full", ["Endometriosis"], [], ["somatic-map-endometriosis"]);
    expect(named.reads).toHaveLength(1);
    expect(named.reads[0].title.toLowerCase()).toContain("endometrio");
    expect(named.withheldCount).toBe(0);
  });

  it("sharing is by exact map slug — a near miss opens nothing", () => {
    const out = deriveMindBodyReads("full", ["Endometriosis"], [], ["endometriosis", "somatic-map-endo"]);
    expect(out.reads).toEqual([]);
  });

  it("sharing cannot revive a client who was never opened up at all", () => {
    const out = deriveMindBodyReads("off", ["Endometriosis"], [], ["somatic-map-endometriosis"]);
    expect(out.reads).toEqual([]);
    expect(out.withheldCount).toBe(0);
  });

  it("an unknown depth string is treated as shut, not as deep", () => {
    for (const lvl of ["", "  ", "true", "1", "all", "deeper", "full_plus"]) {
      expect(deriveMindBodyReads(lvl, CONDS, []).reads, lvl).toEqual([]);
    }
  });
});
