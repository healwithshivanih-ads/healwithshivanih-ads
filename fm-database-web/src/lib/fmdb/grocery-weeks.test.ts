import { describe, it, expect } from "vitest";
import { menuWeekKey, planGroceryRefresh } from "./grocery-weeks";

const menuWeek = (week: number, dish = `dish-${week}`) => ({
  week,
  days: [{ slots: [{ slot: "Breakfast", dish }, { slot: "Lunch", dish: `${dish} lunch` }] }],
});
const entry = (week: number, menu_key?: string) => ({ week, menu_key, categories: [`c${week}`] });

describe("menuWeekKey", () => {
  it("is stable for the same dishes and changes when a dish changes", () => {
    const a = menuWeekKey(menuWeek(3, "Poha"));
    expect(menuWeekKey(menuWeek(3, "Poha"))).toBe(a);
    expect(menuWeekKey(menuWeek(3, "Upma"))).not.toBe(a);
  });
  it("ignores the week number itself — only the food matters", () => {
    expect(menuWeekKey(menuWeek(3, "Poha"))).toBe(menuWeekKey(menuWeek(9, "Poha")));
  });
  it("tolerates an empty or malformed week", () => {
    expect(menuWeekKey({})).toMatch(/^[0-9a-f]{8}$/);
    expect(menuWeekKey({ days: [{ slots: null }, {}] })).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("planGroceryRefresh", () => {
  it("on approval of the next week, generates ONLY that week and keeps the rest", () => {
    // Nazneen after today's fix: weeks 1–5 live, current week 4, lists on disk
    // for 4 only (keyed) — week 5 just went live.
    const menu = [1, 2, 3, 4, 5].map((n) => menuWeek(n));
    const existing = [entry(4, menuWeekKey(menu[3]))];
    const p = planGroceryRefresh(menu, existing, 4);
    expect(p.generate).toEqual([5]);
    expect(p.keep.map((e) => e.week)).toEqual([4]);
    expect(p.dropped).toEqual([]);
    expect(p.keys[5]).toBe(menuWeekKey(menu[4]));
  });

  it("does not generate lists for weeks already behind the client", () => {
    const menu = [1, 2, 3, 4, 5].map((n) => menuWeek(n));
    const p = planGroceryRefresh(menu, [], 4);
    expect(p.generate).toEqual([4, 5]);
  });

  it("keeps an older week's list as long as that week is still on the menu", () => {
    const menu = [2, 3, 4].map((n) => menuWeek(n));
    const p = planGroceryRefresh(menu, [entry(2, "anything"), entry(4, menuWeekKey(menu[2]))], 4);
    expect(p.keep.map((e) => e.week)).toEqual([2, 4]);
    expect(p.generate).toEqual([]);
  });

  it("drops a stored week the menu no longer carries", () => {
    const menu = [1, 2].map((n) => menuWeek(n));
    const p = planGroceryRefresh(menu, [entry(12, "old"), entry(2, menuWeekKey(menu[1]))], 2);
    expect(p.dropped).toEqual([12]);
    expect(p.keep.map((e) => e.week)).toEqual([2]);
  });

  it("regenerates a wanted week whose dishes changed (coach edit)", () => {
    const menu = [menuWeek(4, "Poha"), menuWeek(5)];
    const stale = entry(4, menuWeekKey(menuWeek(4, "Upma")));
    const p = planGroceryRefresh(menu, [stale, entry(5, menuWeekKey(menu[1]))], 4);
    expect(p.generate).toEqual([4]);
    expect(p.keep.map((e) => e.week)).toEqual([5]);
  });

  it("treats a legacy entry with no key as stale, once", () => {
    const menu = [menuWeek(4), menuWeek(5)];
    const p = planGroceryRefresh(menu, [entry(4), entry(5)], 4);
    expect(p.generate).toEqual([4, 5]);
  });

  it("nothing to do when every wanted week is fresh", () => {
    const menu = [menuWeek(4), menuWeek(5)];
    const p = planGroceryRefresh(menu, [entry(4, menuWeekKey(menu[0])), entry(5, menuWeekKey(menu[1]))], 4);
    expect(p.generate).toEqual([]);
    expect(p.dropped).toEqual([]);
    expect(p.keep.length).toBe(2);
  });

  it("force regenerates the wanted weeks but still leaves older ones alone", () => {
    const menu = [1, 2, 3].map((n) => menuWeek(n));
    const existing = menu.map((m) => entry(m.week, menuWeekKey(m)));
    const p = planGroceryRefresh(menu, existing, 2, true);
    expect(p.generate).toEqual([2, 3]);
    expect(p.keep.map((e) => e.week)).toEqual([1]);
  });

  it("a frozen client (current week not live) gets the latest live week", () => {
    const menu = [1, 2, 3, 4, 5].map((n) => menuWeek(n));
    const p = planGroceryRefresh(menu, [], 8);
    expect(p.generate).toEqual([5]);
  });

  it("a successor still on carried weeks shops from those", () => {
    const menu = [menuWeek(11), menuWeek(12)];
    const p = planGroceryRefresh(menu, [], 1);
    expect(p.generate).toEqual([11, 12]);
  });

  it("handles no live menu at all", () => {
    const p = planGroceryRefresh([], [entry(1, "x")], 1);
    expect(p.generate).toEqual([]);
    expect(p.dropped).toEqual([1]);
  });
});
