/**
 * How a practice runs: which practices a client has, the steps of each, and
 * the timing of the coach's voice against the pauses. All pure.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PREFS,
  PACES,
  RECORDED_TAPPING,
  VOICE_SECS,
  breathAt,
  breathTotalSeconds,
  clock,
  dimByDefault,
  minutesLabel,
  parsePrefs,
  practiceList,
  resetSteps,
  sleepSteps,
  sleepVoiced,
  stepSeconds,
  tapSteps,
  tapVoiced,
  timeline,
  totalSeconds,
  voiceUrl,
  type VoiceSet,
} from "./sq-practice-data";
import { ALL_PRACTICES, BREATH, SLEEP, SOMATIC, eft, eftTheme } from "./sq-practice.fixture";

const root = path.resolve(__dirname, "../../../..");

describe("the recorded voice", () => {
  it("every clip the timings name is a file in the app", () => {
    for (const [set, secs] of Object.entries(VOICE_SECS)) {
      secs.forEach((_, i) => {
        const url = voiceUrl(set as VoiceSet, i);
        expect(fs.existsSync(path.join(root, "public", url)), url).toBe(true);
      });
    }
    expect(voiceUrl("tapping-shared", 0)).toBe("/app-voice/tapping-shared-01.m4a");
    expect(voiceUrl("sleep-wind-down", 9)).toBe("/app-voice/sleep-wind-down-10.m4a");
  });

  it("every scene has its loop and its still", () => {
    for (const s of ["shore", "rain", "grove", "grass"]) {
      expect(fs.existsSync(path.join(root, `public/app-scenes/${s}.mp4`)), s).toBe(true);
      expect(fs.existsSync(path.join(root, `public/app-scenes/${s}.jpg`)), s).toBe(true);
    }
  });

  it("the app's own tapping scripts are the words that were recorded", () => {
    // If a script in client-app.ts EFT_LIBRARY is ever reworded, the voice
    // would say one thing and the screen another. This pins the two together.
    const src = fs.readFileSync(path.join(root, "src/lib/fmdb/client-app.ts"), "utf8");
    const plain = (s: string) => s.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
    const lib = plain(src.slice(src.indexOf("const EFT_LIBRARY"), src.indexOf("export const EFT_THEME_KEYS")));
    for (const [theme, lines] of Object.entries(RECORDED_TAPPING)) {
      for (const line of lines) expect(lib, `${theme}: ${line}`).toContain(plain(line));
    }
  });

  it("plays only when the words on screen are the words recorded", () => {
    const stress = eftTheme("stress", "Stress reset");
    expect(tapVoiced(stress)).toBe(true);
    // One phrase changed: text and music, no voice.
    const changed = { ...stress, points: stress.points.map((p, i) => (i === 3 ? { ...p, phrase: "Something the coach rewrote" } : p)) };
    expect(tapVoiced(changed)).toBe(false);
    expect(tapSteps(changed).flatMap((s) => s.parts).some((p) => "vo" in p)).toBe(false);
    // A theme nobody recorded.
    expect(tapVoiced({ ...stress, theme: "grief" })).toBe(false);
    // Punctuation and case do not count as a change.
    expect(tapVoiced({ ...stress, setup: stress.setup.toUpperCase().replace(/[.,]/g, "") })).toBe(true);
    expect(sleepVoiced(SLEEP)).toBe(true);
    expect(sleepVoiced({ ...SLEEP, steps: SLEEP.steps.slice(0, 6) })).toBe(false);
  });
});

describe("tapping", () => {
  const steps = tapSteps(eftTheme("anxiety", "Anxiety"));

  it("is the side of the hand, eight points, then a closing breath", () => {
    expect(steps.map((s) => s.title)).toEqual(["Side of the hand", "Top of head", "Eyebrow", "Side of eye", "Under eye", "Under nose", "Chin", "Collarbone", "Under arm", "Closing breath"]);
    expect(steps.map((s) => s.fig)).toEqual(["hand", 0, 1, 2, 3, 4, 5, 6, "arm", "breath"]);
  });

  it("says the setup line three times on the side of the hand", () => {
    const clips = steps[0].parts.flatMap((p) => ("vo" in p ? [p.vo.join(":")] : []));
    expect(clips).toEqual(["tapping-shared:0", "tapping-anxiety:0", "tapping-anxiety:0", "tapping-anxiety:0"]);
  });

  it("on each point names the point, then says the line, then leaves time to repeat it", () => {
    const parts = steps[3].parts; // side of the eye
    expect(parts[0]).toEqual({ vo: ["tapping-shared", 3] });
    expect(parts[2]).toEqual({ vo: ["tapping-anxiety", 3] });
    // The pause after the line is the line's own length plus two seconds.
    expect(parts[3]).toEqual({ gap: VOICE_SECS["tapping-anxiety"][3] + 2 });
  });

  it("shows each line in quotes with one full stop", () => {
    expect(steps[1].line).toBe("“All this worry I've been carrying.”");
  });

  it("a round takes about two minutes", () => {
    const secs = totalSeconds(steps, 1);
    expect(secs).toBeGreaterThan(90);
    expect(secs).toBeLessThan(170);
  });
});

describe("the wind-down and body resets", () => {
  it("the wind-down speaks each of its ten steps, then leaves quiet", () => {
    const steps = sleepSteps(SLEEP);
    expect(steps).toHaveLength(10);
    expect(steps[1].parts).toEqual([{ vo: ["sleep-wind-down", 1] }, { gap: 14 }]);
    expect(minutesLabel(totalSeconds(steps, 1))).toBe("4 minutes");
  });

  it("a body reset has no voice; a step with no time set gets twenty seconds", () => {
    const steps = resetSteps([
      { label: "A", cue: "x", secs: 30 },
      { label: "B", cue: "y", secs: null },
      { label: "C", cue: "z", secs: 0 },
    ]);
    expect(steps.map((s) => s.parts)).toEqual([[{ gap: 30 }], [{ gap: 20 }], [{ gap: 20 }]]);
  });
});

describe("pace changes the pauses, never the voice", () => {
  const step = sleepSteps(SLEEP)[0];
  it("a faster pace shortens only the quiet", () => {
    const normal = timeline(step, 1);
    const fast = timeline(step, 3);
    const slow = timeline(step, 0);
    // The clip starts at the same moment and is the same clip.
    expect(fast.clips).toEqual(normal.clips);
    expect(slow.clips).toEqual(normal.clips);
    const voice = VOICE_SECS["sleep-wind-down"][0];
    expect(normal.total).toBeCloseTo(0.5 + voice + 10, 5);
    expect(fast.total).toBeCloseTo(0.5 + voice + 10 / PACES[3], 5);
    expect(slow.total).toBeCloseTo(0.5 + voice + 10 / PACES[0], 5);
  });
  it("each later clip of a step starts after the one before it has finished", () => {
    for (const s of tapSteps(eftTheme("cravings", "Cravings"))) {
      for (const pace of [0, 1, 2, 3]) {
        const { clips, total } = timeline(s, pace);
        for (let i = 1; i < clips.length; i++) {
          const prev = clips[i - 1];
          expect(clips[i].at, `${s.title} pace ${pace}`).toBeGreaterThanOrEqual(prev.at + VOICE_SECS[prev.vo[0]][prev.vo[1]]);
        }
        const last = clips[clips.length - 1];
        expect(total).toBeGreaterThanOrEqual(last.at + VOICE_SECS[last.vo[0]][last.vo[1]]);
      }
    }
  });
  it("no step is so short that it flashes past", () => {
    expect(stepSeconds({ title: "", line: "", parts: [{ gap: 0.2 }] }, 3)).toBeGreaterThanOrEqual(2.1);
  });
});

describe("breathing", () => {
  it("knows where in the cycle it is", () => {
    expect(breathAt(BREATH, 0)).toMatchObject({ index: 0, label: "Breathe in", action: "expand", into: 0 });
    expect(breathAt(BREATH, 3.9)?.index).toBe(0);
    expect(breathAt(BREATH, 4)).toMatchObject({ index: 1, action: "shrink", into: 0 });
    expect(breathAt(BREATH, 9.5)?.index).toBe(1);
    expect(breathAt(BREATH, 10)?.index).toBe(0); // the next round
    expect(breathAt(BREATH, 127)?.into).toBeCloseTo(3, 5); // 127 s = twelve rounds and 7 s: three seconds into the out-breath
  });
  it("runs for the rounds the coach set, or one minute", () => {
    expect(breathTotalSeconds(BREATH, false)).toBe(300);
    expect(breathTotalSeconds(BREATH, true)).toBe(60);
    expect(breathTotalSeconds({ ...BREATH, rounds: 1 }, false)).toBe(60); // never under a minute
  });
  it("survives a practice with no phases", () => {
    expect(breathAt({ ...BREATH, phases: [] }, 5)).toBeNull();
  });
});

describe("practiceList — only what the coach prescribed", () => {
  it("lists nothing for a plan with no practices", () => {
    expect(practiceList({ eft: null, sleep: null, breathwork: null, somatic: [] })).toEqual([]);
  });
  it("lists the night one first, then breathing, tapping, body resets and the one-minute breath", () => {
    const list = practiceList(ALL_PRACTICES);
    expect(list.map((p) => p.id)).toEqual(["sleep", "breath", "tap", "reset:body-reset", "one"]);
    expect(list.map((p) => p.practiceId)).toEqual(["p-wind", "p-breath", "p-tap", "p-reset", ""]);
  });
  it("says so when a practice is led by the coach's voice, and only then", () => {
    const list = practiceList(ALL_PRACTICES);
    const meta = (id: string) => list.find((p) => p.id === id)!.meta;
    expect(meta("sleep")).toBe("4 minutes · before bed · led by your coach's voice");
    expect(meta("tap")).toBe("2 minutes a round · led by your coach's voice");
    expect(meta("breath")).toBe("5 minutes · to settle");
    expect(meta("reset:body-reset")).toBe("3 minutes · for tension");
    const unvoiced = practiceList({ ...ALL_PRACTICES, sleep: { ...SLEEP, steps: SLEEP.steps.slice(0, 5) } });
    expect(unvoiced.find((p) => p.id === "sleep")!.meta).not.toContain("voice");
  });
  it("offers the one-minute breath only when breathing is on the plan", () => {
    const ids = practiceList({ eft: eft(), sleep: null, breathwork: null, somatic: SOMATIC }).map((p) => p.id);
    expect(ids).toEqual(["tap", "reset:body-reset"]);
  });
  it("does not list a second one-minute breath when the prescribed one is about a minute", () => {
    const short = practiceList({ ...ALL_PRACTICES, breathwork: { ...BREATH, rounds: 6 } });
    expect(short.map((p) => p.id)).not.toContain("one");
    expect(short.find((p) => p.id === "breath")!.meta).toBe("1 minute · to settle");
  });
  it("never uses a pronoun for the coach", () => {
    const text = practiceList(ALL_PRACTICES).map((p) => `${p.title} ${p.meta}`).join(" ");
    expect(text).not.toMatch(/\b(she|her|hers)\b/i);
  });
});

describe("settings kept on the phone", () => {
  it("anything unreadable is the default", () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs("not json")).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('{"pace":9,"volume":-1,"scene":"moon","resume":{"tap":"x","sleep":0,"breath":3},"last":{"id":5}}')).toEqual({
      ...DEFAULT_PREFS,
      resume: { breath: 3 },
    });
  });
  it("round-trips what she chose", () => {
    const mine = { pace: 3, volume: 4, voice: false, music: false, scene: "rain" as const, resume: { tap: 4 }, last: { id: "sleep", ymd: "2026-11-19" } };
    expect(parsePrefs(JSON.stringify(mine))).toEqual(mine);
  });
});

describe("dim", () => {
  it("is on by default for the wind-down at any hour", () => {
    for (let h = 0; h < 24; h++) expect(dimByDefault("sleep", h)).toBe(true);
  });
  it("is on for any practice from 8 pm to 5 am, and off in the day", () => {
    expect(dimByDefault("tap", 19)).toBe(false);
    expect(dimByDefault("tap", 20)).toBe(true);
    expect(dimByDefault("breath", 3)).toBe(true);
    expect(dimByDefault("reset", 5)).toBe(false);
    expect(dimByDefault("tap", 13)).toBe(false);
  });
});

describe("clock", () => {
  it("counts down in minutes and seconds", () => {
    expect(clock(245)).toBe("4:05");
    expect(clock(0.2)).toBe("0:01");
    expect(clock(-3)).toBe("0:00");
  });
});
