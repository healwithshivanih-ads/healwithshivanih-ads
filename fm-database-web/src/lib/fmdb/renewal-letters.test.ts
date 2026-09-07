import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Point the plans root at a throwaway dir BEFORE importing the module under
// test — getPlansRoot() reads FMDB_PLANS_DIR on every call, so this is enough.
let tmp: string;
beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "renewal-letters-"));
  process.env.FMDB_PLANS_DIR = tmp;
});
afterAll(() => {
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

const {
  stageRenewalLetter,
  approveRenewalLetter,
  unapproveRenewalLetter,
  markRenewalLetterSent,
  loadRenewalLetter,
  loadAllRenewalLetters,
  renewalLettersDue,
} = await import("./renewal-letters");

function stage(slug: string) {
  return stageRenewalLetter({
    planSlug: slug,
    clientId: "cl-999",
    clientName: "Test Client",
    to: "test@example.com",
    subject: "Test — a subject",
    body: "Dear Test,\n\nA body paragraph.\n\nWarmly,\nShivani",
    offerLabel: "Continue — 12 weeks · ₹85,000",
  });
}

describe("renewal letter lifecycle", () => {
  it("stages a drafted letter that reads back", () => {
    expect(stage("alpha-plan-1-cl-999").ok).toBe(true);
    const l = loadRenewalLetter("alpha-plan-1-cl-999");
    expect(l).not.toBeNull();
    expect(l!.status).toBe("drafted");
    expect(l!.scheduled_for).toBeNull();
    expect(l!.to).toBe("test@example.com");
    expect(l!.offer_label).toContain("₹85,000");
  });

  it("approve sets status + the send date; unapprove reverses it", () => {
    stage("beta-plan-1-cl-999");
    expect(approveRenewalLetter("beta-plan-1-cl-999", "2026-09-08").ok).toBe(true);
    let l = loadRenewalLetter("beta-plan-1-cl-999")!;
    expect(l.status).toBe("approved");
    expect(l.scheduled_for).toBe("2026-09-08");
    expect(l.approved_at).not.toBeNull();

    expect(unapproveRenewalLetter("beta-plan-1-cl-999").ok).toBe(true);
    l = loadRenewalLetter("beta-plan-1-cl-999")!;
    expect(l.status).toBe("drafted");
    expect(l.scheduled_for).toBeNull();
  });

  it("approve rejects a malformed date and a missing letter", () => {
    stage("gamma-plan-1-cl-999");
    expect(approveRenewalLetter("gamma-plan-1-cl-999", "08/09/2026").ok).toBe(false);
    expect(approveRenewalLetter("nope-plan-1-cl-999", "2026-09-08").ok).toBe(false);
  });

  it("marks sent, and then refuses to be re-staged or re-approved", () => {
    stage("delta-plan-1-cl-999");
    approveRenewalLetter("delta-plan-1-cl-999", "2026-09-08");
    expect(markRenewalLetterSent("delta-plan-1-cl-999").ok).toBe(true);
    expect(loadRenewalLetter("delta-plan-1-cl-999")!.status).toBe("sent");
    // Guard: a sent letter must never be clobbered by a re-stage or re-approve.
    expect(stage("delta-plan-1-cl-999").ok).toBe(false);
    expect(approveRenewalLetter("delta-plan-1-cl-999", "2026-09-09").ok).toBe(false);
  });

  it("rejects a bad plan slug", () => {
    expect(
      stageRenewalLetter({
        planSlug: "../etc/passwd",
        clientId: "cl-999",
        clientName: "x",
        to: "x@y.com",
        subject: "s",
        body: "b",
        offerLabel: "",
      }).ok,
    ).toBe(false);
  });

  it("loadAll returns every yaml record and ignores loose .txt", () => {
    // A legacy .txt drop in the same dir must not break the map.
    fs.writeFileSync(path.join(tmp, "_renewal_letters", "legacy-note.txt"), "old chat draft");
    const all = loadAllRenewalLetters();
    expect(Object.keys(all)).toContain("alpha-plan-1-cl-999");
    expect(Object.keys(all).some((k) => k.endsWith(".txt"))).toBe(false);
  });
});

describe("renewalLettersDue", () => {
  const base = {
    plan_slug: "x",
    client_id: "cl-1",
    client_name: "n",
    to: "a@b.com",
    subject: "s",
    body: "b",
    offer_label: "",
    drafted_at: "",
    approved_at: null,
    sent_at: null,
  };
  const today = "2026-09-08";

  it("includes approved letters whose date has arrived", () => {
    const due = renewalLettersDue(
      [
        { ...base, plan_slug: "due-today", status: "approved", scheduled_for: "2026-09-08" },
        { ...base, plan_slug: "overdue", status: "approved", scheduled_for: "2026-09-01" },
      ],
      today,
    );
    expect(due.map((l) => l.plan_slug).sort()).toEqual(["due-today", "overdue"]);
  });

  it("excludes future, drafted, sent, and date-less letters", () => {
    const due = renewalLettersDue(
      [
        { ...base, plan_slug: "future", status: "approved", scheduled_for: "2026-09-20" },
        { ...base, plan_slug: "still-draft", status: "drafted", scheduled_for: null },
        { ...base, plan_slug: "already-sent", status: "sent", scheduled_for: "2026-09-01" },
        { ...base, plan_slug: "approved-no-date", status: "approved", scheduled_for: null },
      ],
      today,
    );
    expect(due).toHaveLength(0);
  });
});
