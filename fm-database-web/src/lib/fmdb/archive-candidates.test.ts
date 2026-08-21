/**
 * Tests for the archive-candidates "programme_ended" category (2026-08-21).
 *
 * Before this, a published plan counted as active forever — an ended,
 * not-renewing programme could never be suggested for archive, so ex-clients
 * lingered on every roster surface with no exit path.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getArchiveCandidates } from "./archive-candidates";

const TODAY = "2026-08-21";

let root: string;
let prevPlansDir: string | undefined;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "arch-cand-"));
  prevPlansDir = process.env.FMDB_PLANS_DIR;
  process.env.FMDB_PLANS_DIR = root;
});

afterEach(() => {
  if (prevPlansDir === undefined) delete process.env.FMDB_PLANS_DIR;
  else process.env.FMDB_PLANS_DIR = prevPlansDir;
  fs.rmSync(root, { recursive: true, force: true });
});

function daysAgo(n: number): string {
  const d = new Date(`${TODAY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function writeRenewalDecision(planSlug: string, decision: string) {
  fs.writeFileSync(
    path.join(root, "_renewal_decisions.yaml"),
    yaml.dump({ [planSlug]: { decision, at: new Date().toISOString() } }),
  );
}

function endedPlan(clientId: string, slug: string, endedDaysAgo: number, weeks = 4) {
  return {
    client_id: clientId,
    slug,
    status: "published",
    plan_period_weeks: weeks,
    meal_plan_started_on: daysAgo(endedDaysAgo + weeks * 7),
  };
}

const signedUp = (id: string) => ({
  client_id: id,
  display_name: id,
  engagement_status: "signed_up",
  intake_date: daysAgo(120),
});

describe("programme_ended candidates", () => {
  it("suggests archiving an ended programme with a not_renewing decision, quiet 21+ days", async () => {
    writeRenewalDecision("samaa-plan-1", "not_renewing");
    const out = await getArchiveCandidates(
      [signedUp("cl-samaa")],
      new Map([["cl-samaa", [endedPlan("cl-samaa", "samaa-plan-1", 30)]]]),
      TODAY,
    );
    expect(out).toHaveLength(1);
    expect(out[0].category).toBe("programme_ended");
    expect(out[0].reason).toContain("not renewing");
  });

  it("suggests archiving a lapsed client whose programme ended, even without a recorded decision", async () => {
    const out = await getArchiveCandidates(
      [{ ...signedUp("cl-dhani"), engagement_status: "lapsed" }],
      new Map([["cl-dhani", [endedPlan("cl-dhani", "dhani-plan-1", 30)]]]),
      TODAY,
    );
    expect(out).toHaveLength(1);
    expect(out[0].category).toBe("programme_ended");
  });

  it("leaves an UNDECIDED ending alone — it belongs to the renewal queue", async () => {
    const out = await getArchiveCandidates(
      [signedUp("cl-open")],
      new Map([["cl-open", [endedPlan("cl-open", "open-plan-1", 30)]]]),
      TODAY,
    );
    expect(out).toHaveLength(0);
  });

  it("never suggests a client with an in-flight published plan", async () => {
    writeRenewalDecision("live-plan-1", "not_renewing");
    const out = await getArchiveCandidates(
      [signedUp("cl-live")],
      new Map([["cl-live", [endedPlan("cl-live", "live-plan-1", -30, 12)]]]),
      TODAY,
    );
    expect(out).toHaveLength(0);
  });

  it("anchors staleness on the programme end date — a freshly ended plan is not 'quiet'", async () => {
    writeRenewalDecision("fresh-plan-1", "not_renewing");
    const out = await getArchiveCandidates(
      [signedUp("cl-fresh")],
      new Map([["cl-fresh", [endedPlan("cl-fresh", "fresh-plan-1", 5)]]]),
      TODAY,
    );
    expect(out).toHaveLength(0); // ended 5d ago < 21d window
  });

  it("keeps the original prospect behaviour (never signed up, quiet)", async () => {
    const out = await getArchiveCandidates(
      [{ client_id: "cl-p", display_name: "cl-p", intake_date: daysAgo(40) }],
      new Map(),
      TODAY,
    );
    expect(out).toHaveLength(1);
    expect(out[0].category).toBe("no_signup");
  });

  it("still never suggests a signed-up client mid-onboarding (no plan yet)", async () => {
    const out = await getArchiveCandidates([signedUp("cl-onb")], new Map(), TODAY);
    expect(out).toHaveLength(0);
  });
});
