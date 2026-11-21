/**
 * THE ASK BOX'S SAFETY RULES — one module, used by the phone and the server.
 *
 * A typed question passes through here before anything else looks at it. The
 * phone runs it for an instant answer; the server runs it again because a
 * direct POST skips the phone. Nothing in this file calls a model or reads a
 * plan: these are fixed word lists, and they err towards firing.
 *
 * Two tiers, and the order inside each matters (ported from the prototype's
 * `answer()` — do not reorder without the tests):
 *
 *   urgent   self-harm, then emergency. Each gets its own card and nothing else.
 *   handoff  medicine, another person's health, alcohol, results, supplements
 *            taken together, a fast weight change, a symptom, a dose, the
 *            wider health picture. Each goes to the coach, never answered here.
 *
 * Between the two tiers the caller may answer a few questions that cannot be
 * clinical ("when is my next session"), which is why they are separate calls.
 *
 * What the lists cannot catch, the model classifies (app-copilot card mode):
 * word lists match words, not meaning, and cannot be finished by adding words.
 */

import { EMERGENCY_HINTS } from "./triage";

export type UrgentKind = "selfharm" | "emergency";
export type HandoffKind =
  | "medicine"
  | "other_person"
  | "alcohol"
  | "results"
  | "combine"
  | "weight_change"
  | "symptom"
  | "dose"
  | "health_picture";

// ── normalising ────────────────────────────────────────────────────────────

/** Lower-case, straighten quotes, collapse spaces. Punctuation is kept: a
 *  comma is what separates "no, chest pain is back" from "no chest pain". */
export function normalizeAsk(q: string): string {
  return (q ?? "")
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

const SUPP_WORD =
  "iron|magnesium|vitamin ?[a-z]\\d{0,2}|d3|b12|b.?complex|omega.?3?|zinc|psyllium|isabgol|probiotics?|ashwagandha|folate|calcium|multivitamin|supplements?";

/** "iron tablet" names a supplement, not a medicine: drop the form word so the
 *  medicine rule ("tablet", "pill") does not catch a question about her own
 *  supplements. Only directly after a supplement's name. */
export function dropSupplementForms(s: string): string {
  return s.replace(new RegExp(`\\b(${SUPP_WORD}) (tablet|capsule|pill|goli)s?\\b`, "g"), "$1");
}

// ── urgent ─────────────────────────────────────────────────────────────────

const SELF =
  /suicid|su[ie]?c[ie]de|\bkms\b|kill(ing)? my ?self|end(ing)? my life|end it all|want to die|wanna die|wish i (was|were) dead|better off dead|better off without me|don'?t want to (be here|live|go on|wake up)|no point (in )?living|(harm|hurt|cut)(ing)? my ?self|self.?harm|unalive|marna chaht|mar jau|mar jana chaht|jeena nahi|jeene ka ma+n+ nahi|khudkushi|jaan de d|(sab|sabkuch|sab kuch|zindagi|khud ko|apne aap ko) khatam (kar|karna|karne) ?(doon|du|dun|dena|lu|loon|lena|chaht|chah|ka man|ka mann)|zindagi se thak|jeena nahi chaht/;

/** Each emergency phrase is tried on its own so a denied one ("no chest pain")
 *  can be skipped without hiding a real one later in the same message. */
const EMERG_SOURCES: RegExp[] = [
  /\bch[ea]{1,2}s?t\s+(pain|pian|pains|tight|tightness|pressure|feels tight|is tight|hurts)/,
  /tight(ness)? in (my )?chest|pain in (my )?chest|pressure (in|on) (my )?chest/,
  /can'?t breath|cannot breath|trouble breathing|struggling to breath|short(ness)? of breath|breathless/,
  /heart attack|\bstroke\b|seizure|\bfaint|pass(ed|ing) out|collaps|unconscious|slurr|numb on one side|face (is )?droop/,
  /(severe|heavy|lot of) bleeding|bleeding (heavily|a lot)|(cough|vomit)ing blood|overdose/,
  /too many (pills|tablets|capsules|medicines?|goli)|took (all|the whole) (of )?(my |the )?(pills|tablets|capsules|strip|bottle)|zyada goli/,
  /(seene?|ch[ea]{1,2}s?t) (me|mein|main|mai) (\w+ ){0,2}(dard|jalan|dabav|bhaari)|chh?ati (me|mein|main|mai) (\w+ ){0,2}dard/,
  /saans (nahi|nhi|lene me)|saans phool|behosh|dil ka daura|khoon ki ulti/,
  // A reaction to food: swelling of the lips, tongue, throat or face, or a
  // closing throat. At a restaurant table this cannot wait for the coach.
  /(lips?|tongue|throat|face|mouth) (is |are |has |have |feels? )?(started )?(swell|swollen|puff)|swell(ing|ed)? (of |in |on )?(my |the )?(lips?|tongue|throat|face|mouth)|throat (is |feels? )?(closing|tight|blocked)|can'?t swallow|anaphyla|(severe|bad) allergic reaction|(hoth|honth|gala|muh|chehra) (sooj|suj)|gala band/,
];

/** A figure of speech, not a symptom: "I fainted with laughter". */
const IDIOM = /^(ed|ing|s)?\s+(with|of|from)\s+(laughter|laughing|joy|happiness|excitement|embarrassment)/;
/** A denial written straight before the phrase: "no chest pain". Deliberately
 *  narrow — a bare "not" is excluded, because "I can not bear this chest pain"
 *  is not a denial. Only spaces may sit between the two. */
const DENIED_BEFORE = /\b(no|not having|don'?t have|do not have|never had|without)( any)? $/;
/** A denial straight after it: "chest pain nahi hai", "the tightness has gone". */
const DENIED_AFTER = /^\w*\s*(nahi|nahin|nhi) (hai|h|hua|ho raha|ho rahi)|^\w*\s*(has gone|is gone|went away|has stopped)/;

function emergencyHit(s: string): boolean {
  for (const src of EMERG_SOURCES) {
    const re = new RegExp(src.source, "g");
    for (let m = re.exec(s); m; m = re.exec(s)) {
      const before = s.slice(0, m.index);
      const after = s.slice(m.index + m[0].length);
      if (IDIOM.test(after)) continue;
      if (DENIED_BEFORE.test(before)) continue;
      if (DENIED_AFTER.test(after)) continue;
      return true;
    }
  }
  return false;
}

/** The live chat's list (triage.ts) is the floor: anything it calls an
 *  emergency is one here too, unless it was skipped above as denied or idiom.
 *  Its self-harm entries are already in SELF, which is checked first. */
function liveListHit(s: string): boolean {
  return EMERGENCY_HINTS.some((h) => {
    const at = s.indexOf(h);
    if (at < 0) return false;
    const before = s.slice(0, at);
    const after = s.slice(at + h.length);
    return !IDIOM.test(after) && !DENIED_BEFORE.test(before) && !DENIED_AFTER.test(after);
  });
}

const WORD_COUNT: Record<string, number> = { five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, paanch: 5, das: 10, bees: 20 };
/** "I took 20 of my magnesium capsules at once by mistake": five or more of
 *  anything taken is an overdose question, never a "combine" question. */
function tookMany(s: string): boolean {
  const re = /\b(took|taken|swallowed|kha li|kha liya|kha gayi|le li|le liya)\b\s*(\d{1,3}|[a-z]+)\b/g;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    // "took 500 mg" is a dose, not 500 capsules.
    if (/^\s*(mg|mcg|iu|g|ml|gm|units?)\b/.test(s.slice(m.index + m[0].length))) continue;
    const n = /^\d+$/.test(m[2]) ? Number(m[2]) : (WORD_COUNT[m[2]] ?? 0);
    if (n >= 5 && /capsule|tablet|pill|goli|supplement|softgel|dose|strip|bottle|magnesium|iron|vitamin|zinc|melatonin|ashwagandha/.test(s.slice(m.index, m.index + 80))) return true;
  }
  const re2 = /\b(\d{1,3}|[a-z]+) (capsules?|tablets?|pills?|goli|goliyan|softgels?)\b.{0,30}\b(took|taken|kha li|kha liya|le li|le liya|swallowed|at once|ek saath)/g;
  for (let m = re2.exec(s); m; m = re2.exec(s)) {
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : (WORD_COUNT[m[1]] ?? 0);
    if (n >= 5) return true;
  }
  return false;
}

/** Self-harm first, then emergency. Null when neither. */
export function askUrgent(q: string): UrgentKind | null {
  const s = normalizeAsk(q);
  if (!s) return null;
  if (SELF.test(s)) return "selfharm";
  if (emergencyHit(s) || liveListHit(s) || tookMany(s)) return "emergency";
  return null;
}

// ── handoff ────────────────────────────────────────────────────────────────

const MEDICINE =
  /ssri|antidepress|sertraline|escitalopram|fluoxetine|thyronorm|eltroxin|levothyrox|metformin|insulin|statin|omez|pantop|antacid|antibiotic|painkiller|paracetamol|ibuprofen|crocin|\bpills?\b|medicine|medication|\btablets?\b|prescri|\bdrug|dawai|\bdawa\b|\bgoli/;

/** MEDICINE without the generic words (pill, tablet, goli, medicine): a
 *  named prescription drug. */
const MEDICINE_NAMED =
  /ssri|antidepress|sertraline|escitalopram|fluoxetine|thyronorm|eltroxin|levothyrox|metformin|insulin|statin|omez|pantop|antacid|antibiotic|painkiller|paracetamol|ibuprofen|crocin|prescri|\bdawai|\bdawa\b|medication|medicine/;

const KIN =
  "husband|wife|pati|patni|son|daughter|beta|beti|mother|father|mum|mom|dad|mummy|papa|sister|brother|friend|saas|sasur|in.?laws?|kids?|children|family";
const OTHER_PERSON = new RegExp(
  [
    // "my husband's plan", "beti ka diet"
    `\\b(${KIN})('?s| ki| ka| ke)? (plan|diet|menu|supplements?|reports?|sugar|bp|thyroid)`,
    // "can my son eat this", "kya mere pati ..."
    `(can|could|should|kya) (my |mere |meri |mera )?(${KIN})\\b.*\\b(eat|have|take|follow|use|kha)`,
    // "pati ko ... kha sakte"
    `(${KIN}) ko .*(kha|le) sakt`,
  ].join("|"),
);
/** "My husband has high BP, what should he eat" — a statement about someone
 *  else. Weaker than the patterns above, so it does not apply when she then
 *  asks for herself: "my husband wants pizza, can I have a slice?" is her
 *  own food question. */
const OTHER_PERSON_STATED = new RegExp(`\\b(my|mere|meri|mera) (${KIN}) (has|have|is|was|ko|needs?|should|can|got)\\b`);
const ASKS_FOR_SELF = /\b(can|could|should|may|shall|have|am|did|do|will|would) i\b|\bwhat (do|should|can) i\b|\bi (have|am|feel|felt|ate|was|can'?t|cannot|don'?t|need|want)\b|\bi'?(m|ve)\b|\bfor me\b|\bmain\b.*\bsakt/;

const ALCOHOL =
  /alcohol|\bwine\b|\bbeer\b|whisky|whiskey|vodka|\brum\b|\bgin\b|cocktail|daaru|\bdrinks\b|\b(can|may|could) i (have a|get a)? ?drink\b(?! (water|juice|milk|lassi|chaas|buttermilk|nimbu|lemon|coconut|tea|coffee|chai))|\bhave a drink\b/;

const RESULTS =
  /body age|biological age|bio age|hba1c|\ba1c\b|\btsh\b|ferritin|cholesterol|\bldl\b|\bhdl\b|\breports?\b|\bresults?\b|my numbers|\blabs?\b|sugar (report|level|number)|(vitamin ?d|b12|iron|thyroid|sugar) (is |are )?(level|report|number|low|high|in range|normal|ok)|is my .{0,24}\b(low|high|in range|normal)\b/;

const SUPP_RE = SUPP_WORD.replace("|supplements?", "") + "|supplements?";
const COMBINE = new RegExp(
  `(safe|together|at once|same time|combine|along with|with (my|the) ).*(${SUPP_RE})|(${SUPP_RE}).*(safe|together|at once|same time|combine)`,
);

const WEIGHT_CHANGE =
  /(lost|gained|dropped|put on).{0,20}\d+(\.\d)? ?(kg|kilo|pound|lb)|\d+(\.\d)? ?(kg|kilo).{0,25}(in|within) (a|one|two|\d+) (day|week)|(badh|kam ho|ghat) gaya|(vajan|wajan|weight).{0,30}(kitna|how much).{0,30}(kam|lose|loss|ghat)|how much (weight )?will i lose/;

const SYMPTOM =
  /side effect|\bpain|\bhurts?\b|\baches?\b|\baching|(stomach|tummy|back|ear|tooth|body|joint) ?aches?|nausea|vomit|\brash|bleed|fever|pregnan|dizz|giddy|light.?headed|\bperiod|acidity|constipat|loose motion|diarr|bloat|\bgas\b|swelling|swollen|cramp|\bnumb\b|numbness|tingl|\bitch|headache|infection|palpitat|\bdard\b|chakkar|ghabra|\bulti\b|bukhar|kamzori|sujan|soojan|\bjalan\b|khujli|\bdast\b|kabz/;

const DOSE = /\b(dose|dosage|mg\b|mcg\b|double|increase|reduce|stop taking|skip|come off|wean|discontinue|quit taking)/;
/** A count against a supplement — "can I take 2 vitamin D3 tablets today?".
 *  Tried on the text BEFORE the form words are dropped. */
const DOSE_COUNT = new RegExp(
  [
    `\\b(2|3|4|two|three|four|extra|another|more|twice)\\b.{0,24}\\b(${SUPP_RE}|tablets?|capsules?|pills?|goli)`,
    // Hindi "do" (two) is also the English "do": only straight before the form word.
    `\\b(do|teen|char) (goli|goliyan|tablets?|capsules?)`,
    `\\b(${SUPP_RE}|tablets?|capsules?|pills?)\\b.{0,24}\\b(twice|two times|2 times|extra|one more)\\b`,
  ].join("|"),
);

const HEALTH_PICTURE = /cortisol|hormon|estrogen|oestrogen|progesterone|menopaus|\bpcos\b|diabet|thyroid|diagnos|\bdoctor\b/;

/**
 * A question the coach answers personally, or null. Call only after
 * `askUrgent` came back null.
 *
 * `missedCapsule` is the one exception carved out for the caller: "I forgot my
 * iron" contains no clinical word and is answered by the coach's own standing
 * rule when she has given one. Without that rule it is a dose question.
 */
export function askHandoff(q: string): HandoffKind | null {
  const raw = normalizeAsk(q);
  if (!raw) return null;
  const s = dropSupplementForms(raw);
  // "goli bhool gayi" is her plan's tablet, not a prescription: a missed
  // capsule wins unless a real medicine is named.
  if (isMissedCapsule(raw) && !MEDICINE_NAMED.test(s)) return "dose";
  if (MEDICINE.test(s)) return "medicine";
  if (OTHER_PERSON.test(s) || (OTHER_PERSON_STATED.test(s) && !ASKS_FOR_SELF.test(s))) return "other_person";
  if (ALCOHOL.test(s)) return "alcohol";
  if (isMissedCapsule(raw)) return "dose";
  if (RESULTS.test(s)) return "results";
  if (COMBINE.test(s) && !isWithFoodOrDrink(s)) return "combine";
  if (WEIGHT_CHANGE.test(s)) return "weight_change";
  if (SYMPTOM.test(s)) return "symptom";
  if (DOSE.test(s) || DOSE_COUNT.test(raw)) return "dose";
  if (HEALTH_PICTURE.test(s)) return "health_picture";
  return null;
}

/** "Can I have chai with my iron?" is about ONE supplement and a food or
 *  drink — a timing question the plan can answer, not two supplements taken
 *  together. Two or more supplements named is always the coach's call. */
function isWithFoodOrDrink(s: string): boolean {
  const named = new Set(s.match(new RegExp(`\\b(${SUPP_RE})`, "g")) ?? []);
  named.delete("supplement");
  named.delete("supplements");
  return named.size <= 1 && /coffee|\btea\b|chai|milk|doodh|\bfood\b|\bmeals?\b|breakfast|lunch|dinner|khana|water|paani/.test(s);
}

/** "I missed my B-complex", "iron lena bhool gayi". */
export function isMissedCapsule(q: string): boolean {
  const s = normalizeAsk(q);
  return /missed|forgot|forgotten|didn'?t take|did not take|skipped|skip ho gay|bhool|bhul gay|chhoot gay|chut gay|nahi li|nahi liya/.test(s) && new RegExp(`${SUPP_RE}|capsule|tablet|dose|goli|goliyan|pill|softgel`).test(s);
}

// ── the words on each card ─────────────────────────────────────────────────

export const REPLY_LINE = "Your coach replies within 24 hours.";

export interface UrgentCopy {
  src: string;
  heading: string;
  lines: string[];
}

/** No helpline number on the self-harm card (the coach's decision): 112, the
 *  nearest hospital, message your coach. */
export const URGENT_COPY: Record<UrgentKind, UrgentCopy> = {
  selfharm: {
    src: "Please read this",
    heading: "You do not have to carry this alone",
    lines: [
      "If you are in danger right now, call 112 or go to your nearest hospital.",
      "Your coach will want to know. Message your coach whenever you are ready.",
    ],
  },
  emergency: {
    src: "Please act now",
    heading: "This may be an emergency",
    lines: ["Call 112 or go to your nearest hospital now.", "Message your coach once you are safe."],
  },
};

export interface HandoffCopy {
  line: string;
  /** shown under the card when a doctor may be needed sooner than the coach */
  note?: string;
}

export const HANDOFF_COPY: Record<HandoffKind, HandoffCopy> = {
  medicine: { line: "This involves a medicine, so your coach answers it personally. Send it to your coach?" },
  other_person: {
    line: "This plan is built from your own tests and history, so I can only answer for you. Shall I pass the question to your coach?",
  },
  alcohol: { line: "Alcohol is your coach's call for your plan. Shall I ask your coach for you?" },
  results: {
    line: "Your coach goes through your results with you, so the first time you see them is together. Shall I ask your coach for you?",
  },
  combine: { line: "How supplements go together is your coach's call. Send this to your coach?" },
  weight_change: {
    line: "A question about how your weight is changing is one for your coach. Send it to your coach?",
    note: "If you also feel unwell, see a doctor today.",
  },
  symptom: {
    line: "Your coach will want to answer this personally. Send it to your coach?",
    note: "If it feels severe or sudden, see a doctor today.",
  },
  dose: { line: "Changing, adding or skipping a supplement is your coach's call. Send this to your coach?" },
  health_picture: {
    line: "That is a question about your health picture, so your coach answers it personally. Send it to your coach?",
  },
};

/** The line shown beside a message typed straight into the Coach tab: the
 *  message is still sent, and this sits next to it. Null when nothing applies. */
export function coachTabNote(q: string): { urgent: UrgentKind } | { doctor: string } | null {
  const u = askUrgent(q);
  if (u) return { urgent: u };
  const h = askHandoff(q);
  if (h === "symptom") return { doctor: HANDOFF_COPY.symptom.note! };
  if (h === "weight_change") return { doctor: HANDOFF_COPY.weight_change.note! };
  return null;
}
