"use client";

/* ======================================================================
   The Ochre Tree — Guided sleep wind-down → overlay
   ----------------------------------------------------------------------
   A lie-down progressive relaxation: slow breathing → head-to-toe release
   → drift-off close. Deliberately DARK + minimal (a bright screen fights
   sleep). No SUDS — sleep isn't a distress rating. Logs a completion to
   _practice_log.jsonl (kind "sleep"). Mind-body drip technique #3.
   Phase 2: her-voice narration (the real upgrade for eyes-closed use).
   ====================================================================== */

import { useEffect, useRef, useState } from "react";
import type { AppSleep } from "@/lib/fmdb/client-app";
import { Icon, useOchre } from "./ochre-context";

const INK = "#e9e5dc"; // soft cream text on the dark field
const DIM = "#8b8aa0"; // dim secondary

type Status = "intro" | "running" | "paused" | "done";

function Orb({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 200 200" width="100%" style={{ maxWidth: 180, display: "block", margin: "0 auto" }} aria-hidden="true">
      <circle cx="100" cy="100" r="62" fill="rgba(120,128,190,0.10)" className={active ? "slp-soft" : ""} />
      <circle cx="100" cy="100" r="40" fill="rgba(150,158,220,0.20)" stroke="rgba(180,188,235,0.45)" strokeWidth="1.5" className={active ? "slp-orb" : ""} />
    </svg>
  );
}

export function SleepOverlay({ sleep, onClose }: { sleep: AppSleep; onClose: () => void }) {
  const token = useOchre().token;
  const steps = sleep.steps;
  const [status, setStatus] = useState<Status>("intro");
  const idxRef = useRef(0);
  const countRef = useRef(steps[0]?.secs ?? 20);
  const [, force] = useState(0);
  const rerender = () => force((x) => (x + 1) % 1_000_000);
  const loggedRef = useRef(false);

  const totalSecs = steps.reduce((s, st) => s + st.secs, 0);
  const logSession = () => {
    if (loggedRef.current || !token) return;
    loggedRef.current = true;
    try {
      fetch("/api/app-practice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({ token, kind: "sleep", practice_id: sleep.practiceId, name: "Sleep wind-down", seconds: totalSecs }),
      }).catch(() => {});
    } catch {
      /* offline — skip */
    }
  };

  const goNext = () => {
    if (idxRef.current >= steps.length - 1) {
      setStatus("done");
      return;
    }
    idxRef.current += 1;
    countRef.current = steps[idxRef.current].secs;
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
    if (status === "done") logSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const begin = () => {
    idxRef.current = 0;
    countRef.current = steps[0].secs;
    loggedRef.current = false;
    setStatus("running");
  };

  const step = steps[idxRef.current];
  const running = status === "running" || status === "paused";
  const stepSecs = step?.secs ?? 1;
  const barPct = Math.round(((stepSecs - countRef.current) / stepSecs) * 100);

  return (
    <div style={{ position: "absolute", inset: 0, background: "#191c2b", display: "flex", flexDirection: "column", overflowY: "auto", color: INK }}>
      <style>{`@keyframes slpOrb{0%,100%{transform:scale(.82)}50%{transform:scale(1.06)}} @keyframes slpSoft{0%,100%{transform:scale(.7);opacity:.5}50%{transform:scale(1.15);opacity:.85}} .slp-orb{transform-box:fill-box;transform-origin:center;animation:slpOrb 9s ease-in-out infinite} .slp-soft{transform-box:fill-box;transform-origin:center;animation:slpSoft 9s ease-in-out infinite}`}</style>

      <button
        onClick={() => {
          if (status === "done" || running) logSession();
          onClose();
        }}
        aria-label="Close wind-down"
        style={{ alignSelf: "flex-start", margin: "14px 0 0 14px", background: "none", border: "none", color: DIM, display: "flex", alignItems: "center", gap: 6, fontSize: 14, cursor: "pointer" }}
      >
        <Icon name="arrowLeft" size={18} /> Back
      </button>

      <div style={{ textAlign: "center", padding: "4px 18px 0" }}>
        <div style={{ fontSize: 12, letterSpacing: ".5px", textTransform: "uppercase", color: DIM }}>Wind down · in bed</div>
      </div>

      {status === "intro" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", padding: "0 24px 36px", textAlign: "center" }}>
          <Orb active={false} />
          <p style={{ fontSize: 15.5, lineHeight: 1.6, color: INK, margin: "18px auto 0", maxWidth: 300 }}>
            Get comfortable and let your eyes soften. We'll let the body go heavy together — no need to try to sleep.
          </p>
          <p style={{ fontSize: 12.5, color: DIM, margin: "12px 0 0" }}>Lower your screen brightness if you can.</p>
          <button onClick={begin} style={{ marginTop: 24, padding: "13px 30px", borderRadius: 999, background: "#5b6196", color: "#fff", border: "none", fontSize: 15, fontWeight: 500, cursor: "pointer" }}>
            Begin
          </button>
        </div>
      )}

      {running && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", padding: "0 24px 28px" }}>
          <Orb active={status === "running"} />
          <div style={{ fontSize: 12.5, color: DIM, marginTop: 14 }}>{step.label}</div>
          <p style={{ fontSize: 18, lineHeight: 1.6, color: INK, margin: "10px auto 0", maxWidth: 300, textAlign: "center", minHeight: 84 }}>
            {step.cue}
          </p>
          <div style={{ width: 220, height: 3, borderRadius: 2, background: "rgba(255,255,255,0.10)", marginTop: 16, overflow: "hidden" }}>
            <div style={{ width: `${barPct}%`, height: "100%", background: "#6b72a8", transition: "width 1s linear" }} />
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
            <button onClick={() => setStatus(status === "running" ? "paused" : "running")} style={{ padding: "10px 22px", borderRadius: 999, background: "transparent", color: INK, border: "1px solid rgba(255,255,255,0.2)", fontSize: 14, cursor: "pointer" }}>
              {status === "running" ? "Pause" : "Resume"}
            </button>
            <button onClick={goNext} style={{ padding: "10px 22px", borderRadius: 999, background: "rgba(255,255,255,0.10)", color: INK, border: "none", fontSize: 14, cursor: "pointer" }}>
              {idxRef.current >= steps.length - 1 ? "Finish ›" : "Next ›"}
            </button>
          </div>
        </div>
      )}

      {status === "done" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", padding: "0 24px 40px", textAlign: "center" }}>
          <div style={{ width: 56, height: 56, borderRadius: "50%", background: "rgba(150,158,220,0.25)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="moon" size={26} style={{ color: "#c9cdf0" }} />
          </div>
          <h2 style={{ fontSize: 18, fontWeight: 500, color: INK, margin: "16px 0 0" }}>Sleep well.</h2>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: DIM, margin: "8px auto 0", maxWidth: 290 }}>
            Set your phone down, let your eyes close, and let the night take it from here.
          </p>
          <button onClick={onClose} style={{ marginTop: 24, padding: "12px 26px", borderRadius: 999, background: "transparent", color: INK, border: "1px solid rgba(255,255,255,0.2)", fontSize: 14, cursor: "pointer" }}>
            Goodnight
          </button>
        </div>
      )}
    </div>
  );
}

/* ---- launch card shown in the plan's Daily practices section ----------
   Mirrors the breathing + EFT cards, in a deep night-indigo. */
export function SleepLaunchCard({ sleep, onStart }: { sleep: AppSleep; onStart: () => void }) {
  return (
    <button className="slp-launch" onClick={onStart}>
      <span className="slpl-orb" aria-hidden="true">
        <span />
      </span>
      <span className="slpl-body">
        <span className="slpl-kicker">Guided · in bed</span>
        <span className="slpl-title">Wind down for sleep</span>
        <span className="slpl-meta">{sleep.when} · about 5 minutes</span>
      </span>
      <span className="slpl-go">
        <Icon name="moon" size={15} /> Start
      </span>
    </button>
  );
}
