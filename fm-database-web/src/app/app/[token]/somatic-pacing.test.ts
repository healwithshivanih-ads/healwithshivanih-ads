/**
 * A long step must have a rhythm to follow.
 *
 * Nearly every breathing practice demonstrates one cycle in short steps and
 * then hands the client a single long step meaning "keep going" —
 * box-breathing does 4/4/4/4 and then `Repeat the cycle` for 264 SECONDS.
 * Driven from that step's own progress it rendered as ONE four-and-a-half
 * minute inhalation, which is not something a person can breathe along with.
 *
 * Reads the real catalogue, so it also fails if a shipped practice loses the
 * short steps its long one depends on.
 */
import fs from "node:fs";
import path from "node:path";

import { describe, it, expect } from "vitest";
import yaml from "js-yaml";

import { getCataloguePath } from "@/lib/fmdb/paths";
import { breathCycle, isPaceable, LONG_STEP_SECS, pacedFrame, stepMode } from "./somatic-shapes";

type Step = { secs: number | null; action: string };

function practice(slug: string): { steps: Step[]; shape: string } {
  const raw = fs.readFileSync(
    path.join(getCataloguePath(), "somatic_practices", `${slug}.yaml`),
    "utf8",
  );
  const d = (yaml.load(raw) ?? {}) as Record<string, unknown>;
  return {
    steps: (d.steps as Step[]) ?? [],
    shape: String(d.motion_shape ?? ""),
  };
}

describe("breathCycle — the cadence is taken from the practice, never invented", () => {
  it("reads box breathing's own 4-4-4-4", () => {
    expect(breathCycle(practice("box-breathing").steps)).toEqual([
      { action: "expand", secs: 4 },
      { action: "hold", secs: 4 },
      { action: "release", secs: 4 },
      { action: "hold", secs: 4 },
    ]);
  });

  it("reads gastrocolic rhythm's inhale and its pressured exhale", () => {
    expect(breathCycle(practice("gastrocolic-rhythm").steps)).toEqual([
      { action: "expand", secs: 5 },
      { action: "press", secs: 7 },
    ]);
  });

  it("ignores the long 'now continue' step when working out the cadence", () => {
    for (const slug of ["box-breathing", "gastrocolic-rhythm", "belly-drop"]) {
      for (const beat of breathCycle(practice(slug).steps)) {
        expect(beat.secs, `${slug} took its long step as a beat`).toBeLessThan(LONG_STEP_SECS);
      }
    }
  });

  it("falls back to a calm default when a practice never demonstrates one", () => {
    // weighted-grounding just says "slow breathing" for 520s
    const c = breathCycle(practice("weighted-grounding").steps);
    expect(c.length).toBeGreaterThanOrEqual(2);
    expect(c.some((b) => b.action === "expand")).toBe(true);
    expect(c.some((b) => b.action === "release" || b.action === "shrink")).toBe(true);
  });

  /* `observe` is paceable but is NOT a beat. belly-drop's 10s "Observe
     sensation" must not become part of the cadence, or the practice would be
     paced to a rhythm it never described. */
  it("never lets a pause become a beat of the cycle", () => {
    for (const slug of ["belly-drop", "safe-body-scan", "awe-practice"]) {
      for (const beat of breathCycle(practice(slug).steps)) {
        expect(beat.action, `${slug} took an observe step as a beat`).not.toBe("observe");
        expect(beat.action).not.toBe("rest");
      }
    }
  });

  it("breathes under a long observe step, which is where the client is told to keep breathing", () => {
    const cyc = breathCycle(practice("belly-drop").steps);
    // 238s "Continue breathing and noticing"
    const a = pacedFrame("observe", 238, 0, cyc);
    const b = pacedFrame("observe", 238, 6, cyc);
    expect(a.action).not.toBe("observe");   // it is breathing now
    expect([a.action, b.action]).not.toEqual([a.action, a.action]);
  });

  it("never returns a lone beat — one inhale with no exhale is not a cycle", () => {
    expect(breathCycle([{ action: "expand", secs: 5 }] as Step[]).length).toBeGreaterThanOrEqual(2);
    expect(breathCycle([]).length).toBeGreaterThanOrEqual(2);
  });
});

describe("pacedFrame — short steps are the demonstration, long ones the repeat", () => {
  const cycle = breathCycle(practice("gastrocolic-rhythm").steps); // expand 5, press 7

  it("leaves a short step exactly as it was", () => {
    expect(pacedFrame("expand", 5, 0, cycle)).toEqual({ action: "expand", p: 0 });
    expect(pacedFrame("expand", 5, 2.5, cycle)).toEqual({ action: "expand", p: 0.5 });
    expect(pacedFrame("expand", 5, 5, cycle)).toEqual({ action: "expand", p: 1 });
  });

  it("loops the cycle through a long step instead of stretching once across it", () => {
    // 213s "Continue the rhythm": 12s cycle → inhale 0-5, exhale 5-12
    expect(pacedFrame("expand", 213, 0, cycle).action).toBe("expand");
    expect(pacedFrame("expand", 213, 6, cycle).action).toBe("press");
    expect(pacedFrame("expand", 213, 12, cycle).action).toBe("expand"); // second breath
    expect(pacedFrame("expand", 213, 120, cycle).action).toBe("expand"); // ten breaths in
  });

  it("gives a full excursion each time round, not a creeping one", () => {
    const first = pacedFrame("expand", 213, 2.5, cycle);
    const tenth = pacedFrame("expand", 213, 2.5 + 12 * 9, cycle);
    expect(tenth).toEqual(first);
    expect(first.p).toBeCloseTo(0.5, 5);
  });

  it("completes many breaths across the step rather than one", () => {
    let changes = 0;
    let prev = pacedFrame("expand", 213, 0, cycle).action;
    for (let t = 0.5; t <= 213; t += 0.5) {
      const a = pacedFrame("expand", 213, t, cycle).action;
      if (a !== prev) changes++;
      prev = a;
    }
    expect(changes).toBeGreaterThan(30); // ~17 full breaths in 213s
  });

  it("does not pace a long step that is a pause, not a movement", () => {
    // "Morning warm water", 60s of `rest` — the client is drinking, not breathing
    const r = pacedFrame("rest", 60, 30, cycle);
    expect(r.action).toBe("rest");
    expect(r.p).toBeCloseTo(0.5, 5);
  });

  it("holds still rather than dividing by zero on a zero-length step", () => {
    expect(pacedFrame("expand", 0, 3, cycle).p).toBe(0);
  });
});

describe("the practices this was broken for", () => {
  it("every breath practice with a long step now has a cycle to replay", () => {
    const dir = path.join(getCataloguePath(), "somatic_practices");
    let checked = 0;
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".yaml"))) {
      const d = (yaml.load(fs.readFileSync(path.join(dir, f), "utf8")) ?? {}) as Record<string, unknown>;
      if (d.motion_shape !== "breath_excursion" || d.timed === false) continue;
      const steps = (d.steps as Step[]) ?? [];
      const long = steps.find((s) => (s.secs ?? 0) >= LONG_STEP_SECS && isPaceable(s.action));
      if (!long) continue;
      checked++;
      const cyc = breathCycle(steps);
      const secs = long.secs ?? 0;
      // Sample the whole step. A stretched step reports ONE action the whole
      // way through and a p that only ever climbs; a paced one alternates and
      // returns to the start of each beat. (A point-value check is not enough
      // — awe-practice's midpoint lands on p=0.5 by coincidence.)
      let flips = 0;
      let resets = 0;
      let prev = pacedFrame(long.action, secs, 0, cyc);
      for (let t = 0.5; t <= secs; t += 0.5) {
        const now = pacedFrame(long.action, secs, t, cyc);
        if (now.action !== prev.action) flips++;
        if (now.p < prev.p) resets++;
        prev = now;
      }
      expect(flips, `${d.slug} never changes phase across its long step`).toBeGreaterThan(2);
      expect(resets, `${d.slug} stretches one excursion instead of repeating`).toBeGreaterThan(2);
    }
    expect(checked, "no long-step breath practices found — the suite proves nothing").toBeGreaterThan(10);
  });

  /* The other side of the same rule: a long step that is NOT a movement must
     be left exactly as it was. A client told to drink a glass of water should
     not have a breath paced underneath it. */
  it("leaves long non-movement steps alone", () => {
    const cyc = breathCycle(practice("gastrocolic-rhythm").steps);
    for (const action of ["rest", "massage"]) {
      expect(isPaceable(action)).toBe(false);
      const r = pacedFrame(action, 200, 100, cyc);
      expect(r.action, `${action} was paced`).toBe(action);
      expect(r.p).toBeCloseTo(0.5, 5);
    }
  });
});

describe("stepMode — tasks are tapped through, rhythms are followed", () => {
  it("makes rest steps self-paced — 'drink warm water' is a task, not a countdown", () => {
    expect(stepMode("rest")).toBe("self_paced");
  });

  it("keeps every movement guided", () => {
    for (const a of ["expand", "release", "press", "hold", "circle", "tap", "observe", "massage"]) {
      expect(stepMode(a), `${a} should stay guided`).toBe("guided");
    }
  });

  it("gastrocolic-rhythm opens with two tasks, then three guided steps", () => {
    const modes = practice("gastrocolic-rhythm").steps.map((s) => stepMode(s.action));
    expect(modes).toEqual(["self_paced", "self_paced", "guided", "guided", "guided"]);
  });
});
