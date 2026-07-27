/**
 * Covers scripts/menu_hygiene.py — the guard that keeps supplement doses out of
 * meal slots. It lives in Python because that is where menus are emitted (both
 * generators write the plan YAML directly), and it is driven from here because
 * vitest is the only test runner this repo has.
 *
 * The regression: "Warm milk (½ cup) + magnesium glycinate (1 capsule)" shipped
 * as a Bedtime dish on Dhanishta's plan. She already has that capsule on her
 * supplement schedule, so the app told her twice, and the menu's nutrient tally
 * counted a capsule as food. The weekly drafter reads last week's menu for
 * continuity, so it kept copying the capsule forward — it was still in the
 * week-12 draft two months later.
 *
 * The other half of the contract matters just as much: the supplement
 * catalogue is full of things people genuinely eat (amla, methi, turmeric,
 * karela, saffron), and deleting those off a menu would be the worse bug.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { TEST_PYTHON } from "./test-python";

const SCRIPTS = path.resolve(process.cwd(), "scripts");

/** Runs the real module and returns [cleaned, removed[]] per input dish. */
function strip(dishes: string[]): [string, string[]][] {
  const src = [
    "import json,sys",
    `sys.path.insert(0, ${JSON.stringify(SCRIPTS)})`,
    "from menu_hygiene import strip_supplement_doses",
    "print(json.dumps([strip_supplement_doses(d) for d in json.load(sys.stdin)]))",
  ].join("\n");
  const out = execFileSync(TEST_PYTHON, ["-c", src], {
    input: JSON.stringify(dishes),
    encoding: "utf-8",
  });
  return JSON.parse(out);
}

describe("supplement doses never reach a meal slot", () => {
  it("drops the capsule and keeps the food it was bolted onto", () => {
    expect(strip(["Warm milk (½ cup) + magnesium glycinate (1 capsule)"])).toEqual([
      ["Warm milk (½ cup)", ["magnesium glycinate (1 capsule)"]],
    ]);
  });

  it("catches the other dose presentations, not just the word capsule", () => {
    const dishes = [
      "Warm milk (½ cup) + ashwagandha (1 capsule)",
      "Methi water (1 cup) + probiotic (1 capsule)",
      "Warm milk (½ cup) + magnesium glycinate 200 mg",
      "Warm water (1 cup) + vitamin D3 (2 tablets)",
    ];
    for (const [cleaned, removed] of strip(dishes)) {
      expect(removed).toHaveLength(1);
      expect(cleaned).not.toMatch(/magnesium|ashwagandha|probiotic|vitamin/i);
    }
  });

  it("removes a vitamin or mineral whatever portion is written next to it", () => {
    // "Iron (1 tsp)" is not food; the never-food categories need no dose word.
    expect(strip(["Poha (1 bowl) + iron (1 tsp)"])[0][1]).toEqual(["iron (1 tsp)"]);
  });

  it("leaves real food alone even when the catalogue also sells it", () => {
    // Every one of these names IS a catalogue supplement. None is a dose.
    const food = [
      "Methi water (1 cup) + amla (1)",
      "Karela sabzi (3/4 cup) + Jowar roti (1)",
      "Golden milk (1 cup) + turmeric (1/4 tsp) + black pepper (pinch)",
      "Makhana dry-roasted in ghee (1 bowl) + rock salt (pinch)",
      "Almond-saffron-cardamom warm milk (½ cup)",
      "Ginger tea (1 cup) + soaked almonds (5)",
    ];
    for (const [cleaned, removed] of strip(food)) {
      expect(removed, `wrongly removed from "${cleaned}"`).toEqual([]);
    }
    expect(strip(food).map(([c]) => c)).toEqual(food);
  });

  it("does not match a supplement name buried inside a dish name", () => {
    // Whole-title match only — "Turmeric latte" is a drink, not turmeric.
    expect(strip(["Turmeric latte (1 cup) + turmeric (500 mg)"])).toEqual([
      ["Turmeric latte (1 cup)", ["turmeric (500 mg)"]],
    ]);
  });

  it("leaves a slot empty rather than inventing food to replace a capsule", () => {
    expect(strip(["magnesium glycinate (1 capsule)"])).toEqual([
      ["", ["magnesium glycinate (1 capsule)"]],
    ]);
  });
});
