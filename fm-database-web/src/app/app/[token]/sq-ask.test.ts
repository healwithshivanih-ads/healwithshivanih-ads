/**
 * The ask box's router, on a synthetic plan.
 *
 * Two sources, both walked in full:
 *   - the prototype's 125 regression questions (design session's
 *     harness/regress.js), each re-stated as what the REAL app must do. Where
 *     the prototype answered from text written for its one demo client (tea,
 *     eating out, swaps, portions, body age), the real app sends the question
 *     to the model or the coach instead — those rows say MODEL or HAND.
 *   - the round-4 tester findings in docs/client-app-redesign/BUILD-PLAN.md.
 *
 * No client data and no model call: MODEL here means "the router leaves it to
 * the model", which is the whole of what the router decides.
 */

import { describe, expect, it } from "vitest";
import type { AppMeal, AppPractice, AppRemedy, AppSupplement, AppTickDay, ClientAppData } from "@/lib/fmdb/client-app";
import { askChips, dishOnMenu, findRow, looksLikeDishQuestion, notOnListCard, routeAsk, type AskContext, type AskResult } from "./sq-ask";
import { buildMoments, dayRows, rankFloorAt, type SqTicks } from "./sq-day";
import { ALL_PRACTICES, SOMATIC, eft } from "./sq-practice.fixture";

// ── a synthetic client ─────────────────────────────────────────────────────

const meal = (slot: string, titles: string[], extra: Partial<AppMeal> = {}): AppMeal =>
  ({ slot, timeHint: "", glyph: "", pills: titles, components: titles.map((title) => ({ title })), ...extra }) as AppMeal;
const supp = (id: string, name: string, chronoRank: number, extra: Partial<AppSupplement> = {}): AppSupplement =>
  ({ id, name, dose: "1 capsule", slot: "Morning", timing: "", chronoRank, why: "", ...extra }) as AppSupplement;
const practice = (id: string, part: AppPractice["part"], name: string, kind: AppPractice["kind"] = "daily"): AppPractice => ({
  id,
  name,
  when: "",
  kind,
  part,
  dueToday: true,
});

const MEALS = [
  meal("Breakfast", ["Besan chilla", "Mint chutney"], { timeHint: "8:30 am" }),
  meal("Lunch", ["Palak moong dal", "Jowar roti"], { timeHint: "1:00 pm" }),
  meal("Snack", ["Roasted chana"]),
  meal("Dinner", ["Moong khichdi"], { timeHint: "7:30 pm" }),
];
const SUPPS = [
  supp("s-iron", "Iron (bisglycinate)", 20, { notDaily: "alternate", timing: "With breakfast", why: "For your iron stores." }),
  supp("s-d3", "Vitamin D3", 40, { timing: "With lunch", why: "Your vitamin D was low at the start." }),
  supp("s-b", "B-complex", 45, { timing: "With lunch" }),
  supp("s-magnesium", "Magnesium glycinate", 70, { timing: "At bedtime", why: "Helps your muscles and your sleep settle." }),
];
const PRACTICES = [
  practice("p-wind", "bedtime", "Wind down before bed — lights low, slow breath"),
  practice("p-breath", "morning", "Slow breathing"),
  practice("p-strength", "anytime", "Strength session", "weekly"),
];

const TODAY = "2026-11-18"; // a Wednesday
const HISTORY: AppTickDay[] = [
  {
    date: "2026-11-16", // Monday
    items: [
      { kind: "supplement", name: "Magnesium glycinate", done: true, at: "9:40 pm" },
      { kind: "supplement", name: "Iron (bisglycinate)", done: true, at: "8:35 am" },
      { kind: "supplement", name: "Vitamin D3", done: false, at: null },
    ],
  },
  {
    date: "2026-11-17", // Tuesday
    items: [
      { kind: "supplement", name: "Magnesium glycinate", done: false, at: null },
      { kind: "supplement", name: "Iron (bisglycinate)", done: false, at: null },
    ],
  },
];

function data(over: Record<string, unknown> = {}): ClientAppData {
  return {
    clientId: "cl-test",
    client: { firstName: "Asha", week: 4, totalWeeks: 12, notStarted: false },
    coach: { name: "Zzyzx Qwerty", nextSession: "Sat, 5 Dec" },
    meals: MEALS,
    supplements: SUPPS,
    remedies: [] as AppRemedy[],
    practices: PRACTICES,
    mealExtra: { Dinner: { recipe: ["Wash the dal."], ingredients: ["moong dal"], swaps: [] } },
    weekMenus: [
      {
        week: 4,
        current: true,
        days: [
          { dow: "Tuesday", slots: [{ slot: "Breakfast", dish: "Idli with sambar" }] },
          { dow: "Wednesday", today: true, slots: [{ slot: "Breakfast", dish: "Besan chilla" }, { slot: "Dinner", dish: "Lauki curry with rice" }] },
          { dow: "Thursday", slots: [{ slot: "Breakfast", dish: "Vegetable poha" }, { slot: "Lunch", dish: "Rajma with rice" }] },
        ],
      },
    ],
    ...ALL_PRACTICES,
    travel: null,
    clientUpdateNote: null,
    sq: { planDay: 24, tickHistory: HISTORY, daysSinceLastOpen: 0 },
    ...over,
  } as unknown as ClientAppData;
}

const NONE: SqTicks = { logged: {}, practicesDone: {}, practiceAt: {} };

function ctx(over: Partial<AskContext> & { dataOver?: Record<string, unknown> } = {}): AskContext {
  const d = data(over.dataOver);
  return {
    data: d,
    moments: buildMoments({ meals: d.meals, supplements: d.supplements, remedies: d.remedies, practices: d.practices }),
    ticks: NONE,
    nowRank: rankFloorAt(13),
    todayYmd: TODAY,
    ...over,
  };
}

/** One word for what the router did, so a table can state it. */
function outcome(r: AskResult): string {
  if (r.type === "empty") return "EMPTY";
  if (r.type === "model") return "MODEL";
  if (r.type === "tab") return `TAB ${r.tab}`;
  if (r.type === "open") return r.sheet.k === "soon" ? `SOON ${r.sheet.title}` : r.sheet.k === "practice" ? `PRACTICE ${r.sheet.id}` : r.sheet.k === "hosted" ? `SCREEN ${r.sheet.id}` : `OPEN ${r.sheet.k}`;
  const c = r.card;
  if (c.tone === "urgent") return c.heading!.includes("alone") ? "SELFHARM" : "EMERGENCY";
  if (c.handoff) return "HAND";
  return `CARD ${c.heading ?? ""}`;
}
const ask = (q: string, c: AskContext = ctx()) => outcome(routeAsk(q, c));

// ── the prototype's 125, as the real app must answer them ──────────────────

const REGRESSION: [string, string][] = [
  // self-harm
  ["i want to die", "SELFHARM"],
  ["I don't want to be here anymore", "SELFHARM"],
  ["I want to hurt myself", "SELFHARM"],
  ["marna chahti hu", "SELFHARM"],
  // emergency
  ["my chest feels tight", "EMERGENCY"],
  ["seene me dard ho raha hai", "EMERGENCY"],
  ["mujhe chakkar aa raha hai aur seene mein dard hai", "EMERGENCY"],
  ["saans nahi aa rahi", "EMERGENCY"],
  ["chest pain since morning", "EMERGENCY"],
  // the coach answers these
  ["chakkar aa raha hai aur dil ghabra raha hai", "HAND"],
  ["sir me bahut dard hai", "HAND"],
  ["iron ki goli khane ke baad pet me dard ho raha hai", "HAND"],
  ["I'm having palpitations and feel dizzy", "HAND"],
  ["What should I do about my weight, I have lost 3 kg in a week", "HAND"],
  ["What is my husband's plan?", "HAND"],
  ["mere husband ko sugar hai kya wo bhi ye khichdi kha sakte hai", "HAND"],
  ["I feel like I failed my mum", "HAND"],
  ["I feel stressed and cant sleep, is my cortisol high", "HAND"],
  ["can i skip the b-complex today", "HAND"],
  ["mujhe bahut thakan lag rahi hai aaj", "HAND"],
  ["can i drink wine", "CARD Best to skip it for now"],
  ["At exactly what time should I take the magnesium, and can I take it with the vitamin D3 and the B-complex together?", "HAND"],
  ["Is it safe to restart all my supplements at once after a gap?", "HAND"],
  ["Can I take magnesium with my SSRI?", "HAND"],
  ["can i drink", "CARD Best to skip it for now"],
  ["what is the magnesium for, and can I take it with my B-complex", "HAND"],
  ["Can I drink?", "CARD Best to skip it for now"],
  ["late client dinner with drinks", "CARD Best to skip it for now"],
  ["thoda chakkar aa raha hai", "HAND"],
  ["my stomach hurts after the iron", "HAND"],
  // the coach's own missed-capsule answer has not arrived, so it goes to the coach
  ["missed my b-complex", "CARD No worries"],
  // results are not shared in the app until step 5
  ["Show me my lab results and when the next blood test is.", "HAND"],
  ["my hba1c is 6.1 is that ok", "HAND"],
  ["sugar report", "HAND"],
  ["what is my body age", "HAND"],
  ["biological age", "HAND"],
  // no change note and no travel on this plan
  ["Has my plan changed?", "HAND"],
  // the prototype had no answer for these; the model decides (and defers)
  ["what should i drink on waking", "MODEL"],
  ["what is the capital of france", "MODEL"],
  ["when is next test", "SCREEN labs"],
  ["what do i get at the end", "MODEL"],
  // next session
  ["when is my next session", "CARD Your next session: Sat, 5 Dec"],
  ["When is my next review with my coach?", "CARD Your next session: Sat, 5 Dec"],
  // how the app works
  ["where do i start", "OPEN start"],
  ["do i have to do all of this", "OPEN start"],
  ["what is the ring at the top", "OPEN start"],
  // a practice offer
  ["can't switch my mind off", "CARD For a busy mind"],
  ["hot flush right now", "CARD Right now, where you are"],
  ["hot flush at work and my heart is racing, what can I do right now", "CARD Right now, where you are"],
  ["raat ko neend nahi aayi", "CARD For tonight"],
  ["i could not sleep last night", "CARD For tonight"],
  ["sleep", "CARD For tonight"],
  ["my mind is racing, it's 11pm", "CARD For tonight"],
  ["I woke at 3 and can't get back to sleep", "CARD For tonight"],
  ["Help me sleep", "CARD For tonight"],
  ["I can't sleep", "CARD For tonight"],
  ["feeling panicky right now", "CARD Let's slow things down"],
  ["I feel stressed", "CARD Let's slow things down"],
  ["Help me wind down", "CARD Let's slow things down"],
  ["I'm so irritable today, snapping at everyone", "CARD For a short fuse"],
  ["I feel irritable", "CARD For a short fuse"],
  ["tapping", "PRACTICE tap"],
  ["I don't have five minutes", "CARD One minute is enough"],
  ["I have one minute", "CARD One minute is enough"],
  ["which practice for anger", "TAB practices"],
  // coming back
  ["I've fallen off completely. Do I have to start the whole plan again from day 1?", "CARD You start from today"],
  ["I've been away", "CARD You start from today"],
  ["Have I ruined all my progress?", "CARD You pick up from today"],
  // her ticks and her record
  ["what have i ticked so far today", "CARD 0 of 9 ticked so far today"],
  ["How many items have I done today, and out of how many?", "CARD 0 of 9 ticked so far today"],
  ["What exactly did I tick yesterday, and at what time?", "OPEN record"],
  ["How many days in a row have I completed everything this week?", "OPEN record"],
  ["I ticked lunch by mistake. How do I undo it?", "CARD Tap the tick again to clear it"],
  ["Can my coach see that I was away?", "CARD What your coach sees"],
  // her meals
  ["Can I eat idli?", "CARD Yes, it is on your menu this week"],
  ["Whta can I eat for brekfast", "CARD Breakfast: Besan chilla"],
  ["what can i eat for breakfast", "CARD Breakfast: Besan chilla"],
  ["aaj dinner me kya hai", "CARD Dinner: Moong khichdi"],
  ["What's for dinner?", "CARD Dinner: Moong khichdi"],
  ["What's for lunch?", "CARD Lunch: Palak moong dal"],
  ["What's for breakfast tomorrow?", "CARD Breakfast tomorrow"],
  // food questions depend on her own food list → the model
  ["jowar atta nahi mila kya karu", "MODEL"],
  ["can I swap lunch for something lighter", "MODEL"],
  ["Swap this meal", "MODEL"],
  ["kya main chai pi sakti hu doodh wali", "MODEL"],
  ["chai le sakti hu?", "MODEL"],
  ["coffee ok?", "MODEL"],
  ["Can I have coffee?", "MODEL"],
  ["can i have chai with my iron tablet", "MODEL"],
  ["when should I take iron relative to tea", "MODEL"],
  ["can i eat mango", "MODEL"],
  ["dahi kha sakte hai", "MODEL"],
  ["how many rotis", "MODEL"],
  ["How much rice can I have?", "MODEL"],
  ["I have no energy to cook", "MODEL"],
  // away from home: the detail in the question matters → the model
  ["i'm travelling tuesday to thursday", "MODEL"],
  ["travelling next week", "MODEL"],
  ["hotel buffet what do i eat", "MODEL"],
  ["hotel breakfast", "MODEL"],
  ["Hotel buffet, what do I eat?", "MODEL"],
  ["airport lounge what do i eat", "MODEL"],
  ["wedding saturday what do i do", "MODEL"],
  ["client dinner italian tonight", "MODEL"],
  ["business lunch tomorrow what do i order", "MODEL"],
  ["I'm eating out tonight", "MODEL"],
  ["late flight wired cant sleep", "MODEL"],
  // her supplements
  ["Why magnesium at night?", "CARD Magnesium glycinate"],
  // her programme
  ["how long does this programme run", "CARD Week 4 of 12"],
  // the coach
  ["Tell my coach how I feel", "TAB coach"],
  // screens that arrive in later build steps
  ["log my weight", "OPEN vitals"],
  ["Where do I log my weight and blood pressure?", "OPEN vitals"],
  ["how do i order the supplements", "OPEN order"],
  ["running out of d3 while away", "OPEN order"],
  ["Reorder supplements", "OPEN order"],
  ["what do i need to buy", "SOON Shopping list"],
  ["Shopping list", "SOON Shopping list"],
  ["shopping list cook ko bhejna hai", "SOON Shopping list"],
  ["When is my weekly check-in and where do I fill it?", "SCREEN checkin"],
  ["Send today's meals to my cook", "SOON Send to my cook"],
  ["cook ko aaj ka khana bhejo", "SOON Send to my cook"],
  ["This week's menu", "SCREEN menu"],
  ["my exercise for today", "SOON Movement"],
];

describe("the prototype's regression questions", () => {
  it("carries every distinct question from the prototype's list", () => {
    // 125 in the harness, three of them repeated there; 122 distinct.
    expect(new Set(REGRESSION.map(([q]) => q)).size).toBe(REGRESSION.length);
    expect(REGRESSION.length).toBe(122);
  });
  it.each(REGRESSION)("%s → %s", (q, want) => {
    expect(ask(q)).toBe(want);
  });
});

// ── round 4 ────────────────────────────────────────────────────────────────

describe("round-4 tester findings", () => {
  it.each([
    ["chet pain", "EMERGENCY"],
    ["seene me bhaari dard ho raha hai aur pasina", "EMERGENCY"],
    ["I took too many pills", "EMERGENCY"],
    ["better off dead", "SELFHARM"],
    ["kms lol", "SELFHARM"],
    ["sucide", "SELFHARM"],
    ["Can I take 2 Vitamin D3 tablets today?", "HAND"],
    ["my husband has high BP, what should he eat", "HAND"],
    ["is my vitamin D low?", "HAND"],
    ["is my vitamin D in range", "HAND"],
    ["mera vajan kitna kam hoga 3 mahine me", "HAND"],
    ["I run a shop and eat lunch at 3, can I shift the times?", "HAND"],
    ["can I have a drink", "CARD Best to skip it for now"],
    ["when is my week 12 review?", "HAND"],
    ["dudh wali chai pi sakti hu", "MODEL"],
    ["I don't eat chia, what can I have instead?", "MODEL"],
    ["i'll run out of vitamin d abroad", "MODEL"],
    ["hotel gym only, what workout", "MODEL"],
    ["jet lag, how do I sleep", "MODEL"],
    ["I fainted with laughter", "MODEL"],
    ["aaj mehman aa rahe hai kya banau", "CARD Today on your plan"],
    ["what is left to tick today?", "CARD 9 left today"],
    ["what time does my coach reply?", "CARD Within 24 hours"],
    ["I'm furious with everyone today", "CARD For a short fuse"],
    ["sheets are soaked, again", "CARD For tonight"],
    ["", "EMPTY"],
    ["   ", "EMPTY"],
  ])("%s → %s", (q, want) => {
    expect(ask(q)).toBe(want);
  });

  it("a denied chest pain is a symptom for the coach, never the emergency card", () => {
    const r = routeAsk("chest pain nahi hai, just checking", ctx());
    expect(outcome(r)).toBe("HAND");
    expect(r.type === "card" && r.card.note).toContain("see a doctor today");
  });

  it("the week-12 review is never answered with the next session's date as though it were that one", () => {
    const r = routeAsk("when is my week 12 review?", ctx());
    expect(r.type === "card" && r.card.lines[0]).toContain("not the date of your week 12 review");
  });

  it("guests: shows today's plan and offers the coach, never a menu for guests", () => {
    const r = routeAsk("aaj mehman aa rahe hai kya banau", ctx());
    if (r.type !== "card") throw new Error("expected a card");
    expect(r.card.list?.map((x) => x.text)).toContain("Dinner: Moong khichdi");
    expect(r.card.buttons?.some((b) => b.to === "coach")).toBe(true);
  });
});

// ── answers from the tick record ───────────────────────────────────────────

describe("her ticks and her record", () => {
  const ticked: SqTicks = { logged: { "s-iron": "8:40 am", "m-breakfast": "8:35 am" }, practicesDone: {}, practiceAt: {} };

  it("what is left names the unticked things, not the ticked ones", () => {
    const r = routeAsk("what is left to tick today?", ctx({ ticks: ticked }));
    if (r.type !== "card") throw new Error("expected a card");
    const names = r.card.list!.map((x) => x.text);
    expect(names).toContain("Vitamin D3");
    expect(names).not.toContain("Iron");
    expect(names).not.toContain("Besan chilla");
    // A weekly practice is not owed today, so it is not "left".
    expect(names).not.toContain("Strength session");
  });

  it("what time did I take my iron: the time of today's tick", () => {
    expect(ask("what time did I take my iron?", ctx({ ticks: ticked }))).toBe("CARD Iron: ticked at 8:40 am");
    expect(ask("what time did I take my iron?")).toBe("CARD Iron: not ticked yet today");
  });

  it("did I take my magnesium on Monday: read from that day's record", () => {
    expect(ask("did I take my magnesium on Monday?")).toBe("CARD Magnesium glycinate: ticked on Mon 16 Nov, at 9:40 pm");
    expect(ask("did I take my magnesium yesterday?")).toBe("CARD Magnesium glycinate: not ticked on Tue 17 Nov");
    expect(ask("did I take my vitamin d3 on monday")).toBe("CARD Vitamin D3: not ticked on Mon 16 Nov");
  });

  it("says so when the record has nothing for that day, and never guesses", () => {
    expect(ask("did I take my magnesium on Friday?")).toBe("CARD Nothing is saved for Fri 13 Nov");
  });

  it("is tomorrow an iron day: from how often it is taken and when it was last ticked", () => {
    // Last ticked Monday, every other day → due Wednesday (today).
    expect(ask("is tomorrow an iron day?")).toBe("CARD Tomorrow is an iron day");
    expect(ask("is today an iron day?")).toBe("CARD Today is an iron day");
    // Ticked today → tomorrow is a rest day.
    expect(ask("is tomorrow an iron day?", ctx({ ticks: ticked }))).toBe("CARD Tomorrow is not an iron day");
  });

  it("hands to the coach when the record cannot say which day she is on", () => {
    const c = ctx({ dataOver: { sq: { planDay: 24, tickHistory: [], daysSinceLastOpen: 0 } } });
    expect(ask("is tomorrow an iron day?", c)).toBe("HAND");
  });
});

// ── answers from the plan ──────────────────────────────────────────────────

describe("her plan", () => {
  it("a supplement's card is its own dose, timing and reason, and nothing invented", () => {
    const r = routeAsk("Why magnesium at night?", ctx());
    if (r.type !== "card") throw new Error("expected a card");
    expect(r.card.lines).toEqual(["1 capsule · At bedtime", "Helps your muscles and your sleep settle."]);
    expect(r.card.note).toBe("Check with your coach before changing it.");
  });

  it("a supplement with no reason on the plan shows only what the plan says", () => {
    const r = routeAsk("what is the b-complex for", ctx());
    if (r.type !== "card") throw new Error("expected a card");
    expect(r.card.lines).toEqual(["1 capsule · With lunch"]);
  });

  it("offers the recipe only for a meal that has one", () => {
    const dinner = routeAsk("What's for dinner?", ctx());
    const lunch = routeAsk("What's for lunch?", ctx());
    if (dinner.type !== "card" || lunch.type !== "card") throw new Error("expected cards");
    expect(dinner.card.buttons?.some((b) => b.to === "recipe" && b.ref === "Dinner")).toBe(true);
    expect(lunch.card.buttons?.some((b) => b.to === "recipe")).toBe(false);
  });

  it("with no next session on file, asks the coach instead of guessing a date", () => {
    const c = ctx({ dataOver: { coach: { name: "Zzyzx Qwerty", nextSession: null } } });
    expect(ask("when is my next session", c)).toBe("HAND");
  });

  it("has my plan changed: the coach's own note when there is one, travel dates when she has them", () => {
    expect(ask("Has my plan changed?", ctx({ dataOver: { clientUpdateNote: "Lunch is lighter from this week." } }))).toBe(
      "CARD Your coach's latest note",
    );
    const away = ctx({ dataOver: { travel: { from: "20 Nov", to: "24 Nov", kind: "travel", location: "", context: "", active: false } } });
    // The prototype said "nothing has changed" here. It must not.
    expect(ask("Has my plan changed?", away)).toBe("CARD Your coach has your dates");
  });

  it("when nothing is ahead, 'what next' says so", () => {
    expect(ask("what should I do now", ctx({ nowRank: 200 }))).toBe("CARD Nothing more for today");
    expect(ask("what should I eat now")).toBe("CARD Next: lunch");
  });
});

// ── eating out: the coach's guide on the plan ──────────────────────────────

describe("eating out, with the coach's guide on the plan", () => {
  const sit = (where: string, choose: string[], skip: string[] = [], keywords: string[] = []) => ({ where, keywords, choose, skip, note: "" });
  const GUIDE = {
    label: "",
    rules: ["Start with the vegetables", "Grilled or tandoori over fried"],
    situations: [
      sit("At a restaurant", ["Dal, sabzi, and rice or jowar roti"], ["Naan and cream gravies"]),
      sit("At a hotel buffet", ["Start at the cooked vegetables"], ["The bread basket and juices"]),
      sit("At a wedding or party", ["Dal, sabzi, rice and salad from the counter"], ["Chaat and fried starters"]),
      sit("Travelling", ["Idli or dosa with sambar"], ["Sandwiches and anything fried"]),
    ],
    notOnList: "Choose the plainest cooked dish and tell your coach afterwards.",
  };
  const withGuide = (over: Partial<AskContext> & { dataOver?: Record<string, unknown> } = {}) => ctx({ dataOver: { planRef: { eatingOut: GUIDE } }, ...over });

  it.each([
    ["hotel buffet what do i eat", "CARD At a hotel buffet"],
    ["hotel breakfast", "CARD At a hotel buffet"],
    ["Hotel buffet, what do I eat?", "CARD At a hotel buffet"],
    ["airport lounge what do i eat", "CARD Travelling"],
    ["i'm travelling tuesday to thursday", "CARD Travelling"],
    ["travelling next week", "CARD Travelling"],
    ["wedding saturday what do i do", "CARD At a wedding or party"],
    ["client dinner italian tonight", "CARD At a restaurant"],
    ["business lunch tomorrow what do i order", "CARD At a restaurant"],
    ["I'm eating out tonight", "CARD At a restaurant"],
    ["I'm eating out", "CARD At a restaurant"],
    ["I'm at a restaurant, what can I order?", "CARD At a restaurant"],
    // away from home but not about food: still the model, which uses the detail
    ["i'll run out of vitamin d abroad", "MODEL"],
    ["hotel gym only, what workout", "MODEL"],
    ["jet lag, how do I sleep", "MODEL"],
    ["late flight wired cant sleep", "MODEL"],
    // nothing to do with eating out is untouched by the guide
    ["What's for dinner?", "CARD Dinner: Moong khichdi"],
    ["can i eat mango", "MODEL"],
  ])("%s → %s", (q, want) => {
    expect(ask(q, withGuide())).toBe(want);
  });

  it("the card is the coach's lines as written: choose as ticks, skip as crosses", () => {
    const r = routeAsk("I'm at a restaurant, what can I order?", withGuide());
    if (r.type !== "card") throw new Error("expected a card");
    expect(r.card.list).toEqual([
      { mark: "yes", text: "Dal, sabzi, and rice or jowar roti" },
      { mark: "no", text: "Naan and cream gravies" },
    ]);
    expect(r.card.src).toBe("From your plan");
    // She has her answer now, and can still ask the coach as well.
    expect(r.card.handoff).toBeUndefined();
    expect(r.card.buttons?.map((b) => b.label)).toEqual(["Other places", "Ask my coach"]);
  });

  it("names the section of the plan the guide is for", () => {
    const c = ctx({ dataOver: { planRef: { eatingOut: { ...GUIDE, label: "Remove phase" } } } });
    const r = routeAsk("I'm eating out", c);
    expect(r.type === "card" && r.card.src).toBe("From your plan · Remove phase");
  });

  it("a place the guide has no card for gets the restaurant card with the rules that hold anywhere", () => {
    const small = ctx({ dataOver: { planRef: { eatingOut: { ...GUIDE, situations: [GUIDE.situations[0]] } } } });
    const r = routeAsk("wedding saturday what do i eat", small);
    if (r.type !== "card") throw new Error("expected a card");
    expect(r.card.heading).toBe("At a restaurant");
    expect(r.card.lines).toEqual(GUIDE.rules);
  });

  it("dinner with drinks: the food is answered now, with the plan's alcohol line", () => {
    const r = routeAsk("late client dinner with drinks", withGuide());
    if (r.type !== "card") throw new Error("expected a card");
    expect(r.card.heading).toBe("At a restaurant");
    expect(r.card.list?.[0]).toEqual({ mark: "yes", text: "Dal, sabzi, and rice or jowar roti" });
    expect(r.card.note).toBe("It's best to skip alcohol while you're on this plan.");
    expect(ask("can i drink wine", withGuide())).toBe("CARD Best to skip it for now");
  });

  it("alcohol is plan by plan (coach, 21 Nov 2026): no risk marker gets the practical line", () => {
    const c = ctx();
    const noRisk = { ...c, data: { ...c.data, sq: { ...(c.data.sq ?? { planDay: 1, tickHistory: [], daysSinceLastOpen: null, results: null }), alcoholRisk: false } } } as AskContext;
    expect(ask("can I have a drink", noRisk)).toBe("CARD One, slowly, with food");
    expect(ask("can I have a drink", c)).toBe("CARD Best to skip it for now");
  });

  it("safety still comes first, even at a restaurant", () => {
    expect(ask("I'm at a restaurant and my chest feels tight", withGuide())).toBe("EMERGENCY");
    expect(ask("at a hotel buffet, my stomach hurts", withGuide())).toBe("HAND");
  });

  it("a named dish gets the coach's own line for it, at once, with what to have instead", () => {
    const skip = routeAsk("can I have butter naan", withGuide());
    if (skip.type !== "card") throw new Error("expected a card");
    expect(skip.card.heading).toBe("Skip this one");
    expect(skip.card.list).toEqual([
      { mark: "no", text: "Naan and cream gravies" },
      { mark: "yes", text: "Dal, sabzi, and rice or jowar roti" },
    ]);
    expect(skip.card.note).toBe("The ticked lines are what to have instead.");
    expect(skip.card.handoff).toBeUndefined();

    const south = { ...GUIDE, situations: [sit("South Indian", ["Ragi dosa", "Sambar and rasam"], ["Idli, dosa and uttapam"])] };
    const mixed = routeAsk("is the dosa with sambar ok", ctx({ dataOver: { planRef: { eatingOut: south } } }));
    if (mixed.type !== "card") throw new Error("expected a card");
    // "X with Y" is two dishes. Sambar is a yes; a bare "dosa" is skipped,
    // and because a ragi dosa is fine the card shows both lines.
    expect(mixed.card.heading).toBe("It depends which one");
    expect(mixed.card.list?.map((x) => `${x.mark}:${x.text}`)).toEqual(["no:Idli, dosa and uttapam", "yes:Ragi dosa", "yes:Sambar and rasam"]);
  });

  it("two dishes get a row each", () => {
    const g = { ...GUIDE, situations: [{ ...GUIDE.situations[0], skip: ["Naan and cream gravies", "Biryani and pulao"] }] };
    const r = routeAsk("they have naan and biryani, which one", ctx({ dataOver: { planRef: { eatingOut: g } } }));
    if (r.type !== "card") throw new Error("expected a card");
    expect(r.card.heading).toBe("Skip these");
    expect(r.card.list?.filter((x) => x.mark === "no")).toHaveLength(2);
  });

  it("'I already ate it' is never answered with a skip list", () => {
    const r = routeAsk("I ate samosa at the canteen, what should I do now", ctx({ dataOver: { planRef: { eatingOut: { ...GUIDE, situations: [{ ...GUIDE.situations[0], skip: ["Samosa and pakora"] }] } } } }));
    if (r.type !== "card") throw new Error("expected a card");
    expect(r.card.heading).toBe("You pick up from your next meal");
    expect(r.card.list).toBeUndefined();
  });

  it("when the model has no answer to a food question, she still gets the guide's own line", () => {
    expect(looksLikeDishQuestion("is paneer tikka masala ok")).toBe(true);
    expect(looksLikeDishQuestion("what is the capital of france")).toBe(false);
    const c = notOnListCard(GUIDE, "is paneer tikka masala ok");
    expect(c.heading).toBe("Not on your list yet");
    expect(c.lines).toEqual([GUIDE.notOnList]);
    expect(c.handoff).toBeUndefined();
    expect(c.buttons?.map((b) => b.to)).toEqual(["eatout", "coach"]);
  });

  it("asking for the guide opens it", () => {
    expect(ask("is there a list of what I can eat when eating out", withGuide())).toBe("OPEN eatout");
  });

  it("a dish the guide does not name still goes to the model, never a guess", () => {
    expect(ask("can I have paneer tikka", withGuide())).toBe("MODEL");
    expect(ask("can i eat mango", withGuide())).toBe("MODEL");
  });

  it("a guide line never hijacks a question that is not about a dish", () => {
    for (const q of ["What's for dinner?", "What is left today?", "Why magnesium at night?", "when is my next session", "I feel stressed", "did I take my magnesium on Monday?"]) {
      const without = ask(q);
      expect(ask(q, withGuide()), q).toBe(without);
    }
  });

  it("offers 'I'm eating out' as a tappable question only when the plan has a guide", () => {
    expect(askChips(withGuide())).toContain("I'm eating out");
    expect(askChips(ctx())).not.toContain("I'm eating out");
    // …and it is answered on the phone, like every chip.
    for (let h = 0; h < 24; h++) {
      const c = withGuide({ nowRank: rankFloorAt(h) });
      for (const q of askChips(c)) expect(ask(q, c), q).not.toBe("MODEL");
    }
  });
});

describe("round-5 tester findings", () => {
  it.each([
    // her own question, though it mentions her mother
    ["Have I ruined everything by being away while my mother was in hospital", "CARD You pick up from today"],
    // distress is heard, never the flat no-answer card
    ["I can't do this anymore, it's too much", "HAND"],
    // an allergic reaction inside a food question is an emergency
    ["I'm at the restaurant and my lips are swelling after the egg curry, can I eat the dal?", "EMERGENCY"],
    ["mera gala band ho raha hai", "EMERGENCY"],
    ["mujhe jeene ka mann nahi hai", "SELFHARM"],
    // a record question with no item named opens the record
    ["Did I take my supplement on Monday?", "OPEN record"],
    ["what do I eat today", "CARD Today"],
  ])("%s → %s", (q, want) => {
    expect(ask(q)).toBe(want);
  });

  it("distress gets the warm hand-off line", () => {
    const r = routeAsk("I can't do this anymore, it's too much", ctx());
    expect(r.type === "card" && r.card.lines[0]).toContain("That sounds heavy");
  });
});

// ── practices ──────────────────────────────────────────────────────────────

describe("practice answers", () => {
  const card = (q: string, c: AskContext = ctx()) => {
    const r = routeAsk(q, c);
    if (r.type !== "card") throw new Error(`expected a card for "${q}"`);
    return r.card;
  };

  it("a bad night offers the wind-down first, one tap from starting, and the coach", () => {
    const c = card("I woke at 3 and can't get back to sleep");
    expect(c.buttons).toEqual([
      { to: "practice", ref: "sleep", label: "Begin sleep wind-down", solid: true },
      { to: "practice", ref: "breath", label: "Slow breathing", solid: false },
      { to: "coach", label: "Tell my coach", draft: "I woke at 3 and can't get back to sleep" },
    ]);
    expect(c.note).toContain("nights like this");
  });

  it("round 5: a hot flush is never offered a movement session", () => {
    const c = card("hot flush at work");
    expect(c.heading).toBe("Right now, where you are");
    expect(c.buttons?.map((b) => b.ref)).toEqual(["one", "reset:body-reset", undefined]);
    expect(JSON.stringify(c)).not.toMatch(/movement/i);
  });

  it("offers only practices that are on her plan", () => {
    // Tapping and a body reset, but no wind-down and no breathing.
    const some = ctx({ dataOver: { eft: eft(), sleep: null, breathwork: null, somatic: SOMATIC } });
    const night = card("I can't sleep", some);
    expect(night.heading).toBe("Let's slow things down");
    expect(night.buttons?.map((b) => b.ref)).toEqual(["tap", "reset:body-reset", undefined]);
    // The two-practice line is used only when she has both.
    const fuse = card("I'm furious", ctx({ dataOver: { eft: eft(), sleep: null, breathwork: null, somatic: [] } }));
    expect(fuse.lines[0]).toBe("Tapping suits this, and it is on your plan.");
  });

  it("with no practices on the plan, a feeling goes to the coach", () => {
    const none = ctx({ dataOver: { eft: null, sleep: null, breathwork: null, somatic: [] } });
    expect(ask("I feel stressed", none)).toBe("HAND");
    expect(ask("tapping", none)).toBe("HAND");
  });

  it("asked for by name, a practice simply opens", () => {
    expect(ask("tapping")).toBe("PRACTICE tap");
    expect(ask("body reset")).toBe("PRACTICE reset:body-reset");
    expect(ask("sleep wind-down")).toBe("PRACTICE sleep");
  });

  it("a tight chest is still the emergency card, never a practice", () => {
    expect(ask("I think it's panic, my chest is tight")).toBe("EMERGENCY");
  });
});

describe("results questions", () => {
  const RESULTS = {
    sharedOn: "2026-11-20",
    note: "",
    bodyAge: { value: 45, calendarAge: 53, date: "2026-10-26" },
    groups: [{ system: "Vitamins", rows: [{ name: "Vitamin D", value: 18, unit: "ng/mL", date: "2026-10-26", tag: "below", range: "30 to 100" }] }],
  };
  const shared = () => ctx({ dataOver: { sq: { planDay: 24, tickHistory: [], daysSinceLastOpen: 0, results: RESULTS } } });

  it("go to the coach until the coach shares them", () => {
    expect(ask("what is my body age")).toBe("HAND");
    expect(ask("is my vitamin D low?")).toBe("HAND");
  });
  it("once shared, answer with the number and its tag, and offer the coach", () => {
    const ba = routeAsk("what is my body age", shared());
    if (ba.type !== "card") throw new Error("expected a card");
    expect(ba.card.heading).toBe("Your body age: 45 years");
    expect(ba.card.lines[0]).toContain("You were 53 at the test");
    const d = routeAsk("is my vitamin D low?", shared());
    if (d.type !== "card") throw new Error("expected a card");
    expect(d.card.heading).toBe("Your Vitamin D: 18 ng/mL");
    expect(d.card.lines[0]).toBe("Below the usual range (30 to 100). From your test on 2026-10-26.");
    expect(d.card.buttons?.[0].to).toBe("coach");
  });
  it("a results question naming nothing on file opens the results screen", () => {
    expect(ask("show me my reports", shared())).toBe("OPEN results");
  });
  it("what to do about a result still goes to the coach, shared or not", () => {
    expect(ask("my vitamin D is low, should I take more?", shared())).toBe("HAND");
    expect(ask("my ferritin is high, do I need to stop iron", shared())).toBe("HAND");
  });
});

describe("dishOnMenu — every word of the food must be in one dish", () => {
  const d = data();
  it("finds a dish that is on the week's menu, with where", () => {
    expect(dishOnMenu("can i eat idli", d)).toEqual([{ dish: "Idli with sambar", where: "Tuesday breakfast" }]);
    expect(dishOnMenu("rajma kha sakte hai", d)).toEqual([{ dish: "Rajma with rice", where: "Thursday lunch" }]);
  });
  it("does not answer 'chicken curry' with a lauki curry", () => {
    expect(dishOnMenu("can i eat chicken curry", d)).toEqual([]);
    expect(dishOnMenu("can i have fried idli", d)).toEqual([]);
  });
  it("is empty when no food is named", () => {
    expect(dishOnMenu("can i eat", d)).toEqual([]);
    expect(dishOnMenu("what can i eat for breakfast", d)).toEqual([]);
  });
});

describe("findRow", () => {
  const rows = dayRows(ctx().moments);
  it("picks the supplement she named, not one that shares a word", () => {
    expect(findRow("did i take my vitamin d3", rows)?.id).toBe("s-d3");
    expect(findRow("why magnesium", rows)?.id).toBe("s-magnesium");
    expect(findRow("the b-complex", rows)?.id).toBe("s-b");
    expect(findRow("what's for dinner", rows)).toBeNull();
  });
});

// ── chips ──────────────────────────────────────────────────────────────────

describe("askChips — tappable questions cost nothing", () => {
  it("every chip, at every hour, is answered on the phone and never reaches the model", () => {
    for (let h = 0; h < 24; h++) {
      const c = ctx({ nowRank: rankFloorAt(h) });
      const chips = askChips(c);
      expect(chips.length).toBeGreaterThan(0);
      expect(chips.length).toBeLessThanOrEqual(4);
      for (const q of chips) {
        const got = ask(q, c);
        expect(got, `${h}h · ${q}`).not.toBe("MODEL");
        expect(got, `${h}h · ${q}`).not.toBe("EMPTY");
        expect(got, `${h}h · ${q}`).not.toBe("HAND");
      }
    }
  });

  it("asks about the meal that is next, by the clock", () => {
    expect(askChips(ctx({ nowRank: rankFloorAt(9) }))[0]).toBe("What's for breakfast?");
    expect(askChips(ctx({ nowRank: rankFloorAt(13) }))[0]).toBe("What's for lunch?");
    expect(askChips(ctx({ nowRank: rankFloorAt(19) }))[0]).toBe("What's for dinner?");
  });
});

// ── copy ───────────────────────────────────────────────────────────────────

describe("copy", () => {
  it("no answer names the coach or uses a pronoun for the coach", () => {
    const all = [...REGRESSION.map(([q]) => q), "what time does my coach reply?", "is tomorrow an iron day?"];
    for (const q of all) {
      const r = routeAsk(q, ctx());
      if (r.type !== "card") continue;
      const text = [r.card.src, r.card.heading ?? "", ...r.card.lines, r.card.note ?? "", ...(r.card.buttons ?? []).map((b) => b.label)].join(" ");
      expect(text, q).not.toMatch(/zzyzx|qwerty|shivani/i);
      expect(text, q).not.toMatch(/\b(she|her|hers)\b/i);
    }
  });
});

describe("missed capsule (coach, 21 Nov 2026)", () => {
  it.each(["iron lena bhool gayi", "I forgot my iron yesterday, should I take two today?", "missed my magnesium"])("%s → no worries, with reminders", (q) => {
    const r = routeAsk(q, ctx());
    expect(outcome(r)).toBe("CARD No worries");
    if (r.type === "card") expect(r.card.buttons?.map((b) => b.to)).toEqual(["remind", "remind"]);
  });
});
