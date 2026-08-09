/**
 * Tests for the two client-facing text pipelines.
 *
 * These could not be tested at all until 2026-08-09 — they lived in
 * client-app.ts, which is `server-only`. That is precisely how a mangled
 * pronoun and a coach stage direction reached cl-022's magnesium card and sat
 * there. The cases below are drawn from REAL leaks found on real plans.
 */
import { describe, it, expect } from "vitest";
import { clientifyWhy, clientifyPracticeDetail } from "./client-app-clientify";

describe("clientifyWhy", () => {
  it("handles the cl-022 magnesium line end to end", () => {
    // Three bugs converged on this one sentence: a shouted opener, an object
    // "her" read as a possessive, and a coach stage direction.
    const raw =
      "REPLACES her Wellbeing triple magnesium complex — this is a swap, not a " +
      "removal, and it should be said to her that way.";
    expect(clientifyWhy(raw)).toBe(
      "Replaces your Wellbeing triple magnesium complex — this is a swap, not a removal.",
    );
  });

  it("converts the coach's third person to the reader's second", () => {
    expect(clientifyWhy("She keeps waking at 3am, so this goes at bedtime.")).toBe(
      "You keep waking at 3am, so this goes at bedtime.",
    );
  });

  it("drops the why ENTIRELY rather than leak a lab value", () => {
    // A supplement card with no rationale is strictly safer than one showing
    // the client's own results (mobile audit 2026-06-13).
    for (const raw of [
      "Her ferritin is 12 ng/mL, far below FM-optimal of 70-150.",
      "Anti-TPO antibodies elevated — supports the thyroid picture.",
      // NB: a drug-depletion line is REPHRASED rather than dropped — that is
      // deliberate and has its own test below.
    ]) {
      // Assert the WHOLE why is gone, not merely that the units are.
      // The looser version of this assertion accepted "Your ferritin is" —
      // a stub that still names the client's marker (found end-to-end
      // 2026-08-09, guarded by the stub rule in clientifyWhy).
      expect(clientifyWhy(raw), raw).toBe("");
    }
  });

  it("rewrites a drug-depletion clause without naming the medication", () => {
    const out = clientifyWhy("Telma 40 (ARB) depletes magnesium — replace it.");
    expect(out).not.toMatch(/Telma|ARB/i);
    expect(out.toLowerCase()).toContain("magnesium");
  });

  it("strips a coach change-log stamp from the front", () => {
    expect(clientifyWhy("FORM SWAP 2026-05-24 — glycinate is gentler on your gut.")).toBe(
      "Glycinate is gentler on your gut.",
    );
  });

  it("drops evidence hedging, which reads as 'we don't believe this'", () => {
    const out = clientifyWhy(
      "Take one at bedtime. Evidence tier plausible_emerging — trial it for 12 weeks.",
    );
    expect(out).not.toMatch(/evidence|plausible_emerging/i);
    expect(out).toContain("Take one at bedtime");
  });

  it("leaves already-clean client copy alone", () => {
    const s = "Supports the strength work you're already doing.";
    expect(clientifyWhy(s)).toBe(s);
  });
});

describe("clientifyPracticeDetail", () => {
  it("is a LIGHT scrub — multi-sentence instructions survive in full", () => {
    const raw =
      "Walk for 10 minutes after every meal.\nKeep the pace easy — you should be able to talk.";
    expect(clientifyPracticeDetail(raw)).toBe(raw);
  });

  it("preserves line breaks, because bulleted steps render on their own lines", () => {
    const out = clientifyPracticeDetail("Step one\nStep two\nStep three");
    expect(out.split("\n")).toHaveLength(3);
  });

  it("still strips the coach-only layers", () => {
    const out = clientifyPracticeDetail(
      "UPDATE 2026-05-24 — She should walk after dinner. Tell her it isn't a punishment.",
    );
    expect(out).not.toMatch(/UPDATE|2026-05-24|Tell her/i);
    expect(out).toContain("walk after dinner");
    expect(out).toMatch(/^You should walk/);
  });

  it("handles empty and undefined safely", () => {
    expect(clientifyPracticeDetail("")).toBe("");
    expect(clientifyPracticeDetail(undefined as unknown as string)).toBe("");
  });
});
