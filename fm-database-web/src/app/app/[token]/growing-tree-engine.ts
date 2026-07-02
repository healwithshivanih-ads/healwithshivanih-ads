/**
 * growing-tree-engine.ts — the DOM renderer for the Ochre growing tree.
 *
 * Ported verbatim from the visually-verified prototype (ochre-tree.html): the
 * seeded rng, crown geometry / clumps / leaf scatter, trunk, roots, fruit,
 * blossoms, birds, fireflies, the resting person, seasons and the fit-to-bounds
 * transform. All the DEMO CHROME from the prototype (growth slider, watch-it-grow
 * time-lapse, moments/weather/festival previews, share card, "while you were away"
 * banner and the discovery journal) is dropped — P0 renders the tree itself, driven
 * by a `TreeState`.
 *
 * Determinism: BASE_SEED=1973 is preserved, so the same TreeState always renders the
 * same tree. The renderer is browser-only (guarded with `typeof document`) and is
 * only ever invoked from a useEffect, so SSR never runs it.
 *
 * Public API:
 *   mountGrowingTree(root, state) → { update(s), destroy() }
 */

import type { TreeState } from "./growing-tree-state";

const SVGNS = "http://www.w3.org/2000/svg";
const BASE_SEED = 1973;

/** A short, unique class so we can inject the scoped stylesheet exactly once. */
const HOST_CLASS = "ot-tree-host";
const STYLE_ID = "ot-tree-style";

// mulberry32 — the prototype's deterministic PRNG.
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── scoped stylesheet ─────────────────────────────────────────────────────────
// Lifted from the prototype's <style>, trimmed to the tree-relevant rules and
// scoped under `.ot-tree-host` (day + night palettes, leaf/branch/root entrance
// animations, idle sway, seasonal crown tint, wildlife idle motion, stars).
const STYLE_CSS = `
.${HOST_CLASS}{
  --paper:#faf9f7; --paper-2:#f4efe6; --paper-3:#efe8da;
  --forest:#4a6152; --forest-deep:#3a4d41;
  --ochre:#a9651f; --ochre-deep:#8c5318;
  --ink:#262219; --muted:#5b5648;
  --rose:#c98a78; --rose-soft:#e6b8c8;
  --bark:#6b5740; --bark-edge:#5a4a36; --root:#9b8e76; --root-strong:#7a6a4c;
  --bark-lit:#8a7252; --bark-shade:#4a3c2b;
  --leaf-a:#4a6152; --leaf-b:#3a4d41; --leaf-c:#577061; --leaf-d:#43594b; --leaf-e:#62795f;
  --leaf-hi:#88a079; --leaf-hi-warm:#9fae6f; --leaf-shade:#2e3e34; --leaf-edge:rgba(30,42,32,0.34); --leaf-hi2:#bfd0a3; --leaf-shade2:#1f2a20;
  --crown-lit:#7d9374; --crown-mid:#52705e; --crown-deep:#33473b;
  --fruit-hi:#f4d9a6; --blossom-core:#fdeccf;
  --sun:rgba(245,206,128,.55); --dapple:rgba(231,196,143,.55);
  --ground:#d8cfbe; --ring:#5a4a36;
  --ground-shadow:rgba(58,48,32,.22);
  --stage-bg-top:#faf9f7; --stage-bg-bot:#f4efe6;
  --sky-top:#e9eef0; --sky-mid:#f3eee4; --sky-bot:#f4efe6;
  --glow:rgba(169,101,31,0);
  --mote:rgba(169,101,31,.5);
  display:block; width:100%;
}
.${HOST_CLASS}.night{
  --paper:#1c2620; --paper-2:#202d25; --paper-3:#26342b;
  --ink:#ece6d8; --muted:#a9b3a4;
  --bark:#83694c; --bark-edge:#9a7e5b; --root:#7d7460; --root-strong:#b59c74;
  --bark-lit:#a98d68; --bark-shade:#5a4630;
  --leaf-a:#6f8a78; --leaf-b:#5b7464; --leaf-c:#7e9885; --leaf-d:#688070; --leaf-e:#8aa491;
  --leaf-hi:#a9c4ac; --leaf-hi-warm:#b7c79a; --leaf-shade:#3f5448; --leaf-edge:rgba(10,20,15,0.42); --leaf-hi2:#d2e2bf; --leaf-shade2:#2b3a30;
  --crown-lit:#9fb6a4; --crown-mid:#5c7766; --crown-deep:#3c5347;
  --fruit-hi:#fbe6b8; --blossom-core:#fdeedd;
  --sun:rgba(231,196,143,.42); --dapple:rgba(231,196,143,.5);
  --ground:#3a4a3e; --ring:#9a7e5b;
  --ground-shadow:rgba(8,14,10,.4);
  --stage-bg-top:#16201a; --stage-bg-bot:#1c2620;
  --sky-top:#10161f; --sky-mid:#172230; --sky-bot:#1b2a28;
  --glow:rgba(231,196,143,.55);
  --mote:rgba(231,196,143,.6);
}
.${HOST_CLASS} .ot-stage{
  position:relative; border-radius:18px; overflow:hidden;
  background:linear-gradient(180deg,var(--stage-bg-top) 0%,var(--stage-bg-top) 60%,var(--stage-bg-bot) 100%);
  transition:background .5s ease;
}
.${HOST_CLASS} .ot-svg{ display:block; width:100%; height:auto; }

.${HOST_CLASS} .ot-anim path.ot-branch{
  stroke-dasharray:var(--len); stroke-dashoffset:var(--len);
  animation:ot-draw 1.0s cubic-bezier(.33,.7,.3,1) forwards; animation-delay:var(--d,0s);
}
.${HOST_CLASS} .ot-anim path.ot-root{
  stroke-dasharray:var(--len); stroke-dashoffset:var(--len);
  animation:ot-draw 1.05s cubic-bezier(.33,.7,.3,1) forwards; animation-delay:var(--d,0s);
}
@keyframes ot-draw{ to{ stroke-dashoffset:0; } }
.${HOST_CLASS} .ot-anim .ot-leaf{
  opacity:0; transform:scale(.25); transform-box:fill-box; transform-origin:center;
  animation:ot-leafin .62s cubic-bezier(.3,1.25,.5,1) forwards; animation-delay:var(--d,0s);
}
@keyframes ot-leafin{ to{ opacity:var(--o,1); transform:scale(1); } }
.${HOST_CLASS} .ot-anim .ot-blossom{
  opacity:0; transform:scale(.15) rotate(-16deg); transform-box:fill-box; transform-origin:center;
  animation:ot-bloom 1.0s cubic-bezier(.2,.85,.3,1) forwards; animation-delay:var(--d,0s);
}
@keyframes ot-bloom{ 60%{opacity:1;} to{ opacity:1; transform:scale(1) rotate(0deg); } }
.${HOST_CLASS} .ot-anim .ot-fruitg{
  opacity:0; transform:translateY(-9px) scale(.45); transform-box:fill-box; transform-origin:center;
  animation:ot-fruitin .82s cubic-bezier(.34,1.4,.5,1) forwards; animation-delay:var(--d,0s);
}
@keyframes ot-fruitin{ to{ opacity:1; transform:translateY(0) scale(1); } }

.${HOST_CLASS} #ot-canopy{ animation:ot-sway 7.5s ease-in-out infinite; will-change:transform; transition:filter .6s ease; }
@keyframes ot-sway{
  0%  { transform:rotate(-0.8deg) translateY(0); }
  50% { transform:rotate(0.8deg)  translateY(-1.1px); }
  100%{ transform:rotate(-0.8deg) translateY(0); }
}
.${HOST_CLASS}.ot-season-spring #ot-canopy{ filter:saturate(1.06) hue-rotate(-4deg) brightness(1.02); }
.${HOST_CLASS}.ot-season-summer #ot-canopy{ filter:saturate(1.04) brightness(0.99); }
.${HOST_CLASS}.ot-season-autumn #ot-canopy{ filter:sepia(0.20) saturate(1.08) hue-rotate(-12deg) brightness(1.0); }

.${HOST_CLASS} .ot-bird-bob{ animation:ot-birdbob 3.4s ease-in-out infinite; transform-box:fill-box; transform-origin:center bottom; }
@keyframes ot-birdbob{ 0%,100%{ transform:translateY(0) rotate(0deg); } 46%{ transform:translateY(-1.4px) rotate(-2deg); } 70%{ transform:translateY(0) rotate(1.5deg); } }
.${HOST_CLASS} .ot-bird-tail{ animation:ot-birdtail 2.1s ease-in-out infinite; transform-box:fill-box; transform-origin:left center; }
@keyframes ot-birdtail{ 0%,100%{ transform:rotate(0deg); } 50%{ transform:rotate(-9deg); } }
.${HOST_CLASS} .ot-star{ animation:ot-twinkle 3.6s ease-in-out infinite; }
@keyframes ot-twinkle{ 0%,100%{opacity:.35;} 50%{opacity:1;} }
.${HOST_CLASS} .ot-wing-l{ animation:ot-flutter-l 0.9s ease-in-out infinite; transform-box:fill-box; transform-origin:right center; }
.${HOST_CLASS} .ot-wing-r{ animation:ot-flutter-r 0.9s ease-in-out infinite; transform-box:fill-box; transform-origin:left center; }
@keyframes ot-flutter-l{ 0%,100%{ transform:scaleX(1) rotate(0deg); } 50%{ transform:scaleX(0.42) rotate(6deg); } }
@keyframes ot-flutter-r{ 0%,100%{ transform:scaleX(1) rotate(0deg); } 50%{ transform:scaleX(0.42) rotate(-6deg); } }
.${HOST_CLASS} .ot-bwing{ animation:ot-buzz 0.28s ease-in-out infinite; transform-box:fill-box; transform-origin:center bottom; }
@keyframes ot-buzz{ 0%,100%{ transform:scaleY(1); opacity:.55; } 50%{ transform:scaleY(0.6); opacity:.3; } }
.${HOST_CLASS} .ot-flit-a{ animation:ot-flit-a 9s ease-in-out infinite; }
.${HOST_CLASS} .ot-flit-b{ animation:ot-flit-b 11s ease-in-out infinite; }
.${HOST_CLASS} .ot-flit-c{ animation:ot-flit-c 10s ease-in-out infinite; }
.${HOST_CLASS} .ot-flit-bee{ animation:ot-flit-bee 8s ease-in-out infinite; }
@keyframes ot-flit-a{ 0%,100%{ transform:translate(0,0) rotate(-4deg);} 25%{ transform:translate(16px,-10px) rotate(5deg);} 50%{ transform:translate(4px,-20px) rotate(-3deg);} 75%{ transform:translate(-14px,-8px) rotate(4deg);} }
@keyframes ot-flit-b{ 0%,100%{ transform:translate(0,0) rotate(3deg);} 30%{ transform:translate(-18px,-12px) rotate(-5deg);} 55%{ transform:translate(-6px,-22px) rotate(4deg);} 80%{ transform:translate(15px,-9px) rotate(-3deg);} }
@keyframes ot-flit-c{ 0%,100%{ transform:translate(0,0) rotate(-2deg);} 33%{ transform:translate(13px,-14px) rotate(6deg);} 66%{ transform:translate(-12px,-6px) rotate(-4deg);} }
@keyframes ot-flit-bee{ 0%,100%{ transform:translate(0,0);} 20%{ transform:translate(12px,-6px);} 45%{ transform:translate(20px,4px);} 70%{ transform:translate(6px,10px);} 88%{ transform:translate(-8px,3px);} }
.${HOST_CLASS} .ot-chick{ animation:ot-chickbob 1.9s ease-in-out infinite; transform-box:fill-box; transform-origin:center bottom; }
@keyframes ot-chickbob{ 0%,100%{ transform:translateY(0) rotate(0deg);} 45%{ transform:translateY(-1.3px) rotate(-3deg);} 72%{ transform:translateY(0) rotate(2deg);} }
.${HOST_CLASS} .ot-fnod{ animation:ot-fnod 5.5s ease-in-out infinite; transform-box:fill-box; transform-origin:center bottom; }
@keyframes ot-fnod{ 0%,100%{ transform:rotate(-2.2deg);} 50%{ transform:rotate(2.2deg);} }

@media (prefers-reduced-motion:reduce){
  .${HOST_CLASS} .ot-anim path.ot-branch,.${HOST_CLASS} .ot-anim path.ot-root{ animation:none; stroke-dashoffset:0; }
  .${HOST_CLASS} .ot-anim .ot-leaf,.${HOST_CLASS} .ot-anim .ot-blossom,.${HOST_CLASS} .ot-anim .ot-fruitg{ animation:none; opacity:1; transform:none; }
  .${HOST_CLASS} #ot-canopy{ animation:none !important; }
  .${HOST_CLASS} .ot-bird-bob,.${HOST_CLASS} .ot-bird-tail,.${HOST_CLASS} .ot-star,
  .${HOST_CLASS} .ot-wing-l,.${HOST_CLASS} .ot-wing-r,.${HOST_CLASS} .ot-bwing,
  .${HOST_CLASS} .ot-flit-a,.${HOST_CLASS} .ot-flit-b,.${HOST_CLASS} .ot-flit-c,.${HOST_CLASS} .ot-flit-bee,
  .${HOST_CLASS} .ot-chick,.${HOST_CLASS} .ot-fnod{ animation:none; }
}
`;

function ensureStyle(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = STYLE_CSS;
  document.head.appendChild(s);
}

// The SVG scaffold — the same <defs> + group structure the prototype's render()
// expects, minus the demo-only groups (sky weather previews, moments, share snap).
const SVG_MARKUP = `
<svg class="ot-svg" viewBox="0 0 480 520" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="A procedurally generated tree at the current growth stage">
  <defs>
    <filter id="ot-shadow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="3"/></filter>
    <filter id="ot-glowblur" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="9"/></filter>
    <radialGradient id="ot-sun" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="var(--sun)"/><stop offset="60%" stop-color="var(--sun)" stop-opacity="0.35"/><stop offset="100%" stop-color="var(--sun)" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="ot-dapple" cx="50%" cy="45%" r="50%">
      <stop offset="0%" stop-color="var(--dapple)"/><stop offset="55%" stop-color="var(--dapple)" stop-opacity="0.4"/><stop offset="100%" stop-color="var(--dapple)" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="ot-trunk-grad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="var(--bark-lit)"/><stop offset="42%" stop-color="var(--bark)"/><stop offset="100%" stop-color="var(--bark-shade)"/>
    </linearGradient>
    <radialGradient id="ot-fruit-grad" cx="34%" cy="30%" r="78%">
      <stop offset="0%" stop-color="var(--fruit-hi)"/><stop offset="42%" stop-color="var(--ochre)"/><stop offset="100%" stop-color="var(--ochre-deep)"/>
    </radialGradient>
    <radialGradient id="ot-crown-grad" cx="40%" cy="34%" r="80%">
      <stop offset="0%" stop-color="var(--crown-mid)"/><stop offset="60%" stop-color="var(--crown-deep)"/><stop offset="100%" stop-color="var(--leaf-shade)"/>
    </radialGradient>
    <radialGradient id="ot-blossom-grad" cx="50%" cy="50%" r="60%">
      <stop offset="0%" stop-color="var(--blossom-core)"/><stop offset="70%" stop-color="var(--ochre)"/><stop offset="100%" stop-color="var(--ochre-deep)"/>
    </radialGradient>
    <radialGradient id="ot-fruit-green" cx="34%" cy="30%" r="78%">
      <stop offset="0%" stop-color="#c4d39a"/><stop offset="46%" stop-color="#7f9a52"/><stop offset="100%" stop-color="#566c34"/>
    </radialGradient>
    <radialGradient id="ot-fruit-blush" cx="34%" cy="30%" r="78%">
      <stop offset="0%" stop-color="#fbdcb4"/><stop offset="44%" stop-color="#e29a63"/><stop offset="100%" stop-color="#bf6a4a"/>
    </radialGradient>
    <radialGradient id="ot-fruit-gold" cx="34%" cy="28%" r="80%">
      <stop offset="0%" stop-color="#fff4d2"/><stop offset="40%" stop-color="#f5cf6a"/><stop offset="100%" stop-color="#d99a25"/>
    </radialGradient>
    <radialGradient id="ot-gold-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#ffe9a8" stop-opacity="0.95"/><stop offset="55%" stop-color="#ffd66e" stop-opacity="0.45"/><stop offset="100%" stop-color="#ffd66e" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="ot-sky-grad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="var(--sky-top)"/><stop offset="62%" stop-color="var(--sky-mid)"/><stop offset="100%" stop-color="var(--sky-bot)"/>
    </linearGradient>
    <radialGradient id="ot-moon-grad" cx="38%" cy="34%" r="68%">
      <stop offset="0%" stop-color="#fdf6e3"/><stop offset="70%" stop-color="#eadfba"/><stop offset="100%" stop-color="#cdbf92"/>
    </radialGradient>
    <radialGradient id="ot-moon-halo" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#fdf6e3" stop-opacity="0.5"/><stop offset="100%" stop-color="#fdf6e3" stop-opacity="0"/>
    </radialGradient>
    <filter id="otCrownShadow" x="-25%" y="-25%" width="150%" height="165%">
      <feDropShadow dx="1" dy="5" stdDeviation="4" flood-color="#20281c" flood-opacity="0.26"/>
    </filter>
  </defs>
  <g id="ot-sky"></g>
  <g id="ot-scene">
    <g id="ot-sun"></g>
    <g id="ot-glow"></g>
    <g id="ot-groundshadow"></g>
    <g id="ot-person"></g>
    <g id="ot-groundflora"></g>
    <g id="ot-roots"></g>
    <line id="ot-ground" x1="60" y1="330" x2="420" y2="330" stroke="var(--ground)" stroke-width="1.5" stroke-dasharray="2 7" stroke-linecap="round"/>
    <g id="ot-trunk"></g>
    <g id="ot-rings"></g>
    <g id="ot-canopy">
      <g id="ot-branches"></g>
      <g id="ot-canopyfill"></g>
      <g id="ot-canopyshade"></g>
      <g id="ot-leaves" filter="url(#otCrownShadow)"></g>
      <g id="ot-dapples"></g>
      <g id="ot-nest"></g>
      <g id="ot-blossoms"></g>
      <g id="ot-fruit"></g>
      <g id="ot-fireflies"></g>
      <g id="ot-birds"></g>
      <g id="ot-flitters"></g>
      <g id="ot-motes"></g>
    </g>
    <g id="ot-flame"></g>
  </g>
</svg>
`;

// The season class the prototype toggled on the wrapper. Derived internally (no chip).
const SEASON_CLASSES = ["ot-season-spring", "ot-season-summer", "ot-season-autumn"];
interface Season {
  key: "spring" | "summer" | "autumn";
  cls: string;
  gold: number;
}
function seasonForWeek(week: number): Season {
  if (week <= 4) return { key: "spring", cls: "ot-season-spring", gold: 0.0 };
  if (week <= 8) return { key: "summer", cls: "ot-season-summer", gold: 0.04 };
  const t = Math.min(1, (week - 9) / 4);
  return { key: "autumn", cls: "ot-season-autumn", gold: 0.16 + t * 0.16 };
}

// ── the mounted instance ──────────────────────────────────────────────────────
// A closure over the SVG groups + render state. `render()` is a faithful port of
// the prototype's render(), reading week/night/streak/extraLeaves from the injected
// TreeState instead of the demo slider.
export interface GrowingTreeHandle {
  update(s: TreeState): void;
  destroy(): void;
}

export function mountGrowingTree(root: HTMLElement, initial: TreeState): GrowingTreeHandle {
  // SSR / non-DOM guard — mount is a no-op with an inert handle.
  if (typeof document === "undefined") {
    return { update() {}, destroy() {} };
  }
  ensureStyle();

  root.classList.add(HOST_CLASS);
  const stage = document.createElement("div");
  stage.className = "ot-stage ot-anim";
  stage.innerHTML = SVG_MARKUP.trim();
  root.appendChild(stage);

  const svg = stage.querySelector("svg") as SVGSVGElement;
  const $ = (id: string) => svg.querySelector("#" + id) as SVGGElement;

  const gScene = $("ot-scene"),
    gSky = $("ot-sky"),
    gSun = $("ot-sun"),
    gGlow = $("ot-glow"),
    gGroundShadow = $("ot-groundshadow"),
    gPerson = $("ot-person"),
    gRoots = $("ot-roots"),
    gTrunk = $("ot-trunk"),
    gRings = $("ot-rings"),
    gCanopy = $("ot-canopy"),
    gBranches = $("ot-branches"),
    gCanopyFill = $("ot-canopyfill"),
    gCanopyShade = $("ot-canopyshade"),
    gLeaves = $("ot-leaves"),
    gDapples = $("ot-dapples"),
    gBlossoms = $("ot-blossoms"),
    gFruit = $("ot-fruit"),
    gFireflies = $("ot-fireflies"),
    gBirds = $("ot-birds"),
    gMotes = $("ot-motes"),
    gFlame = $("ot-flame"),
    gGroundFlora = $("ot-groundflora"),
    gNest = $("ot-nest"),
    gFlitters = $("ot-flitters");

  // Local render state (only what the tree render actually reads).
  const state = {
    week: 0,
    extraLeaves: 0,
    blossoms: 0,
    fruit: 0,
    streak: 0,
    night: false,
    animate: true,
  };

  function clear(g: Element) {
    while (g.firstChild) g.removeChild(g.firstChild);
  }
  function el(name: string, attrs: Record<string, string>): SVGElement {
    const e = document.createElementNS(SVGNS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e as SVGElement;
  }

  // ── fit-to-bounds bbox tracking (verbatim) ──
  const VIEW_W = 480,
    VIEW_H = 520;
  const PAD_X = 26;
  const BASELINE_Y = 500;
  const TARGET_TOP = 14;
  const TARGET_W = VIEW_W - PAD_X * 2;
  const TARGET_H = BASELINE_Y - TARGET_TOP;

  let bbox = { minX: 1e9, minY: 1e9, maxX: -1e9, maxY: -1e9 };
  function bboxReset() {
    bbox = { minX: 1e9, minY: 1e9, maxX: -1e9, maxY: -1e9 };
  }
  function bboxAdd(x: number, y: number) {
    if (x < bbox.minX) bbox.minX = x;
    if (y < bbox.minY) bbox.minY = y;
    if (x > bbox.maxX) bbox.maxX = x;
    if (y > bbox.maxY) bbox.maxY = y;
  }
  function bboxAddR(x: number, y: number, r: number) {
    bboxAdd(x - r, y - r);
    bboxAdd(x + r, y + r);
  }

  function quadLen(x0: number, y0: number, mx: number, my: number, x1: number, y1: number) {
    let px = x0,
      py = y0,
      L = 0;
    for (let s = 1; s <= 8; s++) {
      const u = s / 8,
        iu = 1 - u;
      const qx = iu * iu * x0 + 2 * iu * u * mx + u * u * x1;
      const qy = iu * iu * y0 + 2 * iu * u * my + u * u * y1;
      L += Math.hypot(qx - px, qy - py);
      px = qx;
      py = qy;
    }
    return L;
  }

  interface Stage {
    lo: number;
    hi: number;
    name: string;
    depth: number;
    leafy: number;
  }
  const STAGES: Stage[] = [
    { lo: 0, hi: 1, name: "Sapling", depth: 2, leafy: 0.35 },
    { lo: 2, hi: 4, name: "Young tree", depth: 3, leafy: 0.85 },
    { lo: 5, hi: 8, name: "Mature canopy", depth: 4, leafy: 1.0 },
    { lo: 9, hi: 11, name: "Flowering", depth: 4, leafy: 1.0 },
    { lo: 12, hi: 99, name: "Fruiting", depth: 5, leafy: 1.0 },
  ];
  function stageFor(week: number): Stage {
    for (let i = 0; i < STAGES.length; i++) {
      if (week <= STAGES[i].hi) return STAGES[i];
    }
    return STAGES[STAGES.length - 1];
  }

  interface LeafPoint {
    x: number;
    y: number;
    ang: number;
  }
  interface BranchSeg {
    d: string;
    w: number;
    op: number;
    len: number;
  }
  let leafPoints: LeafPoint[] = [];
  let branchSegs: BranchSeg[] = [];

  function drawBranch(
    rng: () => number,
    x: number,
    y: number,
    angle: number,
    len: number,
    depth: number,
    width: number,
  ) {
    if (depth <= 0 || len < 8) {
      leafPoints.push({ x: x, y: y, ang: angle });
      bboxAdd(x, y);
      return;
    }
    const ex = x + Math.cos(angle) * len;
    const ey = y + Math.sin(angle) * len;
    const curve = (rng() - 0.5) * len * 0.45;
    const mx = (x + ex) / 2 + Math.cos(angle + Math.PI / 2) * curve;
    const my = (y + ey) / 2 + Math.sin(angle + Math.PI / 2) * curve;
    bboxAdd(x, y);
    bboxAdd(ex, ey);
    bboxAdd(mx, my);
    branchSegs.push({
      d:
        "M " +
        x.toFixed(1) +
        " " +
        y.toFixed(1) +
        " Q " +
        mx.toFixed(1) +
        " " +
        my.toFixed(1) +
        " " +
        ex.toFixed(1) +
        " " +
        ey.toFixed(1),
      w: Math.max(0.9, width),
      op: 0.6 + depth * 0.07,
      len: quadLen(x, y, mx, my, ex, ey),
    });
    const nKids: number = depth > 2 ? (rng() < 0.45 ? 3 : 2) : 2;
    const spread = 0.55 + rng() * 0.18;
    for (let i = 0; i < nKids; i++) {
      let frac = nKids === 1 ? 0 : i / (nKids - 1) - 0.5;
      if (nKids === 3 && i === 1) frac = (rng() - 0.5) * 0.25;
      const childAng = angle + frac * spread * 2 + (rng() - 0.5) * 0.12;
      drawBranch(rng, ex, ey, childAng, len * (0.7 + rng() * 0.06), depth - 1, width * 0.66);
    }
    if (depth === 1 && rng() < 0.4) {
      leafPoints.push({ x: ex, y: ey, ang: angle });
    }
  }

  interface Trunk {
    topX: number;
    topY: number;
    topW: number;
    baseX: number;
    baseY: number;
    baseW: number;
  }
  function buildTrunk(week: number): Trunk {
    clear(gTrunk);
    clear(gRings);
    const baseX = 240,
      baseY = 330;
    const t = Math.min(week, 13) / 13;
    const topY = baseY - (80 + t * 150);
    const baseW = 6 + t * 10;
    const topW = 2.0 + t * 1.8;
    const lean = 11;
    const cy1 = baseY - (baseY - topY) * 0.4,
      cy2 = baseY - (baseY - topY) * 0.75;
    const cx1 = baseX - lean * 0.5,
      cx2 = baseX + lean * 0.6;
    const topX = baseX + lean * 0.15;

    const leftBase = baseX - baseW,
      rightBase = baseX + baseW,
      leftTop = topX - topW,
      rightTop = topX + topW;
    bboxAdd(leftBase, baseY);
    bboxAdd(rightBase, baseY);
    bboxAdd(leftTop, topY);
    bboxAdd(rightTop, topY);
    const d =
      "M " +
      leftBase.toFixed(1) +
      " " +
      baseY +
      " C " +
      (cx1 - baseW * 0.6).toFixed(1) +
      " " +
      cy1.toFixed(1) +
      ", " +
      (cx2 - topW).toFixed(1) +
      " " +
      cy2.toFixed(1) +
      ", " +
      leftTop.toFixed(1) +
      " " +
      topY.toFixed(1) +
      " L " +
      rightTop.toFixed(1) +
      " " +
      topY.toFixed(1) +
      " C " +
      (cx2 + topW).toFixed(1) +
      " " +
      cy2.toFixed(1) +
      ", " +
      (cx1 + baseW * 0.6).toFixed(1) +
      " " +
      cy1.toFixed(1) +
      ", " +
      rightBase.toFixed(1) +
      " " +
      baseY +
      " Z";
    gTrunk.appendChild(
      el("path", {
        d: d,
        fill: "url(#ot-trunk-grad)",
        stroke: "var(--bark-edge)",
        "stroke-width": "1",
        "stroke-linejoin": "round",
      }),
    );
    gTrunk.appendChild(
      el("path", {
        d:
          "M " +
          leftBase.toFixed(1) +
          " " +
          baseY +
          " C " +
          (cx1 - baseW * 0.6).toFixed(1) +
          " " +
          cy1.toFixed(1) +
          ", " +
          (cx2 - topW).toFixed(1) +
          " " +
          cy2.toFixed(1) +
          ", " +
          leftTop.toFixed(1) +
          " " +
          topY.toFixed(1),
        fill: "none",
        stroke: "var(--bark-lit)",
        "stroke-width": "1.4",
        opacity: "0.5",
        "stroke-linecap": "round",
      }),
    );
    gTrunk.appendChild(
      el("path", {
        d:
          "M " +
          rightBase.toFixed(1) +
          " " +
          baseY +
          " C " +
          (cx1 + baseW * 0.6).toFixed(1) +
          " " +
          cy1.toFixed(1) +
          ", " +
          (cx2 + topW).toFixed(1) +
          " " +
          cy2.toFixed(1) +
          ", " +
          rightTop.toFixed(1) +
          " " +
          topY.toFixed(1),
        fill: "none",
        stroke: "var(--bark-shade)",
        "stroke-width": "1.1",
        opacity: "0.35",
        "stroke-linecap": "round",
      }),
    );

    const rings = Math.min(week, 12);
    for (let r = 0; r < rings; r++) {
      const ry = baseY - 8 - r * 4.4;
      if (ry < topY + 24) break;
      const hf = (baseY - ry) / (baseY - topY);
      const w = (baseW * (1 - hf) + topW * hf) * 0.74;
      gRings.appendChild(
        el("path", {
          d:
            "M " +
            (baseX - w).toFixed(1) +
            " " +
            ry.toFixed(1) +
            " Q " +
            baseX +
            " " +
            (ry - 2.2).toFixed(1) +
            " " +
            (baseX + w).toFixed(1) +
            " " +
            ry.toFixed(1),
          fill: "none",
          stroke: "var(--ring)",
          "stroke-width": "0.7",
          opacity: "0.3",
        }),
      );
    }
    return { topX, topY, topW, baseX, baseY, baseW };
  }

  const LEAF_SHAPES = [
    {
      b: "M 0 0 C 0.22 -0.16 0.30 -0.56 0 -1 C -0.30 -0.56 -0.22 -0.16 0 0 Z",
      v: "M 0 -0.06 L 0 -0.9",
    },
    {
      b: "M 0 0 C 0.36 -0.14 0.42 -0.60 0 -0.95 C -0.42 -0.60 -0.36 -0.14 0 0 Z",
      v: "M 0 -0.06 L 0 -0.85 M 0 -0.36 L 0.16 -0.5 M 0 -0.54 L -0.15 -0.66",
    },
    {
      b: "M 0 0 C 0.13 -0.26 0.17 -0.72 0 -1.06 C -0.17 -0.72 -0.13 -0.26 0 0 Z",
      v: "M 0 -0.06 L 0 -0.96",
    },
    {
      b: "M 0 0 C 0.30 -0.18 0.34 -0.64 0.05 -0.98 C -0.03 -0.62 -0.27 -0.18 0 0 Z",
      v: "M 0 -0.06 Q 0.04 -0.5 0.05 -0.9",
    },
  ];
  function leafMark(
    rng: () => number,
    x: number,
    y: number,
    ang: number,
    scale: number,
    col: string,
    op: number,
    sizeMul: number,
    dly: number,
  ): SVGElement {
    const len = (15 + rng() * 6) * scale * (sizeMul || 1);
    const deg = (ang * 180) / Math.PI + 90 + (rng() - 0.5) * 12;
    const sh = LEAF_SHAPES[(rng() * LEAF_SHAPES.length) | 0];
    const dx = Math.cos(ang),
      dy = Math.sin(ang),
      pxu = -dy * 0.36 * len,
      pyu = dx * 0.36 * len;
    const tX = x + dx * len,
      tY = y + dy * len,
      mX = x + dx * len * 0.5,
      mY = y + dy * len * 0.5;
    bboxAdd(x, y);
    bboxAdd(tX, tY);
    bboxAdd(mX + pxu, mY + pyu);
    bboxAdd(mX - pxu, mY - pyu);
    const inner = el("g", { class: "ot-leaf" });
    inner.appendChild(
      el("path", {
        d: sh.b,
        fill: col,
        opacity: op.toFixed(2),
        stroke: "var(--leaf-edge)",
        "stroke-width": "0.8",
        "vector-effect": "non-scaling-stroke",
        "stroke-linejoin": "round",
      }),
    );
    inner.appendChild(
      el("path", {
        d: sh.v,
        fill: "none",
        stroke: "var(--leaf-edge)",
        opacity: "0.5",
        "stroke-width": "0.55",
        "vector-effect": "non-scaling-stroke",
        "stroke-linecap": "round",
      }),
    );
    if (state.animate) {
      (inner as SVGElement).style.setProperty("--o", op.toFixed(2));
      (inner as SVGElement).style.setProperty("--d", (dly || 0).toFixed(3) + "s");
    }
    const g = el("g", {
      transform:
        "translate(" +
        x.toFixed(1) +
        " " +
        y.toFixed(1) +
        ") rotate(" +
        deg.toFixed(1) +
        ") scale(" +
        len.toFixed(2) +
        ")",
    });
    g.appendChild(inner);
    return g;
  }

  function blossomMark(rng: () => number, x: number, y: number, idx: number): SVGElement {
    const g = el("g", { class: "ot-blossom" });
    const pr = 3.0;
    bboxAddR(x, y, pr + 3.4);
    g.appendChild(
      el("circle", { cx: x.toFixed(1), cy: y.toFixed(1), r: "5.2", fill: "url(#ot-dapple)", opacity: "0.8" }),
    );
    for (let p = 0; p < 5; p++) {
      const pa = (p / 5) * Math.PI * 2 + rng() * 0.3;
      const cx = x + Math.cos(pa) * pr,
        cy = y + Math.sin(pa) * pr;
      g.appendChild(
        el("ellipse", {
          cx: cx.toFixed(1),
          cy: cy.toFixed(1),
          rx: "3.2",
          ry: "2.2",
          fill: p % 2 ? "var(--rose-soft)" : "var(--rose)",
          transform: "rotate(" + ((pa * 180) / Math.PI).toFixed(1) + " " + cx.toFixed(1) + " " + cy.toFixed(1) + ")",
          opacity: "0.40",
        }),
      );
      g.appendChild(
        el("ellipse", {
          cx: cx.toFixed(1),
          cy: cy.toFixed(1),
          rx: "2.6",
          ry: "1.7",
          fill: p % 2 ? "var(--rose-soft)" : "var(--rose)",
          transform: "rotate(" + ((pa * 180) / Math.PI).toFixed(1) + " " + cx.toFixed(1) + " " + cy.toFixed(1) + ")",
          opacity: "0.95",
        }),
      );
    }
    g.appendChild(el("circle", { cx: x.toFixed(1), cy: y.toFixed(1), r: "1.9", fill: "url(#ot-blossom-grad)" }));
    g.appendChild(
      el("circle", { cx: (x - 0.5).toFixed(1), cy: (y - 0.5).toFixed(1), r: "0.7", fill: "#fff7e8", opacity: "0.9" }),
    );
    if (state.animate) (g as SVGElement).style.setProperty("--d", (0.5 + idx * 0.05).toFixed(3) + "s");
    return g;
  }

  const FRUIT_FILLS: Record<string, string> = {
    green: "url(#ot-fruit-green)",
    blush: "url(#ot-fruit-blush)",
    ripe: "url(#ot-fruit-grad)",
    golden: "url(#ot-fruit-gold)",
  };
  const FRUIT_EDGE: Record<string, string> = {
    green: "#566c34",
    blush: "#bf6a4a",
    ripe: "var(--ochre-deep)",
    golden: "#b9831e",
  };
  function fruitMark(x: number, y: number, idx: number, kind: string): SVGElement {
    kind = kind || "ripe";
    const golden = kind === "golden";
    const g = el("g", { class: "ot-fruitg" });
    bboxAdd(x, y - 7);
    bboxAddR(x, y, golden ? 7.6 : 6.2);
    if (golden) {
      g.appendChild(el("circle", { cx: x.toFixed(1), cy: y.toFixed(1), r: "8.2", fill: "url(#ot-gold-glow)", opacity: "0.9" }));
    }
    g.appendChild(
      el("path", {
        d: "M " + x.toFixed(1) + " " + (y - 7).toFixed(1) + " q 2 3 0 6",
        fill: "none",
        stroke: "var(--bark-edge)",
        "stroke-width": "1.2",
        "stroke-linecap": "round",
      }),
    );
    g.appendChild(
      el("path", {
        d:
          "M " +
          (x + 0.4).toFixed(1) +
          " " +
          (y - 6.4).toFixed(1) +
          " q 3.4 -2.4 5.4 0.4 q -3 1.6 -5.4 -0.4 z",
        fill: "var(--leaf-c)",
        opacity: "0.9",
      }),
    );
    g.appendChild(
      el("ellipse", {
        cx: (x + 1.0).toFixed(1),
        cy: (y + 2.4).toFixed(1),
        rx: "4.6",
        ry: "3.6",
        fill: "var(--ochre-deep)",
        opacity: "0.22",
      }),
    );
    g.appendChild(
      el("circle", {
        cx: x.toFixed(1),
        cy: y.toFixed(1),
        r: "5.2",
        fill: FRUIT_FILLS[kind],
        stroke: FRUIT_EDGE[kind],
        "stroke-width": golden ? "0.8" : "0.7",
      }),
    );
    g.appendChild(
      el("circle", {
        cx: (x - 1.7).toFixed(1),
        cy: (y - 1.8).toFixed(1),
        r: "2.1",
        fill: golden ? "#fff7d6" : "var(--fruit-hi)",
        opacity: golden ? "0.7" : "0.55",
      }),
    );
    g.appendChild(
      el("circle", { cx: (x - 2.0).toFixed(1), cy: (y - 2.0).toFixed(1), r: "0.7", fill: "#fff7e8", opacity: "0.9" }),
    );
    if (golden) {
      const sp = el("circle", { cx: (x - 1.2).toFixed(1), cy: (y - 2.6).toFixed(1), r: "0.9", fill: "#fffdf2", opacity: "0.95" });
      sp.appendChild(
        el("animate", {
          attributeName: "opacity",
          values: "0.4;1;0.4",
          dur: "2.6s",
          repeatCount: "indefinite",
          begin: (-idx * 0.4).toFixed(1) + "s",
        }),
      );
      g.appendChild(sp);
    }
    if (state.animate) (g as SVGElement).style.setProperty("--d", (0.65 + idx * 0.07).toFixed(3) + "s");
    return g;
  }

  // ── roots ──
  interface RootSeg {
    d: string;
    w: number;
    len: number;
  }
  let rootSegs: RootSeg[] = [];
  function drawRoot(rng: () => number, x: number, y: number, angle: number, len: number, depth: number, width: number) {
    if (depth <= 0 || len < 7) {
      bboxAdd(x, y);
      return;
    }
    const ex = x + Math.cos(angle) * len,
      ey = y + Math.sin(angle) * len;
    const curve = (rng() - 0.5) * len * 0.45;
    const mx = (x + ex) / 2 + Math.cos(angle + Math.PI / 2) * curve,
      my = (y + ey) / 2 + Math.sin(angle + Math.PI / 2) * curve;
    bboxAdd(x, y);
    bboxAdd(ex, ey);
    bboxAdd(mx, my);
    rootSegs.push({
      d:
        "M " +
        x.toFixed(1) +
        " " +
        y.toFixed(1) +
        " Q " +
        mx.toFixed(1) +
        " " +
        my.toFixed(1) +
        " " +
        ex.toFixed(1) +
        " " +
        ey.toFixed(1),
      w: Math.max(0.8, width),
      len: quadLen(x, y, mx, my, ex, ey),
    });
    const nc = depth > 1 ? 2 : 1;
    for (let i = 0; i < nc; i++) {
      const frac = nc === 1 ? (rng() - 0.5) * 0.4 : i / (nc - 1) - 0.5;
      drawRoot(rng, ex, ey, angle + frac * 0.85 + (rng() - 0.5) * 0.15, len * 0.72, depth - 1, width * 0.64);
    }
  }
  function drawRoots(rng: () => number, baseX: number, baseY: number, week: number) {
    clear(gRoots);
    rootSegs = [];
    const t = Math.min(week, 13) / 13;
    const n = 3 + Math.round(t * 3);
    const rdepth = 3 + (week >= 6 ? 1 : 0);
    const rlen = 26 + t * 40;
    for (let i = 0; i < n; i++) {
      const frac = n === 1 ? 0 : i / (n - 1) - 0.5;
      drawRoot(rng, baseX, baseY + 2, Math.PI / 2 + frac * 1.25 + (rng() - 0.5) * 0.18, rlen * (0.85 + rng() * 0.3), rdepth, 1.8);
    }
    const op = 0.42;
    const stroke = "var(--root)";
    for (let s = 0; s < rootSegs.length; s++) {
      const seg = rootSegs[s];
      const p = el("path", {
        d: seg.d,
        fill: "none",
        stroke: stroke,
        "stroke-width": seg.w.toFixed(2),
        "stroke-linecap": "round",
        opacity: op.toFixed(2),
        class: "ot-root",
      });
      if (state.animate) {
        (p as SVGElement).style.setProperty("--len", seg.len.toFixed(1));
        (p as SVGElement).style.setProperty("--d", (0.1 + s * 0.012).toFixed(3) + "s");
      }
      gRoots.appendChild(p);
    }
  }

  function drawGroundShadow(trunk: Trunk, t: number) {
    clear(gGroundShadow);
    const w = trunk.baseW + 24 + t * 34;
    const h = 7 + t * 4;
    const sy = trunk.baseY + 6;
    gGroundShadow.appendChild(
      el("ellipse", {
        cx: trunk.baseX.toFixed(1),
        cy: sy.toFixed(1),
        rx: w.toFixed(1),
        ry: h.toFixed(1),
        fill: "var(--ground-shadow)",
        filter: "url(#ot-shadow)",
      }),
    );
  }

  function drawMotes(rng: () => number, trunk: Trunk, week: number) {
    clear(gMotes);
    if (week < 2) return;
    const t = Math.min(week, 13) / 13;
    const n = 4 + Math.round(t * 5);
    const spanX = 60 + t * 40;
    const topY = trunk.topY;
    for (let i = 0; i < n; i++) {
      const mx = trunk.topX + (rng() - 0.5) * spanX * 2;
      const my = topY + 30 + rng() * 70;
      const r = 1.0 + rng() * 1.4;
      const c = el("circle", {
        cx: mx.toFixed(1),
        cy: my.toFixed(1),
        r: r.toFixed(1),
        fill: "var(--mote)",
        opacity: (0.22 + rng() * 0.3).toFixed(2),
      });
      const dur = (5.5 + rng() * 4).toFixed(1);
      const rise = (24 + rng() * 28).toFixed(1);
      const drift = ((rng() - 0.5) * 16).toFixed(1);
      c.appendChild(
        el("animateTransform", {
          attributeName: "transform",
          type: "translate",
          values: "0 0; " + drift + " -" + rise + "; 0 0",
          dur: dur + "s",
          repeatCount: "indefinite",
          begin: "-" + (rng() * 4).toFixed(1) + "s",
        }),
      );
      c.appendChild(
        el("animate", {
          attributeName: "opacity",
          values: "0; " + (0.22 + rng() * 0.28).toFixed(2) + "; 0",
          dur: dur + "s",
          repeatCount: "indefinite",
          begin: "-" + (rng() * 4).toFixed(1) + "s",
        }),
      );
      gMotes.appendChild(c);
    }
  }

  interface CrownGeom {
    miX: number;
    maX: number;
    miY: number;
    centerX: number;
    midY: number;
    spanX: number;
    spanY: number;
    crownTop: number;
    crownBottom: number;
    topX: number;
    topY: number;
  }
  function crownGeometry(lpts: LeafPoint[], trunk: Trunk): CrownGeom {
    let miX = 1e9,
      maX = -1e9,
      miY = 1e9,
      sx = 0,
      sy = 0;
    for (let i = 0; i < lpts.length; i++) {
      const p = lpts[i];
      sx += p.x;
      sy += p.y;
      if (p.x < miX) miX = p.x;
      if (p.x > maX) maX = p.x;
      if (p.y < miY) miY = p.y;
    }
    const n = lpts.length || 1;
    const topX = trunk.topX,
      topY = trunk.topY;
    const crownBottom = topY + 14;
    const crownTop = Math.min(miY, sy / n) - 8;
    const midY = (crownBottom + crownTop) / 2;
    const spanY = Math.max(54, crownBottom - crownTop);
    const centerX = topX * 0.42 + ((miX + maX) / 2) * 0.58;
    const spanX = Math.max(104, maX - miX);
    return { miX, maX, miY, centerX, midY, spanX, spanY, crownTop, crownBottom, topX, topY };
  }

  function drawCanopyFill(rng: () => number, lpts: LeafPoint[], trunk: Trunk, t: number, stage: Stage): CrownGeom | null {
    clear(gCanopyFill);
    clear(gCanopyShade);
    if (stage.name === "Sapling" || lpts.length < 3) return null;
    return crownGeometry(lpts, trunk);
  }

  const LEAF_TONES = {
    hi2: "var(--leaf-hi2)",
    hi: "var(--leaf-hi-warm)",
    lit: "var(--leaf-hi)",
    lite2: "var(--leaf-e)",
    mid: "var(--leaf-c)",
    midB: "var(--leaf-a)",
    deep: "var(--leaf-d)",
    deepB: "var(--leaf-b)",
    shade: "var(--leaf-shade)",
    shade2: "var(--leaf-shade2)",
  };
  function toneForPos(u: number, v: number): string {
    const lum = 1 - (u * 0.62 + v * 0.7) / 1.32;
    if (lum > 0.82) return LEAF_TONES.lit;
    if (lum > 0.66) return LEAF_TONES.lite2;
    if (lum > 0.52) return LEAF_TONES.mid;
    if (lum > 0.4) return LEAF_TONES.midB;
    if (lum > 0.28) return LEAF_TONES.deep;
    if (lum > 0.15) return LEAF_TONES.deepB;
    return LEAF_TONES.shade;
  }

  interface Clump {
    x: number;
    y: number;
    rx: number;
    ry: number;
    bridge: boolean;
  }
  function crownClumps(rng: () => number, G: CrownGeom, trunk: Trunk): Clump[] {
    const cx = G.centerX,
      cy = G.midY,
      sx = G.spanX,
      sy = G.spanY;
    const clumps: Clump[] = [];
    const layout = [
      { dx: 0.0, dy: -0.42, rs: 0.54, bridge: 0 },
      { dx: -0.52, dy: -0.02, rs: 0.5, bridge: 0 },
      { dx: 0.52, dy: 0.0, rs: 0.5, bridge: 0 },
      { dx: -0.3, dy: 0.38, rs: 0.45, bridge: 0 },
      { dx: 0.32, dy: 0.4, rs: 0.45, bridge: 0 },
      { dx: 0.02, dy: 0.64, rs: 0.32, bridge: 1 },
    ];
    for (let i = 0; i < layout.length; i++) {
      const L = layout[i];
      const jx = (rng() - 0.5) * sx * 0.06,
        jy = (rng() - 0.5) * sy * 0.06;
      let ex = cx + L.dx * sx * 0.5 + jx;
      let ey = cy + L.dy * sy * 0.5 + jy;
      if (L.bridge) {
        ex = ex * 0.45 + trunk.topX * 0.55;
        ey = trunk.topY + 6 + (rng() - 0.5) * 8;
      }
      const rx = sx * L.rs * 0.5 * (0.92 + rng() * 0.18);
      const ry = sy * L.rs * 0.5 * (0.92 + rng() * 0.18);
      clumps.push({ x: ex, y: ey, rx: rx, ry: ry, bridge: !!L.bridge });
    }
    return clumps;
  }

  const AUTUMN_TONES = ["#e6b25a", "#d99a4e", "#c98a3a", "#b5641f", "#a9651f", "#8c5318", "#7a4a16"];
  function autumnLeafTone(l: number): string {
    let idx = Math.round((1 - l) * (AUTUMN_TONES.length - 1));
    if (idx < 0) idx = 0;
    if (idx > AUTUMN_TONES.length - 1) idx = AUTUMN_TONES.length - 1;
    return AUTUMN_TONES[idx];
  }

  function toneFromLum(l: number): string {
    if (l > 0.9) return LEAF_TONES.hi2;
    if (l > 0.8) return LEAF_TONES.hi;
    if (l > 0.7) return LEAF_TONES.lit;
    if (l > 0.6) return LEAF_TONES.lite2;
    if (l > 0.5) return LEAF_TONES.mid;
    if (l > 0.4) return LEAF_TONES.midB;
    if (l > 0.3) return LEAF_TONES.deep;
    if (l > 0.2) return LEAF_TONES.deepB;
    if (l > 0.11) return LEAF_TONES.shade;
    return LEAF_TONES.shade2;
  }

  interface Leaf {
    x: number;
    y: number;
    ang: number;
    u: number;
    v: number;
    depthBack: number;
    lum: number;
  }
  function scatterLeaves(rng: () => number, clumps: Clump[], G: CrownGeom, density: number, target: number): Leaf[] {
    const minX = G.miX,
      maxX = G.maX;
    const cyTop = G.crownTop,
      cyBot = G.crownBottom;
    let out: Leaf[] = [];
    for (let c = 0; c < clumps.length; c++) {
      const cl = clumps[c];
      const per = Math.max(6, Math.round((density * (cl.bridge ? 0.55 : 1) * (cl.rx * cl.ry)) / 520));
      for (let i = 0; i < per; i++) {
        const ang0 = rng() * Math.PI * 2;
        const rr = Math.sqrt(rng());
        const lx = cl.x + Math.cos(ang0) * cl.rx * rr;
        const ly = cl.y + Math.sin(ang0) * cl.ry * rr;
        const outAng = Math.atan2(ly - cl.y, lx - cl.x);
        const ang = outAng * 0.72 + (-Math.PI / 2) * 0.28 + (rng() - 0.5) * 0.55;
        let u = (lx - minX) / Math.max(1, maxX - minX);
        let v = (ly - cyTop) / Math.max(1, cyBot - cyTop);
        if (u < 0) u = 0;
        if (u > 1) u = 1;
        if (v < 0) v = 0;
        if (v > 1) v = 1;
        const lu = (lx - cl.x) / Math.max(1, cl.rx),
          lv = (ly - cl.y) / Math.max(1, cl.ry);
        const globalLum = 1 - (u * 0.55 + v * 0.62) / 1.17;
        const localLum = 0.5 - (lu * 0.34 + lv * 0.44);
        let lum = globalLum * 0.5 + localLum * 0.5 + (rng() - 0.5) * 0.24;
        if (lum < 0) lum = 0;
        if (lum > 1) lum = 1;
        const depthBack = rr * 0.6 + rng() * 0.4;
        out.push({ x: lx, y: ly, ang: ang, u: u, v: v, depthBack: depthBack, lum: lum });
      }
    }
    out.sort((a, b) => b.depthBack - a.depthBack);
    if (target && out.length > target) {
      const trimmed: Leaf[] = [];
      const stepF = out.length / target;
      for (let q = 0; q < target; q++) trimmed.push(out[Math.floor(q * stepF)]);
      out = trimmed;
    }
    return out;
  }

  function drawDapples(rng: () => number, G: CrownGeom | null, trunk: Trunk, t: number, stage: Stage, leafScale: number) {
    clear(gDapples);
    if (!G || stage.name === "Sapling") return;
    const cx = G.centerX,
      cy = G.midY;
    const n = 5 + Math.round(t * 5);
    for (let i = 0; i < n; i++) {
      const u = rng(),
        v = rng();
      const ax = cx + (u * 0.85 - 0.62) * G.spanX * 0.5;
      const ay = cy + (v * 0.85 - 0.66) * G.spanY * 0.55;
      const ang = -Math.PI / 2 + (rng() - 0.5) * 1.4;
      const col = rng() < 0.4 ? LEAF_TONES.hi : LEAF_TONES.lit;
      const op = 0.85 + rng() * 0.12;
      const dly = state.animate ? 0.55 + i * 0.02 : 0;
      gDapples.appendChild(leafMark(rng, ax, ay, ang, leafScale, col, op, 0.82, dly));
    }
  }

  function drawSky() {
    clear(gSky);
    gSky.appendChild(el("rect", { x: "0", y: "0", width: String(VIEW_W), height: String(VIEW_H), fill: "url(#ot-sky-grad)" }));
    if (!state.night) return;
    const srng = makeRng((BASE_SEED + 909) >>> 0);
    const mx = 396,
      my = 64,
      mr = 21;
    for (let i = 0; i < 26; i++) {
      const x = 18 + srng() * (VIEW_W - 36);
      const y = 14 + srng() * 150;
      if (Math.hypot(x - mx, y - my) < mr + 16) continue;
      const r = 0.5 + srng() * 1.3;
      const st = el("circle", { cx: x.toFixed(1), cy: y.toFixed(1), r: r.toFixed(2), fill: "#f3edda", class: "ot-star" });
      (st as SVGElement).style.animationDelay = (srng() * 3.6).toFixed(2) + "s";
      gSky.appendChild(st);
    }
    gSky.appendChild(el("circle", { cx: String(mx), cy: String(my), r: String(mr + 13), fill: "url(#ot-moon-halo)" }));
    gSky.appendChild(el("circle", { cx: String(mx), cy: String(my), r: String(mr), fill: "url(#ot-moon-grad)" }));
    gSky.appendChild(el("circle", { cx: (mx + 8.5).toFixed(1), cy: (my - 4).toFixed(1), r: String(mr - 1.5), fill: "var(--sky-top)" }));
  }

  function birdGlyph(robin: boolean): SVGElement {
    const g = el("g", {});
    const bob = el("g", { class: "ot-bird-bob" });
    const tail = el("g", { class: "ot-bird-tail" });
    tail.appendChild(el("path", { d: "M -5 0.5 L -13 -2.4 L -12.5 1.2 L -13 4 Z", fill: robin ? "#5a4632" : "#5b6b74" }));
    bob.appendChild(tail);
    bob.appendChild(el("ellipse", { cx: "0", cy: "0", rx: "7.2", ry: "6.0", fill: robin ? "#6b513a" : "#6c7b84" }));
    bob.appendChild(el("path", { d: "M 1.5 -4.6 Q 8 -2 6.8 4.2 Q 2.5 6.2 -1 4.8 Q -1.2 -0.5 1.5 -4.6 Z", fill: robin ? "#d98a4e" : "#cdd6da" }));
    bob.appendChild(el("path", { d: "M -1 -2.4 Q -8 -1.6 -6.2 3 Q -2.5 3.4 0.4 1.2 Q 0.8 -1.4 -1 -2.4 Z", fill: robin ? "#4f3c2b" : "#566169", opacity: "0.95" }));
    bob.appendChild(el("circle", { cx: "5.4", cy: "-4.4", r: "3.7", fill: robin ? "#6b513a" : "#6c7b84" }));
    bob.appendChild(el("path", { d: "M 8.8 -4.6 L 12.4 -3.7 L 8.8 -2.8 Z", fill: "#e8b048" }));
    bob.appendChild(el("circle", { cx: "6.4", cy: "-4.9", r: "0.95", fill: "#1c140c" }));
    bob.appendChild(el("circle", { cx: "6.65", cy: "-5.15", r: "0.32", fill: "#fff", opacity: "0.9" }));
    bob.appendChild(el("path", { d: "M -1.5 5.6 L -1.5 8 M 2 5.8 L 2 8.1", stroke: robin ? "#3c2e1f" : "#3f474c", "stroke-width": "0.9", "stroke-linecap": "round" }));
    g.appendChild(bob);
    return g;
  }

  function drawBirds(G: CrownGeom | null, trunk: Trunk, week: number, stage: Stage) {
    clear(gBirds);
    if (state.night) return;
    if (stage.name === "Sapling" || stage.name === "Young tree" || !G) return;
    let n: number;
    // Base birds by stage; a real logging streak brings extra birds (reachable
    // day tiers — the prototype's 80 was tuned for a different streak scale).
    if (stage.name === "Mature canopy") n = 1 + (state.streak >= 21 ? 1 : 0);
    else if (stage.name === "Flowering") n = 2 + (state.streak >= 21 ? 1 : 0);
    else n = 2 + (state.streak >= 14 ? 1 : 0);
    n = Math.max(1, Math.min(3, n));
    const brng = makeRng((BASE_SEED + 617) >>> 0);
    const cand: LeafPoint[] = [];
    for (let i = 0; i < leafPoints.length; i++) {
      const p = leafPoints[i];
      if (p.y < G.midY + 6) cand.push(p);
    }
    for (let s = cand.length - 1; s > 0; s--) {
      const j = Math.floor(brng() * (s + 1));
      const tmp = cand[s];
      cand[s] = cand[j];
      cand[j] = tmp;
    }
    const picks: { x: number; y: number }[] = [];
    if (cand.length) {
      for (let k = 0; k < n && k < cand.length; k++) picks.push({ x: cand[k].x, y: cand[k].y });
    }
    while (picks.length < n) {
      const u = (picks.length + 1) / (n + 1);
      picks.push({ x: G.centerX + (u - 0.5) * G.spanX * 0.6, y: G.midY - G.spanY * 0.12 });
    }
    for (let b = 0; b < picks.length; b++) {
      const pk = picks[b];
      const robin = b === 0;
      const face = brng() < 0.5 ? -1 : 1;
      const bg = birdGlyph(robin);
      bboxAdd(pk.x - 13, pk.y - 12);
      bboxAdd(pk.x + 13, pk.y + 9);
      bg.setAttribute("transform", "translate(" + pk.x.toFixed(1) + " " + pk.y.toFixed(1) + ") scale(" + face + ",1)");
      (bg as SVGElement).style.setProperty("animation-delay", (-b * 0.7).toFixed(1) + "s");
      gBirds.appendChild(bg);
    }
  }

  function drawFireflies(G: CrownGeom | null, week: number, stage: Stage) {
    clear(gFireflies);
    if (!state.night || !G || stage.name === "Sapling") return;
    const t = Math.min(week, 13) / 13;
    const n = 7 + Math.round(t * 6);
    const frng = makeRng((BASE_SEED + 733) >>> 0);
    for (let i = 0; i < n; i++) {
      const ang = frng() * Math.PI * 2,
        rr = Math.sqrt(frng());
      const fx = G.centerX + Math.cos(ang) * G.spanX * 0.46 * rr;
      const fy = G.midY + Math.sin(ang) * G.spanY * 0.46 * rr;
      const r = 1.0 + frng() * 1.0;
      const fg = el("g", {});
      fg.appendChild(el("circle", { cx: fx.toFixed(1), cy: fy.toFixed(1), r: (r + 2.6).toFixed(1), fill: "url(#ot-gold-glow)", opacity: "0.7" }));
      const core = el("circle", { cx: fx.toFixed(1), cy: fy.toFixed(1), r: r.toFixed(1), fill: "#fff1ad", opacity: "0.95" });
      fg.appendChild(core);
      const dur = (3.4 + frng() * 3.2).toFixed(1);
      const dx = ((frng() - 0.5) * 22).toFixed(1),
        dy = ((frng() - 0.5) * 18).toFixed(1);
      fg.appendChild(
        el("animateTransform", {
          attributeName: "transform",
          type: "translate",
          values: "0 0; " + dx + " " + dy + "; 0 0",
          dur: dur + "s",
          repeatCount: "indefinite",
          begin: (-frng() * 4).toFixed(1) + "s",
          additive: "sum",
        }),
      );
      const blink = el("animate", {
        attributeName: "opacity",
        values: "0.15;1;0.3;0.9;0.15",
        dur: (2.2 + frng() * 2.4).toFixed(1) + "s",
        repeatCount: "indefinite",
        begin: (-frng() * 3).toFixed(1) + "s",
      });
      core.appendChild(blink);
      gFireflies.appendChild(fg);
    }
  }

  function drawPerson(trunk: Trunk, week: number, stage: Stage) {
    clear(gPerson);
    if (stage.name === "Sapling" || stage.name === "Young tree") return;
    const reclined = stage.name === "Fruiting";
    const baseX = trunk.baseX,
      baseY = trunk.baseY;
    const skin = "#e3b48a",
      hair = "#4a3422";
    const shirt = state.night ? "#7b8f9c" : "#b9683f";
    const pants = state.night ? "#54616b" : "#6d5237";
    const g = el("g", {});

    if (!reclined) {
      const px = baseX - trunk.baseW - 22;
      const gy = baseY;
      const PS = 1.4;
      g.setAttribute("transform", "translate(" + px.toFixed(1) + " " + gy.toFixed(1) + ") scale(" + PS + ")");
      g.appendChild(el("ellipse", { cx: "4", cy: "1.5", rx: "17", ry: "4", fill: "var(--ground-shadow)", opacity: "0.6" }));
      g.appendChild(el("path", { d: "M 2 0 Q 16 -2 17 -10 Q 17 -15 12 -15 Q 9 -8 -1 -3 Z", fill: pants }));
      g.appendChild(el("path", { d: "M -4 -3 Q -9 -16 -3 -24 Q 4 -26 6 -18 Q 5 -8 2 -2 Z", fill: shirt }));
      g.appendChild(el("path", { d: "M 2 -18 Q 9 -16 13 -11", fill: "none", stroke: shirt, "stroke-width": "4.4", "stroke-linecap": "round" }));
      g.appendChild(el("circle", { cx: "-2.5", cy: "-29", r: "5.4", fill: skin }));
      g.appendChild(el("path", { d: "M -8 -30 Q -6 -36 0 -35 Q 4 -34 3.2 -29 Q -1 -32 -8 -30 Z", fill: hair }));
      g.appendChild(el("rect", { x: "11", y: "-13.5", width: "4.4", height: "4", rx: "1", fill: "#efe4cf", stroke: "#b79b6e", "stroke-width": "0.6" }));
      bboxAdd(px - 11 * PS, gy - 37 * PS);
      bboxAdd(px + 19 * PS, gy + 4 * PS);
    } else {
      const px2 = baseX - trunk.baseW - 8;
      const gy2 = baseY;
      const PS2 = 1.45;
      g.setAttribute("transform", "translate(" + px2.toFixed(1) + " " + gy2.toFixed(1) + ") scale(" + PS2 + ")");
      g.appendChild(el("ellipse", { cx: "-12", cy: "1.5", rx: "30", ry: "4.5", fill: "var(--ground-shadow)", opacity: "0.6" }));
      g.appendChild(el("path", { d: "M -2 -2 L -34 -2 Q -38 -2 -38 -5 L -36 -7 L -4 -7 Z", fill: pants }));
      g.appendChild(el("path", { d: "M -6 -3 Q -12 -9 -18 -6 L -16 -2 Z", fill: pants, opacity: "0.95" }));
      g.appendChild(el("path", { d: "M 1 -3 Q 8 -5 8 -13 Q 7 -19 0 -18 L -6 -6 Z", fill: shirt }));
      g.appendChild(el("circle", { cx: "6", cy: "-19", r: "5.2", fill: skin }));
      g.appendChild(el("path", { d: "M 1 -21 Q 3 -27 9 -25 Q 12 -23 10 -19 Q 6 -22 1 -21 Z", fill: hair }));
      g.appendChild(el("path", { d: "M 2 -13 Q -3 -16 -6 -20", fill: "none", stroke: shirt, "stroke-width": "4.2", "stroke-linecap": "round" }));
      g.appendChild(el("path", { d: "M -11 -22 L -3 -24 L -3 -19 L -11 -17 Z", fill: "#efe6d4", stroke: "#b79b6e", "stroke-width": "0.6" }));
      g.appendChild(el("line", { x1: "-7", y1: "-23", x2: "-7", y2: "-17.5", stroke: "#b79b6e", "stroke-width": "0.6" }));
      bboxAdd(px2 - 40 * PS2, gy2 - 29 * PS2);
      bboxAdd(px2 + 14 * PS2, gy2 + 4 * PS2);
    }
    gPerson.appendChild(g);
  }

  // ── butterflies + bee (Flowering onward, day) ──
  const BFLY_COLS = [
    { wing: "#d99a4e", wing2: "#e9c187", spot: "#8c5318" },
    { wing: "#c98a78", wing2: "#e6b8c8", spot: "#8c4a3a" },
    { wing: "#e8ddc4", wing2: "#f4efe6", spot: "#a9651f" },
  ];
  function butterflyGlyph(col: { wing: string; wing2: string; spot: string }, scale: number): SVGElement {
    const s = scale || 1;
    const g = el("g", { transform: "scale(" + s.toFixed(2) + ")" });
    const lw = el("g", { class: "ot-wing-l" });
    lw.appendChild(el("path", { d: "M 0 0 C -10 -9 -13 -3 -11 2 C -10 5 -4 4 0 1 Z", fill: col.wing, stroke: col.spot, "stroke-width": "0.5", "stroke-linejoin": "round" }));
    lw.appendChild(el("path", { d: "M 0 1 C -8 3 -10 8 -8 10 C -5 11 -2 7 0 3 Z", fill: col.wing2, stroke: col.spot, "stroke-width": "0.4", "stroke-linejoin": "round" }));
    lw.appendChild(el("circle", { cx: "-6.5", cy: "-2.2", r: "1.3", fill: col.spot, opacity: "0.55" }));
    g.appendChild(lw);
    const rw = el("g", { class: "ot-wing-r" });
    rw.appendChild(el("path", { d: "M 0 0 C 10 -9 13 -3 11 2 C 10 5 4 4 0 1 Z", fill: col.wing, stroke: col.spot, "stroke-width": "0.5", "stroke-linejoin": "round" }));
    rw.appendChild(el("path", { d: "M 0 1 C 8 3 10 8 8 10 C 5 11 2 7 0 3 Z", fill: col.wing2, stroke: col.spot, "stroke-width": "0.4", "stroke-linejoin": "round" }));
    rw.appendChild(el("circle", { cx: "6.5", cy: "-2.2", r: "1.3", fill: col.spot, opacity: "0.55" }));
    g.appendChild(rw);
    g.appendChild(el("ellipse", { cx: "0", cy: "1", rx: "1.2", ry: "5.2", fill: "#3a2c1c" }));
    g.appendChild(el("circle", { cx: "0", cy: "-4.4", r: "1.5", fill: "#2c2013" }));
    g.appendChild(el("path", { d: "M -0.6 -5.4 Q -3 -8.5 -4.4 -8.8 M 0.6 -5.4 Q 3 -8.5 4.4 -8.8", fill: "none", stroke: "#2c2013", "stroke-width": "0.5", "stroke-linecap": "round" }));
    g.appendChild(el("circle", { cx: "-4.4", cy: "-8.8", r: "0.6", fill: "#2c2013" }));
    g.appendChild(el("circle", { cx: "4.4", cy: "-8.8", r: "0.6", fill: "#2c2013" }));
    return g;
  }
  function beeGlyph(scale: number): SVGElement {
    const s = scale || 1;
    const g = el("g", { transform: "scale(" + s.toFixed(2) + ")" });
    const wl = el("g", { class: "ot-bwing" });
    wl.appendChild(el("ellipse", { cx: "-2.4", cy: "-4.6", rx: "4.2", ry: "2.6", fill: "#eef4f7", stroke: "#c4d2d8", "stroke-width": "0.4", opacity: "0.55", transform: "rotate(-24 -2.4 -4.6)" }));
    const wr = el("g", { class: "ot-bwing" });
    wr.appendChild(el("ellipse", { cx: "2.4", cy: "-4.6", rx: "4.2", ry: "2.6", fill: "#eef4f7", stroke: "#c4d2d8", "stroke-width": "0.4", opacity: "0.55", transform: "rotate(24 2.4 -4.6)" }));
    g.appendChild(wl);
    g.appendChild(wr);
    g.appendChild(el("ellipse", { cx: "0", cy: "0", rx: "5.4", ry: "4.2", fill: "#e7a92e", stroke: "#a9651f", "stroke-width": "0.6" }));
    g.appendChild(el("path", { d: "M -3.6 -2.2 Q 0 -3 3.6 -2.2", fill: "none", stroke: "#3a2c1c", "stroke-width": "1.5", "stroke-linecap": "round" }));
    g.appendChild(el("path", { d: "M -4.4 0.4 Q 0 -0.2 4.4 0.4", fill: "none", stroke: "#3a2c1c", "stroke-width": "1.7", "stroke-linecap": "round" }));
    g.appendChild(el("path", { d: "M -3.4 2.8 Q 0 2.4 3.4 2.8", fill: "none", stroke: "#3a2c1c", "stroke-width": "1.4", "stroke-linecap": "round" }));
    g.appendChild(el("circle", { cx: "5.2", cy: "-1.4", r: "2.8", fill: "#3a2c1c" }));
    g.appendChild(el("circle", { cx: "6.1", cy: "-2.0", r: "0.7", fill: "#fff", opacity: "0.9" }));
    return g;
  }
  function drawFlitters(G: CrownGeom | null, trunk: Trunk, week: number, stage: Stage) {
    clear(gFlitters);
    if (state.night || !G) return;
    if (stage.name !== "Flowering" && stage.name !== "Fruiting") return;
    const frng = makeRng((BASE_SEED + 821) >>> 0);
    const nB = stage.name === "Fruiting" ? 3 : 2;
    const flitCls = ["ot-flit-a", "ot-flit-b", "ot-flit-c"];
    for (let i = 0; i < nB; i++) {
      const ang = frng() * Math.PI * 2,
        rr = 0.5 + frng() * 0.5;
      let bx = G.centerX + Math.cos(ang) * G.spanX * 0.5 * rr;
      let by = G.midY - G.spanY * 0.14 + Math.sin(ang) * G.spanY * 0.34 * rr;
      bx = Math.max(28, Math.min(VIEW_W - 28, bx));
      by = Math.max(24, Math.min(360, by));
      const col = BFLY_COLS[i % BFLY_COLS.length];
      const drift = el("g", { class: flitCls[i % flitCls.length] });
      (drift as SVGElement).style.animationDelay = (-frng() * 8).toFixed(1) + "s";
      const bfly = butterflyGlyph(col, 0.92 + frng() * 0.3);
      const wings = bfly.querySelectorAll(".ot-wing-l,.ot-wing-r");
      for (let w = 0; w < wings.length; w++) (wings[w] as SVGElement).style.animationDelay = (-frng() * 0.9).toFixed(2) + "s";
      drift.appendChild(bfly);
      const holder = el("g", { transform: "translate(" + bx.toFixed(1) + " " + by.toFixed(1) + ")" });
      holder.appendChild(drift);
      gFlitters.appendChild(holder);
    }
    let ex = G.centerX + (frng() < 0.5 ? -1 : 1) * G.spanX * 0.34;
    let ey = G.midY + G.spanY * 0.18;
    ex = Math.max(30, Math.min(VIEW_W - 30, ex));
    ey = Math.max(24, Math.min(360, ey));
    const bdrift = el("g", { class: "ot-flit-bee" });
    (bdrift as SVGElement).style.animationDelay = (-frng() * 8).toFixed(1) + "s";
    bdrift.appendChild(beeGlyph(0.95 + frng() * 0.2));
    const bholder = el("g", { transform: "translate(" + ex.toFixed(1) + " " + ey.toFixed(1) + ")" });
    bholder.appendChild(bdrift);
    gFlitters.appendChild(bholder);
  }

  function flowerGlyph(rng: () => number, gx: number, gy: number, h: number): SVGElement {
    const g = el("g", { class: "ot-fnod" });
    const petalCols = [
      ["#e6b8c8", "#c98a78"],
      ["#f0cf9c", "#d99a4e"],
      ["#efe6d4", "#c9b58f"],
    ];
    const pc = petalCols[(rng() * petalCols.length) | 0];
    const stemTopY = gy - h;
    g.appendChild(el("path", { d: "M " + gx.toFixed(1) + " " + gy.toFixed(1) + " Q " + (gx + (rng() - 0.5) * 2).toFixed(1) + " " + (gy - h * 0.5).toFixed(1) + " " + gx.toFixed(1) + " " + stemTopY.toFixed(1), fill: "none", stroke: "#5c7a52", "stroke-width": "1", "stroke-linecap": "round" }));
    const lys = gy - h * 0.45;
    g.appendChild(el("path", { d: "M " + gx.toFixed(1) + " " + lys.toFixed(1) + " q 4 -1.6 5.2 1.4 q -3.4 1.6 -5.2 -1.4 z", fill: "#5c7a52", opacity: "0.9" }));
    const pr = 2.3 + rng() * 0.6;
    for (let p = 0; p < 5; p++) {
      const pa = (p / 5) * Math.PI * 2 - Math.PI / 2;
      const cx = gx + Math.cos(pa) * pr,
        cy = stemTopY + Math.sin(pa) * pr;
      g.appendChild(el("ellipse", { cx: cx.toFixed(1), cy: cy.toFixed(1), rx: "2.0", ry: "1.4", fill: p % 2 ? pc[1] : pc[0], transform: "rotate(" + ((pa * 180) / Math.PI + 90).toFixed(1) + " " + cx.toFixed(1) + " " + cy.toFixed(1) + ")", opacity: "0.96" }));
    }
    g.appendChild(el("circle", { cx: gx.toFixed(1), cy: stemTopY.toFixed(1), r: "1.5", fill: "#f2b743" }));
    g.appendChild(el("circle", { cx: (gx - 0.4).toFixed(1), cy: (stemTopY - 0.4).toFixed(1), r: "0.5", fill: "#fff7e8", opacity: "0.9" }));
    bboxAdd(gx - pr - 2, stemTopY - pr - 1);
    bboxAdd(gx + pr + 5, gy + 1);
    return g;
  }
  function mushroomGlyph(rng: () => number, gx: number, gy: number, sc: number): SVGElement {
    const g = el("g", {});
    const red = rng() < 0.6;
    const cap = red ? "#c15b3e" : "#efe4cf";
    const capEdge = red ? "#9a4128" : "#cdbf9a";
    const cw = (5 + rng() * 2.2) * sc,
      ch = (3.2 + rng() * 1.2) * sc,
      sh = (4.5 + rng() * 2) * sc,
      sw = (1.8 + rng() * 0.6) * sc;
    g.appendChild(el("ellipse", { cx: gx.toFixed(1), cy: (gy + 0.6).toFixed(1), rx: (cw * 0.8).toFixed(1), ry: "1.4", fill: "var(--ground-shadow)", opacity: "0.5" }));
    g.appendChild(el("path", { d: "M " + (gx - sw).toFixed(1) + " " + gy.toFixed(1) + " Q " + (gx - sw * 0.6).toFixed(1) + " " + (gy - sh).toFixed(1) + " " + gx.toFixed(1) + " " + (gy - sh).toFixed(1) + " Q " + (gx + sw * 0.6).toFixed(1) + " " + (gy - sh).toFixed(1) + " " + (gx + sw).toFixed(1) + " " + gy.toFixed(1) + " Z", fill: "#f2ead8", stroke: "#d8ccb0", "stroke-width": "0.5" }));
    g.appendChild(el("path", { d: "M " + (gx - cw).toFixed(1) + " " + (gy - sh).toFixed(1) + " Q " + gx.toFixed(1) + " " + (gy - sh - ch * 2).toFixed(1) + " " + (gx + cw).toFixed(1) + " " + (gy - sh).toFixed(1) + " Q " + gx.toFixed(1) + " " + (gy - sh + 1.2).toFixed(1) + " " + (gx - cw).toFixed(1) + " " + (gy - sh).toFixed(1) + " Z", fill: cap, stroke: capEdge, "stroke-width": "0.6", "stroke-linejoin": "round" }));
    if (red) {
      g.appendChild(el("circle", { cx: (gx - cw * 0.4).toFixed(1), cy: (gy - sh - ch * 0.8).toFixed(1), r: (0.9 * sc).toFixed(1), fill: "#f6ecd6", opacity: "0.92" }));
      g.appendChild(el("circle", { cx: (gx + cw * 0.35).toFixed(1), cy: (gy - sh - ch * 0.6).toFixed(1), r: (0.7 * sc).toFixed(1), fill: "#f6ecd6", opacity: "0.92" }));
      g.appendChild(el("circle", { cx: gx.toFixed(1), cy: (gy - sh - ch * 1.15).toFixed(1), r: (0.6 * sc).toFixed(1), fill: "#f6ecd6", opacity: "0.92" }));
    }
    bboxAdd(gx - cw - 1, gy - sh - ch * 2 - 1);
    bboxAdd(gx + cw + 1, gy + 2);
    return g;
  }
  function drawGroundFlora(rng: () => number, trunk: Trunk, week: number, stage: Stage) {
    clear(gGroundFlora);
    if (stage.name === "Sapling") return;
    const t = Math.min(week, 13) / 13;
    const baseX = trunk.baseX,
      baseY = trunk.baseY;
    const nFlowers = 3 + Math.round(t * 6);
    const nMush = 1 + Math.round(t * 3);
    function pickX(): number {
      const side = rng() < 0.5 ? -1 : 1;
      const off = trunk.baseW + 6 + rng() * 118;
      return baseX + side * off;
    }
    for (let i = 0; i < nFlowers; i++) {
      let gx = pickX();
      if (gx < baseX - 8 && gx > baseX - 72) gx = baseX - 74 - rng() * 40;
      const h = 8 + rng() * 9;
      const gy = baseY + 1 + rng() * 1.5;
      gGroundFlora.appendChild(flowerGlyph(rng, gx, gy, h));
    }
    for (let m = 0; m < nMush; m++) {
      let mx = pickX();
      if (mx < baseX - 8 && mx > baseX - 72) mx = baseX + 12 + rng() * 90;
      const my = baseY + 1 + rng() * 1.5;
      gGroundFlora.appendChild(mushroomGlyph(rng, mx, my, 0.9 + rng() * 0.5));
    }
  }

  function drawNest(G: CrownGeom | null, trunk: Trunk, week: number, stage: Stage) {
    clear(gNest);
    if (!G) return;
    const showNest = week >= 6;
    if (!showNest) return;
    const showEggs = week >= 9;
    const showChicks = week >= 12;
    const nrng = makeRng((BASE_SEED + 655) >>> 0);
    const cand: LeafPoint[] = [];
    for (let i = 0; i < leafPoints.length; i++) {
      const p = leafPoints[i];
      if (p.y < G.midY + 2 && p.y > G.crownTop + 6 && Math.abs(p.x - G.centerX) > G.spanX * 0.1) cand.push(p);
    }
    let nx: number, ny: number;
    if (cand.length) {
      const pick = cand[Math.floor(nrng() * cand.length)];
      nx = pick.x;
      ny = pick.y;
    } else {
      nx = G.centerX - G.spanX * 0.2;
      ny = G.midY - G.spanY * 0.1;
    }
    nx = Math.max(G.miX + 10, Math.min(G.maX - 10, nx));
    const dim = state.night ? 0.6 : 1;
    const g = el("g", { transform: "translate(" + nx.toFixed(1) + " " + ny.toFixed(1) + ")", opacity: dim.toFixed(2) });
    const NW = 11,
      NH = 6;
    g.appendChild(el("path", { d: "M " + -NW + " -1 Q " + -NW * 0.7 + " " + NH + " 0 " + NH + " Q " + NW * 0.7 + " " + NH + " " + NW + " -1 Q " + NW * 0.5 + " 2 0 2.4 Q " + -NW * 0.5 + " 2 " + -NW + " -1 Z", fill: "#7a5c3a", stroke: "#5a4228", "stroke-width": "0.7", "stroke-linejoin": "round" }));
    g.appendChild(el("ellipse", { cx: "0", cy: "0.6", rx: (NW * 0.72).toFixed(1), ry: "2.6", fill: "#4a3620" }));
    const twrng = makeRng((BASE_SEED + 656) >>> 0);
    for (let w = 0; w < 7; w++) {
      const wx = -NW * 0.8 + w * ((NW * 1.6) / 6);
      g.appendChild(el("path", { d: "M " + wx.toFixed(1) + " 0 q " + ((twrng() - 0.5) * 3).toFixed(1) + " " + (NH * 0.7).toFixed(1) + " " + ((twrng() - 0.5) * 2).toFixed(1) + " " + (NH * 0.9).toFixed(1), fill: "none", stroke: "#63492c", "stroke-width": "0.6", opacity: "0.7", "stroke-linecap": "round" }));
    }
    g.appendChild(el("path", { d: "M " + (-NW - 3) + " 0.5 L " + (-NW + 3) + " -0.5", stroke: "#63492c", "stroke-width": "0.7", "stroke-linecap": "round" }));
    g.appendChild(el("path", { d: "M " + (NW - 3) + " -0.6 L " + (NW + 4) + " 0.6", stroke: "#63492c", "stroke-width": "0.7", "stroke-linecap": "round" }));

    if (showChicks) {
      const nChicks = state.streak >= 14 || week >= 13 ? 3 : 2;
      const slots = nChicks === 3 ? [-5.5, 0, 5.5] : [-4, 4];
      for (let c = 0; c < nChicks; c++) {
        const chx = slots[c];
        const chick = el("g", { class: "ot-chick", transform: "translate(" + chx + " -2)" });
        (chick as SVGElement).style.animationDelay = (-c * 0.5).toFixed(1) + "s";
        chick.appendChild(el("circle", { cx: "0", cy: "-2.4", r: "3", fill: "#8a6a44" }));
        chick.appendChild(el("circle", { cx: "0", cy: "-2.4", r: "3", fill: "none", stroke: "#6b5231", "stroke-width": "0.4" }));
        chick.appendChild(el("path", { d: "M -0.6 -5.2 L 0 -6.6 L 0.7 -5.1 Z", fill: "#6b5231" }));
        chick.appendChild(el("circle", { cx: "-0.9", cy: "-3.0", r: "0.75", fill: "#1c140c" }));
        chick.appendChild(el("circle", { cx: "-0.7", cy: "-3.2", r: "0.25", fill: "#fff", opacity: "0.9" }));
        chick.appendChild(el("path", { d: "M 1.4 -2.9 L 4.4 -2.2 L 1.4 -1.6 Z", fill: "#e8a02e", stroke: "#c47f1c", "stroke-width": "0.3" }));
        chick.appendChild(el("path", { d: "M 1.4 -1.9 L 3.8 -1.5 L 1.4 -1.0 Z", fill: "#d98a26", opacity: "0.9" }));
        g.appendChild(chick);
      }
    } else if (showEggs) {
      const eggXs = [-4, 0, 4];
      for (let e = 0; e < 3; e++) {
        const exx = eggXs[e];
        g.appendChild(el("ellipse", { cx: exx.toFixed(1), cy: "-0.4", rx: "2.4", ry: "3.1", fill: "#eae0cf", stroke: "#cbbd9f", "stroke-width": "0.5" }));
        g.appendChild(el("circle", { cx: (exx - 0.7).toFixed(1), cy: "-1.4", r: "0.7", fill: "#fff7ea", opacity: "0.8" }));
        g.appendChild(el("circle", { cx: (exx + 0.6).toFixed(1), cy: "0.4", r: "0.35", fill: "#b39a72", opacity: "0.7" }));
        g.appendChild(el("circle", { cx: (exx - 0.4).toFixed(1), cy: "1.0", r: "0.3", fill: "#b39a72", opacity: "0.6" }));
      }
    }
    bboxAdd(nx - NW - 4, ny - 8);
    bboxAdd(nx + NW + 4, ny + NH + 2);
    gNest.appendChild(g);
  }

  function drawSun(trunk: Trunk, t: number) {
    clear(gSun);
    const r = 70 + t * 46;
    const sx = trunk.topX - 60 - t * 16;
    const sy = trunk.topY - 18;
    gSun.appendChild(el("circle", { cx: sx.toFixed(1), cy: sy.toFixed(1), r: r.toFixed(1), fill: "url(#ot-sun)", filter: "url(#ot-glowblur)" }));
  }

  function applyFit() {
    const bw = Math.max(1, bbox.maxX - bbox.minX);
    const bh = Math.max(1, bbox.maxY - bbox.minY);
    // A young tree has a small natural bbox and would otherwise sit tiny in the
    // frame with a lot of empty sky above it. Let the early stages enlarge (bounded)
    // so they fill the frame nicely from Day 1. Mature+ stay at natural size — and
    // because their natural bbox is far larger, the tree still visibly grows
    // stage-to-stage in absolute terms. Width/height are still bounded by the
    // TARGET_* ratios, so this can never overflow the frame.
    const st = stageFor(state.week);
    const maxUp =
      st.name === "Sapling" ? 1.7 :
      st.name === "Young tree" ? 1.38 :
      st.name === "Mature canopy" ? 1.12 :
      1;
    const scale = Math.min(TARGET_W / bw, TARGET_H / bh, maxUp);
    const cx = (bbox.minX + bbox.maxX) / 2;
    const tx = VIEW_W / 2 - scale * cx;
    const ty = BASELINE_Y - scale * bbox.maxY;
    gScene.setAttribute("transform", "translate(" + tx.toFixed(2) + " " + ty.toFixed(2) + ") scale(" + scale.toFixed(4) + ")");
  }

  function applySeasonClass(cls: string) {
    for (let i = 0; i < SEASON_CLASSES.length; i++) root.classList.remove(SEASON_CLASSES[i]);
    root.classList.add(cls);
  }

  function render() {
    const week = state.week;
    const stage = stageFor(week);
    const rng = makeRng(BASE_SEED);

    leafPoints = [];
    branchSegs = [];
    bboxReset();
    clear(gSun);
    clear(gGlow);
    clear(gGroundShadow);
    clear(gPerson);
    clear(gBranches);
    clear(gCanopyFill);
    clear(gCanopyShade);
    clear(gLeaves);
    clear(gDapples);
    clear(gBlossoms);
    clear(gFruit);
    clear(gFireflies);
    clear(gBirds);
    clear(gFlame);
    clear(gGroundFlora);
    clear(gNest);
    clear(gFlitters);

    const season = seasonForWeek(week);

    drawSky();

    const trunk = buildTrunk(week);
    const t = Math.min(week, 13) / 13;

    if (!state.night) drawSun(trunk, t);

    if (state.night) {
      const grx = 70 + t * 80,
        gry = 60 + t * 70,
        gcx = trunk.topX,
        gcy = trunk.topY + 20;
      bboxAdd(gcx - grx, gcy - gry);
      bboxAdd(gcx + grx, gcy + gry);
      gGlow.appendChild(el("ellipse", { cx: gcx.toFixed(1), cy: gcy.toFixed(1), rx: grx.toFixed(1), ry: gry.toFixed(1), fill: "var(--glow)", opacity: "0.25", filter: "url(#ot-glowblur)" }));
    }

    drawGroundShadow(trunk, t);

    const primaryCount = stage.name === "Sapling" ? 3 : stage.name === "Young tree" ? 4 : 5 + Math.round(rng());
    const startLen = 32 + t * 40;
    const startW = Math.max(1.8, trunk.topW * 1.6);
    const ox = trunk.topX,
      oy = trunk.topY;
    for (let i = 0; i < primaryCount; i++) {
      const frac = primaryCount === 1 ? 0 : i / (primaryCount - 1) - 0.5;
      const ang = -Math.PI / 2 + frac * 1.25 + (rng() - 0.5) * 0.14;
      drawBranch(rng, ox, oy, ang, startLen * (0.9 + rng() * 0.2), stage.depth, startW);
    }
    for (let bs = 0; bs < branchSegs.length; bs++) {
      const seg = branchSegs[bs];
      const bp = el("path", { d: seg.d, fill: "none", stroke: "var(--bark)", "stroke-width": seg.w.toFixed(2), "stroke-linecap": "round", opacity: seg.op.toFixed(2), class: "ot-branch" });
      if (state.animate) {
        (bp as SVGElement).style.setProperty("--len", seg.len.toFixed(1));
        (bp as SVGElement).style.setProperty("--d", (bs * 0.018).toFixed(3) + "s");
      }
      gBranches.appendChild(bp);
    }

    const leafScale = 0.92 + t * 0.5;
    const G = drawCanopyFill(makeRng(BASE_SEED + 55), leafPoints, trunk, t, stage);

    const lrng = makeRng(BASE_SEED + 99);
    let pts = leafPoints.slice();
    for (let s = pts.length - 1; s > 0; s--) {
      const j = Math.floor(lrng() * (s + 1));
      const tmp = pts[s];
      pts[s] = pts[j];
      pts[j] = tmp;
    }
    if (pts.length === 0) pts = leafPoints.length ? leafPoints : [{ x: ox, y: oy, ang: -Math.PI / 2 }];

    let leafIdx = 0;
    if (G) {
      let stageCap =
        stage.name === "Young tree" ? 165 : stage.name === "Mature canopy" ? 300 : stage.name === "Flowering" ? 355 : 405;
      stageCap = Math.min(430, stageCap + state.extraLeaves * 3);
      const density = 540 * stage.leafy;
      const clumps = crownClumps(makeRng(BASE_SEED + 211), G, trunk);
      const leaves = scatterLeaves(makeRng(BASE_SEED + 311), clumps, G, density, stageCap);
      const nLeaf = leaves.length;
      const lf = makeRng(BASE_SEED + 411);
      for (let li = 0; li < nLeaf; li++) {
        const Lf = leaves[li];
        const back = Lf.depthBack;
        const sizeMul = 0.94 + back * 0.34;
        let lum = Lf.lum - back * 0.3;
        if (lum < 0) lum = 0;
        let col = toneFromLum(lum);
        if (season.gold > 0 && lf() < season.gold) col = autumnLeafTone(lum);
        const op = 0.93 + lf() * 0.07;
        const dly = state.animate ? 0.18 + Math.min(li * 0.004, 0.8) : 0;
        gLeaves.appendChild(leafMark(lf, Lf.x, Lf.y, Lf.ang, leafScale, col, op, sizeMul, dly));
        leafIdx++;
      }
      if (leafPoints.length) {
        const trng = makeRng((BASE_SEED + 511) >>> 0);
        const tuft = stage.name === "Mature canopy" || stage.name === "Flowering" || stage.name === "Fruiting" ? 2 : 1;
        let remain = Math.round(stageCap * 0.15);
        for (let tk = 0; tk < leafPoints.length && remain > 0; tk++) {
          const tp = leafPoints[tk];
          let tu = (tp.x - G.miX) / Math.max(1, G.maX - G.miX);
          let tv = (tp.y - G.crownTop) / Math.max(1, G.crownBottom - G.crownTop);
          if (tu < 0) tu = 0;
          if (tu > 1) tu = 1;
          if (tv < 0) tv = 0;
          if (tv > 1) tv = 1;
          const tcol = toneForPos(tu, tv);
          for (let tm = 0; tm < tuft && remain > 0; tm++) {
            const tex = tp.x + (trng() - 0.5) * 7.5;
            const tey = tp.y + (trng() - 0.5) * 7.5;
            const tang = tp.ang - Math.PI / 2 + (trng() - 0.5) * 1.1;
            const tdly = state.animate ? 0.22 + Math.min(leafIdx * 0.004, 0.85) : 0;
            gLeaves.appendChild(leafMark(trng, tex, tey, tang, leafScale, tcol, 0.9 + trng() * 0.1, 0.9, tdly));
            leafIdx++;
            remain--;
          }
        }
      }
    } else {
      const totalLeaves = Math.min(pts.length, Math.round(leafPoints.length * stage.leafy) + state.extraLeaves);
      const lf2 = makeRng(BASE_SEED + 411);
      for (let li2 = 0; li2 < totalLeaves; li2++) {
        const pn = pts[li2];
        const col2 = toneForPos(lf2(), lf2());
        const la = pn.ang - Math.PI / 2 + (lf2() - 0.5) * 2.0;
        const dly2 = state.animate ? 0.18 + li2 * 0.02 : 0;
        gLeaves.appendChild(leafMark(lf2, pn.x + (lf2() - 0.5) * 6, pn.y + (lf2() - 0.5) * 6, la, leafScale, col2, 0.9, 1.0, dly2));
        leafIdx++;
      }
    }

    drawDapples(makeRng(BASE_SEED + 137), G, trunk, t, stage, leafScale);

    const brng = makeRng(BASE_SEED + 7);
    let blossomTarget = 0;
    if (stage.name === "Flowering") blossomTarget = 12;
    if (stage.name === "Fruiting") blossomTarget = 7;
    blossomTarget += state.blossoms * 3;
    blossomTarget = Math.min(blossomTarget, pts.length);
    for (let bi = 0; bi < blossomTarget; bi++) {
      const bpt = pts[(bi * 3 + 1) % pts.length];
      gBlossoms.appendChild(blossomMark(brng, bpt.x + (brng() - 0.5) * 5, bpt.y + (brng() - 0.5) * 5, bi));
    }

    const frng = makeRng(BASE_SEED + 23);
    let baseFruit = 0;
    if (stage.name === "Flowering") baseFruit = 3;
    else if (stage.name === "Fruiting") baseFruit = 9 + Math.round(t * 3);
    let fruitTarget = baseFruit + state.fruit;
    fruitTarget = Math.min(fruitTarget, pts.length);
    let goldenTarget = (stage.name === "Fruiting" ? 1 + (t >= 0.99 ? 1 : 0) : 0);
    goldenTarget = Math.min(goldenTarget, fruitTarget);
    const goldSet: Record<number, boolean> = {};
    const grng = makeRng((BASE_SEED + 24) >>> 0);
    const pool: number[] = [];
    for (let gp = 0; gp < fruitTarget; gp++) pool.push(gp);
    for (let gs = 0; gs < goldenTarget && pool.length; gs++) {
      const gi2 = Math.floor(grng() * pool.length);
      goldSet[pool[gi2]] = true;
      pool.splice(gi2, 1);
    }
    for (let fi = 0; fi < fruitTarget; fi++) {
      const fp = pts[(fi * 5 + 2) % pts.length];
      const fxv = +(fp.x + (frng() - 0.5) * 5).toFixed(1),
        fyv = +(fp.y + 4 + frng() * 4).toFixed(1);
      let kind: string;
      if (goldSet[fi]) {
        kind = "golden";
      } else {
        const ripe = t * 0.9 + (frng() - 0.5) * 0.4;
        kind = ripe < 0.34 ? "green" : ripe < 0.62 ? "blush" : "ripe";
      }
      gFruit.appendChild(fruitMark(fxv, fyv, fi, kind));
    }

    drawNest(G, trunk, week, stage);
    drawBirds(G, trunk, week, stage);
    drawFireflies(G, week, stage);
    drawPerson(trunk, week, stage);
    drawFlitters(G, trunk, week, stage);
    drawGroundFlora(makeRng(BASE_SEED + 480), trunk, week, stage);

    drawRoots(makeRng(BASE_SEED + 41), trunk.baseX, trunk.baseY, week);
    drawMotes(makeRng(BASE_SEED + 71), trunk, week);

    if (state.streak > 0) {
      const fx = trunk.baseX + 16,
        fy = trunk.baseY - 10;
      bboxAdd(fx - 6, fy - 16);
      bboxAdd(fx + 6, fy + 2);
      const fg = el("g", { transform: "translate(" + fx + " " + fy + ")" });
      const flamePath = el("path", { d: "M0 0 C-5 -6 -2 -12 0 -16 C2 -11 6 -10 4 -3 C3 0 0 2 0 0 Z", fill: "var(--ochre)", opacity: "0.92" });
      flamePath.appendChild(el("animateTransform", { attributeName: "transform", type: "scale", values: "1 1; 1.08 0.94; 0.96 1.06; 1 1", dur: "1.4s", repeatCount: "indefinite", additive: "sum" }));
      fg.appendChild(flamePath);
      fg.appendChild(el("path", { d: "M0 -2 C-2 -5 -1 -9 0 -11 C1 -8 3 -7 2 -3 C1.5 -1 0 -1 0 -2 Z", fill: "#f0cf9c" }));
      gFlame.appendChild(fg);
    }

    applyFit();
    applySeasonClass(season.cls);
  }

  // Map the (immutable) TreeState onto the local render state, then render.
  function applyState(s: TreeState) {
    state.week = Math.max(0, s.week);
    state.night = !!s.night;
    state.streak = Math.max(0, s.streak);
    state.extraLeaves = Math.max(0, s.extraLeaves);
    state.blossoms = Math.max(0, s.blossoms);
    state.fruit = Math.max(0, s.fruit);
    if (state.night) root.classList.add("night");
    else root.classList.remove("night");
    render();
  }

  applyState(initial);

  return {
    update(s: TreeState) {
      applyState(s);
    },
    destroy() {
      try {
        root.classList.remove(HOST_CLASS, "night", ...SEASON_CLASSES);
        if (stage.parentNode === root) root.removeChild(stage);
      } catch {
        /* already detached */
      }
    },
  };
}
