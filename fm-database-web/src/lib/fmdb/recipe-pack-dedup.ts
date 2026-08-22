/**
 * One dish, one recipe in the client's pack.
 *
 * The pack the app renders is the client's AI-written sidecar
 * (`<slug>-recipes.md`) plus every library recipe her live menu resolves to.
 * The generator skips dishes the (client-gated) library already answers, but
 * that rule arrived after many packs were written, and the sidecar is
 * cumulative by design (recipe-pack-cumulative.test.ts) — so an AI recipe
 * written in week 1 now sits beside the library's curated twin of the same
 * dish: "3-Egg Omelette with Onion and Cabbage" next to "3-Egg Omelette
 * (Onion & Cabbage)", "Cabbage-Coconut Thoran" next to "Cabbage-coconut
 * thoran". Search made it obvious (both answer "cabbage").
 *
 * When a pack recipe and a library recipe are the same dish, the LIBRARY one
 * wins: it is curated, carries the photo and the structured quantities, and
 * it is already what the dish overlay shows (buildDishRecipeResolver resolves
 * library → pack), so the pack and the overlay agree. Within the pack itself,
 * the first of two same-titled entries is kept.
 *
 * "Same dish" = same bag of significant title words, after lower-casing,
 * stripping accents and punctuation, and dropping filler ("with", "and",
 * "of", …). Word ORDER is ignored — "Chana masala" and "Masala chana" are one
 * dish — but the bag must match exactly, so "Chana masala" and "Chana-spinach
 * masala" stay two. A library recipe's aliases count as its titles.
 *
 * Pure — no I/O — so client-app.ts calls it and the tests drive it directly.
 */

import { significantWords } from "./recipe-search";

export interface DedupableRecipe {
  title: string;
  aliases?: string[];
}

/** Order-free key for a dish title; "" when nothing significant is left. */
export function dishKey(title: string): string {
  return significantWords(title).sort().join(" ");
}

/**
 * Pack recipes that survive beside the library recipes, then the library
 * recipes themselves (first-seen per key) — in that order, matching how the
 * app lists the pack. Untitled / all-filler entries are never merged.
 */
export function dedupeRecipePack<R extends DedupableRecipe, L extends DedupableRecipe>(
  pack: R[],
  library: L[],
): { pack: R[]; library: L[]; dropped: R[] } {
  const libKeys = new Set<string>();
  const libKept: L[] = [];
  for (const l of library) {
    const tk = dishKey(l.title);
    if (tk && libKeys.has(tk)) continue; // a second library copy of the same dish
    for (const k of [tk, ...(l.aliases ?? []).map(dishKey)]) if (k) libKeys.add(k);
    libKept.push(l);
  }
  const seen = new Set<string>();
  const packKept: R[] = [];
  const dropped: R[] = [];
  for (const r of pack) {
    const k = dishKey(r.title);
    if (k && (libKeys.has(k) || seen.has(k))) {
      dropped.push(r);
      continue;
    }
    if (k) seen.add(k);
    packKept.push(r);
  }
  return { pack: packKept, library: libKept, dropped };
}
