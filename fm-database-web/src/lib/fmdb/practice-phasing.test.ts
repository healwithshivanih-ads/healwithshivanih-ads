/**
 * Phasing decides what a client can see. Two failure modes matter more than
 * the arithmetic, and both are silent:
 *
 *   - a gate that never opens, stranding a quiet client on phase 1 forever
 *   - a gate that goes BACKWARDS, taking away a practice the client already
 *     has, which reads as the app breaking or as a punishment
 *
 * So the monotonicity and the never-stalls properties are asserted directly,
 * by sweeping the whole plan rather than spot-checking weeks.
 */
import { describe, expect, it } from "vitest";

import { classifyPractice } from "./practice-load";
import {
  gatePhases,
  maxPhaseOf,
  normalisePhase,
  phaseOpensAtWeek,
  seedPhases,
  splitByPhase,
  stateAtDueFrom,
  type PhaseGateInput,
  type PollScore,
} from "./practice-phasing";

const base: PhaseGateInput = {
  week: 1,
  totalWeeks: 12,
  maxPhase: 3,
  stateAtDue: () => null,
};

describe("the release schedule", () => {
  it("opens phase 1 in week 1, always", () => {
    expect(phaseOpensAtWeek(1, 12)).toBe(1);
    expect(phaseOpensAtWeek(0, 12)).toBe(1);
    expect(phaseOpensAtWeek(Number.NaN, 12)).toBe(1);
  });

  it("spaces phases three weeks apart on a standard 12-week plan", () => {
    expect([2, 3, 4].map((p) => phaseOpensAtWeek(p, 12))).toEqual([4, 7, 10]);
  });

  it("tightens to two weeks on a short plan, so the last layer still lands", () => {
    // A 6-week reset must not still be handing out new work in week 7.
    expect([2, 3].map((p) => phaseOpensAtWeek(p, 6))).toEqual([3, 5]);
  });

  it("has every phase open before the plan ends", () => {
    for (const totalWeeks of [6, 8, 12, 16]) {
      for (const maxPhase of [2, 3, 4]) {
        const last = gatePhases({ ...base, week: totalWeeks, totalWeeks, maxPhase });
        expect(
          last.openPhase,
          `phase ${maxPhase} never opened on a ${totalWeeks}-week plan`,
        ).toBe(maxPhase);
      }
    }
  });
});

describe("what the client can see never shrinks", () => {
  /* The bug this design exists to rule out. An earlier gate dropped the
     ceiling by one whenever the client was struggling RIGHT NOW, which meant:
     active in week 4 with phase 2 open, silent a fortnight, back in week 6 —
     and phase 2 vanished. Held state is asked about the past for this reason,
     so these sweeps must hold for EVERY history, not just kind ones. */
  const histories: [string, (due: number) => "dormant" | "struggling" | null][] = [
    ["never held", () => null],
    ["always held", () => "dormant"],
    ["held on alternating due weeks", (d) => (d % 2 === 0 ? "dormant" : null)],
    ["held only on the first layer", (d) => (d === 4 ? "struggling" : null)],
    ["held only on the last layer", (d) => (d >= 10 ? "dormant" : null)],
  ];

  it("is monotonic across the whole plan, for every history", () => {
    for (const [label, stateAtDue] of histories) {
      for (const totalWeeks of [6, 8, 12, 16]) {
        let prev = 0;
        for (let week = 1; week <= totalWeeks; week++) {
          const g = gatePhases({ ...base, week, totalWeeks, maxPhase: 4, stateAtDue });
          expect(
            g.openPhase,
            `${label}, ${totalWeeks}wk: week ${week} went backwards`,
          ).toBeGreaterThanOrEqual(prev);
          prev = g.openPhase;
        }
      }
    }
  });

  it("never withholds phase 1, however absent or however badly it is going", () => {
    const g = gatePhases({ ...base, week: 1, stateAtDue: () => "dormant" });
    expect(g.openPhase).toBe(1);
    expect(g.held).toBeNull();
  });
});

describe("the brake", () => {
  it("holds the newest layer when it came due while the client was away", () => {
    const g = gatePhases({ ...base, week: 4, stateAtDue: () => "dormant" });
    expect(g.scheduledPhase).toBe(2);
    expect(g.openPhase).toBe(1);
    expect(g.held).toBe("dormant");
  });

  it("holds it when it came due while their poll said they were struggling", () => {
    const g = gatePhases({ ...base, week: 4, stateAtDue: () => "struggling" });
    expect(g.openPhase).toBe(1);
    expect(g.held).toBe("struggling");
  });

  it("opens on time when they were fine that week", () => {
    const g = gatePhases({ ...base, week: 4 });
    expect(g.openPhase).toBe(2);
    expect(g.held).toBeNull();
  });

  it("delays rather than withholds — the layer arrives after the grace", () => {
    const held = { ...base, maxPhase: 2, stateAtDue: () => "dormant" as const };
    expect(gatePhases({ ...held, week: 4 }).openPhase).toBe(1); // due, held
    expect(gatePhases({ ...held, week: 5 }).openPhase).toBe(1); // still within grace
    expect(gatePhases({ ...held, week: 6 }).openPhase).toBe(2); // arrives anyway
    expect(gatePhases({ ...held, week: 6 }).held).toBeNull();
  });

  it("does not let a later phase jump a held one", () => {
    // Phase 2 held at week 4; phase 3 is due at week 7 but must not arrive
    // while phase 2 is still pending, or the client gets layer three first.
    const g = gatePhases({
      ...base,
      week: 7,
      maxPhase: 3,
      stateAtDue: (d) => (d === 4 ? "dormant" : null),
    });
    // by week 7 phase 2's grace has expired, so it is in; phase 3 follows
    expect(g.openPhase).toBe(3);
    const early = gatePhases({
      ...base,
      week: 5,
      maxPhase: 3,
      stateAtDue: (d) => (d === 4 ? "dormant" : null),
    });
    expect(early.openPhase).toBe(1);
  });

  it("holds each layer on its own merits, not on an old bad week", () => {
    // Struggling when phase 2 came due, fine by the time phase 3 did.
    const g = gatePhases({
      ...base,
      week: 7,
      stateAtDue: (d) => (d === 4 ? "struggling" : null),
    });
    expect(g.openPhase).toBe(3);
    expect(g.held).toBeNull();
  });

  it("reports how many layers are still to come", () => {
    expect(gatePhases({ ...base, week: 1, maxPhase: 3 }).waiting).toBe(2);
    expect(gatePhases({ ...base, week: 12, maxPhase: 3 }).waiting).toBe(0);
  });
});

describe("reading the client's state at a past due week", () => {
  const START = Date.parse("2026-06-01T00:00:00Z");
  const DAY = 86_400_000;
  const dayOfPlan = (n: number) => new Date(START + n * DAY).toISOString();
  const dateOfPlan = (n: number) => dayOfPlan(n).slice(0, 10);

  const build = (opens: string[], polls: { date: string; score: PollScore }[] = []) =>
    stateAtDueFrom({ startMs: START, opens, polls, dormantDays: 14 });

  it("calls a week dormant when nothing was opened in the fortnight before it", () => {
    // phase 2 is due week 4 = day 21; the window is days 7-21.
    const opens = [dayOfPlan(0), dayOfPlan(2)]; // last open day 2, well outside
    expect(build(opens)(4)).toBe("dormant");
  });

  it("leaves a week alone when the client was around for it", () => {
    expect(build([dayOfPlan(0), dayOfPlan(18)])(4)).toBeNull();
  });

  it("answers about the due week, not about today", () => {
    // Away when phase 2 came due (day 21), back and busy ever since. The
    // answer for week 4 must not change just because they are here now.
    const opens = [dayOfPlan(1), dayOfPlan(30), dayOfPlan(31), dayOfPlan(32)];
    expect(build(opens)(4)).toBe("dormant");
    expect(build(opens)(7)).toBeNull(); // week 7 = day 42, they were around
  });

  it("flags a struggling poll that landed before the due week", () => {
    const polls = [{ date: dateOfPlan(16), score: "struggling" as const }];
    expect(build([dayOfPlan(18)], polls)(4)).toBe("struggling");
  });

  it("ignores a poll that had not happened yet at the due week", () => {
    const polls = [{ date: dateOfPlan(30), score: "struggling" as const }];
    expect(build([dayOfPlan(18)], polls)(4)).toBeNull();
  });

  it("ignores a struggling poll too old to describe that week", () => {
    // 25 days before the due date — outside the three-week window.
    const polls = [{ date: dateOfPlan(-4), score: "struggling" as const }];
    expect(build([dayOfPlan(18)], polls)(4)).toBeNull();
  });

  it("takes the most recent poll, not the worst one", () => {
    const polls = [
      { date: dateOfPlan(8), score: "struggling" as const },
      { date: dateOfPlan(15), score: "good" as const },
    ];
    expect(build([dayOfPlan(18)], polls)(4)).toBeNull();
  });

  it("never holds anything when the plan has no Day 1 yet", () => {
    const gate = stateAtDueFrom({ startMs: null, opens: [], polls: [], dormantDays: 14 });
    expect(gate(4)).toBeNull();
  });

  it("skips the dormancy arm entirely when it is switched off", () => {
    const gate = stateAtDueFrom({ startMs: START, opens: [], polls: [], dormantDays: 0 });
    expect(gate(4)).toBeNull();
  });
});

describe("splitting a plan by phase", () => {
  const items = [
    { name: "a", phase: 1 },
    { name: "b", phase: 2 },
    { name: "c", phase: undefined },
    { name: "d", phase: 3 },
  ];

  it("treats a missing phase as phase 1, so old plans behave exactly as before", () => {
    const { open, later } = splitByPhase(items, (i) => i.phase, 1);
    expect(open.map((i) => i.name)).toEqual(["a", "c"]);
    expect(later.map((i) => i.name)).toEqual(["b", "d"]);
  });

  it("normalises junk downward rather than hiding a practice forever", () => {
    expect(normalisePhase("2")).toBe(2);
    expect(normalisePhase(2.7)).toBe(2);
    for (const junk of [null, undefined, "", "later", 0, -3, Number.NaN]) {
      expect(normalisePhase(junk), `${String(junk)} did not fall back to 1`).toBe(1);
    }
  });

  it("reports the highest phase on the plan", () => {
    expect(maxPhaseOf(items, (i) => i.phase)).toBe(3);
    expect(maxPhaseOf([], () => 1)).toBe(1);
  });
});

describe("seeding phases from the load check", () => {
  /* Hariharan's plan is the one that prompted all of this: 14 practices,
     7 of them needing their own moment in the day, every one on day one. */
  const hariharan = [
    { name: "Morning sunlight, 10 minutes" },
    { name: "4-7-8 breathing before bed" },
    { name: "EFT tapping when anxious" },
    { name: "Hibiscus tea, 1-2 cups" },
    { name: "10-minute walk after every meal" },
    { name: "Abhyanga — warm sesame oil self-massage" },
    { name: "Gratitude journal" },
    { name: "Strength work, twice weekly" },
    { name: "Lights down by 10pm" },
    { name: "Chew each mouthful properly" },
  ];

  it("leaves the cheap practices on day one", () => {
    const seeded = seedPhases(hariharan, classifyPractice);
    const byName = new Map(hariharan.map((p, i) => [p.name, seeded[i]]));
    // These ride a moment the client is already having — they cost nothing to
    // add and staging them would be pure friction.
    expect(byName.get("Hibiscus tea, 1-2 cups")).toBe(1);
    expect(byName.get("Lights down by 10pm")).toBe(1);
    expect(byName.get("10-minute walk after every meal")).toBe(1); // attached to the meal
  });

  it("follows the coach's order — she writes what matters most first", () => {
    const four = [
      { name: "Yoga" },
      { name: "Morning walk" },
      { name: "Gratitude journal" },
      { name: "Stretching" },
    ];
    expect(seedPhases(four, classifyPractice)).toEqual([1, 1, 1, 2]);
  });

  it("rescues the app-guided work when her order would strand all of it", () => {
    // Hariharan's actual miss: written last, so plan order alone sent both
    // guided practices to week 7 — including the EFT round for the anxiety he
    // came in with. Only the LAST foundation slot is taken, so her top two
    // choices are untouched.
    const withGuided = [
      { name: "Morning sunlight, 10 minutes" },
      { name: "Yoga" }, // NOT "walk after lunch" — that rides a meal and is never a stopped moment
      { name: "Gratitude journal" },
      { name: "Belly rhythm", guided: true },
      { name: "EFT tapping", guided: true },
    ];
    const seeded = seedPhases(withGuided, classifyPractice);
    expect(seeded[0]).toBe(1); // her first choice, untouched
    expect(seeded[1]).toBe(1); // her second, untouched
    expect(seeded[3]).toBe(1); // earliest guided one promoted into slot 3
    expect(seeded[2]).toBeGreaterThan(1); // gratitude journal gives up the slot
  });

  it("does not promote anything when a guided practice already made the cut", () => {
    // Her order already includes one; nothing needs rescuing, so nothing moves.
    const items = [
      { name: "Morning sunlight" },
      { name: "4-7-8 breathing", guided: true },
      { name: "Morning walk" },
      { name: "Gratitude journal" },
      { name: "Belly rhythm", guided: true },
    ];
    expect(seedPhases(items, classifyPractice)).toEqual([1, 1, 1, 2, 2]);
  });

  it("keeps the first three stopped moments and stages the rest", () => {
    const seeded = seedPhases(hariharan, classifyPractice);
    const dedicated = hariharan
      .map((p, i) => ({ ...p, phase: seeded[i] }))
      .filter((p) => classifyPractice(p.name).cost === "dedicated");
    expect(dedicated.slice(0, 3).map((p) => p.phase)).toEqual([1, 1, 1]);
    expect(dedicated.slice(3).every((p) => p.phase > 1)).toBe(true);
  });

  it("cuts the day-one load to something a person can actually do", () => {
    const seeded = seedPhases(hariharan, classifyPractice);
    const dayOne = hariharan.filter((_, i) => seeded[i] === 1);
    const stopped = dayOne.filter((p) => classifyPractice(p.name).cost === "dedicated");
    expect(stopped.length).toBeLessThanOrEqual(3);
    // and nothing is lost — every practice still lands somewhere
    expect(new Set(seeded.map((_, i) => i)).size).toBe(hariharan.length);
  });

  it("leaves a small plan entirely alone", () => {
    const small = [{ name: "Morning walk" }, { name: "Chamomile tea at night" }];
    expect(seedPhases(small, classifyPractice)).toEqual([1, 1]);
  });
});
