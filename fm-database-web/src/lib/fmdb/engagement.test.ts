/**
 * Who counts as a client.
 *
 * The bug this guards against is real and already happened: two people with
 * published plans and months of active sessions (cl-014, cl-017) had no
 * `engagement_status` field at all, because nothing ever wrote it. Any check
 * shaped `status !== "signed_up"` would have been fine — but a check shaped
 * `status === "pending"` would have silently treated them as enrolled.
 *
 * So the rule is: absence is NOT enrolment. Prove it, don't assume it.
 */
import { describe, it, expect } from "vitest";
import {
  isSignedUp,
  isDeclined,
  onlySignedUp,
  confirmationNameMatches,
  findUnevidencedSignups,
} from "./engagement";

describe("isSignedUp", () => {
  it("accepts only an explicit signed_up", () => {
    expect(isSignedUp({ engagement_status: "signed_up" })).toBe(true);
    expect(isSignedUp({ engagement_status: "pending" })).toBe(false);
    expect(isSignedUp({ engagement_status: "declined" })).toBe(false);
  });

  it("treats a missing field as NOT enrolled", () => {
    // The safe direction: a forgotten field must never grant client status.
    expect(isSignedUp({})).toBe(false);
    expect(isSignedUp({ display_name: "Someone" })).toBe(false);
    expect(isSignedUp(null)).toBe(false);
    expect(isSignedUp(undefined)).toBe(false);
  });

  it("ignores casing and stray whitespace from hand-edited YAML", () => {
    expect(isSignedUp({ engagement_status: "Signed_Up" })).toBe(true);
    expect(isSignedUp({ engagement_status: "  signed_up  " })).toBe(true);
  });

  it("does not treat an empty or non-string value as enrolled", () => {
    expect(isSignedUp({ engagement_status: "" })).toBe(false);
    expect(isSignedUp({ engagement_status: "   " })).toBe(false);
    expect(isSignedUp({ engagement_status: true })).toBe(false);
    expect(isSignedUp({ engagement_status: 1 })).toBe(false);
  });
});

describe("isDeclined", () => {
  it("is true only for an explicit decline", () => {
    expect(isDeclined({ engagement_status: "declined" })).toBe(true);
    expect(isDeclined({ engagement_status: "pending" })).toBe(false);
    expect(isDeclined({})).toBe(false);
  });
});

describe("findUnevidencedSignups", () => {
  const TODAY = "2026-07-29";
  const plans = (...ids: string[]) => new Set(ids);

  it("flags the Anita case: signed up, no intake, no plan, gone quiet", () => {
    const rows = findUnevidencedSignups(
      [
        {
          client_id: "cl-020",
          display_name: "Anita Pansari",
          engagement_status: "signed_up",
          intake_submitted_at: null,
          last_touch: "2026-07-05",
        },
      ],
      plans(),
      TODAY
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].client_id).toBe("cl-020");
    expect(rows[0].quiet_days).toBe(24);
  });

  it("accepts EITHER a submitted intake or a plan as evidence", () => {
    const people = [
      {
        client_id: "intake-only",
        engagement_status: "signed_up",
        intake_submitted_at: "2026-05-02T00:00:00Z",
        last_touch: "2026-05-01",
      },
      {
        client_id: "plan-only",
        engagement_status: "signed_up",
        intake_submitted_at: null,
        last_touch: "2026-05-01",
      },
    ];
    expect(findUnevidencedSignups(people, plans("plan-only"), TODAY)).toEqual([]);
  });

  it("leaves a fresh signup alone — onboarding legitimately has neither yet", () => {
    // cl-023 Siddharth: signed up 7 days ago, no intake, no plan. Normal.
    const rows = findUnevidencedSignups(
      [
        {
          client_id: "cl-023",
          engagement_status: "signed_up",
          intake_submitted_at: null,
          last_touch: "2026-07-23",
        },
      ],
      plans(),
      TODAY
    );
    expect(rows).toEqual([]);
  });

  it("ignores anyone not signed up — that's the sweep's job, not this", () => {
    const people = [
      { client_id: "p", engagement_status: "pending", last_touch: "2026-01-01" },
      { client_id: "d", engagement_status: "declined", last_touch: "2026-01-01" },
      { client_id: "m", last_touch: "2026-01-01" }, // field missing
    ];
    expect(findUnevidencedSignups(people, plans(), TODAY)).toEqual([]);
  });

  it("flags a record with no dateable activity at all", () => {
    const rows = findUnevidencedSignups(
      [{ client_id: "x", engagement_status: "signed_up", last_touch: null }],
      plans(),
      TODAY
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].quiet_days).toBeNull();
    expect(rows[0].reason).toContain("no dateable activity");
  });

  it("sorts the longest-quiet first, with undateable records at the top", () => {
    const people = [
      { client_id: "recent", engagement_status: "signed_up", last_touch: "2026-07-01" },
      { client_id: "ancient", engagement_status: "signed_up", last_touch: "2026-01-01" },
      { client_id: "unknown", engagement_status: "signed_up", last_touch: null },
    ];
    expect(findUnevidencedSignups(people, plans(), TODAY).map((r) => r.client_id)).toEqual([
      "unknown",
      "ancient",
      "recent",
    ]);
  });
});

describe("confirmationNameMatches", () => {
  // Gates the only override that can build a plan before signup. Meghana's
  // plan (2026-07-04) was created a day before any gate existed; the gate that
  // followed was one click, which is barely a gate at all.
  it("accepts the exact name, tolerating case and surrounding space", () => {
    expect(confirmationNameMatches("Meghana Dighe", "Meghana Dighe")).toBe(true);
    expect(confirmationNameMatches("meghana dighe", "Meghana Dighe")).toBe(true);
    expect(confirmationNameMatches("  Meghana Dighe  ", "Meghana Dighe")).toBe(true);
  });

  it("rejects a partial name — no first-name shortcut", () => {
    expect(confirmationNameMatches("Meghana", "Meghana Dighe")).toBe(false);
    expect(confirmationNameMatches("Dighe", "Meghana Dighe")).toBe(false);
    expect(confirmationNameMatches("Meghana Dighe extra", "Meghana Dighe")).toBe(false);
  });

  it("never lets blank or absent input through", () => {
    expect(confirmationNameMatches("", "Meghana Dighe")).toBe(false);
    expect(confirmationNameMatches("   ", "Meghana Dighe")).toBe(false);
    expect(confirmationNameMatches(undefined, "Meghana Dighe")).toBe(false);
    expect(confirmationNameMatches(null, "Meghana Dighe")).toBe(false);
  });

  it("cannot be satisfied by an empty expected name", () => {
    // Otherwise a client whose display_name was never set would have NO gate:
    // "" === "" would pass and the override would be free.
    expect(confirmationNameMatches("", "")).toBe(false);
    expect(confirmationNameMatches("anything", "")).toBe(false);
    expect(confirmationNameMatches("anything", undefined)).toBe(false);
  });
});

describe("onlySignedUp", () => {
  it("keeps enrolled clients and drops everyone else", () => {
    const people = [
      { client_id: "a", engagement_status: "signed_up" },
      { client_id: "b", engagement_status: "pending" },
      { client_id: "c", engagement_status: "declined" },
      { client_id: "d" }, // field never written
    ];
    expect(onlySignedUp(people).map((p) => p.client_id)).toEqual(["a"]);
  });

  it("does not mutate the input", () => {
    const people = [{ client_id: "a", engagement_status: "pending" }];
    onlySignedUp(people);
    expect(people).toHaveLength(1);
  });
});
