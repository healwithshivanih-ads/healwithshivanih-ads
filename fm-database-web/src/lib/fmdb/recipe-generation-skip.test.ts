/**
 * The generator's catalogue-skip must never outrun what the APP can resolve.
 *
 * generate-week-recipes.py skips writing a recipe for any dish the catalogue
 * already answers — 48% of dishes, which is the point: prefer curated content,
 * minimise AI-generated recipes. But the two sides use different code (Python
 * generator, TypeScript resolver). If the Python side ever judges MORE dishes
 * "covered" than the app can actually resolve, the client opens a meal to an
 * empty method — worse than the spend the skip was saving.
 *
 * This pins the asymmetry: skipping must be a SUBSET of resolving.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import {
  buildHomeRemedyResolver,
  buildLibraryRecipeResolver,
  loadLibraryRecipes,
  loadRemedyFallbackLibrary,
} from "./client-app";
import { primaryDishPart } from "./dish-components";
import { TEST_PYTHON } from "./test-python";

const REPO = path.resolve(__dirname, "../../../..");
const GEN = path.join(REPO, "fm-database-web/scripts/generate-week-recipes.py");

/** Ask the real Python predicate which of these dishes it would skip. */
function pythonSkips(dishes: string[]): string[] {
  const src = `
import json, sys, importlib.util
spec = importlib.util.spec_from_file_location("gwr", ${JSON.stringify(GEN)})
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
cat = m._catalogue_titles()
dishes = json.load(sys.stdin)
print(json.dumps([d for d in dishes if m._catalogue_covers(d, cat)]))
`;
  const out = execFileSync(TEST_PYTHON, ["-c", src], {
    input: JSON.stringify(dishes),
    encoding: "utf-8",
  });
  return JSON.parse(out) as string[];
}

describe("generator skip ⊆ app resolve", () => {
  it("never skips a dish the app cannot resolve", async () => {
    const lib = buildLibraryRecipeResolver(await loadLibraryRecipes());
    const rem = buildHomeRemedyResolver(await loadRemedyFallbackLibrary());

    // A spread: real catalogue dishes, compound cells, and things with no recipe.
    const dishes = [
      "Jeera rice (1 cup)",
      "Kachumber salad (1 small bowl)",
      "Cumin-Coriander-Fennel Tea (1 cup)",
      "BBQ chicken (small portion, ~80g) + brown rice (1 small bowl) + kachumber salad (1 small bowl)",
      "Chana dal soup (1 bowl) + jowar roti (1) + palak sabzi (1 cup)",
      "Kiwi (1)",
      "Chicken shawarma (small portion, 1 wrap)",
      "Ash Gourd Vegetable Juice (1 glass, before 3pm)",
    ];

    const skipped = pythonSkips(dishes);
    // A dish is safe to skip only if the app finds a method for it, OR the app's
    // headline for that cell is a different component entirely (so a generated
    // recipe for the skipped item would never have been shown anyway).
    const holes = skipped.filter((d) => {
      if (lib(d) || rem(d)) return false;
      const head = primaryDishPart(d).toLowerCase();
      const first = d.split(/\s\+\s/)[0].toLowerCase();
      return head.startsWith(first.slice(0, 8)); // same component → a real hole
    });
    expect(holes, `generator skips these but the app resolves nothing:\n${holes.join("\n")}`).toEqual([]);
  });

  it("actually read the catalogue — otherwise this suite passes vacuously", () => {
    // _catalogue_titles() swallows an unreadable catalogue (missing pyyaml, say)
    // and returns [], which skips nothing and makes every assertion here hold
    // for the wrong reason. Pin a dish the catalogue definitely answers.
    expect(pythonSkips(["Jeera rice (1 cup)"])).toEqual(["Jeera rice (1 cup)"]);
  });

  it("still generates for a dish the catalogue does not have", () => {
    // If this ever returns it as skipped, the matcher has gone loose and the
    // client silently loses methods for genuinely new dishes.
    expect(pythonSkips(["Chicken shawarma (small portion, 1 wrap)"])).toEqual([]);
  });
});
