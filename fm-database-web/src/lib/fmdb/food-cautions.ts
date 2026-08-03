import "server-only";

/**
 * Condition ↔ food cautions, coach-facing half.
 *
 * The catalogue could say a food HELPS a condition (`good_for` on a recipe,
 * `relevant_meal_foods()` on the menu drafters) and had no way to say a food
 * warrants CARE for one. That is why ragi reached a hypothyroid client's weekly
 * menu: generate-week-menu rule 11 rotates millets, ragi-roti is
 * `good_for: [blood-sugar-regulation]` so it ranked well, and the three hard
 * filters (diet / allergens / foods_to_avoid) had no reason to stop it — while
 * the knowledge that millet is goitrogenic sat in
 * claims/murray-goitrogens-cooked-vs-raw.yaml as prose that gated nothing.
 *
 * Data: fm-database/data/_food_cautions.yaml, whose header carries the design
 * rules. Engine half: scripts/food_cautions.py (menu drafters, recipe
 * scoring). This module is what reaches the COACH — it feeds the plan-conflict
 * detector so she sees the caution while she is editing the plan, which is the
 * only moment she can act on it.
 *
 * ── Why this is not a second copy of the engine ────────────────────────────
 *
 * Both sides read the same YAML and the same ingredient alias index. What
 * differs is the input, deliberately:
 *
 *   Python  parses ingredient LINES ("1.5 cups ragi flour") through
 *           nutrients_lib.normalize_item + NutrientTable.match, and scores
 *           recipes.
 *   TS      scans coach PROSE (`nutrition.add`, `non_negotiables`) for a
 *           mention, and surfaces a note.
 *
 * Neither invents food identity: the alias lists come from
 * `_ingredient_nutrients.yaml` via loadNutrientTable(). food-cautions.test.ts
 * pins the shared data and asserts the condition-matching agrees with the
 * Python module on the same fixtures.
 *
 * NOTHING HERE FILTERS ANYTHING. It surfaces. `foods_to_avoid` is the only
 * hard filter over food and only the coach writes it — see the data file's
 * header rule 2.
 */
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { getCataloguePath } from "@/lib/fmdb/paths";
import { loadNutrientTable } from "@/lib/fmdb/recipe-nutrients";

export type CautionSeverity = "avoid" | "moderate" | "monitor";

export interface FoodCaution {
  id: string;
  label: string;
  severity: CautionSeverity;
  mechanism: string;
  /** `"cooked"` means this preparation INACTIVATES the mechanism. Null means
   *  no preparation clears it. Never a "helps a bit" value — that is
   *  `preparationNote`, which changes nothing. See the data file's rule 3. */
  preparationClears: "cooked" | null;
  preparationNote: string;
  /** ingredient keys from `_ingredient_nutrients.yaml` */
  foods: string[];
  /** lowercase substrings matched against the client's condition text */
  conditionTerms: string[];
  coachNote: string;
  claims: string[];
  drugs: string[];
}

/** A caution that applies to one client, with the evidence of why it fired. */
export interface LiveFoodCaution extends FoodCaution {
  /** which of the client's own condition strings triggered it */
  matchedConditions: string[];
}

export interface ClientConditionLike {
  active_conditions?: string[] | null;
  medical_history?: string[] | null;
  foods_to_avoid?: string | null;
  non_negotiables?: string | null;
}

interface RawCaution {
  id?: unknown;
  label?: unknown;
  status?: unknown;
  severity?: unknown;
  mechanism?: unknown;
  preparation_clears?: unknown;
  preparation_note?: unknown;
  foods?: unknown;
  condition_terms?: unknown;
  coach_note?: unknown;
  claims?: unknown;
  drugs?: unknown;
}

const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : [];

const squish = (v: unknown): string => String(v ?? "").split(/\s+/).filter(Boolean).join(" ");

let cached: Promise<FoodCaution[]> | undefined;

/**
 * Every ACTIVE caution, read once.
 *
 * `needs_review` entries are excluded on purpose — they exist so real but
 * not-yet-sourced knowledge has somewhere to live without silently becoming a
 * gate. Returns `[]` when the file is absent, so a stripped checkout behaves
 * exactly as it did before this existed.
 */
export function loadFoodCautions(): Promise<FoodCaution[]> {
  cached ??= (async () => {
    try {
      const file = path.join(getCataloguePath(), "_food_cautions.yaml");
      const doc = yaml.load(await fs.readFile(file, "utf-8")) as
        | { cautions?: RawCaution[] }
        | undefined;
      const rows = Array.isArray(doc?.cautions) ? doc!.cautions! : [];
      return rows
        .filter((c) => String(c.status ?? "active") === "active" && c.id)
        .map<FoodCaution>((c) => ({
          id: String(c.id),
          label: String(c.label ?? c.id),
          severity: (["avoid", "moderate", "monitor"] as const).includes(
            c.severity as CautionSeverity,
          )
            ? (c.severity as CautionSeverity)
            : "moderate",
          mechanism: String(c.mechanism ?? ""),
          preparationClears: c.preparation_clears === "cooked" ? "cooked" : null,
          preparationNote: squish(c.preparation_note),
          foods: strArr(c.foods),
          conditionTerms: strArr(c.condition_terms).map((t) => t.toLowerCase()),
          coachNote: squish(c.coach_note),
          claims: strArr(c.claims),
          drugs: strArr(c.drugs),
        }));
    } catch {
      return [];
    }
  })();
  return cached;
}

/** Test seam — the module-level cache would otherwise outlive a fixture. */
export function __resetFoodCautionCache(): void {
  cached = undefined;
}

/**
 * Everything about this client that could name a condition.
 *
 * `medical_history` counts as well as `active_conditions`: a Hashimoto's
 * client whose antibodies normalised is still hypothyroid, and resolving a
 * condition (condition-status.ts) moves it into exactly that list.
 */
export function clientConditionText(client: ClientConditionLike): string {
  return [...(client.active_conditions ?? []), ...(client.medical_history ?? [])]
    .map((x) => String(x))
    .join(" | ")
    .toLowerCase();
}

/** The cautions that apply to THIS client, each carrying what triggered it. */
export function liveFoodCautions(
  client: ClientConditionLike,
  cautions: FoodCaution[],
): LiveFoodCaution[] {
  const blob = clientConditionText(client);
  if (!blob.trim()) return [];
  const out: LiveFoodCaution[] = [];
  for (const c of cautions) {
    const matched = c.conditionTerms.filter((t) => blob.includes(t));
    if (matched.length) out.push({ ...c, matchedConditions: [...new Set(matched)].sort() });
  }
  return out;
}

/**
 * Every spelling an ingredient key answers to, for SCANNING prose.
 *
 * Aliases come from `_ingredient_nutrients.yaml` so there is no second food
 * vocabulary to maintain. These are matching fodder — for something to show a
 * human, use `plainFoodNames`.
 */
export async function foodDisplayTerms(keys: string[]): Promise<Map<string, string[]>> {
  const table = await loadNutrientTable();
  const out = new Map<string, string[]>();
  for (const k of keys) {
    const aliases = table?.entries[k]?.aliases ?? [];
    const terms = [...new Set([...aliases.map((a) => a.toLowerCase()), k.replace(/-/g, " ")])]
      // longest first, so "sweet potato" is tried before "potato"
      .sort((a, b) => b.length - a.length);
    out.set(k, terms);
  }
  return out;
}

/** Key suffixes that describe the table's bookkeeping, not the food. */
const KEY_QUALIFIERS = [" generic", " cooked", " soaked", " thin"];

/**
 * The plainest name for a food, derived from the KEY.
 *
 * Not from the shortest alias: the shortest alias for `chicken` is "leg",
 * which rendered a purine caution as "lamb, fish, prawns, leg". The key is the
 * canonical identifier and reads correctly nearly always. Mirrors
 * `plain_food_names` in scripts/food_cautions.py.
 */
export function plainFoodNames(keys: string[]): string[] {
  return keys.map((k) => {
    let name = k.replace(/-/g, " ").trim();
    for (const q of KEY_QUALIFIERS) {
      if (name.endsWith(q)) name = name.slice(0, -q.length).trim();
    }
    return name || k;
  });
}

/** One caution, fully resolved against a client + plan for the coach UI. */
export interface FoodCautionFinding {
  caution: LiveFoodCaution;
  /** plain, coach-readable names for every food the caution covers */
  foodNames: string[];
  /** cautioned foods actually named in this plan's EAT FREELY / non-negotiables */
  inPlanFoods: string[];
  /** the coach has already written one of these foods into `foods_to_avoid` */
  alreadyRecorded: boolean;
}

/**
 * Resolve every live caution against this client's plan.
 *
 * Async because food names come from the ingredient table; kept out of
 * `detectPlanConflicts` so that stays pure and synchronously testable.
 *
 * `alreadyRecorded` is what stops this nagging. Once the coach has written
 * "raw cabbage" into `foods_to_avoid` she has made her decision and the
 * conflict drops to informational — a detector that keeps firing after it has
 * been acted on trains people to ignore it.
 */
export async function resolveFoodCautionFindings(
  client: ClientConditionLike,
  plan: { nutrition?: { add?: unknown; pattern?: unknown } | null } | null,
): Promise<FoodCautionFinding[]> {
  const live = liveFoodCautions(client, await loadFoodCautions());
  if (!live.length) return [];

  const allKeys = [...new Set(live.flatMap((c) => c.foods))];
  const terms = await foodDisplayTerms(allKeys);

  const plain = plainFoodNames(allKeys);
  const plainByKey = new Map(allKeys.map((k, i) => [k, plain[i]]));
  const nutrition = plan?.nutrition ?? null;
  const planText = [
    Array.isArray(nutrition?.add) ? (nutrition!.add as unknown[]).join(", ") : "",
    typeof nutrition?.pattern === "string" ? nutrition.pattern : "",
    client.non_negotiables ?? "",
  ].join(" | ");
  const avoidText = client.foods_to_avoid ?? "";

  return live.map((caution) => {
    const inPlanFoods = cautionedFoodsInText(planText, caution, terms);
    return {
      caution,
      foodNames: caution.foods.map((k) => plainByKey.get(k) ?? k.replace(/-/g, " ")),
      inPlanFoods,
      alreadyRecorded: cautionedFoodsInText(avoidText, caution, terms).length > 0,
    };
  });
}

/**
 * Which of a caution's foods are named in a blob of coach prose.
 *
 * Word-boundary containment over free text — this reads `nutrition.add`
 * ("millets, seasonal vegetables, whole grains") and `non_negotiables`, not
 * ingredient lines. Terms under 4 characters are skipped: the same length
 * guard the backlog suggestion chips needed after "IF" matched inside
 * "Behavior Modifications".
 */
export function cautionedFoodsInText(
  text: string,
  caution: FoodCaution,
  terms: Map<string, string[]>,
): string[] {
  const hay = ` ${String(text ?? "").toLowerCase()} `;
  if (!hay.trim()) return [];
  const hits: string[] = [];
  for (const key of caution.foods) {
    const words = terms.get(key) ?? [key.replace(/-/g, " ")];
    const found = words.some((w) => {
      if (w.length < 4) return false;
      return new RegExp(`(?<![a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:e?s)?(?![a-z])`).test(
        hay,
      );
    });
    if (found) hits.push(key);
  }
  return hits;
}
