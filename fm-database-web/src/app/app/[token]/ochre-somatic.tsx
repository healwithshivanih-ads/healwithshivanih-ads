"use client";

/* ======================================================================
   The Ochre Tree — guided somatic reset (all seven players)

   The practice comes from the catalogue by slug, so the animation can never
   drift from what the coach prescribed: the STEPS drive the timing and the
   cues, and the practice's motion_shape picks which visual runs.

   Seven shapes, derived from the whole 114-practice library rather than
   guessed — see fmdb/assess/motion_shape.py:

     breath_excursion    orb scales on the breath                (28 practices)
     continuous_travel   a point tracing a path, with a trail    (23)
     sustained_pressure  meter fills and HOLDS — no release       (20)
     release             decay only; a held form lets go          (18)
     still               ambient glow, no counter                 (11)
     load_release        meter fills, then snaps with a ripple    (10)
     checklist           no player; steps tick off                 (4)

   `bilateral` and `reps` are modifiers layered on any shape.
   ====================================================================== */

import { useEffect, useMemo, useRef, useState } from "react";

import type { AppSomatic } from "@/lib/fmdb/somatic";
import { Icon, useOchre } from "./ochre-context";

/* ---- shared easing --------------------------------------------------- */
const ease = (p: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(Math.max(p, 0), 1));
const easeOut = (p: number) => 1 - Math.pow(1 - p, 3);
const easeIn = (p: number) => p * p * p;

const SAGE = "#8fb79c";
const GLOW = "#c9dcc9";
const WARM = "#f0c98a";
const OCH = "#d9963f";

function rgba(hex: string, a: number) {
  const h = hex.replace("#", "");
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

type Ctx = CanvasRenderingContext2D;

/** What the current step is doing, so a shape can respond to it. */
interface Frame {
  /** 0..1 through the current step */
  p: number;
  /** seconds elapsed overall — drives ambient motion */
  t: number;
  action: string;
  bilateral: boolean;
}

/* ---- the seven renderers --------------------------------------------- */

function drawBreath(c: Ctx, w: number, h: number, f: Frame) {
  const cx = w / 2, cy = h * 0.46, R = Math.min(w, h) * 0.3;
  // expand / release drive the orb; anything else holds it steady
  let scale = 1;
  if (f.action === "expand") scale = 0.44 + 0.56 * ease(f.p);
  else if (f.action === "release" || f.action === "shrink") scale = 1 - 0.56 * ease(f.p);
  else if (f.action === "hold") scale = 1;
  else scale = 0.7 + 0.06 * Math.sin(f.t * 0.9);

  for (let i = 0; i < 3; i++) {
    const rp = ((f.t * 0.4) + i / 3) % 1;
    c.beginPath();
    c.arc(cx, cy, R * (0.55 + rp * 1.5), 0, 7);
    c.strokeStyle = rgba(SAGE, (1 - rp) * 0.16);
    c.lineWidth = 1.1;
    c.stroke();
  }
  const r = R * scale;
  const g = c.createRadialGradient(cx, cy - r * 0.18, r * 0.06, cx, cy, r * 1.05);
  g.addColorStop(0, rgba(GLOW, 0.92));
  g.addColorStop(0.45, rgba(SAGE, 0.6));
  g.addColorStop(1, rgba(SAGE, 0.05));
  c.beginPath(); c.arc(cx, cy, r, 0, 7); c.fillStyle = g; c.fill();
  c.beginPath(); c.arc(cx, cy, r, 0, 7); c.strokeStyle = rgba(GLOW, 0.32); c.lineWidth = 1; c.stroke();
}

function drawTravel(c: Ctx, w: number, h: number, f: Frame) {
  const cx = w / 2, cy = h * 0.46;
  const rx = Math.min(w, h) * 0.28, ry = Math.min(w, h) * 0.21;
  c.save(); c.translate(cx, cy); c.rotate(-0.18);
  c.beginPath(); c.ellipse(0, 0, rx, ry, 0, 0, 7);
  c.strokeStyle = "rgba(255,255,255,.075)"; c.lineWidth = 1;
  c.setLineDash([3, 5]); c.stroke(); c.setLineDash([]);
  const dirs = f.bilateral ? [1, -1] : [1];
  const TR = 24;
  dirs.forEach((dir, k) => {
    for (let i = TR; i >= 0; i--) {
      const a = (f.t * 0.55 - i * 0.022) * Math.PI * 2 * dir + (k ? Math.PI : 0);
      const x = Math.cos(a) * rx, y = Math.sin(a) * ry;
      const fade = 1 - i / TR;
      if (i === 0) {
        const g = c.createRadialGradient(x, y, 0, x, y, 11);
        g.addColorStop(0, rgba(GLOW, 0.95)); g.addColorStop(1, rgba(SAGE, 0));
        c.beginPath(); c.arc(x, y, 11, 0, 7); c.fillStyle = g; c.fill();
        c.beginPath(); c.arc(x, y, 3.4, 0, 7); c.fillStyle = rgba(GLOW, 0.98); c.fill();
      } else {
        c.beginPath(); c.arc(x, y, 3.4 * fade, 0, 7);
        c.fillStyle = rgba(SAGE, 0.5 * fade * fade); c.fill();
      }
    }
  });
  c.restore();
}

/** Shared meter for the two effort shapes; `snap` adds the release event. */
function drawMeter(c: Ctx, w: number, h: number, f: Frame, snap: boolean) {
  const cx = w / 2, cy = h * 0.46, R = Math.min(w, h) * 0.27;
  const loading = f.action === "press" || f.action === "hold" || f.action === "squeeze" || f.action === "tense";
  const releasing = f.action === "release" || f.action === "drop" || f.action === "soften";

  let fill = loading ? easeIn(f.p) : 1;
  let strain = loading ? Math.pow(f.p, 4) : 1;
  let rel = -1;
  if (snap && releasing) { fill = 0; rel = f.p; strain = 0; }
  if (!loading && !releasing) { fill = 0.55 + 0.05 * Math.sin(f.t * 1.4); strain = 0.4; }

  const jitter = strain * 1.6 * Math.sin(f.t * 44);
  c.save(); c.translate(cx + jitter, cy);
  if (rel >= 0) {
    const rr = R * (1 + easeOut(rel) * 1.9);
    c.beginPath(); c.arc(0, 0, rr, 0, 7);
    c.strokeStyle = rgba(WARM, (1 - rel) * 0.5);
    c.lineWidth = 2.6 * (1 - rel) + 0.4; c.stroke();
  }
  c.beginPath(); c.arc(0, 0, R, 0, 7);
  c.strokeStyle = "rgba(255,255,255,.08)"; c.lineWidth = 7; c.stroke();
  if (fill > 0) {
    const col = strain > 0.55 ? WARM : OCH;
    c.beginPath(); c.arc(0, 0, R, -Math.PI / 2, -Math.PI / 2 + fill * Math.PI * 2);
    c.strokeStyle = rgba(col, 0.62 + 0.3 * strain);
    c.lineWidth = 7; c.lineCap = "round"; c.stroke();
    const g = c.createRadialGradient(0, 0, R * 0.1, 0, 0, R * 0.86);
    g.addColorStop(0, rgba(col, 0.3 * strain)); g.addColorStop(1, rgba(col, 0));
    c.beginPath(); c.arc(0, 0, R * 0.86, 0, 7); c.fillStyle = g; c.fill();
  }
  c.restore();
}

let particles: { a: number; r: number; dx: number; sp: number }[] | null = null;
function drawRelease(c: Ctx, w: number, h: number, f: Frame) {
  if (!particles) {
    particles = Array.from({ length: 32 }, () => ({
      a: Math.random() * 7, r: Math.pow(Math.random(), 0.6),
      dx: (Math.random() - 0.5) * 1.5, sp: 0.55 + Math.random() * 0.75,
    }));
  }
  const cx = w / 2, cy = h * 0.38, R = Math.min(w, h) * 0.19;
  const open = easeOut(f.p);
  particles.forEach((o) => {
    const x = cx + Math.cos(o.a) * R * o.r * (1 + open * 1.5 * o.sp) + o.dx * open * 20;
    const y = cy + Math.sin(o.a) * R * o.r * (1 + open * 0.5) + easeIn(open) * h * 0.34 * o.sp;
    const al = (1 - open * 0.85) * (0.35 + 0.65 * o.r);
    const rad = (2.6 - 1.1 * open) * 3.2;
    const g = c.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, rgba(GLOW, al)); g.addColorStop(1, rgba(SAGE, 0));
    c.beginPath(); c.arc(x, y, rad, 0, 7); c.fillStyle = g; c.fill();
  });
  c.beginPath(); c.moveTo(w * 0.24, h * 0.8); c.lineTo(w * 0.76, h * 0.8);
  c.strokeStyle = "rgba(255,255,255,.07)"; c.lineWidth = 1; c.stroke();
}

function drawStill(c: Ctx, w: number, h: number, f: Frame) {
  const cx = w / 2, cy = h * 0.46, R = Math.min(w, h) * 0.33;
  const b = 0.5 + 0.5 * Math.sin(f.t * 0.4);
  for (let i = 3; i >= 1; i--) {
    const rr = R * (0.5 + i * 0.24) * (1 + b * 0.028);
    const g = c.createRadialGradient(cx, cy, rr * 0.2, cx, cy, rr);
    g.addColorStop(0, rgba(SAGE, 0.055 + 0.03 * b)); g.addColorStop(1, rgba(SAGE, 0));
    c.beginPath(); c.arc(cx, cy, rr, 0, 7); c.fillStyle = g; c.fill();
  }
  const cr = R * 0.115 * (1 + b * 0.06);
  const cg = c.createRadialGradient(cx, cy, 0, cx, cy, cr * 2.6);
  cg.addColorStop(0, rgba(GLOW, 0.5 + 0.16 * b)); cg.addColorStop(1, rgba(GLOW, 0));
  c.beginPath(); c.arc(cx, cy, cr * 2.6, 0, 7); c.fillStyle = cg; c.fill();
  c.beginPath(); c.arc(cx, cy, cr, 0, 7); c.fillStyle = rgba(GLOW, 0.6); c.fill();
  const a = f.t * 0.2;
  c.beginPath(); c.arc(cx + Math.cos(a) * R * 0.86, cy + Math.sin(a) * R * 0.86, 1.7, 0, 7);
  c.fillStyle = rgba(GLOW, 0.3); c.fill();
}

const RENDERERS: Record<string, (c: Ctx, w: number, h: number, f: Frame) => void> = {
  breath_excursion: drawBreath,
  continuous_travel: drawTravel,
  release: drawRelease,
  still: drawStill,
  load_release: (c, w, h, f) => drawMeter(c, w, h, f, true),
  sustained_pressure: (c, w, h, f) => drawMeter(c, w, h, f, false),
};

/* ---- launch card ------------------------------------------------------ */

export function SomaticLaunchCard({ somatic, onStart }: { somatic: AppSomatic; onStart: () => void }) {
  const mins = somatic.totalSeconds ? Math.max(1, Math.round(somatic.totalSeconds / 60)) : null;
  return (
    <button className="som-launch" onClick={onStart}>
      <span className="soml-orb" aria-hidden="true"><span /></span>
      <span className="soml-body">
        <span className="soml-kicker">Guided{somatic.bilateral ? " · both sides" : ""}</span>
        <span className="soml-title">{somatic.name}</span>
        <span className="soml-meta">
          {somatic.when}{mins ? ` · about ${mins} min` : ""}
        </span>
      </span>
      <span className="soml-go"><Icon name="today" size={15} /> Start</span>
    </button>
  );
}

/* ---- overlay ---------------------------------------------------------- */

type Status = "intro" | "running" | "paused" | "done";

export function SomaticOverlay({ somatic, onClose }: { somatic: AppSomatic; onClose: () => void }) {
  const token = useOchre().token;
  const reduce = useMemo(
    () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );
  // A step with no duration is self-paced; give it a sane default so the
  // session still advances rather than stalling on an untimed cue.
  const steps = useMemo(
    () => somatic.steps.map((s) => ({ ...s, secs: s.secs && s.secs > 0 ? s.secs : 20 })),
    [somatic.steps],
  );

  const [status, setStatus] = useState<Status>("intro");
  const [idx, setIdx] = useState(0);
  const [left, setLeft] = useState(steps[0]?.secs ?? 0);

  const step = steps[idx];
  const isChecklist = somatic.shape === "checklist" || !somatic.timed;

  /* countdown */
  useEffect(() => {
    if (status !== "running" || isChecklist) return;
    const id = setInterval(() => {
      setLeft((v) => {
        if (v > 1) return v - 1;
        setIdx((i) => {
          if (i + 1 >= steps.length) { setStatus("done"); return i; }
          setLeft(steps[i + 1].secs);
          return i + 1;
        });
        return 0;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [status, steps, isChecklist]);

  /* one compliance record per completed session */
  useEffect(() => {
    if (status !== "done" || !token) return;
    try {
      fetch("/api/app-practice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({
          token, kind: "somatic", practice_id: somatic.practiceId,
          name: somatic.name, seconds: somatic.totalSeconds ?? null, slug: somatic.slug,
        }),
      }).catch(() => {});
    } catch { /* offline — skip */ }
  }, [status, token, somatic]);

  /* canvas */
  const cv = useRef<HTMLCanvasElement | null>(null);
  const startedAt = useRef<number>(0);
  useEffect(() => {
    if (isChecklist) return;
    const el = cv.current;
    if (!el) return;
    const draw = RENDERERS[somatic.shape] ?? drawStill;
    let raf = 0;
    const render = (ms: number) => {
      if (!startedAt.current) startedAt.current = ms;
      const d = Math.min(devicePixelRatio || 1, 2);
      const r = el.getBoundingClientRect();
      el.width = Math.max(1, Math.round(r.width * d));
      el.height = Math.max(1, Math.round(r.height * d));
      const c = el.getContext("2d");
      if (c) {
        c.setTransform(d, 0, 0, d, 0, 0);
        const w = el.width / d, h = el.height / d;
        c.clearRect(0, 0, w, h);
        const total = step?.secs ?? 1;
        const p = status === "running" ? 1 - left / Math.max(1, total) : 0.5;
        draw(c, w, h, {
          p, t: (ms - startedAt.current) / 1000,
          action: step?.action ?? "", bilateral: somatic.bilateral,
        });
      }
      if (!reduce) raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [somatic.shape, somatic.bilateral, step, left, status, reduce, isChecklist]);

  const restart = () => { setIdx(0); setLeft(steps[0]?.secs ?? 0); setStatus("running"); };

  return (
    <div className="som-wrap" role="dialog" aria-label={somatic.name}>
      <button className="som-x" onClick={onClose} aria-label="Close">
        <Icon name="x" size={18} />
      </button>

      {status === "intro" && (
        <div className="som-intro">
          <h2 className="som-h">{somatic.name}</h2>
          <p className="som-why">{somatic.why}</p>
          {somatic.equipment.length > 0 && (
            <p className="som-kit">You&apos;ll need: {somatic.equipment.join(", ")}</p>
          )}
          <button className="som-cta" onClick={() => setStatus("running")}>
            {isChecklist ? "Show me the steps" : "Begin"}
          </button>
        </div>
      )}

      {status !== "intro" && status !== "done" && isChecklist && (
        <div className="som-list">
          <h2 className="som-h">{somatic.name}</h2>
          <ol>
            {steps.map((s, i) => (
              <li key={i}><strong>{s.label}</strong><span>{s.cue}</span></li>
            ))}
          </ol>
          <button className="som-cta" onClick={() => setStatus("done")}>Done</button>
        </div>
      )}

      {status !== "intro" && status !== "done" && !isChecklist && (
        <div className="som-stage">
          <canvas ref={cv} className="som-canvas" />
          <div className="som-cue">
            <span className="som-label">{step?.label}</span>
            <span className="som-text">{step?.cue}</span>
            <span className="som-count">{left}</span>
          </div>
          <div className="som-dots" aria-hidden="true">
            {steps.map((_, i) => <span key={i} className={i <= idx ? "on" : ""} />)}
          </div>
          <button className="som-pause" onClick={() => setStatus(status === "paused" ? "running" : "paused")}>
            {status === "paused" ? "Resume" : "Pause"}
          </button>
        </div>
      )}

      {status === "done" && (
        <div className="som-intro">
          <h2 className="som-h">Done</h2>
          <p className="som-why">
            {somatic.bilateral
              ? "That's both sides. Notice how it feels now compared with when you started."
              : "Notice how that feels now compared with when you started."}
          </p>
          <button className="som-cta" onClick={onClose}>Close</button>
          <button className="som-again" onClick={restart}>Again</button>
        </div>
      )}
    </div>
  );
}
