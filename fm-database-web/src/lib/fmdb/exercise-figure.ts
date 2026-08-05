/**
 * Deterministic diagram figures for exercise entries.
 *
 * WHY NOT A PHOTO OR A GENERATED IMAGE. Exercise figures have to communicate
 * FORM, and form is exactly where image models are subtly wrong — a knee that
 * tracks inward, a lumbar spine rounded under load. A client cannot tell a
 * wrong picture from a right one, and a picture overrides the text cues beside
 * it, so a plausible-but-wrong figure is worse than none. A diagram makes a
 * weaker claim and keeps it: this is the position, this is where the work is.
 *
 * Everything here is computed from fields the entry already carries — position,
 * joint_stress, balance_demand. No per-entry art, so a new exercise gets a
 * figure for free and 40 figures cannot drift into 40 different styles.
 *
 * Colours are CSS custom properties so the figure themes with the app in both
 * light and dark; nothing here hard-codes a palette.
 */

/** Side-agnostic regions, matching fmdb.enums.ExerciseBodyRegion. */
export type FigureRegion =
  | "neck" | "shoulder" | "elbow" | "wrist_hand" | "upper_back" | "mid_back"
  | "lower_back" | "sacrum_pelvis" | "hip" | "thigh" | "knee" | "calf"
  | "ankle_foot" | "chest" | "abdomen" | "whole_body";

export type FigurePosition =
  | "seated" | "standing" | "lying_supine" | "lying_prone" | "side_lying"
  | "four_point" | "walking" | "any_position";

/** Where each region sits on the 100x200 figure canvas. */
const REGION_POINTS: Record<Exclude<FigureRegion, "whole_body">, [number, number][]> = {
  neck: [[50, 34]],
  shoulder: [[34, 46], [66, 46]],
  elbow: [[27, 76], [73, 76]],
  wrist_hand: [[24, 101], [76, 101]],
  chest: [[50, 58]],
  upper_back: [[50, 52]],
  mid_back: [[50, 68]],
  lower_back: [[50, 84]],
  abdomen: [[50, 78]],
  sacrum_pelvis: [[50, 96]],
  hip: [[38, 100], [62, 100]],
  thigh: [[40, 124], [60, 124]],
  knee: [[40, 146], [60, 146]],
  calf: [[41, 166], [59, 166]],
  ankle_foot: [[42, 184], [58, 184]],
};

/** Joint dots that make the stick figure read as a body rather than lines. */
const JOINTS: [number, number][] = [
  [34, 46], [66, 46], [27, 76], [73, 76], [38, 100], [62, 100], [40, 146], [60, 146],
];

const line = (x1: number, y1: number, x2: number, y2: number) =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" />`;

/**
 * Positions drawn from the front, on the canonical upright body.
 *
 * WHY THIS SPLIT EXISTS. `REGION_POINTS` is a single fixed map of where each
 * body region sits on the canvas, and it only holds for an upright front view.
 * Draw a reclined body and the highlight for "knee" lands in mid-air — a
 * diagram confidently pointing at the wrong place, which is precisely the
 * failure mode this whole approach was chosen to avoid. So upright positions
 * share one skeleton and get highlights; reclined positions get their own
 * skeleton and NO highlights, with the regions listed as text instead.
 */
const UPRIGHT: ReadonlySet<FigurePosition> = new Set([
  "standing", "seated", "walking", "any_position",
]);

/** The one canonical body. Every upright position uses it unchanged, so a
 *  highlight means the same thing on every figure in the library.
 *
 *  Split into named groups so a motion can drive ONE limb. The geometry is
 *  byte-identical to the flat version — only the grouping is new. */
function uprightBody(): string {
  return [
    `<g class="fx-trunk">`,
    line(50, 34, 50, 100),                          // spine
    line(34, 46, 66, 46),                           // shoulders
    line(34, 46, 27, 76), line(27, 76, 24, 101),    // left arm
    line(66, 46, 73, 76), line(73, 76, 76, 101),    // right arm
    `</g>`,
    // Each leg pivots at the hip it hangs from, so a transform on the group is
    // rotation about the real joint rather than a slide.
    `<g class="fx-leg fx-leg--l" style="transform-origin:40px 100px">`,
    line(50, 100, 40, 146), line(40, 146, 41, 184),
    `</g>`,
    `<g class="fx-leg fx-leg--r" style="transform-origin:60px 100px">`,
    line(50, 100, 60, 146), line(60, 146, 59, 184),
    `</g>`,
  ].join("");
}

/** Reclined skeletons. Unused by the current tranche, kept so a floor-based
 *  entry renders honestly rather than as a standing figure. */
function reclinedBody(position: FigurePosition): string {
  switch (position) {
    case "four_point":
      return [
        line(28, 96, 76, 96),
        line(28, 96, 24, 132), line(76, 96, 80, 132),
        line(48, 96, 46, 132), line(60, 96, 62, 132),
        `<line x1="12" y1="134" x2="96" y2="134" stroke-dasharray="4 4" opacity="0.45" />`,
      ].join("");
    case "side_lying":
      return [
        line(20, 96, 84, 96),
        line(50, 96, 64, 118), line(64, 118, 78, 112),
        `<line x1="12" y1="118" x2="96" y2="118" stroke-dasharray="4 4" opacity="0.45" />`,
      ].join("");
    default: // lying_supine | lying_prone
      return [
        line(20, 100, 84, 100),
        line(84, 100, 92, 118), line(84, 100, 92, 82),
        `<line x1="12" y1="118" x2="96" y2="118" stroke-dasharray="4 4" opacity="0.45" />`,
      ].join("");
  }
}

/**
 * Context glyphs — how an upright figure says "seated" or "walking" without
 * moving a single joint. A chair drawn around the body carries the position
 * more reliably than bent limbs do at this size, and it costs no accuracy.
 */
function contextGlyph(position: FigurePosition): string {
  switch (position) {
    case "seated":
      return `<g stroke-dasharray="3 3" opacity="0.55">` +
        line(26, 60, 26, 150) +      // chair back
        line(26, 106, 78, 106) +     // seat
        line(78, 106, 78, 150) +     // front leg
        line(26, 150, 78, 150) +     // base
        `</g>`;
    case "walking":
      // Motion ticks behind the figure — direction of travel, no limb change.
      return `<g opacity="0.4">` +
        line(14, 120, 24, 120) + line(10, 134, 22, 134) + line(16, 148, 26, 148) +
        `</g>`;
    default:
      return "";
  }
}

/** Ground line — omitted when the figure is already lying on one. */
function ground(position: FigurePosition): string {
  if (!UPRIGHT.has(position)) return "";
  return `<line x1="10" y1="190" x2="90" y2="190" stroke-dasharray="4 4" opacity="0.45" />`;
}

/**
 * Balance demand, drawn as sway arcs beside the figure rather than as a number.
 * 0 draws nothing, so a seated exercise carries no visual noise.
 */
function swayMarks(demand: number): string {
  if (!demand || demand < 1) return "";
  const arcs = Math.min(demand, 3);
  return Array.from({ length: arcs }, (_, i) => {
    const r = 8 + i * 5;
    return `<path d="M ${50 - r} 24 A ${r} ${r} 0 0 1 ${50 + r} 24" fill="none" opacity="${0.5 - i * 0.12}" />`;
  }).join("");
}

/**
 * How a figure moves. DERIVED from fields the entry already carries — never
 * authored per entry, for the same reason `motion_shape` on somatic practices
 * is derived by clustering: a per-entry guess was wrong at 87 entries and wrong
 * again at 123.
 *
 * ⚠ THE VIEW CONSTRAINS THIS. The figure is drawn front-on, so only
 * frontal-plane and vertical movements are honestly animatable. Seated knee
 * extension and standing knee flexion are pure sagittal-plane — front-on you
 * would see a leg that does not move, or worse, a leg invented into moving.
 * Those stay `none`. Silence is the correct output when the view cannot show
 * the movement; it is the same reason reclined figures get no highlights.
 */
export type ExerciseMotion = "abduct" | "hold" | "none";

export interface DeriveMotionInput {
  modality?: string;
  position?: string;
  jointStress?: string[];
  balanceDemand?: number;
  holdSeconds?: number | null;
}

export function deriveMotion(x: DeriveMotionInput): ExerciseMotion {
  // A held position is a hold, whatever else is true of it.
  if (x.holdSeconds && x.holdSeconds > 0) return "hold";
  const stress = new Set(x.jointStress ?? []);
  // Hip work, standing, from the front: the leg travels sideways in the plane
  // we are drawing. The one movement in the current tranche the view can show
  // without inventing anything.
  if (x.modality === "strength" && x.position === "standing" && stress.has("hip") && !stress.has("knee")) {
    return "abduct";
  }
  return "none";
}

export interface ExerciseFigureOptions {
  position?: string;
  jointStress?: string[];
  balanceDemand?: number;
  /** Accessible description. Falls back to a generated one. */
  title?: string;
  /**
   * Animate the figure. OFF by default — at the 32px used in the coach's
   * suitability rows, motion is noise rather than information, and a page of
   * eighteen twitching diagrams is worse than a page of still ones.
   */
  animate?: boolean;
  /** Seconds the position is held. Drives the countdown ring. */
  holdSeconds?: number | null;
  /** Override the derived motion. Escape hatch; prefer fixing the derivation. */
  motion?: ExerciseMotion;
  /** Modality, used only to derive the motion. */
  modality?: string;
  /** Seconds out / seconds back. Defaults are Otago's stated tempo for the
   *  strengthening exercises: two to three seconds to lift, four to five to
   *  lower. Not invented — see otago-exercise-programme-2003, p15. */
  tempoOutSecs?: number;
  tempoBackSecs?: number;
}

/**
 * Build a standalone SVG string for one exercise.
 *
 * Returns markup only — no React, so the same function can serve the coach UI,
 * a letter, or a future client app without three implementations drifting.
 */
export function exerciseFigureSvg(opts: ExerciseFigureOptions): string {
  const position = (opts.position || "standing") as FigurePosition;
  const demand = opts.balanceDemand ?? 0;
  const regions = (opts.jointStress ?? []) as FigureRegion[];

  const upright = UPRIGHT.has(position);

  // Highlights only where REGION_POINTS is valid. On a reclined figure the map
  // does not apply, and a dot in the wrong place is worse than no dot.
  const points = !upright
    ? []
    : regions.includes("whole_body")
      ? Object.values(REGION_POINTS).flat()
      : regions.flatMap((r) => REGION_POINTS[r as Exclude<FigureRegion, "whole_body">] ?? []);

  const highlights = points
    .map(([x, y]) =>
      `<circle cx="${x}" cy="${y}" r="7" class="fx-hot" />` +
      `<circle cx="${x}" cy="${y}" r="3.2" class="fx-hot-core" />`)
    .join("");

  const joints = upright
    ? JOINTS.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2" class="fx-joint" />`).join("")
    : "";
  const head = upright
    ? `<circle cx="50" cy="22" r="10" class="fx-head" />`
    : position === "four_point"
      ? `<circle cx="22" cy="92" r="7" class="fx-head" />`
      : `<circle cx="14" cy="96" r="8" class="fx-head" />`;

  const label = opts.title
    || `Diagram: ${position.replace(/_/g, " ")} position` +
       (regions.length ? `, work at the ${regions.join(", ").replace(/_/g, " ")}` : "");

  const hold = opts.holdSeconds ?? null;
  const motion = opts.animate
    ? (opts.motion ?? deriveMotion({
        modality: opts.modality, position: opts.position,
        jointStress: opts.jointStress, balanceDemand: demand, holdSeconds: hold,
      }))
    : "none";

  const out = opts.tempoOutSecs ?? 2.5;   // Otago: 2-3 s to lift
  const back = opts.tempoBackSecs ?? 4.5; // Otago: 4-5 s to lower
  const cycle = out + back;

  // The countdown ring: circumference of r=46 is ~289. Depleting the dash over
  // exactly holdSeconds means the ring IS the prescription, not a decoration.
  const ring = hold && hold > 0
    ? `<circle class="fx-ring-track" cx="50" cy="108" r="46" />` +
      `<circle class="fx-ring" cx="50" cy="108" r="46" />`
    : "";

  const cls = ["fm-exercise-figure", motion !== "none" ? `is-${motion}` : ""].filter(Boolean).join(" ");
  const vars = [
    motion === "abduct" ? `--cyc:${cycle}s` : "",
    hold ? `--hold:${hold}s` : "",
  ].filter(Boolean).join(";");

  // Styles are inline so the SVG is self-contained wherever it is embedded.
  return `<svg viewBox="0 0 100 200" role="img" aria-label="${escapeAttr(label)}" class="${cls}"${vars ? ` style="${vars}"` : ""}>
<style>
.fm-exercise-figure { width: 100%; height: auto; }
.fm-exercise-figure .fx-body { stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; fill: none; opacity: 0.85; }
.fm-exercise-figure .fx-head { stroke: currentColor; stroke-width: 2.4; fill: none; opacity: 0.85; }
.fm-exercise-figure .fx-joint { fill: currentColor; opacity: 0.55; }
.fm-exercise-figure .fx-hot { fill: var(--fm-terracotta, #B85C3E); opacity: 0.20; }
.fm-exercise-figure .fx-hot-core { fill: var(--fm-terracotta, #B85C3E); opacity: 0.85; }
.fm-exercise-figure .fx-sway { stroke: var(--fm-terracotta, #B85C3E); stroke-width: 1.6; stroke-linecap: round; }
.fm-exercise-figure .fx-ring-track { fill: none; stroke: currentColor; stroke-width: 1.6; opacity: 0.14; }
.fm-exercise-figure .fx-ring { fill: none; stroke: var(--fm-terracotta, #B85C3E); stroke-width: 2.6;
  stroke-linecap: round; stroke-dasharray: 289; transform: rotate(-90deg); transform-origin: 50px 108px; }
/* The leg travels out and comes back slower, about the real hip joint. The
   keyframe stop is fixed at 36% because a CSS keyframe SELECTOR cannot take a
   var() — the per-entry tempo rides on animation-duration (--cyc) instead, and
   36% is out:back = 2.5:4.5, Otago's stated lift:lower ratio. */
@keyframes fx-abduct { 0%, 100% { transform: rotate(0deg); } 36% { transform: rotate(-26deg); } }
@keyframes fx-ring { from { stroke-dashoffset: 0; } to { stroke-dashoffset: 289; } }
.fm-exercise-figure.is-abduct .fx-leg--l { animation: fx-abduct var(--cyc, 7s) ease-in-out infinite; }
.fm-exercise-figure .fx-ring { animation: fx-ring var(--hold, 30s) linear infinite; }
@media (prefers-reduced-motion: reduce) {
  .fm-exercise-figure .fx-leg--l, .fm-exercise-figure .fx-ring { animation: none; }
  .fm-exercise-figure .fx-ring { stroke-dashoffset: 72; }
}
</style>
<g class="fx-body">${contextGlyph(position)}${upright ? uprightBody() : reclinedBody(position)}${ground(position)}</g>
${head}
<g class="fx-sway">${swayMarks(demand)}</g>
${joints}
${highlights}
${ring}
</svg>`;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
