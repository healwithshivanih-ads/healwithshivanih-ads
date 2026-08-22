/**
 * Two bugs this rule exists to prevent, each as a failing-if-broken test.
 *
 * 2026-08-22 (Nazneen, cl-022): the coach approved week 5. The approval TRIMMED
 * `app_menu.weeks` to [4, 5] — weeks 2 and 3, live and in use, were discarded
 * in the same write. The client reported "the other food options/recipes have
 * dropped off again" within hours. "Again" because week 1 had gone the same
 * way on 2026-08-09. Every client on the weekly cadence was on the same
 * two-week window. Approval must APPEND, never replace.
 *
 * 2026-08-02 (Nidhi, phase 3): her successor plan carried the predecessor's
 * weeks 11 and 12. Approving week 1 sorted to [1, 11, 12] and the then-trim
 * (keep the two numerically highest) threw the approved week away. The
 * carried weeks must still leave when the new phase's own weeks arrive — but
 * it is the CARRIED weeks that go, never the approved one.
 */
import { describe, it, expect } from "vitest";
import { weeksAfterApproval, fallbackWeekFor, planWeekFromStart } from "./menu-weeks";

const wk = (n: number, source_plan?: string) => ({ week: n, days: [`d${n}`], source_plan });
const nums = (ws: { week?: number }[]) => ws.map((w) => w.week);

describe("weeksAfterApproval — approval appends", () => {
  it("keeps every live week when the next one is approved (the Nazneen case)", () => {
    const out = weeksAfterApproval([wk(2), wk(3), wk(4), wk(5)], 5, "nazneen-plan-1");
    expect(nums(out)).toEqual([2, 3, 4, 5]);
  });

  it("grows week by week over a whole plan", () => {
    let live = [wk(1)];
    for (let n = 2; n <= 12; n++) live = weeksAfterApproval([...live, wk(n, "p")], n, "p");
    expect(nums(live)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("re-approving a week replaces that week only — the newest copy wins", () => {
    const out = weeksAfterApproval(
      [wk(1), { week: 2, days: ["old"] }, wk(3), { week: 2, days: ["new"] }],
      2,
      "p",
    );
    expect(nums(out)).toEqual([1, 2, 3]);
    expect(out[1].days).toEqual(["new"]);
  });

  it("keeps a live week one ahead when the current week is re-approved", () => {
    // Coach force-redrafts the current week while next week is already live.
    const out = weeksAfterApproval([wk(1), wk(2), wk(3), wk(2)], 2, "p");
    expect(nums(out)).toEqual([1, 2, 3]);
  });

  it("catch-up after a gap keeps the earlier weeks", () => {
    const out = weeksAfterApproval([wk(1), wk(2), wk(6)], 6, "p");
    expect(nums(out)).toEqual([1, 2, 6]);
  });
});

describe("weeksAfterApproval — carried predecessor weeks still leave", () => {
  it("drops untagged weeks beyond drafting's reach (the Nidhi case, legacy data)", () => {
    const out = weeksAfterApproval([wk(11), wk(12), wk(1)], 1, "nidhi-plan-3");
    expect(nums(out)).toEqual([1]);
  });

  it("drops weeks stamped with another plan's slug, whatever their number", () => {
    // A 4-week predecessor carried [3, 4]; week 3 is within +1 of an approved
    // week 2, so only the stamp can identify it as foreign.
    const out = weeksAfterApproval(
      [wk(3, "samaa-plan-1"), wk(4, "samaa-plan-1"), wk(2, "samaa-plan-2")],
      2,
      "samaa-plan-2",
    );
    expect(nums(out)).toEqual([2]);
  });

  it("keeps weeks stamped with THIS plan's slug even far ahead", () => {
    const out = weeksAfterApproval([wk(1, "p"), wk(9, "p"), wk(2, "p")], 2, "p");
    expect(nums(out)).toEqual([1, 2, 9]);
  });

  it("without a plan slug, treats stamps as unknown and falls back to the numeric rule", () => {
    const out = weeksAfterApproval([wk(11, "old"), wk(12, "old"), wk(1)], 1);
    expect(nums(out)).toEqual([1]);
  });

  it("survives an approval for a week that isn't in the list yet", () => {
    expect(weeksAfterApproval([wk(11), wk(12)], 1, "p")).toEqual([]);
  });

  it("ignores malformed week values rather than throwing", () => {
    const out = weeksAfterApproval(
      [{ week: undefined }, { week: NaN }, wk(1), wk(2)] as { week?: number }[],
      2,
      "p",
    );
    expect(nums(out)).toEqual([1, 2]);
  });
});

describe("fallbackWeekFor — which week the app shows when the current one isn't live", () => {
  it("stays on the most recent loaded week (a frozen client keeps her last menu)", () => {
    expect(fallbackWeekFor([1, 2, 3, 4, 5], 6)).toBe(5);
  });

  it("does NOT rotate back to week 1 just because five weeks are loaded", () => {
    // ((6 - 1) % 5) + 1 === 1 — the old fortnight rotation would have done this.
    expect(fallbackWeekFor([1, 2, 3, 4, 5], 6)).not.toBe(1);
  });

  it("picks the latest week at or before the current one across a gap", () => {
    expect(fallbackWeekFor([1, 2, 6], 4)).toBe(2);
  });

  it("falls forward to the earliest week when everything loaded is ahead (carried successor)", () => {
    expect(fallbackWeekFor([11, 12], 1)).toBe(11);
  });

  it("returns null with nothing loaded", () => {
    expect(fallbackWeekFor([], 3)).toBeNull();
  });
});

describe("planWeekFromStart", () => {
  const day = 86_400_000;
  const start = new Date("2026-07-27T00:00:00Z").getTime();
  it("is week 1 on Day 1 and through day 7", () => {
    expect(planWeekFromStart("2026-07-27", start)).toBe(1);
    expect(planWeekFromStart("2026-07-27", start + 6 * day)).toBe(1);
  });
  it("rolls to week 2 on day 8", () => {
    expect(planWeekFromStart("2026-07-27", start + 7 * day)).toBe(2);
  });
  it("is week 1 with no anchor or a bad one", () => {
    expect(planWeekFromStart(null, start)).toBe(1);
    expect(planWeekFromStart("not-a-date", start)).toBe(1);
  });
  it("never goes below week 1 before the start", () => {
    expect(planWeekFromStart("2026-07-27", start - 20 * day)).toBe(1);
  });
});
