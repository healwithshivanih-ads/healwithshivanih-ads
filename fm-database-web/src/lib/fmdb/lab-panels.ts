/**
 * Shared FM lab panel catalog.
 *
 * Reorganised around the NAMED BUNDLES Indian labs actually quote and run
 * (KFT, LFT, Lipid Profile, CBC, Thyroid Profile, HbA1c …) — because labs
 * order by bundle, not by individual marker. The standard bundles live in
 * `lab-bundles.json` (a single source of truth shared with the Python
 * requisition renderer `scripts/render-lab-requisition.py`, which expands a
 * selected bundle into its component tests on the slip). The remaining FM
 * functional groups below are à-la-carte ADD-ONS — anything already covered
 * by a bundle (individual lipids, CBC, base TSH/T3/T4, urea, creatinine,
 * GGT, uric acid, ferritin, iron, vit D/B12 …) has been removed from them so
 * nothing is duplicated.
 *
 * Costs are bucketed ₹ (~₹500), ₹₹ (~₹1500), ₹₹₹ (~₹3000+) — actual lab
 * prices vary; this is for UX prioritisation only.
 */

import LAB_BUNDLES_JSON from "./lab-bundles.json";

export type LabCost = "₹" | "₹₹" | "₹₹₹";
export type LabSex = "M" | "F";

export interface Lab {
  name: string;
  cost: LabCost;
  /** Specialty labs need a third-party functional medicine provider. */
  specialty?: boolean;
  /** Sex-specific labs hidden when client's sex doesn't match. */
  sex?: LabSex;
  /** When present, this item is a NAMED BUNDLE (KFT, LFT …) and `components`
   *  are the individual tests it contains. The bundle's `name` is what the
   *  lab recognises + what's stored in the session's requested_labs; the
   *  requisition renderer expands it to the components. */
  components?: string[];
  /** Pre-ticked on a fresh discovery (per-item default, used for bundles). */
  default?: boolean;
  /** Lab-Vault system label (e.g. "Kidney") for classifying result markers —
   *  see lab-vault.ts. Falls back to the group name when absent. */
  system?: string;
  /** Per-item icon (bundles carry their own). */
  icon?: string;
  /** Short lab-slip name (e.g. "KFT"). */
  short?: string;
}

export interface LabPanel {
  group: string;
  icon: string;
  /** Panel-level sex filter (e.g. "Sex Hormones — Female"). */
  sex?: LabSex;
  labs: Lab[];
}

interface LabBundleDef {
  name: string;
  short: string;
  system: string;
  icon: string;
  sample: string;
  cost: string;
  default: boolean;
  components: string[];
}

const LAB_BUNDLES = LAB_BUNDLES_JSON as LabBundleDef[];

/** Section 1 — the named profiles labs run as a unit. Built from the shared
 *  bundle definitions so the form, the Lab Vault, and the Python requisition
 *  renderer all agree on contents. */
const STANDARD_PANELS_GROUP: LabPanel = {
  group: "Standard Lab Panels",
  icon: "🧫",
  labs: LAB_BUNDLES.map((b) => ({
    name: b.name,
    cost: b.cost as LabCost,
    components: b.components,
    default: b.default,
    system: b.system,
    icon: b.icon,
    short: b.short,
  })),
};

export const LAB_PANELS: LabPanel[] = [
  // ── Section 1: standard named bundles (what the lab quotes & runs) ──────
  STANDARD_PANELS_GROUP,

  // ── Section 2+: FM-specific add-on markers (à la carte) ─────────────────
  // Base TSH/T3/T4 live in the Thyroid Profile bundle; these are the deeper
  // thyroid markers.
  {
    group: "Thyroid Function",
    icon: "🦋",
    labs: [
      { name: "Free T3", cost: "₹" },
      { name: "Free T4", cost: "₹" },
      { name: "Reverse T3", cost: "₹₹", specialty: true },
      { name: "TPO Antibodies", cost: "₹₹" },
      { name: "Thyroglobulin Antibodies", cost: "₹₹" },
      { name: "TSI (Thyroid Stimulating Immunoglobulin)", cost: "₹₹₹", specialty: true },
    ],
  },
  // Fasting glucose + HbA1c live in the bundles; these are the insulin /
  // insulin-resistance markers.
  {
    group: "Blood Sugar & Insulin",
    icon: "🍬",
    labs: [
      { name: "Fasting Insulin", cost: "₹₹" },
      { name: "C-Peptide", cost: "₹₹" },
      { name: "Post-prandial Glucose + Insulin (2-hr)", cost: "₹₹" },
      { name: "Glucose Tolerance Test with Insulin Response (GTT-IR)", cost: "₹₹₹", specialty: true },
      { name: "HOMA-IR (Insulin Resistance Index)", cost: "₹" },
      { name: "QUICKI (Quantitative Insulin Sensitivity Check Index)", cost: "₹" },
      { name: "Adiponectin", cost: "₹₹₹", specialty: true },
    ],
  },
  // GGT is in the LFT bundle, Uric Acid in the KFT bundle.
  {
    group: "Inflammation",
    icon: "🔥",
    labs: [
      { name: "hsCRP (high-sensitivity CRP)", cost: "₹" },
      { name: "Homocysteine", cost: "₹₹" },
      { name: "ESR", cost: "₹" },
      { name: "Fibrinogen", cost: "₹₹" },
      { name: "Mycotoxin Panel", cost: "₹₹₹", specialty: true },
    ],
  },
  // Base lipids live in the Lipid Profile bundle; these are advanced
  // particle / risk markers.
  {
    group: "Cardiovascular Risk",
    icon: "❤️",
    labs: [
      { name: "ApoB", cost: "₹₹" },
      { name: "ApoA1", cost: "₹₹" },
      { name: "Lp(a) — Lipoprotein(a)", cost: "₹₹" },
      { name: "NMR LipoProfile", cost: "₹₹₹", specialty: true },
    ],
  },
  // Urea / creatinine / electrolytes / eGFR live in the KFT bundle; these are
  // the FM-deeper kidney markers.
  {
    group: "Advanced Kidney & Metabolic",
    icon: "🫘",
    labs: [
      { name: "Cystatin C", cost: "₹₹" },
      { name: "Urinary Albumin / Creatinine Ratio (UACR)", cost: "₹" },
    ],
  },
  // Vit D / B12 / iron / ferritin live in bundles; these are the deeper
  // micronutrient markers.
  {
    group: "Nutrients",
    icon: "🌱",
    labs: [
      { name: "MMA (Methylmalonic Acid)", cost: "₹₹₹", specialty: true },
      { name: "Active B12 (Holotranscobalamin)", cost: "₹₹₹", specialty: true },
      { name: "RBC Folate", cost: "₹₹" },
      { name: "RBC Magnesium", cost: "₹₹", specialty: true },
      { name: "Zinc (Plasma)", cost: "₹₹" },
      { name: "Copper / Cu:Zn Ratio", cost: "₹₹", specialty: true },
      { name: "Selenium", cost: "₹₹", specialty: true },
      { name: "Iodine (Urinary)", cost: "₹₹", specialty: true },
      { name: "Omega-3 Index", cost: "₹₹₹", specialty: true },
      { name: "Heavy Metals Panel", cost: "₹₹₹", specialty: true },
    ],
  },
  {
    group: "Sex Hormones — Female",
    icon: "🌸",
    sex: "F",
    labs: [
      { name: "Estradiol (E2)", cost: "₹₹" },
      { name: "Progesterone", cost: "₹₹" },
      { name: "FSH", cost: "₹₹" },
      { name: "LH", cost: "₹₹" },
      { name: "AMH (Anti-Müllerian Hormone)", cost: "₹₹" },
      { name: "17-OH Progesterone", cost: "₹₹" },
    ],
  },
  {
    group: "Sex Hormones — Common",
    icon: "⚥",
    labs: [
      { name: "Total Testosterone", cost: "₹₹" },
      { name: "Free Testosterone", cost: "₹₹" },
      { name: "SHBG", cost: "₹₹" },
      { name: "DHEA-S", cost: "₹₹" },
      { name: "Prolactin", cost: "₹₹" },
      { name: "Estradiol (E2) — for men", cost: "₹₹", sex: "M" },
    ],
  },
  {
    group: "Adrenal & Stress",
    icon: "⚡",
    labs: [
      { name: "Morning Cortisol (8am, fasting)", cost: "₹" },
      { name: "PM Cortisol (4–6pm)", cost: "₹" },
      { name: "DUTCH Test (Dried Urine)", cost: "₹₹₹", specialty: true },
      { name: "Salivary Cortisol 4-point", cost: "₹₹₹", specialty: true },
      { name: "Aldosterone + Renin", cost: "₹₹₹", specialty: true },
      { name: "Pregnenolone", cost: "₹₹₹", specialty: true },
    ],
  },
  {
    group: "Methylation & Genetics",
    icon: "🧬",
    labs: [
      { name: "MTHFR Gene Variants", cost: "₹₹₹", specialty: true },
      { name: "COMT Gene Variants", cost: "₹₹₹", specialty: true },
      { name: "MTR / MTRR Gene Variants", cost: "₹₹₹", specialty: true },
      { name: "Organic Acid Test (OAT)", cost: "₹₹₹", specialty: true },
    ],
  },
  {
    group: "Autoimmune Screening",
    icon: "🛡️",
    labs: [
      { name: "ANA (Anti-Nuclear Antibodies)", cost: "₹₹" },
      { name: "ENA Panel", cost: "₹₹" },
      { name: "Anti-CCP", cost: "₹₹" },
      { name: "tTG-IgA (Tissue Transglutaminase)", cost: "₹₹" },
      { name: "Total IgA", cost: "₹" },
      { name: "Anti-Gliadin Antibodies", cost: "₹₹" },
    ],
  },
  {
    group: "Cancer Screening",
    icon: "🎗️",
    labs: [
      { name: "CEA", cost: "₹₹" },
      { name: "AFP", cost: "₹₹" },
      { name: "CA 19-9", cost: "₹₹" },
      { name: "LDH", cost: "₹" },
      { name: "β2-Microglobulin", cost: "₹₹" },
      { name: "CA-125", cost: "₹₹", sex: "F" },
      { name: "CA 15-3", cost: "₹₹", sex: "F" },
      { name: "HE4", cost: "₹₹₹", specialty: true, sex: "F" },
      { name: "PSA — Total", cost: "₹₹", sex: "M" },
      { name: "PSA — Free", cost: "₹₹", sex: "M" },
      { name: "β-hCG", cost: "₹₹", sex: "M" },
    ],
  },
  {
    group: "Gut Health",
    icon: "🦠",
    labs: [
      { name: "H. pylori (Stool Antigen)", cost: "₹₹" },
      { name: "H. pylori Urea Breath Test (UBT)", cost: "₹₹" },
      { name: "H. pylori IgG Antibodies", cost: "₹₹" },
      { name: "Calprotectin (Stool)", cost: "₹₹" },
      { name: "Zonulin", cost: "₹₹₹", specialty: true },
      { name: "Pancreatic Elastase", cost: "₹₹₹", specialty: true },
      { name: "Secretory IgA (sIgA)", cost: "₹₹₹", specialty: true },
      { name: "SIBO Breath Test", cost: "₹₹₹", specialty: true },
      { name: "GI-MAP / GI-Effects", cost: "₹₹₹", specialty: true },
      { name: "Food Sensitivity IgG Panel", cost: "₹₹₹", specialty: true },
    ],
  },
];

/** FM functional groups whose non-specialty markers are also pre-ticked on a
 *  fresh Discovery (on top of the bundle-level `default: true` flags). Gives
 *  the FM core — insulin/HOMA-IR + hsCRP/homocysteine — alongside the standard
 *  bundles. Coach can untick on the form. */
export const DEFAULT_DISCOVERY_PANELS = new Set<string>([
  "Blood Sugar & Insulin",
  "Inflammation",
]);
