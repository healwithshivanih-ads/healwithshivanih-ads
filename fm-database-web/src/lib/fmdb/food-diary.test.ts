/**
 * Food diary (docs/FOOD_DIARY_PLAN.md) — the rules that keep it a coach-started,
 * time-boxed, number-free photo diary.
 *
 * The four things this file exists to keep true:
 *   1. The client sees photos and nothing else — no coach correction and no
 *      AI reading (numbers) can reach a client screen.
 *   2. Nothing is sent when a diary starts, runs or ends; the only push is a
 *      reminder the client switched on herself (default OFF).
 *   3. Every finished diary reaches the coach's inbox once, and leaves it.
 *   4. The fold over two hosts' append-only files gives one consistent diary.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  DIARY_BANDS,
  DIARY_INBOX_DAYS,
  DIARY_REMINDERS,
  acceptClientDiaryDate,
  clientDiaryView,
  diaryBandForHour,
  diaryDayNumber,
  diaryGrid,
  diaryInboxAge,
  diaryOpenDates,
  diaryPhase,
  foldDiary,
  parseDiaryConfig,
  type DiaryLine,
  type FoodDiaryConfig,
} from "./food-diary";
import { bandForHour } from "@/app/app/[token]/day-plan";
import { deriveReminders, effectiveReminders } from "./reminders-derive";
import { collectDecisions, type DecisionInputs } from "./decisions";
import type { Lifecycle, LifecycleState } from "./lifecycle";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, "..", "..");
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), "utf8");

const CFG: FoodDiaryConfig = { id: "fd-1", start: "2026-10-23", days: 3, status: "active" };

const add = (id: string, over: Partial<DiaryLine> = {}): DiaryLine => ({
  op: "add",
  diary_id: "fd-1",
  ts: "2026-10-23T03:00:00Z",
  entry_id: id,
  date: "2026-10-23",
  time: "08:30",
  band: "morning",
  photo: `${id}.jpg`,
  note: "",
  ...over,
});

describe("bands", () => {
  it("infers the same part of the day as the app's 'Your day'", () => {
    for (let h = 0; h < 24; h++) expect(diaryBandForHour(h)).toBe(bandForHour(h));
  });
  it("never offers 'any time' — a meal happened at a time", () => {
    expect(DIARY_BANDS as readonly string[]).not.toContain("anytime");
  });
});

describe("config + window", () => {
  it("accepts what js-yaml hands back (Date) and what we write (string)", () => {
    expect(parseDiaryConfig({ id: "x", start: new Date("2026-10-23T00:00:00Z"), days: 3 })?.start).toBe("2026-10-23");
    expect(parseDiaryConfig({ id: "x", start: "2026-10-23", days: 3, status: "ended" })?.status).toBe("ended");
  });
  it("rejects a malformed switch rather than guessing", () => {
    expect(parseDiaryConfig(null)).toBeNull();
    expect(parseDiaryConfig({ id: "x", start: "soon", days: 3 })).toBeNull();
    expect(parseDiaryConfig({ id: "x", start: "2026-10-23", days: 0 })).toBeNull();
    expect(parseDiaryConfig({ id: "x", start: "2026-10-23", days: 30 })).toBeNull();
    expect(parseDiaryConfig({ start: "2026-10-23", days: 3 })).toBeNull();
  });
  it("runs from start through its last day, then finishes by itself", () => {
    expect(diaryPhase(CFG, "2026-10-22")).toBe("upcoming");
    expect(diaryPhase(CFG, "2026-10-23")).toBe("running");
    expect(diaryPhase(CFG, "2026-10-25")).toBe("running");
    expect(diaryPhase(CFG, "2026-10-26")).toBe("finished");
    expect(diaryPhase({ ...CFG, status: "ended" }, "2026-10-24")).toBe("finished");
    expect(diaryDayNumber(CFG, "2026-10-24")).toBe(2);
    expect(diaryOpenDates(CFG, "2026-10-24")).toEqual(["2026-10-23", "2026-10-24"]);
    expect(diaryOpenDates(CFG, "2026-10-26")).toEqual([]);
  });
  it("takes a phone's date a timezone away, but not a day outside the diary", () => {
    expect(acceptClientDiaryDate(CFG, "2026-10-24", "2026-10-23")).toBe(true); // phone a day ahead of UTC
    expect(acceptClientDiaryDate(CFG, "2026-10-25", "2026-10-23")).toBe(false); // two ahead
    expect(acceptClientDiaryDate(CFG, "2026-10-22", "2026-10-23")).toBe(false); // before the diary
    expect(acceptClientDiaryDate(CFG, "2026-10-25", "2026-10-27")).toBe(false); // over
    expect(acceptClientDiaryDate({ ...CFG, status: "ended" }, "2026-10-23", "2026-10-23")).toBe(false);
  });
});

describe("fold across hosts", () => {
  it("applies edits, deletes and the coach's correction in time order", () => {
    const fly: DiaryLine[] = [
      add("a"),
      add("b", { ts: "2026-10-23T07:00:00Z", time: "13:00", band: "midday" }),
      { op: "edit", diary_id: "fd-1", ts: "2026-10-23T08:00:00Z", entry_id: "a", note: "half a bowl" },
      { op: "delete", diary_id: "fd-1", ts: "2026-10-23T09:00:00Z", entry_id: "b" },
      { op: "day_done", diary_id: "fd-1", ts: "2026-10-23T16:00:00Z", date: "2026-10-23" },
    ];
    const mac: DiaryLine[] = [
      { op: "label", diary_id: "fd-1", ts: "2026-10-24T05:00:00Z", entry_id: "a", label: "2 moong chilla" },
      // A reading (phase 2) sits on the same entry with no migration.
      { op: "read", diary_id: "fd-1", ts: "2026-10-24T04:00:00Z", entry_id: "a", reading: { readable: true, confidence: 0.8 } },
    ];
    const f = foldDiary([...mac, ...fly], "fd-1");
    expect(f.entries.map((e) => e.entry_id)).toEqual(["a"]);
    expect(f.entries[0].note).toBe("half a bowl");
    expect(f.entries[0].coach_label).toBe("2 moong chilla");
    expect(f.entries[0].ai_reading?.readable).toBe(true);
    expect([...f.daysDone]).toEqual(["2026-10-23"]);
  });
  it("an empty correction clears the coach's label", () => {
    const f = foldDiary(
      [
        add("a"),
        { op: "label", diary_id: "fd-1", ts: "2026-10-24T05:00:00Z", entry_id: "a", label: "dal" },
        { op: "label", diary_id: "fd-1", ts: "2026-10-24T06:00:00Z", entry_id: "a", label: "" },
      ],
      "fd-1",
    );
    expect(f.entries[0].coach_label).toBeUndefined();
  });
  it("ignores lines for other diaries and edits to entries nobody added", () => {
    const f = foldDiary(
      [
        add("a", { diary_id: "fd-old" }),
        { op: "edit", diary_id: "fd-1", ts: "2026-10-23T08:00:00Z", entry_id: "ghost", note: "x" },
      ],
      "fd-1",
    );
    expect(f.entries).toEqual([]);
  });
  it("grids every day × band, even empty ones", () => {
    const g = diaryGrid(CFG, foldDiary([add("a")], "fd-1").entries);
    expect(g.map((d) => d.dayNumber)).toEqual([1, 2, 3]);
    expect(g[0].bands.find((b) => b.band === "morning")?.entries).toHaveLength(1);
    expect(g[1].count).toBe(0);
  });
});

describe("the client sees photos, never numbers", () => {
  const folded = foldDiary(
    [
      add("a", { note: "homemade" }),
      { op: "label", diary_id: "fd-1", ts: "2026-10-24T05:00:00Z", entry_id: "a", label: "2 chilla" },
      {
        op: "read",
        diary_id: "fd-1",
        ts: "2026-10-24T05:00:00Z",
        entry_id: "a",
        reading: { readable: true, confidence: 0.9, dishes: [{ name: "chilla", portion: "2 pieces" }] },
      },
    ],
    "fd-1",
  );

  it("carries exactly the photo fields — no label, no reading", () => {
    const v = clientDiaryView(CFG, folded, "2026-10-23")!;
    expect(Object.keys(v.entries[0]).sort()).toEqual(["band", "date", "entry_id", "file", "note", "time"]);
    expect(JSON.stringify(v)).not.toMatch(/chilla|confidence|dishes|portion|coach_label|ai_reading/);
  });
  it("exists only while the diary runs", () => {
    expect(clientDiaryView(CFG, folded, "2026-10-22")).toBeNull();
    expect(clientDiaryView(CFG, folded, "2026-10-26")).toBeNull();
    expect(clientDiaryView({ ...CFG, status: "ended" }, folded, "2026-10-24")).toBeNull();
    expect(clientDiaryView(CFG, folded, "2026-10-25")?.isLastDay).toBe(true);
  });
  it("the card never reads a reading, a correction or a nutrient", () => {
    // Code only — the header comment explains the rule in these very words.
    const card = read("app/app/[token]/ochre-diary.tsx")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(card).not.toMatch(/coach_label|ai_reading|reading\.|protein|kcal|calorie|grams|\bfibre\b/i);
  });
});

describe("nothing is sent unless the client asked", () => {
  it("diary reminders exist only while it runs, and start OFF", () => {
    const client = { client_id: "c", food_diary: { id: "fd-1", start: "2026-10-23", days: 3, status: "active" } };
    const ids = DIARY_REMINDERS.map((r) => r.id) as readonly string[];
    const during = effectiveReminders(deriveReminders({}, client, { todayIso: "2026-10-24" }), {});
    const mine = during.filter((r) => ids.includes(r.id));
    expect(mine).toHaveLength(3);
    expect(mine.every((r) => r.on === false)).toBe(true);
    const after = deriveReminders({}, client, { todayIso: "2026-10-26" });
    expect(after.some((r) => ids.includes(r.id))).toBe(false);
    const ended = deriveReminders({}, { ...client, food_diary: { ...client.food_diary, status: "ended" } }, { todayIso: "2026-10-24" });
    expect(ended.some((r) => ids.includes(r.id))).toBe(false);
  });
  it("switched on by the client, they fire", () => {
    const client = { client_id: "c", food_diary: { id: "fd-1", start: "2026-10-23", days: 3 } };
    const eff = effectiveReminders(deriveReminders({}, client, { todayIso: "2026-10-23" }), { "diary-lunch": { on: true } });
    expect(eff.find((r) => r.id === "diary-lunch")?.on).toBe(true);
  });
  it("no diary path imports a send", () => {
    const SEND = /sendPushToClient|sendWhatsApp|notifyClient|notifyCoach|chat-notify|push-server|sendClientEmail|nodemailer|whatsapp\/actions/;
    for (const f of [
      "lib/server-actions/food-diary.ts",
      "app/api/app-diary/route.ts",
      "lib/fmdb/food-diary.ts",
      "lib/fmdb/food-diary-store.ts",
      "app/app/[token]/ochre-diary.tsx",
    ]) {
      expect(read(f), f).not.toMatch(SEND);
    }
  });
});

describe("the coach's inbox", () => {
  const life = (state: LifecycleState): Lifecycle => ({
    state,
    since: null,
    reason: "",
    planSlug: null,
    planEndsOn: null,
    daysSinceEnd: null,
    declined: false,
    optedOut: false,
    engagement: "",
  });
  const inputs = (today: string, config: FoodDiaryConfig, state: LifecycleState = "active"): DecisionInputs => ({
    todayYmd: today,
    lifecycle: new Map([["c", life(state)]]),
    nameOf: () => "Shweta",
    inbound: [],
    repliedTo: new Set(),
    renewals: [],
    followupDrafts: [],
    followupScheduled: [],
    followupUnanchored: [],
    winbackDrafts: [],
    winbackScheduled: [],
    notes: [],
    plateaued: [],
    regressed: [],
    feedback: [],
    archiveCandidates: [],
    onboardingStep: new Map(),
    diaries: [{ client_id: "c", display_name: "Shweta", config, photos: 9 }],
  });
  const diaryItems = (i: DecisionInputs) => collectDecisions(i).items.filter((x) => x.kind === "diary");

  it("says nothing while the diary runs", () => {
    expect(diaryItems(inputs("2026-10-25", CFG))).toEqual([]);
  });
  it("one item the day after it finishes — ready to look at, not photos to label", () => {
    const items = diaryItems(inputs("2026-10-26", CFG));
    expect(items).toHaveLength(1);
    expect(items[0].why).toMatch(/ready to look at/);
    expect(items[0].why).not.toMatch(/label/i);
    expect(items[0].href).toBe("/clients-v2/c/analyse#food-diary");
  });
  it("ended early by the coach → ready that day", () => {
    const ended: FoodDiaryConfig = { ...CFG, status: "ended", ended_at: "2026-10-24T10:00:00Z" };
    expect(diaryInboxAge(ended, "2026-10-24")).toBe(0);
  });
  it("leaves when reviewed, or after the age cap", () => {
    expect(diaryItems(inputs("2026-10-27", { ...CFG, reviewed_at: "2026-10-27T05:00:00Z" }))).toEqual([]);
    expect(diaryItems(inputs("2026-11-10", CFG))).toEqual([]);
    expect(diaryInboxAge(CFG, "2026-11-09")).toBe(DIARY_INBOX_DAYS);
    expect(diaryInboxAge(CFG, "2026-11-10")).toBeNull();
  });
  it("never for an archived person", () => {
    expect(diaryItems(inputs("2026-10-26", CFG, "archived"))).toEqual([]);
  });
});
