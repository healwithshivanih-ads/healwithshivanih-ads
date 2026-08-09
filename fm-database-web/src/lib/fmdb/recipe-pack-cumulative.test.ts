/**
 * The recipe pack is CUMULATIVE and must never shrink.
 *
 * The pack is the client's whole recipe library, grown week by week, and the
 * app renders it as one list. But generate-week-recipes.py only ever sees the
 * weeks currently live on the menu. It used to build its list from empty and
 * write it straight over the file, so every recipe from a week that had rolled
 * off the menu was deleted. cl-022 went 55 recipes -> 18 on 2026-08-09 that
 * way, and the CLIENT reported it before anything in the pipeline noticed.
 *
 * Two behaviours are pinned here, because they fail independently:
 *   1. seeding  — the run carries the existing pack forward and only adds.
 *   2. the guard — if a pack would shrink anyway, refuse to write at all.
 *
 * The guard counts the prior pack from RAW HEADINGS, not from the parser it
 * backstops. That distinction is the whole point: a parser regression is the
 * most likely way seeding silently stops working, and a parser-derived count
 * would read 0 and wave through the exact write it exists to stop.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PY_TEST_TIMEOUT_MS, TEST_PYTHON } from "./test-python";

const REPO = path.resolve(__dirname, "../../../..");
const GEN = path.join(REPO, "fm-database-web/scripts/generate-week-recipes.py");

interface RunResult {
  ok: boolean;
  error?: string;
  count?: number;
  prior_count?: number;
  shrink_blocked?: boolean;
  wrote?: string | null;
}

function pack(titles: string[]): string {
  return (
    "# Recipes\n\n" +
    titles
      .map(
        (t) =>
          `### ✦ ${t}\n**Serves:** 1 | **Time:** 10 min\n\n**Ingredients:**\n- a thing\n\n**Method:**\n1. Cook it.\n`,
      )
      .join("\n")
  );
}

/**
 * Drive the real main() against a temp plans root, with the model stubbed to
 * return `modelReturns` and the write captured instead of performed.
 *
 * `breakParser` simulates the parser regression the guard exists to survive.
 */
function run(opts: {
  onDisk: string[];
  modelReturns: string[];
  dish?: string;
  allowShrink?: boolean;
  breakParser?: boolean;
}): RunResult {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "recipe-pack-"));
  const dir = path.join(root, "clients/cl-test/meal-plans");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "p-recipes.md"), pack(opts.onDisk), "utf-8");

  const src = `
import json, sys, io, importlib.util, types
written = {}
aw = types.ModuleType("atomic_write")
aw.write_text_atomic = lambda p, t: written.__setitem__(str(p), t)
sys.modules["atomic_write"] = aw
ac = types.ModuleType("anthropic_client"); ac.build_client = lambda: object()
sys.modules["anthropic_client"] = ac

spec = importlib.util.spec_from_file_location("gwr", ${JSON.stringify(GEN)})
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)

cfg = json.loads(sys.argv[1])
m._load_dotenv = lambda: None
m._recipes_for = lambda *a, **k: ([{"title": t, "ingredients": ["x"], "method": ["y"]} for t in cfg["model"]], None, False)
if cfg["break_parser"]:
    m._parse_existing_md = lambda p: []

payload = {"client_id": "cl-test", "plan_slug": "p",
           "weeks": [{"week": 1, "days": [{"dow": "Mon", "slots": [{"slot": "Lunch", "dish": cfg["dish"]}]}]}]}
if cfg["allow_shrink"]:
    payload["allow_shrink"] = True

sys.stdin = io.StringIO(json.dumps(payload))
buf = io.StringIO(); real = sys.stdout; sys.stdout = buf
try:
    m.main()
finally:
    sys.stdout = real
res = json.loads(buf.getvalue().strip().splitlines()[-1])
res["wrote"] = next(iter(written.values()), None)
print(json.dumps(res))
`;
  const out = execFileSync(
    TEST_PYTHON,
    [
      "-c",
      src,
      JSON.stringify({
        model: opts.modelReturns,
        dish: opts.dish ?? "Totally New Dish",
        allow_shrink: Boolean(opts.allowShrink),
        break_parser: Boolean(opts.breakParser),
      }),
    ],
    { encoding: "utf-8", env: { ...process.env, FMDB_PLANS_DIR: root }, stdio: ["pipe", "pipe", "pipe"] },
  );
  return JSON.parse(out.trim().split("\n").pop()!) as RunResult;
}

describe("the recipe pack only ever grows", () => {
  it("carries the existing pack forward instead of overwriting it", () => {
    // The regression itself: last week's recipes are not on this week's menu,
    // so the model never returns them. They must survive anyway.
    const r = run({ onDisk: ["Old Dish A", "Old Dish B"], modelReturns: ["Totally New Dish"] });
    expect(r.ok).toBe(true);
    expect(r.count).toBe(3);
    expect(r.wrote).toContain("Old Dish A");
    expect(r.wrote).toContain("Old Dish B");
    expect(r.wrote).toContain("Totally New Dish");
  }, PY_TEST_TIMEOUT_MS);

  it("blocks the write when the pack would shrink, and leaves the old one intact", () => {
    // breakParser kills seeding — exactly how this regresses in practice.
    const r = run({
      onDisk: ["A", "B", "C", "D", "E"],
      modelReturns: ["Totally New Dish"],
      breakParser: true,
    });
    expect(r.ok).toBe(false);
    expect(r.shrink_blocked).toBe(true);
    expect(r.prior_count).toBe(5);
    expect(r.wrote, "nothing may be written when the guard fires").toBeNull();
    expect(r.error).toMatch(/shrink 5 -> 1/);
  }, PY_TEST_TIMEOUT_MS);

  it("counts the prior pack from raw headings, not from the parser it backstops", () => {
    // If prior_count were parser-derived it would read 0 here and the guard
    // would pass the write through. This assertion is the guard's whole value.
    const r = run({ onDisk: ["A", "B", "C"], modelReturns: ["X"], breakParser: true });
    expect(r.prior_count, "must see the 3 on disk despite the dead parser").toBe(3);
  }, PY_TEST_TIMEOUT_MS);

  it("allow_shrink is the deliberate override", () => {
    const r = run({
      onDisk: ["A", "B", "C", "D", "E"],
      modelReturns: ["Totally New Dish"],
      breakParser: true,
      allowShrink: true,
    });
    expect(r.ok).toBe(true);
    expect(r.wrote).toContain("Totally New Dish");
  }, PY_TEST_TIMEOUT_MS);

  it("a first run with no pack on disk still writes", () => {
    // prior_count 0 must not be mistaken for a shrink.
    const r = run({ onDisk: [], modelReturns: ["Totally New Dish"] });
    expect(r.ok).toBe(true);
    expect(r.wrote).toContain("Totally New Dish");
  }, PY_TEST_TIMEOUT_MS);
});
