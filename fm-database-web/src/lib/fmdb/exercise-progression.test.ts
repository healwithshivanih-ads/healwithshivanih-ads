import { describe, expect, it } from "vitest";

import {
  nextRung,
  progressionVerdict,
  PROGRESSION_MIN_FINISHED,
} from "./exercise-progression";

describe("progressionVerdict", () => {
  it("holds below the finished threshold", () => {
    const v = progressionVerdict(PROGRESSION_MIN_FINISHED - 1, 0);
    expect(v.ready).toBe(false);
    expect(v.holdReason).toContain("finished");
  });

  it("fires at the threshold with clean sessions", () => {
    expect(progressionVerdict(PROGRESSION_MIN_FINISHED, 0).ready).toBe(true);
  });

  it("holds when part-way sessions outnumber finished ones", () => {
    // The too-long / too-hard signal must never read as readiness.
    const v = progressionVerdict(PROGRESSION_MIN_FINISHED, PROGRESSION_MIN_FINISHED + 1);
    expect(v.ready).toBe(false);
    expect(v.holdReason).toContain("part-way");
  });
});

describe("nextRung", () => {
  const levels = [
    { level: "1", prescription: "5 reps supported", support: "one hand on a counter" },
    { level: "2", prescription: "8 reps", support: "none" },
    { level: "3", prescription: "10 reps, two sets", support: "none" },
  ];

  it("advances one rung from the current level", () => {
    expect(nextRung(levels, "1")?.level).toBe("2");
    expect(nextRung(levels, "2")?.level).toBe("3");
  });

  it("returns null at the top of the ladder", () => {
    expect(nextRung(levels, "3")).toBeNull();
  });

  it("suggests the second rung when no level was recorded", () => {
    expect(nextRung(levels, null)?.level).toBe("2");
  });

  it("returns null for an unknown level rather than guessing", () => {
    expect(nextRung(levels, "B")).toBeNull();
  });

  it("returns null for an empty ladder", () => {
    expect(nextRung([], "1")).toBeNull();
  });
});
