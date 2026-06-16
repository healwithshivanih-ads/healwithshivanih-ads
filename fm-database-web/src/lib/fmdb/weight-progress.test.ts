import { describe, it, expect } from "vitest";
import { assessWeightProgress, collectWeightSeries, estimateObservedTdee } from "./weight-progress";

const TODAY = "2026-06-15";

function addDays(ymd: string, n: number): string {
  const d = new Date(ymd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Goal: lose 6 kg over 12 weeks from 80 kg → expected ~0.5 kg/wk.
function goal(extra: Record<string, unknown> = {}) {
  const start = addDays(TODAY, -42); // started 6 weeks ago
  return {
    enabled: true,
    starting_weight_kg: 80,
    starting_date: start,
    goal_kg: 6,
    goal_target_date: addDays(start, 84),
    pace: "moderate",
    ...extra,
  };
}

function snap(date: string, kg: number, source = "client_app") {
  return { date, source, measurements: { weight_kg: kg } };
}

describe("collectWeightSeries — unions all three sources", () => {
  it("merges health_snapshots + measurements_log + flat, dedupes by date", () => {
    const client = {
      health_snapshots: [snap("2026-05-01", 80), snap("2026-05-15", 79.2)],
      measurements_log: [{ date: "2026-05-15", weight_kg: 79.0 }], // log wins tie
      measurements: { measured_on: "2026-05-20", weight_kg: 78.5 },
    };
    const series = collectWeightSeries(client);
    expect(series.map((r) => r.date)).toEqual(["2026-05-01", "2026-05-15", "2026-05-20"]);
    expect(series.find((r) => r.date === "2026-05-15")?.kg).toBe(79.0); // log won
  });

  it("drops implausible weights", () => {
    const client = { health_snapshots: [snap("2026-05-01", 5), snap("2026-05-02", 78)] };
    expect(collectWeightSeries(client).map((r) => r.kg)).toEqual([78]);
  });
});

describe("assessWeightProgress — status decisions", () => {
  it("no_goal when goal absent / disabled / incomplete", () => {
    expect(assessWeightProgress({}, TODAY).status).toBe("no_goal");
    expect(assessWeightProgress({ weight_loss: { enabled: false } }, TODAY).status).toBe("no_goal");
    expect(
      assessWeightProgress({ weight_loss: { enabled: true, starting_weight_kg: 80 } }, TODAY).status,
    ).toBe("no_goal");
  });

  it("no_data when goal set but no weigh-ins after start", () => {
    const r = assessWeightProgress({ weight_loss: goal() }, TODAY);
    expect(r.status).toBe("no_data");
    expect(r.expectedWeeklyKg).toBeCloseTo(0.5, 1);
  });

  it("on_track when losing ~0.5 kg/wk", () => {
    const g = goal();
    // 6 weeks in, ~3 kg lost → bang on plan.
    const r = assessWeightProgress(
      { weight_loss: g, health_snapshots: [snap(addDays(TODAY, -2), 77.1)] },
      TODAY,
    );
    expect(r.status).toBe("on_track");
    expect(r.needsAttention).toBe(false);
  });

  it("behind when losing far less than expected", () => {
    const g = goal();
    // 6 weeks in, only 0.8 kg lost vs ~3 kg expected → behind.
    const r = assessWeightProgress(
      { weight_loss: g, health_snapshots: [snap(addDays(TODAY, -1), 79.2)] },
      TODAY,
    );
    expect(r.status).toBe("behind");
    expect(r.needsAttention).toBe(true);
    expect(r.attainmentPct).toBeLessThan(50);
  });

  it("plateau when recent weights are flat over ~3 weeks", () => {
    const g = goal();
    const r = assessWeightProgress(
      {
        weight_loss: g,
        health_snapshots: [
          snap(addDays(TODAY, -40), 79.5),
          snap(addDays(TODAY, -20), 78.0),
          snap(addDays(TODAY, -1), 77.95), // flat last ~3 weeks
        ],
      },
      TODAY,
    );
    expect(r.status).toBe("plateau");
    expect(r.needsAttention).toBe(true);
  });

  it("regain when weight is above start after a few weeks", () => {
    const g = goal();
    const r = assessWeightProgress(
      { weight_loss: g, health_snapshots: [snap(addDays(TODAY, -1), 80.8)] },
      TODAY,
    );
    expect(r.status).toBe("regain");
    expect(r.needsAttention).toBe(true);
  });

  it("too_early in the first couple of weeks", () => {
    const g = goal({ starting_date: addDays(TODAY, -7), goal_target_date: addDays(TODAY, 77) });
    const r = assessWeightProgress(
      { weight_loss: g, health_snapshots: [snap(addDays(TODAY, -1), 79.5)] },
      TODAY,
    );
    expect(r.status).toBe("too_early");
  });

  it("flags stale weigh-in even when the trend is fine", () => {
    const g = goal();
    // On-track value but last weigh-in 20 days ago.
    const r = assessWeightProgress(
      { weight_loss: g, health_snapshots: [snap(addDays(TODAY, -20), 77.0)] },
      TODAY,
    );
    expect(r.staleDays).toBe(20);
    expect(r.needsAttention).toBe(true);
  });
});

// Body needed for the Mifflin calorie model the estimator depends on.
function bodied(weight_loss: Record<string, unknown>, snaps: ReturnType<typeof snap>[]) {
  return {
    sex: "F",
    age_band: "50-55",
    measurements: { height_cm: 165, weight_kg: 80 },
    weight_loss,
    health_snapshots: snaps,
  };
}

describe("estimateObservedTdee — measured-burn reality check", () => {
  it("returns null before MIN_TDEE_WINDOW_DAYS of data", () => {
    const g = goal({ starting_date: addDays(TODAY, -5), goal_target_date: addDays(TODAY, 79) });
    expect(estimateObservedTdee(bodied(g, [snap(addDays(TODAY, -1), 79.6)]), TODAY)).toBeNull();
  });

  it("measures a real burn below the model for a behind-pace client", () => {
    const g = goal(); // started 6 wks ago, ~0.5 kg/wk plan
    // Only 0.8 kg lost in 6 weeks → real burn well below Mifflin prediction.
    const est = estimateObservedTdee(bodied(g, [snap(addDays(TODAY, -1), 79.2)]), TODAY);
    expect(est).not.toBeNull();
    expect(est!.observedTdee).toBeLessThan(est!.modelTdee);
    expect(est!.divergencePct).toBeLessThan(0);
    // Hitting 0.5 kg/wk would need to go under the 1200 floor.
    expect(est!.flooredAtMin).toBe(true);
    expect(est!.achievablePaceAtFloor).toBeGreaterThan(0);
    expect(est!.achievablePaceAtFloor).toBeLessThan(0.5);
  });

  it("recognises an already-applied override", () => {
    const est = estimateObservedTdee(
      bodied(goal(), [snap(addDays(TODAY, -1), 79.2)]),
      TODAY,
    );
    const applied = estimateObservedTdee(
      bodied({ ...goal(), tdee_override: est!.observedTdee }, [snap(addDays(TODAY, -1), 79.2)]),
      TODAY,
    );
    // With the override in place the model TDEE now equals it.
    expect(applied!.currentOverride).toBe(est!.observedTdee);
  });
});
