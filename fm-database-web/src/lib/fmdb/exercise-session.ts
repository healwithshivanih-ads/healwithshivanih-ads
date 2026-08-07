/**
 * Resolve a plan's exercise sessions into something the client app can render.
 *
 * Mirrors `somatic.ts` deliberately, because the failure it prevents is the
 * same one: a prescription that reaches the client as a degraded or broken
 * version of itself. Everything is resolved BY SLUG against the catalogue, and
 * anything that cannot be rendered honestly is skipped rather than guessed.
 *
 * WHY A SESSION IS ONE PRACTICE ROW. See PracticeItem.exercises in
 * fmdb/plan/models.py. Briefly: Otago is a programme, not eight habits, and the
 * app should open one thing the client works through, not eight checkboxes.
 *
 * ORDER IS THE PRESCRIPTION. The coach's order is preserved exactly — warm-up
 * first, strength last. Nothing here sorts.
 *
 * WHAT IS DELIBERATELY NOT HERE: the suitability screen. By the time a plan is
 * published its exercises have been through the assess gate and plan-check, and
 * re-screening at render time would mean a client's app could silently drop an
 * exercise mid-plan because their record changed — the coach would never know.
 * A change of that kind belongs in front of her, not in a client's app.
 */

import fs from "node:fs";
import path from "node:path";

import yaml from "js-yaml";

import { getCataloguePath } from "./paths";
import { tracedFigureSvg } from "./exercise-figure-traced";
import { exerciseVideoSrc } from "./exercise-video";
import { stepFigureSvgs } from "./exercise-step-figures";

export interface ExerciseStep {
  /** One instruction line. Setup lines come first, then the movement steps. */
  text: string;
  /** true for the setup lines — rendered as "before you start". */
  setup: boolean;
  /**
   * A figure for THIS step, where the entry is a sequence of different
   * movements rather than one movement.
   *
   * Only the warm-up and cool-down have these. Everything else is one movement
   * and its single figure sits above the steps, which is right — repeating it
   * beside every line would add nothing.
   */
  figureSvg?: string | null;
  /** A clip for THIS step, where a still plus an arrow cannot carry it — the
   *  warm-up's trunk turn is axial rotation, which no drawn figure has managed. */
  videoSrc?: string | null;
}

export interface AppExerciseItem {
  slug: string;
  /** What the client is shown. Never `display_name`, which is clinical. */
  name: string;
  /** The dose for the level this client is on, e.g. "5 stands, both hands". */
  prescription: string;
  /** The level label, when the entry has a ladder. */
  level: string | null;
  /** Plain why-it-matters, client-facing. */
  why: string;
  steps: ExerciseStep[];
  /** Coach's per-client note for this exercise, if any. */
  note: string;
  reps: number | null;
  sets: number | null;
  holdSeconds: number | null;
  support: string;
  /** How often THIS one is done, when it differs from the session. Empty means
   *  it follows the session's own cadence. */
  cadence: string;
  /**
   * Traced two-pose figure as a self-contained SVG string, when the exercise
   * has reviewed artwork. Optional and null-safe: the player renders nothing
   * in its place — text instructions are the contract, the figure is a bonus.
   */
  figureSvg?: string | null;
  /**
   * Public URL of a demonstration video, when one exists for this slug.
   *
   * Video exists only for the movements STILLS CANNOT SHOW — axial rotation and
   * the neck movements, where two traced poses read as two near-identical
   * pictures. Where both a video and a traced figure exist the video wins: it
   * is the same movement with the in-between restored.
   */
  videoSrc?: string | null;
  /**
   * What the client needs to have. Surfaced BEFORE they start, never mid-step.
   *
   * This was missing, and it reached a real client: three of the Otago leg
   * exercises need ankle cuff weights, and the app cheerfully told him to
   * "strap the ankle cuff weight around one ankle" as step two of a session he
   * had already begun. Nobody had asked whether he owned any. The safety screen
   * does not check equipment — it screens what a body can take, not what is in
   * the house — so nothing else was ever going to catch it.
   */
  equipment: string[];
}

export interface AppExerciseSession {
  /** Everything the whole session needs, deduped — shown on the intro card so
   *  the client can fetch it (or tell the coach they have not got it) BEFORE
   *  they start rather than discovering it at exercise three. */
  equipment: string[];
  /** The plan practice this came from — the id the app opens it by. */
  practiceId: string;
  /**
   * Index into the plan's practice arrays. Carried, not re-derived: the same
   * reasoning as AppSomatic.sourceIndex — two rows could both be sessions, and
   * finding the index again by name would return the first one twice.
   */
  sourceIndex: number;
  name: string;
  when: string;
  items: AppExerciseItem[];
}

type Dict = Record<string, unknown>;

const asStr = (v: unknown): string => (typeof v === "string" ? v : "");
const asNum = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Slug guard — this value reaches a filesystem path. */
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Read one exercise from the catalogue. Null when absent or malformed. */
export function loadExercise(slug: string): Dict | null {
  if (!SLUG_RE.test(slug)) return null;
  const file = path.join(getCataloguePath(), "exercises", `${slug}.yaml`);
  try {
    const raw = fs.readFileSync(file, "utf8");
    const doc = yaml.load(raw);
    return doc && typeof doc === "object" ? (doc as Dict) : null;
  } catch {
    return null;
  }
}

/**
 * Pick the rung this client is on.
 *
 * An explicit level always wins. With none recorded, fall back to the FIRST
 * (easiest) rung rather than to nothing: the plan-editor's "auto" writes null,
 * and a client shown an exercise with no dose has been told to do an unspecified
 * amount of an exercise — worse than the gentlest version of it.
 *
 * An entry with no ladder at all (pacing, mobility) is not an error. Those carry
 * their dose in `frequency` and the steps themselves.
 */
function pickLevel(entry: Dict, wanted: string | null): Dict | null {
  const levels = asArr(entry.levels) as Dict[];
  if (levels.length === 0) return null;
  if (wanted) {
    const hit = levels.find((l) => asStr(l.level) === wanted);
    if (hit) return hit;
    // A level that is not on this entry's ladder is a data error the checker
    // raises as CRITICAL. Here, in front of the client, the safe reading is the
    // easiest rung — never a blank dose, and never a harder one than asked for.
  }
  return levels[0];
}

/** Setup lines then movement steps, flattened into one ordered list. */
function buildSteps(entry: Dict, slug: string): ExerciseStep[] {
  const out: ExerciseStep[] = [];
  for (const s of asArr(entry.setup)) {
    const text = asStr(s).trim();
    if (text) out.push({ text, setup: true });
  }
  // Indexed against the entry's OWN steps list, before empty lines are dropped,
  // so a blank line in the YAML cannot shift every figure onto the wrong step.
  const raw = asArr(entry.steps);
  const figures = stepFigureSvgs(slug, raw.length);
  raw.forEach((s, i) => {
    const text = asStr(s).trim();
    if (text) {
      const vis = figures?.[i];
      out.push({
        text,
        setup: false,
        ...(vis?.svg ? { figureSvg: vis.svg } : {}),
        ...(vis?.video ? { videoSrc: vis.video } : {}),
      });
    }
  });
  return out;
}

/**
 * Every exercise session prescribed on a plan, in plan order.
 *
 * FAILS CLOSED at each gate, matching deriveSomatic:
 *   - a row with no exercises is not a session
 *   - a slug that does not resolve is dropped from the session
 *   - a session whose every exercise dropped is not returned at all, rather
 *     than returned empty — an empty player is a broken promise
 */
export function deriveExerciseSessions(
  practices: { id: string; name: string; when: string }[],
  practiceRaw: Dict[],
): AppExerciseSession[] {
  const out: AppExerciseSession[] = [];

  for (let i = 0; i < practiceRaw.length; i++) {
    const raw = practiceRaw[i] ?? {};
    const prescribed = asArr(raw.exercises) as Dict[];
    if (prescribed.length === 0) continue;

    const items: AppExerciseItem[] = [];
    for (const p of prescribed) {
      const slug = asStr(p.exercise).trim();
      if (!slug) continue;
      const entry = loadExercise(slug);
      if (!entry) continue;

      const wanted = asStr(p.level).trim() || null;
      const lv = pickLevel(entry, wanted);
      const steps = buildSteps(entry, slug);
      // No steps means nothing to show but a title. The catalogue requires them,
      // but the app must not depend on that holding.
      if (steps.length === 0) continue;

      items.push({
        slug,
        name: asStr(entry.client_name).trim() || asStr(entry.display_name).trim() || slug,
        prescription: lv ? asStr(lv.prescription).trim() : asStr(entry.frequency).trim(),
        level: lv ? asStr(lv.level).trim() || null : null,
        why: asStr(entry.summary).trim(),
        steps,
        note: asStr(p.note).trim(),
        reps: lv ? asNum(lv.reps) : null,
        sets: lv ? asNum(lv.sets) : null,
        holdSeconds: lv ? asNum(lv.hold_seconds) : null,
        support: lv ? asStr(lv.support).trim() : "",
        figureSvg: tracedFigureSvg(slug, {
          title: asStr(entry.client_name).trim() || slug,
        }),
        videoSrc: exerciseVideoSrc(slug),
        cadence: asStr(p.cadence).trim(),
        equipment: asArr(entry.equipment).map((x) => asStr(x).trim()).filter(Boolean),
      });
    }

    if (items.length === 0) continue;

    const prac = practices[i];
    const equipment = [...new Set(items.flatMap((it) => it.equipment))];
    out.push({
      equipment,
      practiceId: prac?.id ?? `p${i}`,
      sourceIndex: i,
      name: prac?.name ?? asStr(raw.name) ?? "Movement session",
      when: prac?.when ?? "",
      items,
    });
  }

  return out;
}

/**
 * Withhold session-linked practices from the name-matching derivations.
 *
 * Identical reasoning to `excludeSomaticLinked`, and the same two traps: both
 * arrays must drop the SAME indices or every practice after them is paired with
 * the wrong raw record, and the indices must come from `sourceIndex` rather than
 * a name lookup.
 *
 * Without this a row called "Movement session" is caught by deriveBreathwork or
 * deriveSleep on wording alone and rendered as a generic session, losing the
 * exercises that ARE the practice — the same failure that made a
 * gastrocolic-rhythm prescription render as plain 4-in/6-out breathing.
 */
export function excludeExerciseLinked<T>(
  practices: T[],
  practiceRaw: Dict[],
  sessions: AppExerciseSession[],
): { practices: T[]; raw: Dict[] } {
  const drop = new Set(sessions.map((s) => s.sourceIndex));
  if (!drop.size) return { practices, raw: practiceRaw };
  return {
    practices: practices.filter((_, k) => !drop.has(k)),
    raw: practiceRaw.filter((_, k) => !drop.has(k)),
  };
}
