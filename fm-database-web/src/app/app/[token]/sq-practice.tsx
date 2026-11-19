"use client";

/**
 * THE PRACTICE PLAYER — one screen for tapping, the sleep wind-down, body
 * resets and breathing, over a slow scene with the coach's voice.
 *
 * What is on screen (the coach's decision): the step, Previous / Pause / Next,
 * Dim and Close. Voice, Music, Volume, Pace and Scene are behind one Settings
 * button, so nothing competes with the words at 3 am.
 *
 * What it remembers on the phone (sq-practice-data.ts PracticePrefs): pace,
 * volume, voice and music, a chosen scene, and where she stopped in a
 * practice she did not finish. Reopening that practice opens it PAUSED, with
 * Resume and Start again.
 *
 * Timing lives in sq-practice-data.ts (pure, tested). Sound lives in
 * sq-sound.ts. This file only schedules one against the other.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { AppEftTheme, ClientAppData } from "@/lib/fmdb/client-app";
import {
  PACES,
  SCENES,
  SCENE_KEYS,
  VOLUME_LEVELS,
  breathAt,
  breathTotalSeconds,
  clock,
  dimByDefault,
  resetSteps,
  sleepSteps,
  tapSteps,
  tapVoiced,
  timeline,
  type PStep,
  type PracticePrefs,
  type SceneKey,
  type SqPractice,
  type VoiceSet,
} from "./sq-practice-data";
import { sqSound } from "./sq-sound";
import { SqIcon } from "./sq-ui";

/** What a finished practice reports, for the tick and the coach's log. */
export interface PracticeResult {
  practice: SqPractice;
  seconds: number;
  theme?: string;
  sudsBefore?: number | null;
  sudsAfter?: number | null;
}

// ── tapping figures ────────────────────────────────────────────────────────

/** Tapping points on the face picture, in its own pixels: top of the head,
 *  eyebrow, side of the eye, under the eye, under the nose, chin, collarbone. */
const FACE_POINTS: [number, number][] = [
  [242, 170],
  [215, 244],
  [188, 261],
  [214, 276],
  [242, 300],
  [242, 330],
  [220, 416],
];

function Beacon({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle className="sq-eft-ring" r={30 * s} fill="none" stroke="var(--sq-fire)" strokeWidth={5 * s} />
      <circle className="sq-eft-ring sq-eft-ring-b" r={30 * s} fill="none" stroke="var(--sq-fire)" strokeWidth={5 * s} />
      <circle className="sq-eft-core" r={15 * s} fill="var(--sq-fire)" stroke="#fff" strokeWidth={3 * s} />
    </g>
  );
}

/**
 * The breathing light: a glass sphere over the live scene. It refracts and
 * brightens what is behind it, its warm core and halo grow with the in-breath
 * (`b`, 0 = empty lungs, 1 = full), a ripple leaves it at each new phase, and
 * a few motes of light drift up around it. `auto` breathes on its own clock
 * (the closing breath after tapping); otherwise the player drives `b`.
 */
function BreathOrb({ b = 0.5, small, auto, ripple }: { b?: number; small?: boolean; auto?: boolean; ripple?: number }) {
  return (
    <div
      className={"sq-orb" + (small ? " sq-orb-sm" : "") + (auto ? " sq-orb-auto" : "")}
      style={auto ? undefined : ({ "--b": b.toFixed(3) } as React.CSSProperties)}
      aria-hidden="true"
    >
      <div className="sq-orb-halo" />
      {ripple !== undefined && <i key={ripple} className="sq-orb-ripple" />}
      <div className="sq-orb-glass">
        <div className="sq-orb-caustic" />
        <div className="sq-orb-light" />
        <div className="sq-orb-spec" />
        <div className="sq-orb-rim" />
      </div>
      <div className="sq-orb-motes">
        {Array.from({ length: 9 }, (_, k) => (
          <i key={k} style={{ "--k": k } as React.CSSProperties} />
        ))}
      </div>
    </div>
  );
}

function TapFigure({ fig }: { fig: PStep["fig"] }) {
  if (fig === "breath") return <BreathOrb small auto />;
  if (fig === "hand") {
    return (
      <svg className="sq-eft" viewBox="55 35 330 360" role="img" aria-label="The side of the hand, with the tapping point marked">
        <image href="/ochre-app/eft-hand.png" width="440" height="440" preserveAspectRatio="xMidYMid slice" />
        <Beacon x={283} y={270} />
      </svg>
    );
  }
  if (fig === "arm") {
    return (
      <svg className="sq-eft" viewBox="210 150 620 700" role="img" aria-label="The side of the ribcage under the arm, with the tapping point marked">
        <image href="/ochre-app/eft-underarm.png" width="1024" height="1024" preserveAspectRatio="xMidYMid slice" />
        <Beacon x={388} y={588} s={2.3} />
      </svg>
    );
  }
  const [x, y] = FACE_POINTS[typeof fig === "number" ? fig : 0] ?? FACE_POINTS[0];
  return (
    <svg className="sq-eft" viewBox="92 102 300 400" role="img" aria-label="The face, with the tapping point marked">
      <image href="/ochre-app/eft-figure.png" width="478" height="640" preserveAspectRatio="xMidYMid slice" />
      <Beacon x={x} y={y} />
    </svg>
  );
}

// ── the scene behind ───────────────────────────────────────────────────────

export function SqScene({ scene }: { scene: SceneKey }) {
  return (
    <div className="sq-scenewrap" aria-hidden="true">
      {/* The still shows at once; the loop (about half a megabyte) loads only
          now that a practice is open, and never moves for reduced motion. */}
      <video key={scene} className="sq-sceneimg" src={`/app-scenes/${scene}.mp4`} poster={`/app-scenes/${scene}.jpg`} autoPlay muted loop playsInline />
    </div>
  );
}

// ── settings ───────────────────────────────────────────────────────────────

function Stepper({ label, value, min, max, onChange, dots }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void; dots?: boolean }) {
  return (
    <span className="sq-pstep" role="group" aria-label={label}>
      <button type="button" className="sq-pv" aria-label={`${label} down`} disabled={value <= min} onClick={() => onChange(value - 1)}>
        −
      </button>
      <span className="sq-pvlab">
        {dots ? (
          <>
            Volume
            <span className="sq-pvdots" role="img" aria-label={`Level ${value + 1} of ${max + 1}`}>
              {Array.from({ length: max + 1 }, (_, j) => (
                <i key={j} className={j <= value ? "sq-on" : undefined} />
              ))}
            </span>
          </>
        ) : (
          `Pace ${PACES[value]}×`
        )}
      </span>
      <button type="button" className="sq-pv" aria-label={`${label} up`} disabled={value >= max} onClick={() => onChange(value + 1)}>
        +
      </button>
    </span>
  );
}

function Settings({ prefs, setPrefs, voiced, scene }: { prefs: PracticePrefs; setPrefs: (p: PracticePrefs) => void; voiced: boolean; scene: SceneKey }) {
  const chip = (label: string, on: boolean, flip: () => void) => (
    <button type="button" className="sq-pchip" aria-pressed={on} onClick={flip}>
      {label}: {on ? "on" : "off"}
    </button>
  );
  return (
    <div className="sq-pset" role="group" aria-label="Settings">
      <div className="sq-pchips">
        {voiced && chip("Voice", prefs.voice, () => setPrefs({ ...prefs, voice: !prefs.voice }))}
        {chip("Music", prefs.music, () => setPrefs({ ...prefs, music: !prefs.music }))}
        {chip(SCENES[scene].sound, prefs.nature, () => setPrefs({ ...prefs, nature: !prefs.nature }))}
      </div>
      {voiced && (
        <div className="sq-pvol">
          {prefs.voice && <Stepper label="Voice volume" dots value={prefs.volume} min={0} max={VOLUME_LEVELS - 1} onChange={(volume) => setPrefs({ ...prefs, volume })} />}
          {/* Pace changes the pauses between lines, never the voice itself. */}
          <Stepper label="Pace" value={prefs.pace} min={0} max={PACES.length - 1} onChange={(pace) => setPrefs({ ...prefs, pace })} />
        </div>
      )}
      <div className="sq-swatches" role="group" aria-label="Scene">
        {SCENE_KEYS.map((s) => (
          <button key={s} type="button" className="sq-sw" aria-pressed={s === scene} aria-label={`Scene: ${SCENES[s].name}`} onClick={() => setPrefs({ ...prefs, scene: s })}>
            {/* eslint-disable-next-line @next/next/no-img-element -- a 36px still from /public; next/image adds nothing here */}
            <img src={`/app-scenes/${s}.jpg`} alt="" />
          </button>
        ))}
      </div>
    </div>
  );
}

// ── the player ─────────────────────────────────────────────────────────────

export interface SqPracticeProps {
  data: ClientAppData;
  practice: SqPractice;
  /** the phone's hour when it was opened, for the dim default */
  hour: number;
  prefs: PracticePrefs;
  setPrefs: (p: PracticePrefs) => void;
  onFinish: (r: PracticeResult) => void;
  onClose: () => void;
}

export function SqPracticePlayer({ data, practice, hour, prefs, setPrefs, onFinish, onClose }: SqPracticeProps) {
  const sound = sqSound();
  const scene = prefs.scene ?? practice.scene;
  const isBreath = practice.kind === "breath";
  const isTap = practice.kind === "tap";

  // ── which script ─────────────────────────────────────────────────────────
  const themes: AppEftTheme[] = isTap && data.eft ? data.eft.themes : [];
  const [themeKey, setThemeKey] = useState<string | null>(themes.length === 1 ? themes[0].theme : null);
  const theme = themes.find((t) => t.theme === themeKey) ?? null;
  const steps: PStep[] = useMemo(() => {
    if (practice.kind === "tap") return theme ? tapSteps(theme) : [];
    if (practice.kind === "sleep") return data.sleep ? sleepSteps(data.sleep) : [];
    if (practice.kind === "reset") {
      const s = data.somatic.find((x) => `reset:${x.slug}` === practice.id);
      return s ? resetSteps(s.steps) : [];
    }
    return [];
  }, [practice.kind, practice.id, theme, data.sleep, data.somatic]);
  const voiced = practice.kind === "sleep" ? practice.voiced : isTap ? !!theme && tapVoiced(theme) : false;

  // ── where she is ─────────────────────────────────────────────────────────
  const saved = prefs.resume[practice.id] ?? 0;
  const [step, setStep] = useState(saved);
  /** A half-finished practice reopens paused, so nothing speaks unasked. */
  const [paused, setPaused] = useState(saved > 0);
  const [resumed, setResumed] = useState(saved > 0);
  const [dim, setDim] = useState(dimByDefault(practice.kind, hour));
  const [settings, setSettings] = useState(false);
  const startedAt = useRef(0);
  useEffect(() => {
    startedAt.current = Date.now();
  }, []);
  const n = steps.length;
  const i = Math.min(step, Math.max(0, n - 1));

  // Tapping asks how strong the feeling is before and after (0–10), as today's
  // app does. Both can be skipped.
  const wantsRating = isTap && !!data.eft?.suds;
  const [before, setBefore] = useState<number | null | undefined>(undefined);
  const [after, setAfter] = useState<number | null | undefined>(undefined);
  const [ended, setEnded] = useState(false);
  const askingBefore = wantsRating && !!theme && before === undefined && saved === 0;
  const askingAfter = wantsRating && ended && after === undefined;

  // ── sound follows the settings ───────────────────────────────────────────
  useEffect(() => {
    sound.voiceOn = prefs.voice;
    sound.musicOn = prefs.music;
    sound.natureOn = prefs.nature;
    sound.volume = prefs.volume;
    sound.duckOn = practice.kind !== "sleep";
  }, [sound, prefs.voice, prefs.music, prefs.nature, prefs.volume, practice.kind]);
  useEffect(() => {
    if (prefs.music || prefs.nature) sound.start(scene);
    else sound.stop(false);
    // A scene or music change keeps the phone's media session (the voice
    // must still play through the silent switch); closing the player lets it go.
    return () => sound.stop(false);
  }, [sound, scene, prefs.music, prefs.nature]);
  useEffect(() => () => sound.stop(), [sound]);

  // ── finishing and leaving ────────────────────────────────────────────────
  const finishedRef = useRef(false);
  const stepRef = useRef(i);
  useEffect(() => {
    stepRef.current = i;
  }, [i]);
  const report = (sudsAfter: number | null | undefined) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    const { [practice.id]: _gone, ...resume } = prefs.resume;
    void _gone;
    setPrefs({ ...prefs, resume });
    // The wind-down ends in quiet; everything else ends on three soft bells.
    if (practice.kind === "sleep") sound.stop();
    else sound.finish();
    onFinish({
      practice,
      seconds: Math.round((Date.now() - startedAt.current) / 1000),
      theme: theme?.theme,
      sudsBefore: before ?? null,
      sudsAfter: sudsAfter ?? null,
    });
  };
  const complete = () => {
    if (wantsRating) setEnded(true);
    else report(null);
  };
  // Leaving any other way (Escape, a tab change) keeps her place too.
  const prefsRef = useRef(prefs);
  const setPrefsRef = useRef(setPrefs);
  useEffect(() => {
    prefsRef.current = prefs;
    setPrefsRef.current = setPrefs;
  });
  useEffect(
    () => () => {
      const at = stepRef.current;
      const p = prefsRef.current;
      if (!finishedRef.current && !isBreath && at > 0 && p.resume[practice.id] !== at) setPrefsRef.current({ ...p, resume: { ...p.resume, [practice.id]: at } });
    },
    [isBreath, practice.id],
  );
  const leave = () => {
    // Closing the wind-down on its last step is the same as "I'm done".
    if (practice.kind === "sleep" && n > 0 && stepRef.current >= n - 1) return report(null);
    if (!isBreath && stepRef.current > 0 && !finishedRef.current) setPrefs({ ...prefs, resume: { ...prefs.resume, [practice.id]: stepRef.current } });
    onClose();
  };

  // ── the sequencer: voice clips and the move to the next step ─────────────
  const running = !isBreath && n > 0 && !paused && !askingBefore && !ended;
  const tl = n > 0 ? timeline(steps[i], prefs.pace) : null;
  const completeRef = useRef(complete);
  useEffect(() => {
    completeRef.current = complete;
  });
  useEffect(() => {
    if (!running || !tl) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const speaks = voiced && prefs.voice && tl.clips.length > 0;
    if (!speaks) sound.bell();
    for (const c of tl.clips) timers.push(setTimeout(() => sound.say(c.vo[0], c.vo[1]), c.at * 1000));
    // Have the next step's clips ready before they are due.
    if (speaks && i + 1 < n) sound.preload(steps[i + 1].parts.flatMap((p) => ("vo" in p ? [p.vo as [VoiceSet, number]] : [])));
    timers.push(
      setTimeout(() => {
        if (i < n - 1) setStep(i + 1);
        else completeRef.current();
      }, tl.total * 1000),
    );
    return () => {
      timers.forEach(clearTimeout);
      sound.hush();
    };
    // The timeline is a pure function of the step, the theme and the pace.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tl and steps are derived from these
  }, [running, i, themeKey, prefs.pace, prefs.voice, voiced, practice.id]);

  // ── breathing: a clock, not a script ─────────────────────────────────────
  const breath = isBreath ? data.breathwork : null;
  const breathTotal = breath ? breathTotalSeconds(breath, practice.id === "one") : 0;
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!breath || paused) return;
    const t = setInterval(() => setElapsed((e) => e + 0.1), 100);
    return () => clearInterval(t);
  }, [breath, paused]);
  const breathDone = !!breath && elapsed >= breathTotal;
  useEffect(() => {
    if (breathDone) completeRef.current();
  }, [breathDone]);
  const now = breath ? breathAt(breath, elapsed) : null;
  const lastPhase = useRef(-1);
  useEffect(() => {
    if (!now || paused || now.index === lastPhase.current) return;
    lastPhase.current = now.index;
    if (now.action !== "hold") sound.bell(now.action === "expand" ? 392 : 293.66, 0.1);
  }, [now, paused, sound]);
  // The light fills on the in-breath, rests on a hold, and empties on the
  // out-breath, eased so it moves like a breath rather than a clock hand.
  let fill = 0;
  let ripple: number | undefined;
  if (breath && now) {
    const at = now.secs > 0 ? Math.min(1, now.into / now.secs) : 1;
    const ease = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * t);
    if (now.action === "expand") fill = ease(at);
    else if (now.action === "shrink") fill = 1 - ease(at);
    else {
      const prev = breath.phases[(now.index - 1 + breath.phases.length) % breath.phases.length];
      fill = prev.action === "expand" ? 1 : 0;
    }
    // one ripple per phase: keyed on when this phase began
    ripple = Math.round((elapsed - now.into) * 10);
  }

  // ── drawing ──────────────────────────────────────────────────────────────
  const restart = () => {
    setStep(0);
    setResumed(false);
    setPaused(false);
  };
  const st = n > 0 ? steps[i] : null;

  let stage: React.ReactNode;
  let controls: React.ReactNode = null;
  if (askingAfter) {
    stage = <Rating question={theme?.sudsAfterQ || "And now, how strong is it?"} onPick={(v) => (setAfter(v), report(v))} />;
  } else if (isTap && !theme) {
    stage = (
      <div className="sq-pstage">
        <p className="sq-pcount">Tapping</p>
        <p className="sq-pline sq-pline-sm">What would you like to tap on?</p>
        <div className="sq-tpick">
          {themes.map((t) => (
            <button key={t.theme} type="button" className="sq-btn sq-btn-quiet" onClick={() => setThemeKey(t.theme)}>
              {t.themeLabel}
            </button>
          ))}
        </div>
        <p className="sq-psub">About two minutes a round. You tap and repeat each line.</p>
      </div>
    );
  } else if (askingBefore) {
    stage = <Rating question={theme?.sudsBeforeQ || "How strong is it right now?"} onPick={setBefore} />;
  } else if (breath) {
    stage = (
      <div className={"sq-pstage sq-breath" + (paused ? " sq-paused" : "")}>
        <BreathOrb b={fill} ripple={paused ? undefined : ripple} />
        <div className="sq-breath-words">
          <p className="sq-cue" aria-live="polite">
            {paused ? "Paused" : now?.label}
          </p>
          <p className="sq-psub">{now?.cue}</p>
          <p className="sq-pleft">{clock(breathTotal - elapsed)} left</p>
        </div>
      </div>
    );
    controls = (
      <div className="sq-prow">
        <button type="button" className="sq-btn sq-btn-quiet" onClick={() => setPaused((p) => !p)}>
          {paused ? "Resume" : "Pause"}
        </button>
        <button type="button" className="sq-btn sq-btn-solid" onClick={complete}>
          I&apos;m done
        </button>
      </div>
    );
  } else if (st && tl) {
    stage = (
      <div className={"sq-pstage" + (isTap ? " sq-pstage-tap" : "")}>
        <p className="sq-pcount">
          {i + 1} of {n}
          {st.title ? ` · ${st.title}` : ""}
        </p>
        {isTap && <TapFigure fig={st.fig} />}
        <p className={"sq-pline" + (isTap || practice.kind === "sleep" ? " sq-pline-sm" : "")} aria-live="polite">
          {st.line}
        </p>
        {st.hint && <p className="sq-psub">{st.hint}</p>}
        <div className="sq-pbar" aria-hidden="true">
          {!paused && <i key={`${i}:${prefs.pace}:${themeKey}`} className="sq-run" style={{ animationDuration: `${tl.total.toFixed(1)}s` }} />}
        </div>
      </div>
    );
    controls = (
      <>
        <div className="sq-prow">
          <button type="button" className="sq-btn sq-btn-quiet" disabled={i === 0} onClick={() => setStep(i - 1)}>
            Previous
          </button>
          <button type="button" className="sq-btn sq-btn-quiet" onClick={() => (setPaused((p) => !p), setResumed(false))}>
            {paused ? "Resume" : "Pause"}
          </button>
          {i < n - 1 ? (
            <button type="button" className="sq-btn sq-btn-solid" onClick={() => setStep(i + 1)}>
              Next
            </button>
          ) : (
            <button type="button" className="sq-btn sq-btn-solid" onClick={complete}>
              I&apos;m done
            </button>
          )}
        </div>
        {resumed && (
          <p className="sq-psub sq-pcentre">
            Picked up where you left off.{" "}
            <button type="button" className="sq-plink" onClick={restart}>
              Start again
            </button>
          </p>
        )}
        {paused && !resumed && <p className="sq-psub sq-pcentre">Paused. Use Next and Previous to move at your own pace.</p>}
        {isTap && theme && themes.length > 1 && (
          <button type="button" className="sq-plink sq-pcentre" onClick={() => (setThemeKey(null), setStep(0), setBefore(undefined))}>
            {theme.themeLabel} · change
          </button>
        )}
      </>
    );
  } else {
    stage = (
      <div className="sq-pstage">
        <p className="sq-pline sq-pline-sm">This practice is not on your plan.</p>
      </div>
    );
  }

  return (
    <div className={"sq-sheet sq-scene" + (dim ? " sq-dim" : "")} role="dialog" aria-modal="true" aria-labelledby="sq-practice-title">
      <SqScene scene={scene} />
      <div className="sq-sheet-h">
        <h2 id="sq-practice-title">{practice.title}</h2>
        <button type="button" className="sq-pchip" aria-pressed={dim} onClick={() => setDim((d) => !d)}>
          Dim
        </button>
        <button type="button" className="sq-x" aria-label="Close" onClick={leave}>
          <SqIcon name="x" />
        </button>
      </div>
      <div className="sq-sheet-b">
        {stage}
        {controls}
        <div className="sq-pfoot">
          <button type="button" className="sq-pchip" aria-expanded={settings} onClick={() => setSettings((s) => !s)}>
            Settings
          </button>
          {settings && <Settings prefs={prefs} setPrefs={setPrefs} voiced={voiced} scene={scene} />}
        </div>
      </div>
    </div>
  );
}

function Rating({ question, onPick }: { question: string; onPick: (v: number | null) => void }) {
  return (
    <div className="sq-pstage">
      <p className="sq-pline sq-pline-sm">{question}</p>
      <p className="sq-psub">0 is not at all, 10 is as strong as it gets.</p>
      <div className="sq-rate" role="group" aria-label={question}>
        {Array.from({ length: 11 }, (_, v) => (
          <button key={v} type="button" className="sq-rate-b" onClick={() => onPick(v)}>
            {v}
          </button>
        ))}
      </div>
      <button type="button" className="sq-plink" onClick={() => onPick(null)}>
        Skip
      </button>
    </div>
  );
}

// ── goodnight ──────────────────────────────────────────────────────────────

/** After the wind-down: nothing to read, nothing to do, one tick if a bedtime
 *  supplement is still open. */
export function SqGoodnight({ pending, onTick, onClose }: { pending: { id: string; name: string }[]; onTick: (id: string) => void; onClose: () => void }) {
  return (
    <div className="sq-sheet sq-night" role="dialog" aria-modal="true" aria-label="Goodnight">
      <div className="sq-nightend">
        <p className="sq-n1">Goodnight.</p>
        <p className="sq-n2">Put the phone down now. It is quiet from here.</p>
        {pending.map((p) => (
          <button key={p.id} type="button" className="sq-btn sq-nq" onClick={() => onTick(p.id)}>
            Taken your {p.name.toLowerCase()}? Tick it here
          </button>
        ))}
        <button type="button" className="sq-btn sq-nq" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
