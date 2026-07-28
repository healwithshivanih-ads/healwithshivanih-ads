/**
 * Recipe `aliases` — the other names one canonical recipe answers to.
 *
 * The field had been authored on four recipes but `loadLibraryRecipes` never
 * read it, so the resolver only ever knew a recipe's title. Two costs:
 *
 *  1. WRONG METHODS ON LIVE MENUS. "Roasted chana (1/4 cup) + an orange" fell
 *     through to the nearest title match — **Chana dal**, a wet dal, opening
 *     under a dry roasted snack. 11 slots across the live plans did this;
 *     `masala-roasted-chana.yaml` had carried `aliases: [Roasted chana]` the
 *     whole time.
 *  2. DUPLICATE YAML PER PHRASING. `kachumber.yaml` and `kachumber-salad.yaml`
 *     were byte-identical apart from slug/name, because "Kachumber" alone
 *     cannot match the dish "kachumber salad" (one title token, two dish
 *     tokens — no rule accepts that) and vice-versa. Both had to exist.
 *
 * Aliases only ADD names; they loosen no matching rule. Measured over all 678
 * dish cells on the live plans when the field was wired: 11 changes, all of
 * them the Chana-dal misfire being corrected, and no other slot moved.
 */
import { describe, it, expect } from "vitest";
import { loadLibraryRecipes, buildLibraryRecipeResolver } from "./client-app";
import { slugify } from "./deferred-items";

const load = async () => {
  const lib = await loadLibraryRecipes();
  expect(lib.length).toBeGreaterThan(400); // sanity: catalogue actually read
  return { lib, resolve: buildLibraryRecipeResolver(lib) };
};

describe("recipe aliases", () => {
  it("are read off the YAML", async () => {
    const { lib } = await load();
    const chana = lib.find((l) => l.slug === "masala-roasted-chana");
    expect(chana?.recipe.aliases).toContain("Roasted chana");
  });

  it("stop 'Roasted chana' opening the Chana dal method", async () => {
    const { resolve } = await load();
    for (const dish of [
      "Roasted chana (1/4 cup) + an orange (1)",
      "Roasted chana (1 small handful) + herbal tea (1 cup)",
      "Roasted Chana (1 small handful) + green tea (1 cup)",
    ])
      expect(resolve(dish)?.title, dish).toBe("Masala Roasted Chana");
  });

  it("let one kachumber recipe answer to every phrasing on the menus", async () => {
    const { lib, resolve } = await load();
    // the duplicate is gone…
    expect(lib.filter((l) => l.slug.includes("kachumber")).map((l) => l.slug)).toEqual(["kachumber-salad"]);
    // …and all 147 live spellings still resolve, with the photo attached
    for (const dish of [
      "kachumber salad",
      "Kachumber salad",
      "Kachumber Salad",
      "small kachumber salad (small bowl)",
      "kachumber",
      "Kachumber (1 small bowl)",
    ]) {
      const r = resolve(dish);
      expect(r?.title, dish).toBe("Kachumber salad");
      expect(r?.imageUrl, dish).toBeTruthy();
    }
  });

  /**
   * The six name-variant clusters collapsed on 2026-07-28. Each was N files
   * with byte-identical steps/ingredients/kcal differing only in slug, name
   * and photo filename — they existed only because the resolver could not
   * match "Moong chilla" to a recipe titled "Moong dal chilla".
   *
   * Verified before merging: HEAD → now moved 29 of 678 live dish cells, every
   * one of them onto the canonical of its own cluster (or the Chana-dal fix),
   * and NOT ONE dish lost its recipe.
   */
  const MERGED: [string, string[]][] = [
    ["Moong dal chilla", ["moong dal cheela", "moong chilla", "moong cheela"]],
    ["Sama khichdi", ["sama millet khichdi", "sama rice khichdi"]],
    ["Foxtail millet upma", ["foxtail upma"]],
    ["Jowar roti", ["jowar rotis"]],
    ["Ragi dosa", ["nachni dosa"]],
    ["Sama porridge", ["sama millet porridge"]],
  ];

  it("every retired name still resolves to its canonical recipe", async () => {
    const { resolve } = await load();
    for (const [canon, retired] of MERGED)
      for (const name of [canon.toLowerCase(), ...retired]) {
        const r = resolve(`${name} (1 serving)`);
        expect(r?.title, name).toBe(canon);
        expect(r?.imageUrl, name).toBeTruthy(); // photo survived the merge
      }
  });

  it("the retired slugs are gone from the library", async () => {
    const { lib } = await load();
    const slugs = new Set(lib.map((l) => l.slug));
    for (const s of [
      "kachumber", "moong-chilla", "moong-cheela", "moong-dal-cheela",
      "sama-millet-khichdi", "sama-rice-khichdi", "foxtail-upma", "jowar-rotis",
      "nachni-dosa", "sama-millet-porridge",
    ])
      expect(slugs.has(s), s).toBe(false);
  });

  it("a plan pinned against a retired slug still finds the recipe", async () => {
    // `plan.nutrition.recipes` pins by SLUG, and 5 live plans pin slugs that
    // the merge retired. The pin lookup resolves through slugified aliases so
    // those recipes keep shipping in the client's pack — the coach pinned a
    // dish, not a filename.
    const { lib } = await load();
    const answersTo = (slug: string) =>
      lib.some((l) => l.slug === slug || (l.recipe.aliases ?? []).some((a) => slugify(a) === slug));
    for (const s of ["moong-chilla", "moong-dal-cheela", "nachni-dosa", "foxtail-upma", "kachumber"])
      expect(answersTo(s), s).toBe(true);
  });

  it("does not swallow a genuinely different recipe with a similar name", async () => {
    const { resolve } = await load();
    // sprouted moong chilla is its OWN recipe — the new "Moong chilla" alias
    // must not capture it
    expect(resolve("Sprouted moong chilla (2)")?.title).toBe("Sprouted moong chilla");
  });

  it("never let an alias outrank the dish's own primary component", async () => {
    const { resolve } = await load();
    // kachumber is a trailing side here — the slot belongs to the rajma
    expect(resolve("Rajma (1/2 cup) + Kodo millet (3/4 cup) + small kachumber salad (small bowl)")?.title)
      .toBe("Rajma");
  });

  it("no alias collides with another recipe's title or alias", async () => {
    const { lib } = await load();
    const seen = new Map<string, string>();
    const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    for (const l of lib)
      for (const n of [l.recipe.title, ...(l.recipe.aliases ?? [])]) {
        const k = key(n);
        const prev = seen.get(k);
        expect(prev === undefined || prev === l.slug, `"${n}" claimed by ${prev} and ${l.slug}`).toBe(true);
        seen.set(k, l.slug);
      }
  });
});
