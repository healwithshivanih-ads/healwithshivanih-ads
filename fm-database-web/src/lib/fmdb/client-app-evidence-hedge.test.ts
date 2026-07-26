/**
 * Tests for stripEvidenceHedging — the guard against coach evidence-tier
 * hedging leaking to the client app. Caught live on cl-022 in two places at
 * once (a practice `details` and a supplement `coach_rationale`), which is
 * what made this a shared, tested function rather than a one-off edit.
 */
import { describe, it, expect } from "vitest";
import { stripEvidenceHedging } from "./client-app-evidence-hedge";

describe("stripEvidenceHedging", () => {
  it("drops the real seed-mix leak sentence, keeps the rest", () => {
    const raw =
      "Run this DAILY rather than as strict cycle-phase seed cycling. " +
      "Two reasons: the phase-timing protocol is thin on evidence, and your " +
      "cycle is now 23 days and actively shortening, so timing seeds to cycle " +
      "day is unreliable in practice. The seeds themselves are what does the " +
      "work — flax lignans modulate oestrogen.";
    const out = stripEvidenceHedging(raw);
    expect(out).not.toMatch(/thin on evidence/i);
    expect(out).toContain("Run this DAILY");
    expect(out).toContain("flax lignans modulate oestrogen");
  });

  it("drops the real calcium-d-glucarate leak sentence", () => {
    const raw =
      "CDG inhibits that enzyme, so what the liver clears actually leaves. " +
      "Evidence tier plausible_emerging — trial it for 12 weeks and judge on " +
      "your bleed heaviness and pre-period symptoms, not on a lab number.";
    const out = stripEvidenceHedging(raw);
    expect(out).not.toMatch(/evidence.tier/i);
    expect(out).not.toMatch(/plausible.emerging/i);
    expect(out).toContain("CDG inhibits that enzyme");
  });

  it("catches literal catalogue enum leakage", () => {
    expect(stripEvidenceHedging("Tagged confirm_with_clinician in the catalogue.")).toBe("");
    expect(stripEvidenceHedging("Catalogue tier fm_specific_thin for now.")).toBe("");
  });

  it("catches phrasal hedges", () => {
    expect(stripEvidenceHedging("The evidence here is thin honestly.")).toBe("");
    expect(stripEvidenceHedging("This has limited evidence behind it.")).toBe("");
    expect(stripEvidenceHedging("Confirm with your clinician before starting.")).toBe("");
  });

  it("never touches text with no hedging language", () => {
    const clean = "Take 1 capsule daily with breakfast. It supports methylation.";
    expect(stripEvidenceHedging(clean)).toBe(clean);
  });

  it("does not false-positive on ordinary clinical vocabulary", () => {
    // Regression guard: "established" alone, "evident", "based on" etc. must survive.
    const cases = [
      "This is a well-established first-line approach for sleep.",
      "It is evident from her journal that breakfast protein is low.",
      "Based on her labs, magnesium is the priority.",
    ];
    for (const c of cases) expect(stripEvidenceHedging(c)).toBe(c);
  });

  it("does not false-positive on affirmative use of 'evidence' (word-gap regex risk)", () => {
    // The word-gap pattern (evidence…thin/limited/weak/insufficient within 3
    // words) is the widest rule here — specifically adversarial-test it so a
    // genuinely positive sentence naming "evidence" can never be swept up.
    const cases = [
      "The evidence here strongly supports magnesium for sleep.",
      "Good evidence backs omega-3 for inflammation in her case.",
      "There is solid evidence this helps with dry mouth.",
    ];
    for (const c of cases) expect(stripEvidenceHedging(c)).toBe(c);
  });
});
