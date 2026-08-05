import { describe, it, expect } from "vitest";
import { diffPlanForClient, requiresReason, humaniseSlug } from "./plan-change-diff";
import { renderPlanChangeEmail } from "./plan-change-email";

const plan = (supps: unknown[] = [], practices: unknown[] = []) => ({
  supplement_protocol: supps,
  lifestyle_practices: practices,
});

describe("diffPlanForClient — the material/noise line", () => {
  it("catches a supplement being added, with its dose and timing", () => {
    // cl-013's real 4 Jul quick-edit.
    const before = plan([{ supplement_slug: "iron-bisglycinate", dose: "30 mg", timing: "Early afternoon" }]);
    const after = plan([
      { supplement_slug: "iron-bisglycinate", dose: "30 mg", timing: "Early afternoon" },
      { supplement_slug: "psyllium-husk", dose: "1 tsp (~5 g)", timing: "~30 min before dinner" },
    ]);
    const d = diffPlanForClient(before, after);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({
      kind: "supplement_added",
      label: "Psyllium Husk",
      dose: "1 tsp (~5 g)",
      timing: "~30 min before dinner",
    });
  });

  it("catches a timing change and reports it separately from dose", () => {
    // cl-013's real 26 Jun edit — iron moved clear of her Thyronorm.
    const before = plan([{ supplement_slug: "iron-bisglycinate", dose: "30 mg", timing: "With breakfast" }]);
    const after = plan([
      { supplement_slug: "iron-bisglycinate", dose: "30 mg", timing: "Early afternoon — at least 4 hours after Thyronorm" },
    ]);
    const d = diffPlanForClient(before, after);
    expect(d).toHaveLength(1);
    expect(d[0].kind).toBe("supplement_timing_changed");
    expect(d[0].to).toContain("4 hours");
  });

  it("IGNORES a rename-only practice edit", () => {
    // cl-013's real 26 Jun edit: "Adjusted practice 'Dim lights by 9:30pm' — name".
    // Punctuation and case differences are not a change of behaviour.
    const before = plan([], [{ name: "Dim lights by 9:30pm" }]);
    const after = plan([], [{ name: "Dim lights by 9:30 PM" }]);
    expect(diffPlanForClient(before, after)).toHaveLength(0);
  });

  it("IGNORES coach-facing edits entirely", () => {
    const before = { ...plan([{ supplement_slug: "x", dose: "1", timing: "am" }]), notes_for_coach: "old" };
    const after = { ...plan([{ supplement_slug: "x", dose: "1", timing: "am" }]), notes_for_coach: "rewritten at length" };
    expect(diffPlanForClient(before, after)).toHaveLength(0);
  });

  it("IGNORES reordering", () => {
    const a = { supplement_slug: "a", dose: "1", timing: "am" };
    const b = { supplement_slug: "b", dose: "2", timing: "pm" };
    expect(diffPlanForClient(plan([a, b]), plan([b, a]))).toHaveLength(0);
  });

  it("raises nothing on first sight of a plan", () => {
    // A plan's initial contents are delivered by the plan itself.
    expect(diffPlanForClient(null, plan([{ supplement_slug: "x", dose: "1" }]))).toHaveLength(0);
  });

  it("catches stops for both supplements and practices", () => {
    const before = plan([{ supplement_slug: "creatine-monohydrate", dose: "300mg" }], [{ name: "EFT tapping" }]);
    const after = plan([], []);
    const d = diffPlanForClient(before, after);
    expect(d.map((x) => x.kind).sort()).toEqual(["practice_stopped", "supplement_stopped"]);
    expect(requiresReason(d)).toBe(true);
  });

  it("does not require a reason when nothing stops", () => {
    const d = diffPlanForClient(plan([]), plan([{ supplement_slug: "psyllium-husk", dose: "1 tsp" }]));
    expect(requiresReason(d)).toBe(false);
  });

  it("humanises slugs and strips the vitaone prefix", () => {
    expect(humaniseSlug("vitaone-magnesium-glycinate")).toBe("Magnesium Glycinate");
    expect(humaniseSlug("algae-oil-dha-epa")).toBe("Algae Oil DHA EPA");
  });
});

describe("renderPlanChangeEmail — client-surface rules", () => {
  const changes = diffPlanForClient(
    plan([]),
    plan([{ supplement_slug: "psyllium-husk", dose: "1 tsp (~5 g)", timing: "~30 min before dinner" }]),
  );

  it("greets by first name and points at the app rather than restating the plan", () => {
    const { subject, body } = renderPlanChangeEmail({ displayName: "Shruti Sanghi", changes });
    expect(body).toContain("Hi Shruti,");
    expect(body).toContain("already updated in your app");
    expect(subject).toContain("one new thing");
  });

  it("always carries the opt-out line and the brand sign-off", () => {
    const { body } = renderPlanChangeEmail({ displayName: "Shruti Sanghi", changes });
    expect(body).toContain("just reply and tell me");
    expect(body).toContain("Shivani Hari · The Ochre Tree");
  });

  it("never leaks clinical language into the client surface", () => {
    const { subject, body } = renderPlanChangeEmail({
      displayName: "Shruti Sanghi",
      changes,
      reason: "You mentioned things had been sluggish.",
    });
    const blob = `${subject}\n${body}`.toLowerCase();
    for (const banned of [
      "ferritin", "hbA1c".toLowerCase(), "tsh", "hypochlorhydria", "dysbiosis",
      "inflammation", "il-6", "evidence", "study", "mg/dl", "deficien",
    ]) {
      expect(blob).not.toContain(banned);
    }
  });

  it("renders the coach's reason verbatim under 'Why now'", () => {
    const { body } = renderPlanChangeEmail({
      displayName: "Shruti Sanghi",
      changes,
      reason: "You mentioned things had been sluggish.",
    });
    expect(body).toContain("Why now\nYou mentioned things had been sluggish.");
  });

  it("groups stops under their own heading", () => {
    const stopChanges = diffPlanForClient(
      plan([{ supplement_slug: "creatine-monohydrate", dose: "300mg" }]),
      plan([]),
    );
    const { subject, body } = renderPlanChangeEmail({
      displayName: "Shruti Sanghi",
      changes: stopChanges,
      reason: "We've got what we needed from it — no need to keep buying it.",
    });
    expect(subject).toContain("one thing to stop");
    expect(body).toContain("What you can stop");
    expect(body).toContain("Creatine Monohydrate — you can stop this one.");
    expect(body).toContain("no need to keep buying it");
  });
});
