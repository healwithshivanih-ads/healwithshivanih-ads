/**
 * Pins all four chip outcomes, and specifically that "unavailable" is not
 * "hide". A test that only checks "the chip appears when there are findings"
 * passes happily under the one-token narrowing that reintroduces the bug —
 * see the note in guardrail-chip-view.ts.
 */
import { describe, it, expect } from "vitest";
import { chipView } from "./guardrail-chip-view";

describe("guardrail chip view", () => {
  it("renders nothing while still loading", () => {
    expect(chipView(null)).toBe("loading");
  });

  it("stays quiet when the scan succeeded with nothing actionable", () => {
    // The normal state, and the one the chip must keep hiding for: a ratchet
    // with zero NEW findings is good news, not an alarm.
    expect(chipView({ status: "ok", actionable: 0 })).toBe("hide");
  });

  it("alarms when the scan found something", () => {
    expect(chipView({ status: "ok", actionable: 1 })).toBe("alarm");
    expect(chipView({ status: "ok", actionable: 47 })).toBe("alarm");
  });

  it("does NOT hide when the scan could not run", () => {
    // The whole point. `unavailable` must be its own outcome — if this ever
    // returns "hide", a broken scan is once again indistinguishable from a
    // clean catalogue, which is the defect this work exists to remove.
    expect(chipView({ status: "unavailable" })).toBe("unavailable");
    expect(chipView({ status: "unavailable" })).not.toBe("hide");
    expect(chipView({ status: "unavailable" })).not.toBe("loading");
  });
});
