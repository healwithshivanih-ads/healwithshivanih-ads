/**
 * Which eating-out guide applies this week, and which card answers a question.
 * The client reads the coach's lines as written, so the only things that can
 * go wrong here are showing the wrong phase's guide or the wrong place's card.
 */

import { describe, expect, it } from "vitest";
import { defaultSituation, eatingOutContext, matchSituation, pickEatingOutGuide } from "./eating-out";

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
