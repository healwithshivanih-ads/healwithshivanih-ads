import { describe, it, expect } from "vitest";
import { deriveTreeState, stageForWeek, STAGE_LABEL, type TreeInput } from "./growing-tree-state";

function input(over: Partial<TreeInput> = {}): TreeInput {
  return { week: 0, totalWeeks: 12, dailyDone: 0, dailyTotal: 0, night: false, ...over };
}

describe("stageForWeek — week → stage boundaries", () => {
  it("maps each stage band correctly (sapling 0-1 · young 2-4 · mature 5-8 · flowering 9-11 · fruiting 12+)", () => {
    expect(stageForWeek(0)).toBe("sapling");
    expect(stageForWeek(1)).toBe("sapling");
    expect(stageForWeek(2)).toBe("young");
    expect(stageForWeek(4)).toBe("young");
    expect(stageForWeek(5)).toBe("mature");
    expect(stageForWeek(8)).toBe("mature");
    expect(stageForWeek(9)).toBe("flowering");
    expect(stageForWeek(11)).toBe("flowering");
    expect(stageForWeek(12)).toBe("fruiting");
    expect(stageForWeek(52)).toBe("fruiting");
  });

  it("clamps invalid weeks (negative / NaN / Infinity) to the sapling floor (never crashes)", () => {
    expect(stageForWeek(-5)).toBe("sapling");
    expect(stageForWeek(Number.NaN)).toBe("sapling");
    // Non-finite input is invalid → the guard floors it rather than jumping to fruiting.
    expect(stageForWeek(Number.POSITIVE_INFINITY)).toBe("sapling");
  });

  it("is monotonic — a higher week never yields an earlier stage", () => {
    const order = ["sapling", "young", "mature", "flowering", "fruiting"];
    let last = 0;
    for (let w = 0; w <= 40; w++) {
      const idx = order.indexOf(stageForWeek(w));
      expect(idx).toBeGreaterThanOrEqual(last);
      last = idx;
    }
  });
});

describe("deriveTreeState — stage + label", () => {
  it("derives the stage and its label from the week", () => {
    const s = deriveTreeState(input({ week: 10, totalWeeks: 12 }));
    expect(s.stage).toBe("flowering");
    expect(s.stageLabel).toBe(STAGE_LABEL.flowering);
    expect(s.stageLabel).toBe("Flowering");
  });

  it("clamps the week to totalWeeks (never past plan length)", () => {
    const s = deriveTreeState(input({ week: 30, totalWeeks: 12 }));
    expect(s.week).toBe(12);
    expect(s.stage).toBe("fruiting");
  });

  it("floors a fractional / negative week to a non-negative integer", () => {
    expect(deriveTreeState(input({ week: 3.9 })).week).toBe(3);
    expect(deriveTreeState(input({ week: -4 })).week).toBe(0);
    expect(deriveTreeState(input({ week: Number.NaN })).week).toBe(0);
  });
});

describe("deriveTreeState — leafFill from daily check-ins", () => {
  it("computes dailyDone / dailyTotal", () => {
    expect(deriveTreeState(input({ dailyDone: 3, dailyTotal: 4 })).leafFill).toBeCloseTo(0.75, 5);
    expect(deriveTreeState(input({ dailyDone: 4, dailyTotal: 4 })).leafFill).toBe(1);
  });

  it("returns 0 for 0/0 — no divide-by-zero", () => {
    const s = deriveTreeState(input({ dailyDone: 0, dailyTotal: 0 }));
    expect(s.leafFill).toBe(0);
    expect(Number.isFinite(s.leafFill)).toBe(true);
  });

  it("clamps done to total (leafFill never exceeds 1) and is never negative", () => {
    const over = deriveTreeState(input({ dailyDone: 9, dailyTotal: 4 }));
    expect(over.leafFill).toBe(1);
    expect(over.dailyDone).toBe(4);

    const neg = deriveTreeState(input({ dailyDone: -3, dailyTotal: 4 }));
    expect(neg.leafFill).toBe(0);
    expect(neg.dailyDone).toBe(0);
    expect(neg.leafFill).toBeGreaterThanOrEqual(0);
  });

  it("guards NaN daily inputs", () => {
    const s = deriveTreeState(input({ dailyDone: Number.NaN, dailyTotal: Number.NaN }));
    expect(s.leafFill).toBe(0);
    expect(s.dailyDone).toBe(0);
    expect(s.dailyTotal).toBe(0);
  });
});

describe("deriveTreeState — extraLeaves bonus (bounded, non-negative)", () => {
  it("awards a bounded bonus only when the day is fully complete", () => {
    expect(deriveTreeState(input({ dailyDone: 4, dailyTotal: 4 })).extraLeaves).toBe(4);
    expect(deriveTreeState(input({ dailyDone: 2, dailyTotal: 4 })).extraLeaves).toBe(0);
    expect(deriveTreeState(input({ dailyDone: 0, dailyTotal: 0 })).extraLeaves).toBe(0);
  });

  it("caps the bonus at 6 and never goes negative", () => {
    expect(deriveTreeState(input({ dailyDone: 20, dailyTotal: 20 })).extraLeaves).toBe(6);
    expect(deriveTreeState(input({ dailyDone: 0, dailyTotal: 4 })).extraLeaves).toBe(0);
  });
});

describe("deriveTreeState — invariants", () => {
  it("totalWeeks is at least 1 even for zero / negative input", () => {
    expect(deriveTreeState(input({ totalWeeks: 0 })).totalWeeks).toBe(1);
    expect(deriveTreeState(input({ totalWeeks: -12 })).totalWeeks).toBe(1);
  });

  it("streak defaults to 0 and clamps negatives", () => {
    expect(deriveTreeState(input({})).streak).toBe(0);
    expect(deriveTreeState(input({ streak: 5 })).streak).toBe(5);
    expect(deriveTreeState(input({ streak: -9 })).streak).toBe(0);
  });

  it("passes night through", () => {
    expect(deriveTreeState(input({ night: true })).night).toBe(true);
    expect(deriveTreeState(input({ night: false })).night).toBe(false);
  });

  it("is a pure function — identical input yields deeply-equal output", () => {
    const a = deriveTreeState(input({ week: 7, dailyDone: 2, dailyTotal: 5, streak: 3 }));
    const b = deriveTreeState(input({ week: 7, dailyDone: 2, dailyTotal: 5, streak: 3 }));
    expect(a).toEqual(b);
  });

  it("going to a lower week does not crash and stays a valid, earlier-or-equal stage", () => {
    const order = ["sapling", "young", "mature", "flowering", "fruiting"];
    const hi = deriveTreeState(input({ week: 12 }));
    const lo = deriveTreeState(input({ week: 3 }));
    expect(order.indexOf(lo.stage)).toBeLessThanOrEqual(order.indexOf(hi.stage));
    expect(lo.week).toBe(3);
    expect(lo.week).toBeGreaterThanOrEqual(0);
  });
});
