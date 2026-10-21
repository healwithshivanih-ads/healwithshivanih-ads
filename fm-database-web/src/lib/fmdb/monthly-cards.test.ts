import { describe, expect, it } from "vitest";
import { addMonths, cardStatus, monthsOwed } from "./monthly-cards";

describe("monthsOwed", () => {
  it("owes this month only, before the lead day", () => {
    expect(monthsOwed("2026-10-21", {}, "2027-04-20")).toEqual(["2026-10"]);
  });
  it("adds next month from the 25th, across a year end", () => {
    expect(monthsOwed("2026-12-25", {}, "2027-04-20")).toEqual(["2026-12", "2027-01"]);
  });
  it("never rewrites a card in any state — skipped included", () => {
    expect(monthsOwed("2026-11-26", { "2026-11": { status: "skipped" }, "2026-12": { status: "pending_review" } }, null)).toEqual([]);
  });
  it("stops at the paid-through date", () => {
    expect(monthsOwed("2027-04-26", {}, "2027-04-20")).toEqual(["2027-04"]);
    expect(monthsOwed("2027-05-02", {}, "2027-04-20")).toEqual([]);
  });
  it("owes nothing before the plan starts", () => {
    expect(monthsOwed("2026-10-26", {}, null, "2026-11-01")).toEqual(["2026-11"]);
  });
});

describe("helpers", () => {
  it("addMonths wraps the year", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2027-01", -1)).toBe("2026-12");
  });
  it("a card with no status is live", () => {
    expect(cardStatus({ dos: ["x"] })).toBe("live");
    expect(cardStatus({ status: "pending_review" })).toBe("pending_review");
    expect(cardStatus(null)).toBeNull();
  });
});
