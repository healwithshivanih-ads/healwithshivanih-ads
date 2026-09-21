/**
 * A recipe may not promise a diet its own allergen list denies.
 *
 * THE BUG: `coconut-breakfast-barley-with-peaches.yaml` carried
 * `diet: [… gluten_free]` and `contains_allergens: [gluten]` at the same time,
 * over half a cup of pearled barley. `everyday-creamed-grain-cereal.yaml` did
 * the same with a choice-of-grain line that listed barley among the options.
 *
 * WHY THE CONTRADICTION IS NOT SYMMETRIC — the diet flag wins where it counts.
 * The client-app menu path never loads `contains_allergens` at all; the only
 * gluten defence there is `foods_to_avoid`, and foods-to-avoid.ts EXONERATES a
 * category's proxy words for any recipe carrying the matching diet tag. So the
 * `gluten_free` claim did not merely fail to protect a coeliac client, it
 * CANCELLED the catch that the word "barley" would otherwise have made.
 * Hence the first two tests here are about `buildAvoidFilter`, not about YAML.
 *
 * The Python half (recipe_schema.check_recipe) is the structural fix: it is
 * shared by validate-recipes.py, promote-generated-recipe.py and the
 * pre-commit hook, so a new recipe cannot land with the contradiction. The
 * library-wide sweep below is the ratchet for a hand-edit that skips them.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { buildAvoidFilter } from "./foods-to-avoid";
import { PY_TEST_TIMEOUT_MS, TEST_PYTHON } from "./test-python";

const SCRIPTS = path.resolve(process.cwd(), "scripts");
const RECIPES = path.resolve(process.cwd(), "..", "fm-database", "data", "_recipes");

type Recipe = {
  slug?: string;
  diet?: string[];
  contains_allergens?: string[];
  main_ingredients?: string[];
  ingredients?: ({ item?: string } | string)[];
};

function load(slug: string): Recipe {
  return yaml.load(fs.readFileSync(path.join(RECIPES, `${slug}.yaml`), "utf-8")) as Recipe;
}

/** The shape foods-to-avoid.ts is handed by client-app.ts (see LetterRecipe). */
function asAvoidable(r: Recipe) {
  const items = (r.ingredients ?? []).map((i) => (typeof i === "string" ? i : (i.item ?? "")));
  return {
    title: r.slug ?? "",
    mains: r.main_ingredients ?? [],
    ingredients: items,
    diet: r.diet ?? [],
  };
}

describe("a gluten grain survives the client's gluten avoid", () => {
  // Every phrasing that expands to the `gluten` category — each one pulls in
  // "barley" as a proxy, and each one was being exonerated by the false tag.
  for (const avoid of ["gluten", "wheat", "gluten-free, Hashimoto's"]) {
    it(`barley porridge is withheld from foods_to_avoid: ${avoid}`, () => {
      const r = asAvoidable(load("coconut-breakfast-barley-with-peaches"));
      expect(r.ingredients.join(" ")).toMatch(/barley/);
      expect(buildAvoidFilter(avoid).safe(r)).toBe(false);
    });
  }

  it("the choice-of-grain cereal no longer offers barley as an option", () => {
    const r = load("everyday-creamed-grain-cereal");
    const text = [...(r.main_ingredients ?? []), ...asAvoidable(r).ingredients].join(" ");
    expect(text).not.toMatch(/\b(barley|oats?|wheat|rye)\b/i);
    // …and having been narrowed, it may keep the gluten_free promise.
    expect(r.diet).toContain("gluten_free");
    expect(buildAvoidFilter("gluten").safe(asAvoidable(r))).toBe(true);
  });

  it("a genuinely gluten-free flatbread is still cleared (the tag's real job)", () => {
    // The exoneration exists so jowar roti reaches the clients who need it —
    // this guard must not be "fixed" by deleting EXONERATES.
    const r = asAvoidable(load("jowar-roti"));
    expect(buildAvoidFilter("gluten").safe(r)).toBe(true);
  });
});

describe("recipe_schema rejects a diet flag its allergen list denies", () => {
  /** Runs the real check_recipe over a candidate mapping. */
  function check(rec: Record<string, unknown>): { errs: string[]; warns: string[] } {
    const src = [
      "import json,sys",
      `sys.path.insert(0, ${JSON.stringify(SCRIPTS)})`,
      "from recipe_schema import check_recipe",
      "e,w = check_recipe(json.load(sys.stdin), 'candidate.yaml')",
      "print(json.dumps({'errs': e, 'warns': w}))",
    ].join("\n");
    return JSON.parse(
      execFileSync(TEST_PYTHON, ["-c", src], { input: JSON.stringify(rec), encoding: "utf-8" }),
    );
  }

  const base = {
    slug: "candidate",
    name: "Candidate",
    meal_type: ["breakfast"],
    one_line: "x",
    steps: ["Cook it."],
    prep_time_min: 5,
    cook_time_min: 20,
    ingredients: [{ item: "pearled barley", qty: "0.5", unit: "cup" }],
  };

  it("errors on the exact shape the barley porridge shipped with", () => {
    const { errs } = check({
      ...base,
      diet: ["vegetarian", "vegan", "gluten_free", "dairy_free"],
      contains_allergens: ["gluten"],
    });
    expect(errs.join("\n")).toMatch(/diet claims 'gluten_free' but contains_allergens/);
  }, PY_TEST_TIMEOUT_MS);

  it("is an ERROR, not a warning — the pre-commit hook blocks on errors only", () => {
    const { errs, warns } = check({
      ...base,
      diet: ["gluten_free"],
      contains_allergens: ["gluten"],
    });
    expect(errs.length).toBeGreaterThan(0);
    expect(warns.join("\n")).not.toMatch(/diet claims/);
  }, PY_TEST_TIMEOUT_MS);

  it("covers the mirror cases, not just gluten", () => {
    for (const [diet, allergen] of [
      ["dairy_free", "dairy"],
      ["nut_free", "nuts"],
      ["nut_free", "peanut"],
      ["vegan", "egg"],
      ["vegan", "dairy"],
      ["vegetarian", "fish"],
      ["eggetarian", "shellfish"],
      ["jain", "egg"],
    ] as const) {
      const { errs } = check({ ...base, diet: [diet], contains_allergens: [allergen] });
      expect(errs.join("\n"), `${diet} × ${allergen}`).toMatch(
        new RegExp(`diet claims '${diet}' but contains_allergens declares \\['${allergen}'\\]`),
      );
    }
  }, PY_TEST_TIMEOUT_MS);

  it("leaves an honest recipe alone", () => {
    const { errs } = check({
      ...base,
      diet: ["vegetarian", "vegan", "dairy_free"], // no gluten_free claim
      contains_allergens: ["gluten"],
    });
    expect(errs.join("\n")).not.toMatch(/diet claims/);
  }, PY_TEST_TIMEOUT_MS);
});

describe("oats are treated as gluten-bearing", () => {
  // Coach decision 2026-09-21. Oats are gluten-free botanically; the risk is
  // shared milling and storage, and Indian retail oats are rarely certified.
  // The library used to be split 4-4, so whether a coeliac client saw an oat
  // dish came down to which recipe the drafter happened to pick. Two
  // vocabularies have to agree for this to hold — ALLERGEN_KEYWORDS["gluten"]
  // in recipe_schema.py (what TAGS the catalogue) and AVOID_EXPAND.gluten here
  // (what FILTERS the client's menu). The first without the second was the
  // half-fix: recipes correctly tagged, oat porridge still served.
  const oatRecipes = fs
    .readdirSync(RECIPES)
    .filter((f) => f.endsWith(".yaml") && !f.startsWith("_"))
    .map((f) => [f, yaml.load(fs.readFileSync(path.join(RECIPES, f), "utf-8")) as Recipe] as const)
    .filter(([, d]) => {
      const text = [...(d?.main_ingredients ?? []), ...asAvoidable(d).ingredients].join(" ");
      return /\boats?\b/i.test(text);
    });

  it("every oat recipe declares the gluten allergen and none claims gluten_free", () => {
    expect(oatRecipes.length).toBeGreaterThan(0); // the scan actually found them
    for (const [f, d] of oatRecipes) {
      expect(d.contains_allergens ?? [], `${f} allergens`).toContain("gluten");
      expect(d.diet ?? [], `${f} diet`).not.toContain("gluten_free");
    }
  });

  it("a gluten-avoiding client is not served oat porridge", () => {
    expect(buildAvoidFilter("gluten").safe(asAvoidable(load("spiced-oat-porridge")))).toBe(false);
  });

  it("goat cheese and goat milk are not oats", () => {
    // `\boat\b` is boundary-anchored on both sides for exactly this reason.
    for (const slug of ["cream-of-broccoli-soup-goat-milk", "warm-artichoke-spinach-goat-cheese-dip"])
      expect(buildAvoidFilter("gluten").safe(asAvoidable(load(slug))), slug).toBe(true);
  });
});

describe("the whole library is free of the contradiction", () => {
  // The ratchet: a hand-edit that skips the hook still fails here.
  const CONFLICTS: Record<string, string[]> = {
    gluten_free: ["gluten"],
    dairy_free: ["dairy"],
    nut_free: ["nuts", "peanut"],
    vegan: ["dairy", "egg", "fish", "shellfish"],
    vegetarian: ["egg", "fish", "shellfish"],
    eggetarian: ["fish", "shellfish"],
    jain: ["egg", "fish", "shellfish"],
  };

  it("no recipe promises a diet its own allergen list denies", () => {
    const offenders: string[] = [];
    let scanned = 0;
    for (const f of fs.readdirSync(RECIPES)) {
      if (!f.endsWith(".yaml") || f.startsWith("_")) continue;
      scanned++;
      const d = yaml.load(fs.readFileSync(path.join(RECIPES, f), "utf-8")) as Recipe;
      const diet = new Set((d?.diet ?? []).map((x) => String(x).toLowerCase()));
      const alg = new Set((d?.contains_allergens ?? []).map((x) => String(x).toLowerCase()));
      for (const [flag, bad] of Object.entries(CONFLICTS))
        if (diet.has(flag))
          for (const a of bad) if (alg.has(a)) offenders.push(`${f}: ${flag} × ${a}`);
    }
    expect(scanned).toBeGreaterThan(400); // the sweep actually ran
    expect(offenders).toEqual([]);
  });
});
