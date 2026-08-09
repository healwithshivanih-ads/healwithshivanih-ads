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
      String.raw`\b(?:ARB|ACE[- ]?inhibitors?|beta[- ]?blockers?|PPIs?|statins?|SSRIs?|SNRIs?)\b`,
      String.raw`\b(?:client reported|FORM SWAP|prior protocol|coach note|per coach)\b`,
    ].join("|"),
    "i",
  );
  if (CLINICAL_LEAK.test(s)) return "";
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
