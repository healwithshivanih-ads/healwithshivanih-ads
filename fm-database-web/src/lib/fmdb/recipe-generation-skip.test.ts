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
  buildClientRecipeGate,
  buildHomeRemedyResolver,
  buildLibraryRecipeResolver,
  loadLibraryRecipes,
  loadRemedyFallbackLibrary,
} from "./client-app";
import { primaryDishPart } from "./dish-components";
import { PY_TEST_TIMEOUT_MS, TEST_PYTHON } from "./test-python";

const REPO = path.resolve(__dirname, "../../../..");
const GEN = path.join(REPO, "fm-database-web/scripts/generate-week-recipes.py");

/**
 * Ask the real Python predicate which of these dishes it would skip.
 *
 * `supplied` is the per-client gated title list the caller now sends (see
 * recipes.ts). Omit it to exercise the disk-scan fallback.
 */
function pythonSkips(dishes: string[], supplied?: string[], covered?: string[]): string[] {
  const src = `
import json, sys, importlib.util
spec = importlib.util.spec_from_file_location("gwr", ${JSON.stringify(GEN)})
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
payload = json.load(sys.stdin)
is_covered = m._covered_predicate({
    "catalogue_titles": payload.get("supplied"),
    "covered_dishes": payload.get("covered"),
})
print(json.dumps([d for d in payload["dishes"] if is_covered(d)]))
`;
  const out = execFileSync(TEST_PYTHON, ["-c", src], {
    input: JSON.stringify({ dishes, supplied: supplied ?? null, covered: covered ?? null }),
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
  }, PY_TEST_TIMEOUT_MS);

  it("actually read the catalogue — otherwise this suite passes vacuously", () => {
    // _catalogue_titles() swallows an unreadable catalogue (missing pyyaml, say)
    // and returns [], which skips nothing and makes every assertion here hold
    // for the wrong reason. Pin a dish the catalogue definitely answers.
    expect(pythonSkips(["Jeera rice (1 cup)"])).toEqual(["Jeera rice (1 cup)"]);
  }, PY_TEST_TIMEOUT_MS);

  it("still generates for a dish the catalogue does not have", () => {
    // If this ever returns it as skipped, the matcher has gone loose and the
    // client silently loses methods for genuinely new dishes.
    expect(pythonSkips(["Chicken shawarma (small portion, 1 wrap)"])).toEqual([]);
  }, PY_TEST_TIMEOUT_MS);
});

/**
 * The skip must be judged against what THIS CLIENT can see, not the whole
 * library. Reported 2026-07-28 (cl-004, Jain, avoids onion + garlic): the
 * catalogue's only "Foxtail millet pulao" tempers with onion and ginger-garlic
 * paste, so her app gates it away — but the generator saw the file, called the
 * dish covered, skipped it, and her lunch arrived with no method from either
 * tier. The caller now sends the GATED title list.
 */
describe("the skip is judged per client", () => {
  it("writes a recipe for a dish whose only catalogue version this client cannot see", async () => {
    // Anchored on a dish where the allium is INTRINSIC — it is in the recipe's
    // own name, so no future de-onioning can quietly make this client able to
    // see it and turn the assertion vacuous. (The original report used Foxtail
    // millet pulao; that recipe has since been rewritten onion-free, which is
    // exactly why the anchor must be a dish that cannot be.)
    const dish = "3-Egg Omelette (Onion & Cabbage) (1 plate)";
    const gate = buildClientRecipeGate({
      dietary_preference: "Vegetarian Jain",
      foods_to_avoid: "Onion, Garlic",
    });
    const lib = await loadLibraryRecipes();
    const titles = lib.flatMap((l) => [l.recipe.title, ...(l.recipe.aliases ?? [])]);
    const visible = lib
      .filter((l) => gate(l.recipe))
      .flatMap((l) => [l.recipe.title, ...(l.recipe.aliases ?? [])]);

    // The catalogue does carry it…
    expect(titles).toContain("3-Egg Omelette (Onion & Cabbage)");
    // …and the ungated mirror therefore skips it (the old behaviour).
    expect(pythonSkips([dish])).toEqual([dish]);
    // …but this client cannot see it, so it must NOT be skipped for her.
    expect(visible).not.toContain("3-Egg Omelette (Onion & Cabbage)");
    expect(pythonSkips([dish], visible)).toEqual([]);
  }, PY_TEST_TIMEOUT_MS);

  it("the de-onioned staples are now visible to a Jain client", async () => {
    // The other half of the same fix: rather than leave these clients without a
    // method, the seven catalogue recipes their menus actually name were
    // rewritten without onion or garlic (the kachumber precedent). Pins that,
    // so a later edit reintroducing an allium is caught here rather than by a
    // client opening a blank meal.
    const gate = buildClientRecipeGate({
      dietary_preference: "Vegetarian Jain",
      foods_to_avoid: "Onion, Garlic",
    });
    const lib = await loadLibraryRecipes();
    for (const slug of [
      "foxtail-millet-pulao",
      "foxtail-millet-upma",
      "sama-rice-poha",
      "moong-dal-chilla",
      "paneer-bhurji",
      "paneer-spinach-sabzi",
      "paneer-tikka-yoghurt",
    ]) {
      const hit = lib.find((l) => l.slug === slug);
      expect(hit, slug).toBeTruthy();
      expect(gate(hit!.recipe), slug).toBe(true);
    }
  }, PY_TEST_TIMEOUT_MS);

  it("still skips a dish the client CAN see, so the saving is kept", async () => {
    const dish = "Foxtail millet khichdi (1 bowl)";
    const gate = buildClientRecipeGate({
      dietary_preference: "Vegetarian Jain",
      foods_to_avoid: "Onion, Garlic",
    });
    const visible = (await loadLibraryRecipes())
      .filter((l) => gate(l.recipe))
      .flatMap((l) => [l.recipe.title, ...(l.recipe.aliases ?? [])]);
    expect(visible).toContain("Foxtail millet khichdi");
    expect(pythonSkips([dish], visible)).toEqual([dish]);
  }, PY_TEST_TIMEOUT_MS);

  it("honours the caller's own verdict over its partial mirror of the matcher", async () => {
    // The shim splits a cell on the LITERAL first component. This slot leads
    // with a pre-meal shot and names the real dish after a "— then:", so the
    // shim keys on the lime juice, matches nothing, and pays to rewrite a Turai
    // sabzi the app already serves from the catalogue. recipes.ts resolves it
    // with the app's own matcher and says so.
    const dish =
      "Lime juice (1 tsp) pre-meal shot (small cup) — then: Turai sabzi (3/4 cup) + Masoor dal (1/2 cup)";
    const lib = buildLibraryRecipeResolver(await loadLibraryRecipes());
    expect(lib(dish)?.title, "the app does resolve this dish").toBeTruthy();

    expect(pythonSkips([dish]), "the mirror alone misses it").toEqual([]);
    expect(pythonSkips([dish], undefined, [dish]), "the caller's verdict wins").toEqual([dish]);
  }, PY_TEST_TIMEOUT_MS);

  it("a caller verdict of 'not covered' is never overridden by the local scan", () => {
    // The whole point of the gated path: a dish the CLIENT cannot see must be
    // generated even though the raw catalogue has a file for it.
    const dish = "Foxtail millet pulao (1 bowl)";
    expect(pythonSkips([dish]), "ungated mirror would skip it").toEqual([dish]);
    expect(pythonSkips([dish], undefined, ["Something else entirely"])).toEqual([]);
  }, PY_TEST_TIMEOUT_MS);

  it("falls back to the disk scan when the caller sends no list", () => {
    // The CLI and any older caller must keep working — over-generating is the
    // safe direction, never under-generating.
    expect(pythonSkips(["Jeera rice (1 cup)"], undefined)).toEqual(["Jeera rice (1 cup)"]);
    expect(pythonSkips(["Jeera rice (1 cup)"], [])).toEqual(["Jeera rice (1 cup)"]);
  }, PY_TEST_TIMEOUT_MS);
});
