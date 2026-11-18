/**
 * Home as drawn — what a switched-on client actually reads.
 *
 * sq-day.test.ts pins the rules; this pins that the screen SHOWS them: the
 * one "next" card, the supplements as their own taps, the Undo line, the
 * later list, and that nothing prescribed is left with nowhere to be found.
 *
 * Harness: renderToStaticMarkup, as in ochre-screens-render.test.tsx. The
 * clock and the ticks are passed in, so every case is exact. Synthetic plan.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AppMeal, AppPractice, AppSupplement, ClientAppData } from "@/lib/fmdb/client-app";
import type { BandKey } from "./day-plan";
import { buildMoments, dayRows, type SqTicks } from "./sq-day";
import { SqHome, type SqHomeProps } from "./sq-home";
import { SqDaySheet, SqRecipeSheet, SqRecordDaySheet, SqRecordSheet } from "./sq-sheets";

const noop = () => {};
const meal = (slot: string, titles: string[], timeHint = ""): AppMeal =>
  ({ slot, timeHint, glyph: "", pills: titles, components: titles.map((title) => ({ title })) }) as AppMeal;
const supp = (id: string, name: string, chronoRank: number, extra: Partial<AppSupplement> = {}): AppSupplement =>
  ({ id, name, dose: "1 capsule", slot: "Morning", timing: "", chronoRank, why: "", ...extra }) as AppSupplement;
const practice = (id: string, name: string, part: AppPractice["part"], kind: AppPractice["kind"] = "daily"): AppPractice => ({
  id,
  name,
  when: "",
  kind,
  part,
  dueToday: true,
});

const PLAN = {
  meals: [
    meal("Breakfast", ["Besan chilla"], "8:30 am"),
    meal("Lunch", ["Palak moong dal", "Jowar roti"], "1:00 pm"),
    meal("Dinner", ["Moong khichdi"], "7:30 pm"),
  ],
  supplements: [
    supp("s-iron", "Iron", 20, { notDaily: "alternate" }),
    supp("s-d3", "Vitamin D3", 40),
    supp("s-b", "B-complex", 45),
    supp("s-magnesium", "Magnesium glycinate", 70),
  ],
  remedies: [],
  practices: [practice("p-wind", "Sleep wind-down", "bedtime"), practice("p-strength", "Strength session", "anytime", "weekly")],
};

function payload(over: Record<string, unknown> = {}): ClientAppData {
  return {
    clientId: "cl-test",
    client: { firstName: "Asha", week: 4, totalWeeks: 12, notStarted: false },
    coach: { name: "Zzyzx Qwerty" },
    today: { dow: "Wednesday", dateLabel: "18 November", idx: 2 },
    ...PLAN,
    mealExtra: { Lunch: { grad: "", ingredients: ["1 cup moong dal", "2 cups spinach"], recipe: ["Cook the dal.", "Add the spinach."], swaps: [] } },
    grocery: null,
    sq: { planDay: 20, tickHistory: [], daysSinceLastOpen: 0 },
    ...over,
  } as unknown as ClientAppData;
}

const NONE: SqTicks = { logged: {}, practicesDone: {}, practiceAt: {} };

function home(o: { ticks?: SqTicks; band?: BandKey; data?: ClientAppData } & Partial<SqHomeProps> = {}): string {
  const { ticks = NONE, band = "midday", hour = 13, data = payload(), ...rest } = o;
  return renderToStaticMarkup(
    <SqHome
      data={data}
      moments={buildMoments(PLAN)}
      ticks={ticks}
      ready
      hour={hour}
      nowBand={band}
      checkinSentWeek={0}
      track={false}
      lastId={null}
      onDone={noop}
      onUndo={noop}
      onToggle={noop}
      open={noop}
      returnDismissed={false}
      onDismissReturn={noop}
      {...rest}
    />,
  );
}

const hero = (html: string) => html.match(/<section class="sq-hero".*?<\/section>/)?.[0] ?? "";
const text = (html: string) => html.replace(/<svg.*?<\/svg>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("Home — the one 'next' card", () => {
  it("shows lunch at lunchtime, with its supplements as their own taps", () => {
    const h = hero(home());
    expect(text(h)).toContain("Next · Lunch · 1:00 pm");
    expect(h).toContain("<h2>Palak moong dal</h2>");
    expect(text(h)).toContain("Palak moong dal · Jowar roti");
    expect(text(h)).toContain("Take with it");
    const pills = [...h.matchAll(/<button type="button" class="sq-pill" aria-pressed="(true|false)">(.*?)<\/button>/g)];
    expect(pills.map((m) => text(m[2]))).toEqual(["Vitamin D3", "B-complex"]);
    expect(pills.map((m) => m[1])).toEqual(["false", "false"]);
  });

  it("offers the recipe and Done, and nothing it cannot do yet", () => {
    const h = hero(home());
    const buttons = [...h.matchAll(/<button[^>]*class="sq-btn[^"]*"[^>]*>(.*?)<\/button>/g)].map((m) => text(m[1]));
    expect(buttons).toEqual(["See recipe", "Done"]);
  });

  it("shows a ticked supplement as ticked on the card", () => {
    const h = hero(home({ ticks: { ...NONE, logged: { "s-d3": "1:12 pm" } } }));
    expect(h).toMatch(/aria-pressed="true">.*?Vitamin D3<\/button>/);
    expect(h).toMatch(/aria-pressed="false">B-complex<\/button>/);
  });

  it("never offers an earlier part of the day as next", () => {
    const html = home({ band: "midday" });
    expect(hero(html)).not.toContain("Besan chilla");
    expect(text(html)).not.toMatch(/missed|overdue|behind|late\b/i);
  });

  it("says the day is done, without a count or a verdict, when nothing is ahead", () => {
    const html = home({ band: "bedtime", hour: 22, ticks: { logged: { "s-magnesium": "10:00 pm" }, practicesDone: { "p-wind": true }, practiceAt: {} } });
    expect(text(hero(html))).toBe("Today That’s today. Rest well.");
  });

  it("greets by the phone's hour once it is known", () => {
    expect(home({ hour: 9, band: "morning" })).toContain("Good morning, Asha");
    expect(home({ hour: 19, band: "evening" })).toContain("Good evening, Asha");
  });

  it("shows only the greeting until the phone's ticks and clock are known", () => {
    const html = home({ ready: false, hour: null });
    expect(html).toContain("Hello, Asha");
    expect(html).not.toContain("sq-hero");
    expect(html).not.toContain("Later today");
  });
});

describe("Home — Done and Undo", () => {
  const ticked: SqTicks = { ...NONE, logged: { "m-lunch": "1:10 pm" } };

  it("after Done: says what was ticked and when, offers Undo, and moves on", () => {
    const html = home({ ticks: ticked, lastId: "m-lunch" });
    expect(text(html)).toContain("Lunch ticked · 1:10 pm");
    expect(html).toMatch(/<button type="button" class="sq-link">Undo<\/button>/);
    expect(text(hero(html))).toContain("Next · Dinner");
  });

  it("asks about the supplements that go with the meal just ticked", () => {
    const bar = home({ ticks: ticked, lastId: "m-lunch" }).match(/<section class="sq-soft sq-donebar".*?<\/section>/)?.[0] ?? "";
    expect(text(bar)).toContain("Took these with it?");
    expect(text(bar)).toContain("Vitamin D3");
    expect(text(bar)).toContain("B-complex");
  });

  it("drops the Undo line once that tick is gone", () => {
    expect(home({ ticks: NONE, lastId: "m-lunch" })).not.toContain("sq-donebar");
  });
});

describe("Home — later, and the whole day", () => {
  it("lists what is still ahead, and the any-time session, under Later today", () => {
    const html = home({ band: "midday" });
    expect(text(html)).toContain("Later today · dinner, before bed, any time today");
    // Folded by default: the rows are a tap away, not on the screen.
    expect(html).not.toContain("sq-tl-row");
  });

  it("has nowhere a prescribed tick can hide: every one is in the whole day", () => {
    const moments = buildMoments(PLAN);
    const sheet = text(renderToStaticMarkup(<SqDaySheet moments={moments} ticks={NONE} track={false} onToggle={noop} open={noop} />));
    for (const r of dayRows(moments)) expect(sheet, r.name).toContain(r.name);
    expect(dayRows(moments)).toHaveLength(9);
  });

  it("shows the time each tick was made in the whole day", () => {
    const t: SqTicks = { logged: { "m-lunch": "1:10 pm" }, practicesDone: { "p-wind": true }, practiceAt: { "p-wind": "9:40 pm" } };
    const sheet = text(renderToStaticMarkup(<SqDaySheet moments={buildMoments(PLAN)} ticks={t} track onToggle={noop} open={noop} />));
    expect(sheet).toContain("ticked 1:10 pm");
    expect(sheet).toContain("ticked 9:40 pm");
    expect(sheet).toContain("2 of 7 ticked.");
  });

  it("keeps the count off Home unless she asks to track every item", () => {
    expect(text(home())).not.toMatch(/\d+ of \d+ ticked/);
    expect(text(home({ track: true }))).toContain("Your whole day · 0 of 7 ticked");
  });
});

describe("Home — the cards that come and go", () => {
  it("welcomes her back after a break without saying anything was missed", () => {
    const html = home({ data: payload({ sq: { planDay: 20, tickHistory: [], daysSinceLastOpen: 6 } }) });
    const card = text(html.match(/<section class="sq-card sq-welcome">.*?<\/section>/)?.[0] ?? "");
    expect(card).toBe("Good to see you again Your plan is right where you left it. Today is all that matters. Carry on");
    expect(card).not.toMatch(/miss|skipp|behind|days? away|\d/i);
  });

  it("does not show the return card after a day or two, or once put away", () => {
    expect(home({ data: payload({ sq: { planDay: 20, tickHistory: [], daysSinceLastOpen: 2 } }) })).not.toContain("Good to see you again");
    expect(
      home({ data: payload({ sq: { planDay: 20, tickHistory: [], daysSinceLastOpen: 6 } }), returnDismissed: true }),
    ).not.toContain("Good to see you again");
  });

  it("shows the start card on the first day and before the plan starts, not after", () => {
    const first = payload({ sq: { planDay: 1, tickHistory: [], daysSinceLastOpen: null } });
    expect(home({ data: first })).toContain("Your plan is ready");
    expect(home()).not.toContain("Your plan is ready");
  });

  it("shows one 'This week' line, and none on the first day", () => {
    expect(text(home())).toContain("This week Your week 4 check-in");
    expect(text(home({ checkinSentWeek: 4 }))).not.toContain("This week");
    expect(text(home({ data: payload({ sq: { planDay: 1, tickHistory: [], daysSinceLastOpen: null } }) }))).not.toContain("This week");
  });

  it("never prints the coach's name", () => {
    const html = home({ data: payload({ sq: { planDay: 1, tickHistory: [], daysSinceLastOpen: 9 } }) });
    expect(html).not.toContain("Zzyzx");
    expect(html).not.toContain("Qwerty");
  });
});

describe("the record and a recipe, as drawn", () => {
  const history = [
    {
      date: "2026-11-17",
      items: [
        { kind: "supplement", name: "Vitamin D3", done: true, at: "1:15 pm" },
        { kind: "practice", name: "Sleep wind-down", done: false, at: null },
      ],
    },
  ];
  const data = payload({ sq: { planDay: 20, tickHistory: history, daysSinceLastOpen: 0 } });

  it("lists today from the phone and earlier days from what was saved", () => {
    const html = text(
      renderToStaticMarkup(<SqRecordSheet data={data} moments={buildMoments(PLAN)} ticks={NONE} todayYmd="2026-11-18" open={noop} />),
    );
    expect(html).toContain("Today · Wed 18 Nov 0 of 7 so far");
    expect(html).toContain("Tue 17 Nov 1 of 2 · not ticked: sleep wind-down");
  });

  it("an earlier day names each item, its time, and says meals were not tracked", () => {
    const html = text(renderToStaticMarkup(<SqRecordDaySheet data={data} date="2026-11-17" />));
    expect(html).toContain("Vitamin D3 1:15 pm");
    expect(html).toContain("Sleep wind-down Not ticked");
    expect(html).toContain("Meals were not tracked on this day.");
  });

  it("a day with no saved row says only that nothing was ticked", () => {
    expect(text(renderToStaticMarkup(<SqRecordDaySheet data={data} date="2026-11-10" />))).toBe("Nothing was ticked on this day.");
  });

  it("a recipe says what was left out for her before the method", () => {
    const withOmit = payload({
      mealExtra: { Lunch: { grad: "", ingredients: ["1 cup dal"], recipe: ["Add the peanuts and cook."], swaps: [], omits: ["peanuts"], omitsInSteps: true } },
    });
    const html = text(renderToStaticMarkup(<SqRecipeSheet data={withOmit} slot="Lunch" />));
    expect(html).toContain("Made without peanuts for you. Leave it out wherever the steps below mention it.");
    expect(html.indexOf("Made without")).toBeLessThan(html.indexOf("Method"));
  });
});
