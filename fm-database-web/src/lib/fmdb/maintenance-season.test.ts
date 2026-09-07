import { describe, it, expect } from "vitest";
import { seasonForYmd, seasonLabel } from "./season";
import { seasonalRefreshDue } from "./maintenance-season";

describe("seasonForYmd — Indian month→season mapping", () => {
  it("maps each month to the catalogue season tag", () => {
    expect(seasonForYmd("2026-12-15")).toBe("winter");
    expect(seasonForYmd("2026-01-02")).toBe("winter");
    expect(seasonForYmd("2026-02-10")).toBe("spring");
    expect(seasonForYmd("2026-03-31")).toBe("spring");
    expect(seasonForYmd("2026-05-01")).toBe("summer");
    expect(seasonForYmd("2026-08-20")).toBe("monsoon");
    expect(seasonForYmd("2026-10-05")).toBe("autumn");
    expect(seasonForYmd("2026-11-30")).toBe("autumn");
  });
  it("fails safe on junk", () => {
    expect(seasonForYmd("")).toBeNull();
    expect(seasonForYmd(null)).toBeNull();
    expect(seasonForYmd("not-a-date")).toBeNull();
  });
  it("labels for coach copy", () => {
    expect(seasonLabel("monsoon")).toBe("Monsoon");
  });
});

describe("seasonalRefreshDue — 7 weeks OR season change", () => {
  it("is due when never refreshed", () => {
    const r = seasonalRefreshDue({ seasonal_refreshed_at: null }, "2026-09-07");
    expect(r.due).toBe(true);
    expect(r.reason).toBe("never");
  });
  it("is due when the season has turned since the last build", () => {
    // built in monsoon, now autumn
    const r = seasonalRefreshDue(
      { season: "monsoon", seasonal_refreshed_at: "2026-09-20" },
      "2026-10-06",
    );
    expect(r.due).toBe(true);
    expect(r.reason).toBe("season_changed");
    expect(r.currentSeason).toBe("autumn");
  });
  it("is due when >= 49 days old even within the same season", () => {
    const r = seasonalRefreshDue(
      { season: "summer", seasonal_refreshed_at: "2026-04-10" },
      "2026-06-01",
    );
    expect(r.due).toBe(true);
    expect(r.reason).toBe("stale");
  });
  it("is NOT due when fresh and in-season", () => {
    const r = seasonalRefreshDue(
      { season: "monsoon", seasonal_refreshed_at: "2026-08-20" },
      "2026-09-07",
    );
    expect(r.due).toBe(false);
    expect(r.reason).toBe("current");
  });
});
