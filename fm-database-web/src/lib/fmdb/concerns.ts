/**
 * The fixed list of concerns a prospect can have, and a keyword classifier
 * that turns their own words into those tags.
 *
 * Why a FIXED list: it is the join between a person and the content library
 * (`content-library.ts`). Free text cannot be matched to a video; a tag can.
 * The person's own words are never thrown away — they stay on the interest
 * signal as `detail`, and the follow-up email still quotes them.
 *
 * IDs are storage keys (client.yaml#interests[].concern and the content
 * library's `concerns`). Never rename one; add a new id instead.
 *
 * Deliberately keyword-based and deterministic ($0, testable). Anything the
 * rules miss is left untagged for the coach to tag by hand on the dashboard —
 * an untagged person is visible, a wrongly tagged one gets the wrong video.
 *
 * Pure: no I/O.
 */

export const CONCERN_IDS = [
  "blood_sugar",
  "gut",
  "thyroid",
  "hormones",
  "energy",
  "nutrients",
  "liver",
  "weight",
  "heart",
  "joints",
  "skin_hair",
  "sleep",
  "mood",
  "autoimmune",
  "labs",
] as const;

export type ConcernId = (typeof CONCERN_IDS)[number];

/** Coach-facing chip labels. */
export const CONCERN_LABEL: Record<ConcernId, string> = {
  blood_sugar: "Blood sugar",
  gut: "Digestion",
  thyroid: "Thyroid",
  hormones: "Hormones & cycles",
  energy: "Energy & brain fog",
  nutrients: "Iron, B12 & vitamins",
  liver: "Liver",
  weight: "Weight",
  heart: "BP & cholesterol",
  joints: "Joints & pain",
  skin_hair: "Skin & hair",
  sleep: "Sleep",
  mood: "Stress & mood",
  autoimmune: "Autoimmune",
  labs: "Making sense of reports",
};

/**
 * Keyword rules, matched against lower-cased text. Word-bounded wherever a
 * short stem could hide inside another word ("bp" inside "bpm", "ms" inside
 * "symptoms").
 */
const RULES: Record<ConcernId, RegExp> = {
  blood_sugar: /\bsugar\b|diabet|\bhba1c\b|\bhb1c\b|\ba1c\b|insulin|glucose|\bcgm\b/,
  gut: /\bgut\b|bloat|constipat|bowel|\bbowl\b|acidity|acid reflux|\bgerd\b|reflux|\bibs\b|colitis|crohn|h\.? ?pylori|digest|\bgas\b|diarrh|loose (motion|stool)|\bsibo\b|stomach|indigestion/,
  thyroid: /thyroid|hashimoto|\btsh\b|hypothyr|hyperthyr/,
  hormones: /\bperiods?\b|menstru|\bpcod\b|\bpcos\b|menopaus|hot flash|\bcycles?\b|hormon|oestrogen|estrogen|progesterone|fertility|\bpms\b/,
  energy: /fatigue|tired|\benergy\b|brain fog|\bfog\b|exhaust|letharg|low stamina/,
  nutrients: /\biron\b|\bb12\b|vitamin|anaemi|anemi|deficien|ferritin|haemoglobin|hemoglobin|\bprotein\b/,
  liver: /liver|\bsgpt\b|\bsgot\b|\balt\b.*\bast\b/,
  weight: /weight|obes|belly fat|\bbelly\b|\bfat loss\b|\bbmi\b/,
  heart: /\bbp\b|blood pressure|hypertens|cholesterol|lipid|triglycer|\bldl\b|\bhdl\b|\bheart\b|cardiac/,
  joints: /joint|\bknees?\b|arthrit|back ?pain|sciatica|frozen shoulder|uric acid|\bgout\b|osteo/,
  skin_hair: /\bskin\b|\bacne\b|eczema|psoriasis|hair ?(fall|loss|thinning)|\bhair\b|rosacea|pigmentation/,
  sleep: /\bsleep|insomnia|wak(e|ing) up at night/,
  mood: /stress|anxi|depress|mental health|\bmood\b|panic|burn ?out|overwhelm/,
  autoimmune: /autoimmun|hashimoto|multiple sclerosis|\bms\b|lupus|rheumatoid|psoriasis|ulcerative colitis|crohn|coeliac|celiac|vitiligo/,
  labs: /\blabs?\b|\breports?\b|blood (test|work)|test results|\bnormal\b.*\breport/,
};

export function isConcernId(v: unknown): v is ConcernId {
  return typeof v === "string" && (CONCERN_IDS as readonly string[]).includes(v);
}

/**
 * The concerns named in a piece of free text, in the order the person named
 * them (first mention first), no duplicates. Order matters: it decides which
 * concern their first video or guide is about, and people lead with what
 * bothers them most ("Hashimoto's, fatigue, possible insulin resistance" is a
 * thyroid person first). Ties fall back to CONCERN_IDS order. Empty when
 * nothing matches — the caller keeps the text anyway.
 */
export function classifyConcerns(text: string | null | undefined): ConcernId[] {
  if (typeof text !== "string" || !text.trim()) return [];
  const t = text.toLowerCase().replace(/[’']/g, "'");
  const hits: Array<{ id: ConcernId; at: number; rank: number }> = [];
  CONCERN_IDS.forEach((id, rank) => {
    const m = RULES[id].exec(t);
    if (m) hits.push({ id, at: m.index, rank });
  });
  return hits.sort((a, b) => a.at - b.at || a.rank - b.rank).map((h) => h.id);
}

/**
 * Lead-magnet / keyword sources (ochre-funnel `Contact.source`, IG keyword
 * campaign tags) → the concern they signal. Used when a lead arrives with a
 * known source but no words of their own.
 */
export const SOURCE_CONCERN: Record<string, ConcernId> = {
  sugar_guide: "blood_sugar",
  sugar: "blood_sugar",
  bloat_guide: "gut",
  bloat: "gut",
  gut_guide: "gut",
  gut: "gut",
  thyroid_guide: "thyroid",
  thyroid: "thyroid",
  cycle_guide: "hormones",
  cycle: "hormones",
  hrt_guide: "hormones",
  fog_guide: "energy",
  fog: "energy",
  liver_guide: "liver",
  liver: "liver",
  lab_report_guide: "labs",
  decode: "labs",
  protein: "nutrients",
};
