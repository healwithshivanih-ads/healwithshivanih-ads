import { describe, it, expect } from "vitest";
import {
  DRAFT_WINDOW_DAYS,
  splitByDraftWindow,
  daysUntilDrafted,
  draftDayLabel,
} from "../menu-cadence";

const row = (behind: boolean, daysToNextWeek: number) => ({ behind, daysToNextWeek });

describe("splitByDraftWindow", () => {
  it("calls a row outside the drafter's window scheduled, not failed", () => {
    // The 6 Aug 2026 case: Nazneen and Krittika 4 days out, Pranati 6. All
    // three were reported as possible API-cap failures; none of them was.
    const { stalled, scheduled } = splitByDraftWindow([row(false, 4), row(false, 6)]);
    expect(stalled.length).toBe(0);
    expect(scheduled.length).toBe(2);
  });

  it("calls a row INSIDE the window with no draft a real failure", () => {
    // The digest runs half an hour after the drafter, so anything this close
    // has already had its turn.
    const { stalled, scheduled } = splitByDraftWindow([row(false, DRAFT_WINDOW_DAYS)]);
    expect(stalled.length).toBe(1);
    expect(scheduled.length).toBe(0);
  });

  it("treats a missing CURRENT week as urgent whatever the date says", () => {
    // `behind` means the client has no menu for the week they are living in.
    // That must never be filed under "drafting on its own".
    const { stalled, scheduled } = splitByDraftWindow([row(true, 6)]);
    expect(stalled.length).toBe(1);
    expect(scheduled.length).toBe(0);
  });

  it("keeps every row — the split partitions, it never drops", () => {
    const rows = [row(true, 1), row(false, 2), row(false, 9)];
    const { stalled, scheduled } = splitByDraftWindow(rows);
    expect(stalled.length + scheduled.length).toBe(rows.length);
  });
});

describe("daysUntilDrafted", () => {
  it("counts down to the window, not to the week", () => {
    expect(daysUntilDrafted(6)).toBe(3);
    expect(daysUntilDrafted(4)).toBe(1);
  });

  it("never goes negative for an overdue row", () => {
    expect(daysUntilDrafted(0)).toBe(0);
    expect(daysUntilDrafted(-3)).toBe(0);
  });
});

describe("draftDayLabel", () => {
  // Thu 6 Aug 2026, 07:30 IST — the morning the digest that prompted this ran.
  const now = new Date("2026-08-06T02:00:00Z");

  it("names tomorrow as tomorrow", () => {
    expect(draftDayLabel(4, now)).toBe("tomorrow"); // drafts Fri 7th
  });

  it("names a weekday within the week", () => {
    expect(draftDayLabel(6, now)).toBe("Sunday"); // drafts Sun 9th
  });

  it("falls back to a date once a weekday name would be ambiguous", () => {
    expect(draftDayLabel(14, now)).toMatch(/\d+ \w{3}/);
  });

  it("says today for a row the drafter should already have taken", () => {
    expect(draftDayLabel(DRAFT_WINDOW_DAYS, now)).toBe("today");
  });
});
