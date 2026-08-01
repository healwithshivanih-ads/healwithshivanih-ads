/**
 * The dormancy read has to answer differently depending on who is asking, and
 * the failure mode is silent: a brake wired to the absent-side question simply
 * never fires in the app, and looks like a feature that "works" because
 * nothing ever blocks.
 *
 * So these pin the asymmetry itself, not just the arithmetic.
 */
import { describe, expect, it } from "vitest";

import { daysSinceLastOpen, daysSinceOpenBeforeToday } from "./app-engagement";

const DAY = 86_400_000;
const NOW = Date.parse("2026-08-01T09:00:00.000Z");
const ago = (days: number, hours = 0) =>
  new Date(NOW - days * DAY - hours * 3_600_000).toISOString();

describe("daysSinceLastOpen — the absent-side question (menu cron)", () => {
  it("measures to the most recent open, not the first", () => {
    expect(daysSinceLastOpen([ago(30), ago(3), ago(19)], NOW)).toBe(3);
  });

  it("is null when the client has never opened the app", () => {
    // NOT 0 and NOT Infinity: a client who has not had the chance yet must
    // not be paused. Callers key on null to skip the rule entirely.
    expect(daysSinceLastOpen([], NOW)).toBeNull();
  });

  it("ignores unparseable timestamps rather than failing the whole read", () => {
    expect(daysSinceLastOpen(["not-a-date", ago(5)], NOW)).toBe(5);
    expect(daysSinceLastOpen(["not-a-date"], NOW)).toBeNull();
  });
});

describe("daysSinceOpenBeforeToday — the present-side question (client app)", () => {
  /* The bug this function exists to prevent. */
  it("does not read as 0 just because the client is looking at the app", () => {
    const returningAfterThreeWeeks = [ago(21), ago(0, 1), ago(0, 0)];
    expect(daysSinceLastOpen(returningAfterThreeWeeks, NOW)).toBe(0); // useless here
    expect(daysSinceOpenBeforeToday(returningAfterThreeWeeks, NOW)).toBe(21);
  });

  it("lifts by itself the next morning, with nothing to un-pause by hand", () => {
    // Same client, one day later: yesterday's return is now an older open.
    const nextDay = NOW + DAY;
    const opens = [ago(21), ago(0, 1)];
    expect(daysSinceOpenBeforeToday(opens, nextDay)).toBe(1);
  });

  it("leaves a once-a-week client alone", () => {
    // 7 < 14. Someone checking in weekly is present, not dormant, and must
    // never be braked — that would be the feature punishing normal use.
    expect(daysSinceOpenBeforeToday([ago(7), ago(0, 2)], NOW)).toBe(7);
  });

  it("is null for a client whose only opens are from today", () => {
    // A first-day client has no gap to measure. Inventing one would gate them
    // out of the plan they just started.
    expect(daysSinceOpenBeforeToday([ago(0, 3), ago(0, 1)], NOW)).toBeNull();
    expect(daysSinceOpenBeforeToday([], NOW)).toBeNull();
  });

  it("counts an open from just over 24h ago, and not one from just under", () => {
    expect(daysSinceOpenBeforeToday([ago(1, 1)], NOW)).toBe(1);
    expect(daysSinceOpenBeforeToday([ago(0, 23)], NOW)).toBeNull();
  });
});
