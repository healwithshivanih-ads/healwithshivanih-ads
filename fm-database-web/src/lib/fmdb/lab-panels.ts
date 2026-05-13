/**
 * Shared FM lab panel catalog.
 *
 * Sourced from the legacy clients/[id]/discovery-form.tsx — extracted
 * here so both the legacy form and the new v2 forms can import the
 * same list. Don't duplicate.
 *
 * Costs are bucketed ₹ (~₹500), ₹₹ (~₹1500), ₹₹₹ (~₹3000+) — actual
 * Thyrocare/lab prices vary; this is for UX prioritisation.
 */

export type LabCost = "₹" | "₹₹" | "₹₹₹";
export type LabSex = "M" | "F";

export interface Lab {
  name: string;
  cost: LabCost;
  /** Specialty labs need a third-party functional medicine provider. */
  specialty?: boolean;
  /** Sex-specific labs hidden when client's sex doesn't match. */
  sex?: LabSex;
}

export interface LabPanel {
  group: string;
  icon: string;
  /** Panel-level sex filter (e.g. "Sex Hormones — Female"). */
  sex?: LabSex;
  labs: Lab[];
}

export const LAB_PANELS: LabPanel[] = [
  {
    group: "Thyroid Function",
    icon: "🦋",
    labs: [
      { name: "TSH", cost: "₹" },
      { name: "Free T3", cost: "₹" },
      { name: "Free T4", cost: "₹" },
      { name: "Reverse T3", cost: "₹₹", specialty: true },
      { name: "TPO Antibodies", cost: "₹₹" },
      { name: "Thyroglobulin Antibodies", cost: "₹₹" },
      { name: "TSI (Thyroid Stimulating Immunoglobulin)", cost: "₹₹₹", specialty: true },
    ],
  },
  {
    group: "Blood Sugar & Insulin",
    icon: "🍬",
    labs: [
      { name: "Fasting Glucose", cost: "₹" },
      { name: "Fasting Insulin", cost: "₹₹" },
      { name: "HbA1c", cost: "₹" },
      { name: "C-Peptide", cost: "₹₹" },
      { name: "Post-prandial Glucose + Insulin (2-hr)", cost: "₹₹" },
      { name: "Glucose Tolerance Test with Insulin Response (GTT-IR)", cost: "₹₹₹", specialty: true },
      // Computed insulin-resistance markers — lab can derive these or
      // coach can compute from fasting glucose + insulin. Listed
      // separately because they show up named on many panels.
      { name: "HOMA-IR (Insulin Resistance Index)", cost: "₹" },
      { name: "QUICKI (Quantitative Insulin Sensitivity Check Index)", cost: "₹" },
      { name: "Adiponectin", cost: "₹₹₹", specialty: true },
    ],
  },
  {
    group: "Inflammation",
    icon: "🔥",
    labs: [
      { name: "hsCRP (high-sensitivity CRP)", cost: "₹" },
      { name: "Homocysteine", cost: "₹₹" },
      { name: "ESR", cost: "₹" },
      { name: "Fibrinogen", cost: "₹₹" },
      { name: "GGT", cost: "₹" },
      { name: "Uric Acid", cost: "₹" },
      { name: "Mycotoxin Panel", cost: "₹₹₹", specialty: true },
    ],
  },
  {
    group: "Lipid Panel",
    icon: "💧",
    labs: [
      { name: "Total Cholesterol", cost: "₹" },
      { name: "LDL Cholesterol", cost: "₹" },
      { name: "HDL Cholesterol", cost: "₹" },
      { name: "Triglycerides", cost: "₹" },
      { name: "VLDL", cost: "₹" },
    ],
  },
  {
    group: "Complete Blood Count",
    icon: "🩸",
    labs: [
      { name: "CBC with Differential", cost: "₹" },
      { name: "Reticulocyte Count", cost: "₹" },
    ],
  },
  {
    group: "Metabolic Panel",
    icon: "⚗️",
    labs: [
      { name: "Comprehensive Metabolic Panel (CMP)", cost: "₹" },
      { name: "Liver Function Tests (LFT)", cost: "₹" },
      { name: "Cystatin C", cost: "₹₹" },
      // Kidney clearance ratios — useful for early kidney function
      // assessment. UCAR = Urea-to-Creatinine Ratio.
      { name: "BUN / Creatinine Ratio (UCAR)", cost: "₹" },
      { name: "Urinary Albumin / Creatinine Ratio (UACR)", cost: "₹" },
      { name: "eGFR (CKD-EPI)", cost: "₹" },
    ],
  },
  {
    group: "Nutrients",
    icon: "🌱",
    labs: [
      { name: "Vitamin D (25-OH)", cost: "₹₹" },
      { name: "Vitamin B12", cost: "₹" },
      { name: "MMA (Methylmalonic Acid)", cost: "₹₹₹", specialty: true },
      { name: "Active B12 (Holotranscobalamin)", cost: "₹₹₹", specialty: true },
      { name: "RBC Folate", cost: "₹₹" },
      { name: "Ferritin", cost: "₹" },
      { name: "Serum Iron", cost: "₹" },
      { name: "TIBC / Transferrin Saturation", cost: "₹" },
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
    group: "Cardiovascular Risk",
    icon: "❤️",
    labs: [
      { name: "ApoB", cost: "₹₹" },
      { name: "ApoA1", cost: "₹₹" },
      { name: "Lp(a) — Lipoprotein(a)", cost: "₹₹" },
      { name: "NMR LipoProfile", cost: "₹₹₹", specialty: true },
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
  {
    group: "Routine",
    icon: "🧪",
    labs: [
      { name: "Stool Routine & Culture", cost: "₹" },
      { name: "Urine Routine", cost: "₹" },
    ],
  },
];

/** Suggested defaults for a first-touch Discovery — covers the 80% case
 *  for adult female clients presenting with fatigue/weight/hormonal issues.
 *  Coach can override on the form. */
export const DEFAULT_DISCOVERY_PANELS = new Set<string>([
  "Thyroid Function",
  "Blood Sugar & Insulin",
  "Inflammation",
  "Nutrients",
  "Lipid Panel",
  "Complete Blood Count",
]);
