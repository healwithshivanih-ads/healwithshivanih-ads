/**
 * THE COOK'S SHEET MUST NOT PRINT A HINDI LINE FOR A STEP IT CHANGED.
 *
 * The incident: recipe-adapt.ts rewrote or dropped English method steps for a
 * client who leaves out onion, but the recipe kept its original Hindi
 * `translations`, and menu-translate.ts pairs Hindi to English BY INDEX. The
 * cook's sheet prints the Hindi large, so `green-chana-sprout-salad` step 1
 * read "cucumber and tomato" in English and "…टमाटर और प्याज़…" (onion) in
 * Hindi. When a step was dropped, every later Hindi line shifted by one.
 *
 * The rule pinned here: after an adaptation, a Hindi line survives only beside
 * the exact English line it was written for. Anything rewritten, dropped or
 * left mentioning the food prints in English and counts as an English line.
 */
import { describe, it, expect } from "vitest";
import { adaptRecipeForAvoids, madeWithoutForYou, type AdaptableRecipe } from "./recipe-adapt";
import { normalizeGlossary, translateRecipe, madeWithoutLine, type Coverage } from "./menu-translate";
import {
  borrowedTranslations,
  buildClientRecipeAdapter,
  loadLibraryRecipes,
  type AppRecipe,
} from "./client-app";

/** As stored in fm-database/data/_recipes/green-chana-sprout-salad.yaml. */
const SALAD: AdaptableRecipe = {
  title: "Green chana sprout salad",
  mains: ["green chana sprouts", "cucumber", "tomato", "onion"],
  ingredients: [
    "1 cup green chana sprouts, boiled",
    "1 cucumber, diced",
    "1 tomato, diced",
    "1 onion, diced",
    "0.5 tsp chaat masala",
  ],
  method: [
    "Put the sprouts, cucumber, tomato and onion in a bowl.",
    "Sprinkle with the chaat masala, lemon juice and salt and mix very well.",
    "Top with the coriander and mint.",
  ],
  translations: {
    hi: {
      name: "अंकुरित हरे चने का सलाद",
      ingredients: ["1 कप अंकुरित हरे चने", "1 खीरा", "1 टमाटर", "1 प्याज़", "आधा छोटा चम्मच चाट मसाला"],
      method: [
        "अंकुरित चने, खीरा, टमाटर और प्याज़ एक कटोरे में डालें।",
        "चाट मसाला, नींबू का रस और नमक छिड़ककर अच्छी तरह मिलाएँ।",
        "ऊपर से हरा धनिया और पुदीना डालें।",
      ],
    },
  },
};

const G = normalizeGlossary({
  _meta: { lang: "hi", name: "हिंदी" },
  ui: {
    made_without: "{foods} के बिना बनाएँ।",
    leave_out_in_steps: "विधि में जहाँ भी इसका ज़िक्र हो, इसे न डालें।",
    and: "और",
  },
  terms: { onion: "प्याज़", garlic: "लहसुन", lemon: "नींबू" },
});

const asApp = (r: AdaptableRecipe, extra: Partial<AppRecipe> = {}): AppRecipe => ({ ...r, ...extra }) as AppRecipe;

describe("an adapted recipe keeps its translations in step", () => {
  it("prints the salad's onion step in English, never the Hindi naming onion", () => {
    const a = adaptRecipeForAvoids(SALAD, ["onion"])!;
    expect(a).not.toBeNull();
    const out = translateRecipe(asApp(a.recipe, { omits: a.omitted, omitsInSteps: a.stepsStillMention }), G);
    expect(out.method[0].hi).toBeUndefined();
    expect(out.method[0].en).toBe(a.recipe.method[0]);
    // Untouched steps keep their own line.
    expect(out.method[1].hi).toBe(SALAD.translations!.hi.method![1]);
    expect(out.method[2].hi).toBe(SALAD.translations!.hi.method![2]);
    for (const line of [...out.method, ...out.ingredients]) expect(line.hi ?? "").not.toContain("प्याज़");
    // …and the cook is told, in Hindi, before the method.
    expect(out.madeWithout?.hi).toContain("प्याज़ के बिना बनाएँ।");
  });

  it("prints a REWRITTEN step in English, never the old Hindi", () => {
    const r: AdaptableRecipe = {
      title: "Foxtail millet pulao",
      ingredients: ["1 cup millet", "1 piece onion, chopped", "1 tsp ginger"],
      method: ["Wash the millet.", "Add the onion, ginger and green chilli, then the vegetables, and cook 3 minutes."],
      translations: { hi: { method: ["बाजरा धो लें।", "प्याज़, अदरक और हरी मिर्च डालें, फिर सब्ज़ियाँ, और 3 मिनट पकाएँ।"] } },
    };
    const a = adaptRecipeForAvoids(r, ["onion"])!;
    expect(a.recipe.method[1]).toBe("Add the ginger and green chilli, then the vegetables, and cook 3 minutes.");
    const out = translateRecipe(asApp(a.recipe), G);
    expect(out.method[0].hi).toBe("बाजरा धो लें।");
    expect(out.method[1].hi).toBeUndefined();
  });

  it("drops a removed ingredient's Hindi with it, keeping the rest paired", () => {
    const a = adaptRecipeForAvoids(SALAD, ["onion"])!;
    const hi = a.recipe.translations!.hi.ingredients!;
    expect(hi).toHaveLength(a.recipe.ingredients.length);
    expect(hi).toEqual(["1 कप अंकुरित हरे चने", "1 खीरा", "1 टमाटर", "आधा छोटा चम्मच चाट मसाला"]);
  });

  it("does not shift later steps when a step is dropped", () => {
    const r: AdaptableRecipe = {
      title: "Lauki sabzi",
      ingredients: ["1 lauki, cubed", "1 onion, sliced", "1 tsp cumin"],
      method: ["Fry the onion until golden.", "Add the lauki and cumin.", "Cook covered for 10 minutes."],
      translations: { hi: { method: ["प्याज़ को सुनहरा होने तक भूनें।", "लौकी और जीरा डालें।", "ढककर 10 मिनट पकाएँ।"] } },
    };
    const a = adaptRecipeForAvoids(r, ["onion"])!;
    expect(a.recipe.method).toEqual(["Add the lauki and cumin.", "Cook covered for 10 minutes."]);
    expect(a.recipe.translations!.hi.method).toEqual(["लौकी और जीरा डालें।", "ढककर 10 मिनट पकाएँ।"]);
  });

  it("drops the Hindi of a step kept verbatim because it still names the food", () => {
    const r: AdaptableRecipe = {
      title: "Moong dal",
      ingredients: ["1 cup moong dal", "1 onion", "1 tsp turmeric"],
      method: ["Cook the dal with turmeric.", "Temper in ghee until the onion turns translucent, then pour over."],
      translations: { hi: { method: ["दाल को हल्दी के साथ पकाएँ।", "घी में तड़का लगाएँ, प्याज़ पारदर्शी होने पर दाल पर डालें।"] } },
    };
    const a = adaptRecipeForAvoids(r, ["onion"])!;
    expect(a.stepsStillMention).toBe(true);
    const out = translateRecipe(asApp(a.recipe, { omits: a.omitted, omitsInSteps: true }), G);
    expect(out.method[0].hi).toBe("दाल को हल्दी के साथ पकाएँ।");
    expect(out.method[1].hi).toBeUndefined();
  });

  it("drops a language block whose length never matched the English", () => {
    const r: AdaptableRecipe = {
      ...SALAD,
      translations: { hi: { ingredients: ["1 कप अंकुरित हरे चने"], method: ["only one line"] } },
    };
    const a = adaptRecipeForAvoids(r, ["onion"])!;
    expect(a.recipe.translations!.hi.ingredients).toBeUndefined();
    expect(a.recipe.translations!.hi.method).toBeUndefined();
  });

  it("counts every English-only line of a translated recipe", () => {
    const a = adaptRecipeForAvoids(SALAD, ["onion"])!;
    const cov: Coverage = { components: 0, translated: 0 };
    translateRecipe(asApp(a.recipe), G, cov);
    // 4 ingredients + 3 steps, of which step 1 is English only.
    expect(cov).toEqual({ components: 7, translated: 6 });
    // A recipe with no block at all is not counted.
    const none: Coverage = { components: 0, translated: 0 };
    translateRecipe(asApp({ ...SALAD, translations: undefined }), G, none);
    expect(none).toEqual({ components: 0, translated: 0 });
  });
});

describe("a borrowed library translation", () => {
  const lib = { ingredients: SALAD.ingredients, method: SALAD.method, translations: SALAD.translations };
  it("is used only when the English lines are exactly the library's", () => {
    expect(borrowedTranslations({ ingredients: SALAD.ingredients, method: SALAD.method }, lib)).toBe(SALAD.translations);
    expect(
      borrowedTranslations({ ingredients: SALAD.ingredients, method: SALAD.method.slice(1) }, lib),
    ).toBeUndefined();
  });
  it("is never used for a recipe adapted for this client", () => {
    const a = adaptRecipeForAvoids({ ...SALAD, translations: undefined }, ["onion"])!;
    expect(borrowedTranslations({ ...a.recipe, omits: a.omitted }, lib)).toBeUndefined();
  });
});

describe("the made-without line", () => {
  it("reads in both languages when every word resolves", () => {
    expect(madeWithoutLine(["onion", "garlic"], false, G)).toEqual({
      en: "Made without onion and garlic.",
      hi: "प्याज़ और लहसुन के बिना बनाएँ।",
    });
    expect(madeWithoutLine(["onion"], true, G)).toEqual({
      en: "Made without onion. Leave it out wherever the steps mention it.",
      hi: "प्याज़ के बिना बनाएँ। विधि में जहाँ भी इसका ज़िक्र हो, इसे न डालें।",
    });
  });
  it("stays English when a food has no translation, rather than drop it", () => {
    expect(madeWithoutLine(["onion", "celery"], false, G)).toEqual({ en: "Made without onion and celery." });
  });
  it("is absent when nothing was left out", () => {
    expect(madeWithoutLine(undefined, false, G)).toBeNull();
    expect(madeWithoutLine([], false, G)).toBeNull();
    expect(translateRecipe(asApp(SALAD), G).madeWithout).toBeUndefined();
  });
  it("reaches the cook's sheet recipe", () => {
    const a = adaptRecipeForAvoids(SALAD, ["onion"])!;
    expect(translateRecipe(asApp(a.recipe, { omits: a.omitted }), G).madeWithout?.hi).toBe("प्याज़ के बिना बनाएँ।");
  });
  it("uses the app card's words on the keepsake", () => {
    expect(madeWithoutForYou(["onion"], false)).toBe("Made without onion for you.");
    expect(madeWithoutForYou(["onion", "garlic"], true)).toBe(
      "Made without onion and garlic for you. Leave it out wherever the steps below mention it.",
    );
    expect(madeWithoutForYou([], true)).toBeNull();
    expect(madeWithoutForYou(undefined, false)).toBeNull();
  });
});

describe("the whole library, adapted for a client who leaves out onion and garlic", () => {
  it("never pairs a Hindi line naming them with an English line", async () => {
    const lib = await loadLibraryRecipes();
    const withHi = lib.filter((l) => l.recipe.translations?.hi?.method?.length);
    expect(withHi.length).toBeGreaterThan(50);
    const adapt = buildClientRecipeAdapter({ foods_to_avoid: "onion, garlic" }, null);
    let adapted = 0;
    const bad: string[] = [];
    for (const { slug, recipe } of withHi) {
      const out = adapt(recipe);
      if (!out || !out.omits?.length) continue;
      adapted += 1;
      const t = translateRecipe(out as AppRecipe, G);
      for (const line of [...t.ingredients, ...t.method]) {
        if (/प्याज|प्याज़|लहसुन/.test(line.hi ?? "")) bad.push(`${slug}: ${line.hi}`);
      }
    }
    expect(adapted).toBeGreaterThan(5);
    expect(bad).toEqual([]);
  });
});
