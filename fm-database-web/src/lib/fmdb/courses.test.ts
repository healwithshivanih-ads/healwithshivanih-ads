import { describe, expect, it } from "vitest";
import {
  CALM_GUT,
  courseAudioKey,
  courseDay,
  dueScoreWeek,
  getCourse,
  getCourseTrack,
  isTrackUnlocked,
  scoreCheckpointFor,
  trackUnlockYmd,
} from "./courses";
import { dueCourseReminders } from "./course-reminders";
import { emptyCourseRecord } from "./course-store";

describe("Calm Gut course definition", () => {
  it("has 8 weekly sessions, daily, night, flare-up and 8 weekly intros", () => {
    const ids = CALM_GUT.tracks.map((t) => t.id);
    expect(ids).toEqual(["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "daily", "daily-short", "night", "flare", "r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8"]);
    expect(CALM_GUT.tracks.filter((t) => t.kind === "session").map((t) => t.week)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("carries the approved safety text, and the extra lines on session 7 and the flare-up", () => {
    // Word for word the text used on the course pages and in the emails (22 Nov).
    expect(CALM_GUT.safety).toBe(
      "Listen only when you can safely close your eyes: never while driving, cooking or bathing, and not while you're the only adult with a child who is awake. Listening while your baby sleeps nearby and you're lying down is fine. This does not replace a diagnosis or your medicine. Blood in stools, weight loss without trying, symptoms that wake you at night, or new or clearly changed symptoms after 50 mean seeing a doctor first.",
    );
    expect(getCourseTrack(CALM_GUT, "s7")!.safetyExtra).toMatch(/chest pain can be the heart/);
    expect(getCourseTrack(CALM_GUT, "flare")!.safetyExtra).toMatch(/severe, new, or different/);
  });

  it("never makes a claim the copy rules forbid", () => {
    const all = JSON.stringify(CALM_GUT).toLowerCase();
    for (const w of ["cure", "treats ibs", "treats gerd", "guarantee", "permanent", "supplement", "ai voice", "voice clone"]) {
      expect(all).not.toContain(w);
    }
    // "heal" only ever in the negative (week 7: "It doesn't heal damage…").
    for (const m of all.matchAll(/(\S+\s+)heal/g)) expect(m[1].trim()).toBe("doesn't");
    expect(CALM_GUT.tagline).toMatch(/may ease/);
  });

  it("each session carries its week's reading and its voiced intro", () => {
    for (let n = 1; n <= 8; n++) {
      const s = getCourseTrack(CALM_GUT, `s${n}`)!;
      const r = getCourseTrack(CALM_GUT, `r${n}`)!;
      expect(s.introId).toBe(`r${n}`);
      expect(s.reading && s.reading.length).toBeGreaterThan(400);
      expect(r.reading).toBe(s.reading);
      expect(r).toMatchObject({ kind: "intro", week: n, voiceOnly: true, rev: "d1" });
    }
    expect(getCourseTrack(CALM_GUT, "s1")!.readingTitle).toBe("Your gut has a mind of its own");
    expect(getCourseTrack(CALM_GUT, "daily")!.reading).toBeNull();
  });

  it("an intro's key is always the voice file (there is no music version)", () => {
    const r3 = getCourseTrack(CALM_GUT, "r3")!;
    expect(courseAudioKey(CALM_GUT, r3, "music")).toBe("calm-gut/d1/r3-voice.m4a");
    expect(courseAudioKey(CALM_GUT, r3, "voice")).toBe("calm-gut/d1/r3-voice.m4a");
  });

  it("an intro opens with its week", () => {
    const r2 = getCourseTrack(CALM_GUT, "r2")!;
    expect(isTrackUnlocked(r2, 6)).toBe(false);
    expect(isTrackUnlocked(r2, 7)).toBe(true);
  });

  it("has a short daily practice slot, open from day 0, with music and voice files", () => {
    const short = getCourseTrack(CALM_GUT, "daily-short")!;
    expect(short).toMatchObject({ kind: "practice", title: "Short daily practice", rev: "d2", minutes: { music: 7, voice: 7 } });
    expect(isTrackUnlocked(short, 0)).toBe(true);
    expect(courseAudioKey(CALM_GUT, short, "music")).toBe("calm-gut/d2/daily-short-music.m4a");
  });

  it("keys audio by course, revision, track and version", () => {
    expect(courseAudioKey(CALM_GUT, getCourseTrack(CALM_GUT, "s3")!, "voice")).toBe("calm-gut/d2/s3-voice.m4a");
    expect(courseAudioKey(CALM_GUT, getCourseTrack(CALM_GUT, "flare")!, "music")).toBe("calm-gut/d3/flare-music.m4a");
  });

  it("getCourse refuses unknown slugs", () => {
    expect(getCourse("calm-gut")).toBe(CALM_GUT);
    expect(getCourse("calm-gut-course")).toBeNull();
    expect(getCourse("")).toBeNull();
  });
});

describe("weekly unlock from the payment day", () => {
  const s1 = getCourseTrack(CALM_GUT, "s1")!;
  const s2 = getCourseTrack(CALM_GUT, "s2")!;
  const s8 = getCourseTrack(CALM_GUT, "s8")!;
  const daily = getCourseTrack(CALM_GUT, "daily")!;
  const flare = getCourseTrack(CALM_GUT, "flare")!;

  it("week 1, daily, night and flare-up are open on the day they pay", () => {
    expect(courseDay("2026-12-08", "2026-12-08")).toBe(0);
    for (const t of [s1, daily, flare]) expect(isTrackUnlocked(t, 0)).toBe(true);
    expect(isTrackUnlocked(s2, 0)).toBe(false);
  });

  it("session 2 opens exactly 7 days later, session 8 on day 49", () => {
    expect(isTrackUnlocked(s2, 6)).toBe(false);
    expect(isTrackUnlocked(s2, 7)).toBe(true);
    expect(isTrackUnlocked(s8, 48)).toBe(false);
    expect(isTrackUnlocked(s8, 49)).toBe(true);
    expect(trackUnlockYmd(s2, "2026-12-08")).toBe("2026-12-15");
    expect(trackUnlockYmd(s8, "2026-12-08")).toBe("2027-01-26");
  });

  it("nothing is open before the start day", () => {
    expect(isTrackUnlocked(daily, -1)).toBe(false);
  });
});

describe("symptom check at weeks 0, 4 and 8 (start, halfway, end)", () => {
  it("is due from day 0 until done", () => {
    expect(dueScoreWeek(CALM_GUT, 0, [])).toBe(0);
    expect(dueScoreWeek(CALM_GUT, 5, [])).toBe(0);
    expect(dueScoreWeek(CALM_GUT, 5, [0])).toBeNull();
  });
  it("the schedule is the start, halfway and the end of the 8 weeks", () => {
    expect(CALM_GUT.scoreWeeks).toEqual([0, 4, 8]);
  });
  it("week 4 opens on day 28 (halfway); a missed week-0 check is dropped then", () => {
    expect(dueScoreWeek(CALM_GUT, 27, [0])).toBeNull();
    expect(dueScoreWeek(CALM_GUT, 28, [0])).toBe(4);
    expect(dueScoreWeek(CALM_GUT, 28, [])).toBe(4);
    expect(scoreCheckpointFor(CALM_GUT, 29)).toBe(4);
  });
  it("week 8 opens on day 56, when the eight weeks are done", () => {
    expect(dueScoreWeek(CALM_GUT, 55, [0, 4])).toBeNull();
    expect(dueScoreWeek(CALM_GUT, 56, [0, 4])).toBe(8);
    expect(dueScoreWeek(CALM_GUT, 200, [0, 4, 8])).toBeNull();
  });
});

describe("course reminders (only what the listener chose)", () => {
  const base = { course: CALM_GUT, startYmd: "2026-12-08", fired: {} as Record<string, string> };

  it("sends nothing when they chose nothing", () => {
    const record = emptyCourseRecord("calm-gut");
    record.reminders = { daily_time: null, unlock: false };
    expect(dueCourseReminders({ ...base, record, todayYmd: "2026-12-15", nowMin: 9 * 60 })).toEqual([]);
  });

  it("the daily reminder fires at their time (and up to 3 h late), once a day", () => {
    const record = emptyCourseRecord("calm-gut");
    record.reminders = { daily_time: "20:30", unlock: false };
    const at = (nowMin: number, fired = {}) =>
      dueCourseReminders({ ...base, fired, record, todayYmd: "2026-12-10", nowMin }).map((r) => r.key);
    expect(at(20 * 60 + 29)).toEqual([]);
    expect(at(20 * 60 + 30)).toEqual(["daily:calm-gut"]);
    expect(at(23 * 60 + 30)).toEqual(["daily:calm-gut"]);
    expect(at(23 * 60 + 31)).toEqual([]);
    expect(at(20 * 60 + 40, { "daily:calm-gut": "2026-12-10" })).toEqual([]);
  });

  it("the daily reminder stays quiet once they have listened today", () => {
    const record = emptyCourseRecord("calm-gut");
    record.reminders = { daily_time: "08:00", unlock: false };
    record.days["2026-12-10"] = { listened: true };
    expect(dueCourseReminders({ ...base, record, todayYmd: "2026-12-10", nowMin: 8 * 60 + 5 })).toEqual([]);
  });

  it("'new session open' goes on the unlock day only, at 09:00, never for week 1", () => {
    const record = emptyCourseRecord("calm-gut");
    const due = (today: string, nowMin: number) =>
      dueCourseReminders({ ...base, record, todayYmd: today, nowMin }).map((r) => r.body);
    expect(due("2026-12-08", 9 * 60)).toEqual([]); // day 0: week 1 opened at purchase
    expect(due("2026-12-15", 8 * 60 + 59)).toEqual([]);
    expect(due("2026-12-15", 9 * 60)).toEqual(['Week 2 is open: "Turning down the volume".']);
    expect(due("2026-12-16", 9 * 60)).toEqual([]);
  });

  it("nothing before the course starts", () => {
    const record = emptyCourseRecord("calm-gut");
    record.reminders = { daily_time: "08:00", unlock: true };
    expect(dueCourseReminders({ ...base, record, todayYmd: "2026-12-07", nowMin: 9 * 60 })).toEqual([]);
  });
});
