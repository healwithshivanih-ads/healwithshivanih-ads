/**
 * Tests for the two client-facing text pipelines.
 *
 * These could not be tested at all until 2026-08-09 — they lived in
 * client-app.ts, which is `server-only`. That is precisely how a mangled
 * pronoun and a coach stage direction reached cl-022's magnesium card and sat
 * there. The cases below are drawn from REAL leaks found on real plans.
 */
import { describe, it, expect } from "vitest";
import { clientifyWhy, clientifyPracticeDetail, clientFacingWhy } from "./client-app-clientify";

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

describe("clientFacingWhy — walk to the first sentence that says something", () => {
  it("skips a bookkeeping opener and shows the real reason", () => {
    // cl-007's card opened "Already on this — continue." for weeks.
    const raw =
      "Already on this — continue. Compensates for the low enzyme output that " +
      "comes with your condition.";
    expect(clientFacingWhy(raw)).toBe(
      "Compensates for the low enzyme output that comes with your condition.",
    );
  });

  it("skips the openers a coach actually writes", () => {
    for (const opener of [
      "NEW in this session.",
      "TOP ADD this round.",
      "STEP-DOWN from 5 g twice daily.",
      "Continued at 1000mg/day.",
      "Stop pending CLARIFICATION.",
      "Three reasons converge for her.",
    ]) {
      const out = clientFacingWhy(`${opener} It settles your stomach after meals.`);
      expect(out, opener).toBe("It settles your stomach after meals.");
    }
  });

  it("keeps walking past a lab sentence to a client-safe one", () => {
    const raw =
      "NEW in this session. Her ferritin is 12 ng/mL, far below FM-optimal of 70-150. " +
      "Iron carries oxygen to every cell, which is where your energy comes from.";
    expect(clientFacingWhy(raw)).toBe(
      "Iron carries oxygen to every cell, which is where your energy comes from.",
    );
  });

  it("does NOT split a species abbreviation into its own sentence", () => {
    // "Sova GMT found B. longum 0.059%" rendered as the sentence "Sova GMT found B."
    const out = clientFacingWhy("Sova GMT found B. longum depleted. Rebuilds that population.");
    expect(out).not.toBe("Sova GMT found B.");
    expect(out).toBe("Rebuilds that population.");
  });

  it("returns nothing when every sentence is coach-only", () => {
    expect(clientFacingWhy("NEW in this session. Her TSH is 6.2 mIU/L.")).toBe("");
  });

  it("keeps a terse sentence that is genuinely an answer", () => {
    // Deliberately not length-based — these are answers, not bookkeeping.
    for (const s of ["Protein top-up.", "Food-sourced, not a capsule."]) {
      expect(clientFacingWhy(s), s).toBe(s);
    }
  });

  it("never lets the newly-reachable leaks through", () => {
    // Each of these sat in sentence 2+, so walking forward is what exposed them.
    for (const raw of [
      "NEW. Curcumin inhibits NF-κB (reducing TPO/TgAb autoimmune signalling) and lowers hsCRP.",
      "NEW. Mushroom is explicitly listed in Manju's foods_to_avoid.",
      "NEW. Corrects your low-normal zinc (75.68) and elevated Cu:Zn (1.58).",
    ]) {
      expect(clientFacingWhy(raw), raw).toBe("");
    }
  });

  it("never opens on punctuation left behind by a removal", () => {
    // "(1) Homocysteine 20.79 — endogenous creatine synthesis…" lost its first
    // half and reached Nazneen's card as "— endogenous creatine synthesis…".
    const out = clientFacingWhy(
      "Three reasons converge for her. (1) Homocysteine 20.79 — it spares your methylation capacity.",
    );
    expect(out === "" || /^[A-Za-z0-9"'(]/.test(out)).toBe(true);
  });

  it("drops a percentage readout, which is a lab value without units", () => {
    // "Ferritin 12 + transferrin sat 16.3% = iron-deficient erythropoiesis"
    // lost its ferritin value and still carried the saturation.
    expect(
      clientFacingWhy("Ferritin 12 + transferrin sat 16.3% = iron-deficient erythropoiesis."),
    ).toBe("");
  });

  it("handles empty and undefined safely", () => {
    expect(clientFacingWhy("")).toBe("");
    expect(clientFacingWhy(undefined as unknown as string)).toBe("");
  });
});
