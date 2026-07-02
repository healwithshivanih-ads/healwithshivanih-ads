import { describe, it, expect } from "vitest";
import {
  buildPaymentEvent,
  buildProgrammeCompletedEvent,
  buildActiveClientCountEvent,
  computeActiveClientCounts,
  countSignupsThisWeek,
  appendIfNew,
  type OutboxRow,
} from "./revenue-export";

const CLIENT = { client_id: "cl-007", email: "meghana@example.com", phone_e164: "919876543210" };

describe("buildPaymentEvent — deterministic event ids", () => {
  it("keys on the razorpay payment id when present", () => {
    const ev = buildPaymentEvent({
      product: "lab",
      amountPaisa: 1250000,
      razorpayPaymentId: "pay_ABC123",
      paidAt: "2026-07-02T09:00:00.000Z",
      client: CLIENT,
    });
    expect(ev.event_id).toBe("payment:pay_ABC123");
    expect(ev.event_type).toBe("payment");
    expect(ev.data).toMatchObject({
      product: "lab",
      amount_paisa: 1250000,
      currency: "INR",
      razorpay_payment_id: "pay_ABC123",
      client: CLIENT,
    });
  });

  it("falls back to a manual key (client + day + product) without a rzp id", () => {
    const ev = buildPaymentEvent({
      product: "maintenance",
      amountPaisa: 1000000,
      paidAt: "2026-07-02T09:00:00.000Z",
      client: CLIENT,
    });
    expect(ev.event_id).toBe("payment:manual:cl-007:2026-07-02:maintenance");
    expect(ev.data).toMatchObject({ razorpay_payment_id: null });
  });
});

describe("buildProgrammeCompletedEvent", () => {
  it("keys on the plan slug — one completion per plan, ever", () => {
    const ev = buildProgrammeCompletedEvent({
      planSlug: "meghana-plan-1-2026-04-02-cl-007",
      completedAt: "2026-07-02T10:00:00.000Z",
      client: CLIENT,
    });
    expect(ev.event_id).toBe("programme_completed:meghana-plan-1-2026-04-02-cl-007");
    expect(ev.data).toMatchObject({ plan_slug: "meghana-plan-1-2026-04-02-cl-007" });
  });
});

describe("buildActiveClientCountEvent", () => {
  const breakdown = { active_care: 9, awaiting_start: 1, onboarding: 2, maintenance: 4 };
  const config = { maxActiveClients: 100, maxNewSignupsPerWeek: 20, discoveryCallsPerWeek: 8 };

  it("carries both capacity dimensions: total load (100 cap) + weekly signup throttle (20/wk)", () => {
    const ev = buildActiveClientCountEvent(breakdown, 5, config, "2026-07-02T10:00:00.000Z");
    expect(ev.data).toMatchObject({
      active_clients: 12,
      max_active_clients: 100,
      signups_this_week: 5,
      max_new_signups_per_week: 20,
      discovery_calls_per_week: 8,
      breakdown,
      as_of: "2026-07-02T10:00:00.000Z",
    });
  });

  it("event id is IST-minute-keyed (dedupes double fires, allows several/day)", () => {
    // 10:00:30 UTC = 15:30:30 IST
    const ev = buildActiveClientCountEvent(breakdown, 0, config, "2026-07-02T10:00:30.000Z");
    expect(ev.event_id).toBe("active_client_count:2026-07-02T15:30");
    const again = buildActiveClientCountEvent(breakdown, 0, config, "2026-07-02T10:00:59.000Z");
    expect(again.event_id).toBe(ev.event_id);
    const later = buildActiveClientCountEvent(breakdown, 0, config, "2026-07-02T10:01:10.000Z");
    expect(later.event_id).not.toBe(ev.event_id);
  });
});

describe("countSignupsThisWeek — the weekly intake throttle metric", () => {
  const NOW = "2026-07-02T10:00:00.000Z";

  it("counts programme enrolments in the trailing 7 days", () => {
    const clients = [
      { client_id: "cl-1", programme_started_at: "2026-06-28T09:00:00.000Z" }, // in window
      { client_id: "cl-2", programme_started_at: "2026-06-20T09:00:00.000Z" }, // too old
      // manual enrolment: created this week, already signed up
      { client_id: "cl-3", engagement_status: "signed_up", created_at: "2026-07-01T09:00:00.000Z" },
      // created this week but still a prospect — not a signup
      { client_id: "cl-4", created_at: "2026-07-01T09:00:00.000Z" },
      // declined never counts
      { client_id: "cl-5", engagement_status: "declined", programme_started_at: "2026-07-01T09:00:00.000Z" },
    ];
    expect(countSignupsThisWeek(clients, NOW)).toBe(2);
  });

  it("empty roster → zero", () => {
    expect(countSignupsThisWeek([], NOW)).toBe(0);
  });
});

describe("computeActiveClientCounts", () => {
  const TODAY = "2026-07-02";
  const started = { plan_period_start: "2026-06-01", meal_plan_started_on: "2026-06-04" };
  const future = { plan_period_start: "2026-07-10" };

  it("splits committed clients into active_care / awaiting_start / onboarding", () => {
    const clients = [
      { client_id: "cl-1" }, // published + started
      { client_id: "cl-2" }, // published, starts next week
      { client_id: "cl-3", lifecycle_state: "programme_active" }, // paid, no plan yet
      { client_id: "cl-4", engagement_status: "signed_up" }, // enrolled, no plan yet
      { client_id: "cl-5" }, // prospect — not counted
    ];
    const plans = [
      { client_id: "cl-1", slug: "a-plan-1", _bucket: "published", ...started },
      { client_id: "cl-2", slug: "b-plan-1", _bucket: "published", ...future },
    ];
    expect(computeActiveClientCounts(clients, plans, TODAY)).toEqual({
      active_care: 1,
      awaiting_start: 1,
      onboarding: 2,
      maintenance: 0,
    });
  });

  it("maintenance clients + alumni are reported but off the cap", () => {
    const clients = [
      { client_id: "cl-1", maintenance_status: "active" },
      { client_id: "cl-2" }, // graduated plan only → alumni
      { client_id: "cl-3" }, // published maintenance plan only
    ];
    const plans = [
      { client_id: "cl-1", slug: "a-plan-1", _bucket: "published", ...started },
      { client_id: "cl-2", slug: "b-plan-1", _bucket: "graduated", ...started },
      { client_id: "cl-3", slug: "c-maintenance-2026-06-01", _bucket: "published", ...started },
    ];
    expect(computeActiveClientCounts(clients, plans, TODAY)).toEqual({
      active_care: 0,
      awaiting_start: 0,
      onboarding: 0,
      maintenance: 3,
    });
  });

  it("declined clients never count", () => {
    const clients = [{ client_id: "cl-1", engagement_status: "declined" }];
    const plans = [{ client_id: "cl-1", slug: "a-plan-1", _bucket: "published", ...started }];
    expect(computeActiveClientCounts(clients, plans, TODAY)).toEqual({
      active_care: 0,
      awaiting_start: 0,
      onboarding: 0,
      maintenance: 0,
    });
  });
});

describe("appendIfNew — outbox idempotency", () => {
  const ev = buildPaymentEvent({
    product: "lab",
    amountPaisa: 100,
    razorpayPaymentId: "pay_X",
    paidAt: "2026-07-02T09:00:00.000Z",
    client: CLIENT,
  });

  it("appends a pending row once, then dedupes on event_id", () => {
    const first = appendIfNew([], ev, "2026-07-02T09:00:01.000Z");
    expect(first.added).toBe(true);
    expect(first.rows).toHaveLength(1);
    expect(first.rows[0]).toMatchObject({ status: "pending", attempts: 0 });

    const second = appendIfNew(first.rows as OutboxRow[], ev, "2026-07-02T09:05:00.000Z");
    expect(second.added).toBe(false);
    expect(second.rows).toHaveLength(1);
  });

  it("dedupes even against already-sent rows (a sent fact never re-sends)", () => {
    const sent: OutboxRow[] = [
      { ...ev, status: "sent", attempts: 1, created_at: "2026-07-01T00:00:00Z", sent_at: "2026-07-01T00:00:01Z" },
    ];
    expect(appendIfNew(sent, ev, "2026-07-02T09:00:00Z").added).toBe(false);
  });
});
