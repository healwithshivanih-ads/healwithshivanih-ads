"use client";

/* ======================================================================
   The Ochre Tree — Guided EFT (tapping) session → overlay
   ----------------------------------------------------------------------
   A calm, auto-advancing tapping round. A designed figure (NOT generated)
   lights up each point in sequence; the personalised phrase shows; the
   client taps along on their own body. A 0–10 distress rating before and
   after lets them SEE the shift. Driven by data.eft (derived from the
   plan's tapping practice). Phase 1: coach-voiced library script.
   ====================================================================== */

import { useEffect, useRef, useState } from "react";
import type { AppEft } from "@/lib/fmdb/client-app";
import { Icon, useOchre } from "./ochre-context";

// Per-step dwell time. The karate-chop setup needs longer (say the full setup
// sentence ×3); each reminder point is one short phrase + ~7 taps; the closing
// breath is one slow cycle. Tap-to-advance lets the client move sooner.
const SETUP_SECS = 16;
const POINT_SECS = 8;
const BREATH_SECS = 12;
// point coordinates in the illustration's pixel space (478×640) — placed on the
// eft-figure.png face geometry. Order: crown, eyebrow, side of eye, under eye,
// under nose, chin, collarbone. The 8th point (under arm) is off the face and
// renders on its own figure (UnderArmFigure), so it is not in this array.
const PTS: ReadonlyArray<readonly [number, number]> = [
  [242, 170], [215, 244], [188, 261], [214, 276], [242, 300], [242, 330], [220, 416],
];
const OCHRE = "#c47a35";
const CREAM = "#f8f4ee";
const MUTED = "#7a6f60";
const INK = "#3a342b";

// A single prominent, throbbing tapping beacon — expanding rings + a pulsing core.
// Shared by the face, hand, and under-arm figures so the cue reads identically.
function Beacon({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  // radii scale per figure so the beacon reads the same on-screen size regardless
  // of each figure's viewBox width.
  return (
    <g transform={`translate(${x},${y})`}>
      <circle className="eft-ring" r={30 * scale} fill="none" stroke={OCHRE} strokeWidth={5 * scale} />
      <circle className="eft-ring eft-ring-b" r={30 * scale} fill="none" stroke={OCHRE} strokeWidth={5 * scale} />
      <circle className="eft-core" r={15 * scale} fill={OCHRE} stroke="#fff" strokeWidth={3 * scale} />
    </g>
  );
}

// Face figure — shows ONLY the current point, throbbing. No static point map.
function Figure({ active }: { active: number }) {
  const has = active >= 0 && active < PTS.length;
  return (
    <svg viewBox="92 102 300 400" width="100%" style={{ maxWidth: 260, display: "block", margin: "0 auto", borderRadius: 18 }} role="img" aria-label="Tapping figure with the active point highlighted">
      <image href="/ochre-app/eft-figure.png" x="0" y="0" width="478" height="640" preserveAspectRatio="xMidYMid slice" />
      {has && <Beacon x={PTS[active][0]} y={PTS[active][1]} />}
    </svg>
  );
}

// karate-chop point (outer side of the hand, low toward the wrist heel) in eft-hand.png pixel space (440×440)
const HAND_PT: readonly [number, number] = [283, 270];

function HandFigure() {
  return (
    <svg viewBox="55 35 330 360" width="100%" style={{ maxWidth: 226, display: "block", margin: "0 auto", borderRadius: 18 }} role="img" aria-label="The side of the hand — the tapping point for the setup statement">
      <image href="/ochre-app/eft-hand.png" x="0" y="0" width="440" height="440" preserveAspectRatio="xMidYMid slice" />
      <Beacon x={HAND_PT[0]} y={HAND_PT[1]} />
    </svg>
  );
}

// under-arm point (~a hand's width below the armpit, on the side of the ribcage
// under the raised arm — viewer's left) in eft-underarm.png pixel space (1024×1024).
const UNDERARM_PT: readonly [number, number] = [388, 588];

function UnderArmFigure() {
  return (
    <svg viewBox="210 150 620 700" width="100%" style={{ maxWidth: 234, display: "block", margin: "0 auto", borderRadius: 18 }} role="img" aria-label="The side of the ribcage — the under-arm tapping point">
      <image href="/ochre-app/eft-underarm.png" x="0" y="0" width="1024" height="1024" preserveAspectRatio="xMidYMid slice" />
      <Beacon x={UNDERARM_PT[0]} y={UNDERARM_PT[1]} scale={2.3} />
    </svg>
  );
}

// Closing-breath visual — a soft sage orb that gently expands and settles, one
// slow breath cycle. Shown on the final "breath" step before the re-rate.
function BreathOrb() {
  return (
    <svg viewBox="0 0 200 200" width="100%" style={{ maxWidth: 200, display: "block", margin: "0 auto" }} role="img" aria-label="A calming closing breath">
      <circle className="eft-breath-soft" cx="100" cy="100" r="58" fill="rgba(174,192,166,0.18)" />
      <circle className="eft-breath" cx="100" cy="100" r="40" fill="rgba(174,192,166,0.5)" stroke="#aec0a6" strokeWidth="3" />
    </svg>
  );
}

// A calm 0–10 sliding scale. Gradient track reads sage (calm) → ochre (intense);
// both ends are labelled so the number has meaning. Tap or drag anywhere on the track.
function Suds({ value, onPick }: { value: number | null; onPick: (n: number) => void }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const v = value ?? 0;
  const pct = (v / 10) * 100;
  const setFromX = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    onPick(Math.round(p * 10));
  };
  return (
    <div style={{ width: "100%", maxWidth: 320, margin: "12px auto 0" }}>
      <div style={{ textAlign: "center", marginBottom: 12, minHeight: 30 }}>
        {value == null ? (
          <span style={{ fontSize: 13.5, color: MUTED }}>Tap or drag the scale below</span>
        ) : (
          <span style={{ fontSize: 28, fontWeight: 600, color: INK, lineHeight: 1 }}>
            {value}
            <span style={{ fontSize: 14, color: MUTED, fontWeight: 400 }}> / 10</span>
          </span>
        )}
      </div>
      <div
        ref={trackRef}
        role="slider"
        aria-valuemin={0}
        aria-valuemax={10}
        aria-valuenow={value ?? undefined}
        aria-label="How strong does it feel, 0 calm to 10 very strong"
        tabIndex={0}
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
          setFromX(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.buttons) setFromX(e.clientX);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowUp") onPick(Math.min(10, v + 1));
          if (e.key === "ArrowLeft" || e.key === "ArrowDown") onPick(Math.max(0, v - 1));
        }}
        style={{
          position: "relative", height: 16, borderRadius: 999, cursor: "pointer", touchAction: "none",
          background: "linear-gradient(90deg,#aec0a6 0%,#cdbd86 42%,#dca85f 72%,#c47a35 100%)",
          boxShadow: "inset 0 1px 2px rgba(0,0,0,0.08)",
        }}
      >
        {/* once a value is picked, dim the portion beyond it so the fill shows intensity */}
        {value != null && (
          <div style={{ position: "absolute", left: `${pct}%`, right: 0, top: 0, bottom: 0, borderRadius: 999, background: "rgba(248,244,238,0.8)" }} />
        )}
        {value != null && (
          <div style={{
            position: "absolute", left: `${pct}%`, top: "50%", width: 26, height: 26, marginLeft: -13,
            transform: "translateY(-50%)", borderRadius: "50%", background: "#fff",
            border: `3px solid ${OCHRE}`, boxShadow: "0 1px 5px rgba(0,0,0,0.2)",
          }} />
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 9 }}>
        <div style={{ textAlign: "left", maxWidth: 130 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: "#6f7d68" }}>0 · Calm</div>
          <div style={{ fontSize: 11, color: "#a99b87", lineHeight: 1.3 }}>barely there, at ease</div>
        </div>
        <div style={{ textAlign: "right", maxWidth: 130 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: OCHRE }}>10 · Very strong</div>
          <div style={{ fontSize: 11, color: "#a99b87", lineHeight: 1.3 }}>intense, hard to ignore</div>
        </div>
      </div>
    </div>
  );
}

type Status = "intro" | "running" | "paused" | "done";

export function EftOverlay({ eft, onClose, onComplete }: { eft: AppEft; onClose: () => void; onComplete?: () => void }) {
  const steps: Array<{ kind: "setup" } | { kind: "point"; idx: number } | { kind: "breath" }> = [
    { kind: "setup" },
    ...eft.points.map((_, i) => ({ kind: "point" as const, idx: i })),
    { kind: "breath" },
  ];
  const secsForStep = (s: (typeof steps)[number]) =>
    s.kind === "setup" ? SETUP_SECS : s.kind === "breath" ? BREATH_SECS : POINT_SECS;

  const token = useOchre().token;
  const [status, setStatus] = useState<Status>("intro");
  const [sudsBefore, setSudsBefore] = useState<number | null>(null);
  const [sudsAfter, setSudsAfter] = useState<number | null>(null);
  const idxRef = useRef(0);
  const countRef = useRef(SETUP_SECS);
  const [, force] = useState(0);
  const rerender = () => force((x) => (x + 1) % 1_000_000);
  const completedRef = useRef(false);

  // Compliance + effectiveness logging. Fires once per completed round, when the
  // client leaves the done screen (or the overlay unmounts) — so the SUDS
  // before/after delta is captured. Refs mirror state for the unmount path.
  const loggedRef = useRef(false);
  const doneRef = useRef(false);
  const sudsBeforeRef = useRef<number | null>(null);
  const sudsAfterRef = useRef<number | null>(null);
  sudsBeforeRef.current = sudsBefore;
  sudsAfterRef.current = sudsAfter;
  doneRef.current = status === "done";
  const logRound = () => {
    if (loggedRef.current || !token) return;
    loggedRef.current = true;
    try {
      fetch("/api/app-practice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({
          token,
          kind: "eft",
          practice_id: eft.practiceId,
          name: eft.themeLabel,
          theme: eft.theme,
          suds_before: sudsBeforeRef.current,
          suds_after: sudsAfterRef.current,
        }),
      }).catch(() => {});
    } catch {
      /* offline — skip */
    }
  };
  // log on unmount if the round was completed but not yet logged (e.g. app closed)
  useEffect(
    () => () => {
      if (doneRef.current) logRound();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Advance to the next step (used by the auto-timer and the manual "Next" tap).
  const goNext = () => {
    if (idxRef.current >= steps.length - 1) {
      setStatus("done");
      return;
    }
    idxRef.current += 1;
    countRef.current = secsForStep(steps[idxRef.current]);
    rerender();
  };

  useEffect(() => {
    if (status !== "running") return;
    const id = setInterval(() => {
      if (countRef.current > 1) {
        countRef.current -= 1;
        rerender();
        return;
      }
      goNext();
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, steps.length]);

  useEffect(() => {
    if (status === "done" && !completedRef.current) {
      completedRef.current = true;
      try {
        localStorage.setItem(`ochre.eft.${eft.practiceId}.${new Date().toISOString().slice(0, 10)}`, "1");
      } catch {
        /* private mode */
      }
      onComplete?.();
    }
  }, [status, eft.practiceId, onComplete]);

  const begin = () => {
    idxRef.current = 0;
    countRef.current = SETUP_SECS;
    completedRef.current = false;
    loggedRef.current = false;
    setSudsAfter(null);
    setStatus("running");
  };

  const step = steps[idxRef.current];
  const isSetup = step.kind === "setup";
  const isBreath = step.kind === "breath";
  const pointKey = step.kind === "point" ? eft.points[step.idx]?.key : "";
  const active = (status === "running" || status === "paused") && step.kind === "point" ? step.idx : -1;
  const label = isSetup ? "Setup · tap the side of your hand" : isBreath ? "Take a slow breath" : eft.points[step.idx].label;
  const phrase = isSetup
    ? eft.setup
    : isBreath
      ? "Breathe in slowly… and let it all the way out. Let your shoulders drop."
      : eft.points[step.idx].phrase;
  const prog = isSetup ? "Setup" : isBreath ? "Closing breath" : `Point ${step.idx + 1} of ${eft.points.length}`;
  const curSecs = secsForStep(step);
  const barPct = Math.round(((curSecs - countRef.current) / curSecs) * 100);
  const drop = sudsBefore != null && sudsAfter != null ? sudsBefore - sudsAfter : null;

  return (
    <div style={{ position: "absolute", inset: 0, background: CREAM, display: "flex", flexDirection: "column", overflowY: "auto" }}>
      <style>{`@keyframes eftRing{0%{transform:scale(.35);opacity:.6}100%{transform:scale(1.85);opacity:0}} @keyframes eftCore{0%,100%{transform:scale(.82)}50%{transform:scale(1.18)}} @keyframes eftBreath{0%{transform:scale(.78)}50%{transform:scale(1.12)}100%{transform:scale(.78)}} @keyframes eftBreathSoft{0%{transform:scale(.7);opacity:.25}50%{transform:scale(1.3);opacity:.5}100%{transform:scale(.7);opacity:.25}} .eft-ring{transform-box:fill-box;transform-origin:center;animation:eftRing 1.7s ease-out infinite} .eft-ring-b{animation-delay:.85s} .eft-core{transform-box:fill-box;transform-origin:center;animation:eftCore .95s ease-in-out infinite} .eft-breath{transform-box:fill-box;transform-origin:center;animation:eftBreath 7s ease-in-out infinite} .eft-breath-soft{transform-box:fill-box;transform-origin:center;animation:eftBreathSoft 7s ease-in-out infinite}`}</style>

      <button onClick={onClose} aria-label="Close tapping session" style={{ alignSelf: "flex-start", margin: "14px 0 0 14px", background: "none", border: "none", color: MUTED, display: "flex", alignItems: "center", gap: 6, fontSize: 14, cursor: "pointer" }}>
        <Icon name="arrowLeft" size={18} /> Back
      </button>

      <div style={{ textAlign: "center", padding: "4px 18px 0" }}>
        <div style={{ fontSize: 12, letterSpacing: ".5px", textTransform: "uppercase", color: "#9a8c79" }}>Tapping · {eft.themeLabel}</div>
      </div>

      {status === "intro" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", padding: "0 22px 30px", textAlign: "center" }}>
          <Figure active={-1} />
          <p style={{ fontSize: 15, lineHeight: 1.6, color: INK, margin: "12px auto 0", maxWidth: 300 }}>
            Find a quiet moment. We'll tap through a few points together — just follow along on your own body.
          </p>
          {eft.suds && (
            <>
              <p style={{ fontSize: 13.5, color: MUTED, margin: "16px 0 0" }}>{eft.sudsBeforeQ}</p>
              <Suds value={sudsBefore} onPick={setSudsBefore} />
            </>
          )}
          <button onClick={begin} style={{ marginTop: 22, padding: "13px 30px", borderRadius: 999, background: OCHRE, color: "#fff", border: "none", fontSize: 15, fontWeight: 500, cursor: "pointer" }}>
            Begin
          </button>
        </div>
      )}

      {(status === "running" || status === "paused") && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", padding: "0 22px 24px" }}>
          {isSetup
            ? <HandFigure />
            : isBreath
              ? <BreathOrb />
              : pointKey === "under_arm"
                ? <UnderArmFigure />
                : <Figure active={active} />}
          <div style={{ fontSize: 12.5, color: "#a99b87", marginTop: 8 }}>{prog}</div>
          <div style={{ fontSize: 16, fontWeight: 500, color: INK, marginTop: 2 }}>{label}</div>
          <p style={{ fontSize: 18, lineHeight: 1.5, color: "#52463a", margin: "10px auto 0", maxWidth: 300, textAlign: "center", fontStyle: "italic", minHeight: 56 }}>
            {isBreath ? phrase : `“${phrase}”`}
          </p>
          <div style={{ width: 220, height: 4, borderRadius: 2, background: "#e7ddcb", marginTop: 14, overflow: "hidden" }}>
            <div style={{ width: `${barPct}%`, height: "100%", background: OCHRE, transition: "width 1s linear" }} />
          </div>
          <div style={{ fontSize: 12, color: "#a99b87", marginTop: 10 }}>
            {isSetup
              ? "Tap the side of your hand and say the line above, 3 times."
              : isBreath
                ? "No tapping now — just one slow, steady breath."
                : "Tap this point gently, about 7 times, as you say the words."}
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
            <button onClick={() => setStatus(status === "running" ? "paused" : "running")} style={{ padding: "10px 22px", borderRadius: 999, background: "transparent", color: "#52463a", border: "1px solid #d7cdba", fontSize: 14, cursor: "pointer" }}>
              {status === "running" ? "Pause" : "Resume"}
            </button>
            <button onClick={goNext} style={{ padding: "10px 22px", borderRadius: 999, background: OCHRE, color: "#fff", border: "none", fontSize: 14, fontWeight: 500, cursor: "pointer" }}>
              {isBreath ? "Finish ›" : "Next ›"}
            </button>
          </div>
        </div>
      )}

      {status === "done" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", padding: "0 22px 30px", textAlign: "center" }}>
          <div style={{ width: 56, height: 56, borderRadius: "50%", background: "#aec0a6", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="checkBold" size={28} style={{ color: "#fff" }} />
          </div>
          <h2 style={{ fontSize: 18, fontWeight: 500, color: INK, margin: "14px 0 0" }}>Lovely — that's a full round.</h2>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: MUTED, margin: "6px auto 0", maxWidth: 300 }}>
            Notice anything that feels even a little softer — even a small shift counts.
          </p>
          {eft.suds && (
            <>
              <p style={{ fontSize: 13.5, color: MUTED, margin: "18px 0 0" }}>{eft.sudsAfterQ}</p>
              <Suds value={sudsAfter} onPick={setSudsAfter} />
              {drop != null && drop > 0 && (
                <div style={{ marginTop: 14, fontSize: 14, color: "var(--forest-deep, #3a4d41)", background: "rgba(174,192,166,0.3)", borderRadius: 12, padding: "8px 14px" }}>
                  From {sudsBefore} down to {sudsAfter} — your body let some of it go.
                </div>
              )}
            </>
          )}
          <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
            <button onClick={() => { logRound(); begin(); }} style={{ padding: "12px 22px", borderRadius: 999, background: OCHRE, color: "#fff", border: "none", fontSize: 14, fontWeight: 500, cursor: "pointer" }}>
              Again
            </button>
            <button onClick={() => { logRound(); onClose(); }} style={{ padding: "12px 22px", borderRadius: 999, background: "transparent", color: "#52463a", border: "1px solid #d7cdba", fontSize: 14, cursor: "pointer" }}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---- launch card shown in the plan's Daily practices section --------
   Mirrors the breathing launch card (.bw-launch) so the two guided practices
   present consistently — but in the brand's rose, with a softly throbbing
   "tapping" dot instead of the breathing orb. */
export function EftLaunchCard({ eft, onStart }: { eft: AppEft; onStart: () => void }) {
  // "EFT Tapping for Sleep / Stress / Anxiety / Cravings" — the theme is derived
  // from the client's own conditions, so the title reads as customised to them.
  const forX = eft.theme ? eft.theme.charAt(0).toUpperCase() + eft.theme.slice(1) : "Calm";
  return (
    <button className="eft-launch" onClick={onStart}>
      <span className="eftl-orb" aria-hidden="true">
        <span />
      </span>
      <span className="eftl-body">
        <span className="eftl-kicker">Guided · paced for you</span>
        <span className="eftl-title">EFT Tapping for {forX}</span>
        <span className="eftl-meta">{eft.when} · about 2 minutes</span>
      </span>
      <span className="eftl-go">
        <Icon name="heart" size={15} /> Start
      </span>
    </button>
  );
}
