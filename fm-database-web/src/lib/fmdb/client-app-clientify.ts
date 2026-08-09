/**
 * clientifyWhy / clientifyPracticeDetail — the two pipelines that turn the
 * coach's private clinical notes into the copy on a client's phone.
 *
 * Lifted out of client-app.ts on 2026-08-09. That module is `server-only`, so
 * NOTHING defined inside it can be imported by a test — which is exactly how a
 * mangled pronoun and a coach stage direction reached cl-022's magnesium card
 * and stayed there. Every scrub these compose (evidence hedging, coach
 * directives, shouted openers, third-person voice) already lives in a tested
 * sibling; these are the pipelines that order them, and the ordering is itself
 * load-bearing — stripCoachDirective must run BEFORE toSecondPerson, because
 * its patterns key off the coach's "her", which the pronoun pass erases.
 *
 * Behaviour is unchanged by the move: the bodies are verbatim.
 */

import { stripEvidenceHedging } from "./client-app-evidence-hedge";
import { SENTENCE_SPLIT } from "./sentence-split";
import { stripCoachDirective } from "./client-app-coach-directive";
import { softenShoutedOpener } from "./client-app-shouting";
import { toSecondPerson } from "./client-app-third-person";

/** Practice `details` are multi-sentence instructions (unlike the one-line
 *  supplement "why"), so this is a LIGHT scrub — strip a leading coach
 *  change-log stamp / [tag] / bare ISO date and tidy spacing, but PRESERVE the
 *  full instructional text and its line breaks (bulleted steps render on their
 *  own lines via white-space: pre-wrap). Never rephrase or truncate. */
/** Removing a leading stamp ("Form swap — ") leaves the sentence starting
 *  lowercase on the client's card. Same idiom as toSecondPerson / scrubAuthors. */
function recapitalise(s: string): string {
  return /^[a-z]/.test(s) ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export function clientifyPracticeDetail(raw: string): string {
  // stripCoachDirective first — same ordering reason as clientifyWhy.
  let s = softenShoutedOpener(toSecondPerson(stripCoachDirective(raw || "")));
  s = s.replace(
    // The terminator must not be a BARE hyphen: "FORM SWAP 2026-05-24 — …"
    // then ends at the hyphen inside the DATE, and the card renders
    // "05-24 — …". An ASCII hyphen only counts when spaced like a dash.
    /^\s*(?:FORM\s+SWAP|SWAP|UPDATE|CHANGE|REVISED|NOTE)\b[^—–\n:]*?(?:[—–]\s*|\s-\s+|:\s*)/i,
    "",
  );
  s = s.replace(/^\s*\[[^\]]*\]\s*/g, "");
  s = s.replace(/\b20\d\d-\d\d-\d\d\b/g, "");
  s = stripEvidenceHedging(s);
  s = s.replace(/[ \t]{2,}/g, " ");
  // tidy whitespace around newlines but keep the line breaks themselves
  s = s.replace(/[ \t]*\n[ \t]*/g, "\n").replace(/\n{3,}/g, "\n\n");
  return recapitalise(s.trim());
}

/** Soften a coach_rationale into client-facing copy (mobile audit
 *  2026-06-11: raw rationales leaked lab readouts — "LDL 130, HDL 49,
 *  Lp(a) 32", "(204 ng/dL, below range)" — and coach-speak like
 *  "mandatory correction" / "gap in prior protocol" into the app).
 *  Letter-provided why-lines are already client-voiced and skip this. */
export function clientifyWhy(raw: string): string {
  // BEFORE the pronoun conversion — the directive patterns key off the coach's
  // third person ("said to her that way"), which toSecondPerson erases.
  let s = softenShoutedOpener(toSecondPerson(stripCoachDirective(raw)));
  // strip leading coach change-log stamps: "FORM SWAP 2026-05-24 — …",
  // "[2026-05-24] …", "UPDATE: …" (the dated clause is the coach's audit note)
  // Bare-hyphen terminator removed — see clientifyPracticeDetail above.
  s = s.replace(/^\s*(?:FORM\s+SWAP|SWAP|UPDATE|CHANGE|REVISED|NOTE)\b[^—–\n]*?(?:[—–]\s*|\s-\s+|:\s*)/i, "");
  s = s.replace(/^\s*\[[^\]]*\]\s*/g, "");
  s = s.replace(/\b20\d\d-\d\d-\d\d\b/g, "");
  // Evidence-tier hedging ("Evidence tier plausible_emerging — trial it for
  // 12 weeks…") — same leak class as clientifyPracticeDetail, caught live on
  // this exact field (cl-022's calcium-d-glucarate rationale). See
  // stripEvidenceHedging for why this is a class fix, not a one-off.
  s = stripEvidenceHedging(s);
  // Drug-nutrient depletion clauses name the client's actual medication +
  // class — "Telma 40 (ARB) depletes magnesium", "ARB (Telma 40) depletes
  // zinc". Rephrase to a generic, client-voiced line BEFORE other scrubs so
  // the brand/class never reaches the phone (mobile audit 2026-06-13).
  if (/\bdeplet(?:e|es|ing|ion)\b/i.test(s)) {
    // capture the nutrient right after "depletes", up to the first clause
    // break ("magnesium — mandatory correction" → "magnesium")
    const m = s.match(/deplet(?:es?|ing|ion of)\s+([a-z][a-z ]*?)(?=\s*[—–,.;:-]|\s+and\b|\s*$)/i);
    const nutrient = m && m[1] ? m[1].trim().toLowerCase() : "";
    return nutrient && nutrient.length <= 30
      ? `Replaces ${nutrient} — medications can lower it over time.`
      : "Replaces a nutrient your medication can lower over time.";
  }
  // coach-only phrasing after a dash
  s = s.replace(
    /\s*[—–-]\s*(mandatory correction|non-negotiable[^.;]*|gap in (?:the )?prior protocol[^.;]*|hard rule[^.;]*)\.?/gi,
    ".",
  );
  // bare lab readouts with clinical units anywhere ("22.10 µg/dL", "4.19 g/dL")
  s = s.replace(/\b\d+(?:\.\d+)?\s*(?:µg|mcg|ng|pg|mg|nmol|pmol|mIU|µIU|IU)\s*\/\s*(?:dL|mL|L)\b/gi, "");
  // "(far) below/above FM-optimal of 50–80" comparison fragments
  s = s.replace(/\b(?:is\s+)?(?:far\s+)?(?:below|above|under|over)?\s*FM[- ]?optimal(?:\s+of)?\s*[\d.,–-]*\s*(?:ng\/mL|µg\/dL|g\/dL)?/gi, "");
  // "(above|below) the reference range (upper|lower) limit"
  s = s.replace(/\b(?:above|below)?\s*(?:the\s+)?reference range(?:\s+(?:upper|lower)\s+limit)?(?:\s+at)?/gi, "");
  // A parenthetical that is ONLY a number is still a lab readout — the rule
  // below wants a unit inside it, so "zinc (75.68)" and "Cu:Zn (1.58)" walked
  // straight past it onto cl-009's card (2026-08-09).
  s = s.replace(/\s*\(\s*[\d.,:%\s+-]+\)/g, "");
  // parenthetical lab readouts / conversion arrows
  s = s.replace(/\s*\([^)]*(?:\d[^)]*(?:ng|mg|nmol|pmol|mIU|mcg|µg|iu\b)[^)]*|below range|above range|→[^)]*)\)/gi, "");
  // bare "MARKER 123" readout lists
  s = s.replace(/\(?\b(?:LDL|HDL|Lp\(a\)|TSH|fT[34]|HbA1c|hsCRP|homocysteine|ferritin|B12|vitamin D)\s*[:=]?\s*\d+(?:\.\d+)?%?\)?,?/gi, "");
  // trailing "= MTHFR pattern" style equations
  s = s.replace(/\s*=\s*[A-Za-z][^.]*pattern/gi, "");
  // a readout removal can leave a dangling comparison clause
  // ("— despite normal B12/folate strongly implicates…") — drop it
  s = s.replace(/\s*[—–-]\s*despite[^.]*\.?/gi, ".");
  // tidy what the removals left behind
  s = s
    // Removals leave PUNCTUATION BEHIND: "vitamin D is 22 ng/mL — insufficient"
    // became "vitamin D is — insufficient", and "(22 ng/mL; deficient)" became
    // "(deficient; )". Four live clients were reading these (audit 2026-08-09).
    .replace(/\(\s*[;,]?\s*\)/g, "")            // ( ) / ( ; )
    .replace(/\(\s*([^()]*?)[\s;,]+\)/g, "($1)") // (deficient; ) → (deficient)
    .replace(/\s+(is|are|was|were)\s*[—–-]\s*/gi, " $1 ") // "is — insufficient"
    .replace(/\s+\./g, ".")
    .replace(/\s*,\s*([,.])/g, "$1")
    .replace(/,\s*\./g, ".")
    .replace(/:\s*\./g, ".")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,])/g, "$1")
    .replace(/\.{2,}/g, ".")
    .replace(/[,:]\s*$/g, "")
    // A removal at the START leaves the sentence opening on its own dash or
    // list marker: "(1) Homocysteine 20.79 — endogenous creatine synthesis…"
    // lost its first half and reached Nazneen's card as "— endogenous creatine
    // synthesis…". Strip whatever punctuation the cut left in front.
    .replace(/^[\s—–\-,;:.)\]]+/, "")
    .trim();
  // Final guard: coach_rationale is clinical/coach-facing. If softening left
  // anything that still reads like a lab report or coach note — a specific
  // result, a marker + verdict, a reference-range / FM-optimal comparison, a
  // named drug class, or an antibody — drop the why entirely. A supplement
  // card with no rationale is strictly safer than one leaking the client's
  // labs or medications (mobile audit 2026-06-13).
  const CLINICAL_LEAK = new RegExp(
    [
      String.raw`\d(?:\.\d+)?\s*(?:µg|mcg|ng|pg|mg|nmol|pmol|mIU|µIU|IU)\s*\/\s*(?:dL|mL|L)`,
      String.raw`\breference range\b`,
      String.raw`\bFM[- ]?optimal\b`,
      String.raw`\b(?:elevated|low|high|normal|deficient|insufficient|sub-?optimal)\s+(?:serum\s+)?(?:homocysteine|folate|ferritin|cortisol|tsh|ft[34]|b12|albumin|vitamin\s*d|hs-?crp)\b`,
      // …and the SAME judgement written the other way round. The rule above
      // only caught "low ferritin"; a coach writes "ferritin is low" just as
      // often, and once the number is scrubbed that is all that remains —
      // "B12 is functionally deficient", "25-OH vitamin D is insufficient".
      String.raw`\b(?:homocysteine|folate|ferritin|cortisol|tsh|ft[34]|b12|albumin|vitamin\s*d|25-?OH|hs-?crp|hba1c)\b[^.]{0,40}?\b(?:deficient|insufficient|elevated|sub-?optimal)\b`,
      String.raw`\b(?:homocysteine|ferritin|tsh|ft[34]|hs-?crp|hba1c|albumin|cortisol)\b[^.]*\d`,
      String.raw`=\s*(?:insufficient|deficient|elevated|sub-?optimal|low|high)\b`,
      String.raw`\b(?:anti-?TPO|TPO antibod|antibod(?:y|ies)|deiodinase|Lp\(a\))\b`,
      // Antibody SHORTHAND. The rule above wants the word "antibodies"; the
      // coach writes the assay pair. "Curcumin inhibits NF-κB (reducing
      // TPO/TgAb autoimmune signalling)" surfaced on a client card the moment
      // this walked past the opening sentence (2026-08-09).
      String.raw`\b(?:TgAb|TPOAb|anti-?Tg|NF-?.B|hsCRP)\b`,
      // A verdict on a MINERAL reads exactly like one on a lab marker once the
      // value has been scrubbed out: "corrects your low-normal zinc and
      // elevated Cu:Zn".
      String.raw`\b(?:low|high|elevated|depressed|deficient)[-\s]?\w*\s+(?:zinc|copper|selenium|magnesium|iron|ferritin|folate)\b`,
      String.raw`\bCu:?Zn\b`,
      // A bare PERCENTAGE surviving into a supplement "why" is a lab readout
      // essentially every time: "Ferritin 12 + transferrin sat 16.3% =
      // iron-deficient erythropoiesis" lost its ferritin value and still
      // carried the saturation onto cl-007's card.
      String.raw`\d+(?:\.\d+)?\s*%`,
      // GENERIC readout rule, and the reason the marker denylist above should
      // stop growing. "ApoB 109.8, non-HDL … and AIP 0.224" reached a live
      // card because neither ApoB nor AIP was on the list — and there is
      // always another marker. A DECIMAL number that is not a dose is a lab
      // value essentially every time; doses read "500 mg", "1.5 g", "2000 IU".
      String.raw`\d+\.\d+(?!\s*(?:mg|mcg|µg|g\b|kg|ml|l\b|iu\b|billion|cfu|%))`,
      String.raw`\b(?:transferrin|erythropoies\w*|saturation)\b`,
      // A RAW FIELD NAME is coach-tooling vocabulary, never client copy — and
      // the sentence carrying it named ANOTHER CLIENT: "Mushroom is explicitly
      // listed in Manju's foods_to_avoid."
      String.raw`\b[a-z]+_[a-z_]+\b`,
      // Named third-party reports are client-specific coach artefacts.
      String.raw`\b(?:Sova|GMT|DUTCH|GI-?MAP|OAT)\b`,
      String.raw`\b(?:ARB|ACE[- ]?inhibitors?|beta[- ]?blockers?|PPIs?|statins?|SSRIs?|SNRIs?)\b`,
      String.raw`\b(?:client reported|FORM SWAP|prior protocol|coach note|per coach)\b`,
    ].join("|"),
    "i",
  );
  if (CLINICAL_LEAK.test(s)) return "";
  if (COACH_BOOKKEEPING.test(s)) return "";
  // STUB GUARD. The removals above are surgical, so a rationale built entirely
  // AROUND a lab readout collapses to a fragment rather than to nothing:
  // "Her ferritin is 12 ng/mL, far below FM-optimal of 70-150." loses the
  // value, the comparison and the range and renders as "Your ferritin is" —
  // which still names the client's marker and says nothing at all. Found
  // 2026-08-09 by the first end-to-end test of the loader; the unit test above
  // had accepted it because no UNITS survived.
  //
  // Detect the shape, not the vocabulary: a dangling function word at the end,
  // or too little left to be a sentence. Banning marker words outright would
  // take "supports your vitamin D" with it, which is copy the coach wants.
  if (/\b(?:is|are|was|were|of|at|to|and|the|a|an|in|for|with)\s*[.,;:]?$/i.test(s.trim()))
    return "";
  if (s.replace(/[^a-z]/gi, "").length < 12) return "";
  return recapitalise(s);
}

/**
 * Coach BOOKKEEPING — a sentence written to track the plan's own history, not
 * to tell the client anything: "NEW in this session.", "TOP ADD this round.",
 * "Already on this — continue.", "STEP-DOWN from 5 g twice daily."
 *
 * Twelve live cards opened with one of these (audit 2026-08-09). They are
 * grammatical, so nothing above catches them, and they are always the FIRST
 * sentence — which is the one the card shows.
 *
 * Also here: the lead-in that promises a list and then hands over to the
 * clinical detail ("Three reasons converge for her.") — on its own it is a
 * non-answer, and it opened cl-022's creatine card.
 *
 * Deliberately NOT length-based. "Protein top-up." and "Food-sourced, not a
 * capsule." are terse for the same reason a good instruction is terse; they
 * are answers, and a blunt short-sentence rule would take them too.
 */
const COACH_BOOKKEEPING = new RegExp(
  [
    // plan-history markers, anywhere in a short sentence
    String.raw`\b(?:this session|this round|last round|prior protocol note|pending clarification)\b`,
    String.raw`^\s*already on (?:this|it)\b`,
    String.raw`^\s*(?:new|top add|re-?add(?:ed)?|added|removed|dropped|kept|keep|hold|paused?)\b[^.]{0,40}\.?\s*$`,
    String.raw`^\s*(?:continued?|stop(?:ped)?|step[- ]?(?:down|up)|swap(?:ped)?|increase[d]?|decrease[d]?)\b[^.]{0,40}\.?\s*$`,
    // a lead-in that defers the actual reason to the sentences after it
    String.raw`^\s*\w+\s+(?:reasons?|things?|factors?|points?)\b[^.]{0,30}\.?\s*$`,
  ].join("|"),
  "i",
);

/**
 * The client-facing "why" for a supplement: the FIRST sentence of the coach's
 * rationale that survives scrubbing.
 *
 * Not `clientifyWhy(firstSentence(...))`, which is what this replaced. The
 * coach's opening sentence is very often bookkeeping or a lab readout, and
 * both get dropped — leaving the card blank while the actual reason sat in
 * sentence two. Walking forward finds it: cl-004's curcumin card went from
 * "NEW in this session." to what curcumin is doing for her.
 *
 * Bounded to the first six sentences so a long clinical rationale cannot end
 * up represented by a trailing aside.
 */
export function clientFacingWhy(raw: string): string {
  const cleaned = (raw || "").replace(/^\[[^\]]*\]\s*/g, "");
  const sentences = cleaned.split(SENTENCE_SPLIT).slice(0, 6);
  for (const sentence of sentences) {
    const out = clientifyWhy(
      sentence.replace(/^CRITICAL GAP[^:]*:\s*/i, "").replace(/^CONTINUE[^.]*\.\s*/i, ""),
    );
    if (out) return out;
  }
  return "";
}
