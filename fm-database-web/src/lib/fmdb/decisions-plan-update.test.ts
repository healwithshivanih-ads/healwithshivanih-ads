/**
 * A drafted plan-update email lists only when it can still mean something.
 *
 * Found 2026-11-04: the 07:30 digest had been listing ten "plan updates to
 * send" since August, and nothing on the dashboard let the coach send or
 * dismiss one. Of the ten, two were for a plan that had since been replaced,
 * two for clients who had lapsed, and most were weeks old. These tests pin the
 * three exits: not in care, not the live plan, older than the cap.
 */
import { describe, it, expect } from "vitest";
import { collectDecisions, PLAN_UPDATE_MAX_AGE_DAYS, type DecisionInputs, type PlanUpdateLike } from "./decisions";
import type { Lifecycle, LifecycleState } from "./lifecycle";

const TODAY = "2026-11-04";

function life(state: LifecycleState, planSlug: string): Lifecycle {
  return {
    state,
    since: "2026-10-01",
    reason: "",
    planSlug,
    planEndsOn: null,
    daysSinceEnd: null,
    declined: false,
    optedOut: false,
    engagement: "signed_up",
  };
}

function run(planUpdates: PlanUpdateLike[], lifecycle: Map<string, Lifecycle>) {
  const input: DecisionInputs = {
    todayYmd: TODAY,
    lifecycle,
    nameOf: (id) => id,
    inbound: [],
    repliedTo: new Set(),
    renewals: [],
    followupDrafts: [],
    followupScheduled: [],
    followupUnanchored: [],
    winbackDrafts: [],
    winbackScheduled: [],
    notes: [],
    plateaued: [],
    regressed: [],
    feedback: [],
    archiveCandidates: [],
    planUpdates,
    onboardingStep: new Map(),
  };
  return collectDecisions(input);
}

const draft = (client_id: string, plan_slug: string, created_at: string): PlanUpdateLike => ({
  id: `pc-${client_id}-${created_at}`,
  client_id,
  client_name: client_id,
  plan_slug,
  created_at,
});

describe("plan_update decisions", () => {
  it("lists a fresh draft for the plan an in-care client is on", () => {
    const d = run([draft("a", "a-plan-1", "2026-11-03T02:00:00Z")], new Map([["a", life("active", "a-plan-1")]]));
    expect(d.filtered.planUpdates).toHaveLength(1);
    expect(d.counts.byKind.plan_update).toBe(1);
    expect(d.items[0].href).toBe("/dashboard-v2#plan-updates");
  });

  it("drops a draft for someone no longer in care", () => {
    const d = run([draft("a", "a-plan-1", "2026-11-03T02:00:00Z")], new Map([["a", life("lapsed", "a-plan-1")]]));
    expect(d.filtered.planUpdates).toHaveLength(0);
  });

  it("drops a draft for a plan that has been replaced", () => {
    const d = run([draft("a", "a-plan-1", "2026-11-03T02:00:00Z")], new Map([["a", life("maintenance", "a-maintenance")]]));
    expect(d.filtered.planUpdates).toHaveLength(0);
  });

  it("drops a draft older than the cap, keeps one on the cap", () => {
    expect(PLAN_UPDATE_MAX_AGE_DAYS).toBe(14);
    const onCap = "2026-10-21T02:00:00Z"; // exactly 14 days before TODAY
    const d = run(
      [draft("a", "a-plan-1", "2026-09-25T02:00:00Z"), draft("b", "b-plan-1", onCap)],
      new Map([
        ["a", life("active", "a-plan-1")],
        ["b", life("ending", "b-plan-1")],
      ]),
    );
    expect(d.filtered.planUpdates.map((x) => x.client_id)).toEqual(["b"]);
  });
});
