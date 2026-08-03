import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  nextMondayYmd,
  guidedWeek,
  createGuidedSubscriber,
  resolveGuidedSubscriberByToken,
  findGuidedByPaymentId,
} from "./guided-tier";
import { GUIDED_PROTOCOLS, getGuidedProtocol, phaseForWeek, alsoActivePhases } from "./guided-protocols";
import { buildGuidedAppData } from "./guided-app";

const IST = "Asia/Kolkata";

describe("nextMondayYmd", () => {
  it("a Monday purchase starts the same day", () => {
    // 2026-08-03 is a Monday. 09:00 IST = 03:30 UTC.
    expect(nextMondayYmd(new Date("2026-08-03T03:30:00Z"), IST)).toBe("2026-08-03");
  });
  it("a Tuesday purchase starts the following Monday", () => {
    expect(nextMondayYmd(new Date("2026-08-04T03:30:00Z"), IST)).toBe("2026-08-10");
  });
  it("a Sunday-night IST purchase starts the very next day", () => {
    // Sunday 2026-08-09 23:00 IST = 17:30 UTC (still Sunday UTC too).
    expect(nextMondayYmd(new Date("2026-08-09T17:30:00Z"), IST)).toBe("2026-08-10");
  });
  it("tz matters: late Sunday IST is already Monday-adjacent while UTC says Sunday", () => {
    // 2026-08-09 20:30 UTC = Monday 02:00 IST → starts that same Monday.
    expect(nextMondayYmd(new Date("2026-08-09T20:30:00Z"), IST)).toBe("2026-08-10");
  });
});

describe("guidedWeek", () => {
  it("is 0 before the start date", () => {
    expect(guidedWeek("2026-08-10", "2026-08-08")).toBe(0);
  });
  it("is 1 on the start day and through day 6", () => {
    expect(guidedWeek("2026-08-10", "2026-08-10")).toBe(1);
    expect(guidedWeek("2026-08-10", "2026-08-16")).toBe(1);
  });
  it("rolls to 2 exactly on day 7", () => {
    expect(guidedWeek("2026-08-10", "2026-08-17")).toBe(2);
  });
  it("handles garbage without throwing", () => {
    expect(guidedWeek("", "2026-08-17")).toBe(0);
  });
});

describe("phaseForWeek — 5R's overlapping phases", () => {
  const gut = getGuidedProtocol("gut-reset")!;
  it("week 1 headlines Remove, not Replace (tie on startWeek keeps the earlier)", () => {
    expect(phaseForWeek(gut, 1).phase.name).toBe("Remove");
  });
  it("week 3 headlines Reinoculate (newest-begun wins) with Replace still in flight", () => {
    const { phase, idx } = phaseForWeek(gut, 3);
    expect(phase.name).toBe("Reinoculate");
    expect(alsoActivePhases(gut, 3, idx)).toContain("Replace");
  });
  it("week 5 headlines Repair; week 9 headlines Rebalance", () => {
    expect(phaseForWeek(gut, 5).phase.name).toBe("Repair");
    expect(phaseForWeek(gut, 9).phase.name).toBe("Rebalance");
  });
  it("past the end clamps to the final phase (+ ongoing semantics)", () => {
    expect(phaseForWeek(gut, 40).phase.name).toBe("Rebalance");
  });
});

describe("guided protocol content — public-surface rules", () => {
  it("ships exactly the four v1 protocols with real structures", () => {
    const bySlug = Object.fromEntries(GUIDED_PROTOCOLS.map((p) => [p.slug, p]));
    expect(bySlug["gut-reset"].weeks).toBe(12);
    expect(bySlug["gut-reset"].phases.length).toBe(5);
    expect(bySlug["blood-sugar-balance"].weeks).toBe(10);
    expect(bySlug["blood-sugar-balance"].phases.length).toBe(3);
    expect(bySlug["energy-stress-recovery"].weeks).toBe(12);
    expect(bySlug["anti-inflammatory-reset"].weeks).toBe(10);
  });
  it("carries NO doses anywhere in actions (mg/mcg/IU are the tell)", () => {
    for (const p of GUIDED_PROTOCOLS)
      for (const ph of p.phases)
        for (const a of ph.actions) expect(a).not.toMatch(/\d\s*(mg|mcg|iu)\b/i);
  });
  it("never uses treat/cure/reverse language in public copy", () => {
    const text = JSON.stringify(GUIDED_PROTOCOLS).toLowerCase();
    for (const banned of ["cure", "reverse your", "treats ", "treatment for"])
      expect(text).not.toContain(banned);
  });
  it("every protocol screens for pregnancy and eating-disorder history as hard stops", () => {
    for (const p of GUIDED_PROTOCOLS) {
      expect(p.screening.some((q) => /pregnant/i.test(q.q) && q.hard)).toBe(true);
      expect(p.screening.some((q) => /eating disorder/i.test(q.q) && q.hard)).toBe(true);
      expect(p.screening.some((q) => /allerg/i.test(q.q))).toBe(true);
    }
  });
});

describe("guided store — create / resolve / idempotency", () => {
  let tmp: string;
  const OLD = process.env.FMDB_PLANS_DIR;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "guided-test-"));
    process.env.FMDB_PLANS_DIR = tmp;
  });
  afterEach(async () => {
    process.env.FMDB_PLANS_DIR = OLD;
    await fs.rm(tmp, { recursive: true, force: true });
  });

  const input = {
    display_name: "Meera Test",
    email: "Meera@Example.com",
    phone: "+919999999999",
    protocol_slug: "gut-reset",
    dietary_preference: "jain" as const,
    payment_id: "pay_TEST123",
    amount_paisa: 699900,
    source: "web" as const,
  };

  it("creates once, then returns the same subscriber for the same payment", async () => {
    const a = await createGuidedSubscriber(input, new Date("2026-08-04T03:30:00Z"));
    expect(a.created).toBe(true);
    expect(a.subscriber.start_date).toBe("2026-08-10"); // Tuesday → next Monday
    expect(a.subscriber.email).toBe("meera@example.com"); // lowercased
    const b = await createGuidedSubscriber(input);
    expect(b.created).toBe(false);
    expect(b.subscriber.subscriber_id).toBe(a.subscriber.subscriber_id);
    expect(b.subscriber.app_token).toBe(a.subscriber.app_token);
  });

  it("resolves by token, rejects short tokens, finds by payment id", async () => {
    const { subscriber } = await createGuidedSubscriber(input);
    const hit = await resolveGuidedSubscriberByToken(subscriber.app_token);
    expect(hit?.subscriber_id).toBe(subscriber.subscriber_id);
    expect(hit?.dietary_preference).toBe("jain");
    expect(await resolveGuidedSubscriberByToken("short")).toBeNull();
    expect((await findGuidedByPaymentId("pay_TEST123"))?.subscriber_id).toBe(subscriber.subscriber_id);
  });
});

describe("buildGuidedAppData", () => {
  const base = {
    subscriber_id: "gd-test000001",
    display_name: "Meera Test",
    email: "meera@example.com",
    phone: "",
    app_token: "a".repeat(32),
    protocol_slug: "gut-reset",
    dietary_preference: "jain" as const,
    extra_protocols: [],
    start_date: "2026-08-10",
    payment_id: "pay_X",
    amount_paisa: 699900,
    source: "web" as const,
    status: "active" as const,
    timezone: IST,
    purchased_at: "2026-08-04T03:30:00.000Z",
    created_at: "2026-08-04T03:30:00.000Z",
    updated_at: "2026-08-04T03:30:00.000Z",
    version: 1,
  };

  it("week 1: guided tier, Remove headline, practices gated, no coach surfaces", () => {
    const d = buildGuidedAppData(base, IST, new Date("2026-08-12T04:00:00Z"))!; // Wed of week 1
    expect(d.tier).toBe("guided");
    expect(d.client.week).toBe(1);
    expect(d.client.totalWeeks).toBe(12);
    expect(d.guidedWeekly?.title).toMatch(/^Remove/);
    expect(d.guidedWeekly?.alsoActive).toContain("Replace");
    expect(d.guidedWeekly?.standardNote).toMatch(/standard programme/);
    // Week 1 of gut-reset: only the first practice is open (others start wk 3/5).
    expect(d.practices.length).toBe(1);
    expect(d.practicesComingLater).toBe(2);
    expect(d.somatic.length).toBe(1);
    // The ₹85k boundary: no WhatsApp, no supplements, no labs, no menus.
    expect(d.coach.whatsappNumber).toBe("");
    expect(d.supplements.length).toBe(0);
    expect(d.labVault).toBeNull();
    expect(d.weekMenus.length).toBe(0);
    // Ribbon carries the REAL five phases.
    expect(d.planRef.phase.list.map((p) => p.name)).toEqual([
      "Remove",
      "Replace",
      "Reinoculate",
      "Repair",
      "Rebalance",
    ]);
    // Diet chip + allergy override present.
    expect(d.planRef.flags[0]?.label).toBe("Jain");
    expect(d.planRef.avoidWhy).toMatch(/allergic or intolerant/);
  });

  it("before the start date it renders week zero, not week 1 actions", () => {
    const d = buildGuidedAppData(base, IST, new Date("2026-08-08T04:00:00Z"))!;
    expect(d.client.notStarted).toBe(true);
    expect(d.guidedWeekly?.title).toMatch(/^Week zero/);
    expect(d.guidedWeekly?.alsoActive).toEqual([]);
  });

  it("week 6 opens all three practices; week 40 clamps to the final phase", () => {
    const wk6 = buildGuidedAppData(base, IST, new Date("2026-09-16T04:00:00Z"))!;
    expect(wk6.client.week).toBe(6);
    expect(wk6.practices.length).toBe(3);
    const late = buildGuidedAppData(base, IST, new Date("2027-06-01T04:00:00Z"))!;
    expect(late.client.week).toBe(12); // clamped
    expect(late.guidedWeekly?.title).toMatch(/^Rebalance/);
  });

  it("returns null for an unknown protocol", () => {
    expect(buildGuidedAppData({ ...base, protocol_slug: "nope" }, IST)).toBeNull();
  });
});
