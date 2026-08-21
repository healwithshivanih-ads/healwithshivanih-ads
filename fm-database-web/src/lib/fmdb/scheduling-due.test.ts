/**
 * Tests for the "Booking links to send" scanner's ACTIVE-CARE scope.
 *
 * The load-bearing property (2026-08-21 fix): clients whose programmes have
 * ENDED, and prospects / lapsed clients, must NOT keep generating booking
 * nudges. On 21 Aug 2026 the panel listed 13 "clients", including three with
 * recorded not_renewing decisions, one with a renewal offer awaiting reply,
 * and two lapsed — noise that trains the coach to ignore the panel.
 *
 * Runs against real temp files (FMDB_PLANS_DIR) — the scanner reads session
 * dirs and _renewal_decisions.yaml off disk, and that wiring is the point.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getSchedulingDueRows, POST_END_GRACE_DAYS } from "./scheduling-due";

const TODAY = "2026-08-21";

let root: string;
let prevPlansDir: string | undefined;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "sched-due-"));
  prevPlansDir = process.env.FMDB_PLANS_DIR;
  process.env.FMDB_PLANS_DIR = root;
});

afterEach(() => {
  if (prevPlansDir === undefined) delete process.env.FMDB_PLANS_DIR;
  else process.env.FMDB_PLANS_DIR = prevPlansDir;
  fs.rmSync(root, { recursive: true, force: true });
});

/** YYYY-MM-DD that is `n` days before TODAY. */
function daysAgo(n: number): string {
  const d = new Date(`${TODAY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function writeSession(clientId: string, dateYmd: string) {
  const dir = path.join(root, "clients", clientId, "sessions");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${clientId}-${dateYmd}-001.yaml`),
    yaml.dump({ date: dateYmd }),
  );
}

function writeRenewalDecision(planSlug: string, decision: string) {
  const file = path.join(root, "_renewal_decisions.yaml");
  const existing = fs.existsSync(file)
    ? (yaml.load(fs.readFileSync(file, "utf-8")) as Record<string, unknown>)
    : {};
  existing[planSlug] = { decision, at: new Date().toISOString() };
  fs.writeFileSync(file, yaml.dump(existing));
}

/** A published plan whose programme ended `endedDaysAgo` days ago (negative =
 *  still in flight). Uses meal_plan_started_on so effectiveRecheckDate is
 *  exactly start + weeks*7. */
function plan(clientId: string, slug: string, endedDaysAgo: number, weeks = 4) {
  return {
    client_id: clientId,
    slug,
    status: "published",
    plan_period_weeks: weeks,
    meal_plan_started_on: daysAgo(endedDaysAgo + weeks * 7),
    plan_period_start: daysAgo(endedDaysAgo + weeks * 7 + 3),
  };
}

function client(id: string, extra: Record<string, unknown> = {}) {
  return { client_id: id, display_name: id, mobile_number: "9198765432 10", ...extra };
}

describe("active-care gates", () => {
  it("drops a lapsed client even when their ended plan is 'recheck overdue'", async () => {
    const rows = await getSchedulingDueRows(
      [client("cl-samaa", { engagement_status: "lapsed" })],
      [plan("cl-samaa", "samaa-plan-1", 18)],
      TODAY,
    );
    expect(rows).toHaveLength(0);
  });

  it("drops a client whose ended plan has a not_renewing decision, even inside the grace window", async () => {
    writeRenewalDecision("deepti-plan-1", "not_renewing");
    const rows = await getSchedulingDueRows(
      [client("cl-deepti", { engagement_status: "signed_up" })],
      [plan("cl-deepti", "deepti-plan-1", 5)],
      TODAY,
    );
    expect(rows).toHaveLength(0);
  });

  it("drops a client whose ending has ANY recorded decision (e.g. offer_sent awaiting reply)", async () => {
    writeRenewalDecision("sudarshan-plan-1", "offer_sent");
    const rows = await getSchedulingDueRows(
      [client("cl-sud", { engagement_status: "signed_up" })],
      [plan("cl-sud", "sudarshan-plan-1", 5)],
      TODAY,
    );
    expect(rows).toHaveLength(0);
  });

  it("keeps an UNDECIDED ending inside the grace window (book the wrap-up call)", async () => {
    const rows = await getSchedulingDueRows(
      [client("cl-a", { engagement_status: "signed_up" })],
      [plan("cl-a", "a-plan-1", 3)],
      TODAY,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].plan_recheck_overdue_days).toBe(3);
    expect(rows[0].recommended_type).toBe("coaching");
  });

  it("drops an undecided ending once past the grace window — the renewal queue owns it", async () => {
    const rows = await getSchedulingDueRows(
      [client("cl-b", { engagement_status: "signed_up" })],
      [plan("cl-b", "b-plan-1", POST_END_GRACE_DAYS + 3)],
      TODAY,
    );
    expect(rows).toHaveLength(0);
  });

  it("still flags an in-flight programme with a long session gap (the real signal)", async () => {
    writeSession("cl-shruti", daysAgo(56));
    const rows = await getSchedulingDueRows(
      [client("cl-shruti", { engagement_status: "signed_up" })],
      [plan("cl-shruti", "shruti-plan-1", -30, 12)], // ends in 30 days
      TODAY,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].days_since_last_session).toBe(56);
    expect(rows[0].reason).toContain("56d since last session");
  });

  it("never auto-flags a no-plan prospect off the session-gap clock", async () => {
    writeSession("cl-prospect", daysAgo(40));
    const rows = await getSchedulingDueRows(
      [client("cl-prospect")], // no engagement_status, no plan
      [],
      TODAY,
    );
    expect(rows).toHaveLength(0);
  });

  it("still surfaces a no-plan prospect when the coach set a next_contact_date due soon", async () => {
    const inTwoDays = daysAgo(-2);
    const rows = await getSchedulingDueRows(
      [client("cl-prospect2", { next_contact_date: inTwoDays })],
      [],
      TODAY,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].recommended_type).toBe("discovery");
    expect(rows[0].upcoming_in_days).toBe(2);
  });

  it("drops paused / prospect lifecycle states entirely", async () => {
    writeSession("cl-paused", daysAgo(40));
    const rows = await getSchedulingDueRows(
      [
        client("cl-paused", {
          engagement_status: "signed_up",
          lifecycle_state: "paused",
        }),
      ],
      [plan("cl-paused", "paused-plan-1", -30, 12)],
      TODAY,
    );
    expect(rows).toHaveLength(0);
  });

  it("reports the EFFECTIVE recheck date (meal-start based), not the stored legacy field", async () => {
    const p = {
      ...plan("cl-eff", "eff-plan-1", 2),
      // A stale stored recheck a month out — must not resurrect the row's date.
      plan_period_recheck_date: daysAgo(-30),
    };
    const rows = await getSchedulingDueRows(
      [client("cl-eff", { engagement_status: "signed_up" })],
      [p],
      TODAY,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].plan_period_recheck_date).toBe(daysAgo(2));
  });
});
