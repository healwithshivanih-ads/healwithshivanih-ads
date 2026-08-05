/**
 * Tests for the plan-derived push reminders.
 *
 * This module had no coverage at all, which is why it could drift: it carried a
 * private copy of the timing keyword table whose bare "am" matched " amla" and
 * whose "1 pm" matched inside "11 pm", so a 22:00 dose earned a 13:00 push.
 * Reminders are the one surface a client can't sanity-check against the app —
 * the notification just arrives — so the agreement asserted at the bottom
 * (reminder bucket vs the slot the app renders) is the point of this file.
 */
import { describe, it, expect } from "vitest";
import { deriveReminders, effectiveReminders, EARLIEST_TIME } from "./reminders-derive";
import { timingSlot } from "./client-app-format";

const plan = (...timings: string[]) => ({
  supplement_protocol: timings.map((timing) => ({ supplement_slug: "x", timing })),
});
const CLIENT = { client_id: "test-client" };

/** The supplement reminders only, in id order — the tree/check-in rows are
 *  scheduling policy, not timing parsing, and would just add noise here. */
function suppTimes(...timings: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of deriveReminders(plan(...timings), CLIENT)) {
    if (r.id === "supp-am" || r.id === "supp-pm") out[r.id] = r.time;
  }
  return out;
}

describe("deriveReminders — supplement buckets", () => {
  it("splits the protocol into a morning and an evening reminder", () => {
    expect(suppTimes("with breakfast", "with dinner")).toEqual({
      "supp-am": "08:00",
      "supp-pm": "19:00",
    });
  });

  it("fires each bucket at its EARLIEST occupied slot", () => {
    // Two morning doses → the reminder lands on the first, not the last.
    expect(suppTimes("mid-morning", "with breakfast")["supp-am"]).toBe("08:00");
    expect(suppTimes("before bed", "with dinner")["supp-pm"]).toBe("19:00");
  });

  it("omits a bucket the plan does not use", () => {
    expect(suppTimes("with breakfast")).toEqual({ "supp-am": "08:00" });
    expect(suppTimes("at bedtime")).toEqual({ "supp-pm": "21:30" });
    expect(suppTimes()).toEqual({});
  });

  it("never schedules before the coach's earliest-allowed time", () => {
    // Slot 0 is 06:30 in the table and must be floored to 07:30.
    expect(suppTimes("on waking, empty stomach")["supp-am"]).toBe(EARLIEST_TIME);
  });

  it("is not fooled by a time word inside another word", () => {
    // The private keyword table matched by substring: " amla" contains " am"
    // (→ an 08:00 push for a dose with no stated time) and "11 pm" contains
    // "1 pm" (→ a 13:00 push for a 22:00 dose).
    expect(suppTimes("5 g amla powder in warm water")["supp-am"]).toBe("08:00"); // default, not a claim
    expect(suppTimes("11 pm")).toEqual({ "supp-pm": "21:30" });
    expect(suppTimes("Afternoon")).toEqual({ "supp-pm": "15:30" });
  });

  it("slots on the primary clause, not a separation caveat", () => {
    // The caveat names the dose this one must stay AWAY from. If its time words
    // win, the client is pushed to take iron beside the levothyroxine.
    expect(suppTimes("Early afternoon — at least 4 hours after your morning Thyronorm")).toEqual({
      "supp-pm": "15:30",
    });
  });

  it("pushes for the EARLIER dose of a twice-daily supplement", () => {
    expect(suppTimes("with dinner and before bed")["supp-pm"]).toBe("19:00");
    expect(suppTimes("morning and before bed")["supp-am"]).toBe("08:00");
  });
});

describe("effectiveReminders", () => {
  it("honours a client's pinned time, still floored to the earliest allowed", () => {
    const derived = deriveReminders(plan("with breakfast"), CLIENT);
    const am = effectiveReminders(derived, { "supp-am": { time: "06:00", time_custom: true } }).find(
      (r) => r.id === "supp-am",
    );
    expect(am).toMatchObject({ time: EARLIEST_TIME, timeCustom: true, on: true });
  });

  it("lets the client switch a reminder off", () => {
    const derived = deriveReminders(plan("with breakfast"), CLIENT);
    const am = effectiveReminders(derived, { "supp-am": { on: false } }).find((r) => r.id === "supp-am");
    expect(am?.on).toBe(false);
  });
});

describe("a reminder never fires at a time the app does not show", () => {
  // The whole reason the timing parser was consolidated. Both surfaces now read
  // timingSlot(), so the bucket a push belongs to is derivable from the slot the
  // client sees on their card — assert they cannot disagree.
  it("buckets AM/PM exactly as the app's rendered slot does", () => {
    for (const t of [
      "on waking, empty stomach",
      "with breakfast",
      "mid-morning",
      "with lunch",
      "Afternoon",
      "with dinner",
      "before bed",
      "11 pm",
      "Evening, with dinner or at bedtime",
      "Early afternoon — at least 4 hours after your morning Thyronorm",
    ]) {
      const { slot } = timingSlot(t);
      const ids = deriveReminders(plan(t), CLIENT).map((r) => r.id);
      expect(ids, t).toContain(slot <= 3 ? "supp-am" : "supp-pm");
      expect(ids, t).not.toContain(slot <= 3 ? "supp-pm" : "supp-am");
    }
  });
});

describe("deriveReminders — MSQ score-check nudge", () => {
  const msq = (lastMsqDate: string | null, todayIso: string) =>
    deriveReminders(plan("with breakfast"), CLIENT, { lastMsqDate, todayIso }).find((r) => r.id === "msq");

  it("stays quiet while the retake window is closed", () => {
    expect(msq("2026-08-01", "2026-08-10")).toBeUndefined(); // day 9
    expect(msq("2026-08-01", "2026-08-21")).toBeUndefined(); // day 20
  });

  it("fires for the first 3 days of an open window, then goes quiet", () => {
    expect(msq("2026-08-01", "2026-08-22")).toBeDefined(); // day 21 — opens
    expect(msq("2026-08-01", "2026-08-24")).toBeDefined(); // day 23 — last nudge
    expect(msq("2026-08-01", "2026-08-25")).toBeUndefined(); // day 24 — silent
  });

  it("never fires without a baseline — the card's CTA owns that ask", () => {
    expect(msq(null, "2026-08-22")).toBeUndefined();
  });

  it("rides above the standing-reminder cap instead of displacing one", () => {
    const all = deriveReminders(plan("with breakfast", "with dinner"), CLIENT, {
      lastMsqDate: "2026-08-01",
      todayIso: "2026-08-22",
    });
    const ids = all.map((r) => r.id);
    expect(ids).toContain("supp-am");
    expect(ids).toContain("supp-pm");
    expect(ids).toContain("checkin");
    expect(ids).toContain("msq");
  });
});
