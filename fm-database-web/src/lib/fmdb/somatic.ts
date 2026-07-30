/**
 * Resolve a prescribed somatic practice from the catalogue, BY SLUG.
 *
 * The app's other mind-body derivations (deriveEft, deriveBreathwork,
 * deriveSleep) pattern-match the free-text practice NAME. That works while
 * there are three techniques with distinctive names, and breaks the moment
 * there are 114: a gastrocolic-rhythm prescription contains the word
 * "breathing", so deriveBreathwork would catch it and render a generic
 * 4-in / 6-out session — silently dropping the hand pressure that IS the
 * practice. Half-right is worse than absent.
 *
 * So this resolves `PracticeItem.somatic_practice` against
 * data/somatic_practices/<slug>.yaml and hands the player the real steps.
 * Nothing is guessed.
 */

import fs from "node:fs";
import path from "node:path";

import yaml from "js-yaml";

import { getCataloguePath } from "./paths";
import { isClientSafe, readChiefComplaints } from "./somatic-read";

/** The seven players. Mirrors fmdb.enums.MotionShape — keep in lockstep. */
export type MotionShape =
  | "breath_excursion"
  | "continuous_travel"
  | "release"
  | "sustained_pressure"
  | "load_release"
  | "still"
  | "checklist";

export const MOTION_SHAPES: readonly MotionShape[] = [
  "breath_excursion",
  "continuous_travel",
  "release",
  "sustained_pressure",
  "load_release",
  "still",
  "checklist",
] as const;

export interface SomaticStep {
  label: string;
  cue: string;
  /** Seconds. 0 means self-paced — deliberately different from absent. */
  secs: number | null;
  action: string;
}

export interface AppSomatic {
  practiceId: string;          // the plan practice this came from
  /**
   * Index into the plan's practice arrays this was resolved from.
   *
   * Carried rather than re-found later: two practices can legitimately link
   * the SAME slug (constructive-rest morning and night), and looking the index
   * back up by slug would then return the first one twice — dropping one
   * practice and leaving the other to be caught by the name-matchers.
   */
  sourceIndex: number;
  slug: string;                // catalogue slug
  name: string;
  shape: MotionShape;
  when: string;
  why: string;                 // client-facing, plain
  steps: SomaticStep[];
  reps: number | null;
  bilateral: boolean;
  timed: boolean;
  totalSeconds: number | null;
  equipment: string[];
}

type Dict = Record<string, unknown>;

const asStr = (v: unknown): string => (typeof v === "string" ? v : "");
const asNum = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** Slug guard — this value reaches a filesystem path. */
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isMotionShape(v: unknown): v is MotionShape {
  return typeof v === "string" && (MOTION_SHAPES as readonly string[]).includes(v);
}

/** Read one somatic practice from the catalogue. Returns null when absent or malformed. */
export function loadSomaticPractice(slug: string): Dict | null {
  if (!SLUG_RE.test(slug)) return null;
  const file = path.join(getCataloguePath(), "somatic_practices", `${slug}.yaml`);
  try {
    const raw = fs.readFileSync(file, "utf8");
    const doc = yaml.load(raw);
    return doc && typeof doc === "object" ? (doc as Dict) : null;
  } catch {
    return null;
  }
}

/**
 * Derive EVERY guided somatic session prescribed on a plan, in plan order.
 *
 * Returns a list, not the first hit: a coach can reasonably link two practices
 * (a morning down-regulator and a bedtime release), and stopping at the first
 * made the second silently invisible — prescribed, listed in the checklist,
 * but with no way to actually do it.
 *
 * A practice that cannot be resolved, or whose catalogue record has no
 * motion_shape yet, is skipped rather than degraded — an unrenderable practice
 * must not reach the client as a broken one.
 */
export function deriveSomatic(
  practices: { id: string; name: string; when: string }[],
  practiceRaw: Dict[],
): AppSomatic[] {
  const out: AppSomatic[] = [];
  for (let i = 0; i < practiceRaw.length; i++) {
    const slug = asStr(practiceRaw[i]?.somatic_practice).trim();
    if (!slug) continue;

    const rec = loadSomaticPractice(slug);
    if (!rec) continue;

    const shape = rec.motion_shape;
    // motion_shape is assigned by the clustering pass over the whole corpus.
    // Unassigned means the app has no player for it — skip rather than guess.
    if (!isMotionShape(shape)) continue;

    const steps: SomaticStep[] = (Array.isArray(rec.steps) ? rec.steps : [])
      .map((s): SomaticStep => {
        const d = (s ?? {}) as Dict;
        return {
          label: asStr(d.label),
          cue: asStr(d.cue),
          secs: asNum(d.secs),
          action: asStr(d.action),
        };
      })
      .filter((s) => s.label || s.cue);

    const timed = rec.timed !== false;
    // A timed player with no steps cannot render. The catalogue validator
    // already errors on this, but the app must not depend on that holding.
    if (timed && steps.length === 0) continue;

    out.push({
      practiceId: practices[i]?.id || asStr(practiceRaw[i]?.id) || `somatic-${i}`,
      sourceIndex: i,
      slug,
      name: asStr(rec.display_name) || slug,
      shape,
      when: practices[i]?.when || asStr(practiceRaw[i]?.cadence) || "Anytime",
      why: clientFacingWhy(rec),
      steps,
      reps: asNum(rec.reps),
      bilateral: rec.bilateral === true,
      timed,
      totalSeconds: asNum(rec.duration_seconds),
      equipment: (Array.isArray(rec.equipment) ? rec.equipment : []).map(asStr).filter(Boolean),
    });
  }
  return out;
}

/**
 * `why_it_works` is written for the coach and carries clinical vocabulary
 * ("vagal tone", "transient lower esophageal sphincter relaxations"). Prefer
 * the plainer `summary` for the client, and fall back only if it is missing.
 */
function clientFacingWhy(rec: Dict): string {
  const summary = asStr(rec.summary).trim();
  if (summary) return summary;
  const why = asStr(rec.why_it_works).trim();
  // first sentence only — the rest is coach detail
  const first = why.split(/(?<=[.!?])\s+/)[0] || "";
  return first;
}

/**
/* ---- the client-facing read ------------------------------------------- */

/** One condition, what the book says about it, and the practice for it. */
export interface AppMindBodyRead {
  /** the map's own client-facing title, e.g. "Constipation — Holding On and
   *  Not Letting Go" — NOT the coach's raw condition string, which carries
   *  clinical shorthand ("ON TREATMENT (previously unreported) — Telma 40") */
  title: string;
  /**
   * The emotional patterns the book associates with this condition — the
   * connect itself. Every note in a `general` map is hedged in the source
   * ("frequently observed association", "an association to explore, not a
   * cause to assert"); that hedging is why they are showable at all.
   */
  roots: { pattern: string; note: string }[];
  /** the belief-level reframe; the kinder way to hold it */
  reframe: string;
  /** the one reflective question, or empty */
  question: string;
  /** the practice for THIS condition, when the coach has prescribed it */
  practice: AppSomatic | null;
  /** catalogue slug of the practice the map names, prescribed or not */
  practiceSlug: string;
}

/**
 * What the client may be shown of the mind-body layer.
 *
 * THREE gates, all of which must permit, and all of which fail closed:
 *
 *  1. the client's `mind_body_depth` is `full`. Absent — which is every client
 *     until the coach says otherwise — shows nothing. This content tells
 *     someone their body may be holding what they will not put down; absent
 *     consent is not consent.
 *  2. the map is `general` AND carries no `coach_only_note`. That withholds 59
 *     of the 123 on its own — recurrent miscarriage, infertility, fibroids.
 *  3. the map has a reframe worth reading. An empty one is not a card.
 *
 * The practice is attached only when the coach actually prescribed it. The
 * reading still stands when she has not: the reframe and the question are the
 * substance, not the button.
 */
export function deriveMindBodyReads(
  depth: string,
  conditions: string[],
  prescribed: AppSomatic[],
): AppMindBodyRead[] {
  if (depth.trim().toLowerCase() !== "full") return [];

  const bySlug = new Map(prescribed.map((p) => [p.slug, p]));
  const out: AppMindBodyRead[] = [];
  for (const r of readChiefComplaints(conditions)) {
    if (!isClientSafe(r)) continue;
    const reframe = r.reframe.trim();
    if (!reframe) continue;
    out.push({
      title: r.displayName || r.condition,
      roots: r.roots.filter((x) => x.pattern.trim()).slice(0, 3),
      reframe,
      question: r.inquiryQuestion.trim(),
      practice: bySlug.get(r.somaticPractice) ?? null,
      practiceSlug: r.somaticPractice,
    });
  }
  return out;
}

/**
 * Remove EVERY slug-linked practice from the lists handed to the NAME-matching
 * derivations (deriveBreathwork / deriveEft / deriveSleep).
 *
 * This is the core of the fix and it is easy to get wrong two ways:
 *
 *  - the two arrays are positionally paired, so both must drop the SAME
 *    indices or every practice after them is silently mismatched with the
 *    wrong raw record;
 *  - the indices must come from `sourceIndex`, not from a slug lookup — two
 *    practices may share a slug, and a lookup would return the first twice.
 */
export function excludeSomaticLinked<T>(
  practices: T[],
  practiceRaw: Dict[],
  somatics: AppSomatic[],
): { practices: T[]; raw: Dict[] } {
  if (!somatics.length) return { practices, raw: practiceRaw };
  const drop = new Set(somatics.map((s) => s.sourceIndex));
  if (!drop.size) return { practices, raw: practiceRaw };
  return {
    practices: practices.filter((_, k) => !drop.has(k)),
    raw: practiceRaw.filter((_, k) => !drop.has(k)),
  };
}
