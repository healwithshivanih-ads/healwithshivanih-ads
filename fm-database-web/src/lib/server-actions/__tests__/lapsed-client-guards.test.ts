/**
 * A lapsed client must cost nothing and appear nowhere in the menu pipeline.
 *
 * The trigger (2026-09-13): Dhanishta (cl-004) and Archana (cl-007) — both
 * `engagement_status: lapsed`, plan windows closed 2026-08-04 / 2026-08-12 —
 * were listed on the dashboard as "⏸ Menu paused — not opening the app", a
 * prompt to chase two people whose programmes had ended a month earlier. The
 * grocery/recipe backfill was still scanning them, the reminder cron was still
 * pushing to them, and the app co-pilot was still live for them.
 *
 * Root cause, in one line: the renewal sweep flips `engagement_status` but
 * never ends, supersedes or revokes the plan, so "has a published plan" — the
 * gate every cron used — stays true forever for a lapsed client.
 *
 * Two orderings are pinned here because both produced the bad row:
 *   1. lapsed must be decided BEFORE the coach-paused / dormancy short-circuits
 *      in the queue scanner (they emit a row and `continue`);
 *   2. "plan window over" must ALSO be decided before those short-circuits —
 *      it used to sit after them, so an over-run plan whose client had gone
 *      quiet rendered as paused instead of finished.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const DAY_MS = 86_400_000;
const ymd = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY_MS).toISOString().slice(0, 10);

function clientYaml(id: string, engagement: string): string {
  return [`client_id: ${id}`, `display_name: ${id}`, `engagement_status: ${engagement}`, ""].join("\n");
}

/** A plan with no weeks loaded → the queue sweep considers the current week due. */
function planYaml(clientId: string, slug: string, startedDaysAgo: number): string {
  return [
    `slug: ${slug}`,
    `client_id: ${clientId}`,
    `meal_plan_started_on: ${ymd(startedDaysAgo)}`,
    "plan_period_weeks: 12",
    "app_menu:",
    "  weeks: []",
    "",
  ].join("\n");
}

/** Last app open long enough ago to trip the dormancy pause (14d default). */
const DORMANT_OPENS = ["opens:", `  - '${new Date(Date.now() - 40 * DAY_MS).toISOString()}'`, ""].join("\n");

let root: string;
let prevRoot: string | undefined;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "fm-plans-lapsed-"));
  await mkdir(path.join(root, "published"), { recursive: true });
  const mk = async (id: string, engagement: string, startedDaysAgo: number, opens?: string) => {
    await mkdir(path.join(root, "clients", id), { recursive: true });
    await writeFile(path.join(root, "clients", id, "client.yaml"), clientYaml(id, engagement));
    if (opens) await writeFile(path.join(root, "clients", id, "_app_opens.yaml"), opens);
    await writeFile(path.join(root, "published", `${id}-plan.yaml`), planYaml(id, `${id}-plan`, startedDaysAgo));
  };
  // Live, mid-plan, due — proves the fixture produces rows at all.
  await mk("cl-live", "signed_up", 3);
  // The cl-004 shape: lapsed, plan window long over, app gone quiet.
  await mk("cl-lapsed", "lapsed", 120, DORMANT_OPENS);
  // Lapsed but still opening the app — the engagement check alone must catch it.
  await mk("cl-lapsed-active-app", "lapsed", 120);
  // NOT lapsed (inside the sweep's 14d grace) but the plan window is over and the
  // app went quiet: the plan-over check must win over the dormancy row.
  await mk("cl-over-dormant", "signed_up", 12 * 7 + 3, DORMANT_OPENS);

  prevRoot = process.env.FMDB_PLANS_DIR;
  process.env.FMDB_PLANS_DIR = root;
});

afterAll(async () => {
  if (prevRoot === undefined) delete process.env.FMDB_PLANS_DIR;
  else process.env.FMDB_PLANS_DIR = prevRoot;
  await rm(root, { recursive: true, force: true });
});

describe("clientIsLapsed", () => {
  it("reads the status off client.yaml and fails OPEN on a missing file", async () => {
    const { clientIsLapsed } = await import("@/lib/fmdb/engagement");
    expect(await clientIsLapsed("cl-lapsed")).toBe(true);
    expect(await clientIsLapsed("cl-live")).toBe(false);
    // Missing file → not lapsed: this guard only withholds automation, and a
    // client with no record must behave exactly as before the guard existed.
    expect(await clientIsLapsed("cl-nobody")).toBe(false);
  });
});

describe("weeklyMenuQueueAction — who the dashboard and the drafter see", () => {
  it("drops lapsed clients and over-run plans, and never as a paused row", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { weeklyMenuQueueAction } = await import("../weekly-menu");
      const rows = await weeklyMenuQueueAction();
      const ids = rows.map((r) => r.clientId);

      expect(ids).toContain("cl-live");

      // Both lapsed shapes are gone — the one that went quiet used to surface
      // as "Menu paused — not opening the app", the one still opening the app
      // used to fall through as an ordinary due row.
      expect(ids).not.toContain("cl-lapsed");
      expect(ids).not.toContain("cl-lapsed-active-app");

      // Plan over + dormant is finished, not paused.
      expect(ids).not.toContain("cl-over-dormant");
      expect(rows.some((r) => r.dormantDays)).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("the three generators refuse a lapsed client before any I/O", () => {
  it("weekly menu draft — even with force", async () => {
    const { generateWeekMenuAction } = await import("../weekly-menu");
    const r = await generateWeekMenuAction("cl-lapsed-active-app", true);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/lapsed/);
  });

  it("grocery list — even with force", async () => {
    const { generateGroceryListAction } = await import("../grocery");
    const r = await generateGroceryListAction("cl-lapsed", "cl-lapsed-plan", { force: true });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/lapsed/);
  });

  it("recipe pack — even with force", async () => {
    const { generateWeekRecipesAction } = await import("../recipes");
    const r = await generateWeekRecipesAction("cl-lapsed", "cl-lapsed-plan", true);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/lapsed/);
  });

  it("but a live client gets past the guard (the refusal is specific, not blanket)", async () => {
    const { generateGroceryListAction } = await import("../grocery");
    const r = await generateGroceryListAction("cl-live", "cl-live-plan");
    // It fails later for a fixture reason (no app token), never for "lapsed".
    expect(r.ok).toBe(false);
    expect(r.error ?? "").not.toMatch(/lapsed/);
  });
});
