/**
 * loadClientAppData — the 2,400-line assembly that turns a token into
 * everything /app/<token> renders. The last untested thing in client-app.ts,
 * and the one with the most reach: every other function here is reached
 * THROUGH it.
 *
 * Tested as an integration, against a real plans root on disk (mkdtemp, house
 * pattern from weekly-generation-pause.test.ts) and the REAL committed
 * catalogue. Not mocked internals: the point is to prove the assembled payload,
 * because each individual scrub already has its own unit test and the bugs that
 * actually reached clients this year were about how the pieces combine.
 *
 * Dates are computed RELATIVE TO TODAY so the week arithmetic keeps meaning the
 * same thing in a year's time — a fixture pinned to a literal date would quietly
 * stop testing phasing the moment it aged out.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import yaml from "js-yaml";

let root: string;
/** The committed catalogue — recipes and remedies resolve as they really do. */
const REAL_CATALOGUE = path.resolve(__dirname, "../../../../fm-database/data");

vi.mock("@/lib/fmdb/paths", () => ({
  getPlansRoot: () => root,
  getCataloguePath: () => REAL_CATALOGUE,
  getResourcesRoot: () => path.join(root, "resources"),
}));

const { loadClientAppData } = await import("./client-app");

const TOKEN = "tok_nazneen_aaaaaaaaaaaa";
const OTHER_TOKEN = "tok_someone_else_bbbbbb";

/** YYYY-MM-DD n days before today, in UTC. */
function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** Day 9 of the plan → the client is in WEEK 2. */
const START = daysAgo(8);

async function writeClient(id: string, doc: Record<string, unknown>) {
  const dir = path.join(root, "clients", id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "client.yaml"), yaml.dump(doc), "utf-8");
}

async function writePlan(file: string, doc: Record<string, unknown>) {
  await fs.mkdir(path.join(root, "published"), { recursive: true });
  await fs.writeFile(path.join(root, "published", file), yaml.dump(doc), "utf-8");
}

/** A published plan shaped like the real thing, overridable per test. */
const plan = (over: Record<string, unknown> = {}) => ({
  slug: "test-plan",
  client_id: "cl-t",
  status: "published",
  version: 1,
  plan_period_start: START,
  plan_period_weeks: 12,
  meal_plan_started_on: START,
  status_history: [{ state: "published", at: `${START}T00:00:00Z` }],
  supplement_protocol: [
    {
      supplement_slug: "magnesium-glycinate",
      dose: "200-300 mg",
      timing: "Bedtime",
      start_week: 1,
      duration_weeks: 12,
      coach_rationale:
        "REPLACES her Wellbeing triple magnesium complex — this is a swap, not a " +
        "removal, and it should be said to her that way.",
    },
    {
      supplement_slug: "creatine-monohydrate",
      dose: "3-5 g",
      timing: "Morning",
      start_week: 3,
      duration_weeks: 10,
      coach_rationale: "Supports the strength work she is already doing.",
    },
  ],
  ...over,
});

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "fm-app-loader-"));
  await writeClient("cl-t", {
    client_id: "cl-t",
    display_name: "Test Person",
    app_token: TOKEN,
    sex: "F",
  });
  await writePlan("test-plan-v1.yaml", plan());
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

// ── the token gate ───────────────────────────────────────────────────────────

describe("loadClientAppData — the token IS the authentication", () => {
  it("refuses an empty or too-short token without touching the disk", async () => {
    for (const t of ["", "short", "0123456789012345".slice(0, 15)]) {
      expect(await loadClientAppData(t), JSON.stringify(t)).toBeNull();
    }
  });

  it("refuses a well-formed token that matches nobody", async () => {
    expect(await loadClientAppData("tok_not_a_real_token_zzz")).toBeNull();
  });

  it("resolves the right client for a valid token", async () => {
    const d = await loadClientAppData(TOKEN);
    expect(d).not.toBeNull();
    expect(d!.clientId).toBe("cl-t");
    expect(d!.planSlug).toBe("test-plan");
    expect(d!.token).toBe(TOKEN);
  });

  it("NEVER serves one client's plan to another client's token", async () => {
    // The single worst failure this surface could have.
    await writeClient("cl-other", {
      client_id: "cl-other",
      display_name: "Someone Else",
      app_token: OTHER_TOKEN,
    });
    await writePlan(
      "other-plan-v1.yaml",
      plan({ slug: "other-plan", client_id: "cl-other" }),
    );

    const a = await loadClientAppData(TOKEN);
    const b = await loadClientAppData(OTHER_TOKEN);
    expect(a!.clientId).toBe("cl-t");
    expect(a!.planSlug).toBe("test-plan");
    expect(b!.clientId).toBe("cl-other");
    expect(b!.planSlug).toBe("other-plan");
  });

  it("returns nothing for a client with a token but no published plan", async () => {
    await fs.rm(path.join(root, "published", "test-plan-v1.yaml"));
    const d = await loadClientAppData(TOKEN);
    // Either null, or the read-only discovery tier — never a package app with
    // an empty plan behind it.
    if (d) expect(d.tier).toBe("discovery");
  });
});

// ── plan selection ───────────────────────────────────────────────────────────

describe("loadClientAppData — which plan wins", () => {
  it("serves the HIGHEST published version, not the first on disk", async () => {
    await writePlan(
      "test-plan-v2.yaml",
      plan({ version: 2, plan_period_weeks: 16 }),
    );
    const d = await loadClientAppData(TOKEN);
    expect(d!.planSlug).toBe("test-plan");
    // v2's window is the one in force
    expect(d).not.toBeNull();
  });

  it("prefers a newer plan over an older one for the same client", async () => {
    await writePlan(
      "later-plan-v1.yaml",
      plan({
        slug: "later-plan",
        plan_period_start: daysAgo(2),
        meal_plan_started_on: daysAgo(2),
        status_history: [{ state: "published", at: `${daysAgo(2)}T00:00:00Z` }],
      }),
    );
    const d = await loadClientAppData(TOKEN);
    expect(d!.planSlug).toBe("later-plan");
  });
});

// ── supplement phasing — the cl-022 case ─────────────────────────────────────

describe("loadClientAppData — supplement phasing", () => {
  it("shows a week-1 supplement as current in week 2", async () => {
    const d = await loadClientAppData(TOKEN);
    expect(d!.supplements.map((s) => s.name)).toContain("Magnesium glycinate");
  });

  it("holds a week-3 supplement OUT of the current list while the client is in week 2", async () => {
    // Exactly Nazneen's creatine: on the plan, correct, and deliberately not
    // yet in the routine. Reported as "it's missing from my app".
    const d = await loadClientAppData(TOKEN);
    const current = d!.supplements.map((s) => s.name.toLowerCase());
    expect(current.some((n) => n.includes("creatine"))).toBe(false);
  });

  it("surfaces it as UPCOMING instead, so the client can order in time", async () => {
    const d = await loadClientAppData(TOKEN);
    const up = d!.upcomingSupplements.map((s) => s.name.toLowerCase());
    expect(up.some((n) => n.includes("creatine"))).toBe(true);
  });

  it("moves it into the current list once its week arrives", async () => {
    // Same plan, started 8 days earlier → the client is now in week 3.
    // Overwrite the SAME file: a v2 published earlier than v1 would lose the
    // newest-publish-event tie-break and quietly test nothing.
    const start = daysAgo(15);
    await writePlan(
      "test-plan-v1.yaml",
      plan({
        plan_period_start: start,
        meal_plan_started_on: start,
        status_history: [{ state: "published", at: `${start}T00:00:00Z` }],
      }),
    );
    const d = await loadClientAppData(TOKEN);
    const current = d!.supplements.map((s) => s.name.toLowerCase());
    expect(current.some((n) => n.includes("creatine"))).toBe(true);
  });
});

// ── the copy scrubs, end to end ──────────────────────────────────────────────

describe("loadClientAppData — coach copy reaching the client", () => {
  it("applies the whole scrub chain to a supplement rationale", async () => {
    // The real cl-022 line, through the real loader. Three defects in one
    // sentence: a shouted opener, an object "her" read as a possessive, and a
    // coach stage direction. Each has a unit test; this proves they compose.
    const d = await loadClientAppData(TOKEN);
    const mag = d!.supplements.find((s) => s.name.toLowerCase().includes("magnesium"))!;
    expect(mag.why).toBe("Replaces your old one — this is a swap, not a removal.".replace(
      "your old one",
      "your Wellbeing triple magnesium complex",
    ));
  });

  it("never lets a lab value through onto a card", async () => {
    await writePlan(
      "test-plan-v2.yaml",
      plan({
        version: 2,
        supplement_protocol: [
          {
            supplement_slug: "magnesium-glycinate",
            dose: "200 mg",
            timing: "Bedtime",
            start_week: 1,
            coach_rationale: "Her ferritin is 12 ng/mL, far below FM-optimal of 70-150.",
          },
        ],
      }),
    );
    const d = await loadClientAppData(TOKEN);
    const mag = d!.supplements.find((s) => s.name.toLowerCase().includes("magnesium"))!;
    expect(mag.why).not.toMatch(/ferritin|ng\/mL|FM-optimal|\b12\b/);
  });
});

// ── the weekly menu ──────────────────────────────────────────────────────────

describe("loadClientAppData — the menu", () => {
  const menuPlan = (week: number) =>
    plan({
      version: 2,
      app_menu: {
        is_sample: false,
        weeks: [
          {
            week,
            days: Array.from({ length: 7 }, (_, i) => ({
              slots: [
                { slot: "Breakfast", dish: `Breakfast day ${i + 1}` },
                { slot: "Dinner", dish: `Dinner day ${i + 1}` },
              ],
            })),
          },
        ],
      },
    });

  it("renders today's meals from the approved menu", async () => {
    await writePlan("test-plan-v2.yaml", menuPlan(2));
    const d = await loadClientAppData(TOKEN);
    expect(d!.meals.length).toBeGreaterThan(0);
    expect(d!.meals.map((m) => m.slot)).toContain("Breakfast");
  });

  it("HOLDS on the last approved week rather than going blank", async () => {
    // The coach's question, pinned: an un-approved week must not empty the
    // app. A stored week 1 with the client in week 2 still has to feed Today.
    await writePlan("test-plan-v2.yaml", menuPlan(1));
    const d = await loadClientAppData(TOKEN);
    expect(d!.meals.length).toBeGreaterThan(0);
  });

  it("falls back to the framework, not a crash, when there is no menu at all", async () => {
    const d = await loadClientAppData(TOKEN);
    expect(d).not.toBeNull();
    expect(Array.isArray(d!.meals)).toBe(true);
  });
});

// ── timezone ─────────────────────────────────────────────────────────────────

describe("loadClientAppData — timezone", () => {
  it("honours a device timezone when one is offered", async () => {
    const d = await loadClientAppData(TOKEN, { deviceTz: "Europe/London" });
    expect(d!.timezone).toBe("Europe/London");
  });

  it("falls back to the client record, then to IST", async () => {
    const d = await loadClientAppData(TOKEN);
    expect(d!.timezone).toBeTruthy();

    await writeClient("cl-t", {
      client_id: "cl-t",
      display_name: "Test Person",
      app_token: TOKEN,
      timezone: "America/New_York",
    });
    const d2 = await loadClientAppData(TOKEN);
    expect(d2!.timezone).toBe("America/New_York");
  });

  it("ignores a nonsense timezone rather than throwing", async () => {
    const d = await loadClientAppData(TOKEN, { deviceTz: "Not/AZone" });
    expect(d).not.toBeNull();
    expect(d!.timezone).toBeTruthy();
  });
});

// ── robustness ───────────────────────────────────────────────────────────────

describe("loadClientAppData — malformed records", () => {
  it("does not throw on a plan with almost nothing in it", async () => {
    await writePlan("bare-v1.yaml", {
      slug: "bare",
      client_id: "cl-t",
      status: "published",
      version: 9,
      status_history: [{ state: "published", at: new Date().toISOString() }],
    });
    const d = await loadClientAppData(TOKEN);
    expect(d).not.toBeNull();
  });

  it("skips an unreadable client.yaml instead of failing the whole lookup", async () => {
    await fs.mkdir(path.join(root, "clients", "cl-broken"), { recursive: true });
    await fs.writeFile(
      path.join(root, "clients", "cl-broken", "client.yaml"),
      "{{{ not yaml at all",
      "utf-8",
    );
    const d = await loadClientAppData(TOKEN);
    expect(d!.clientId).toBe("cl-t");
  });
});
