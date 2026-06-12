/**
 * MSQ — Medical Symptom Questionnaire (the standard FM outcome instrument).
 *
 * PURE module (no fs, no server-only): the app UI renders from this and the
 * answer keys it produces ("<categoryId>.<itemIndex>") are what the save
 * shim uses to recompute totals server-side — so client and server can
 * never disagree on scoring.
 *
 * Scale (per symptom, over the last 2 weeks):
 *   0 never · 1 occasionally, not severe · 2 occasionally, severe
 *   3 frequently, not severe · 4 frequently, severe
 *
 * Total bands: <10 optimal · 10–49 mild · 50–99 moderate · ≥100 high.
 */

export interface MsqCategory {
  id: string;
  label: string;
  glyph: string; // Icon name from ochre-context
  items: string[];
}

export const MSQ_SCALE: { value: number; label: string }[] = [
  { value: 0, label: "Never" },
  { value: 1, label: "Sometimes, mild" },
  { value: 2, label: "Sometimes, severe" },
  { value: 3, label: "Often, mild" },
  { value: 4, label: "Often, severe" },
];

export const MSQ_CATEGORIES: MsqCategory[] = [
  { id: "head", label: "Head", glyph: "coach", items: ["Headaches", "Feeling faint", "Dizziness", "Trouble sleeping"] },
  { id: "eyes", label: "Eyes", glyph: "sun", items: ["Watery or itchy eyes", "Swollen or sticky eyelids", "Dark circles or bags under eyes", "Blurred vision"] },
  { id: "ears", label: "Ears", glyph: "bell", items: ["Itchy ears", "Earaches or infections", "Drainage from the ear", "Ringing or hearing loss"] },
  { id: "nose", label: "Nose", glyph: "leaf", items: ["Stuffy nose", "Sinus problems", "Hay fever", "Sneezing attacks", "Excess mucus"] },
  { id: "mouth", label: "Mouth & throat", glyph: "bowl", items: ["Chronic cough", "Often clearing your throat", "Sore throat or hoarseness", "Swollen tongue, gums or lips", "Mouth ulcers"] },
  { id: "skin", label: "Skin", glyph: "sparkle", items: ["Acne", "Hives, rashes or dry skin", "Hair loss", "Flushing or hot flashes", "Excess sweating"] },
  { id: "heart", label: "Heart", glyph: "heart", items: ["Irregular or skipped beats", "Rapid or pounding heartbeat", "Chest pain"] },
  { id: "lungs", label: "Lungs", glyph: "breath", items: ["Chest congestion", "Asthma or bronchitis", "Shortness of breath", "Difficulty breathing"] },
  { id: "digestion", label: "Digestion", glyph: "bowl", items: ["Nausea or vomiting", "Loose stools", "Constipation", "Bloating", "Belching or passing gas", "Heartburn", "Stomach or intestinal pain"] },
  { id: "joints", label: "Joints & muscles", glyph: "walk", items: ["Pain or aches in joints", "Arthritis", "Stiffness or limited movement", "Pain or aches in muscles", "Feeling weak or tired"] },
  { id: "weight", label: "Weight & appetite", glyph: "bag", items: ["Binge eating or drinking", "Craving certain foods", "Excess weight", "Compulsive eating", "Water retention", "Underweight"] },
  { id: "energy", label: "Energy", glyph: "sun", items: ["Fatigue or sluggishness", "Apathy or lethargy", "Hyperactivity", "Restlessness"] },
  { id: "mind", label: "Mind", glyph: "book", items: ["Poor memory", "Confusion or poor comprehension", "Poor concentration", "Poor physical coordination", "Difficulty making decisions", "Stuttering or stammering", "Slurred speech", "Learning difficulties"] },
  { id: "emotions", label: "Emotions", glyph: "heart", items: ["Mood swings", "Anxiety, fear or nervousness", "Anger or irritability", "Low mood"] },
  { id: "other", label: "General", glyph: "checkin", items: ["Frequent illness", "Frequent or urgent urination", "Genital itch or discharge", "Bone pain"] },
];

export const MSQ_ITEM_COUNT = MSQ_CATEGORIES.reduce((s, c) => s + c.items.length, 0);

export type MsqAnswers = Record<string, number>; // "<categoryId>.<itemIndex>" → 0..4

export function msqKey(categoryId: string, itemIndex: number): string {
  return `${categoryId}.${itemIndex}`;
}

export function msqCategoryTotal(answers: MsqAnswers, categoryId: string): number {
  let t = 0;
  for (const [k, v] of Object.entries(answers)) {
    if (k.startsWith(categoryId + ".")) t += Math.min(4, Math.max(0, v | 0));
  }
  return t;
}

export function msqTotal(answers: MsqAnswers): number {
  return Object.values(answers).reduce((s, v) => s + Math.min(4, Math.max(0, v | 0)), 0);
}

export interface MsqBand {
  id: "optimal" | "mild" | "moderate" | "high";
  label: string;
  /** client-voiced one-liner */
  note: string;
}

export function msqBand(total: number): MsqBand {
  if (total < 10)
    return { id: "optimal", label: "Optimal", note: "Your body is running quietly — beautiful." };
  if (total < 50)
    return { id: "mild", label: "Mild", note: "A gentle background hum — exactly what the plan works on." };
  if (total < 100)
    return { id: "moderate", label: "Moderate", note: "Your body is asking for attention — the plan is targeting this." };
  return { id: "high", label: "High", note: "A lot of signal — every week on the plan counts." };
}
