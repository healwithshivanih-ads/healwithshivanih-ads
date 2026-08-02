/**
 * Covers the dish-name snap in scripts/catalogue_dishes.py + menu_hygiene.py.
 *
 * THE PROBLEM. The weekly drafter is handed the catalogue's own dish titles and
 * told to reuse them exactly. On a live menu (2026-08-02) it obeyed for 35 of
 * 41 slots and decorated the rest: "Clear vegetable broth" for the library's
 * "Everyday Vegetable Broth", "Tofu stir-fry with mixed vegetables" for
 * "Tofu-vegetable stir-fry". Every decorated name costs twice — the client's
 * dish opens with no method, and the coach is later asked to promote an
 * AI-written near-duplicate of a recipe she already owns.
 *
 * THE LINE THIS DRAWS, and the reason the rule is narrow: a name that adds a
 * DESCRIPTOR is the same dish and snaps; a name that adds an INGREDIENT is a
 * different dish and must not. "Besan chilla with methi" stays put — it earned
 * its own catalogue entry instead. Snapping it would have served a client a
 * recipe with no methi in it under a name that promises methi, which is the
 * exact bug fixed in commit 78973501.
 *
 * Runs against the REAL catalogue, so it also fails if one of these recipes is
 * renamed or removed — which is the point: the snap is only as good as the
 * titles it maps onto.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { PY_TEST_TIMEOUT_MS, TEST_PYTHON } from "./test-python";

const SCRIPTS = path.resolve(process.cwd(), "scripts");

function snap(dishes: string[]): (string | null)[] {
  const src = [
    "import json,sys",
    `sys.path.insert(0, ${JSON.stringify(SCRIPTS)})`,
    "from catalogue_dishes import snap_dish_to_catalogue",
    "print(json.dumps([snap_dish_to_catalogue(d) for d in json.load(sys.stdin)]))",
  ].join("\n");
  return JSON.parse(
    execFileSync(TEST_PYTHON, ["-c", src], {
      input: JSON.stringify(dishes),
      encoding: "utf-8",
    }),
  );
}

/** Drives snap_menu_days over a week structure, returning the rewritten cells. */
function snapDays(cells: string[]): { dishes: string[]; notes: string[] } {
  const days = [{ slots: cells.map((c, i) => ({ slot: `s${i}`, dish: c })) }];
  const src = [
    "import json,sys",
    `sys.path.insert(0, ${JSON.stringify(SCRIPTS)})`,
    "from menu_hygiene import snap_menu_days",
    "days = json.load(sys.stdin)",
    "notes = snap_menu_days(days)",
    "print(json.dumps({'dishes': [s['dish'] for s in days[0]['slots']], 'notes': notes}))",
  ].join("\n");
  return JSON.parse(
    execFileSync(TEST_PYTHON, ["-c", src], {
      input: JSON.stringify(days),
      encoding: "utf-8",
    }),
  );
}

describe("snap_dish_to_catalogue", () => {
  it("snaps a decorated name onto its catalogue title", () => {
    expect(snap(["Clear vegetable broth (1 cup)"])[0]).toBe("Everyday Vegetable Broth");
    expect(snap(["Tofu stir-fry with mixed vegetables (3/4 cup)"])[0]).toBe(
      "Tofu-vegetable stir-fry",
    );
  }, PY_TEST_TIMEOUT_MS);

  it("does NOT snap a name that adds an ingredient — that is a different dish", () => {
    // The whole reason "Besan chilla with methi" exists as its own recipe.
    expect(snap(["Besan chilla with methi (1)"])[0]).toBeNull();
  }, PY_TEST_TIMEOUT_MS);

  it("leaves an already-correct name alone", () => {
    expect(snap(["Green moong sabzi (3/4 cup)"])[0]).toBeNull();
    expect(snap(["Baingan bharta (3/4 cup)"])[0]).toBeNull();
  }, PY_TEST_TIMEOUT_MS);

  it("returns nothing for food the catalogue has no recipe for", () => {
    expect(snap(["Banana (1 small, ripe)"])[0]).toBeNull();
    expect(snap(["Chicken biryani"])[0]).toBeNull();
    expect(snap([""])[0]).toBeNull();
  }, PY_TEST_TIMEOUT_MS);
});

describe("snap_menu_days", () => {
  it("rewrites each component of a compound cell, keeping portions exactly", () => {
    const { dishes, notes } = snapDays([
      "Clear vegetable broth (1 cup) + Ragi dosa (1)",
    ]);
    expect(dishes[0]).toBe("Everyday Vegetable Broth (1 cup) + Ragi dosa (1)");
    expect(notes).toHaveLength(1); // only the broth moved
  }, PY_TEST_TIMEOUT_MS);

  it("is a no-op on a menu the model named correctly — the common case", () => {
    const { dishes, notes } = snapDays(["Moong dal chilla (1) + Coconut chutney (2 tbsp)"]);
    expect(dishes[0]).toBe("Moong dal chilla (1) + Coconut chutney (2 tbsp)");
    expect(notes).toEqual([]);
  }, PY_TEST_TIMEOUT_MS);
});
