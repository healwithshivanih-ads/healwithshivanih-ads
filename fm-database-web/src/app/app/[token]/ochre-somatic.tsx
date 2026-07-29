"use client";

/* ======================================================================
   The Ochre Tree — guided somatic reset (all seven players)

   The practice comes from the catalogue by slug, so the animation can never
   drift from what the coach prescribed: the STEPS drive the timing and the
   cues, and the practice's motion_shape picks which visual runs.

   Seven shapes, derived from the whole 114-practice library rather than
   guessed — see fmdb/assess/motion_shape.py:

     breath_excursion    orb opens and closes on the breath       (28 practices)
     continuous_travel   a light tracing a path, trailing         (23)
     sustained_pressure  meter fills and HOLDS — no release        (20)
     release             a held form lets go and drifts down       (18)
     still               ambient light, no counter                 (11)
     load_release        meter fills, then snaps with ripples      (10)
     checklist           no player; steps tick off                  (4)

   `bilateral` and `reps` are modifiers layered on any shape.
   The drawing itself lives in somatic-shapes.ts.
   ====================================================================== */

import { useEffect, useMemo, useRef, useState } from "react";

import type { AppSomatic } from "@/lib/fmdb/somatic";
import { Icon, useOchre } from "./ochre-context";
import { FALLBACK_RENDERER, SHAPE_RENDERERS } from "./somatic-shapes";

/* ---- overlay ----------------------------------------------------------
   The launch card that used to live here is now SomaticPrescribedLine in
   ochre-mind-body.tsx — Today shows one mind-body entry point, not a card
   per technique. */

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
    const draw = SHAPE_RENDERERS[somatic.shape] ?? FALLBACK_RENDERER;
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
          {/* The mind-body reading is deliberately NOT here. It belongs to a
              CONDITION, not to a practice: looking it up by practice sent
              constructive-rest to the rosacea map and would have told a client
              with constipation "ROSACEA — WHAT YOU CANNOT HIDE".
              `deriveMindBodyReads` resolves it from the client's own
              conditions instead, and it renders on the Plan tab. */}
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
