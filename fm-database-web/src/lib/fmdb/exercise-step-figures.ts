/**
 * Per-step figures, for the entries that are a SEQUENCE of different movements.
 *
 * Almost every exercise is one movement, so one figure per exercise is right.
 * Two are not: the warm-up is eight named movements and the cool-down is a run
 * of held stretches. Showing one picture beside eight different instructions is
 * how the warm-up ended up playing a clip of a figure standing still while the
 * client read "circle each wrist six to eight times".
 *
 * NOTHING HERE IS NEW ARTWORK, which is the point. Each step borrows a pose from
 * a figure that already exists and has already been reviewed, and supplies its
 * own arrows. The warm-up's eight steps cost nothing to illustrate: three of them
 * are movements the library already has (a one-leg stand, a heel flick, marching
 * on the spot) and the other five are a plain standing body with an arrow on the
 * joint that circles.
 *
 * Server-only, and fails closed exactly like the traced figures it draws from: a
 * missing file, unparseable JSON, an unknown slug or a malformed spec all yield
 * null for that step, and the step renders as text alone.
 */
import fs from "node:fs";
import path from "node:path";

import { getCataloguePath } from "./paths";
import { tracedFigureSvg } from "./exercise-figure-traced";

interface StepFigureSpec {
  /** Figure slug to borrow the pose from. */
  use?: string;
  /** Which pose. Omitted means play that figure's own movement. */
  frame?: number;
  /** Arrows for THIS step, replacing whatever the borrowed figure carries. */
  arrows?: unknown[];
  /**
   * An existing clip, for a step that a still plus an arrow cannot carry.
   *
   * The warm-up's trunk turn is the case: it is axial rotation, the one thing
   * a drawn figure has never managed, and an arc over a front-facing body was
   * read as unclear. `standing-trunk-rotation.mp4` already exists and is that
   * exact movement — the step borrows it rather than anything new being made.
   */
  video?: string;
}

/** What one step shows. At most one of the two is ever set. */
export interface StepVisual {
  svg?: string;
  video?: string;
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Filename only — this reaches a public URL, so no paths and no traversal. */
const VIDEO_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*\.mp4$/;

let cache: Record<string, StepFigureSpec[]> | undefined;

function load(): Record<string, StepFigureSpec[]> {
  if (cache !== undefined) return cache;
  const file = path.join(getCataloguePath(), "_exercise_step_figures.json");
  const out: Record<string, StepFigureSpec[]> = {};
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    for (const [slug, v] of Object.entries(raw)) {
      if (slug.startsWith("_") || !Array.isArray(v)) continue;
      const specs: StepFigureSpec[] = [];
      for (const s of v) {
        if (typeof s !== "object" || s === null) continue;
        const d = s as Record<string, unknown>;
        const useOk = typeof d.use === "string" && SLUG_RE.test(d.use);
        const vidOk = typeof d.video === "string" && VIDEO_RE.test(d.video);
        // one or the other, never both and never neither
        if (useOk === vidOk) continue;
        specs.push({
          ...(useOk ? { use: d.use as string } : {}),
          ...(vidOk ? { video: d.video as string } : {}),
          ...(typeof d.frame === "number" && Number.isInteger(d.frame) && d.frame >= 0
            ? { frame: d.frame }
            : {}),
          ...(Array.isArray(d.arrows) ? { arrows: d.arrows } : {}),
        });
      }
      if (specs.length) out[slug] = specs;
    }
  } catch {
    // fall through to the empty map — every step just renders as text
  }
  cache = out;
  return cache;
}

/** Exposed for tests only. */
export function _resetStepFigureCache(): void {
  cache = undefined;
}

/**
 * One SVG per movement step, aligned to the entry's `steps` array by index.
 * Returns null for this exercise when it has no per-step figures — which is the
 * normal case, and the caller should fall back to the single exercise figure.
 */
export function stepFigureSvgs(slug: string, stepCount: number): (StepVisual | null)[] | null {
  const specs = load()[slug];
  if (!specs) return null;
  const out: (StepVisual | null)[] = [];
  for (let i = 0; i < stepCount; i++) {
    const s = specs[i];
    if (!s) {
      out.push(null);
      continue;
    }
    if (s.video) {
      out.push({ video: `/exercise-videos/${s.video}` });
      continue;
    }
    const svg = s.use
      ? tracedFigureSvg(s.use, {
            title: "",
            // Unique per STEP, not per figure. Five of the warm-up's eight steps
            // borrow the same standing body with different arrows, and an inline
            // SVG's CSS leaks to the whole document — without this they overwrite
            // each other's rules and most of them vanish.
            uid: `${slug}-${i}`,
            ...(s.frame !== undefined ? { frame: s.frame } : {}),
            ...(s.arrows !== undefined ? { arrows: s.arrows } : {}),
          })
      : null;
    out.push(svg ? { svg } : null);
  }
  // If every one failed to resolve there is nothing to show; say so rather than
  // handing back a list of nulls the caller has to re-check.
  return out.some(Boolean) ? out : null;
}

export function hasStepFigures(slug: string): boolean {
  return Boolean(load()[slug]);
}
