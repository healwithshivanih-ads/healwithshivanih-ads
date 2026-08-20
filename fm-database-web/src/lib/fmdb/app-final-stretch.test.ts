/**
 * The final-week heads-up — resolveFinalStretch + its wiring through buildEndgame.
 *
 * Why this exists: the app switches from a client's live plan to the frozen
 * LIBRARY floor purely on dates, with no warning. cl-017 dropped on 19 Aug and
 * opened the app the next day to find it changed — it read as something being
 * taken away. The fix is a dated, calm note in the final stretch that says what
 * STAYS. These tests pin the two ways that note can go wrong: appearing too
 * early / too late (so it contradicts what the rest of the app is saying), and
 * quoting a travel-blind date to a client who paused.
 */
import { describe, it, expect } from "vitest";
import { resolveFinalStretch, FINAL_STRETCH_DAYS, resolveAppMode, type AppModePlan } from "./app-mode";
import { effectiveRecheckDate, type TravelOverrideLike } from "./plan-timing";
import { buildEndgame } from "./client-app";

const TODAY = "2026-08-20";

function addDays(ymd: string, n: number): string {
  const d = new Date(ymd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** A published 12-week plan whose effective recheck lands `daysOut` from TODAY. */
function planWithRecheck(daysOut: number, weeks = 12): AppModePlan {
  const started = addDays(TODAY, daysOut - weeks * 7);
  return {
    plan_period_start: started,
    plan_period_weeks: weeks,
    meal_plan_started_on: started,
    status: "published",
  };
}

/** Resolve the note the way the app does: mode first, then the note. */
function noteFor(
  plan: AppModePlan,
  todayYmd = TODAY,
  recheckOpts: Parameters<typeof resolveFinalStretch>[3] = {},
) {
  const { mode } = resolveAppMode({ plan, recheckOpts }, todayYmd);
  return { mode, note: resolveFinalStretch(mode, plan, todayYmd, recheckOpts) };
}

describe("resolveFinalStretch — the window", () => {
  it("shows 7 days before the finish date (the far edge of the window)", () => {
    const { mode, note } = noteFor(planWithRecheck(FINAL_STRETCH_DAYS));
    expect(mode).toBe("REVIEW");
    expect(note).not.toBeNull();
    expect(note!.daysLeft).toBe(7);
    expect(note!.recheckDate).toBe(addDays(TODAY, 7));
  });

  it("shows 1 day before", () => {
    const { note } = noteFor(planWithRecheck(1));
    expect(note).not.toBeNull();
    expect(note!.daysLeft).toBe(1);
  });

  it("shows on the finish date itself, as 0 days left", () => {
    const { note } = noteFor(planWithRecheck(0));
    expect(note?.daysLeft).toBe(0);
  });

  it("does NOT show 8 days before — this is a final-stretch note, not a countdown", () => {
    // The client is already in REVIEW here (that window opens 14 days out and
    // carries the graduation report). The heads-up must still stay quiet.
    const { mode, note } = noteFor(planWithRecheck(FINAL_STRETCH_DAYS + 1));
    expect(mode).toBe("REVIEW");
    expect(note).toBeNull();
  });

  it("does NOT show well before the end", () => {
    expect(noteFor(planWithRecheck(30)).note).toBeNull();
    expect(noteFor(planWithRecheck(60)).mode).toBe("ACTIVE");
  });

  it("does NOT show once the finish date has passed", () => {
    // REVIEW runs 15 days PAST the recheck. Through all of it the graduation
    // copy says "you've reached the finish line" — "finishing soon" would
    // contradict the mode.
    for (const daysPast of [1, 5, 15]) {
      const { mode, note } = noteFor(planWithRecheck(-daysPast));
      expect(mode, `${daysPast}d past`).toBe("REVIEW");
      expect(note, `${daysPast}d past`).toBeNull();
    }
  });
});

describe("resolveFinalStretch — never contradicts the mode", () => {
  it("is silent in every mode except REVIEW", () => {
    const plan = planWithRecheck(3); // inside the window on dates alone
    for (const mode of ["ACTIVE", "MAINTENANCE", "GRACE", "LIBRARY"] as const) {
      expect(resolveFinalStretch(mode, plan, TODAY), mode).toBeNull();
    }
    expect(resolveFinalStretch("REVIEW", plan, TODAY)).not.toBeNull();
  });

  it("is silent for a maintenance client whose old plan window happens to be ending", () => {
    // Resolved end-to-end: maintenance outranks the plan window, so the mode is
    // MAINTENANCE and nothing should be telling her she's finishing.
    const plan = planWithRecheck(3);
    const { mode } = resolveAppMode(
      { maintenance_status: "active", maintenance_paid_through: addDays(TODAY, 120), plan },
      TODAY,
    );
    expect(mode).toBe("MAINTENANCE");
    expect(resolveFinalStretch(mode, plan, TODAY)).toBeNull();
  });

  it("returns nothing when the finish date can't be computed", () => {
    expect(resolveFinalStretch("REVIEW", { status: "published" }, TODAY)).toBeNull();
    expect(resolveFinalStretch("REVIEW", null, TODAY)).toBeNull();
    expect(resolveFinalStretch("REVIEW", planWithRecheck(3), "not-a-date")).toBeNull();
  });
});

// ── The travel case ─────────────────────────────────────────────────────────
// A bare effectiveRecheckDate() call is travel-blind. A client who paused for a
// fortnight would be warned on the date she WOULD have finished had she never
// travelled — early, and with the wrong date. That is exactly the surprise this
// note exists to prevent, so it gets its own block.
describe("resolveFinalStretch — travel-aware", () => {
  const STARTED = "2026-05-25";
  const travelPlan: AppModePlan = {
    plan_period_start: STARTED,
    plan_period_weeks: 12,
    meal_plan_started_on: STARTED,
    status: "published",
  };
  // 10 days paused mid-protocol → the finish date moves 10 days later.
  const overrides: TravelOverrideLike[] = [
    { date_from: "2026-07-01", date_to: "2026-07-10", context: "travel", mode: "maintenance" },
  ];
  const opts = { overrides, weightLossEnabled: false };

  const BARE_FINISH = "2026-08-17"; // 2026-05-25 + 84d
  const PAUSED_FINISH = "2026-08-27"; // + the 10 paused days

  it("the pause really does move the finish date", () => {
    expect(effectiveRecheckDate(travelPlan)).toBe(BARE_FINISH);
    expect(effectiveRecheckDate(travelPlan, opts)).toBe(PAUSED_FINISH);
  });

  it("does NOT warn a traveller early — 3 days before the un-paused date, she has 13 to go", () => {
    const day = "2026-08-14";
    // Travel-blind, this is squarely inside the window and would have fired.
    expect(resolveFinalStretch("REVIEW", travelPlan, day)).not.toBeNull();
    // With her pause counted, she is 13 days out — no note.
    const { mode, note } = noteFor(travelPlan, day, opts);
    expect(mode).toBe("REVIEW");
    expect(note).toBeNull();
  });

  it("warns her at the right time, with her EXTENDED date", () => {
    const day = "2026-08-22"; // 5 days before the paused finish
    const { mode, note } = noteFor(travelPlan, day, opts);
    expect(mode).toBe("REVIEW");
    expect(note!.daysLeft).toBe(5);
    expect(note!.recheckDate).toBe(PAUSED_FINISH);
    expect(note!.recheckDate).not.toBe(BARE_FINISH);
  });

  it("cancelled travel does not extend anything", () => {
    const cancelled = [{ ...overrides[0], cancelled: true }];
    const day = addDays(BARE_FINISH, -3);
    const { note } = noteFor(travelPlan, day, { overrides: cancelled });
    expect(note?.recheckDate).toBe(BARE_FINISH);
  });
});

// ── The wiring the app actually reads ───────────────────────────────────────
describe("buildEndgame — endgame.finishingSoon", () => {
  it("carries a human date label in the final stretch", () => {
    const r = buildEndgame({}, planWithRecheck(2), TODAY);
    expect(r.mode).toBe("REVIEW");
    expect(r.endgame?.finishingSoon).toEqual({ daysLeft: 2, dateLabel: "22nd August 2026" });
  });

  it("is null outside the final stretch, and null once the date has passed", () => {
    expect(buildEndgame({}, planWithRecheck(10), TODAY).endgame?.finishingSoon).toBeNull();
    expect(buildEndgame({}, planWithRecheck(-2), TODAY).endgame?.finishingSoon).toBeNull();
  });

  it("passes travel overrides through, so the label is the client's real date", () => {
    const STARTED = "2026-05-25";
    const plan = {
      plan_period_start: STARTED,
      plan_period_weeks: 12,
      meal_plan_started_on: STARTED,
    };
    const opts = {
      overrides: [
        { date_from: "2026-07-01", date_to: "2026-07-10", context: "travel", mode: "maintenance" },
      ],
      weightLossEnabled: false,
    };
    // 2026-08-14 is 3 days before the un-paused finish — travel-blind it fires.
    expect(buildEndgame({}, plan, "2026-08-14").endgame?.finishingSoon).not.toBeNull();
    // With her pause, it stays quiet…
    expect(
      buildEndgame({}, plan, "2026-08-14", null, null, undefined, opts).endgame?.finishingSoon,
    ).toBeNull();
    // …and fires later, on the extended date.
    expect(
      buildEndgame({}, plan, "2026-08-22", null, null, undefined, opts).endgame?.finishingSoon,
    ).toEqual({ daysLeft: 5, dateLabel: "27th August 2026" });
  });

  it("short engagements get the note too (their REVIEW lead is already 7 days)", () => {
    const r = buildEndgame({}, planWithRecheck(4, 4), TODAY);
    expect(r.endgame?.shortEngagement).toBe(true);
    expect(r.endgame?.finishingSoon?.daysLeft).toBe(4);
  });
});
