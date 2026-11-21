import { describe, expect, it } from "vitest";
import type { AppWeekMenu } from "@/lib/fmdb/client-app";
import { dayGroceries, prepFor, upcomingDays } from "./sq-days";

const slot = (slotName: string, dish: string, method: string[] = []) => ({
  slot: slotName,
  dish,
  recipe: method.length ? { title: dish, ingredients: [], method } : undefined,
});
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const week = (n: number, current: boolean, todayIdx = -1): AppWeekMenu => ({
  week: n,
  current,
  days: DOW.map((dow, i) => ({
    dow,
    dateLabel: `${i + 1 + n * 7} Nov`,
    today: i === todayIdx || undefined,
    slots: [slot("Lunch", `Dal w${n}${dow}`), slot("Dinner", i === 6 ? "Rajma rice" : `Sabzi w${n}${dow}`, i === 6 ? ["Soak the rajma overnight.", "Pressure cook."] : [])],
  })),
});

describe("upcomingDays", () => {
  it("starts at today and runs into the next week", () => {
    const d = upcomingDays([week(1, true, 5), week(2, false)]);
    expect(d.map((x) => x.chip)).toEqual(["Today", "Sun 14", "Mon 15", "Tue 16", "Wed 17", "Thu 18", "Fri 19"]);
    expect(d[0].isToday).toBe(true);
  });
  it("stops where the menu stops", () => {
    expect(upcomingDays([week(1, true, 5)]).length).toBe(2);
  });
});

describe("prepFor", () => {
  it("finds a soak step for the day", () => {
    const d = upcomingDays([week(1, true, 5)]);
    expect(prepFor(d[1])).toEqual({ dish: "Rajma rice", step: "Soak the rajma overnight." });
    expect(prepFor(d[0])).toBeNull();
  });
});

describe("dayGroceries", () => {
  it("lists each meal's own recipe ingredients", () => {
    const d = upcomingDays([week(1, true, 5)]);
    const g = dayGroceries(d[1]);
    expect(g.map((m) => m.meal)).toEqual(["Lunch", "Dinner"]);
    expect(g[0].items).toEqual([]);
  });
});
