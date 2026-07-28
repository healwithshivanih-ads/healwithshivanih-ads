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
 * Derive the guided somatic session for a plan.
 *
 * Returns null rather than a degraded card when the practice cannot be
 * resolved, or when the catalogue record has no motion_shape yet — an
 * unrenderable practice must not reach the client as a broken one.
 */
export function deriveSomatic(
  practices: { id: string; name: string; when: string }[],
  practiceRaw: Dict[],
): AppSomatic | null {
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

    return {
      practiceId: practices[i]?.id || asStr(practiceRaw[i]?.id) || `somatic-${i}`,
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
    };
  }
  return null;
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
 * Remove the slug-linked practice from the lists handed to the NAME-matching
 * derivations (deriveBreathwork / deriveEft / deriveSleep).
 *
 * This is the core of the fix and it is easy to get wrong: the two arrays are
 * positionally paired, so both must drop the SAME index or every practice after
 * it is silently mismatched with the wrong raw record.
 */
export function excludeSomaticLinked<T>(
  practices: T[],
  practiceRaw: Dict[],
  somatic: AppSomatic | null,
): { practices: T[]; raw: Dict[] } {
  if (!somatic) return { practices, raw: practiceRaw };
  const i = practiceRaw.findIndex(
    (p) => asStr(p?.somatic_practice).trim() === somatic.slug,
  );
  if (i < 0) return { practices, raw: practiceRaw };
  return {
    practices: practices.filter((_, k) => k !== i),
    raw: practiceRaw.filter((_, k) => k !== i),
  };
}
