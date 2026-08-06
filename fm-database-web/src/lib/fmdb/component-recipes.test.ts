/**
 * Per-component recipes for a compound dish.
 *
 * THE RULE THIS RESTORES, AND THE ONE IT MUST NOT BREAK.
 *
 * A compound dish's headline method is resolved from its PRIMARY component
 * only, because a dish that resolved to "whichever component matched first"
 * once opened the CHANA method from a sabja-seed snack. A wrong recipe is worse
 * than none, and that rule stays.
 *
 * But it left 92% of published menu slots showing one method and hiding the
 * rest — a lunch of "Jowar bhakri + Moong dal + Turai sabzi + Curd + Kachumber"
 * showed the bhakri and hid four, including a ridge-gourd sabzi sitting in the
 * library the whole time.
 *
 * The distinction that makes both true: the old bug was about ATTRIBUTION, not
 * count. One recipe rendered as if it were the whole dish is a lie. A list of
 * labelled components is not. So these tests assert both halves — every
 * component gets its own named method, and nothing is ever returned unlabelled
 * or in place of the headline.
 */

import { describe, expect, it } from "vitest";

import { componentRecipesFor, isPlainComponent } from "./client-app";
import type { LetterRecipe } from "./client-app";

const recipe = (title: string, method = ["Cook it."], ingredients: string[] = ["thing"]) =>
  ({ title, method, ingredients } as unknown as LetterRecipe);

/** A stub library keyed on a word in the component. */
function libraryOf(map: Record<string, LetterRecipe>) {
  return (dish: string): LetterRecipe | undefined => {
    const d = dish.toLowerCase();
    for (const [needle, r] of Object.entries(map)) if (d.includes(needle)) return r;
    return undefined;
  };
}

const BHAKRI = recipe("Jowar Bhakri");
const SABZI = recipe("Ridge Gourd Sabzi", ["Chop the turai.", "Temper and cook."], ["turai", "jeera"]);
const DAL = recipe("Moong Dal");
const KACHUMBER = recipe("Kachumber Salad");

const LIB = libraryOf({
  bhakri: BHAKRI,
  turai: SABZI,
  "moong dal": DAL,
  kachumber: KACHUMBER,
});

describe("componentRecipesFor", () => {
  it("returns nothing for a single-component dish", () => {
    expect(componentRecipesFor("Jowar bhakri (2)", BHAKRI, LIB)).toEqual([]);
  });

  it("surfaces the sabzi that used to be hidden behind the roti", () => {
    const dish = "Jowar bhakri (2) + Moong dal (1 bowl) + Turai sabzi (1 cup) + Curd (small bowl) + Kachumber salad";
    const out = componentRecipesFor(dish, BHAKRI, LIB);
    const titles = out.map((c) => c.title.toLowerCase());
    expect(titles.some((t) => t.includes("turai"))).toBe(true);
    expect(out.find((c) => c.title.toLowerCase().includes("turai"))?.method).toEqual(SABZI.method);
  });

  it("EXCLUDES the headline recipe — it is already shown in full above", () => {
    const dish = "Jowar bhakri (2) + Turai sabzi (1 cup)";
    const out = componentRecipesFor(dish, BHAKRI, LIB);
    expect(out.map((c) => c.title)).not.toContain("Jowar bhakri (2)");
    // and the one it does return is the sabzi, not the bhakri under another name
    expect(out).toHaveLength(1);
    expect(out[0].method).toEqual(SABZI.method);
  });

  it("labels every entry with the component it belongs to", () => {
    // The whole safety argument: a method is only ever shown WITH its name, so
    // it can never read as the method for the dish as a whole.
    const out = componentRecipesFor("Jowar bhakri + Turai sabzi + Moong dal", BHAKRI, LIB);
    for (const c of out) expect(c.title.trim().length).toBeGreaterThan(0);
  });

  it("skips plain foods — curd and a spoon of ghee are not recipes", () => {
    const withGhee = libraryOf({ ...{ bhakri: BHAKRI }, ghee: recipe("Everyday Ghee"), curd: recipe("Curd") });
    const out = componentRecipesFor("Jowar bhakri + Ghee (1 tsp) + Curd (small bowl)", BHAKRI, withGhee);
    expect(out).toEqual([]);
  });

  it("never returns the same recipe twice", () => {
    const out = componentRecipesFor("Turai sabzi (1 cup) + Turai sabzi (extra)", BHAKRI, LIB);
    expect(out).toHaveLength(1);
  });

  it("skips a match with no method — a title alone helps nobody", () => {
    const titleOnly = libraryOf({ turai: recipe("Ridge Gourd Sabzi", []) });
    expect(componentRecipesFor("Jowar bhakri + Turai sabzi", BHAKRI, titleOnly)).toEqual([]);
  });

  it("does not invent a recipe for a component the library does not have", () => {
    const out = componentRecipesFor("Jowar bhakri + Something nobody has", BHAKRI, LIB);
    expect(out).toEqual([]);
  });

  it("works when the headline itself resolved to nothing", () => {
    // A dish whose primary has no recipe should still surface its components'.
    const out = componentRecipesFor("Mystery flatbread + Turai sabzi (1 cup)", undefined, LIB);
    expect(out).toHaveLength(1);
    expect(out[0].method).toEqual(SABZI.method);
  });

  /* The two that actually leaked onto a live menu. A prefix regex skipped
     "Ghee (1 tsp)" but let these through, and the library attached a five-step
     method to each. They differ from the dishes we KEEP only by what their
     words are, which is why the test is compositional rather than positional. */
  it.each(["warm water", "Warm water (1 glass)", "sesame seeds", "Sesame seeds (1 tbsp)",
           "Curd (small bowl)", "Ghee (1 tsp)", "soaked almonds", "Kiwi (1)"])(
    "treats %s as food, not a recipe", (s) => {
      expect(isPlainComponent(s)).toBe(true);
    },
  );

  it.each(["soft jowar roti with ghee", "Kachumber salad", "methi sabzi with sesame and turmeric",
           "coconut-coriander chutney", "Bottle Gourd Sabzi", "Masala Chai"])(
    "treats %s as a real dish", (s) => {
      expect(isPlainComponent(s)).toBe(false);
    },
  );
});
