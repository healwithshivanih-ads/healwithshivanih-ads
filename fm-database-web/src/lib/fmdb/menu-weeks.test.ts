/**
 * The bug this rule exists to prevent, as a failing-if-broken test.
 *
 * 2026-08-02: the coach approved week 1 of Nidhi's phase-3 menu. The amendment
 * logged "Week 1 menu approved and live". The menu was discarded in the same
 * operation, because the trim kept the two numerically HIGHEST weeks and her
 * successor plan carries the previous phase's weeks 11 and 12:
 *
 *     [11, 12] + 1  →  sorted [1, 11, 12]  →  slice(-2)  →  [11, 12]
 *
 * Nothing errored. The pending draft was cleared, so the approved menu was
 * unrecoverable and had to be regenerated.
 */
import { describe, it, expect } from "vitest";
import { weeksAfterApproval } from "./menu-weeks";

const wk = (n: number) => ({ week: n, days: [`d${n}`] });

describe("weeksAfterApproval", () => {
  it("keeps a new phase's week 1 over the previous phase's carried weeks", () => {
    const out = weeksAfterApproval([wk(11), wk(12), wk(1)], 1);
    expect(out.map((w) => w.week)).toEqual([1]);
  });

  it("keeps the approved week and the one before it, in order", () => {
    const out = weeksAfterApproval([wk(3), wk(4), wk(5)], 5);
    expect(out.map((w) => w.week)).toEqual([4, 5]);
  });

  it("drops everything older than the pair — the app only shows two", () => {
    const out = weeksAfterApproval([wk(1), wk(2), wk(3), wk(4)], 4);
    expect(out.map((w) => w.week)).toEqual([3, 4]);
  });

  it("survives an approval for a week that isn't in the list yet", () => {
    expect(weeksAfterApproval([wk(11), wk(12)], 1)).toEqual([]);
  });

  it("ignores malformed week values rather than throwing", () => {
    const out = weeksAfterApproval(
      [{ week: undefined }, { week: NaN }, wk(2)] as { week?: number }[],
      2,
    );
    expect(out.map((w) => w.week)).toEqual([2]);
  });
});
