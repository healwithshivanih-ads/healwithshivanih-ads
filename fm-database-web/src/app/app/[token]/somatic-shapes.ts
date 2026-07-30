/* ======================================================================
   The seven somatic players — pure canvas drawing, no React.

   Kept separate from the overlay so each shape can be rendered and looked at
   on its own. They had never actually been viewed before this pass: the code
   compiled, the tests passed, and every one drew something — but a client who
   won't sit through it might as well not have been prescribed it.

   The thing that made the difference is compositing. Drawn source-over, warm
   translucent circles on a warm dark ground turn to mud — the effort shapes
   looked like a coffee ring. Every luminous element here is drawn with
   `lighter` (additive), so light behaves like light: it accumulates where it
   overlaps, and the ground shows through instead of being painted over.

   Shared language, so seven players read as one system:

     · warm ground, never black — this is the Ochre Tree, not a meditation app
     · soft light, no hard specular; the highlight sits above-left
     · sage for settling, ochre/amber for effort, gold for release
     · nothing moves quickly, and nothing moves mechanically

   Deterministic throughout — no Math.random, so a shape can be compared
   against itself after a change.
   ====================================================================== */

import type { MotionShape } from "@/lib/fmdb/somatic";

/* ---- palette --------------------------------------------------------- */
export const SAGE = "#7fc79f";
export const GLOW = "#dff3e4";
export const WARM = "#ffd8a0";
export const OCH = "#f0a03c";
export const EMBER = "#ff9d5c";

export function rgba(hex: string, a: number) {
  const h = hex.replace("#", "");
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a))})`;
}

/* ---- easing ---------------------------------------------------------- */
const clamp01 = (p: number) => Math.min(Math.max(p, 0), 1);
export const ease = (p: number) => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(p));
export const easeOut = (p: number) => 1 - Math.pow(1 - clamp01(p), 3);
export const easeIn = (p: number) => clamp01(p) ** 3;

/** Deterministic stand-in for Math.random — stable across frames and mounts. */
const rnd = (i: number, salt = 0) => {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

export type Ctx = CanvasRenderingContext2D;

/** What the current step is doing, so a shape can respond to it. */
export interface Frame {
  /** 0..1 through the current step */
  p: number;
  /** seconds elapsed overall — drives ambient motion */
  t: number;
  action: string;
  bilateral: boolean;
}

export type Renderer = (c: Ctx, w: number, h: number, f: Frame) => void;

/* ---- shared parts ---------------------------------------------------- */

/** Everything luminous goes through here. Additive, so light adds up. */
function light(c: Ctx, draw: () => void) {
  c.save();
  c.globalCompositeOperation = "lighter";
  draw();
  c.restore();
}

/**
 * A soft point of light: falls off smoothly, never has an edge.
 *
 * Five stops approximating a gaussian, not three. Three banded visibly once
 * the layers started adding up — the breath orb picked up contour rings that
 * looked like a printing fault.
 */
function glow(c: Ctx, x: number, y: number, r: number, tint: string, a: number) {
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(tint, a));
  g.addColorStop(0.2, rgba(tint, a * 0.72));
  g.addColorStop(0.42, rgba(tint, a * 0.36));
  g.addColorStop(0.66, rgba(tint, a * 0.13));
  g.addColorStop(0.85, rgba(tint, a * 0.035));
  g.addColorStop(1, rgba(tint, 0));
  c.beginPath();
  c.arc(x, y, r, 0, 7);
  c.fillStyle = g;
  c.fill();
}

/**
 * A disc of light: even across most of its face, soft only at the rim.
 *
 * `glow` cannot do this — its energy is concentrated at the centre, so an orb
 * built only from glows had no body at all, just a hotspot in a haze.
 */
function disc(c: Ctx, x: number, y: number, r: number, tint: string, a: number) {
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(tint, a));
  g.addColorStop(0.55, rgba(tint, a * 0.92));
  g.addColorStop(0.78, rgba(tint, a * 0.6));
  g.addColorStop(0.9, rgba(tint, a * 0.28));
  g.addColorStop(1, rgba(tint, 0));
  c.beginPath();
  c.arc(x, y, r, 0, 7);
  c.fillStyle = g;
  c.fill();
}

/**
 * A body of light — a wide halo, a defined body, and a soft highlight.
 *
 * The highlight is only slightly off-centre and only slightly brighter. At the
 * first attempt it sat a third of the radius up and left at high alpha, which
 * made the orb read as a lit egg rather than something glowing from within.
 */
function orb(c: Ctx, x: number, y: number, r: number, tint: string, core: string, a = 1) {
  glow(c, x, y, r * 2.4, tint, 0.11 * a);
  disc(c, x, y, r, tint, 0.3 * a);
  glow(c, x - r * 0.14, y - r * 0.16, r * 0.62, core, 0.17 * a);
}

/**
 * A ring of light. Two passes — a wide dim band and a narrow bright line —
 * because a single 1px stroke reads as radar, not as breath.
 */
function ringOfLight(c: Ctx, x: number, y: number, r: number, tint: string, a: number) {
  if (r <= 0 || a <= 0) return;
  c.beginPath();
  c.arc(x, y, r, 0, 7);
  c.strokeStyle = rgba(tint, a * 0.34);
  c.lineWidth = 9;
  c.stroke();
  c.beginPath();
  c.arc(x, y, r, 0, 7);
  c.strokeStyle = rgba(tint, a);
  c.lineWidth = 1.6;
  c.stroke();
}

/**
 * Warm ambient wash so no shape sits on a dead rectangle.
 *
 * The radius must reach zero INSIDE the canvas. At max(w,h) * 0.75 it was
 * still faintly tinted in the corners, and since the canvas sits on the
 * overlay's own gradient that showed up full-screen as a visible square seam
 * around the animation. min(w,h) * 0.46 is always shorter than the corner
 * distance, so the canvas edge is genuinely transparent.
 */
function ground(c: Ctx, w: number, h: number, t: number, tint: string) {
  const cx = w / 2, cy = h * 0.46;
  const drift = 1 + 0.035 * Math.sin(t * 0.21);
  const g = c.createRadialGradient(cx, cy, 0, cx, cy, Math.min(w, h) * 0.46 * drift);
  g.addColorStop(0, rgba(tint, 0.075));
  g.addColorStop(0.5, rgba(tint, 0.03));
  g.addColorStop(1, rgba(tint, 0));
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
}

/** A point of light with a defined centre — a glow alone reads out-of-focus. */
function mote(c: Ctx, x: number, y: number, r: number, tint: string, core: string, a: number) {
  glow(c, x, y, r, tint, a);
  glow(c, x, y, r * 0.22, core, a * 1.5);
}

/* ---- 1. breath_excursion --------------------------------------------- */
/* An orb that opens and closes on the breath, with rings that travel outward
   as she fills and draw back in as she lets go, so the movement is legible
   even at the edge of vision. */
function drawBreath(c: Ctx, w: number, h: number, f: Frame) {
  ground(c, w, h, f.t, SAGE);
  const cx = w / 2, cy = h * 0.46, R = Math.min(w, h) * 0.23;

  let scale: number;
  let out: number; // ring travel direction
  // `press` is an exhale too — gastrocolic-rhythm's is "exhale with gentle
  // pressure", and without it here that practice's whole out-breath fell
  // through to the ambient wobble and never contracted.
  if (f.action === "expand") { scale = 0.5 + 0.5 * ease(f.p); out = 1; }
  else if (f.action === "release" || f.action === "shrink" || f.action === "press") {
    scale = 1 - 0.5 * ease(f.p); out = -1;
  }
  else if (f.action === "hold") { scale = 1 + 0.014 * Math.sin(f.t * 1.6); out = 0; }
  else { scale = 0.76 + 0.08 * Math.sin(f.t * 0.7); out = 0; }

  const r = R * scale;

  light(c, () => {
    // travelling rings — out as she fills, in as she lets go
    for (let i = 0; i < 3; i++) {
      const phase = (f.t * 0.28 + i / 3) % 1;
      const trav = out >= 0 ? phase : 1 - phase;
      ringOfLight(c, cx, cy, r * (1.14 + trav * 1.0), GLOW, (1 - phase) * 0.2 * (out === 0 ? 0.5 : 1));
    }

    // two slow off-centre swells — organic, without the banding six lobes gave
    for (let i = 0; i < 2; i++) {
      const a = f.t * 0.09 + i * Math.PI;
      glow(c, cx + Math.cos(a) * r * 0.28, cy + Math.sin(a) * r * 0.22, r * 1.25, SAGE, 0.07);
    }

    orb(c, cx, cy, r, SAGE, GLOW, 1.25);

    // a warm edge as she lets go — the only warmth in a cool shape
    if (out < 0) ringOfLight(c, cx, cy, r * 1.03, WARM, 0.34 * ease(f.p));
  });
}

/* ---- 2. continuous_travel -------------------------------------------- */
/* A light travelling a path, trailing a comet tail. Additive overlap is what
   makes the tail read as one continuous ribbon rather than a dotted line.
   Bilateral runs two, opposed, in two tints so they stay distinguishable. */
function drawTravel(c: Ctx, w: number, h: number, f: Frame) {
  ground(c, w, h, f.t, SAGE);
  const cx = w / 2, cy = h * 0.46;
  const rx = Math.min(w, h) * 0.3, ry = Math.min(w, h) * 0.22;

  const runs = f.bilateral
    ? [
        { dir: 1, tint: SAGE, core: GLOW, off: 0 },
        { dir: -1, tint: EMBER, core: WARM, off: Math.PI },
      ]
    : [{ dir: 1, tint: SAGE, core: GLOW, off: 0 }];

  c.save();
  c.translate(cx, cy);
  c.rotate(-0.16);

  light(c, () => {
    // the track, faintly lit so the path is readable before the head arrives
    c.beginPath();
    c.ellipse(0, 0, rx, ry, 0, 0, 7);
    c.strokeStyle = rgba(GLOW, 0.07);
    c.lineWidth = 1.6;
    c.stroke();

    const SEG = 34;
    for (const run of runs) {
      const at = (i: number) => {
        const a = (f.t * 0.4 - i * 0.0135) * Math.PI * 2 * run.dir + run.off;
        return { x: Math.cos(a) * rx, y: Math.sin(a) * ry };
      };
      // tail: overlapping soft points, brightest at the head
      for (let i = SEG; i > 0; i--) {
        const q = 1 - i / SEG;
        const pt = at(i);
        glow(c, pt.x, pt.y, 5 + 13 * q, run.tint, 0.16 * q * q + 0.03 * q);
      }
      const head = at(0);
      orb(c, head.x, head.y, 15, run.tint, run.core, 1.15);
      glow(c, head.x, head.y, 4.6, "#ffffff", 0.75);
    }
  });
  c.restore();
}

/* ---- 3. release ------------------------------------------------------- */
/* Something held that lets go.

   The first attempt ran the whole thing off `p`: everything loosened, fell and
   faded, which meant the last two-thirds of the step was an empty frame — the
   client is still lying there letting go, and the screen has finished. So the
   motes cycle continuously off `t` instead, each on its own phase, and `p`
   drives how MUCH is being released rather than whether anything is. There is
   always something in flight, and it builds. */
const MOTES = 22;
function drawRelease(c: Ctx, w: number, h: number, f: Frame) {
  ground(c, w, h, f.t, WARM);
  const cx = w / 2, cy = h * 0.31, R = Math.min(w, h) * 0.15;
  // how open she is — a trickle at first, a real release by the end
  const openness = 0.34 + 0.66 * ease(f.p);

  light(c, () => {
    // where it lands
    glow(c, cx, h * 0.88, w * 0.5, EMBER, 0.1 * openness);

    // the held form, loosening — never fully gone, she is still holding a shape
    const loose = 1 + 0.28 * openness;
    orb(c, cx, cy, R * loose, EMBER, WARM, 0.85 - 0.25 * openness);

    for (let i = 0; i < MOTES; i++) {
      // own speed and phase, so the fall is a stream rather than a volley
      const sp = 0.16 + rnd(i, 3) * 0.2;
      const o = (f.t * sp + rnd(i, 4)) % 1;

      const a0 = rnd(i) * Math.PI * 2;
      const rad = Math.pow(rnd(i, 1), 0.5);
      const sway = (rnd(i, 2) - 0.5) * 2;

      const x =
        cx + Math.cos(a0) * R * rad * (1 + o * 1.5) + sway * o * 34 + Math.sin(f.t * 0.7 + i) * o * 8;
      const y = cy + Math.sin(a0) * R * rad + easeIn(o) * h * 0.58 * (0.7 + rnd(i, 5) * 0.6);

      // fade in as it leaves, out as it lands — nothing pops into existence
      const life = Math.min(o / 0.12, 1) * (1 - easeIn(clamp01((o - 0.45) / 0.55)));
      const size = 8 + 10 * rad;

      mote(c, x, y, size, i % 3 === 0 ? GLOW : WARM, GLOW, 0.3 * life * openness);
    }
  });
}

/* ---- 4 & 5. the two effort shapes ------------------------------------- */
/* One meter, two endings. sustained_pressure fills and stays — the point is
   that it does NOT let go. load_release fills, then snaps, and the snap IS
   the practice, so it gets a flash, ripples and a scatter. */
function meter(c: Ctx, w: number, h: number, f: Frame, snap: boolean) {
  ground(c, w, h, f.t, OCH);
  const cx = w / 2, cy = h * 0.46, R = Math.min(w, h) * 0.25;

  const loading =
    f.action === "press" || f.action === "hold" || f.action === "squeeze" || f.action === "tense";
  const releasing = f.action === "release" || f.action === "drop" || f.action === "soften";

  let fill = loading ? easeIn(f.p) : 1;
  let strain = loading ? Math.pow(f.p, 3) : 1;
  let rel = -1;
  if (snap && releasing) { fill = 0; rel = f.p; strain = 0; }
  if (!loading && !releasing) { fill = 0.6; strain = 0.3; }

  // a fine tremor under load — enough to feel effort, not enough to look broken
  const tremor = strain * 0.9 * Math.sin(f.t * 26) * (snap ? 1 : 0.5);

  c.save();
  c.translate(cx + tremor, cy);
  light(c, () => {
    if (rel >= 0) {
      // The snap IS the practice, so it gets the whole step rather than a
      // spike at the front: the ripples travel over the full release, and
      // stop short of the canvas edge instead of flying off it — expanding to
      // 3× R put them outside the frame within the first second, which is why
      // this shape looked like an empty ring for most of its duration.
      const flash = Math.pow(1 - clamp01(rel * 2), 2);
      if (flash > 0) {
        glow(c, 0, 0, R * (1 + rel * 1.4), WARM, 0.55 * flash);
        glow(c, 0, 0, R * 0.5, "#ffffff", 0.55 * flash);
      }
      for (let i = 0; i < 3; i++) {
        const rp = clamp01(rel * (1 + i * 0.28));
        if (rp <= 0 || rp >= 1) continue;
        const rr = R * (0.85 + easeOut(rp) * (0.95 + i * 0.28));
        // a soft bloom under each ripple, so it reads as light and not as wire
        glow(c, 0, 0, rr * 1.06, i === 0 ? WARM : EMBER, (1 - rp) * 0.05);
        c.beginPath();
        c.arc(0, 0, rr, 0, 7);
        c.strokeStyle = rgba(i === 0 ? WARM : EMBER, (1 - rp) * (0.8 - i * 0.18));
        c.lineWidth = (1 - rp) * (4.5 - i * 1) + 0.4;
        c.stroke();
      }
      // the core, softening and fading rather than vanishing on the flash
      orb(c, 0, 0, R * (0.55 + easeOut(rel) * 0.5), WARM, GLOW, (1 - rel) ** 1.3 * 0.75);
      // what was held, thrown outward
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 + rnd(i, 5);
        const d = R * (0.65 + easeOut(rel) * 1.15) * (0.78 + rnd(i, 6) * 0.44);
        glow(c, Math.cos(a) * d, Math.sin(a) * d, 12, WARM, 0.42 * (1 - rel) ** 1.5);
      }
    }

    // pressure held: arcs pressing inward, brightening as she sustains it
    if (!snap && fill > 0.15) {
      for (let i = 0; i < 3; i++) {
        const push = 1.6 - 0.28 * i - ease(clamp01(f.p * 1.2)) * 0.36;
        c.beginPath();
        c.arc(0, 0, R * push, -Math.PI * 0.42 + i * 2.1, -Math.PI * 0.42 + i * 2.1 + 1.2);
        c.strokeStyle = rgba(EMBER, 0.13 + 0.2 * fill);
        c.lineWidth = 2.2;
        c.lineCap = "round";
        c.stroke();
      }
    }

    if (fill > 0) {
      const col = strain > 0.6 ? WARM : OCH;
      // the arc, with its own bloom — reads as a filling band of light
      c.beginPath();
      c.arc(0, 0, R, -Math.PI / 2, -Math.PI / 2 + fill * Math.PI * 2);
      c.strokeStyle = rgba(col, 0.16 + 0.1 * strain);
      c.lineWidth = 20;
      c.lineCap = "round";
      c.stroke();

      c.beginPath();
      c.arc(0, 0, R, -Math.PI / 2, -Math.PI / 2 + fill * Math.PI * 2);
      c.strokeStyle = rgba(col, 0.75 + 0.2 * strain);
      c.lineWidth = 6;
      c.lineCap = "round";
      c.stroke();

      // the core warms as the load builds — kept dim so it never goes muddy
      glow(c, 0, 0, R * 0.92, col, 0.1 + 0.16 * fill * (0.4 + 0.6 * strain));
    }
  });

  // the unfilled track sits under the light, not in it
  c.globalCompositeOperation = "source-over";
  c.beginPath();
  c.arc(0, 0, R, 0, 7);
  c.strokeStyle = "rgba(255,255,255,.055)";
  c.lineWidth = 6;
  c.stroke();
  c.restore();
}

/* ---- 6. still --------------------------------------------------------- */
/* Almost nothing happens, on purpose. Layered light breathing very slowly,
   with a few motes holding their orbits. */
function drawStill(c: Ctx, w: number, h: number, f: Frame) {
  ground(c, w, h, f.t, SAGE);
  const cx = w / 2, cy = h * 0.46, R = Math.min(w, h) * 0.3;
  const b = 0.5 + 0.5 * Math.sin(f.t * 0.26);

  light(c, () => {
    for (let i = 4; i >= 1; i--) {
      const rr = R * (0.4 + i * 0.23) * (1 + b * 0.035);
      const dx = Math.sin(f.t * 0.13 + i) * R * 0.045;
      const dy = Math.cos(f.t * 0.11 + i * 1.7) * R * 0.045;
      glow(c, cx + dx, cy + dy, rr, i % 2 ? SAGE : WARM, 0.05 + 0.022 * b);
    }

    orb(c, cx, cy, R * 0.19 * (1 + b * 0.08), SAGE, GLOW, 0.9);

    for (let i = 0; i < 5; i++) {
      const rr = R * (0.62 + rnd(i, 7) * 0.4);
      const a = f.t * (0.05 + rnd(i, 8) * 0.045) + rnd(i, 9) * 7;
      mote(c, cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.82, 8, SAGE, GLOW, 0.2);
    }
  });
}

/* ---- registry --------------------------------------------------------- */
/* checklist has no player by design — its steps are ticked off, not paced. */
export const SHAPE_RENDERERS: Partial<Record<MotionShape, Renderer>> = {
  breath_excursion: drawBreath,
  continuous_travel: drawTravel,
  release: drawRelease,
  still: drawStill,
  load_release: (c, w, h, f) => meter(c, w, h, f, true),
  sustained_pressure: (c, w, h, f) => meter(c, w, h, f, false),
};

export const FALLBACK_RENDERER: Renderer = drawStill;

/* ---- pacing a long step ------------------------------------------------ */
/*
   Nearly every breathing practice in the catalogue has the same shape: it
   demonstrates one cycle in short steps, then hands the client a single long
   step that says "repeat". box-breathing spells it out — 4s inhale, 4s hold,
   4s exhale, 4s hold, then `Repeat the cycle` for 264 SECONDS.

   Driven from the step's own progress, that last step renders as one
   four-and-a-half-minute inhalation. The client is told to keep breathing and
   the orb does nothing they can follow. 20 of the 28 breath practices carry a
   step of 90s or more.

   The cadence is already in the data, so nothing here is invented: the short
   paced steps ARE the cycle, and a long step replays them.
*/

export interface CycleStep {
  action: string;
  secs: number;
}

/** Actions that make a body move in and out; anything else is a pause or a set-up. */
const OSCILLATING = new Set(["expand", "release", "shrink", "press", "hold"]);

/**
 * Actions whose LONG step should keep breathing underneath it.
 *
 * Wider than the beat set on purpose, and the difference is the whole point.
 * `observe` never forms a BEAT — belly-drop's 10s "Observe sensation" is a
 * pause, and treating it as one would invent a cadence the practice never
 * asked for. But belly-drop's 238s "Continue breathing and noticing" plainly
 * wants breath under it, as do cat-cow's "Continue with breath" and
 * safe-body-scan's two 80s passes. Six long steps across the library.
 *
 * `rest` stays out, and that is not fussiness: gastrocolic-rhythm opens with
 * 60s of "drink a full glass of warm water". Pacing a breath under that tells
 * the client to do the wrong thing. `massage` stays out for the same reason.
 */
const PACEABLE = new Set([...OSCILLATING, "observe"]);

export function isPaceable(action: string): boolean {
  return PACEABLE.has(action);
}

/** The letting-go half of a breath — a cycle needs one of these AND an expand. */
const OUTWARD = new Set(["release", "shrink", "press"]);

/** A step this long is an instruction to continue, not a movement to follow. */
export const LONG_STEP_SECS = 45;

/** Longest a single demonstrated beat can be and still read as one breath. */
const MAX_BEAT_SECS = 30;

/** Used when a practice says "slow breathing" without ever demonstrating it. */
const DEFAULT_CYCLE: CycleStep[] = [
  { action: "expand", secs: 5 },
  { action: "release", secs: 6 },
];

/**
 * The cycle a practice demonstrates before telling the client to repeat it.
 *
 * Takes the LAST unbroken run of short oscillating steps — the run immediately
 * before the "now continue" step, which is the one being described.
 */
export function breathCycle(steps: { secs: number | null; action: string }[]): CycleStep[] {
  const runs: CycleStep[][] = [];
  let cur: CycleStep[] = [];
  for (const s of steps) {
    const secs = s.secs ?? 0;
    if (OSCILLATING.has(s.action) && secs > 0 && secs <= MAX_BEAT_SECS) {
      cur.push({ action: s.action, secs });
    } else {
      if (cur.length) runs.push(cur);
      cur = [];
    }
  }
  if (cur.length) runs.push(cur);
  // A cycle needs a way in and a way out. Two beats is not enough on its own:
  // supported-chest-opening opens with `release` (lower down) then `release`
  // (open the arms) — two set-up movements in the same direction, which would
  // have paced its 180s "breathe and soften" as a breath that never inhales.
  const usable = runs.filter(
    (r) => r.some((b) => b.action === "expand") && r.some((b) => OUTWARD.has(b.action)),
  );
  return usable.length ? usable[usable.length - 1] : DEFAULT_CYCLE;
}

/**
 * What the animation should be doing right now.
 *
 * Short steps keep their own progress — they ARE the demonstration. A long
 * oscillating step instead loops the cycle, so "continue the rhythm" has a
 * rhythm to continue.
 */
export function pacedFrame(
  action: string,
  stepSecs: number,
  elapsed: number,
  cycle: CycleStep[],
): { action: string; p: number } {
  const linear = { action, p: stepSecs > 0 ? clamp01(elapsed / stepSecs) : 0 };
  if (stepSecs < LONG_STEP_SECS || !PACEABLE.has(action) || cycle.length < 2) return linear;

  const total = cycle.reduce((n, s) => n + s.secs, 0);
  if (total <= 0) return linear;

  let at = elapsed % total;
  for (const beat of cycle) {
    if (at < beat.secs) return { action: beat.action, p: beat.secs > 0 ? at / beat.secs : 0 };
    at -= beat.secs;
  }
  const last = cycle[cycle.length - 1];
  return { action: last.action, p: 1 };
}

/* ---- which steps the client paces, and which pace the client ----------- */
/*
   "Drink a full glass of warm water" ran as a 60-second countdown with an
   ambient animation — as if the client should sip while staring at the
   screen. A step like that is a TASK: the app's job is to say it clearly and
   wait. The animation earns its place only when the screen is pacing a
   movement the client follows WHILE watching.

   `rest` is the task action throughout the library (128 steps: "Lie down",
   "Prepare the prop", "Lift one foot", "Morning warm water"), so those become
   self-paced with a Done button. The step's duration is kept as a silent
   auto-advance fallback — a phone put down mid-task must not stall the
   session, and rest steps that mean "repeat on your own" (physiological-sigh)
   still move on unaided.
*/

export type StepMode = "self_paced" | "guided";

export function stepMode(action: string): StepMode {
  return action === "rest" ? "self_paced" : "guided";
}
