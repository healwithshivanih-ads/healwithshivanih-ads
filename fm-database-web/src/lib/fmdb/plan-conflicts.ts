import "server-only";

/**
 * Plan-conflict detector.
 *
 * Catches semantic contradictions between a client's stated preferences /
 * non-negotiables / allergies / current medications and the draft (or
 * published) plan's protocol content. Rules-based for now — a Haiku-driven
 * follow-up pass can be slotted in later for the long-tail.
 *
 * The classic example surfaced by Shivani 2026-05-13: client says
 * `dietary_preference: lactose-free` AND `non_negotiables: "tea with milk"`.
 * That's a direct contradiction; the meal-plan letter prompt was bundling
 * non_negotiables into the WILL-NOT-EAT filter, which produces flaky
 * output. Surface the conflict here, suggest a fix (e.g. switch to nut
 * milk), and let the coach apply in one click.
 *
 * Detector returns a list of conflicts; each conflict optionally carries
 * a `suggested_fix` describing a YAML patch the coach can apply.
 */

export type ConflictSeverity = "info" | "warning" | "critical";

export type ConflictFix =
  | {
      /** Patch a top-level field on `client.yaml`. */
      type: "patch_client_field";
      field: string;
      value: string;
    }
  | {
      /** Append a note line to client.yaml's `notes` or `notes_for_coach`. */
      type: "append_client_note";
      text: string;
    };

export interface ConflictSuggestion {
  /** Human-readable button label (e.g. "✓ Switch to nut milk"). */
  label: string;
  /** Longer explanation rendered as the suggestion's body. */
  rationale: string;
  /** Patch operation applied when the coach clicks Apply. */
  action: ConflictFix;
}

export interface PlanConflict {
  /** Stable id for React keys; derived from kind + content. */
  id: string;
  severity: ConflictSeverity;
  kind: string;
  summary: string;
  /** Sentence-level explanation of why this is a conflict. */
  details: string;
  /** Optional one-click suggestion; some conflicts are coach-judgment. */
  suggested_fix?: ConflictSuggestion;
}

// ─────────────────────────────────────────────────────────────────────
// Dictionary of dairy / lactose markers — case-insensitive substring
// match. Used to detect when a "lactose-free" diet collides with
// non-negotiables that mention dairy.
// ─────────────────────────────────────────────────────────────────────
const DAIRY_TOKENS = [
  "milk",
  "yoghurt",
  "yogurt",
  "curd",
  "dahi",
  "paneer",
  "cheese",
  "buttermilk",
  "lassi",
  "ghee",
  "butter",
  "cream",
  "mawa",
  "khoya",
  "ice cream",
  "kheer",
  "rasgulla",
  "rasmalai",
];

// Plant-milk fallbacks suggested by FM coaching practice (NBHWC + FMCA scope —
// nut / seed / oat milks are widely tolerated; soy depends on autoimmune
// status so we leave it off the default list).
const PLANT_MILK_SUGGESTIONS = ["almond milk", "oat milk", "cashew milk", "coconut milk"];

// Vegan-incompatible animal products (everything from animals).
const ANIMAL_TOKENS = [
  ...DAIRY_TOKENS,
  "egg",
  "fish",
  "chicken",
  "mutton",
  "beef",
  "pork",
  "honey",
  "gelatin",
];

// Vegetarian-Jain / strict-vegetarian incompatible products. Jain diet is
// LACTO-VEGETARIAN — dairy (milk, ghee, paneer, dahi, etc.) is fully
// permitted. Only flesh foods, eggs, honey (ahimsa — bees are harmed) and
// gelatin are excluded. Coach correction 2026-05-15.
const NON_VEGAN_VEG_ANIMAL_TOKENS = [
  "egg",
  "fish",
  "chicken",
  "mutton",
  "beef",
  "pork",
  "gelatin",
  // Honey: strict-orthodox Jain excludes, but most lay-Jain followers in
  // India consume it. Leaving out of the auto-flag — coach can flag manually
  // if needed for a strict-orthodox client.
];

// Jain-incompatible roots.
const ROOT_TOKENS = [
  "onion",
  "garlic",
  "potato",
  "ginger root",
  "carrot",
  "beetroot",
  "radish",
  "turnip",
];

function tokenMatches(haystack: string, tokens: string[]): string[] {
  const h = haystack.toLowerCase();
  return tokens.filter((t) => h.includes(t));
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

interface ClientLike {
  dietary_preference?: string;
  non_negotiables?: string;
  foods_to_avoid?: string;
  allergies?: string[];
  known_allergies?: string[];
  current_medications?: string[];
  medications?: string[];
}

type PlanLike = Record<string, unknown>;

export function detectPlanConflicts(
  client: ClientLike,
  _plan: PlanLike | null,
): PlanConflict[] {
  const out: PlanConflict[] = [];

  const dietary = (client.dietary_preference ?? "").trim().toLowerCase();
  const nonNeg = (client.non_negotiables ?? "").trim();
  const foodsAvoid = (client.foods_to_avoid ?? "").trim();

  // ── Rule 1: lactose-free / dairy-free vs dairy non-negotiable ──────
  const lactoseFree =
    dietary.includes("lactose-free") ||
    dietary.includes("lactose free") ||
    dietary.includes("dairy-free") ||
    dietary.includes("dairy free");
  if (lactoseFree && nonNeg) {
    const matched = tokenMatches(nonNeg, DAIRY_TOKENS);
    if (matched.length > 0) {
      // Build a natural-language replacement for the non-negotiable text
      // (e.g. "tea with milk" → "tea with nut milk"). Falls back to a
      // generic suggestion if we can't substitute cleanly.
      const suggestion = PLANT_MILK_SUGGESTIONS[0]; // default: almond milk
      const replaced = matched.reduce<string>(
        (acc, token) =>
          acc.replace(
            new RegExp(`\\b${token}\\b`, "gi"),
            // "milk" → "nut milk"; "ghee" → "ghee alternative"
            token.toLowerCase() === "milk" ? `${suggestion}` : `${token} alternative`,
          ),
        nonNeg,
      );
      const isUnchanged = replaced.trim().toLowerCase() === nonNeg.trim().toLowerCase();
      out.push({
        id: `dairy-non-neg-${slug(matched.join("-"))}`,
        severity: "warning",
        kind: "dietary_vs_nonnegotiable",
        summary: `Dietary preference is "lactose-free" but non-negotiables mention ${matched.join(", ")}`,
        details:
          `The client wants a lactose-free diet (or has been advised one), but ` +
          `they've also said they won't give up "${nonNeg}". The plan can either ` +
          `(a) accept the contradiction and let the daily dairy ritual stand, ` +
          `(b) substitute a plant-based alternative, or (c) flag this for ` +
          `discussion at the next session.`,
        suggested_fix: isUnchanged
          ? undefined
          : {
              label: `Switch the non-negotiable to "${replaced}"`,
              rationale:
                `Keeps the ritual (the actual non-negotiable is the routine, not the ` +
                `specific ingredient) while honouring the lactose-free preference. ` +
                `Coach can revisit if the client wants real dairy back.`,
              action: {
                type: "patch_client_field",
                field: "non_negotiables",
                value: replaced,
              },
            },
      });
    }
  }

  // ── Rule 2: vegan / vegetarian-strict vs animal products ──────────
  // IMPORTANT: Jain vegetarian ≠ vegan. Jain is LACTO-VEGETARIAN — dairy
  // is permitted (milk, ghee, paneer, dahi). Only flesh/eggs/gelatin
  // (and strict-orthodox: honey) are excluded. Use the narrower token
  // set for strict-veg / Jain to avoid false positives like "Jain client
  // listed milk in non-negotiables".
  const vegan = dietary.includes("vegan");
  const vegStrict = dietary.includes("strict vegetarian") || dietary.includes("jain");
  if ((vegan || vegStrict) && nonNeg) {
    const animals = vegan
      ? tokenMatches(nonNeg, ANIMAL_TOKENS)
      : tokenMatches(nonNeg, NON_VEGAN_VEG_ANIMAL_TOKENS);
    if (animals.length > 0) {
      out.push({
        id: `vegan-non-neg-${slug(animals.join("-"))}`,
        severity: "warning",
        kind: "dietary_vs_nonnegotiable",
        summary: `Dietary preference is "${client.dietary_preference}" but non-negotiables mention ${animals.join(", ")}`,
        details:
          `${vegan ? "Vegan diets exclude all animal products" : "Strict vegetarian / Jain diets exclude meat, fish, eggs and gelatin (dairy is allowed in Jain — lacto-vegetarian)"}, ` +
          `but the non-negotiable list mentions ${animals.join(", ")}. Reconcile before the meal plan goes out — ` +
          `the AI will otherwise either silently drop the non-negotiable or include the animal product in the plan.`,
      });
    }
  }

  // ── Rule 3: Jain-style diet vs root vegetables in non-negotiables ──
  if (dietary.includes("jain") && nonNeg) {
    const roots = tokenMatches(nonNeg, ROOT_TOKENS);
    if (roots.length > 0) {
      out.push({
        id: `jain-roots-${slug(roots.join("-"))}`,
        severity: "warning",
        kind: "dietary_vs_nonnegotiable",
        summary: `Jain diet excludes ${roots.join(", ")} but non-negotiables include them`,
        details:
          `Jain dietary tradition excludes root vegetables (onion, garlic, potato, ` +
          `carrot, beetroot, radish, turnip) — but the client has listed ${roots.join(", ")} ` +
          `as a non-negotiable. Coach: clarify whether the client follows strict Jain ` +
          `or a relaxed variation.`,
      });
    }
  }

  // ── Rule 4: allergy vs non-negotiable / foods-to-avoid duplication ─
  const allergies = [
    ...(client.allergies ?? []),
    ...(client.known_allergies ?? []),
  ]
    .map((a) => a.toLowerCase().trim())
    .filter(Boolean);
  if (allergies.length > 0 && nonNeg) {
    const conflicts = allergies.filter((a) =>
      nonNeg.toLowerCase().includes(a),
    );
    if (conflicts.length > 0) {
      out.push({
        id: `allergy-non-neg-${slug(conflicts.join("-"))}`,
        severity: "critical",
        kind: "allergy_vs_nonnegotiable",
        summary: `Allergy "${conflicts.join(", ")}" appears in non-negotiables`,
        details:
          `The client is allergic to ${conflicts.join(", ")} but the non-negotiables ` +
          `list still mentions it. This needs to be removed from the non-negotiable ` +
          `line — an allergy always wins over a preference.`,
      });
    }
  }

  // ── Rule 5: foods-to-avoid vs non-negotiable (mild contradiction) ──
  if (foodsAvoid && nonNeg) {
    // Split foods_to_avoid into rough tokens (comma / line separated).
    const avoidTokens = foodsAvoid
      .split(/[,\n;]/)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 2);
    const overlapping = avoidTokens.filter((t) =>
      nonNeg.toLowerCase().includes(t),
    );
    if (overlapping.length > 0) {
      out.push({
        id: `avoid-non-neg-${slug(overlapping.join("-"))}`,
        severity: "warning",
        kind: "avoid_vs_nonnegotiable",
        summary: `${overlapping.join(", ")} is in both "won't eat" and "won't give up"`,
        details:
          `The client has listed ${overlapping.join(", ")} as both a food to avoid ` +
          `AND as a non-negotiable. Decide which list is authoritative and remove ` +
          `from the other before publishing the plan.`,
      });
    }
  }

  return out;
}
