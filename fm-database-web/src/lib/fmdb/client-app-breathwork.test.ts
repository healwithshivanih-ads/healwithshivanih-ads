/**
 * Tests for deriveBreathwork — the name-matcher that turns a coach-written
 * practice into a paced breathing session with an animated player.
 *
 * CLAUDE.md flags this one as fragile on purpose: it matches on the practice
 * NAME, and at 114 somatic practices the names collide ("gastrocolic-rhythm"
 * contains "breathing"). A false positive here does not degrade gracefully —
 * it replaces the practice the coach prescribed with a generic 4-in/6-out
 * session, silently dropping the thing that IS the practice.
 *
 * The counts it parses are equally load-bearing: they drive a timed animation
 * the client breathes along with, so an off-by-one on "4-7-8" is something they
 * feel rather than something they read.
 */
import { describe, it, expect } from "vitest";
import { deriveBreathwork } from "./client-app";

/** practices[] and practiceRaw[] are positional siblings in the real caller. */
const call = (name: string, details = "", when = "Morning") =>
  deriveBreathwork([{ id: "p1", name, when }], [{ details }]);

describe("deriveBreathwork — what it must NOT catch", () => {
  it("ignores a practice whose name merely contains 'breath'", () => {
    // The gastrocolic-rhythm class of false positive: no count, and the name
    // is not itself a breathing practice.
    expect(call("Gastrocolic rhythm", "Hand pressure on the belly after meals.")).toBeNull();
  });

  it("ignores all-day nasal breathing and mouth taping — not a paced session", () => {
    expect(call("Nasal breathing", "Breathe through your nose all day.")).toBeNull();
    expect(call("Mouth taping", "Light mouth tape at night, nose breathing by day.")).toBeNull();
  });

  it("BUT still honours a taping practice that prescribes an actual count", () => {
    // The exclusion is "no count given", not "the word taping appears".
    const r = call("Mouth taping", "Before bed, do 5 rounds of 4-7-8 breathing, then tape.");
    expect(r).not.toBeNull();
    expect(r!.name).toBe("4-7-8 breathing");
  });

  it("returns null when nothing in the list is breathwork at all", () => {
    expect(call("Abhyanga", "Warm oil self-massage, 20 minutes.")).toBeNull();
  });
});

describe("deriveBreathwork — phase parsing", () => {
  it("reads a 3-count pattern into in / hold / out", () => {
    const r = call("4-7-8 breathing")!;
    expect(r.phases.map((p) => [p.key, p.secs])).toEqual([
      ["in", 4],
      ["hold", 7],
      ["out", 8],
    ]);
  });

  it("routes the 4-7-8 exhale through the MOUTH, as the method specifies", () => {
    expect(call("4-7-8 breathing")!.phases[2].cue).toMatch(/mouth/i);
    // any other ratio exhales through the nose
    expect(call("4-4-6 breathing")!.phases[2].cue).not.toMatch(/mouth/i);
  });

  it("reads a 4-count pattern as a second hold on empty lungs", () => {
    const r = call("4-4-4-4 breathing")!;
    expect(r.phases.map((p) => p.key)).toEqual(["in", "hold", "out", "hold2"]);
    expect(r.phases[3].secs).toBe(4);
  });

  it("recognises box breathing by name", () => {
    const r = call("Box breathing", "Four counts each way.")!;
    expect(r.name).toBe("Box breathing");
    expect(r.phases.map((p) => p.secs)).toEqual([4, 4, 4, 4]);
  });

  it("recognises extended exhale by name", () => {
    const r = call("Extended exhale breathing")!;
    expect(r.phases.map((p) => [p.key, p.secs])).toEqual([
      ["in", 4],
      ["out", 8],
    ]);
  });

  it("falls back to a gentle 4-in / 6-out when no pattern is given", () => {
    const r = call("Breathwork", "Slow breathing before bed.")!;
    expect(r.name).toBe("Slow breathing");
    expect(r.phases.map((p) => p.secs)).toEqual([4, 6]);
  });

  it("accepts an en-dash, which is what a pasted document carries", () => {
    expect(call("4–7–8 breathing")!.phases.map((p) => p.secs)).toEqual([4, 7, 8]);
  });
});

describe("deriveBreathwork — rounds", () => {
  it("takes an explicit round count", () => {
    expect(call("4-7-8 breathing", "Do 8 rounds.")!.rounds).toBe(8);
  });

  it("derives rounds from a duration when no count is given", () => {
    // 2 min over a 19s cycle ≈ 6 rounds
    expect(call("4-7-8 breathing", "Practise for 2 minutes.")!.rounds).toBe(6);
  });

  it("clamps a derived duration into a sane 3-10 band", () => {
    expect(call("4-7-8 breathing", "Practise for 1 minute.")!.rounds).toBeGreaterThanOrEqual(3);
    expect(call("4-7-8 breathing", "Practise for 30 minutes.")!.rounds).toBeLessThanOrEqual(10);
  });

  it("hard-clamps an explicit count to 1-12, so a typo cannot run forever", () => {
    expect(call("4-7-8 breathing", "Do 99 rounds.")!.rounds).toBe(12);
    expect(call("4-7-8 breathing", "Do 0 rounds.")!.rounds).toBe(1);
  });

  it("defaults to 5 rounds when the coach gave neither", () => {
    expect(call("4-7-8 breathing")!.rounds).toBe(5);
  });
});

describe("deriveBreathwork — the client-facing why", () => {
  it("strips a leading coach stamp", () => {
    const r = call("4-7-8 breathing", "[2026-05-24] Calms the nervous system before sleep. It also slows the heart rate a little.")!;
    expect(r.why).not.toMatch(/2026-05-24|\[/);
    expect(r.why).toMatch(/^Calms/);
  });

  it("keeps at most the first two sentences", () => {
    const r = call("4-7-8 breathing", "One sentence here now. Two sentences here now. Three sentences here now.")!;
    expect(r.why).toContain("One sentence");
    expect(r.why).toContain("Two sentences");
    expect(r.why).not.toContain("Three sentences");
  });

  it("substitutes a default when the coach wrote nothing useful", () => {
    expect(call("4-7-8 breathing", "Nightly.")!.why).toMatch(/rest and digest/i);
  });
});

describe("deriveBreathwork — list handling", () => {
  it("scans past non-breathing practices to find the real one", () => {
    const r = deriveBreathwork(
      [
        { id: "a", name: "Abhyanga", when: "Morning" },
        { id: "b", name: "4-7-8 breathing", when: "Bedtime" },
      ],
      [{ details: "Warm oil massage." }, { details: "Before sleep." }],
    )!;
    expect(r.practiceId).toBe("b");
    expect(r.when).toBe("Bedtime");
  });

  it("returns the FIRST match, not the last", () => {
    const r = deriveBreathwork(
      [
        { id: "a", name: "Box breathing", when: "Morning" },
        { id: "b", name: "4-7-8 breathing", when: "Bedtime" },
      ],
      [{ details: "" }, { details: "" }],
    )!;
    expect(r.practiceId).toBe("a");
  });

  it("handles an empty list and a missing details row", () => {
    expect(deriveBreathwork([], [])).toBeNull();
    expect(deriveBreathwork([{ id: "x", name: "4-7-8 breathing", when: "" }], [])).not.toBeNull();
  });
});
