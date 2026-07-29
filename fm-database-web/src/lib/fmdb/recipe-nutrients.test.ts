/**
 * The TypeScript recompute must agree with the Python engine, exactly.
 *
 * A per-client adapted recipe has ingredients taken out of it, so its stored
 * calories are wrong — an aloo sabzi shown without its potato was still
 * reporting the potato. Rather than port the ingredient matcher (normalisation,
 * the alias index, quantity parsing, cup/piece densities, the strained-drink and
 * cooked-volume rules), the engine now records what each ingredient LINE
 * contributed and this side subtracts.
 *
 * That only holds if the arithmetic here reproduces the arithmetic there. The
 * first block replays EVERY recipe in the library with nothing removed and
 * demands the stored block back, byte for byte — including Python's
 * round-half-to-even, which JavaScript does not do natively. If the two sides
 * ever drift, this fails instead of a client's calorie count quietly changing.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { recomputeWithout, loadNutrientTable, type NutrientLine } from "./recipe-nutrients";
import { getCataloguePath } from "./paths";

interface RecipeDoc {
  name?: string;
  nutrient_lines?: NutrientLine[];
  nutrient_servings?: number;
  nutrients_per_serving?: Record<string, number>;
  nutrient_coverage_pct?: number;
  rich_in?: string[];
  ingredients?: { item?: string }[];
}

const recipesDir = path.join(getCataloguePath(), "_recipes");
const load = (f: string) =>
  yaml.load(fs.readFileSync(path.join(recipesDir, f), "utf-8")) as RecipeDoc;
const files = fs.readdirSync(recipesDir).filter((f) => f.endsWith(".yaml"));

describe("the shared ingredient table", () => {
  it("carries the thresholds both sides read", async () => {
    const t = await loadNutrientTable();
    expect(t, "table must load — otherwise every assertion below is vacuous").not.toBeNull();
    expect(t!.nutrientKeys).toContain("kcal");
    expect(t!.thresholds.protein).toEqual({ field: "protein_g", min: 12 });
    expect(t!.thresholds["vitamin-c"]).toEqual({ field: "vit_c_mg", min: 20 });
    expect(t!.lowCoveragePct).toBe(70);
  });
});

describe("replaying the whole library with nothing removed", () => {
  it("reproduces the stored nutrients exactly", async () => {
    expect(files.length).toBeGreaterThan(400);
    const mismatches: string[] = [];
    let checked = 0;

    for (const f of files) {
      const d = load(f);
      if (!d.nutrient_lines?.length || !d.nutrient_servings || !d.nutrients_per_serving) continue;
      checked++;
      const out = await recomputeWithout(d.nutrient_lines, d.nutrient_servings, []);
      if (!out) {
        mismatches.push(`${f}: recompute returned null`);
        continue;
      }
      for (const [k, v] of Object.entries(d.nutrients_per_serving))
        if (out.perServing[k] !== v)
          mismatches.push(`${f}: ${k} stored ${v} · recomputed ${out.perServing[k]}`);
      if (out.coveragePct !== d.nutrient_coverage_pct)
        mismatches.push(
          `${f}: coverage stored ${d.nutrient_coverage_pct} · recomputed ${out.coveragePct}`,
        );
      const stored = [...(d.rich_in ?? [])].sort();
      if (JSON.stringify([...out.richIn].sort()) !== JSON.stringify(stored))
        mismatches.push(`${f}: rich_in stored ${stored} · recomputed ${[...out.richIn].sort()}`);
    }

    expect(checked, "the sweep must actually check recipes").toBeGreaterThan(400);
    expect(mismatches.slice(0, 20).join("\n") || "exact").toBe("exact");
  });
});

describe("removing an ingredient", () => {
  /** Find a recipe whose ingredient list names `token`, with per-line data. */
  const findWith = (token: string) => {
    for (const f of files) {
      const d = load(f);
      if (!d.nutrient_lines?.length || !d.nutrient_servings) continue;
      const idx = (d.ingredients ?? []).findIndex((i) =>
        new RegExp(`\\b${token}\\b`, "i").test(String(i?.item ?? "")),
      );
      if (idx >= 0 && d.nutrient_lines.some((l) => l.i === idx && l.key)) return { f, d, idx };
    }
    return null;
  };

  it("drops the calories of the ingredient taken out", async () => {
    const hit = findWith("potato");
    expect(hit, "the library should have a matched potato line").not.toBeNull();
    const { d, idx } = hit!;
    const before = await recomputeWithout(d.nutrient_lines, d.nutrient_servings, []);
    const after = await recomputeWithout(d.nutrient_lines, d.nutrient_servings, [idx]);
    expect(after!.perServing.kcal).toBeLessThan(before!.perServing.kcal);
    expect(after!.perServing.carbs_g).toBeLessThanOrEqual(before!.perServing.carbs_g);
  });

  it("removing a zero-nutrient carrier changes nothing", async () => {
    // water/broth lines are recorded at 0 g precisely so they sit outside both
    // the nutrient sum and the coverage denominator.
    for (const f of files) {
      const d = load(f);
      const carrier = d.nutrient_lines?.find((l) => l.g === 0 && l.key);
      if (!carrier || !d.nutrient_servings) continue;
      const before = await recomputeWithout(d.nutrient_lines, d.nutrient_servings, []);
      const after = await recomputeWithout(d.nutrient_lines, d.nutrient_servings, [carrier.i]);
      expect(after, f).toEqual(before);
      return;
    }
  });

  it("withholds the rich_in badges when coverage falls below the floor", async () => {
    // Removing matched mass can push a recipe under the coverage floor, and the
    // engine's rule is that badges are withheld there rather than reported off
    // a recipe it only half understands.
    const table = await loadNutrientTable();
    const lines: NutrientLine[] = [
      { i: 0, key: Object.keys(table!.entries)[0], g: 10 },
      { i: 1, key: null, g: 30 },
      { i: 2, key: null, g: 30 },
    ];
    const out = await recomputeWithout(lines, 1, []);
    expect(out!.coveragePct).toBeLessThan(70);
    expect(out!.richIn).toEqual([]);
  });

  it("returns null when the recipe has no per-line data", async () => {
    expect(await recomputeWithout(undefined, 2, [])).toBeNull();
    expect(await recomputeWithout([{ i: 0, key: "onion", g: 50 }], 0, [])).toBeNull();
  });
});
