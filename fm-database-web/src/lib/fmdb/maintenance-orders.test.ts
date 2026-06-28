import { describe, it, expect } from "vitest";
import {
  maintenancePrice,
  extendPaidThrough,
  buildMaintenanceOrder,
  MAINTENANCE_PRICING,
} from "./maintenance-orders";

describe("maintenancePrice — server-fixed, never client-trusted", () => {
  it("6-month block is ₹12,000", () => {
    expect(maintenancePrice(6)).toBe(12000);
    expect(MAINTENANCE_PRICING[6]).toBe(12000);
  });
  it("1-month top-up is ₹2,000", () => {
    expect(maintenancePrice(1)).toBe(2000);
  });
  it("an unoffered term has no price", () => {
    expect(maintenancePrice(3)).toBeNull();
    expect(maintenancePrice(12)).toBeNull();
  });
});

describe("extendPaidThrough — early renewals stack", () => {
  it("no existing coverage → today + term", () => {
    expect(extendPaidThrough(null, "2026-07-01", 6)).toBe("2027-01-01");
  });
  it("lapsed coverage (past) anchors at today, not the old date", () => {
    expect(extendPaidThrough("2026-01-01", "2026-07-01", 6)).toBe("2027-01-01");
  });
  it("active coverage (future) stacks on top of remaining time", () => {
    expect(extendPaidThrough("2026-09-01", "2026-07-01", 6)).toBe("2027-03-01");
  });
  it("clamps a short target month (31 Aug + 6mo → end of Feb)", () => {
    expect(extendPaidThrough(null, "2026-08-31", 6)).toBe("2027-02-28");
  });
});

describe("buildMaintenanceOrder", () => {
  it("builds a pending order with the fixed price + computed paid-through", () => {
    const r = buildMaintenanceOrder("maint-2026-07-01-01", "cl-007", 6, "2026-08-01", "2026-07-01", "2026-07-01T00:00:00Z");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.order.amount_inr).toBe(12000);
    expect(r.order.status).toBe("pending");
    expect(r.order.kind).toBe("maintenance");
    expect(r.order.paid_through).toBe("2027-02-01"); // stacked on existing 2026-08-01
  });
  it("refuses an unoffered term", () => {
    const r = buildMaintenanceOrder("x", "cl-007", 3, null, "2026-07-01", "2026-07-01T00:00:00Z");
    expect(r.ok).toBe(false);
  });
});
