/**
 * How one recipe ingredient reads on a client's card.
 *
 * The library stores every ingredient split three ways (`qty` / `unit` /
 * `item`) because the recipe overlay scales servings by multiplying `qty`.
 * Joining the three fields back together naively is what produced the
 * machine-output chips the coach saw on a live meal card:
 *
 *     "10 leaves curry leaves"   "1 piece onion, chopped"   "to taste salt"
 *
 * Fixing that in the DATA would mean flattening the split and losing the
 * serving scaler, so it is fixed HERE instead — one helper, used by both the
 * flat list (client-app.ts) and the scaled list (ochre-overlays.tsx). Those
 * two must never drift: a client comparing the two views is looking at the
 * same recipe.
 *
 * Pure — no imports, no server code — so the client bundle can take it.
 */

/** Units that count things rather than measure them. When the quantity is
 *  more than one, the unit has to agree with it: "2 clove garlic" is the
 *  library's wording, "2 cloves garlic" is a person's. */
const PLURAL: Record<string, string> = {
  clove: "cloves", slice: "slices", leaf: "leaves", sprig: "sprigs",
  stalk: "stalks", wedge: "wedges", cube: "cubes", ring: "rings",
  ear: "ears", half: "halves", pinch: "pinches", handful: "handfuls",
  bunch: "bunches", sheet: "sheets", head: "heads", stick: "sticks",
  pod: "pods", strand: "strands", drop: "drops", can: "cans",
};

/** Units that carry no information once the item names the food. "1 piece
 *  onion, finely chopped" is just "1 onion, finely chopped". */
const EMPTY_UNITS = new Set(["piece", "pieces", "no", "nos", "pc", "pcs", "number", "unit"]);

/** Real measures. These are NEVER dropped by the echo rule below: an item may
 *  legitimately mention the same word further along ("1 tbsp red miso
 *  dissolved in 1 tbsp hot water"), and dropping the leading unit there loses
 *  the actual quantity the client has to measure out. */
const MEASURES = new Set([
  "tsp", "tbsp", "cup", "cups", "g", "kg", "mg", "ml", "l", "oz", "lb", "lbs",
  "teaspoon", "teaspoons", "tablespoon", "tablespoons", "ounce", "ounces",
  "gram", "grams", "quart", "quarts", "pint", "pints", "litre", "litres", "liter",
]);

/** A quantity written as words, not digits — "to taste", "as needed". Reads
 *  as an instruction, so it belongs after the food, not in front of it. */
const PROSE_QTY = /^(to taste|as needed|as desired|as required|a little|a pinch|a few|few|equal to .*)$/i;

/** Leading number of a quantity, tolerating ranges ("8-10") and fractions. */
function leadingNumber(qty: string): number {
  const m = qty.match(/^\s*(\d+(?:\.\d+)?)/);
  if (m) return parseFloat(m[1]);
  const f = qty.match(/^\s*(\d+)\s*\/\s*(\d+)/);
  return f ? parseInt(f[1], 10) / parseInt(f[2], 10) : NaN;
}

/** True when `unit` already names something the item names — the source of
 *  "10 leaves curry leaves", "2 whole whole cloves" and "0.5 small lime lime
 *  juice". Checked word by word, because the stutter is often only part of a
 *  multi-word unit ("small lime", "whole lemon", "juice of half lemon"). */
function unitEchoesItem(unit: string, item: string): boolean {
  const words = unit.toLowerCase().match(/[a-z]+/g) ?? [];
  // a unit carrying a real measure anywhere is never dropped: "tbsp (or 3 tbsp
  // loose)" echoes "loose leaf black tea", and dropping it loses the tbsp
  if (words.some((w) => MEASURES.has(w))) return false;
  const lower = item.toLowerCase();
  return words.some((w) => {
    const stem = w.replace(/e?s$/, "");
    if (stem.length < 3) return false;
    return new RegExp(`\\b${stem}(e?s)?\\b`).test(lower);
  });
}

/**
 * Render one ingredient the way a person would write it.
 *
 * Both call sites pass the raw `unit`/`item`; only `qty` differs (the overlay
 * passes an already-scaled quantity).
 */
export function formatIngredientChip(qtyRaw: string, unitRaw: string, itemRaw: string): string {
  const item = (itemRaw ?? "").trim();
  if (!item) return "";
  let qty = (qtyRaw ?? "").trim();
  let unit = (unitRaw ?? "").trim();

  // A unit holding an instruction ("to taste", "medium, roughly chopped")
  // reads as prose in front of the food. Move the tail behind the item and
  // drop the invented "1" that was standing in for a real quantity.
  let suffix = "";
  const unitToTaste = /^(.*?),?\s*(to taste|or to taste)$/i.exec(unit);
  if (unitToTaste) {
    unit = unitToTaste[1].trim();
    suffix = "to taste";
    if (!unit && qty === "1") qty = "";
  }

  if (EMPTY_UNITS.has(unit.toLowerCase())) unit = "";
  else if (unit && !MEASURES.has(unit.toLowerCase()) && unitEchoesItem(unit, item)) unit = "";
  else if (unit) {
    const n = leadingNumber(qty);
    const plural = PLURAL[unit.toLowerCase()];
    if (plural && isFinite(n) && n > 1) unit = plural;
  }

  // "to taste salt" -> "salt, to taste"
  if (qty && PROSE_QTY.test(qty)) {
    suffix = suffix || qty.toLowerCase();
    qty = "";
  }

  const head = [qty, unit, item].filter(Boolean).join(" ").trim();
  // don't say it twice: "sea salt and ground black pepper to taste, to taste"
  if (suffix && new RegExp(`\\b${suffix}\\b`, "i").test(item)) suffix = "";
  return suffix ? `${head}, ${suffix}` : head;
}
