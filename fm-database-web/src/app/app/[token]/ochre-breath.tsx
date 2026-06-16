"use client";

/* ======================================================================
   The Ochre Tree — Guided breathing session (data-driven) → overlay
   ----------------------------------------------------------------------
   An immersive, paced animation. The orb expands on the inhale, holds at
   full, and shrinks on the exhale — for exactly the seconds and rounds
   the coach prescribed (data.breathwork, derived from the plan's
   lifestyle practices). Counts tick down per phase; round dots fill.
   ====================================================================== */

import { useEffect, useRef, useState } from "react";
import type { AppBreathwork } from "@/lib/fmdb/client-app";
import { Icon, useOchre } from "./ochre-context";
import { BreathAudio } from "./ochre-breath-audio";

const SOUND_PREF_KEY = "ochre.breathSound"; // "0" = muted; default is on

/* smooth, breath-like easing for the orb */
function bwEase(p: number): number {
  return 0.5 - 0.5 * Math.cos(Math.PI * Math.min(Math.max(p, 0), 1));
}

const BW_MIN = 0.42; // orb scale at empty lungs
const BW_MAX = 1; // orb scale at full lungs
const RING_C = 2 * Math.PI * 132; // circumference of the progress ring

function bwScale(action: string, p: number): number {
  const e = bwEase(p);
  if (action === "expand") return BW_MIN + (BW_MAX - BW_MIN) * e;
  if (action === "shrink") return BW_MAX - (BW_MAX - BW_MIN) * e;
  return BW_MAX; // hold
}

type Status = "intro" | "running" | "paused" | "done";

export function BreathOverlay({ bw, onClose }: { bw: AppBreathwork; onClose: () => void }) {
  const phases = bw.phases;
  const rounds = bw.rounds;
  const token = useOchre().token;

  // Compliance logging — one record per completed session (no SUDS for breath).
  const logSession = () => {
    if (!token) return;
    const seconds = rounds * phases.reduce((s, p) => s + p.secs, 0);
    try {
      fetch("/api/app-practice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({ token, kind: "breath", practice_id: bw.practiceId, name: bw.name, rounds, seconds }),
      }).catch(() => {});
    } catch {
      /* offline — skip */
    }
  };

  const [status, setStatus] = useState<Status>("intro");
  const [phaseIdx, setPhaseIdx] = useState(0);
  const [round, setRound] = useState(1);
  const [count, setCount] = useState(phases[0].secs);

  // sound on by default; preference remembered on this phone.
  // (Overlay only mounts after a tap, so localStorage is safe to read here.)
  const [soundOn, setSoundOn] = useState(() => {
    try {
      return localStorage.getItem(SOUND_PREF_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const audioRef = useRef<BreathAudio | null>(null);
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
    audio().setEnabled(next);
    try {
      localStorage.setItem(SOUND_PREF_KEY, next ? "1" : "0");
    } catch {
      /* private mode */
    }
  };

  // mutable engine state (refs so the timer loop never goes stale).
  // A setInterval clock — driven by performance.now() timestamps so the
  // counts stay accurate regardless of timer jitter, and keeps ticking even
  // when the page is briefly backgrounded (rAF would simply pause).
  const orbRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<SVGCircleElement>(null);
  const tickRef = useRef(0);
  const startRef = useRef(0); // timestamp the current phase began
  const carryRef = useRef(0); // elapsed carried across a pause
  const phRef = useRef(0);
  const rdRef = useRef(1);
  const runRef = useRef(false);

  const paint = (action: string, p: number) => {
    const scale = bwScale(action, p);
    if (orbRef.current) orbRef.current.style.transform = `scale(${scale})`;
    if (ringRef.current) ringRef.current.style.strokeDashoffset = String(RING_C * (1 - Math.min(p, 1)));
    // the pad's pitch tracks lungs-fullness exactly like the orb does
    audioRef.current?.tick((scale - BW_MIN) / (BW_MAX - BW_MIN));
  };

  const stopLoop = () => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = 0;
  };

  const finish = () => {
    runRef.current = false;
    stopLoop();
    paint("hold", 1);
    audioRef.current?.finishChime();
    logSession();
    setStatus("done");
  };

  // advance to the next phase / round; returns false when the session ends
  const advance = () => {
    if (phRef.current < phases.length - 1) {
      phRef.current += 1;
    } else if (rdRef.current < rounds) {
      rdRef.current += 1;
      phRef.current = 0;
    } else {
      finish();
      return false;
    }
    setPhaseIdx(phRef.current);
    setRound(rdRef.current);
    setCount(phases[phRef.current].secs);
    audioRef.current?.chime(phases[phRef.current].action);
    return true;
  };

  const loop = () => {
    if (!runRef.current) return;
    const now = performance.now();
    if (!startRef.current) startRef.current = now;
    const ph = phases[phRef.current];
    let elapsed = (now - startRef.current) / 1000 + carryRef.current;

    if (elapsed >= ph.secs) {
      carryRef.current = 0;
      startRef.current = now;
      if (!advance()) return; // session complete
      elapsed = 0;
    }
    const cur = phases[phRef.current];
    const p = elapsed / cur.secs;
    paint(cur.action, p);
    const remain = Math.max(1, Math.ceil(cur.secs - elapsed));
    setCount((c) => (c === remain ? c : remain));
  };

  const run = () => {
    stopLoop();
    runRef.current = true;
    loop(); // paint immediately
    tickRef.current = window.setInterval(loop, 50);
  };

  const begin = () => {
    stopLoop();
    phRef.current = 0;
    rdRef.current = 1;
    carryRef.current = 0;
    startRef.current = 0;
    setPhaseIdx(0);
    setRound(1);
    setCount(phases[0].secs);
    setStatus("running");
    // the Begin tap is the user gesture that unlocks audio on iOS
    const au = audio();
    au.reset();
    au.start();
    au.chime(phases[0].action);
    paint("expand", 0);
    run();
  };

  const pause = () => {
    // bank the elapsed time so resume picks up mid-breath
    const ph = phases[phRef.current];
    if (startRef.current)
      carryRef.current = Math.min(carryRef.current + (performance.now() - startRef.current) / 1000, ph.secs);
    runRef.current = false;
    startRef.current = 0;
    stopLoop();
    audioRef.current?.suspend();
    setStatus("paused");
  };

  const resume = () => {
    audioRef.current?.resume();
    setStatus("running");
    run();
  };

  useEffect(
    () => () => {
      runRef.current = false;
      if (tickRef.current) clearInterval(tickRef.current);
      audioRef.current?.dispose();
      audioRef.current = null;
    },
    [],
  );

  const ph = phases[phaseIdx];
  const seq = phases.map((p) => p.secs).join("-"); // e.g. "4-7-8" straight from the data
  const seqLabels = phases.map((p) => (p.action === "expand" ? "in" : p.action === "shrink" ? "out" : "hold"));
  const active = status === "running" || status === "paused";
  const sessionMins = Math.round(((rounds * phases.reduce((s, p) => s + p.secs, 0)) / 60) * 10) / 10;

  return (
    <div className={"bw-stage bw-" + (ph ? ph.action : "hold") + (status === "done" ? " is-done" : "")}>
      <button className="bw-close" onClick={onClose} aria-label="Close breathing session">
        <Icon name="arrowLeft" size={18} /> Back
      </button>

      <button
        className={"bw-sound" + (soundOn ? "" : " off")}
        onClick={toggleSound}
        aria-label={soundOn ? "Turn sound off" : "Turn sound on"}
        aria-pressed={soundOn}
      >
        <Icon name={soundOn ? "bell" : "bellOff"} size={17} />
      </button>

      {/* ---- header ---- */}
      <div className="bw-head">
        <div className="bw-eyebrow">
          <Icon name="breath" size={13} /> Guided breathing
        </div>
        <h2 className="bw-title">{bw.name}</h2>
        <div className="bw-seq">
          {seq.split("-").map((n, i) => (
            <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
              {i > 0 && <span className="bw-seq-dot" />}
              <span className="bw-seq-n">
                {n}
                <small>{seqLabels[i]}</small>
              </span>
            </span>
          ))}
        </div>
      </div>

      {/* ---- the orb ---- */}
      <div className="bw-orb-wrap">
        <div className="bw-rings" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <svg className="bw-ring-svg" viewBox="0 0 300 300" aria-hidden="true">
          <circle cx="150" cy="150" r="132" className="bw-ring-track" />
          <circle
            ref={ringRef}
            cx="150"
            cy="150"
            r="132"
            className="bw-ring-prog"
            style={{ strokeDasharray: RING_C, strokeDashoffset: RING_C }}
          />
        </svg>
        <div ref={orbRef} className="bw-orb" style={{ transform: "scale(" + BW_MIN + ")" }} />
        <div className="bw-readout">
          {status === "done" ? (
            <div className="bw-done-check">
              <Icon name="checkBold" size={30} style={{ color: "#fff" }} />
            </div>
          ) : status === "intro" ? (
            <span className="bw-glyph">
              <Icon name="breath" size={34} />
            </span>
          ) : (
            <div className="bw-count" key={ph.key + count}>
              {count}
            </div>
          )}
        </div>
      </div>

      {/* ---- phase / cue (light text, always on the dark field) ---- */}
      <div className="bw-phaseblock">
        {status === "done" ? (
          <span className="bw-phase">{rounds} rounds complete</span>
        ) : status === "intro" ? (
          <span className="bw-cue lead">Find a comfortable seat — shoulders soft</span>
        ) : (
          <>
            <span className="bw-phase" key={ph.key}>
              {ph.label}
            </span>
            <span className="bw-cue">{ph.cue}</span>
          </>
        )}
      </div>

      {/* ---- round progress ---- */}
      <div className="bw-rounds" aria-label={"Round " + round + " of " + rounds}>
        {Array.from({ length: rounds }).map((_, i) => (
          <span
            key={i}
            className={"bw-rdot" + (status === "done" || i < round - 1 ? " full" : i === round - 1 && active ? " now" : "")}
          />
        ))}
      </div>
      <div className="bw-round-cap">
        {status === "done"
          ? `${rounds} of ${rounds} rounds`
          : active
            ? `Round ${round} of ${rounds}`
            : `${rounds} rounds · about ${sessionMins} min`}
      </div>

      {/* ---- controls ---- */}
      <div className="bw-controls">
        {status === "intro" && (
          <button className="bw-btn primary" onClick={begin}>
            <Icon name="breath" size={17} /> Begin
          </button>
        )}
        {status === "running" && (
          <button className="bw-btn" onClick={pause}>
            <span className="bw-pause-ico" /> Pause
          </button>
        )}
        {status === "paused" && (
          <>
            <button className="bw-btn primary" onClick={resume}>
              <span className="bw-play-ico" /> Resume
            </button>
            <button className="bw-btn ghost" onClick={begin}>
              Restart
            </button>
          </>
        )}
        {status === "done" && (
          <>
            <button className="bw-btn primary" onClick={begin}>
              <Icon name="breath" size={17} /> Again
            </button>
            <button className="bw-btn ghost" onClick={onClose}>
              Done
            </button>
          </>
        )}
      </div>

      <div className="bw-why">
        {status === "done" ? "Beautifully done. Notice how your body feels a little softer now." : bw.why}
      </div>
    </div>
  );
}

/* ---- launch card shown in the plan's Daily practices section -------- */
export function BreathLaunchCard({ bw, onStart }: { bw: AppBreathwork; onStart: () => void }) {
  const seq = bw.phases.map((p) => p.secs).join("-");
  return (
    <button className="bw-launch" onClick={onStart}>
      <span className="bwl-orb" aria-hidden="true">
        <span />
      </span>
      <span className="bwl-body">
        <span className="bwl-kicker">Guided · paced for you</span>
        <span className="bwl-title">{bw.name}</span>
        <span className="bwl-meta">
          {seq} · {bw.rounds} rounds · follow the orb
        </span>
      </span>
      <span className="bwl-go">
        <Icon name="breath" size={16} /> Start
      </span>
    </button>
  );
}
