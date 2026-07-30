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
import { BreathAudio } from "./ochre-breath-audio";
import { Icon, useOchre } from "./ochre-context";
import { SomaticFigure } from "./somatic-figures";
import { breathCycle, FALLBACK_RENDERER, pacedFrame, SHAPE_RENDERERS, stepMode } from "./somatic-shapes";

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

  // The cycle this practice demonstrates, replayed during its "now continue"
  // step. Derived from the steps themselves, so it can never contradict them.
  const cycle = useMemo(() => breathCycle(steps), [steps]);

  const [status, setStatus] = useState<Status>("intro");
  const [idx, setIdx] = useState(0);
  const [left, setLeft] = useState(steps[0]?.secs ?? 0);

  const step = steps[idx];
  const isChecklist = somatic.shape === "checklist" || !somatic.timed;
  // Breath practices are done with the eyes closed, so the screen alone
  // cannot pace them — the same synthesized drone + ocean-wave + bells as the
  // 4-7-8 session carries the rhythm. One sound preference across the app:
  // this reads and writes the SAME key as the breathing overlay.
  const hasSound = somatic.shape === "breath_excursion";
  const [soundOn, setSoundOn] = useState(() => {
    try { return localStorage.getItem("ochre.breathSound") !== "0"; } catch { return true; }
  });
  const audioRef = useRef<BreathAudio | null>(null);
  const lastAction = useRef("");
  const audio = () => {
    if (!audioRef.current) {
      audioRef.current = new BreathAudio();
      audioRef.current.setEnabled(soundOn);
    }
    return audioRef.current;
  };
  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    audioRef.current?.setEnabled(next);
    try { localStorage.setItem("ochre.breathSound", next ? "1" : "0"); } catch { /* private mode */ }
  };
  useEffect(() => () => { audioRef.current?.dispose(); audioRef.current = null; }, []);
  // A `rest` step is a task ("drink a full glass of warm water"), not a rhythm
  // — the client does it and taps Done. The countdown keeps running underneath
  // as a silent fallback so a phone set down never stalls the session.
  const selfPaced = !isChecklist && stepMode(step?.action ?? "") === "self_paced";

  const advance = () => {
    setIdx((i) => {
      if (i + 1 >= steps.length) { setStatus("done"); audioRef.current?.finishChime(); return i; }
      setLeft(steps[i + 1].secs);
      return i + 1;
    });
  };

  // Long paced steps show minutes, not a raw 213.
  const fmt = (v: number) => (v >= 60 ? `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}` : String(v));

  /* countdown */
  useEffect(() => {
    if (status !== "running" || isChecklist) return;
    const id = setInterval(() => {
      setLeft((v) => {
        if (v > 1) return v - 1;
        setIdx((i) => {
          if (i + 1 >= steps.length) { setStatus("done"); audioRef.current?.finishChime(); return i; }
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
  // Seconds into the CURRENT step, accumulated per frame.
  //
  // Not `1 - left / total`: `left` is the displayed countdown and only changes
  // once a second, so the orb was frozen between ticks — a five-second inhale
  // arrived as five discrete jumps rather than a breath. The number on screen
  // stays integer; the movement no longer does.
  const stepElapsed = useRef(0);
  const lastFrame = useRef(0);
  useEffect(() => {
    stepElapsed.current = 0;
    lastFrame.current = 0;
  }, [idx, somatic.slug]);
  useEffect(() => {
    if (isChecklist || selfPaced) return;
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
        const dt = lastFrame.current ? (ms - lastFrame.current) / 1000 : 0;
        lastFrame.current = ms;
        // A paused session holds its position; a backgrounded tab must not
        // fast-forward when it comes back, hence the per-frame cap.
        if (status === "running") stepElapsed.current += Math.min(dt, 0.25);
        // Only the breath player loops a long step. A sustained_pressure
        // "hold" that runs for two minutes is MEANT to run for two minutes —
        // cycling it would undo the one thing that shape is for.
        const paced =
          somatic.shape === "breath_excursion"
            ? pacedFrame(step?.action ?? "", total, stepElapsed.current, cycle)
            : { action: step?.action ?? "", p: Math.min(stepElapsed.current / Math.max(1, total), 1) };
        if (hasSound && status === "running") {
          // lungs-fullness mirror of drawBreath's scale, normalised 0..1
          const a = paced.action;
          const f =
            a === "expand" ? paced.p
            : a === "release" || a === "shrink" || a === "press" ? 1 - paced.p
            : a === "hold" ? 1
            : 0.5;
          audioRef.current?.tick(f);
          if (a !== lastAction.current) {
            lastAction.current = a;
            const bell = a === "expand" ? "expand" : a === "hold" ? "hold" : "shrink";
            audioRef.current?.chime(bell);
          }
        }
        draw(c, w, h, {
          p: status === "running" ? paced.p : 0.5,
          t: (ms - startedAt.current) / 1000,
          action: paced.action, bilateral: somatic.bilateral,
        });
      }
      if (!reduce) raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [somatic.shape, somatic.bilateral, step, left, status, reduce, isChecklist, selfPaced, cycle]);

  const restart = () => { stepElapsed.current = 0; setIdx(0); setLeft(steps[0]?.secs ?? 0); setStatus("running"); };

  return (
    <div className="som-wrap" role="dialog" aria-label={somatic.name}>
      <button className="som-x" onClick={onClose} aria-label="Close">
        <Icon name="x" size={18} />
      </button>
      {hasSound && status !== "intro" && status !== "done" && (
        <button
          className={"som-sound" + (soundOn ? "" : " off")}
          onClick={toggleSound}
          aria-label={soundOn ? "Turn sound off" : "Turn sound on"}
          aria-pressed={soundOn}
        >
          <Icon name={soundOn ? "bell" : "bellOff"} size={17} />
        </button>
      )}

      {status === "intro" && (
        <div className="som-intro">
          <h2 className="som-h">{somatic.name}</h2>
          <SomaticFigure slug={somatic.slug} />
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
          <button
            className="som-cta"
            onClick={() => {
              if (hasSound) audio().start(); // iOS unlocks audio on this tap
              setStatus("running");
            }}
          >
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

      {status !== "intro" && status !== "done" && !isChecklist && selfPaced && (
        <div className="som-stage">
          <div className="som-instr">
            <span className="som-label">{step?.label}</span>
            <p className="som-instr-text">{step?.cue}</p>
          </div>
          <button className="som-cta" onClick={advance}>
            Done — {idx + 1 >= steps.length ? "finish" : "continue"}
          </button>
          <span className="som-auto">or it moves on by itself in {fmt(left)}</span>
          <div className="som-dots" aria-hidden="true">
            {steps.map((_, i) => <span key={i} className={i <= idx ? "on" : ""} />)}
          </div>
        </div>
      )}

      {status !== "intro" && status !== "done" && !isChecklist && !selfPaced && (
        <div className="som-stage">
          <canvas ref={cv} className="som-canvas" />
          <div className="som-cue">
            <span className="som-label">{step?.label}</span>
            <span className="som-text">{step?.cue}</span>
            <span className="som-count">{fmt(left)}</span>
          </div>
          <div className="som-dots" aria-hidden="true">
            {steps.map((_, i) => <span key={i} className={i <= idx ? "on" : ""} />)}
          </div>
          <button
            className="som-pause"
            onClick={() => {
              const next = status === "paused" ? "running" : "paused";
              if (next === "paused") audioRef.current?.suspend();
              else audioRef.current?.resume();
              setStatus(next);
            }}
          >
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
