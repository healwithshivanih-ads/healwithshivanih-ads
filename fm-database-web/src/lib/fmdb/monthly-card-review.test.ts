/**
 * The monthly-card cron's review step, driven through the REAL script
 * (generate-monthly-card.py) against a throwaway plans root.
 *
 * What it pins: a card where something stands out is HELD and the app does
 * not show it; a clean card goes live; the coach can approve without a line
 * or skip the month; and the card lands on the client's maintenance plan, not
 * an older plan still sitting in published/ (Niti, 2026-10-21).
 */
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import yaml from "js-yaml";
import { PY_TEST_TIMEOUT_MS, TEST_PYTHON } from "./test-python";
import { buildEndgame } from "./client-app";

const SCRIPT = path.join(__dirname, "../../../scripts/generate-monthly-card.py");

function setup(client: Record<string, unknown>) {
  const root = mkdtempSync(path.join(tmpdir(), "monthly-card-"));
  mkdirSync(path.join(root, "clients", "cl-t"), { recursive: true });
  mkdirSync(path.join(root, "published"), { recursive: true });
  writeFileSync(path.join(root, "clients", "cl-t", "client.yaml"), yaml.dump({ client_id: "cl-t", ...client }));
  // An older programme plan left in published/ beside the maintenance plan.
  writeFileSync(
    path.join(root, "published", "t-plan-1-cl-t-v1.yaml"),
    yaml.dump({ slug: "t-plan-1-cl-t", client_id: "cl-t", status: "published", plan_period_start: "2026-03-01" }),
  );
  writeFileSync(
    path.join(root, "published", "t-maint-cl-t-v1.yaml"),
    yaml.dump({ slug: "t-maint-cl-t", client_id: "cl-t", status: "published", is_maintenance: true, plan_period_start: "2026-10-01" }),
  );
  return root;
}

function run(root: string, payload: Record<string, unknown>) {
  const r = spawnSync(TEST_PYTHON, [SCRIPT], {
    input: JSON.stringify({ client_id: "cl-t", ...payload }),
    encoding: "utf-8",
    env: { ...process.env, FMDB_PLANS_DIR: root },
    timeout: PY_TEST_TIMEOUT_MS,
  });
  return JSON.parse(r.stdout || "{}") as { ok: boolean; status: string; flags: string[]; error?: string };
}

function cards(root: string, file = "t-maint-cl-t-v1.yaml") {
  const p = yaml.load(readFileSync(path.join(root, "published", file), "utf-8")) as { monthly_cards?: Record<string, Record<string, unknown>> };
  return p.monthly_cards ?? {};
}

describe("monthly card review", () => {
  it(
    "holds a card for a client outside India, and the app does not show it",
    () => {
      const root = setup({ country: "United States of America", dietary_preference: "Eggetarian" });
      const out = run(root, { month: "2026-11", review: true, only_if_missing: true });
      expect(out.ok).toBe(true);
      expect(out.status).toBe("pending_review");
      expect(out.flags.join(" ")).toMatch(/United States/);
      expect(cards(root)["2026-11"].status).toBe("pending_review");
      expect(cards(root, "t-plan-1-cl-t-v1.yaml")).toEqual({}); // not the old plan

      const shown = () =>
        buildEndgame(
          { maintenance_paid_through: "2027-04-01" },
          { status: "published", is_maintenance: true, plan_period_start: "2026-10-01", plan_period_weeks: 26 } as never,
          "2026-11-10",
          cards(root),
        ).endgame?.monthlyCard ?? null;
      expect(shown()).toBeNull();
      // …and the same card shows once approved (so the null above is the hold,
      // not an endgame that never renders a card).
      expect(run(root, { action: "approve", month: "2026-11" }).ok).toBe(true);
      expect(shown()?.dos.length).toBeGreaterThan(0);
    },
    PY_TEST_TIMEOUT_MS,
  );

  it(
    "puts a clean card live, and never rewrites an existing one",
    () => {
      const root = setup({ country: "India", dietary_preference: "Vegetarian" });
      expect(run(root, { month: "2026-11", review: true, only_if_missing: true }).status).toBe("live");
      const first = cards(root)["2026-11"].generated_at;
      const again = run(root, { month: "2026-11", review: true, only_if_missing: true });
      expect(again.ok).toBe(true);
      expect(cards(root)["2026-11"].generated_at).toBe(first);
    },
    PY_TEST_TIMEOUT_MS,
  );

  it(
    "flags a 'do' that names something on the allergy list",
    () => {
      const root = setup({ country: "India", known_allergies: ["Sesame (rash)"] });
      const out = run(root, { month: "2027-01", review: true });
      expect(out.status).toBe("pending_review");
      expect(out.flags.join(" ")).toMatch(/sesame/);
    },
    PY_TEST_TIMEOUT_MS,
  );

  it(
    "approves without a line, or skips the month",
    () => {
      const root = setup({ country: "Canada" });
      run(root, { month: "2026-11", review: true });
      const line = (cards(root)["2026-11"].dos as string[])[0];
      expect(run(root, { action: "approve", month: "2026-11", drop: [line] }).ok).toBe(true);
      const c = cards(root)["2026-11"];
      expect(c.status).toBe("live");
      expect(c.dos as string[]).not.toContain(line);

      run(root, { month: "2026-12", review: true });
      expect(run(root, { action: "skip", month: "2026-12" }).ok).toBe(true);
      expect(cards(root)["2026-12"].status).toBe("skipped");
    },
    PY_TEST_TIMEOUT_MS,
  );
});
