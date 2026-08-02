/**
 * One malformed element from the model must never cost the whole batch.
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
 * These tests pin the same posture across the shims that consume model output:
 * skip the bad element, keep the rest, and say on stderr what the model
 * actually produced.
 *
 * The shape check itself now lives once, in scripts/model_output.py — every
 * site below routes through it. What is NOT shared is what to do when nothing
 * survives, because that depends on what the client experiences if the artifact
 * is quietly incomplete: a recipe pack drops the dish, a grocery list bails
 * (the client shops from it), a recipe coerces a bare-string ingredient rather
 * than write an ingredient-less recipe to the catalogue.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PY_TEST_TIMEOUT_MS, TEST_PYTHON } from "./test-python";

const REPO = path.resolve(__dirname, "../../../..");
const SCRIPTS = path.join(REPO, "fm-database-web/scripts");

/** Load a shim by path and run `body` against it, returning stdout + stderr. */
function runAgainstShim(
  script: string,
  body: string,
  input: unknown,
): { stdout: string; stderr: string } {
  const src = `
import json, sys, importlib.util
spec = importlib.util.spec_from_file_location("shim", ${JSON.stringify("__SCRIPT__")})
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
payload = json.load(sys.stdin)
${body}
`.replace("__SCRIPT__", path.join(SCRIPTS, script));
  const res = spawnSync(TEST_PYTHON, ["-c", src], {
    input: JSON.stringify(input),
    encoding: "utf-8",
  });
  expect(res.status, `python exited ${res.status}: ${res.stderr}`).toBe(0);
  return { stdout: res.stdout, stderr: res.stderr };
}

/**
 * Drive the real `_merge_recipes` with a list the model might plausibly emit.
 * Returns what survived plus the stderr warnings — the warning matters as much
 * as the survival, because a silent skip in a cron log is indistinguishable
 * from the model simply not returning that dish.
 */
function pythonMerge(newRecipes: unknown): { titles: string[]; added: number; stderr: string } {
  const { stdout, stderr } = runAgainstShim(
    "generate-week-recipes.py",
    `all_recipes, seen = [], set()
added = m._merge_recipes(all_recipes, seen, payload["new"])
sys.stdout.write(json.dumps({"titles": [r.get("title") for r in all_recipes], "added": added}))`,
    { new: newRecipes },
  );
  return { ...JSON.parse(stdout), stderr };
}

/** Drive the real `_usable_weeks` from the grocery shim. */
function pythonWeeks(raw: unknown, wkNo = 3): { weeks: Record<string, unknown>[]; stderr: string } {
  const { stdout, stderr } = runAgainstShim(
    "generate-grocery-list.py",
    `sys.stdout.write(json.dumps(m._usable_weeks(payload["raw"], payload["wk"])))`,
    { raw, wk: wkNo },
  );
  return { weeks: JSON.parse(stdout), stderr };
}

const GOOD_A = { title: "Jeera Rice", ingredients: ["rice"], method: ["cook"] };
const GOOD_B = { title: "Palak Sabzi", ingredients: ["spinach"], method: ["cook"] };

/**
 * The shared guard every site below now routes through. Tested directly as
 * well as through its callers, because a subtle change here (dropping the
 * warning, say) would weaken all of them at once.
 */
describe("usable_dicts — the shared shape guard", () => {
  function usableDicts(raw: unknown, label = "test", field = "entry") {
    const { stdout, stderr } = runAgainstShim(
      "model_output.py",
      `sys.stdout.write(json.dumps(m.usable_dicts(payload["raw"], payload["label"], payload["field"])))`,
      { raw, label, field },
    );
    return { kept: JSON.parse(stdout) as unknown[], stderr };
  }

  it("keeps the dicts and drops everything else", () => {
    const { kept } = usableDicts([{ a: 1 }, "str", null, 42, ["nested"], { b: 2 }]);
    expect(kept).toEqual([{ a: 1 }, { b: 2 }]);
  }, PY_TEST_TIMEOUT_MS);

  it("never skips silently — names the type and shows the sample", () => {
    const { stderr } = usableDicts([{ a: 1 }, "add magnesium 400mg"], "rework", "suggested change");
    expect(stderr).toMatch(/malformed suggested change/i);
    expect(stderr).toContain("[rework]");
    expect(stderr).toContain("str");
    expect(stderr).toContain("add magnesium 400mg");
  }, PY_TEST_TIMEOUT_MS);

  it("refuses to iterate a bare string element-by-element", () => {
    // The failure this exists to prevent: a string is iterable, so walking it
    // yields one junk entry PER CHARACTER — quieter than the crash, and worse.
    const { kept, stderr } = usableDicts("Jeera Rice");
    expect(kept).toEqual([]);
    expect(stderr).toMatch(/expected list/i);
  }, PY_TEST_TIMEOUT_MS);

  it("treats an absent list as an ordinary empty, with no warning noise", () => {
    // `x.get("items")` returning None is normal, not a malformation — warning
    // on it would train the coach to ignore the warnings that matter.
    const { kept, stderr } = usableDicts(null);
    expect(kept).toEqual([]);
    expect(stderr.trim()).toBe("");
  }, PY_TEST_TIMEOUT_MS);

  it("truncates a huge sample instead of dumping it into the cron log", () => {
    const { stderr } = usableDicts([{ ok: 1 }, "x".repeat(5000)]);
    expect(stderr.length).toBeLessThan(400);
    expect(stderr).toContain("…");
  }, PY_TEST_TIMEOUT_MS);

  it("leaves an all-good list exactly as it found it", () => {
    const { kept, stderr } = usableDicts([GOOD_A, GOOD_B]);
    expect(kept).toEqual([GOOD_A, GOOD_B]);
    expect(stderr.trim()).toBe("");
  }, PY_TEST_TIMEOUT_MS);
});

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

/**
 * The grocery list is the recipe pack's sibling — same weekly-menu approval
 * path, same cron, same client-facing artifact. It had the identical exposure
 * one file over: `for gw in tool_input["weeks"]: gw["week"] = wk_no` raises
 * TypeError on a bare string, losing the whole list.
 *
 * One difference is deliberate: a week that yields NOTHING usable still bails
 * (see main()), because a grocery list silently missing a week is worse than
 * no list at all — the client shops from it.
 */
describe("_usable_weeks tolerates malformed model output", () => {
  const WEEK_A = { week: 1, sections: [{ name: "Vegetables", items: ["bottle gourd"] }] };
  const WEEK_B = { week: 1, sections: [{ name: "Pulses", items: ["masoor dal"] }] };

  it("keeps the good weeks when a bare string is mixed in", () => {
    const { weeks } = pythonWeeks([WEEK_A, "Vegetables: bottle gourd", WEEK_B]);
    expect(weeks).toHaveLength(2);
    expect(weeks.map((w) => w.sections)).toEqual([WEEK_A.sections, WEEK_B.sections]);
  }, PY_TEST_TIMEOUT_MS);

  it("still stamps the source week number over whatever the model echoed", () => {
    // The whole reason the caller was mutating in place: the model echoes
    // week 1 regardless of which week it was actually given.
    const { weeks } = pythonWeeks([WEEK_A], 3);
    expect(weeks[0].week).toBe(3);
  }, PY_TEST_TIMEOUT_MS);

  it("says on stderr what the model actually produced", () => {
    const { stderr } = pythonWeeks([WEEK_A, "Vegetables: bottle gourd"]);
    expect(stderr).toMatch(/malformed/i);
    expect(stderr).toContain("str");
    expect(stderr).toContain("bottle gourd");
  }, PY_TEST_TIMEOUT_MS);

  it("returns nothing when every entry is malformed, so main() can bail", () => {
    const { weeks } = pythonWeeks(["a", null, 7]);
    expect(weeks).toEqual([]);
  }, PY_TEST_TIMEOUT_MS);

  it("returns nothing instead of iterating a string when 'weeks' is not a list", () => {
    const { weeks, stderr } = pythonWeeks("Vegetables: bottle gourd");
    expect(weeks).toEqual([]);
    expect(stderr).toMatch(/expected list/i);
  }, PY_TEST_TIMEOUT_MS);
});

/**
 * The cleanup analyser had the enclosing-layer version of this bug: it filtered
 * `members` by isinstance(str) but took the GROUP object holding them on faith,
 * so `g.get("kind")` on a bare string raised AttributeError and cost the whole
 * plan — 40-odd reviewed suggestions lost to one.
 *
 * Skip-and-continue is clearly right: every group is reviewed in
 * /catalogue/cleanup before anything is applied, so a dropped group is one
 * fewer suggestion, not a wrong artifact.
 */
describe("_enriched_groups tolerates malformed model output", () => {
  const GROUP = {
    kind: "duplicate_topics",
    canonical: "hypothyroidism",
    members: ["low-thyroid", "underactive-thyroid"],
    reason: "same condition, three slugs",
  };

  function pythonGroups(raw: unknown): { groups: Record<string, unknown>[]; stderr: string } {
    const { stdout, stderr } = runAgainstShim(
      "analyze-catalogue-duplicates.py",
      `sys.stdout.write(json.dumps(m._enriched_groups(payload["raw"])))`,
      { raw },
    );
    return { groups: JSON.parse(stdout), stderr };
  }

  it("keeps the good groups when a bare string is mixed in", () => {
    const other = { ...GROUP, canonical: "pcos", members: ["pcod"] };
    const { groups } = pythonGroups([GROUP, "merge the thyroid ones", other]);
    expect(groups.map((g) => g.canonical)).toEqual(["hypothyroidism", "pcos"]);
  }, PY_TEST_TIMEOUT_MS);

  it("says on stderr what the model actually produced", () => {
    const { stderr } = pythonGroups([GROUP, "merge the thyroid ones"]);
    expect(stderr).toMatch(/malformed group/i);
    expect(stderr).toContain("str");
    expect(stderr).toContain("merge the thyroid ones");
  }, PY_TEST_TIMEOUT_MS);

  it("still drops non-string members inside a group it kept", () => {
    // The inner filter that was already here must survive the outer one.
    const { groups } = pythonGroups([{ ...GROUP, members: ["low-thyroid", 7, null, ""] }]);
    expect(groups[0].members).toEqual(["low-thyroid"]);
  }, PY_TEST_TIMEOUT_MS);

  it("returns nothing instead of iterating a string when 'groups' is not a list", () => {
    const { groups, stderr } = pythonGroups("merge the thyroid ones");
    expect(groups).toEqual([]);
    expect(stderr).toMatch(/expected list/i);
  }, PY_TEST_TIMEOUT_MS);

  it("leaves a well-formed plan untouched, id included", () => {
    const { groups, stderr } = pythonGroups([GROUP]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ kind: GROUP.kind, members: GROUP.members, reason: GROUP.reason });
    expect(groups[0].id).toEqual(expect.any(String));
    expect(stderr.trim()).toBe("");
  }, PY_TEST_TIMEOUT_MS);
});

/**
 * The rework suggestion is the one case where the crash would land in a
 * DIFFERENT script on a DIFFERENT day: this list is persisted to
 * client.yaml#rework_suggestion, and apply-rework.py later does
 * `for c in changes: c.get("op")` on it. Filtering on the way in means the
 * record on disk is well-formed; apply-rework guards its read as well, for
 * records written before this landed.
 */
describe("_build_suggestion tolerates malformed model output", () => {
  const CHANGE = {
    op: "add",
    target_kind: "supplement",
    target_slug: "magnesium-glycinate",
    description: "Add magnesium glycinate 400 mg at bedtime",
  };

  function pythonSuggestion(
    toolInput: Record<string, unknown>,
    prior: unknown = null,
  ): { suggestion: Record<string, unknown>; stderr: string } {
    const { stdout, stderr } = runAgainstShim(
      "assess-rework.py",
      `sys.stdout.write(json.dumps(m._build_suggestion(payload["tool"], "quick_note", payload["prior"])))`,
      { tool: toolInput, prior },
    );
    return { suggestion: JSON.parse(stdout), stderr };
  }

  it("persists only the well-formed changes when a bare string is mixed in", () => {
    const { suggestion } = pythonSuggestion({
      benefit_pct: 40,
      suggested_changes: [CHANGE, "add magnesium 400mg at night", { ...CHANGE, op: "remove" }],
    });
    expect(suggestion.suggested_changes).toHaveLength(2);
    expect((suggestion.suggested_changes as Record<string, unknown>[]).map((c) => c.op)).toEqual([
      "add",
      "remove",
    ]);
  }, PY_TEST_TIMEOUT_MS);

  it("says on stderr what the model actually produced", () => {
    const { stderr } = pythonSuggestion({
      benefit_pct: 40,
      suggested_changes: [CHANGE, "add magnesium 400mg at night"],
    });
    expect(stderr).toMatch(/malformed suggested change/i);
    expect(stderr).toContain("str");
    expect(stderr).toContain("add magnesium 400mg at night");
  }, PY_TEST_TIMEOUT_MS);

  it("writes an empty list rather than a poisoned one when every change is malformed", () => {
    // apply-rework then reports applied_count: 0, the same as it already does
    // for a change whose op it doesn't recognise. No new failure mode.
    const { suggestion } = pythonSuggestion({ benefit_pct: 5, suggested_changes: ["a", null] });
    expect(suggestion.suggested_changes).toEqual([]);
  }, PY_TEST_TIMEOUT_MS);

  it("still carries a prior dismissal forward when the benefit hasn't jumped", () => {
    // The guard must not disturb the surrounding record-building.
    const { suggestion } = pythonSuggestion(
      { benefit_pct: 30, suggested_changes: [CHANGE] },
      { benefit_pct: 25, dismissed_at: "2026-07-01T00:00:00Z" },
    );
    expect(suggestion.dismissed_at).toBe("2026-07-01T00:00:00Z");
  }, PY_TEST_TIMEOUT_MS);

  it("drops a prior dismissal when the benefit has jumped", () => {
    const { suggestion } = pythonSuggestion(
      { benefit_pct: 80, suggested_changes: [CHANGE] },
      { benefit_pct: 25, dismissed_at: "2026-07-01T00:00:00Z" },
    );
    expect(suggestion.dismissed_at).toBeUndefined();
  }, PY_TEST_TIMEOUT_MS);
});

/**
 * Intake insights already degraded rather than crashed — the try/except turned
 * the TypeError into ok:false. But that traded ONE bad hypothesis for the whole
 * block: patterns, red flags and verify-in-session too. It is expensive here
 * because insights auto-fire exactly once, on first submit, and never
 * regenerate on their own, so the coach silently walks into the first session
 * with nothing unless they notice and hit 🔄 Refresh.
 */
describe("_build_insights tolerates malformed model output", () => {
  const HYP = { driver: "post-antibiotic dysbiosis", confidence: 0.7, reasoning: "3 courses in 18mo" };
  const TOOL = {
    patterns: ["bloating after every meal", "wakes at 3am"],
    red_flags: ["unexplained weight loss"],
    verify_in_session: ["confirm antibiotic dates"],
    top_hypotheses: [HYP],
  };

  function pythonInsights(toolInput: Record<string, unknown>): {
    insights: Record<string, unknown>;
    stderr: string;
  } {
    const { stdout, stderr } = runAgainstShim(
      "generate-intake-insights.py",
      `ins = m._build_insights(payload["tool"], "claude-haiku-4-5", "coach notes")
sys.stdout.write(ins.model_dump_json())`,
      { tool: toolInput },
    );
    return { insights: JSON.parse(stdout), stderr };
  }

  it("keeps the rest of the block when one hypothesis is a bare string", () => {
    const { insights } = pythonInsights({
      ...TOOL,
      top_hypotheses: [HYP, "adrenal involvement"],
    });
    expect(insights.top_hypotheses).toHaveLength(1);
    // The point of the fix: these three used to be lost along with it.
    expect(insights.patterns).toEqual(TOOL.patterns);
    expect(insights.red_flags).toEqual(TOOL.red_flags);
    expect(insights.verify_in_session).toEqual(TOOL.verify_in_session);
  }, PY_TEST_TIMEOUT_MS);

  it("says on stderr what the model actually produced", () => {
    const { stderr } = pythonInsights({ ...TOOL, top_hypotheses: [HYP, "adrenal involvement"] });
    expect(stderr).toMatch(/malformed hypothesis/i);
    expect(stderr).toContain("str");
    expect(stderr).toContain("adrenal involvement");
  }, PY_TEST_TIMEOUT_MS);

  it("still raises on a dict with the wrong fields, so nothing half-understood is written", () => {
    // A fumbled ITEM is tolerable; a misunderstood SCHEMA is not, and the
    // caller's try/except still turns this into ok:false.
    expect(() =>
      pythonInsights({ ...TOOL, top_hypotheses: [{ hypothesis: "not the field name" }] }),
    ).toThrow();
  }, PY_TEST_TIMEOUT_MS);

  it("leaves a well-formed block untouched", () => {
    const { insights, stderr } = pythonInsights(TOOL);
    expect(insights.top_hypotheses).toHaveLength(1);
    expect((insights.top_hypotheses as Record<string, unknown>[])[0]).toMatchObject({
      driver: HYP.driver,
      confidence: HYP.confidence,
    });
    expect(insights.coach_notes_for_ai).toBe("coach notes");
    expect(stderr.trim()).toBe("");
  }, PY_TEST_TIMEOUT_MS);
});

/**
 * The assess history bundle is the most expensive shape of this bug, because
 * `ai_analysis` is model output PERSISTED into the session YAML and replayed as
 * context for every LATER assessment. One malformed element written once would
 * abort that client's assess today, tomorrow and every time after, with nothing
 * in the failure pointing back at the session that wrote it.
 *
 * Fails soft at every layer: a partial history is worth far more than a failed
 * assessment, since the AI reads this to orient against what was already tried.
 */
describe("_history_ai_summary tolerates malformed persisted analysis", () => {
  function pythonHistory(aiAnalysis: unknown): {
    summary: Record<string, unknown>;
    stderr: string;
  } {
    const { stdout, stderr } = runAgainstShim(
      "assess.py",
      `sys.stdout.write(json.dumps(m._history_ai_summary(payload["ai"])))`,
      { ai: aiAnalysis },
    );
    return { summary: JSON.parse(stdout), stderr };
  }

  const AI = {
    synthesis_notes: "prior take",
    likely_drivers: [{ mechanism_slug: "leaky-gut" }, { mechanism_slug: "insulin-resistance" }],
    supplement_suggestions: [{ supplement_slug: "magnesium-glycinate", dose: "400mg" }],
  };

  it("keeps the good drivers when a bare string is mixed in", () => {
    const { summary } = pythonHistory({
      ...AI,
      likely_drivers: [AI.likely_drivers[0], "HPA axis dysregulation", AI.likely_drivers[1]],
    });
    expect(summary.drivers).toEqual(["leaky-gut", "insulin-resistance"]);
  }, PY_TEST_TIMEOUT_MS);

  it("keeps the good supplements when a bare string is mixed in", () => {
    const { summary } = pythonHistory({
      ...AI,
      supplement_suggestions: [...AI.supplement_suggestions, "vitamin D 2000IU"],
    });
    expect(summary.supplements).toEqual([{ slug: "magnesium-glycinate", dose: "400mg" }]);
  }, PY_TEST_TIMEOUT_MS);

  it("survives ai_analysis not being an object at all", () => {
    // A whole session's analysis stored as prose. `ai.get(...)` would raise on
    // the very first line, before any of the per-element guards were reached.
    const { summary } = pythonHistory("the whole analysis as one string");
    expect(summary).toEqual({ synthesis_notes: "", drivers: [], supplements: [] });
  }, PY_TEST_TIMEOUT_MS);

  it("says on stderr what the stored analysis actually contained", () => {
    const { stderr } = pythonHistory({ ...AI, likely_drivers: ["HPA axis dysregulation"] });
    expect(stderr).toMatch(/malformed driver/i);
    expect(stderr).toContain("assess-history");
    expect(stderr).toContain("HPA axis dysregulation");
  }, PY_TEST_TIMEOUT_MS);

  it("leaves a well-formed analysis untouched", () => {
    const { summary, stderr } = pythonHistory(AI);
    expect(summary).toEqual({
      synthesis_notes: "prior take",
      drivers: ["leaky-gut", "insulin-resistance"],
      supplements: [{ slug: "magnesium-glycinate", dose: "400mg" }],
    });
    expect(stderr.trim()).toBe("");
  }, PY_TEST_TIMEOUT_MS);
});

/**
 * The app menu is the one place the posture goes the OTHER way, and its own
 * existing code sets the precedent: it already hard-fails a week that doesn't
 * return exactly 7 days. The client EATS from this, so a week or a day going
 * missing unnoticed is worse than no menu — those stay fatal and named.
 *
 * Slots are the exception, because the surrounding code already treats them as
 * droppable (it filters any slot with a blank dish).
 */
describe("_normalised_weeks is strict about weeks and days, lenient about slots", () => {
  const DAY = {
    slots: [
      { slot: "Breakfast", dish: "Poha" },
      { slot: "Lunch", dish: "Dal rice" },
    ],
  };
  const WEEK = { week: 2, days: Array.from({ length: 7 }, () => DAY) };

  function pythonWeeksMenu(raw: unknown): {
    ok: boolean;
    weeks?: Record<string, unknown>[];
    error?: string;
    stderr: string;
  } {
    const { stdout, stderr } = runAgainstShim(
      "generate-app-menu.py",
      `try:
    sys.stdout.write(json.dumps({"ok": True, "weeks": m._normalised_weeks(payload["raw"])}))
except ValueError as e:
    sys.stdout.write(json.dumps({"ok": False, "error": str(e)}))`,
      { raw },
    );
    return { ...JSON.parse(stdout), stderr };
  }

  it("refuses the whole menu when a week is a bare string", () => {
    const res = pythonWeeksMenu([WEEK, "week 3: repeat week 2"]);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/where a week object belongs/i);
    expect(res.error).toContain("str");
  }, PY_TEST_TIMEOUT_MS);

  it("refuses the whole menu when a day is a bare string", () => {
    const res = pythonWeeksMenu([{ ...WEEK, days: [...WEEK.days.slice(0, 6), "Sunday: leftovers"] }]);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/where a day object belongs/i);
  }, PY_TEST_TIMEOUT_MS);

  it("refuses a bare 7-character string for 'days' instead of walking it letter by letter", () => {
    // len("Mon-Sun") == 7, so the pre-existing day-count check passes it
    // through. The element check is what actually catches this.
    const res = pythonWeeksMenu([{ week: 1, days: "Mon-Sun" }]);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/where a day object belongs/i);
  }, PY_TEST_TIMEOUT_MS);

  it("refuses a non-list 'weeks'", () => {
    const res = pythonWeeksMenu("here is the menu");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/expected list/i);
  }, PY_TEST_TIMEOUT_MS);

  it("still hard-fails the pre-existing wrong-day-count case", () => {
    const res = pythonWeeksMenu([{ week: 1, days: [DAY, DAY] }]);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/need 7/);
  }, PY_TEST_TIMEOUT_MS);

  it("DROPS a malformed slot and keeps the menu, unlike a malformed day", () => {
    const day = { slots: [DAY.slots[0], "Lunch: dal rice", DAY.slots[1]] };
    const res = pythonWeeksMenu([{ week: 2, days: Array.from({ length: 7 }, () => day) }]);
    expect(res.ok).toBe(true);
    expect((res.weeks![0].days as { slots: unknown[] }[])[0].slots).toEqual(DAY.slots);
    expect(res.stderr).toMatch(/malformed slot/i);
    expect(res.stderr).toContain("Lunch: dal rice");
  }, PY_TEST_TIMEOUT_MS);

  it("leaves a well-formed menu untouched", () => {
    const res = pythonWeeksMenu([WEEK]);
    expect(res.ok).toBe(true);
    expect(res.weeks).toHaveLength(1);
    expect(res.weeks![0].week).toBe(2);
    expect(res.weeks![0].days).toHaveLength(7);
  }, PY_TEST_TIMEOUT_MS);
});

/**
 * extract-symptoms is the only consumer parsing FREE-FORM JSON rather than a
 * tool call, so its shape guarantee is the weakest in the pipeline. It is also
 * the one where a crash costs money: the call is ~$0.10 on a 40-page panel, and
 * failing on one junk mention would discard every lab the model got right.
 */
describe("_sanitise_extraction tolerates malformed model output", () => {
  function pythonExtract(extracted: unknown, valid: string[] = ["bloating", "fatigue"]) {
    const { stdout, stderr } = runAgainstShim(
      "extract-symptoms.py",
      `matched, mentions, data = m._sanitise_extraction(payload["extracted"], set(payload["valid"]))
sys.stdout.write(json.dumps({"matched": matched, "mentions": mentions, "data": data}))`,
      { extracted, valid },
    );
    return { ...JSON.parse(stdout), stderr } as {
      matched: string[];
      mentions: Record<string, unknown>[];
      data: Record<string, never>;
      stderr: string;
    };
  }

  it("keeps the good mentions and lab values when bare strings are mixed in", () => {
    const res = pythonExtract({
      matched_slugs: ["bloating", "fatigue"],
      mentions: [
        { slug: "bloating", quote: "very bloated after meals" },
        "client also mentioned fatigue",
        { slug: "fatigue", quote: "tired by 3pm" },
      ],
      extracted_data: {
        lab_values: [
          { test_name: "TSH", value: 4.2, unit: "mIU/L" },
          "Ferritin 30 ng/mL",
        ],
      },
    });
    expect(res.mentions.map((m) => m.slug)).toEqual(["bloating", "fatigue"]);
    expect(res.data.lab_values).toEqual([
      { test_name: "TSH", value: "4.2", unit: "mIU/L", date_drawn: null },
    ]);
  }, PY_TEST_TIMEOUT_MS);

  it("says on stderr what the model actually produced", () => {
    const res = pythonExtract({ mentions: ["client also mentioned fatigue"] });
    expect(res.stderr).toMatch(/malformed mention/i);
    expect(res.stderr).toContain("client also mentioned fatigue");
  }, PY_TEST_TIMEOUT_MS);

  it("survives extracted_data and measurements not being objects", () => {
    // Nested CONTAINERS are model-supplied too — `.get()` on a bare string
    // raises exactly like the element case, one level up.
    const res = pythonExtract({ extracted_data: "weight 68kg, TSH 4.2" });
    expect(res.data.lab_values).toEqual([]);
    const res2 = pythonExtract({ extracted_data: { measurements: "weight 68kg" } });
    expect(res2.data.measurements).toEqual({
      height_cm: null,
      weight_kg: null,
      bp_systolic: null,
      bp_diastolic: null,
      hr_bpm: null,
      waist_cm: null,
    });
  }, PY_TEST_TIMEOUT_MS);

  it("drops a non-string matched slug instead of testing it against the catalogue", () => {
    const res = pythonExtract({ matched_slugs: ["bloating", 42, { slug: "fatigue" }] });
    expect(res.matched).toEqual(["bloating"]);
  }, PY_TEST_TIMEOUT_MS);

  it("leaves a well-formed extraction untouched", () => {
    const res = pythonExtract({
      matched_slugs: ["bloating"],
      mentions: [{ slug: "bloating", quote: "q" }],
      extracted_data: {
        lab_values: [{ test_name: "TSH", value: 4.2, unit: "mIU/L" }],
        medications: ["levothyroxine"],
        conditions: ["hypothyroidism"],
      },
    });
    expect(res.matched).toEqual(["bloating"]);
    expect(res.data.medications).toEqual(["levothyroxine"]);
    expect(res.stderr.trim()).toBe("");
  }, PY_TEST_TIMEOUT_MS);
});

/**
 * apply-rework reads its changes back off DISK, from a record assess-rework
 * wrote on an earlier day. assess-rework filters on the way in now, but records
 * already on the roster predate that — and this is the script that MUTATES plan
 * data, so it gets the guard as well.
 *
 * This one drives the whole shim rather than an extracted helper: it is the
 * end-to-end path that matters, and a temp FMDB_PLANS_DIR makes it cheap (the
 * Client model needs six scalar fields and no catalogue read).
 */
describe("apply-rework survives a malformed change already on disk", () => {
  const GOOD_SUPP = {
    op: "add",
    target_kind: "supplement",
    target_slug: "magnesium-glycinate",
    description: "Add magnesium glycinate 400 mg at bedtime",
    reason: "sleep onset",
  };
  const GOOD_PRACTICE = {
    op: "add",
    target_kind: "practice",
    description: "10-minute walk after dinner",
    reason: "post-prandial glucose",
  };

  /** Write a throwaway plans root holding one client + one rework suggestion. */
  function withPlansRoot(suggestedChanges: unknown[]): string {
    const root = mkdtempSync(path.join(tmpdir(), "fmdb-rework-"));
    mkdirSync(path.join(root, "clients", "cl-test"), { recursive: true });
    writeFileSync(
      path.join(root, "clients", "cl-test", "client.yaml"),
      JSON.stringify(
        {
          client_id: "cl-test",
          intake_date: "2026-01-05",
          sex: "F",
          created_at: "2026-01-05T00:00:00+00:00",
          updated_at: "2026-01-05T00:00:00+00:00",
          updated_by: "test",
          rework_suggestion: {
            generated_at: "2026-08-02T00:00:00+00:00",
            triggered_by: "quick_note",
            benefit_pct: 40,
            confidence: "medium",
            rationale: "test",
            suggested_changes: suggestedChanges,
          },
        },
        null,
        2,
      ), // JSON is valid YAML, so this needs no YAML writer
    );
    return root;
  }

  function runApplyRework(root: string) {
    const res = spawnSync(TEST_PYTHON, [path.join(SCRIPTS, "apply-rework.py")], {
      input: JSON.stringify({ client_id: "cl-test" }),
      encoding: "utf-8",
      env: { ...process.env, FMDB_PLANS_DIR: root },
    });
    return { ...res, parsed: res.stdout.trim() ? JSON.parse(res.stdout) : null };
  }

  it("applies the well-formed changes and skips the bare string", () => {
    const root = withPlansRoot([GOOD_SUPP, "add vitamin D 2000 IU", GOOD_PRACTICE]);
    try {
      const res = runApplyRework(root);
      expect(res.status, `python exited ${res.status}: ${res.stderr}`).toBe(0);
      expect(res.parsed.ok).toBe(true);
      expect(res.parsed.applied_count).toBe(2);
      expect(res.stderr).toMatch(/malformed suggested change/i);
      expect(res.stderr).toContain("add vitamin D 2000 IU");

      // Counted is not the same as written — prove the good change reached the
      // draft on disk, which is the artifact the coach actually opens.
      const drafts = readdirSync(path.join(root, "drafts"));
      expect(drafts).toHaveLength(1);
      const draft = readFileSync(path.join(root, "drafts", drafts[0]), "utf-8");
      expect(draft).toContain("magnesium-glycinate");
      expect(draft).toContain("10-minute walk after dinner");
      expect(draft).not.toContain("vitamin D 2000 IU");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, PY_TEST_TIMEOUT_MS);

  it("leaves an all-good suggestion completely untouched", () => {
    const root = withPlansRoot([GOOD_SUPP, GOOD_PRACTICE]);
    try {
      const res = runApplyRework(root);
      expect(res.status).toBe(0);
      expect(res.parsed.applied_count).toBe(2);
      expect(res.stderr).not.toMatch(/malformed/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, PY_TEST_TIMEOUT_MS);
});
