/** Parity suite pinning cycle-phase.ts to Client.cycle_context() (Python).
 *
 *  cycle-phase.fixture.json is GENERATED from the Python implementation
 *  (fm-database/fmdb/plan/models.py) — 39 cases sweeping three cycle
 *  lengths plus every special branch (stale LMP, perimenopausal, irregular,
 *  postmenopausal, missing LMP, male, future LMP, not_applicable). If either
 *  side's thresholds move, this fails until both move together — the same
 *  contract the exercise screen keeps with its fixture.
 *
 *  Notes/labels are NOT compared: the TS side deliberately carries
 *  client-safe wording while Python carries coach-facing prose.
 */
import { describe, expect, it } from "vitest";

import fixtures from "./cycle-phase.fixture.json";
import { computeCycleContext, cyclePhaseForDisplay } from "./cycle-phase";

interface FixtureCase {
  client: Record<string, unknown>;
  on: string;
  expect: {
    status: string;
    phase: string | null;
    cycle_day: number | null;
    cycle_length: number;
    days_until_next_period: number | null;
    days_since_lmp: number | null;
    regularity: string | null;
    confidence: "high" | "low";
  } | null;
}

describe("computeCycleContext parity with Python cycle_context()", () => {
  for (const c of fixtures as FixtureCase[]) {
    const label = `${JSON.stringify(c.client)} @ ${c.on}`;
    it(label, () => {
      const got = computeCycleContext(c.client, new Date(`${c.on}T00:00:00Z`));
      if (c.expect === null) {
        expect(got).toBeNull();
        return;
      }
      expect(got).not.toBeNull();
      expect({
        status: got!.status,
        phase: got!.phase,
        cycle_day: got!.cycleDay,
        cycle_length: got!.cycleLength,
        days_until_next_period: got!.daysUntilNextPeriod,
        days_since_lmp: got!.daysSinceLmp,
        regularity: got!.regularity,
        confidence: got!.confidence,
      }).toEqual(c.expect);
    });
  }
});

describe("YAML date boundary — unquoted dates arrive as Date objects", () => {
  /** The bug this pins, found smoke-testing the 2026-08-09 deploy: every real
   *  client record is written by PyYAML, which emits dates BARE, so js-yaml
   *  hands back a Date object rather than a string. The original ISO-regex
   *  read turned that into "Thu Jul 28", failed, and reported "no period date
   *  on record" — so not a single real client ever got a phase, silently,
   *  with correct-looking data in the file. Every test here used ISO strings,
   *  which is exactly why they all passed. */
  const on = new Date("2026-08-09T00:00:00Z");
  const base = { sex: "F", cycle_status: "menstruating", cycle_length_days: 28 };

  it("computes the same phase from a Date as from an ISO string", () => {
    const fromString = computeCycleContext(
      { ...base, last_menstrual_period: "2026-07-28" },
      on,
    );
    const fromDate = computeCycleContext(
      { ...base, last_menstrual_period: new Date("2026-07-28T00:00:00.000Z") },
      on,
    );
    expect(fromDate).not.toBeNull();
    expect(fromDate!.phase).toBe(fromString!.phase);
    expect(fromDate!.cycleDay).toBe(fromString!.cycleDay);
    expect(fromDate!.confidence).toBe("high");
  });

  it("ignores an invalid Date rather than throwing", () => {
    const ctx = computeCycleContext(
      { ...base, last_menstrual_period: new Date("nonsense") },
      on,
    );
    expect(ctx!.phase).toBeNull();
    expect(ctx!.confidence).toBe("low");
  });
});

describe("cyclePhaseForDisplay pregnancy/lactation guard", () => {
  const base = {
    sex: "F",
    cycle_status: "menstruating",
    last_menstrual_period: "2026-07-01",
    cycle_length_days: 28,
  };
  const on = new Date("2026-07-10T00:00:00Z");

  it("shows a phase for a plain menstruating client", () => {
    expect(cyclePhaseForDisplay(base, on)?.phase).toBe("follicular");
  });

  it("hides the chip for a pregnant client with stale menstruating status", () => {
    expect(
      cyclePhaseForDisplay(
        { ...base, pregnancy_status: "pregnant_second_trimester" },
        on,
      ),
    ).toBeNull();
  });

  it("hides the chip while lactating", () => {
    expect(
      cyclePhaseForDisplay({ ...base, lactation_started: "2026-05-01" }, on),
    ).toBeNull();
  });
});
