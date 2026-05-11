/** Centralized user-friendly labels for catalogue entity kinds.
 *  Slugs in YAML/Pydantic stay as-is — these are PRESENTATION ONLY.
 *  Edit here once; UI updates everywhere. */

export type CatalogueKind =
  | "topics"
  | "mechanisms"
  | "symptoms"
  | "supplements"
  | "protocols"
  | "titration_protocols"
  | "lab_panels"
  | "lab_tests"
  | "claims"
  | "sources"
  | "cooking_adjustments"
  | "home_remedies"
  | "mindmaps"
  | "drug_depletions";

interface KindLabel {
  /** Plural label shown on tabs / headings (e.g. "Conditions"). */
  plural: string;
  /** Singular label for breadcrumbs / detail pages (e.g. "Condition"). */
  singular: string;
  /** One-line description shown under the heading. */
  description: string;
  /** Emoji icon. */
  emoji: string;
}

export const KIND_LABELS: Record<CatalogueKind, KindLabel> = {
  topics: {
    plural: "Conditions",
    singular: "Condition",
    description: "Hashimoto's, PCOS, perimenopause — clinical conditions you work with",
    emoji: "🩺",
  },
  mechanisms: {
    plural: "Root causes",
    singular: "Root cause",
    description: "HPA axis dysregulation, leaky gut, insulin resistance — the why behind symptoms",
    emoji: "🧬",
  },
  symptoms: {
    plural: "Symptoms",
    singular: "Symptom",
    description: "Bloating, brain fog, fatigue — what clients report",
    emoji: "🤒",
  },
  supplements: {
    plural: "Supplements",
    singular: "Supplement",
    description: "Magnesium, vitamin D, ashwagandha — with forms, doses, interactions",
    emoji: "💊",
  },
  protocols: {
    plural: "Healing programs",
    singular: "Healing program",
    description: "5R gut, AIP, Whole30, low-FODMAP — structured 4–12 week paths",
    emoji: "🏥",
  },
  titration_protocols: {
    plural: "Dose schedules",
    singular: "Dose schedule",
    description: "Slow ramp-up plans for ashwagandha, berberine, magnesium, NAC, vitamin D",
    emoji: "📈",
  },
  lab_panels: {
    plural: "Lab panels",
    singular: "Lab panel",
    description: "DUTCH, GI-MAP, FM general baseline — bundles of markers",
    emoji: "🧪",
  },
  lab_tests: {
    plural: "Lab markers",
    singular: "Lab marker",
    description: "TSH, free T3, ferritin, hsCRP — with FM and conventional ranges",
    emoji: "🔬",
  },
  claims: {
    plural: "Evidence notes",
    singular: "Evidence note",
    description: "Research-backed statements citing a source, tagged by evidence tier",
    emoji: "📚",
  },
  sources: {
    plural: "References",
    singular: "Reference",
    description: "Books, papers, courses, internal skills — where the evidence comes from",
    emoji: "📖",
  },
  cooking_adjustments: {
    plural: "Kitchen swaps",
    singular: "Kitchen swap",
    description: "Cookware / oil / water / food-prep swaps clients can make today",
    emoji: "🍳",
  },
  home_remedies: {
    plural: "Home remedies",
    singular: "Home remedy",
    description: "Ayurvedic churans, infused waters, kashayams, kitchen remedies",
    emoji: "🌿",
  },
  mindmaps: {
    plural: "Mind maps",
    singular: "Mind map",
    description: "Hand-curated clinical mind maps spanning conditions, drivers and interventions",
    emoji: "🧭",
  },
  drug_depletions: {
    plural: "Drug-nutrient depletions",
    singular: "Drug-nutrient depletion",
    description: "Medications and the nutrients they deplete (PPIs, statins, OCPs, metformin…)",
    emoji: "⚠️",
  },
};

export function kindLabel(kind: string, form: "plural" | "singular" = "plural"): string {
  const meta = KIND_LABELS[kind as CatalogueKind];
  if (!meta) return kind;
  return form === "singular" ? meta.singular : meta.plural;
}

export function kindEmoji(kind: string): string {
  return KIND_LABELS[kind as CatalogueKind]?.emoji ?? "•";
}
