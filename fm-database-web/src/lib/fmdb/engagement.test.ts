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
import { isSignedUp, isDeclined, onlySignedUp } from "./engagement";

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
