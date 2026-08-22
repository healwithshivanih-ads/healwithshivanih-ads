/**
 * Menopause Rating Scale (MRS) — the standard 11-item instrument
 * (Hauser/Schneider/Heinemann). Each item scored 0 (none) - 4 (very
 * severe), across three subscales.
 *
 * MRS_ITEMS is the single source of truth for both the capture UI
 * (mrs-capture.tsx) and the scorer below, so labels/keys never drift
 * apart. Mirrors fm-database/fmdb/plan/models.py::MenopauseRatingScale
 * field-for-field — keep both in lockstep.
 */

export type MrsSubscale = "somaticVegetative" | "psychological" | "urogenital";

export interface MrsItem {
  key: keyof MenopauseRatingScaleData;
  label: string;
  subscale: MrsSubscale;
}

export const MRS_ITEMS: MrsItem[] = [
  // Somato-vegetative
  { key: "hot_flashes_sweating", label: "Hot flashes, sweating", subscale: "somaticVegetative" },
  { key: "heart_discomfort", label: "Heart discomfort (unusual awareness of heartbeat, skipping, racing, tightness)", subscale: "somaticVegetative" },
  { key: "sleep_problems", label: "Sleep problems (difficulty falling asleep, staying asleep, or waking early)", subscale: "somaticVegetative" },
  { key: "joint_muscular_discomfort", label: "Joint and muscular discomfort", subscale: "somaticVegetative" },
  // Psychological
  { key: "depressive_mood", label: "Depressive mood (feeling down, sad, tearful, low drive, mood swings)", subscale: "psychological" },
  { key: "irritability", label: "Irritability (feeling nervous, inner tension, aggressive)", subscale: "psychological" },
  { key: "anxiety", label: "Anxiety (inner restlessness, feeling panicky)", subscale: "psychological" },
  { key: "physical_mental_exhaustion", label: "Physical and mental exhaustion (decreased performance, memory, concentration)", subscale: "psychological" },
  // Urogenital
  { key: "sexual_problems", label: "Sexual problems (change in desire, activity, satisfaction)", subscale: "urogenital" },
  { key: "bladder_problems", label: "Bladder problems (difficulty urinating, increased urgency, incontinence)", subscale: "urogenital" },
  { key: "vaginal_dryness", label: "Dryness of vagina (dryness or burning, discomfort with intercourse)", subscale: "urogenital" },
];

export const MRS_RATING_LABELS = ["None", "Mild", "Moderate", "Severe", "Very severe"] as const;

export interface MenopauseRatingScaleData {
  hot_flashes_sweating?: number;
  heart_discomfort?: number;
  sleep_problems?: number;
  joint_muscular_discomfort?: number;
  depressive_mood?: number;
  irritability?: number;
  anxiety?: number;
  physical_mental_exhaustion?: number;
  sexual_problems?: number;
  bladder_problems?: number;
  vaginal_dryness?: number;
}

export interface MrsScore {
  somaticVegetative: number; // 0-16 (4 items x 0-4)
  psychological: number;     // 0-16 (4 items x 0-4)
  urogenital: number;        // 0-12 (3 items x 0-4)
  total: number;             // 0-44
}

export const MRS_SUBSCALE_MAX: Record<MrsSubscale, number> = {
  somaticVegetative: 16,
  psychological: 16,
  urogenital: 12,
};

/**
 * Computes the MRS subscale + total scores. Returns null unless ALL 11
 * items are answered — the instrument is defined as the sum of all 11,
 * so a partial subset isn't a valid MRS score. Callers should skip
 * (not zero-fill) sessions where this returns null.
 */
export function computeMrsScore(data: MenopauseRatingScaleData | null | undefined): MrsScore | null {
  if (!data) return null;
  const values: Record<MrsSubscale, number> = {
    somaticVegetative: 0,
    psychological: 0,
    urogenital: 0,
  };
  for (const item of MRS_ITEMS) {
    const v = data[item.key];
    if (v == null || Number.isNaN(v)) return null;
    values[item.subscale] += v;
  }
  const total = values.somaticVegetative + values.psychological + values.urogenital;
  return { ...values, total };
}
