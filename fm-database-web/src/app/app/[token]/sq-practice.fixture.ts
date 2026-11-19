/**
 * A synthetic client's practices, for tests only: one tapping theme, the
 * ten-step wind-down, a 4-in 6-out breathing practice and one body reset.
 * No client data.
 */

import type { AppBreathwork, AppEft, AppEftTheme, AppSleep, ClientAppData } from "@/lib/fmdb/client-app";
import { RECORDED_TAPPING } from "./sq-practice-data";

const POINTS = ["Top of head", "Eyebrow", "Side of eye", "Under eye", "Under nose", "Chin", "Collarbone", "Under arm"];

export function eftTheme(theme: string, label: string): AppEftTheme {
  const rec = RECORDED_TAPPING[theme];
  return {
    theme,
    themeLabel: label,
    setup: rec[0],
    // The app's library writes the phrases without a full stop; the recording has one.
    points: POINTS.map((p, i) => ({ key: `k${i}`, label: p, phrase: rec[i + 1].replace(/\.$/, "") })),
    sudsBeforeQ: "How strong is it right now?",
    sudsAfterQ: "And now, how strong is it?",
    why: "",
  };
}

export function eft(themes: AppEftTheme[] = [eftTheme("stress", "Stress reset")]): AppEft {
  const first = themes[0];
  return { ...first, practiceId: "p-tap", when: "", suds: true, themes };
}

export const SLEEP: AppSleep = {
  practiceId: "p-wind",
  when: "",
  why: "",
  steps: ["Settle in", "Slow your breath", "Your feet & legs", "Your hips & belly", "Your back", "Your hands & arms", "Your shoulders & neck", "Your jaw & face", "Your whole body", "Drift off"].map(
    (label, i) => ({ kind: i === 0 ? ("settle" as const) : i === 9 ? ("drift" as const) : ("release" as const), label, cue: `${label}: let go.`, secs: 20 }),
  ),
};

export const BREATH: AppBreathwork = {
  name: "Slow breathing",
  practiceId: "p-breath",
  when: "",
  why: "",
  rounds: 30,
  phases: [
    { key: "in", label: "Breathe in", cue: "In for four.", secs: 4, action: "expand" },
    { key: "out", label: "Breathe out", cue: "Out for six.", secs: 6, action: "shrink" },
  ],
};

export const SOMATIC = [
  {
    practiceId: "p-reset",
    sourceIndex: 0,
    slug: "body-reset",
    name: "Body reset",
    shape: "release",
    when: "",
    why: "",
    steps: [
      { label: "Shoulders", cue: "Drop your shoulders and unclench your jaw.", secs: 20, action: "" },
      { label: "Feet", cue: "Press both feet into the floor for five slow counts.", secs: null, action: "" },
    ],
    reps: null,
    bilateral: false,
    timed: true,
    totalSeconds: 180,
    equipment: [],
  },
] as unknown as ClientAppData["somatic"];

/** Everything a client can have, as the payload carries it. */
export const ALL_PRACTICES = { eft: eft(), sleep: SLEEP, breathwork: BREATH, somatic: SOMATIC };
