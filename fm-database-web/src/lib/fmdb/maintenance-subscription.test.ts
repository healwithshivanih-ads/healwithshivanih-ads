import { describe, it, expect } from "vitest";
import { epochSecToYmd, subscriptionEventOutcome, dropBackwardPaidThrough } from "./maintenance-subscription";

describe("epochSecToYmd — Razorpay current_end is epoch SECONDS", () => {
  it("converts seconds (not ms) to a UTC date", () => {
    // 2027-01-01T00:00:00Z = 1798761600 s
    expect(epochSecToYmd(1798761600)).toBe("2027-01-01");
  });
  it("rejects non-numbers / zero / negatives", () => {
    expect(epochSecToYmd(undefined)).toBeNull();
    expect(epochSecToYmd("1798761600")).toBeNull();
    expect(epochSecToYmd(0)).toBeNull();
    expect(epochSecToYmd(-5)).toBeNull();
  });
});

const NOW = "2026-07-01T00:00:00.000Z";

describe("subscriptionEventOutcome", () => {
  it("subscription.charged → active + paid_through from current_end + payment id", () => {
    const ev = {
      event: "subscription.charged",
      payload: {
        subscription: { entity: { id: "sub_X", current_end: 1798761600, notes: { client_id: "cl-007" } } },
        payment: { entity: { id: "pay_1" } },
      },
    };
    const o = subscriptionEventOutcome(ev, NOW);
    expect(o).not.toBeNull();
    expect(o!.subscriptionId).toBe("sub_X");
    expect(o!.clientIdFromNotes).toBe("cl-007");
    expect(o!.paymentId).toBe("pay_1");
    expect(o!.patch.status).toBe("active");
    expect(o!.patch.paid_through).toBe("2027-01-01");
    expect(o!.patch.last_payment_id).toBe("pay_1");
  });

  it("subscription.halted → status only, NEVER touches paid_through (coverage lapses naturally)", () => {
    const o = subscriptionEventOutcome(
      { event: "subscription.halted", payload: { subscription: { entity: { id: "sub_X" } } } },
      NOW,
    );
    expect(o!.patch.status).toBe("halted");
    expect("paid_through" in o!.patch).toBe(false);
    expect(o!.paymentId).toBeNull();
  });

  it("subscription.cancelled / activated / pending map to their statuses", () => {
    expect(subscriptionEventOutcome({ event: "subscription.cancelled", payload: { subscription: { entity: { id: "s" } } } }, NOW)!.patch.status).toBe("cancelled");
    expect(subscriptionEventOutcome({ event: "subscription.activated", payload: { subscription: { entity: { id: "s" } } } }, NOW)!.patch.status).toBe("active");
    expect(subscriptionEventOutcome({ event: "subscription.pending", payload: { subscription: { entity: { id: "s" } } } }, NOW)!.patch.status).toBe("pending");
  });

  it("untracked events → null", () => {
    expect(subscriptionEventOutcome({ event: "payment.captured", payload: {} }, NOW)).toBeNull();
    expect(subscriptionEventOutcome({ event: "order.paid", payload: {} }, NOW)).toBeNull();
  });

  it("missing subscription id → null (can't act)", () => {
    expect(subscriptionEventOutcome({ event: "subscription.charged", payload: { subscription: { entity: {} } } }, NOW)).toBeNull();
  });
});

describe("dropBackwardPaidThrough — coverage never regresses on stale redelivery", () => {
  it("drops an OLDER paid_through, keeps status/last_payment_id move", () => {
    const patch = { status: "active" as const, paid_through: "2026-10-01", last_payment_id: "pay_old" };
    dropBackwardPaidThrough(patch, "2027-01-01"); // current coverage is already further out
    expect("paid_through" in patch).toBe(false);
    expect(patch.status).toBe("active");
    expect(patch.last_payment_id).toBe("pay_old");
  });
  it("keeps a NEWER paid_through (normal renewal advances)", () => {
    const patch = { status: "active" as const, paid_through: "2027-04-01" };
    dropBackwardPaidThrough(patch, "2027-01-01");
    expect(patch.paid_through).toBe("2027-04-01");
  });
  it("keeps paid_through when there is no current coverage (first charge)", () => {
    const patch = { status: "active" as const, paid_through: "2027-01-01" };
    dropBackwardPaidThrough(patch, null);
    expect(patch.paid_through).toBe("2027-01-01");
  });
  it("equal date is treated as not-forward → dropped (idempotent re-deliver)", () => {
    const patch = { status: "active" as const, paid_through: "2027-01-01" };
    dropBackwardPaidThrough(patch, "2027-01-01");
    expect("paid_through" in patch).toBe(false);
  });
});
