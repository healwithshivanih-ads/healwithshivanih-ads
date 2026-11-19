/**
 * The food diary in the new front. The server side (what a client may see) is
 * pinned in food-diary.test.ts; these pin what the new screens say.
 * Harness: renderToStaticMarkup with a hand-made diary state, so no fetch runs.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ClientAppData } from "@/lib/fmdb/client-app";
import type { ClientDiaryEntry, ClientDiaryView } from "@/lib/fmdb/food-diary";
import { SqDiaryCard, SqDiarySheet, diaryClock, type SqDiaryState } from "./sq-diary";

const noop = () => {};
const ENTRY: ClientDiaryEntry = {
  entry_id: "e1",
  date: "2026-11-19",
  time: "13:05",
  band: "midday",
  note: "",
  file: "e1.jpg",
  marks: { protein: "present", veg: "light" },
  looksLike: "dal, rice and bhindi",
  feedback: "Good protein here from the dal.",
};
function view(over: Partial<ClientDiaryView> = {}): ClientDiaryView {
  return {
    id: "fd-1",
    days: 5,
    dayNumber: 2,
    today: "2026-11-19",
    isLastDay: false,
    finished: false,
    openDates: ["2026-11-18", "2026-11-19"],
    entries: [ENTRY],
    daysDone: [],
    tip: null,
    ...over,
  };
}
function state(v: ClientDiaryView | null, over: Partial<SqDiaryState> = {}): SqDiaryState {
  return {
    view: v,
    todays: v ? v.entries.filter((e) => e.date === v.today) : [],
    tip: v?.tip ?? null,
    doneToday: false,
    draft: null,
    setDraft: noop,
    busy: false,
    error: null,
    flash: null,
    photoUrl: (f: string) => `/p/${f}`,
    pickPhoto: noop,
    input: null,
    closeDraft: noop,
    saveDraft: async () => {},
    markDone: async () => {},
    saveEntry: async () => true,
    removeEntry: async () => true,
    ...over,
  } as SqDiaryState;
}
const DATA = { token: "t", reminders: [] } as unknown as ClientAppData;

describe("the Home card", () => {
  it("is not there when no diary runs", () => {
    expect(renderToStaticMarkup(<SqDiaryCard d={state(null)} onOpen={noop} />)).toBe("");
  });
  it("shows the day and one big button that opens the camera", () => {
    const html = renderToStaticMarkup(<SqDiaryCard d={state(view())} onOpen={noop} />);
    expect(html).toContain("Food diary · Day 2 of 5");
    expect(html).toContain("Add a photo");
    expect(html).toContain("Today’s photos (1)");
    expect(html).toContain('aria-label="Protein at each meal today"');
  });
  it("folds to a thank-you once the day is done", () => {
    const html = renderToStaticMarkup(<SqDiaryCard d={state(view(), { doneToday: true })} onOpen={noop} />);
    expect(html).toContain("Day 2 done. Thank you.");
    expect(html).toContain("Tomorrow is Day 3.");
    expect(html).toContain("Add more");
  });
  it("ends with the coach, never by name, and the tip", () => {
    const tip = { strength: "Protein at most lunches.", fix: "Add a bowl of curd at dinner." };
    const html = renderToStaticMarkup(<SqDiaryCard d={state(view({ finished: true, tip }))} onOpen={noop} />);
    expect(html).toContain("Your coach will go through it with you.");
    expect(html).toContain("Protein at most lunches.");
    expect(html).toContain("Add a bowl of curd at dinner.");
  });
});

describe("the sheet", () => {
  it("lists today's photo with what it looks like, a way to correct it, and words not numbers", () => {
    const html = renderToStaticMarkup(<SqDiarySheet d={state(view())} data={DATA} />);
    expect(html).toContain("Looks like dal, rice and bhindi");
    expect(html).toContain("Not right?");
    expect(html).toContain("Protein ✓");
    expect(html).toContain("Light on veg");
    expect(html).toContain("Good protein here from the dal.");
    expect(html).toContain("Lunch · 1:05 pm");
    expect(html).toContain("Done for today");
    expect(html).not.toMatch(/\d+\s*g\b/);
  });
  it("says a photo is being looked at until its marks arrive", () => {
    const waiting = { ...ENTRY, marks: undefined, looksLike: undefined, feedback: undefined };
    const html = renderToStaticMarkup(<SqDiarySheet d={state(view({ entries: [waiting] }))} data={DATA} />);
    expect(html).toContain("Being looked at…");
  });
  it("shows protein grams only when the server sent them (coach switched grams on)", () => {
    const html = renderToStaticMarkup(<SqDiarySheet d={state(view({ gramsToday: 45 }))} data={DATA} />);
    expect(html).toContain("About 45 g of protein today");
  });
});

describe("rules", () => {
  it("never names the coach and never sends a message", () => {
    const src = fs.readFileSync(path.join(__dirname, "sq-diary.tsx"), "utf8");
    expect(src).not.toMatch(/coach\?\.name|data\.coach/);
    expect(src).not.toMatch(/app-chat|whatsapp|sendMessage/i);
  });
  it("shows a time the way a phone does", () => {
    expect(diaryClock("13:05")).toBe("1:05 pm");
    expect(diaryClock("00:30")).toBe("12:30 am");
  });
});
