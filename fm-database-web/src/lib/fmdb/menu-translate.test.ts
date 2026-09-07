/**
 * Locks the deterministic menu translator (kitchen-sheet composer).
 *
 * The load-bearing rules:
 *   - a dish renders in the target language ONLY when every non-connective word
 *     resolves; an unaccounted word keeps the whole title in English (honesty
 *     over a garbled half-translation), and that miss is COUNTED so the sheet can
 *     say "N shown in English";
 *   - longest-phrase wins ("mixed vegetables" ≠ "mixed" + "vegetables");
 *   - a recipe's own authored Hindi name beats a glossary term on collision;
 *   - portions translate best-effort (numbers pass through, units translate).
 */
import { describe, it, expect } from "vitest";
import {
  normalizeGlossary,
  buildTermIndex,
  translateTitle,
  translatePortion,
  translateSlot,
  translateDay,
  translateWeek,
  translateRecipe,
  type Glossary,
} from "./menu-translate";
import type { AppWeekMenu, AppRecipe } from "./client-app";

const RAW = {
  _meta: { lang: "hi", name: "हिंदी" },
  slots: { Breakfast: "नाश्ता", "Mid morning": "दोपहर से पहले" },
  units: { katori: "कटोरी", cup: "कप", glass: "गिलास" },
  days: { Mon: "सोमवार", Tue: "मंगलवार" },
  ui: { ingredients: "सामग्री" },
  terms: {
    roti: "रोटी",
    jowar: "ज्वार",
    dal: "दाल",
    "dal fry": "दाल फ्राई",
    mixed: "मिली-जुली",
    vegetables: "सब्ज़ियाँ",
    "mixed vegetables": "मिली-जुली सब्ज़ी",
    water: "पानी",
    buttermilk: "छाछ",
  },
};

const G: Glossary = normalizeGlossary(RAW);
const idx = () => buildTermIndex(G, []);

describe("normalizeGlossary", () => {
  it("lowercases keys and reads meta", () => {
    expect(G.lang).toBe("hi");
    expect(G.langName).toBe("हिंदी");
    expect(G.slots["mid morning"]).toBe("दोपहर से पहले"); // key lowercased
    expect(G.terms["roti"]).toBe("रोटी");
  });
});

describe("translateTitle", () => {
  const { index, maxWords } = { index: idx().index, maxWords: idx().maxWords };

  it("matches a whole title", () => {
    expect(translateTitle("Dal fry", index, maxWords)).toBe("दाल फ्राई");
  });

  it("composes per token in order", () => {
    expect(translateTitle("Jowar roti", index, maxWords)).toBe("ज्वार रोटी");
  });

  it("prefers the longest phrase", () => {
    // "mixed vegetables" must NOT become "मिली-जुली सब्ज़ियाँ"
    expect(translateTitle("Mixed vegetables", index, maxWords)).toBe("मिली-जुली सब्ज़ी");
  });

  it("skips connective words without failing", () => {
    expect(translateTitle("Dal with water", index, maxWords)).toBe("दाल पानी");
  });

  it("refuses (returns undefined) when a real word is unaccounted for", () => {
    // "paneer" isn't in this glossary → keep English, don't garble
    expect(translateTitle("Paneer bhurji", index, maxWords)).toBeUndefined();
  });

  it("drops portion-shaped noise via recipeLibKey", () => {
    expect(translateTitle("Roti (2)", index, maxWords)).toBe("रोटी");
  });
});

describe("buildTermIndex", () => {
  it("lets a recipe's authored Hindi name win over a glossary term", () => {
    const recipes: AppRecipe[] = [
      {
        title: "Dal fry",
        ingredients: [],
        method: [],
        translations: { hi: { name: "स्पेशल दाल फ्राई" } },
      },
    ];
    const { index, maxWords } = buildTermIndex(G, recipes);
    expect(translateTitle("Dal fry", index, maxWords)).toBe("स्पेशल दाल फ्राई");
  });
});

describe("translatePortion", () => {
  it("passes numbers, translates units", () => {
    expect(translatePortion("2 katori", G)).toBe("2 कटोरी");
    expect(translatePortion("½ cup", G)).toBe("½ कप");
  });
  it("translates a food word inside a portion", () => {
    expect(translatePortion("1 glass buttermilk", G)).toBe("1 गिलास छाछ");
  });
  it("keeps an unknown token verbatim", () => {
    expect(translatePortion("2 xyz", G)).toBe("2 xyz");
  });
});

describe("translateSlot / translateDay", () => {
  it("translates known slots and days", () => {
    expect(translateSlot("Breakfast", G)).toBe("नाश्ता");
    expect(translateSlot("Mid-morning", G)).toBe("दोपहर से पहले"); // hyphen folded
    expect(translateDay("Mon", G)).toBe("सोमवार");
  });
  it("returns undefined for unknown", () => {
    expect(translateSlot("Brunch", G)).toBeUndefined();
  });
});

describe("translateWeek", () => {
  const week: AppWeekMenu = {
    week: 1,
    current: true,
    days: [
      {
        dow: "Mon",
        slots: [
          {
            slot: "Breakfast",
            dish: "Jowar roti (2) + Paneer bhurji (1 katori)",
            components: [
              { title: "Jowar roti", portion: "2" },
              { title: "Paneer bhurji", portion: "1 katori" },
            ],
          },
        ],
      },
    ],
  };

  it("translates what it can, keeps the rest English, and counts coverage", () => {
    const { index, maxWords } = buildTermIndex(G, []);
    const cov = { components: 0, translated: 0 };
    const out = translateWeek(week, G, index, maxWords, cov);
    const slot = out.days[0].slots[0];
    expect(slot.slot.hi).toBe("नाश्ता");
    expect(slot.components[0].title.hi).toBe("ज्वार रोटी"); // resolved
    expect(slot.components[0].portion?.hi).toBe("2");
    expect(slot.components[1].title.hi).toBeUndefined(); // paneer unresolved
    expect(slot.components[1].title.en).toBe("Paneer bhurji"); // English preserved
    expect(slot.components[1].portion?.hi).toBe("1 कटोरी"); // portion still translated
    expect(cov).toEqual({ components: 2, translated: 1 });
  });
});

describe("translateRecipe", () => {
  const recipe: AppRecipe = {
    title: "Dal fry",
    serves: "2",
    ingredients: ["1 cup toor dal", "1 tsp turmeric"],
    method: ["Pressure-cook the dal.", "Temper and simmer."],
    translations: {
      hi: {
        name: "दाल फ्राई",
        ingredients: ["1 कप तूर दाल"],
        method: ["दाल को प्रेशर कुक करें।", "तड़का लगाकर पकाएँ।"],
      },
    },
  };

  it("uses the authored language block and pairs lines with English", () => {
    const out = translateRecipe(recipe, G);
    expect(out.title.hi).toBe("दाल फ्राई");
    expect(out.ingredients[0]).toEqual({ en: "1 cup toor dal", hi: "1 कप तूर दाल" });
    expect(out.ingredients[1].hi).toBeUndefined(); // shorter hi list → English only
    expect(out.method[0].hi).toBe("दाल को प्रेशर कुक करें।");
  });

  it("falls back to glossary name when no recipe block exists", () => {
    const out = translateRecipe({ title: "Jowar roti", ingredients: [], method: [] }, G);
    expect(out.title.hi).toBe("ज्वार रोटी");
    expect(out.method).toEqual([]);
  });
});
