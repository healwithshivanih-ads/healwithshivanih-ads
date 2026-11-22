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
  it("has 8 weekly sessions plus daily, night and flare-up", () => {
    const ids = CALM_GUT.tracks.map((t) => t.id);
    expect(ids).toEqual(["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "daily", "night", "flare"]);
    expect(CALM_GUT.tracks.filter((t) => t.kind === "session").map((t) => t.week)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("carries the approved safety text, and the extra lines on session 7 and the flare-up", () => {
    expect(CALM_GUT.safety).toMatch(/never while driving, cooking, bathing or caring for a child/);
    expect(CALM_GUT.safety).toMatch(/new symptoms after 50/);
    expect(getCourseTrack(CALM_GUT, "s7")!.safetyExtra).toMatch(/chest pain can be the heart/);
    expect(getCourseTrack(CALM_GUT, "flare")!.safetyExtra).toMatch(/severe, new, or different/);
  });

  it("never makes a claim the copy rules forbid", () => {
    const all = JSON.stringify(CALM_GUT).toLowerCase();
    for (const w of ["cure", "heal", "treats", "guarantee", "permanent", "supplement", "ai voice", "voice clone"]) {
      expect(all).not.toContain(w);
    }
    expect(CALM_GUT.tagline).toMatch(/may ease/);
  });

  it("leaves the 8 readings as placeholders for now", () => {
    expect(CALM_GUT.tracks.every((t) => t.reading === null)).toBe(true);
  });

  it("keys audio by course, revision, track and version", () => {
    expect(courseAudioKey(CALM_GUT, getCourseTrack(CALM_GUT, "s3")!, "voice")).toBe("calm-gut/d1/s3-voice.m4a");
    expect(courseAudioKey(CALM_GUT, getCourseTrack(CALM_GUT, "flare")!, "music")).toBe("calm-gut/d2/flare-music.m4a");
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

describe("symptom check at weeks 0, 6 and 12", () => {
  it("is due from day 0 until done", () => {
    expect(dueScoreWeek(CALM_GUT, 0, [])).toBe(0);
    expect(dueScoreWeek(CALM_GUT, 5, [])).toBe(0);
    expect(dueScoreWeek(CALM_GUT, 5, [0])).toBeNull();
  });
  it("week 6 opens on day 42; a missed week-0 check is dropped then", () => {
    expect(dueScoreWeek(CALM_GUT, 41, [0])).toBeNull();
    expect(dueScoreWeek(CALM_GUT, 42, [0])).toBe(6);
    expect(dueScoreWeek(CALM_GUT, 42, [])).toBe(6);
    expect(scoreCheckpointFor(CALM_GUT, 43)).toBe(6);
  });
  it("week 12 opens on day 84", () => {
    expect(dueScoreWeek(CALM_GUT, 84, [0, 6])).toBe(12);
    expect(dueScoreWeek(CALM_GUT, 200, [0, 6, 12])).toBeNull();
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
