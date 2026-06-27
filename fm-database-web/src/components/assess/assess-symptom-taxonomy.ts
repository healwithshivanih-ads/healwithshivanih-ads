/**
 * Symptom-picker taxonomy for the assess flow (Codex audit #6 — file split).
 *
 * Pure data + classification extracted verbatim from assess-client.tsx: the
 * category labels/order, the slug→gendered-category overrides, the gender
 * gate, and the concept clusters that collapse near-duplicate symptom slugs
 * under one picker label. No React, no app types.
 */

export const CATEGORY_LABELS: Record<string, string> = {
  gi: "GI / Digestive",
  musculoskeletal: "Musculoskeletal",
  neurological: "Neurological",
  mood: "Mood & Mental",
  sleep: "Sleep",
  skin: "Skin",
  hormonal: "Hormonal (shared)",
  womens_health: "Women's Health",
  mens_health: "Men's Health",
  metabolic: "Metabolic",
  constitutional: "Constitutional",
  cardiovascular: "Cardiovascular",
  urinary: "Urinary",
  other: "Other",
};

export const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS);

// Re-route specific symptom slugs into gendered categories without editing the
// catalog YAMLs. Anything in this map overrides the symptom's stored category
// when grouping the picker. Keeps the catalogue stable while letting the UI
// reorganise around the IFM coaching workflow.
export const SLUG_CATEGORY_OVERRIDES: Record<string, "womens_health" | "mens_health"> = {
  // Female-specific (move out of "hormonal" / "skin")
  "irregular-periods": "womens_health",
  "irregular-menstrual-cycles": "womens_health",
  "menstrual-irregularities": "womens_health",
  "heavy-periods": "womens_health",
  "painful-periods": "womens_health",
  "pms": "womens_health",
  "pms-symptoms": "womens_health",
  "premenstrual-tension": "womens_health",
  "pms-irregular-cycles-low-libido": "womens_health",
  "hot-flashes": "womens_health",
  "night-sweats": "womens_health",
  "vaginal-dryness": "womens_health",
  "vaginal-discharge": "womens_health",
  "vaginal-itching": "womens_health",
  "fibrocystic-breasts": "womens_health",
  "breast-tenderness": "womens_health",
  "facial-hair": "womens_health",
  "acne-hormonal": "womens_health",
  "infertility-female": "womens_health",
  "primary-infertility": "womens_health",
  "recurrent-miscarriage": "womens_health",
  "estrogen-dominance-symptoms": "womens_health",
  "perimenopause-symptoms": "womens_health",
  "menopause-symptoms": "womens_health",

  // Male-specific
  "erectile-dysfunction": "mens_health",
  "premature-ejaculation": "mens_health",
  "morning-erection-loss": "mens_health",
  "prostate-symptoms": "mens_health",
  "low-testosterone-symptoms": "mens_health",
};

// Map a normalised client.sex value to which gender-specific category to show.
// Any other value (or unknown) shows BOTH so the coach can still capture the
// symptom — e.g. when sex isn't recorded yet.
export function gendersToShow(sex: string | null | undefined): { showWomens: boolean; showMens: boolean } {
  const s = (sex ?? "").trim().toUpperCase();
  if (s === "F" || s === "FEMALE" || s === "WOMAN") return { showWomens: true, showMens: false };
  if (s === "M" || s === "MALE" || s === "MAN")     return { showWomens: false, showMens: true };
  return { showWomens: true, showMens: true };
}

// Concept clusters: top-level concept name → canonical slug(s) that belong to it.
// Slugs listed first within a cluster appear first in the sub-list.
// Any symptom slug NOT listed here is shown individually under its category.
// Concept clusters group near-duplicate slugs under a single label. Aim:
// every visually-distinct concept appears exactly once. Coach picks the
// concept; the picker stores all variant slugs internally so AI matching
// against either the freeform or alias version still resolves.
export const CONCEPT_CLUSTERS: Record<string, { label: string; slugs: string[] }[]> = {
  gi: [
    { label: "Bloating", slugs: ["bloating", "abdominal-bloating", "constant-bloating", "gas-and-bloating"] },
    { label: "Gas / Flatulence", slugs: ["gas", "abdominal-gas", "flatulence", "foul-smelling-gas", "upper-digestive-tract-gassiness"] },
    { label: "Acid Reflux / Heartburn", slugs: ["acid-reflux", "heartburn", "indigestion"] },
    { label: "Constipation", slugs: ["constipation", "chronic-constipation", "infrequent-stools", "constipation-thyroid"] },
    { label: "Diarrhea / Loose Stools", slugs: ["diarrhea", "loose-stools", "osmotic-diarrhea"] },
    { label: "Abdominal Pain / Cramping", slugs: ["abdominal-pain", "abdominal-cramping", "digestive-pain"] },
    { label: "Food Sensitivities", slugs: ["food-sensitivities", "food-reactivity", "new-food-sensitivities", "multiple-food-allergies", "histamine-intolerance"] },
    { label: "Nausea", slugs: ["nausea", "nausea-after-supplements"] },
    { label: "Stool abnormalities", slugs: ["undigested-food-in-stool", "steatorrhea"] },
  ],
  mood: [
    { label: "Depression / Low Mood", slugs: ["depression", "depression-symptoms", "low-mood", "lethargic-depression", "emotional-numbness"] },
    { label: "Anxiety", slugs: ["anxiety", "anxiety-with-gut-issues", "agitated-depression"] },
    { label: "Mood Swings / Irritability", slugs: ["mood-swings", "mood-changes", "irritability"] },
  ],
  skin: [
    { label: "Hair Loss / Thinning", slugs: ["hair-loss", "hair-thinning", "brittle-hair", "unexplained-hair-loss", "dry-skin-brittle-hair"] },
    { label: "Brittle / Weak Nails", slugs: ["brittle-nails", "weak-peeling-nails", "weak-peeling-cracked-fingernails"] },
    { label: "Acne / Breakouts", slugs: ["acne", "skin-breakouts"] }, // acne-hormonal moved to womens_health
    { label: "Rashes / Hives", slugs: ["skin-rash", "skin-rash-hives", "skin-rashes", "skin-flares"] },
    { label: "Dry skin", slugs: ["dry-skin"] },
  ],
  neurological: [
    { label: "Brain Fog / Cognition", slugs: ["brain-fog", "cognitive-decline", "poor-concentration"] },
    { label: "Headaches / Migraines", slugs: ["headache", "headaches"] },
    { label: "Neuropathy / Tingling", slugs: ["neuropathy", "peripheral-neuropathy", "numbness-tingling", "diabetic-nerve-pain"] },
  ],
  metabolic: [
    { label: "Weight Gain", slugs: [
      "weight-gain",
      "weight-gain-abdomen",
      "abdominal-weight-gain",
      "belly-fat",
      "central-weight-gain",
      "resistant-weight-gain",
      "unexplained-weight-gain",
      "excess-weight",
      "excess-body-weight",
      "cold-intolerance-and-weight-gain",
    ] },
    { label: "Blood Sugar / Insulin issues", slugs: ["blood-sugar-spikes", "elevated-blood-sugar", "elevated-fasting-insulin", "hypoglycemia-symptoms", "insulin-resistance-symptom"] },
    { label: "Post-meal Fatigue / Crashes", slugs: ["fatigue-after-meals", "post-meal-fatigue", "energy-crashes"] },
    { label: "Sugar / Salt Cravings", slugs: ["sugar-cravings", "craving-sweets", "craving-salt", "salt-craving"] },
  ],
  // Hormonal symptoms that apply to either sex (thyroid, adrenal, generic libido)
  hormonal: [
    { label: "Libido (general / non-specific)", slugs: ["decreased-libido", "low-libido"] },
    { label: "Cold intolerance / temperature regulation", slugs: ["cold-intolerance", "cold-intolerance-and-weight-gain"] },
    { label: "Heat intolerance", slugs: ["heat-intolerance"] },
  ],
  womens_health: [
    { label: "Perimenopause symptoms", slugs: ["perimenopause-symptoms"] },
    { label: "Menopause symptoms", slugs: ["menopause-symptoms"] },
    { label: "Hot flashes / Night sweats", slugs: ["hot-flashes", "night-sweats"] },
    { label: "Vaginal symptoms", slugs: ["vaginal-itching", "vaginal-dryness", "vaginal-discharge"] },
    { label: "Menstrual irregularities", slugs: ["irregular-periods", "irregular-menstrual-cycles", "menstrual-irregularities", "heavy-periods", "painful-periods"] },
    { label: "PMS / PMDD", slugs: ["pms", "pms-symptoms", "premenstrual-tension", "pms-irregular-cycles-low-libido"] },
    { label: "Hormonal acne", slugs: ["acne-hormonal"] },
    { label: "Excess facial / body hair (PCOS marker)", slugs: ["facial-hair"] },
    { label: "Breast: tenderness / fibrocystic", slugs: ["breast-tenderness", "fibrocystic-breasts"] },
    { label: "Estrogen dominance signs", slugs: ["estrogen-dominance-symptoms"] },
    { label: "Fertility / Miscarriage", slugs: ["infertility-female", "primary-infertility", "recurrent-miscarriage"] },
  ],
  mens_health: [
    { label: "Erectile dysfunction", slugs: ["erectile-dysfunction"] },
    { label: "Loss of morning erections", slugs: ["morning-erection-loss"] },
    { label: "Premature ejaculation", slugs: ["premature-ejaculation"] },
    { label: "Low testosterone / andropause", slugs: ["low-testosterone-symptoms"] },
    { label: "Prostate / urinary changes", slugs: ["prostate-symptoms"] },
  ],
  sleep: [
    { label: "Insomnia / Poor Sleep", slugs: ["insomnia", "poor-sleep", "sleep-disruption", "sleep-disturbance"] },
  ],
  musculoskeletal: [
    { label: "Joint / Muscle Pain", slugs: ["joint-pain", "joint-muscle-pain", "chronic-pain"] },
    { label: "Cramps / Tension", slugs: ["muscle-cramps", "muscle-tension", "tension"] },
  ],
  constitutional: [
    { label: "Fatigue", slugs: ["fatigue", "chronic-fatigue", "low-energy"] },
  ],
};
