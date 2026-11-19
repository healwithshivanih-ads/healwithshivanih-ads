/**
 * Which eating-out guide applies this week, and which card answers a question.
 * The client reads the coach's lines as written, so the only things that can
 * go wrong here are showing the wrong phase's guide or the wrong place's card.
 */

import { describe, expect, it } from "vitest";
import { defaultSituation, dishesInGuide, eatingOutContext, eatingOutContextFor, matchSituation, pickEatingOutGuide } from "./eating-out";

const sit = (where: string, over: Record<string, unknown> = {}) => ({ where, choose: [`${where}: choose`], skip: [`${where}: skip`], ...over });
const WHOLE = { rules: ["Vegetables first"], situations: [sit("At a restaurant"), sit("At a hotel buffet"), sit("At a wedding or party"), sit("Travelling")], not_on_list: "Choose the plainest cooked dish." };
const REMOVE = { label: "Remove phase", from_week: 1, to_week: 4, rules: ["No raw salads"], situations: [sit("At a restaurant")] };
const REPAIR = { label: "Repair phase", from_week: 5, to_week: 8, rules: ["Soups first"], situations: [sit("At a restaurant")] };

describe("pickEatingOutGuide", () => {
  it("is null for a plan with no guide, or one that is not a list", () => {
    expect(pickEatingOutGuide(undefined, 3)).toBeNull();
    expect(pickEatingOutGuide([], 3)).toBeNull();
    expect(pickEatingOutGuide({ rules: ["x"] }, 3)).toBeNull();
    expect(pickEatingOutGuide([null, "x", 4], 3)).toBeNull();
  });

  it("uses the whole-plan guide in any week", () => {
    for (const week of [1, 6, 26]) expect(pickEatingOutGuide([WHOLE], week)?.rules).toEqual(["Vegetables first"]);
  });

  it("uses the guide for the section of the plan she is in", () => {
    const guides = [REMOVE, REPAIR];
    expect(pickEatingOutGuide(guides, 1)?.label).toBe("Remove phase");
    expect(pickEatingOutGuide(guides, 4)?.label).toBe("Remove phase");
    expect(pickEatingOutGuide(guides, 5)?.label).toBe("Repair phase");
    expect(pickEatingOutGuide(guides, 8)?.label).toBe("Repair phase");
  });

  it("a section's guide wins over the whole-plan guide, which fills the other weeks", () => {
    expect(pickEatingOutGuide([WHOLE, REMOVE], 2)?.label).toBe("Remove phase");
    expect(pickEatingOutGuide([WHOLE, REMOVE], 9)?.label).toBe("");
  });

  it("a week no guide covers gets none, never another phase's guide", () => {
    expect(pickEatingOutGuide([REMOVE, REPAIR], 9)).toBeNull();
  });

  it("when sections overlap, the first listed wins — as plan-check tells the coach", () => {
    const a = { ...REMOVE, to_week: 6 };
    expect(pickEatingOutGuide([a, REPAIR], 5)?.label).toBe("Remove phase");
  });

  it("drops a situation with no heading or nothing to choose, and a guide left empty", () => {
    const g = pickEatingOutGuide([{ rules: ["x"], situations: [{ where: "", choose: ["a"] }, { where: "At a cafe", choose: [] }, sit("At a restaurant")] }], 1);
    expect(g?.situations.map((s) => s.where)).toEqual(["At a restaurant"]);
    expect(pickEatingOutGuide([{ rules: [], situations: [{ where: "x", choose: [] }] }], 1)).toBeNull();
  });

  it("carries the coach's words untouched", () => {
    const g = pickEatingOutGuide([{ ...WHOLE, situations: [sit("At a restaurant", { choose: ["Dal, sabzi, and rice or jowar roti"], skip: ["Naan"], note: "Eat slowly.", keywords: ["Italian"] })] }], 1)!;
    expect(g.situations[0]).toEqual({ where: "At a restaurant", keywords: ["italian"], choose: ["Dal, sabzi, and rice or jowar roti"], skip: ["Naan"], note: "Eat slowly." });
    expect(g.notOnList).toBe("Choose the plainest cooked dish.");
  });
});

describe("matchSituation", () => {
  const guide = pickEatingOutGuide([{ ...WHOLE, situations: [...WHOLE.situations, sit("At an Italian place", { keywords: ["italian", "pasta", "pizza"] })] }], 1)!;
  it.each([
    ["hotel buffet what do i eat", "At a hotel buffet"],
    ["hotel breakfast", "At a hotel buffet"],
    ["airport lounge what do i eat", "Travelling"],
    ["i'm travelling tuesday to thursday", "Travelling"],
    ["wedding saturday what do i do", "At a wedding or party"],
    ["Wedding buffet on Saturday, how do I handle it?", "At a wedding or party"],
    ["shaadi me kya khau", "At a wedding or party"],
    ["I'm eating out tonight", "At a restaurant"],
    ["business lunch tomorrow what do i order", "At a restaurant"],
    // The coach's own keywords are the more particular, so they win.
    ["client dinner italian tonight", "At an Italian place"],
    ["can I have pizza at the restaurant", "At an Italian place"],
  ])("%s → %s", (q, where) => {
    expect(matchSituation(q, guide)?.where).toBe(where);
  });

  it("is null when the guide has no card for that place", () => {
    const small = pickEatingOutGuide([{ rules: ["x"], situations: [sit("At a restaurant")] }], 1)!;
    expect(matchSituation("wedding saturday what do i do", small)).toBeNull();
    expect(matchSituation("what's for dinner", guide)).toBeNull();
  });

  it("the fallback card is the restaurant one", () => {
    expect(defaultSituation(guide)?.where).toBe("At a restaurant");
    expect(defaultSituation(pickEatingOutGuide([{ rules: [], situations: [sit("Travelling")] }], 1)!)?.where).toBe("Travelling");
  });
});

describe("eatingOutContext — what the model is shown", () => {
  it("is the guide's own lines and nothing else", () => {
    const text = eatingOutContext(pickEatingOutGuide([{ rules: ["Vegetables first"], situations: [sit("At a restaurant", { choose: ["Dal and rice"], skip: ["Naan"] })], not_on_list: "Choose the plainest cooked dish." }], 1)!);
    expect(text).toBe("Rules anywhere: Vegetables first. At a restaurant — choose: Dal and rice. Skip: Naan. A food the plan does not mention: Choose the plainest cooked dish.");
  });
});

// ── a named dish ───────────────────────────────────────────────────────────

describe("dishesInGuide — a wrong yes is the costly mistake", () => {
  const card = (where: string, choose: string[], skip: string[], keywords: string[] = []) => ({ where, choose, skip, keywords });
  const guide = pickEatingOutGuide(
    [
      {
        rules: ["Start with the vegetables"],
        situations: [
          card(
            "At any restaurant",
            ["Dal and a sabzi", "Jowar or bajra roti (bhakri), if they have it", "An egg curry or an omelette with vegetables"],
            ["Rice, naan, roti and bread — rice and wheat are left out", "Chicken, mutton, fish and any meat — your plan has no meat", "Brinjal dishes"],
          ),
          card("North Indian", ["Chana masala (chole) or rajma", "Tandoori vegetables or tandoori mushrooms", "Palak paneer or paneer tikka"], ["Naan, tandoori roti, kulcha and paratha — they are wheat", "Malai kofta, pakora and samosa — deep fried"]),
          card("South Indian", ["Pesarattu (moong dal dosa)", "Ragi dosa", "Sambar and rasam"], ["Idli, dosa and uttapam — they are made of rice", "Curd rice and lemon rice"]),
          card("Chinese", ["Stir-fried vegetables with tofu"], ["Fried rice and sushi — rice is left out", "Noodles and pad thai"]),
          card("Drinks", ["Coconut water", "Tea with milk, without sugar"], ["Sweet lassi, milkshakes and cold coffee — for the sugar"]),
          card("Sweets", ["A bowl of cut fruit"], ["Gulab jamun, jalebi and halwa — for the sugar"]),
        ],
      },
    ],
    1,
  )!;
  const verdicts = (q: string) => dishesInGuide(q, guide).map((v) => `${v.verdict}:${v.where}`);

  it.each([
    ["can i have masala dosa", ["skip:South Indian"]],
    ["can I have gulab jamun", ["skip:Sweets"]],
    ["butter naan?", ["skip:At any restaurant"]],
    ["brinjal curry", ["skip:At any restaurant"]],
    ["aloo paratha kha sakti hu", ["skip:North Indian"]],
    ["can i order pesarattu", ["choose:South Indian"]],
    ["egg curry", ["choose:At any restaurant"]],
    ["can I have an omelette", ["choose:At any restaurant"]],
    ["can i have chole", ["choose:North Indian"]],
    ["is paneer tikka ok", ["choose:North Indian"]],
  ])("%s → %j", (q, want) => {
    expect(verdicts(q)).toEqual(want);
  });

  it("a yes needs the whole dish; a dish is skipped only when it contains a whole listed food", () => {
    expect(verdicts("can i have jowar roti")).toEqual(["choose:At any restaurant"]);
    expect(verdicts("can i have ragi dosa")).toEqual(["choose:South Indian"]);
    expect(verdicts("can i have butter roti")).toEqual(["skip:At any restaurant"]);
    // "chicken curry" must never be a yes because "egg curry" is: it is skipped by the meat line.
    expect(verdicts("can i have chicken curry")).toEqual(["skip:At any restaurant"]);
    expect(verdicts("can I have butter chicken")).toEqual(["skip:At any restaurant"]);
    // "dal makhani" is not the plain dal the guide names.
    expect(verdicts("is the dal makhani ok")).toEqual([]);
    expect(verdicts("can I have paneer tikka masala")).toEqual([]);
  });

  it("round 5: a plain roti is never a yes because jowar roti is", () => {
    // The tester's wrong yes. "X with Y" is two dishes, and a bare "roti" shows both lines.
    const got = dishesInGuide("Can I have a roti with my dal?", guide);
    expect(got.map((v) => v.verdict)).toEqual(["depends", "choose"]);
    expect(got[0].line).toContain("Rice, naan, roti and bread");
    expect(got[0].instead).toEqual(["Jowar or bajra roti (bhakri), if they have it"]);
  });

  it("round 5: sharing a word with a skipped food is not enough to skip", () => {
    // "cold coffee" is skipped; that says nothing about filter coffee.
    expect(verdicts("can I have filter coffee")).toEqual([]);
    // "tandoori roti" is skipped; tandoori mushrooms are a yes in their own right.
    expect(verdicts("Can I have tandoori mushrooms?")).toEqual(["choose:North Indian"]);
    // "pad thai" is skipped; a Thai place is not a dish.
    expect(verdicts("thai place tonight")).toEqual([]);
    expect(verdicts("masala chai")).toEqual([]);
  });

  it("round 5: quotes the most particular line", () => {
    expect(dishesInGuide("can I order egg fried rice", guide)[0].line).toContain("Fried rice and sushi");
    expect(dishesInGuide("can I have curd rice", guide)[0].line).toBe("Curd rice and lemon rice");
    expect(dishesInGuide("coconut water or sweet lassi", guide).map((v) => v.line)).toEqual(["Coconut water", "Sweet lassi, milkshakes and cold coffee — for the sugar"]);
  });

  it("a reason after the dash is shown but never matched", () => {
    // "meat" and "sugar" appear only in reasons here.
    expect(verdicts("can i have sugar")).toEqual([]);
    expect(verdicts("is wheat ok")).toEqual([]);
  });

  it("a skip comes with what to have there instead", () => {
    expect(dishesInGuide("can i have masala dosa", guide)[0]).toEqual({
      verdict: "skip",
      dish: "masala dosa",
      line: "Idli, dosa and uttapam — they are made of rice",
      where: "South Indian",
      instead: ["Pesarattu (moong dal dosa)", "Ragi dosa"],
    });
  });

  it("judges each dish of several, and answers none unless it can answer all", () => {
    expect(verdicts("they have masala dosa and gulab jamun, which one")).toEqual(["skip:South Indian", "skip:Sweets"]);
    expect(verdicts("egg curry or butter naan")).toEqual(["choose:At any restaurant", "skip:At any restaurant"]);
    expect(verdicts("gulab jamun or tiramisu")).toEqual([]);
  });

  it("a one-word dish is a yes only when a choose line lists exactly that food", () => {
    const g = pickEatingOutGuide([{ rules: [], situations: [card("Street food", ["Sprouts chaat without sev", "Roasted chana"], ["Pani puri and samosa"]), card("Soups", ["Clear soup or egg drop soup", "Dal"], ["Cream of tomato"])] }], 1)!;
    const v = (q: string) => dishesInGuide(q, g).map((x) => x.verdict);
    expect(v("can i have chaat")).toEqual([]);
    expect(v("can i have soup")).toEqual([]);
    expect(v("can i have dal")).toEqual(["choose"]);
    expect(v("roasted chana")).toEqual(["choose"]);
    expect(v("sprouts chaat")).toEqual(["choose"]);
    expect(v("home made soup")).toEqual([]);
  });

  it("is empty for a dish the guide does not name, and for no dish at all", () => {
    expect(verdicts("can i eat mango")).toEqual([]);
    expect(verdicts("what can i order here")).toEqual([]);
    expect(verdicts("what is the price")).toEqual([]);
    expect(verdicts("")).toEqual([]);
  });
});

describe("eatingOutContextFor — the model is sent only the cards a question needs", () => {
  const many = pickEatingOutGuide(
    [
      {
        rules: ["Vegetables first"],
        not_on_list: "Choose the plainest cooked dish.",
        situations: ["At a restaurant", "North Indian", "South Indian", "Chinese and Asian", "Italian and continental", "At a cafe", "Sweets and desserts"].map((where) => ({
          where,
          choose: [`${where} choose line`],
          skip: where === "South Indian" ? ["Idli, dosa and uttapam"] : [`${where} skip line`],
        })),
      },
    ],
    1,
  )!;

  it("sends the card that names the dish, with the rules and the not-on-my-list line", () => {
    const text = eatingOutContextFor("can I have a dosa", many);
    expect(text).toContain("South Indian");
    expect(text).toContain("Rules anywhere: Vegetables first.");
    expect(text).toContain("A food the plan does not mention: Choose the plainest cooked dish.");
    expect(text).not.toContain("Italian");
    expect(text).not.toContain("At a cafe");
  });

  it("sends the place she names", () => {
    expect(eatingOutContextFor("what do I order at a chinese place", many)).toContain("Chinese and Asian");
  });

  it("falls back to the restaurant card, and is always far shorter than the whole guide", () => {
    const text = eatingOutContextFor("can i eat mango", many);
    expect(text).toContain("At a restaurant");
    expect(text).not.toContain("South Indian");
    expect(text.length).toBeLessThan(eatingOutContext(many).length / 2);
  });

  it("never sends more than three cards", () => {
    const text = eatingOutContextFor("restaurant north indian south indian chinese italian cafe sweets", many);
    expect(text.match(/ — choose:/g)!.length).toBeLessThanOrEqual(3);
  });
});

