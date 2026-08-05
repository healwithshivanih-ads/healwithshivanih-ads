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

import type { FoodCautionFinding } from "@/lib/fmdb/food-cautions";

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
  active_conditions?: string[];
  medical_history?: string[];
  /** Intake chips, promoted onto client.yaml by the intake submit handler. */
  oral_signs?: string[];
  eye_signs?: string[];
}

// ─────────────────────────────────────────────────────────────────────
// Rule 7 dictionaries — the sicca (dry mouth + dry eyes) screen in
// autoimmune thyroid disease. Sjogren's runs at 17% in Hashimoto's and
// 37% of autoimmune-thyroid patients meet xerostomia criteria, so this
// pairing is far too common to leave to whoever reads the file.
// ─────────────────────────────────────────────────────────────────────
const AUTOIMMUNE_THYROID_TOKENS = [
  "hashimoto",
  "autoimmune thyroid",
  "autoimmune thyroiditis",
  "anti-tpo",
  "anti tpo",
  "tpo antibod",
  "thyroid peroxidase",
  "thyroglobulin antibod",
  "tgab",
];

const DRY_MOUTH_TOKENS = ["dry mouth", "xerostomia", "mouth is dry", "thirsty all the time"];

const DRY_EYE_TOKENS = [
  "dry eye",
  "dry eyes",
  "dry, gritty",
  "gritty",
  "burning eyes",
  "keratoconjunctivitis sicca",
  "sicca",
];

/**
 * Drugs that cause dry mouth in their own right. Their presence does NOT
 * cancel the screen — it supplies a competing explanation the coach should
 * weigh first, which is cheaper to act on than an antibody panel.
 */
const DRYING_DRUG_TOKENS = [
  "amitriptyline",
  "nortriptyline",
  "alprazolam",
  "clonazepam",
  "diazepam",
  "benzo",
  "sertraline",
  "fluoxetine",
  "escitalopram",
  "citalopram",
  "venlafaxine",
  "ssri",
  "snri",
  "antihistamine",
  "cetirizine",
  "levocetirizine",
  "fexofenadine",
  "allegra",
  "oxybutynin",
  "solifenacin",
  "tramadol",
  "opioid",
  "furosemide",
  "hydrochlorothiazide",
  "diuretic",
];

/**
 * Naming a possible autoimmune diagnosis to a health-anxious client can do
 * real harm. Where these appear, rule 7 stays `info`, drops the diagnosis
 * from all client-facing wording, and says so.
 */
const HEALTH_ANXIETY_TOKENS = [
  "health anxiety",
  "illness phobia",
  "illness anxiety",
  "hypochondria",
  "fear of being diagnosed",
];

type PlanLike = Record<string, unknown>;

export function detectPlanConflicts(
  client: ClientLike,
  _plan: PlanLike | null,
  /**
   * Condition ↔ food cautions, pre-resolved by
   * `food-cautions.ts::resolveFoodCautionFindings` (async — it reads the
   * catalogue). Passed in rather than loaded here so this function stays pure
   * and synchronously testable, which is the property every other rule relies
   * on. Omitted → rule 6 simply doesn't fire.
   */
  foodCautions: FoodCautionFinding[] = [],
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

  // ── Rule 6: condition ↔ food cautions ─────────────────────────────
  //
  // Unlike rules 1-5 this is not a contradiction in what the coach wrote — it
  // is knowledge from the catalogue she may not have to hand while editing.
  // Ragi is the case that prompted it: goitrogenic in hypothyroidism, and
  // nothing in the app said so at the moment she could act.
  //
  // It NEVER proposes removing the food. Most cautioned foods are genuinely
  // good for the same client in other ways, and `foods_to_avoid` — the one
  // hard filter over food — stays hers to write. The suggestion records the
  // caution on the client so the decision is captured either way.
  for (const f of foodCautions) {
    const { caution } = f;
    const conditions = caution.matchedConditions.join(", ");
    const named = f.inPlanFoods.length > 0;
    const shown = (named
      ? f.inPlanFoods.map(
          (k) => f.foodNames[caution.foods.indexOf(k)] ?? k.replace(/-/g, " "),
        )
      : f.foodNames
    ).slice(0, 6);
    const more = (named ? f.inPlanFoods.length : f.foodNames.length) - shown.length;
    const foodList = shown.join(", ") + (more > 0 ? ` +${more} more` : "");

    const prep =
      caution.preparationClears === "cooked"
        ? `Cooking inactivates it, so these are fine cooked — the concern is raw, ` +
          `and being the daily staple rather than an occasional food. `
        : caution.preparationNote
          ? `${caution.preparationNote} `
          : `No preparation clears this one, so frequency is the only lever. `;

    out.push({
      id: `food-caution-${caution.id}`,
      // Informational once she has recorded a decision — see `alreadyRecorded`.
      severity: f.alreadyRecorded ? "info" : named ? "warning" : "info",
      kind: "condition_food_caution",
      summary:
        `${caution.label} — ${foodList}` +
        (named ? " (named in this plan)" : "") +
        (f.alreadyRecorded ? " · already noted in foods-to-avoid" : ""),
      details:
        `Matched on "${conditions}" in this client's record. ${caution.coachNote} ` +
        prep +
        `This is guidance, not a restriction: the food is still offered and simply ` +
        `ranks lower, and the menu drafter is told to keep it occasional and cooked. ` +
        `To enforce it, add it to foods-to-avoid yourself — writing "raw ${shown[0] ?? "food"}" ` +
        `rather than the bare food restricts only the raw uses. ` +
        `Evidence: ${caution.claims.join(", ") || "—"}.`,
      suggested_fix: f.alreadyRecorded
        ? undefined
        : {
            label: "✓ Note this on the client",
            rationale:
              `Records the caution and its guidance on the client's notes so the ` +
              `decision is visible next session. Changes nothing about the plan or ` +
              `the menu — the food keeps being offered.`,
            action: {
              type: "append_client_note",
              text:
                `[food caution] ${caution.label} — ${foodList}. ` +
                `Matched on: ${conditions}. ${caution.coachNote}`,
            },
          },
    });
  }

  // ── Rule 7: sicca screen — dry mouth (+ dry eyes) in autoimmune thyroid ──
  //
  // Reads BOTH the intake chips AND the free-text condition list, because the
  // two disagree in practice. cl-022 ticked eye_signs "No concerns" at intake
  // and had "Dry eyes" added to active_conditions months later when it was
  // confirmed — a rule reading only the chips would miss exactly the client it
  // exists for.
  //
  // Never suggests a food or plan change. The output is a note plus, where
  // warranted, a no-cost measurement the coach can take in-session.
  {
    const conditionText = [
      ...(client.active_conditions ?? []),
      ...(client.medical_history ?? []),
    ]
      .join(" | ")
      .toLowerCase();
    const oralText = (client.oral_signs ?? []).join(" | ").toLowerCase();
    const eyeText = (client.eye_signs ?? []).join(" | ").toLowerCase();
    const medsText = [...(client.current_medications ?? []), ...(client.medications ?? [])]
      .join(" | ")
      .toLowerCase();

    const autoimmuneThyroid = tokenMatches(conditionText, AUTOIMMUNE_THYROID_TOKENS);
    const dryMouth = [
      ...tokenMatches(oralText, DRY_MOUTH_TOKENS),
      ...tokenMatches(conditionText, DRY_MOUTH_TOKENS),
    ];
    const dryEyes = [
      ...tokenMatches(eyeText, DRY_EYE_TOKENS),
      ...tokenMatches(conditionText, DRY_EYE_TOKENS),
    ];

    if (autoimmuneThyroid.length > 0 && dryMouth.length > 0) {
      const bothSicca = dryEyes.length > 0;
      const dryingDrugs = tokenMatches(medsText, DRYING_DRUG_TOKENS);
      const healthAnxious = tokenMatches(conditionText, HEALTH_ANXIETY_TOKENS).length > 0;

      // Both symptoms = the pairing the prevalence data is about. Dry mouth
      // alone is worth a measurement but not an antibody panel yet. A
      // health-anxious client is held at `info` whatever the pattern, because
      // the harm of naming it outweighs the delay.
      const severity: ConflictSeverity = healthAnxious ? "info" : bothSicca ? "warning" : "info";

      const competing = dryingDrugs.length > 0 ? ` Note ${dryingDrugs.join(", ")} on the medication list — drug-induced dry mouth is the commonest cause and is cheaper to address first.` : "";

      out.push({
        id: `sicca-screen-${slug(bothSicca ? "mouth-and-eyes" : "mouth-only")}`,
        severity,
        kind: "sicca_screen",
        summary: healthAnxious
          ? `Dry mouth${bothSicca ? " and dry eyes" : ""} recorded alongside autoimmune thyroid disease — handle gently (health anxiety on file)`
          : bothSicca
            ? `Dry mouth AND dry eyes recorded alongside autoimmune thyroid disease`
            : `Dry mouth recorded alongside autoimmune thyroid disease`,
        details: healthAnxious
          ? `This client has both the symptom pattern and health anxiety on file. ` +
            `The pattern is worth tracking, but naming a possible autoimmune ` +
            `diagnosis unprompted risks doing more harm than the delay. Protect ` +
            `the teeth (dry mouth drives decay), drop any alcohol-based ` +
            `mouthwash, and only discuss investigation if she raises it.${competing}`
          : bothSicca
            ? `Sjogren's syndrome occurs in about 17% of Hashimoto's patients, ` +
              `37% of autoimmune-thyroid patients meet criteria for dry mouth and ` +
              `23% for dry eyes, and the two conditions share an overlapping ` +
              `thyroglobulin epitope — so this pairing is an association, not a ` +
              `coincidence. Next step is the no-cost one: measure unstimulated ` +
              `whole salivary flow rate in a session (see the lab_tests entry for ` +
              `the method). 0.1 mL/min or less is a formal criterion; 0.1-0.2 is ` +
              `borderline. If low, the ENA/anti-SSA panel is directly orderable in ` +
              `India without a prescription, so the client can attend a doctor ` +
              `holding a result rather than asking for a test. A NEGATIVE panel ` +
              `does not exclude Sjogren's — seronegative disease is real.${competing}`
            : `Dry mouth in autoimmune thyroid disease is worth objectifying — 37% ` +
              `of these clients meet xerostomia criteria. Ask directly about dry, ` +
              `gritty or burning eyes, which is the other half of the pattern and ` +
              `is often not volunteered. Measuring unstimulated whole salivary ` +
              `flow rate costs nothing and turns a reported symptom into a number.` +
              `${competing} Meanwhile protect the teeth — reduced saliva drives ` +
              `caries hard, so keep fluoride and drop alcohol-based mouthwash.`,
        suggested_fix: {
          label: "✓ Note the sicca screen",
          rationale:
            `Records the pattern and the next step on the client's notes so it is ` +
            `visible next session. Changes nothing about the plan, the protocol or ` +
            `the menu — this is a screening prompt, not a treatment decision.`,
          action: {
            type: "append_client_note",
            text:
              `[sicca screen] Dry mouth${bothSicca ? " + dry eyes" : ""} recorded with ` +
              `autoimmune thyroid disease (matched: ${autoimmuneThyroid.join(", ")}). ` +
              `Next step — measure unstimulated whole salivary flow rate in session ` +
              `(<=0.1 mL/min is a formal criterion, 0.1-0.2 borderline). If low, ENA/` +
              `anti-SSA panel is direct-order in India; a negative panel does not ` +
              `exclude Sjogren's.` +
              (dryingDrugs.length > 0
                ? ` Competing cause on the med list: ${dryingDrugs.join(", ")}.`
                : "") +
              (healthAnxious
                ? ` HEALTH ANXIETY ON FILE — do not raise the diagnosis unprompted.`
                : ""),
          },
        },
      });
    }
  }

  return out;
}
