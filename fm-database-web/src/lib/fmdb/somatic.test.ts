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

import { deriveSomatic, excludeSomaticLinked, loadSomaticPractice, MOTION_SHAPES } from "./somatic";

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
    expect(out).not.toBeNull();
    expect(out!.slug).toBe("gastrocolic-rhythm");
    expect(out!.steps.length).toBeGreaterThan(0);
    expect(MOTION_SHAPES).toContain(out!.shape);
  });

  it("returns null when no practice carries a slug", () => {
    const raw: Dict[] = [{ name: "4-7-8 breathing", details: "morning and night" }];
    expect(deriveSomatic(P(raw), raw)).toBeNull();
  });

  it("returns null rather than a degraded card for an unresolvable slug", () => {
    const raw: Dict[] = [{ name: "x", somatic_practice: "definitely-not-a-practice" }];
    expect(deriveSomatic(P(raw), raw)).toBeNull();
  });

  it("carries every step cue through — the cues ARE the practice", () => {
    const raw: Dict[] = [{ name: "x", somatic_practice: "gastrocolic-rhythm" }];
    const out = deriveSomatic(P(raw), raw)!;
    const rec = loadSomaticPractice("gastrocolic-rhythm")!;
    expect(out.steps.length).toBe((rec.steps as unknown[]).length);
    for (const s of out.steps) expect(s.cue.length).toBeGreaterThan(0);
  });

  it("prefers the plain summary over the clinical why_it_works", () => {
    const raw: Dict[] = [{ name: "x", somatic_practice: "gastrocolic-rhythm" }];
    const out = deriveSomatic(P(raw), raw)!;
    const rec = loadSomaticPractice("gastrocolic-rhythm")!;
    if (typeof rec.summary === "string" && rec.summary.trim()) {
      expect(out.why).toBe(rec.summary);
    }
  });

  it("picks the first slug-linked practice and ignores unlinked ones", () => {
    const raw: Dict[] = [
      { name: "4-7-8 breathing" },
      { name: "belly rhythm", somatic_practice: "gastrocolic-rhythm" },
    ];
    const out = deriveSomatic(P(raw), raw)!;
    expect(out.slug).toBe("gastrocolic-rhythm");
    expect(out.practiceId).toBe("p1");
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
    const somatic = deriveSomatic(P(raw), raw)!;
    const { practices, raw: kept } = excludeSomaticLinked(P(raw), raw, somatic);
    expect(kept).toHaveLength(2);
    expect(kept.some((p) => p.somatic_practice === "gastrocolic-rhythm")).toBe(false);
    expect(practices).toHaveLength(2);
  });

  it("keeps the two arrays positionally aligned — the easy bug", () => {
    const somatic = deriveSomatic(P(raw), raw)!;
    const { practices, raw: kept } = excludeSomaticLinked(P(raw), raw, somatic);
    // p0 pairs with the breathing record, p2 with the EFT record
    expect(practices.map((p) => p.id)).toEqual(["p0", "p2"]);
    expect(kept.map((r) => r.name)).toEqual(["4-7-8 breathing", "EFT tapping"]);
  });

  it("is a no-op when nothing is slug-linked", () => {
    const plain: Dict[] = [{ name: "4-7-8 breathing" }];
    const { practices, raw: kept } = excludeSomaticLinked(P(plain), plain, null);
    expect(kept).toHaveLength(1);
    expect(practices).toHaveLength(1);
  });

  it("leaves the breathing practice available to deriveBreathwork", () => {
    const somatic = deriveSomatic(P(raw), raw)!;
    const { raw: kept } = excludeSomaticLinked(P(raw), raw, somatic);
    // the real 4-7-8 prescription must survive — we only remove the linked one
    expect(kept.some((r) => String(r.name).includes("4-7-8"))).toBe(true);
  });
});
