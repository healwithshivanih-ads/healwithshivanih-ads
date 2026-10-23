/**
 * The one lifecycle resolver, pinned two ways:
 *
 *  1. Unit fixtures shaped like the real roster the day the resolver landed
 *     (2026-10-23): a lapsed client with a not_renewing decision, a maintenance
 *     client whose old programme plan is still on disk, a renewed client between
 *     phases with a draft successor, a never-signed-up prospect with an
 *     assessed session, a signed-up client whose plan starts next week.
 *     Each of these was mis-filed by the old dashboard in a different way.
 *
 *  2. Parity: the same fixtures written to a throwaway plans root and run
 *     through the Python mirror (fmdb/plan/lifecycle.py via
 *     scripts/lifecycle-report.py). State, since, planSlug, planEndsOn and
 *     daysSinceEnd must match key for key — the nightly sweep stamps client.yaml
 *     with the Python answer and the dashboard renders the TS one.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import { PY_TEST_TIMEOUT_MS, TEST_PYTHON } from "./test-python";
import {
  resolveLifecycle,
  resolveLifecycles,
  isInCare,
  ENDED_GRACE_DAYS,
  type LifecycleClientLike,
  type LifecyclePlanLike,
} from "./lifecycle";

const TODAY = "2026-10-23";
const FMDB = path.resolve(__dirname, "../../../../fm-database");

const client = (id: string, extra: Partial<LifecycleClientLike> = {}): LifecycleClientLike => ({
  client_id: id,
  display_name: id,
  intake_date: "2026-06-01",
  ...extra,
});

const plan = (
  slug: string,
  client_id: string,
  extra: Partial<LifecyclePlanLike> = {},
): LifecyclePlanLike => ({
  slug,
  client_id,
  _bucket: "published",
  status: "published",
  plan_period_start: "2026-06-01",
  plan_period_weeks: 12,
  ...extra,
});

// ── fixtures ────────────────────────────────────────────────────────────────

/** cl-004 shape: lapsed by the sweep, plan still in published/, nothing after. */
const dhanishta = client("cl-004", { engagement_status: "lapsed", lapsed_on: "2026-08-18" });
const dhanishtaPlans = [plan("dhanishta-plan-1", "cl-004", { plan_period_start: "2026-05-09" })]; // ends 2026-08-04

/** cl-021 shape: not_renewing on file, plan ended 19 days ago. */
const kamla = client("cl-021", { engagement_status: "lapsed", lapsed_on: "2026-10-18" });
const kamlaPlans = [plan("kamla-plan-1", "cl-021", { plan_period_start: "2026-07-08" })]; // ends 2026-10-04

/** cl-014 shape: maintenance, paid through March, old programme plan ALSO still published. */
const niti = client("cl-014", {
  engagement_status: "signed_up",
  maintenance_status: "active",
  maintenance_paid_through: "2027-03-05",
  next_contact_date: "2026-08-07",
});
const nitiPlans = [
  plan("niti-plan-1", "cl-014", { plan_period_start: "2026-06-06" }),
  plan("niti-plan-2", "cl-014", { plan_period_start: "2026-09-04", plan_period_weeks: 26, is_maintenance: true }),
];

/** cl-005 shape: programme ended 25d ago, decision renewed, successor in draft. */
const hariharan = client("cl-005", { engagement_status: "signed_up" });
const hariharanPlans = [
  plan("hariharan-plan-5", "cl-005", { plan_period_start: "2026-07-03" }), // ends 2026-09-28
  plan("hariharan-plan-6", "cl-005", { _bucket: "draft", status: "draft", plan_period_start: "2026-10-30" }),
];

/** cl-904 shape: pending, had a Foundation call, an assessed session, no plan. */
const akila = client("cl-904", { engagement_status: "pending", intake_date: "2026-09-20" });

/** Brand-new signup whose plan starts next week. */
const fresh = client("cl-999", { engagement_status: "signed_up", intake_date: "2026-10-15" });
const freshPlans = [plan("fresh-plan-1", "cl-999", { plan_period_start: "2026-10-27" })];

/** In flight, inside the renewal window, no decision yet. */
const geetika = client("cl-006", { engagement_status: "signed_up" });
const geetikaPlans = [plan("geetika-plan-3", "cl-006", { plan_period_start: "2026-08-01" })]; // ends 2026-10-27

/** Declined prospect, and an archived person. */
const declined = client("cl-700", { engagement_status: "declined" });
const archived = client("cl-701", { engagement_status: "lapsed", archived: true, archived_at: "2026-09-01T00:00:00Z" });

// ── unit ────────────────────────────────────────────────────────────────────

describe("resolveLifecycle — the roster shapes the old dashboard got wrong", () => {
  it("a lapsed client with a plan still in published/ is LAPSED, not recheck-due", () => {
    const l = resolveLifecycle(dhanishta, dhanishtaPlans, TODAY);
    expect(l.state).toBe("lapsed");
    expect(l.since).toBe("2026-08-18");
    expect(l.planEndsOn).toBe("2026-08-04");
    expect(isInCare(l)).toBe(false);
  });

  it("a not_renewing decision on an ended plan is lapsed, with the decision in the reason", () => {
    const l = resolveLifecycle(kamla, kamlaPlans, TODAY, {
      decisions: { "kamla-plan-1": { decision: "not_renewing" } },
    });
    expect(l.state).toBe("lapsed");
    expect(l.reason).toContain("not_renewing");
  });

  it("maintenance wins even when an old programme plan is still on disk", () => {
    const l = resolveLifecycle(niti, nitiPlans, TODAY);
    expect(l.state).toBe("maintenance");
    expect(l.planSlug).toBe("niti-plan-2");
    expect(l.planEndsOn).toBe("2027-03-05");
    expect(isInCare(l)).toBe(true);
  });

  it("renewed with a draft successor is ACTIVE (between phases), never lapsed", () => {
    const l = resolveLifecycle(hariharan, hariharanPlans, TODAY, {
      decisions: { "hariharan-plan-5": { decision: "renewed" } },
    });
    expect(l.state).toBe("active");
    expect(l.reason).toContain("hariharan-plan-6");
  });

  it("a successor draft alone (no decision recorded) is enough to stay active", () => {
    const l = resolveLifecycle(hariharan, hariharanPlans, TODAY);
    expect(l.state).toBe("active");
  });

  it("a never-signed-up person is a PROSPECT whatever sessions they have", () => {
    const l = resolveLifecycle(akila, [], TODAY);
    expect(l.state).toBe("prospect");
    expect(l.declined).toBe(false);
    expect(l.since).toBe("2026-09-20");
  });

  it("a signed-up client whose plan starts next week is onboarding", () => {
    const l = resolveLifecycle(fresh, freshPlans, TODAY);
    expect(l.state).toBe("onboarding");
    expect(l.planSlug).toBe("fresh-plan-1");
  });

  it("a signed-up client with no plan at all is onboarding", () => {
    expect(resolveLifecycle(fresh, [], TODAY).state).toBe("onboarding");
  });

  it("inside the renewal window with no decision is ENDING; with one, ACTIVE", () => {
    expect(resolveLifecycle(geetika, geetikaPlans, TODAY).state).toBe("ending");
    expect(
      resolveLifecycle(geetika, geetikaPlans, TODAY, {
        decisions: { "geetika-plan-3": { decision: "deferred" } },
      }).state,
    ).toBe("active");
  });

  it("ended + grace + no successor + no decision flips to lapsed on the day", () => {
    const edge = plan("edge-plan", "cl-800", { plan_period_start: "2026-05-01" }); // eff start 05-04, ends 07-27
    const c = client("cl-800", { engagement_status: "signed_up" });
    const endDay = "2026-07-27";
    const onGrace = resolveLifecycle(c, [edge], "2026-08-10"); // +14
    const pastGrace = resolveLifecycle(c, [edge], "2026-08-11"); // +15
    expect(onGrace.state).toBe("ending");
    expect(onGrace.planEndsOn).toBe(endDay);
    expect(pastGrace.state).toBe("lapsed");
    expect(pastGrace.since).toBe("2026-08-10");
    expect(pastGrace.daysSinceEnd).toBe(ENDED_GRACE_DAYS + 1);
  });

  it("plan evidence beats a blank engagement_status for ACTIVE", () => {
    const c = client("cl-801");
    const l = resolveLifecycle(c, [plan("p", "cl-801", { plan_period_start: "2026-09-01" })], TODAY);
    expect(l.state).toBe("active");
  });

  it("declined → prospect with the flag; archived → archived before anything else", () => {
    const d = resolveLifecycle(declined, [], TODAY);
    expect(d.state).toBe("prospect");
    expect(d.declined).toBe(true);
    const a = resolveLifecycle(archived, kamlaPlans.map((p) => ({ ...p, client_id: "cl-701" })), TODAY);
    expect(a.state).toBe("archived");
    expect(a.since).toBe("2026-09-01");
  });

  it("a revoked plan counts for nothing", () => {
    const c = client("cl-802", { engagement_status: "signed_up" });
    const l = resolveLifecycle(c, [plan("r", "cl-802", { _bucket: "revoked", status: "revoked" })], TODAY);
    expect(l.state).toBe("onboarding");
  });

  it("resolveLifecycles indexes by client and ignores other clients' plans", () => {
    const all = resolveLifecycles([dhanishta, niti], [...dhanishtaPlans, ...nitiPlans], TODAY);
    expect(all.get("cl-004")?.state).toBe("lapsed");
    expect(all.get("cl-014")?.state).toBe("maintenance");
  });
});

// ── parity with the Python mirror ───────────────────────────────────────────

const FIXTURES: Array<{
  c: LifecycleClientLike;
  plans: LifecyclePlanLike[];
  decisions?: Record<string, { decision: string }>;
}> = [
  { c: dhanishta, plans: dhanishtaPlans },
  { c: kamla, plans: kamlaPlans, decisions: { "kamla-plan-1": { decision: "not_renewing" } } },
  { c: niti, plans: nitiPlans },
  { c: hariharan, plans: hariharanPlans, decisions: { "hariharan-plan-5": { decision: "renewed" } } },
  { c: akila, plans: [] },
  { c: fresh, plans: freshPlans },
  { c: geetika, plans: geetikaPlans },
  { c: declined, plans: [] },
  { c: archived, plans: [] },
  {
    // travel override extends the end by 7 days: 2026-07-27 → 2026-08-03
    c: client("cl-803", {
      engagement_status: "signed_up",
      weight_loss: {
        enabled: true,
        week_overrides: [{ date_from: "2026-06-10", date_to: "2026-06-16", context: "travel", mode: "maintenance" }],
      },
    }),
    plans: [plan("travel-plan", "cl-803", { plan_period_start: "2026-05-01" })],
  },
];

const BUCKET_DIR: Record<string, string> = {
  published: "published",
  draft: "drafts",
  ready_to_publish: "ready",
  superseded: "superseded",
  revoked: "revoked",
};

describe("lifecycle.py mirrors lifecycle.ts", () => {
  it(
    "resolves every fixture to the same state, since, plan and end date",
    () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "fm-lifecycle-"));
      const decisions: Record<string, { decision: string; at: string }> = {};
      for (const f of FIXTURES) {
        const dir = path.join(root, "clients", f.c.client_id);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "client.yaml"), yaml.dump(f.c));
        for (const p of f.plans) {
          const bucket = BUCKET_DIR[p._bucket ?? p.status ?? "published"] ?? "published";
          fs.mkdirSync(path.join(root, bucket), { recursive: true });
          const { _bucket, ...rest } = p;
          void _bucket;
          fs.writeFileSync(path.join(root, bucket, `${p.slug}-v1.yaml`), yaml.dump(rest));
        }
        for (const [slug, d] of Object.entries(f.decisions ?? {})) {
          decisions[slug] = { decision: d.decision, at: "2026-10-01T00:00:00Z" };
        }
      }
      fs.writeFileSync(path.join(root, "_renewal_decisions.yaml"), yaml.dump(decisions));

      const out = execFileSync(
        TEST_PYTHON,
        [path.resolve(__dirname, "../../../scripts/lifecycle-report.py")],
        { input: JSON.stringify({ today: TODAY, plans_root: root }), encoding: "utf-8" },
      );
      const py = JSON.parse(out) as { ok: boolean; lifecycles: Record<string, Record<string, unknown>> };
      expect(py.ok).toBe(true);

      const allPlans = FIXTURES.flatMap((f) => f.plans);
      const allDecisions = Object.fromEntries(
        FIXTURES.flatMap((f) => Object.entries(f.decisions ?? {})),
      );
      for (const f of FIXTURES) {
        const ts = resolveLifecycle(f.c, allPlans, TODAY, { decisions: allDecisions });
        const p = py.lifecycles[f.c.client_id];
        expect(p, `python result for ${f.c.client_id}`).toBeDefined();
        const pick = (o: Record<string, unknown>) => ({
          state: o.state,
          since: o.since ?? null,
          planSlug: o.planSlug ?? null,
          planEndsOn: o.planEndsOn ?? null,
          daysSinceEnd: o.daysSinceEnd ?? null,
          declined: o.declined,
          optedOut: o.optedOut,
          engagement: o.engagement,
          reason: o.reason,
        });
        expect(pick(p), f.c.client_id).toEqual(pick(ts as unknown as Record<string, unknown>));
      }
      fs.rmSync(root, { recursive: true, force: true });
    },
    PY_TEST_TIMEOUT_MS,
  );
});

// ── the nightly stamp (renewal sweep → client.yaml) ─────────────────────────

describe("stamp_lifecycles (via the renewal sweep)", () => {
  it(
    "writes lifecycle + lifecycle_since, clears a stale next_contact_date on the way out, touches nothing else",
    () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "fm-stamp-"));
      const write = (c: LifecycleClientLike & Record<string, unknown>, plansFor: LifecyclePlanLike[]) => {
        const dir = path.join(root, "clients", c.client_id);
        fs.mkdirSync(dir, { recursive: true });
        // Hand-written YAML with a deliberately odd scalar, to prove the stamp
        // is a line edit and not a yaml round-trip (which would re-quote it).
        fs.writeFileSync(
          path.join(dir, "client.yaml"),
          `client_id: ${c.client_id}\ndisplay_name: ${c.display_name}\nintake_date: '${c.intake_date}'\n` +
            `engagement_status: ${c.engagement_status}\n` +
            (c.next_contact_date ? `next_contact_date: '${c.next_contact_date}'\n` : "") +
            (c.maintenance_paid_through ? `maintenance_paid_through: '${c.maintenance_paid_through}'\n` : "") +
            `odd_value: 15_30\n`,
        );
        for (const p of plansFor) {
          fs.mkdirSync(path.join(root, "published"), { recursive: true });
          const { _bucket, ...rest } = p;
          void _bucket;
          fs.writeFileSync(path.join(root, "published", `${p.slug}-v1.yaml`), yaml.dump(rest));
        }
      };
      write(niti as LifecycleClientLike & Record<string, unknown>, nitiPlans); // maintenance, stale ncd
      write({ ...geetika, next_contact_date: "2026-10-20" }, geetikaPlans); // ending, ncd kept

      const script = `
import json, pathlib, datetime
from fmdb.plan.lifecycle import stamp_lifecycles
rep = stamp_lifecycles(pathlib.Path(${JSON.stringify(root)}), datetime.date(2026, 10, 23), apply=True)
print(json.dumps(rep, default=str))
`;
      const rep = JSON.parse(
        execFileSync(TEST_PYTHON, ["-c", script], {
          cwd: FMDB,
          env: { ...process.env, PYTHONPATH: FMDB },
          encoding: "utf8",
        }),
      ) as { stamped: Array<{ client_id: string; to: string }>; next_contact_cleared: Array<{ client_id: string }> };
      expect(rep.stamped.map((s) => `${s.client_id}:${s.to}`).sort()).toEqual(["cl-006:ending", "cl-014:maintenance"]);
      expect(rep.next_contact_cleared.map((s) => s.client_id)).toEqual(["cl-014"]);

      const nitiYaml = fs.readFileSync(path.join(root, "clients", "cl-014", "client.yaml"), "utf8");
      expect(nitiYaml).toContain("lifecycle: 'maintenance'");
      expect(nitiYaml).toContain("lifecycle_since: '2026-09-07'");
      expect(nitiYaml).not.toContain("next_contact_date");
      expect(nitiYaml).toContain("odd_value: 15_30"); // untouched
      const geetikaYaml = fs.readFileSync(path.join(root, "clients", "cl-006", "client.yaml"), "utf8");
      expect(geetikaYaml).toContain("lifecycle: 'ending'");
      expect(geetikaYaml).toContain("next_contact_date: '2026-10-20'"); // still in care: kept

      // Idempotent: a second pass changes nothing.
      const rep2 = JSON.parse(
        execFileSync(TEST_PYTHON, ["-c", script], { cwd: FMDB, env: { ...process.env, PYTHONPATH: FMDB }, encoding: "utf8" }),
      ) as { stamped: unknown[]; next_contact_cleared: unknown[] };
      expect(rep2.stamped).toEqual([]);
      expect(rep2.next_contact_cleared).toEqual([]);
      fs.rmSync(root, { recursive: true, force: true });
    },
    PY_TEST_TIMEOUT_MS,
  );
});
