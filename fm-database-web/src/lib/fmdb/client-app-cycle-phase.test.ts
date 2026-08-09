/** The client-facing cycle card must never show a phase it is guessing.
 *
 *  The bug this pins, found during the 2026-08-09 smoke test: the card
 *  rendered on ANY non-null phase, so six of seven cycling clients on the
 *  roster would have been shown a phase extrapolated from a 70-99 day old
 *  period date — one of them "Menstrual — day 3" from a 25-day-old date on
 *  an irregular cycle, i.e. told she was bleeding when she likely was not.
 *  cycle_day is a modulo, so a stale date always looks plausible.
 *
 *  The coach's chip may show low-confidence phases (she can act on them and
 *  refresh the date). The client's card may not. Every other phase-keyed
 *  surface already gates on confidence === "high"; this test keeps this one
 *  in line with them.
 */
import { describe, expect, it } from "vitest";

import { computeCyclePhaseCard } from "./client-app";

const TODAY = new Date("2026-08-09T00:00:00Z");

const female = (over: Record<string, unknown>) => ({
  sex: "F",
  cycle_status: "menstruating",
  cycle_length_days: 28,
  cycle_regularity: "regular",
  ...over,
});

describe("computeCyclePhaseCard — high confidence only", () => {
  it("shows the card for a fresh, regular cycle", () => {
    const card = computeCyclePhaseCard(
      female({ last_menstrual_period: "2026-07-28" }), // 12 days ago
      TODAY,
    );
    expect(card).not.toBeNull();
    // day 13 of 28 → 13/28 = 0.464, past the 0.45 follicular edge
    expect(card!.phase).toBe("ovulatory");
    expect(card!.dayInCycle).toBe(13);
    expect(card!.estimate).toBe(false);
  });

  it("hides the card when the period date is stale (the live bug)", () => {
    // 96 days on a 29-day cycle — modulo makes this look like a tidy day 10.
    const card = computeCyclePhaseCard(
      female({ last_menstrual_period: "2026-05-05", cycle_length_days: 29 }),
      TODAY,
    );
    expect(card).toBeNull();
  });

  it("hides the card for an irregular cycle", () => {
    const card = computeCyclePhaseCard(
      female({
        last_menstrual_period: "2026-07-28",
        cycle_regularity: "irregular",
      }),
      TODAY,
    );
    expect(card).toBeNull();
  });

  it("hides the card in perimenopause (phase is not dependable there)", () => {
    const card = computeCyclePhaseCard(
      female({
        cycle_status: "perimenopausal",
        last_menstrual_period: "2026-07-28",
      }),
      TODAY,
    );
    expect(card).toBeNull();
  });

  it("hides the card post-menopause, for men, and with no period date", () => {
    expect(
      computeCyclePhaseCard(female({ cycle_status: "postmenopausal" }), TODAY),
    ).toBeNull();
    expect(
      computeCyclePhaseCard(
        { sex: "M", cycle_status: "menstruating", last_menstrual_period: "2026-07-28" },
        TODAY,
      ),
    ).toBeNull();
    expect(computeCyclePhaseCard(female({}), TODAY)).toBeNull();
  });

  it("hides the card when pregnant or lactating, even on a stale status", () => {
    expect(
      computeCyclePhaseCard(
        female({
          last_menstrual_period: "2026-07-28",
          pregnancy_status: "pregnant_first_trimester",
        }),
        TODAY,
      ),
    ).toBeNull();
    expect(
      computeCyclePhaseCard(
        female({ last_menstrual_period: "2026-07-28", lactation_started: "2026-06-01" }),
        TODAY,
      ),
    ).toBeNull();
  });

  it("never marks a shown card as an estimate", () => {
    const card = computeCyclePhaseCard(
      female({ last_menstrual_period: "2026-08-01" }),
      TODAY,
    );
    expect(card!.estimate).toBe(false);
  });
});
