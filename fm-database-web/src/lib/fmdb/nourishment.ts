/**
 * Client-facing "nourishment note" for a week of menu.
 *
 * The coach-side surfaces show grams and floors; the CLIENT app must not —
 * the brand voice is warm and food-first, and nutrient numbers invite
 * calorie/macro anxiety that FM coaching deliberately avoids. So instead of a
 * dashboard, we distil which nutrients a week's dishes are collectively rich
 * in (from their Phase-2 `rich_in` tags) into ONE gentle, encouraging line —
 * no grams, no "you're low on…", no lab exposure (labs stay coach-mediated).
 *
 * Pure, no I/O. The caller resolves each menu dish to its library recipe and
 * passes the collected rich_in tags in.
 */

// rich_in tag → a warm, food-first fragment ("<what it's good for>").
// Order in this map is the priority order when we pick the week's top few.
const TAG_PHRASE: Record<string, string> = {
  protein: "protein to keep you satisfied",
  iron: "iron for steady energy",
  fibre: "fibre for easy digestion",
  "omega-3": "omega-3 for heart and mood",
  b12: "B12 for energy and focus",
  calcium: "calcium for strong bones",
  magnesium: "magnesium for calm and sleep",
  folate: "folate for renewal",
  "vitamin-c": "vitamin C for immunity",
  "vitamin-d": "vitamin D for immunity and mood",
  zinc: "zinc for immunity",
  potassium: "potassium for balance",
};

// A few nutrients get a warm food image for the lead-in clause.
const TAG_FOOD: Record<string, string> = {
  iron: "greens and sprouts",
  protein: "dal and paneer",
  fibre: "whole grains and vegetables",
  calcium: "curd, ragi and sesame",
  "omega-3": "seeds and nuts",
  b12: "curd and fermented foods",
  folate: "fresh greens",
  magnesium: "millets and seeds",
  "vitamin-c": "citrus and amla",
  potassium: "banana and coconut water",
  zinc: "seeds and legumes",
  "vitamin-d": "mushrooms and eggs",
};

export interface WeekNourishment {
  /** the 2-3 nutrient tags the week is richest in, most-covered first */
  tags: string[];
  /** one warm, client-facing sentence — empty when too little to say */
  line: string;
}

/**
 * Build the nourishment line from every rich_in tag across a week's dishes.
 * `tagCounts` is how many of the week's dishes carry each tag.
 */
export function weekNourishment(tagCounts: Record<string, number>): WeekNourishment {
  // Need a few dishes' worth of signal before saying anything.
  const ranked = Object.entries(tagCounts)
    .filter(([tag, n]) => n >= 2 && TAG_PHRASE[tag])
    .sort((a, b) => b[1] - a[1])
    .map(([tag]) => tag);

  const top = ranked.slice(0, 3);
  if (top.length === 0) return { tags: [], line: "" };

  const phrases = top.map((t) => TAG_PHRASE[t]);
  const leadFood = TAG_FOOD[top[0]];
  const foodClause = leadFood ? `Lots of ${leadFood} this week — ` : "This week leans into ";
  const line = `🌿 ${foodClause}${joinNat(phrases)}.`;
  return { tags: top, line };
}

function joinNat(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}
