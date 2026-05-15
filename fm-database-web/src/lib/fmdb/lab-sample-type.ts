/**
 * Infer the specimen / sample type from a lab test label.
 *
 * Used to group labs by what the client has to actually do at the lab
 * (one blood draw vs collect-at-home stool kit vs urine vs breath test
 * vs saliva, etc.) — the cadence grouping (new / re-test) tells the
 * coach when to order; this tells the client which sample they're
 * giving on the day.
 *
 * Heuristic only — keyword-match on the label. Anything unclassified
 * falls back to "Blood" (the dominant category for serum/plasma tests).
 */

export type SampleType =
  | "Blood"
  | "Stool"
  | "Urine"
  | "Saliva"
  | "Breath"
  | "Hair / nail"
  | "Swab"
  | "Imaging"
  | "Other";

const RULES: { kind: SampleType; needles: string[] }[] = [
  { kind: "Stool",       needles: ["stool", "fecal", "faecal", "occult blood (fobt)"] },
  { kind: "Urine",       needles: ["urine", "dutch", "spot urine", "24hr", "24-hr", "mycotoxin"] },
  { kind: "Saliva",      needles: ["saliva", "salivary"] },
  { kind: "Breath",      needles: ["breath test", "ubt", "sibo breath"] },
  { kind: "Hair / nail", needles: ["hair", "nail mineral", "hair tissue"] },
  { kind: "Swab",        needles: ["swab", "buccal", "cheek"] },
  { kind: "Imaging",     needles: ["ultrasound", "mri", "ct scan", "dexa", "x-ray", "xray", "scan ", "fibroscan"] },
];

export function inferLabSampleType(label: string): SampleType {
  const lc = label.toLowerCase();
  for (const r of RULES) {
    if (r.needles.some((n) => lc.includes(n))) return r.kind;
  }
  // MTHFR / genetic genotyping is usually a cheek swab in India, but the
  // requisition form often lists "blood" — treat as Blood unless explicit.
  return "Blood";
}

/**
 * Stable display order — Blood first because it's the bulk of any panel
 * and the most common single visit, then specimens the client collects
 * themselves, then everything else.
 */
export const SAMPLE_TYPE_ORDER: SampleType[] = [
  "Blood",
  "Stool",
  "Urine",
  "Saliva",
  "Breath",
  "Hair / nail",
  "Swab",
  "Imaging",
  "Other",
];

export const SAMPLE_TYPE_ICON: Record<SampleType, string> = {
  Blood: "🩸",
  Stool: "💩",
  Urine: "💧",
  Saliva: "🧪",
  Breath: "🌬️",
  "Hair / nail": "💇",
  Swab: "👅",
  Imaging: "🩻",
  Other: "📋",
};
