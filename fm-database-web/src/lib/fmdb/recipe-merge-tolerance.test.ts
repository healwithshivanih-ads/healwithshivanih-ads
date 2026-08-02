/**
 * One malformed element from the model must never cost the whole recipe pack.
 *
 * Reported 2026-08-02 (cl-006, weekly recipe-pack cron): the model emitted a
 * bare string where a recipe object belongs, `_merge_recipes` called `.get()`
 * on it, and the AttributeError propagated out of main() — so the script
 * printed nothing, the caller saw "produced no output", and cl-006 received no
 * recipe pack at all. The well-formed recipes in that same batch were lost to
 * one bad sibling.
 *
 * This is the bug class already fixed defensively in fmdb/ingest/staging.py,
 * which records-and-skips a non-dict entity instead of aborting the batch.
 * These tests pin the same posture here: skip the bad element, keep the rest,
 * and say on stderr what the model actually produced.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { PY_TEST_TIMEOUT_MS, TEST_PYTHON } from "./test-python";

const REPO = path.resolve(__dirname, "../../../..");
const GEN = path.join(REPO, "fm-database-web/scripts/generate-week-recipes.py");

const SRC = `
import json, sys, importlib.util
spec = importlib.util.spec_from_file_location("gwr", ${JSON.stringify(GEN)})
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
payload = json.load(sys.stdin)
all_recipes, seen = [], set()
added = m._merge_recipes(all_recipes, seen, payload["new"])
sys.stdout.write(json.dumps({"titles": [r.get("title") for r in all_recipes], "added": added}))
`;

/**
 * Drive the real `_merge_recipes` with a list the model might plausibly emit.
 * Returns what survived plus the stderr warnings — the warning matters as much
 * as the survival, because a silent skip in a cron log is indistinguishable
 * from the model simply not returning that dish.
 */
function pythonMerge(newRecipes: unknown): { titles: string[]; added: number; stderr: string } {
  const res = spawnSync(TEST_PYTHON, ["-c", SRC], {
    input: JSON.stringify({ new: newRecipes }),
    encoding: "utf-8",
  });
  expect(res.status, `python exited ${res.status}: ${res.stderr}`).toBe(0);
  return { ...JSON.parse(res.stdout), stderr: res.stderr };
}

const GOOD_A = { title: "Jeera Rice", ingredients: ["rice"], method: ["cook"] };
const GOOD_B = { title: "Palak Sabzi", ingredients: ["spinach"], method: ["cook"] };

describe("_merge_recipes tolerates malformed model output", () => {
  it("keeps the good recipes when a bare string is mixed in (the cl-006 crash)", () => {
    // The exact shape that took down the 2026-08-02 run.
    const { titles, added } = pythonMerge([GOOD_A, "Chana dal soup", GOOD_B]);
    expect(titles).toEqual(["Jeera Rice", "Palak Sabzi"]);
    expect(added).toBe(2);
  }, PY_TEST_TIMEOUT_MS);

  it("says on stderr what the model actually produced", () => {
    const { stderr } = pythonMerge([GOOD_A, "Chana dal soup"]);
    expect(stderr).toMatch(/malformed/i);
    expect(stderr).toContain("str");
    expect(stderr).toContain("Chana dal soup");
  }, PY_TEST_TIMEOUT_MS);

  it("survives null, numbers and nested lists too", () => {
    const { titles, added } = pythonMerge([null, GOOD_A, 42, ["nested"], GOOD_B]);
    expect(titles).toEqual(["Jeera Rice", "Palak Sabzi"]);
    expect(added).toBe(2);
  }, PY_TEST_TIMEOUT_MS);

  it("skips a titleless object rather than merging it under an empty key", () => {
    // Two titleless objects must not collide on "" and shadow one another —
    // both are dropped, and the good one still lands.
    const { titles, added, stderr } = pythonMerge([
      { ingredients: ["x"] },
      GOOD_A,
      { title: "   " },
    ]);
    expect(titles).toEqual(["Jeera Rice"]);
    expect(added).toBe(1);
    expect(stderr).toMatch(/no title/i);
  }, PY_TEST_TIMEOUT_MS);

  it("returns 0 instead of iterating a string when 'recipes' is not a list", () => {
    // `(tool_input or {}).get("recipes") or []` passes a truthy non-list
    // straight through; iterating a string would merge it CHARACTER BY
    // CHARACTER, which is worse than the crash it replaced.
    const { titles, added, stderr } = pythonMerge("Jeera Rice");
    expect(titles).toEqual([]);
    expect(added).toBe(0);
    expect(stderr).toMatch(/expected list/i);
  }, PY_TEST_TIMEOUT_MS);

  it("still dedupes by normalised title, and an all-good batch is untouched", () => {
    // The defensive guard must not change the happy path.
    const { titles, added } = pythonMerge([GOOD_A, { title: "jeera rice" }, GOOD_B]);
    expect(titles).toEqual(["Jeera Rice", "Palak Sabzi"]);
    expect(added).toBe(2);
  }, PY_TEST_TIMEOUT_MS);
});
