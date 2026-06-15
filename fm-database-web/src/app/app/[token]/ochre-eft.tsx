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
import { Icon } from "./ochre-context";

const STEP_SECS = 13;
// figure-space coordinates for the 7 points (must match <Figure/>'s viewBox)
const PTS: ReadonlyArray<readonly [number, number]> = [
  [130, 74], [113, 118], [91, 134], [112, 150], [130, 166], [130, 192], [104, 234],
];
const OCHRE = "#c47a35";
const CREAM = "#f8f4ee";
const MUTED = "#7a6f60";
const INK = "#3a342b";

function Figure({ active }: { active: number }) {
  const has = active >= 0 && active < PTS.length;
  const x = has ? PTS[active][0] : 0;
  const y = has ? PTS[active][1] : 0;
  return (
    <svg viewBox="0 0 260 330" width="100%" style={{ maxWidth: 214, display: "block", margin: "0 auto" }} role="img" aria-label="Tapping figure with the active point highlighted">
      <path d="M20 330 C22 270 74 244 110 240 L150 240 C186 244 238 270 240 330 Z" fill="#aec0a6" />
      <path d="M112 244 L112 214 Q130 224 148 214 L148 244 Z" fill="#f0dcc6" />
      <ellipse cx="130" cy="138" rx="58" ry="66" fill="#f1ddc8" />
      <path d="M72 150 C66 92 80 64 130 62 C180 64 194 92 188 150 C184 120 176 96 130 94 C84 96 76 120 72 150 Z" fill="#b07b46" />
      <path d="M70 148 C66 176 70 196 78 210 L86 206 C80 188 78 168 80 150 Z" fill="#b07b46" />
      <path d="M190 148 C194 176 190 196 182 210 L174 206 C180 188 182 168 180 150 Z" fill="#b07b46" />
      <path d="M104 120 q12 -5 22 -1 M134 119 q12 -4 22 1" stroke="#7a6a57" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <path d="M102 134 q12 7 23 1 M135 135 q12 6 23 -1" stroke="#5d5042" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <path d="M130 140 L126 166 q4 4 9 2" stroke="#b89a7c" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M116 182 q14 8 28 0" stroke="#b07a6a" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <g fill={CREAM} stroke="#c2b29a" strokeWidth="1.5">
        {PTS.map(([px, py], i) => (
          <circle key={i} cx={px} cy={py} r="6.5" />
        ))}
      </g>
      {has && (
        <g transform={`translate(${x},${y})`}>
          <circle className="eft-ring" r="15" fill="none" stroke={OCHRE} strokeWidth="2.5" />
          <circle className="eft-ring eft-ring-b" r="15" fill="none" stroke={OCHRE} strokeWidth="2.5" />
          <circle r="6.5" fill={OCHRE} />
        </g>
      )}
    </svg>
  );
}

function Suds({ value, onPick }: { value: number | null; onPick: (n: number) => void }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center", margin: "10px auto 0", maxWidth: 300 }}>
      {Array.from({ length: 11 }).map((_, n) => (
        <button
          key={n}
          onClick={() => onPick(n)}
          aria-pressed={value === n}
          style={{
            width: 30, height: 30, borderRadius: "50%", fontSize: 13,
            border: value === n ? `2px solid ${OCHRE}` : "1px solid #d7cdba",
            background: value === n ? OCHRE : "transparent",
            color: value === n ? "#fff" : MUTED, cursor: "pointer", padding: 0,
          }}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

type Status = "intro" | "running" | "paused" | "done";

export function EftOverlay({ eft, onClose, onComplete }: { eft: AppEft; onClose: () => void; onComplete?: () => void }) {
  const steps: Array<{ kind: "setup" } | { kind: "point"; idx: number }> = [
    { kind: "setup" },
    ...eft.points.map((_, i) => ({ kind: "point" as const, idx: i })),
  ];

  const [status, setStatus] = useState<Status>("intro");
  const [sudsBefore, setSudsBefore] = useState<number | null>(null);
  const [sudsAfter, setSudsAfter] = useState<number | null>(null);
  const idxRef = useRef(0);
  const countRef = useRef(STEP_SECS);
  const [, force] = useState(0);
  const rerender = () => force((x) => (x + 1) % 1_000_000);
  const completedRef = useRef(false);

  useEffect(() => {
    if (status !== "running") return;
    const id = setInterval(() => {
      if (countRef.current > 1) {
        countRef.current -= 1;
        rerender();
        return;
      }
      if (idxRef.current >= steps.length - 1) {
        setStatus("done");
        return;
      }
      idxRef.current += 1;
      countRef.current = STEP_SECS;
      rerender();
    }, 1000);
    return () => clearInterval(id);
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
    countRef.current = STEP_SECS;
    completedRef.current = false;
    setSudsAfter(null);
    setStatus("running");
  };

  const step = steps[idxRef.current];
  const active = status === "running" || status === "paused" ? (step.kind === "point" ? step.idx : -1) : -1;
  const label = step.kind === "setup" ? "Setup · tap the side of your hand" : eft.points[step.idx].label;
  const phrase = step.kind === "setup" ? eft.setup : eft.points[step.idx].phrase;
  const prog = step.kind === "setup" ? "Setup" : `Point ${step.idx + 1} of ${eft.points.length}`;
  const barPct = Math.round(((STEP_SECS - countRef.current) / STEP_SECS) * 100);
  const drop = sudsBefore != null && sudsAfter != null ? sudsBefore - sudsAfter : null;

  return (
    <div style={{ position: "absolute", inset: 0, background: CREAM, display: "flex", flexDirection: "column", overflowY: "auto" }}>
      <style>{`@keyframes eftRing{0%{transform:scale(.3);opacity:.5}100%{transform:scale(1.5);opacity:0}} .eft-ring{transform-box:fill-box;transform-origin:center;animation:eftRing 1.9s ease-out infinite} .eft-ring-b{animation-delay:.95s}`}</style>

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
              <p style={{ fontSize: 13.5, color: MUTED, margin: "16px 0 0" }}>How strong does it feel right now?</p>
              <div style={{ fontSize: 11, color: "#a99b87" }}>0 = none · 10 = very strong</div>
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
          <Figure active={active} />
          <div style={{ fontSize: 12.5, color: "#a99b87", marginTop: 8 }}>{prog}</div>
          <div style={{ fontSize: 16, fontWeight: 500, color: INK, marginTop: 2 }}>{label}</div>
          <p style={{ fontSize: 18, lineHeight: 1.5, color: "#52463a", margin: "10px auto 0", maxWidth: 300, textAlign: "center", fontStyle: "italic", minHeight: 56 }}>
            “{phrase}”
          </p>
          <div style={{ width: 220, height: 4, borderRadius: 2, background: "#e7ddcb", marginTop: 14, overflow: "hidden" }}>
            <div style={{ width: `${barPct}%`, height: "100%", background: OCHRE, transition: "width 1s linear" }} />
          </div>
          <div style={{ fontSize: 12, color: "#a99b87", marginTop: 10 }}>Tap this point gently, about 7 times, as you say the words.</div>
          <button onClick={() => setStatus(status === "running" ? "paused" : "running")} style={{ marginTop: 18, padding: "10px 22px", borderRadius: 999, background: "transparent", color: "#52463a", border: "1px solid #d7cdba", fontSize: 14, cursor: "pointer" }}>
            {status === "running" ? "Pause" : "Resume"}
          </button>
        </div>
      )}

      {status === "done" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", padding: "0 22px 30px", textAlign: "center" }}>
          <div style={{ width: 56, height: 56, borderRadius: "50%", background: "#aec0a6", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="checkBold" size={28} style={{ color: "#fff" }} />
          </div>
          <h2 style={{ fontSize: 18, fontWeight: 500, color: INK, margin: "14px 0 0" }}>Lovely — that's a full round.</h2>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: MUTED, margin: "6px auto 0", maxWidth: 300 }}>
            Take a slow breath. Notice anything that feels even a little softer.
          </p>
          {eft.suds && (
            <>
              <p style={{ fontSize: 13.5, color: MUTED, margin: "18px 0 0" }}>And now — how strong does it feel?</p>
              <Suds value={sudsAfter} onPick={setSudsAfter} />
              {drop != null && drop > 0 && (
                <div style={{ marginTop: 14, fontSize: 14, color: "var(--forest-deep, #3a4d41)", background: "rgba(174,192,166,0.3)", borderRadius: 12, padding: "8px 14px" }}>
                  From {sudsBefore} down to {sudsAfter} — your body let some of it go.
                </div>
              )}
            </>
          )}
          <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
            <button onClick={begin} style={{ padding: "12px 22px", borderRadius: 999, background: OCHRE, color: "#fff", border: "none", fontSize: 14, fontWeight: 500, cursor: "pointer" }}>
              Again
            </button>
            <button onClick={onClose} style={{ padding: "12px 22px", borderRadius: 999, background: "transparent", color: "#52463a", border: "1px solid #d7cdba", fontSize: 14, cursor: "pointer" }}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---- launch card shown in the plan's Daily practices section -------- */
export function EftLaunchCard({ eft, onStart }: { eft: AppEft; onStart: () => void }) {
  return (
    <button
      onClick={onStart}
      style={{
        width: "100%", display: "flex", alignItems: "center", gap: 12, textAlign: "left",
        background: "#f8f4ee", border: "1px solid #e7ddcb", borderRadius: 14, padding: "12px 14px", cursor: "pointer",
      }}
    >
      <span style={{ width: 40, height: 40, borderRadius: "50%", background: "rgba(196,122,53,0.14)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <Icon name="heart" size={20} style={{ color: OCHRE }} />
      </span>
      <span style={{ flex: 1 }}>
        <span style={{ display: "block", fontSize: 11, letterSpacing: ".4px", textTransform: "uppercase", color: "#a99b87" }}>Tapping · guided</span>
        <span style={{ display: "block", fontSize: 15, fontWeight: 500, color: INK }}>{eft.themeLabel}</span>
        <span style={{ display: "block", fontSize: 12, color: MUTED }}>{eft.when} · about 2 minutes</span>
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 4, color: OCHRE, fontSize: 13, fontWeight: 500 }}>
        <Icon name="play" size={15} /> Start
      </span>
    </button>
  );
}
