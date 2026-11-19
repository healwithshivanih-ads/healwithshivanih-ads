/**
 * PRACTICES — what a client has, and how each one runs. Pure rules, no audio
 * and no screen, so every timing here can be tested exactly.
 *
 * A practice is offered only when the coach has prescribed it: tapping when
 * the plan has a tapping practice (`data.eft`), the sleep wind-down when it
 * has one (`data.sleep`), breathing when it has one (`data.breathwork`), and
 * each body reset on the plan (`data.somatic`). Nothing is invented here.
 *
 * THE COACH'S VOICE. 57 clips were recorded (public/app-voice/, with their
 * lengths in VOICE_SECS below): one shared tapping set (the point names and
 * the closing breath), four tapping themes, and the ten wind-down steps. A
 * step is "voiced" only when the words on screen ARE the words recorded —
 * `tapVoiced` and `sleepVoiced` compare them. If a script is ever changed in
 * the plan or the library, that practice falls back to text with music rather
 * than playing a voice that says something else.
 *
 * PACE changes the pauses between lines, never the speed of the voice.
 */

import type { AppBreathwork, AppEft, AppEftTheme, AppSleep, ClientAppData } from "@/lib/fmdb/client-app";

// ── scenes ─────────────────────────────────────────────────────────────────

export type SceneKey = "shore" | "rain" | "grove" | "grass";
/** `sound` names the scene's own sound on its on/off switch in Settings. */
export const SCENES: Record<SceneKey, { name: string; about: string; sound: string }> = {
  shore: { name: "Slow waves", about: "Small waves on warm sand", sound: "Waves" },
  rain: { name: "Rain on leaves", about: "Soft rain on broad green leaves", sound: "Rain" },
  grove: { name: "Forest path", about: "Tall trees and morning light", sound: "Birdsong" },
  grass: { name: "Grasses in the breeze", about: "Wild grass moving in a light wind", sound: "Wind" },
};
export const SCENE_KEYS = Object.keys(SCENES) as SceneKey[];
export const isScene = (v: unknown): v is SceneKey => typeof v === "string" && v in SCENES;

// ── the recorded voice ─────────────────────────────────────────────────────

export type VoiceSet = "tapping-shared" | "tapping-cravings" | "tapping-anxiety" | "tapping-sleep" | "tapping-stress" | "sleep-wind-down";

/** Length of every clip, in seconds (docs/client-app-redesign/voice/lines/durations.json). */
export const VOICE_SECS: Record<VoiceSet, number[]> = {
  "tapping-shared": [3.65, 1.26, 1.24, 1.59, 1.41, 1.82, 0.89, 1.68, 1.6, 7.22, 3.13],
  "tapping-cravings": [7.74, 3.13, 3.06, 2.36, 3.17, 2.71, 3.28, 2.89, 3.85],
  "tapping-anxiety": [6.4, 2.29, 2.32, 2.78, 2.98, 2.45, 3.47, 3.83, 3.74],
  "tapping-sleep": [5.89, 1.94, 2.28, 2.4, 2.55, 1.95, 2.81, 2.11, 3.66],
  "tapping-stress": [6.37, 2.25, 2.24, 2.52, 2.07, 3.09, 2.29, 2.47, 3.05],
  // The wind-down clips play 20% slower than recorded (ffmpeg atempo=0.80,
  // pitch unchanged), with 2 s of quiet added between the sentences inside
  // each line, as the coach chose by ear on 19 Nov 2026.
  "sleep-wind-down": [17.19, 26.07, 15.27, 14.25, 10.57, 11.25, 14.4, 14.73, 11.91, 13.91],
};

/** The file for one clip: clips are numbered from 01. */
export const voiceUrl = (set: VoiceSet, i: number): string => `/app-voice/${set}-${String(i + 1).padStart(2, "0")}.m4a`;

/** What was recorded for each tapping theme: the setup line, then the eight
 *  points in order. Compared with the words on screen before the voice plays. */
export const RECORDED_TAPPING: Record<string, string[]> = {
  cravings: [
    "Even though I get these cravings when I'm stressed or tired, I deeply and completely accept myself.",
    "All this craving I'm feeling right now.",
    "This urge that shows up at the end of the day.",
    "I don't have to act on it.",
    "It's just my body asking for comfort.",
    "I can give myself calm instead.",
    "I'm safe. This craving can pass.",
    "Choosing what truly nourishes me.",
    "Kind to my body, this is enough.",
  ],
  anxiety: [
    "Even though I feel this anxiety in my body, I deeply and completely accept myself.",
    "All this worry I've been carrying.",
    "This tightness in my chest.",
    "It's safe to let my shoulders drop.",
    "I don't have to fix everything right now.",
    "I can breathe a little slower.",
    "This feeling is allowed to ease.",
    "Coming back to calm, one breath at a time.",
    "Safe, steady, and held right now.",
  ],
  sleep: [
    "Even though my mind is still busy, I deeply and completely accept myself.",
    "All the thoughts from today.",
    "This busy, racing mind.",
    "There's nothing to solve right now.",
    "My body is allowed to rest.",
    "I can let the day go.",
    "Sinking a little softer into the bed.",
    "Ready to let sleep come.",
    "Soft and heavy, ready to drift off.",
  ],
  stress: [
    "Even though I'm carrying a lot right now, I deeply and completely accept myself.",
    "All the stress I've been holding.",
    "Everything I've been carrying today.",
    "It's okay to set some of it down.",
    "I'm doing the best I can.",
    "I can soften, just for a moment.",
    "Letting my body unclench.",
    "Coming back to steady ground.",
    "Carrying it all a little more lightly.",
  ],
};

/** The quiet after each wind-down line, in seconds, at normal pace. */
// The coach's choice by ear, 19 Nov 2026: 8 s between lines, except after
// "Slow your breath": 50 s of music and rain for five slow breaths (in 4,
// out 6), and 12 s before the last line to let sleep in.
const WIND_GAPS = [8, 50, 8, 8, 8, 8, 8, 8, 8, 12];

/** Words only: case, punctuation and dashes do not make two lines different. */
const plain = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** True when this theme's words on screen are the words recorded for it. */
export function tapVoiced(theme: AppEftTheme): boolean {
  const rec = RECORDED_TAPPING[theme.theme];
  if (!rec || theme.points.length !== 8) return false;
  const shown = [theme.setup, ...theme.points.map((p) => p.phrase)];
  return shown.every((line, i) => plain(line) === plain(rec[i]));
}

/** True when the wind-down on the plan is the ten steps that were recorded. */
export const sleepVoiced = (sleep: AppSleep): boolean => sleep.steps.length === WIND_GAPS.length;

// ── steps ──────────────────────────────────────────────────────────────────

/** One thing that happens inside a step: a clip of the coach's voice, or quiet. */
export type Part = { vo: [VoiceSet, number] } | { gap: number };

export interface PStep {
  /** "Eyebrow", "Your back" — shown beside the count */
  title: string;
  line: string;
  hint?: string;
  /** tapping only: which picture, and which point on the face (0–6) */
  fig?: "hand" | "arm" | "breath" | number;
  parts: Part[];
}

const POINT_HINT = "About seven taps. Repeat the line.";

/** A round of tapping: the side of the hand (setup, three times), the eight
 *  points, then a closing breath. */
export function tapSteps(theme: AppEftTheme): PStep[] {
  const voiced = tapVoiced(theme);
  const set = `tapping-${theme.theme}` as VoiceSet;
  const secs = voiced ? VOICE_SECS[set] : [];
  const quote = (s: string) => `“${s.replace(/[.\s]+$/, "")}.”`;
  const steps: PStep[] = [];

  const once: Part[] = voiced ? [{ vo: [set, 0] }, { gap: secs[0] + 1.2 }] : [{ gap: 7 }];
  steps.push({
    title: "Side of the hand",
    line: quote(theme.setup),
    hint: voiced ? "Tap here and say it three times, after your coach." : "Tap here and say it three times.",
    fig: "hand",
    parts: voiced ? [{ vo: ["tapping-shared", 0] }, { gap: 0.6 }, ...once, ...once, ...once] : [...once, ...once, ...once],
  });
  theme.points.forEach((p, i) => {
    steps.push({
      title: p.label,
      line: quote(p.phrase),
      hint: POINT_HINT,
      fig: i < 7 ? i : "arm",
      parts: voiced
        ? [{ vo: ["tapping-shared", i + 1] }, { gap: 0.5 }, { vo: [set, i + 1] }, { gap: secs[i + 1] + 2 }]
        : [{ gap: 9 }],
    });
  });
  steps.push({
    title: "Closing breath",
    line: "Breathe in slowly, and let it all the way out. Let your shoulders drop.",
    fig: "breath",
    parts: voiced ? [{ vo: ["tapping-shared", 9] }, { gap: 4 }, { vo: ["tapping-shared", 10] }, { gap: 1 }] : [{ gap: 12 }],
  });
  return steps;
}

export function sleepSteps(sleep: AppSleep): PStep[] {
  const voiced = sleepVoiced(sleep);
  return sleep.steps.map((st, i) => ({
    title: st.label,
    line: st.cue,
    parts: voiced ? [{ vo: ["sleep-wind-down", i] }, { gap: WIND_GAPS[i] }] : [{ gap: Math.max(8, st.secs) }],
  }));
}

export function resetSteps(steps: { label: string; cue: string; secs: number | null }[]): PStep[] {
  return steps.map((st) => ({ title: st.label, line: st.cue, parts: [{ gap: st.secs && st.secs > 0 ? st.secs : 20 }] }));
}

// ── pace and time ──────────────────────────────────────────────────────────

export const PACES = [0.75, 1, 1.25, 1.5];
export const DEFAULT_PACE = 1;

/** A step at this pace: the gaps are shorter or longer, the voice is untouched. */
export function paced(step: PStep, pace: number): Part[] {
  const by = PACES[pace] ?? 1;
  return step.parts.map((p) => ("vo" in p ? p : { gap: p.gap / by }));
}

const LEAD_IN = 0.5;

/** When each clip of a step starts, and when the step ends, in seconds. */
export function timeline(step: PStep, pace: number): { clips: { at: number; vo: [VoiceSet, number] }[]; total: number } {
  let t = LEAD_IN;
  const clips: { at: number; vo: [VoiceSet, number] }[] = [];
  for (const p of paced(step, pace)) {
    if ("vo" in p) {
      clips.push({ at: t, vo: p.vo });
      t += VOICE_SECS[p.vo[0]][p.vo[1]];
    } else {
      t += p.gap;
    }
  }
  // Never so short that a step flashes past.
  return { clips, total: Math.max(t, 2.1) };
}

export const stepSeconds = (step: PStep, pace: number): number => timeline(step, pace).total;
export const totalSeconds = (steps: PStep[], pace: number): number => steps.reduce((sum, s) => sum + stepSeconds(s, pace), 0);

/** "4:05" */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** "5 minutes", "1 minute" — rounded to the nearest minute, never zero. */
export function minutesLabel(seconds: number): string {
  const m = Math.max(1, Math.round(seconds / 60));
  return `${m} minute${m === 1 ? "" : "s"}`;
}

// ── breathing ──────────────────────────────────────────────────────────────

export interface BreathNow {
  /** which phase of the cycle */
  index: number;
  label: string;
  cue: string;
  action: "expand" | "hold" | "shrink";
  /** seconds this phase lasts, and seconds into it */
  secs: number;
  into: number;
}

export const breathCycleSeconds = (b: AppBreathwork): number => b.phases.reduce((s, p) => s + p.secs, 0);
/** The whole practice as prescribed; the one-minute version is always 60. */
export const breathTotalSeconds = (b: AppBreathwork, oneMinute: boolean): number =>
  oneMinute ? 60 : Math.max(60, Math.max(1, b.rounds) * breathCycleSeconds(b));

/** Where in the cycle a breathing practice is after `elapsed` seconds. */
export function breathAt(b: AppBreathwork, elapsed: number): BreathNow | null {
  const cycle = breathCycleSeconds(b);
  if (cycle <= 0 || b.phases.length === 0) return null;
  let t = ((elapsed % cycle) + cycle) % cycle;
  for (let i = 0; i < b.phases.length; i++) {
    const p = b.phases[i];
    if (t < p.secs) return { index: i, label: p.label, cue: p.cue, action: p.action, secs: p.secs, into: t };
    t -= p.secs;
  }
  const last = b.phases[b.phases.length - 1];
  return { index: b.phases.length - 1, label: last.label, cue: last.cue, action: last.action, secs: last.secs, into: last.secs };
}

// ── what this client has ───────────────────────────────────────────────────

export type PracticeKind = "tap" | "sleep" | "breath" | "reset";

export interface SqPractice {
  /** "tap", "sleep", "breath", "one", "reset:<slug>" */
  id: string;
  kind: PracticeKind;
  title: string;
  /** "5 minutes · before bed · led by your coach's voice" */
  meta: string;
  /** the plan practice this ticks when finished; "" when it ticks nothing */
  practiceId: string;
  /** the scene it opens on unless she has chosen one */
  scene: SceneKey;
  voiced: boolean;
}

const VOICE_NOTE = "led by your coach's voice";

/** Every practice on this client's plan, in the order the Practices tab lists
 *  them: the one for the night first, then breathing, tapping and body resets. */
export function practiceList(data: Pick<ClientAppData, "eft" | "sleep" | "breathwork" | "somatic">): SqPractice[] {
  const out: SqPractice[] = [];
  if (data.sleep) {
    const voiced = sleepVoiced(data.sleep);
    const secs = totalSeconds(sleepSteps(data.sleep), DEFAULT_PACE);
    out.push({
      id: "sleep",
      kind: "sleep",
      title: "Sleep wind-down",
      meta: [minutesLabel(secs), "before bed", voiced ? VOICE_NOTE : ""].filter(Boolean).join(" · "),
      practiceId: data.sleep.practiceId,
      scene: "rain",
      voiced,
    });
  }
  if (data.breathwork) {
    out.push({
      id: "breath",
      kind: "breath",
      title: data.breathwork.name || "Slow breathing",
      meta: `${minutesLabel(breathTotalSeconds(data.breathwork, false))} · to settle`,
      practiceId: data.breathwork.practiceId,
      scene: "shore",
      voiced: false,
    });
  }
  if (data.eft) {
    const voiced = data.eft.themes.some(tapVoiced);
    out.push({
      id: "tap",
      kind: "tap",
      title: "Tapping",
      meta: ["2 minutes a round", voiced ? VOICE_NOTE : ""].filter(Boolean).join(" · "),
      practiceId: data.eft.practiceId,
      scene: "grove",
      voiced,
    });
  }
  for (const s of data.somatic ?? []) {
    const secs = s.totalSeconds ?? totalSeconds(resetSteps(s.steps), DEFAULT_PACE);
    out.push({
      id: `reset:${s.slug}`,
      kind: "reset",
      title: s.name,
      meta: `${minutesLabel(secs)} · for tension`,
      practiceId: s.practiceId,
      scene: "grove",
      voiced: false,
    });
  }
  // Not when the prescribed breathing is itself about a minute: two rows for
  // the same minute would only be a choice with nothing to choose.
  if (data.breathwork && breathTotalSeconds(data.breathwork, false) > 90) {
    out.push({
      id: "one",
      kind: "breath",
      title: "One minute of breathing",
      meta: "1 minute · anywhere",
      practiceId: "",
      scene: "grass",
      voiced: false,
    });
  }
  return out;
}

export const findPractice = (list: SqPractice[], id: string): SqPractice | null => list.find((p) => p.id === id) ?? null;

/** The tapping themes this client has, with whether each is voiced. */
export const tapThemes = (eft: AppEft): AppEftTheme[] => eft.themes;

// ── per-device settings ────────────────────────────────────────────────────

export interface PracticePrefs {
  /** index into PACES */
  pace: number;
  /** voice volume, 0–4 */
  volume: number;
  voice: boolean;
  music: boolean;
  /** the scene's own sound (rain, waves, wind, birdsong), apart from the music */
  nature: boolean;
  /** a scene she chose for every practice; null lets each practice pick */
  scene: SceneKey | null;
  /** where she stopped in a practice she did not finish: practice id → step */
  resume: Record<string, number>;
  /** the last practice she finished, for the top of the Practices tab */
  last: { id: string; ymd: string } | null;
}

export const DEFAULT_PREFS: PracticePrefs = { pace: DEFAULT_PACE, volume: 2, voice: true, music: true, nature: true, scene: null, resume: {}, last: null };
export const VOLUME_LEVELS = 5;

/** Read saved settings defensively: anything unreadable is the default. */
export function parsePrefs(raw: string | null): PracticePrefs {
  if (!raw) return DEFAULT_PREFS;
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    const int = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : d);
    const resume: Record<string, number> = {};
    if (j.resume && typeof j.resume === "object") {
      for (const [k, v] of Object.entries(j.resume as Record<string, unknown>)) {
        if (typeof v === "number" && Number.isInteger(v) && v > 0 && v < 100) resume[k] = v;
      }
    }
    const last = j.last as { id?: unknown; ymd?: unknown } | null | undefined;
    return {
      pace: int(j.pace, 0, PACES.length - 1, DEFAULT_PACE),
      volume: int(j.volume, 0, VOLUME_LEVELS - 1, 2),
      voice: j.voice !== false,
      music: j.music !== false,
      nature: j.nature !== false,
      scene: isScene(j.scene) ? j.scene : null,
      resume,
      last: last && typeof last.id === "string" && typeof last.ymd === "string" ? { id: last.id, ymd: last.ymd } : null,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

/**
 * Dim is on by default for the wind-down at any hour, and for any practice
 * opened from 8 pm until 5 am. It is still a toggle: this is only where it
 * starts. Daytime stays light, and Home is never dark.
 */
export const dimByDefault = (kind: PracticeKind, hour: number): boolean => kind === "sleep" || hour >= 20 || hour < 5;
