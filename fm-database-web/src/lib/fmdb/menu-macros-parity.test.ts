/**
 * The app's menu grams (meal-macros.ts + recipe-portion.ts + plain-foods.ts)
 * and the drafter's Python copy (scripts/menu_macros.py) must give the SAME
 * numbers, over the real recipe library, or the drafter builds a day to a
 * total the client will never see.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import { buildMacroLookup, macrosFromServing, mealMacros } from "./meal-macros";
import { recipePortion } from "./recipe-portion";
import { buildPlainFoodLookup } from "./plain-foods";
import { PY_TEST_TIMEOUT_MS, TEST_PYTHON } from "./test-python";

const DATA = path.join(process.cwd(), "..", "fm-database", "data");

const MEALS: { title: string; portion?: string }[][] = [
  [{ title: "Jowar bhakri", portion: "2" }, { title: "Toor dal", portion: "1 bowl" }, { title: "Kachumber salad", portion: "small bowl" }],
  [{ title: "Ajwain Besan Cheela", portion: "2" }, { title: "soaked peeled almonds", portion: "8" }, { title: "warm water", portion: "1 glass" }],
  [{ title: "Everyday Almond Milk", portion: "1 cup" }, { title: "pumpkin seeds", portion: "1 tbsp" }],
  [{ title: "Moong dal khichdi", portion: "1 bowl" }, { title: "homemade plain dahi", portion: "1/2 cup" }],
  [{ title: "Idli", portion: "3" }, { title: "Coconut chutney", portion: "2 tbsp" }],
  [{ title: "Tea with milk", portion: "1 cup" }, { title: "banana", portion: "1" }],
  [{ title: "Palak sabzi", portion: "1 cup" }, { title: "Phulka", portion: "2" }, { title: "Paneer", portion: "1/2 cup" }],
  [{ title: "Sautéed mustard greens", portion: "1 cup" }, { title: "Tomato rice", portion: "1 bowl" }],
];

describe("menu grams: app and drafter agree", () => {
  it(
    "gives the same grams for the same meals over the real library",
    () => {
      const table = yaml.load(fs.readFileSync(path.join(DATA, "_ingredient_nutrients.yaml"), "utf8")) as Record<string, never>;
      const recipes = fs
        .readdirSync(path.join(DATA, "_recipes"))
        .filter((f) => f.endsWith(".yaml") && !f.startsWith("_"))
        .map((f) => yaml.load(fs.readFileSync(path.join(DATA, "_recipes", f), "utf8")) as Record<string, unknown>);
      const food = (k: string) => (table[k] as { category?: string; basis?: string } | undefined) ?? null;
      const lookup = buildMacroLookup(
        recipes.map((r) => ({
          title: String(r.name ?? ""),
          aliases: (r.aliases as string[] | undefined) ?? [],
          macros: macrosFromServing(r.nutrients_per_serving as Record<string, unknown>, r.nutrient_coverage_pct) ?? undefined,
          kcal: Number((r.nutrients_per_serving as Record<string, unknown> | undefined)?.kcal) || undefined,
          portion: recipePortion(
            String(r.name ?? ""),
            r.nutrient_lines as never,
            Number(r.nutrient_servings) || Number(r.servings) || undefined,
            food,
            r.serving_portion,
          ),
        })),
      );
      const plain = buildPlainFoodLookup(table);
      const ts = MEALS.map((m) => mealMacros(m, lookup, plain));

      const py = JSON.parse(
        execFileSync(
          TEST_PYTHON,
          [
            "-c",
            "import json,sys; sys.path.insert(0,'scripts'); from menu_macros import MenuMacros; mm=MenuMacros(); print(json.dumps([mm.meal(m) for m in json.load(sys.stdin)]))",
          ],
          { input: JSON.stringify(MEALS), encoding: "utf8" },
        ),
      );
      expect(py).toEqual(ts);
      // and the test is not vacuous
      expect(ts.filter(Boolean).length).toBeGreaterThanOrEqual(5);
    },
    PY_TEST_TIMEOUT_MS,
  );
});
