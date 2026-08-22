/**
 * Recipe-pack search for the client app — the pure half.
 *
 * Coach request 2026-08-22: every approved week now stays live, so a
 * 12-week client ends up with a pack of 60–80 recipes, and "that thing I
 * liked in week 2" was a scroll-and-squint job. Two helpers:
 *
 *   - recipeMatches: does a recipe answer a free-text query? Matched on the
 *     TITLE and the INGREDIENTS (so "cabbage" finds the omelette that has it,
 *     not just dishes named after it), diacritic- and case-insensitive, every
 *     word of the query must hit somewhere.
 *   - recipeWeeks: which menu weeks serve this recipe — so each row can be
 *     tagged "Wk 2" and the list can be narrowed to a week. The join is by
 *     name: the recipe title against each week's dish strings (and their
 *     component titles), exact containment first, then every significant
 *     word of the title present in the dish. A recipe the menu never names
 *     simply gets no tag; it is still searchable.
 *
 * No React, no I/O — testable on fixtures.
 */

export interface SearchableRecipe {
  title: string;
  ingredients?: string[];
  tip?: string;
}

export interface SearchableWeek {
  week: number;
  days: { slots: { dish: string; components?: { title?: string }[] }[] }[];
}

/** Lower-case, strip diacritics and punctuation, collapse whitespace. */
export function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOP = new Set(["with", "and", "the", "of", "in", "a", "an", "or", "on", "for", "to", "style"]);

/** The words of a title worth matching on: 3+ letters, not filler. */
export function significantWords(s: string): string[] {
  return norm(s)
    .split(" ")
    .filter((w) => w.length >= 3 && !STOP.has(w));
}

export function recipeMatches(r: SearchableRecipe, query: string): boolean {
  const q = norm(query);
  if (!q) return true;
  const hay = norm([r.title, ...(r.ingredients ?? []), r.tip ?? ""].join(" "));
  return q.split(" ").every((tok) => hay.includes(tok));
}

/** Ascending week numbers whose menu names this recipe. */
export function recipeWeeks(r: SearchableRecipe, weeks: SearchableWeek[]): number[] {
  const title = norm(r.title);
  if (!title) return [];
  const words = significantWords(r.title);
  const out = new Set<number>();
  for (const w of weeks) {
    for (const d of w.days ?? []) {
      for (const s of d.slots ?? []) {
        const parts = [s.dish, ...(s.components ?? []).map((c) => c.title ?? "")].map(norm);
        const hit =
          parts.some((p) => p.includes(title)) ||
          (words.length >= 2 && parts.some((p) => words.every((word) => p.includes(word))));
        if (hit) {
          out.add(w.week);
          break;
        }
      }
      if (out.has(w.week)) break;
    }
  }
  return [...out].sort((a, b) => a - b);
}

export interface RecipeHit<R extends SearchableRecipe> {
  recipe: R;
  weeks: number[];
}

/** The recipes to show for a query and an optional week, in pack order. */
export function searchRecipes<R extends SearchableRecipe>(
  recipes: R[],
  weeks: SearchableWeek[],
  query: string,
  week: number | null = null,
): RecipeHit<R>[] {
  const hits: RecipeHit<R>[] = [];
  for (const recipe of recipes) {
    if (!recipeMatches(recipe, query)) continue;
    const rw = recipeWeeks(recipe, weeks);
    if (week !== null && !rw.includes(week)) continue;
    hits.push({ recipe, weeks: rw });
  }
  return hits;
}
