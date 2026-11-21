/**
 * THE ASK BOX'S ROUTER — what happens to a question, in order.
 *
 *   1. the fixed safety rules (ask-safety.ts): self-harm, emergency
 *   2. a few questions that cannot be clinical (next session, how the app works)
 *   3. the rest of the safety rules: these go to the coach, never answered here
 *   4. plan lookups that need no model: her meals, her ticks, her record, her
 *      supplements' timing, whether a dish is on this week's menu
 *   5. everything else → the model, which answers from her plan or defers
 *
 * Steps 1 to 4 run on the phone, cost nothing and work offline. This file is
 * pure: it is handed the plan, the day and the ticks, and returns what to
 * show. It never invents a fact — every line it writes is read from the
 * payload, and where the payload does not say, it hands to the coach.
 *
 * Eating out is answered here from the coach's own guide on the plan
 * (plan.eating_out → planRef.eatingOut, see lib/fmdb/eating-out.ts): her
 * lines, as written, at once and at no cost. A plan with no guide for this
 * week sends eating-out questions to the model instead.
 *
 * Deliberately NOT answered here, though the prototype did: tea and coffee,
 * swaps, portions, "can I eat X". The prototype's answers were written for
 * one demo client. In the real app they depend on each client's own food
 * list, so they go to the model with the plan in front of it.
 *
 * Screens that arrive in later build steps (shopping list, check-in, weight,
 * reorder, the week's menu) open the "not built yet" sheet for now; only the
 * test account sees the new front until they are built.
 */

import type { AppSupplement, AppTickDay, ClientAppData } from "@/lib/fmdb/client-app";
import { TAG_WORDS, type AppResults } from "@/lib/fmdb/released-results";
import { coachCard, handoffCard, urgentCard, type AskCard } from "@/lib/fmdb/ask-card";
import { REPLY_LINE, askHandoff, askUrgent, dropSupplementForms, isMissedCapsule, normalizeAsk } from "@/lib/fmdb/ask-safety";
import { defaultSituation, dishesInGuide, matchSituation, type AppEatingOut, type AppEatingOutSituation, type DishVerdict } from "@/lib/fmdb/eating-out";
import {
  dayCount,
  dayLabel,
  dayRows,
  isTicked,
  nextMoment,
  tickedAt,
  upcomingMoments,
  type SqMoment,
  type SqRow,
  type SqTicks,
} from "./sq-day";
import { inLanguageOf } from "@/lib/fmdb/ask-hinglish";
import { practiceList, type SqPractice } from "./sq-practice-data";
import type { SqSheet } from "./sq-ui";

export interface AskContext {
  data: ClientAppData;
  moments: SqMoment[];
  ticks: SqTicks;
  /** where the phone's clock puts her in the day (sq-day.ts rankFloorAt) */
  nowRank: number;
  /** the phone's own date, YYYY-MM-DD */
  todayYmd: string;
}

export type AskResult =
  | { type: "empty" }
  | { type: "card"; card: AskCard }
  | { type: "open"; sheet: SqSheet }
  | { type: "tab"; tab: "practices" | "coach"; draft?: string }
  | { type: "model" };

const card = (c: AskCard): AskResult => ({ type: "card", card: c });
const soon = (title: string): AskResult => ({ type: "open", sheet: { k: "soon", title } });
const hosted = (id: "menu" | "grocery" | "checkin" | "labs" | "move"): AskResult => ({ type: "open", sheet: { k: "hosted", id } });
const PLAN = "From your plan";

/** Alcohol, plan by plan (coach, 21 Nov 2026): with a risk marker on the
 *  record, a gentle "skip it"; without one, the practical line. The reason is
 *  never shown (scripts/alcohol_risk.py decides on the Mac). */
export function alcoholLines(risk: boolean): string[] {
  return risk
    ? ["It's best to skip alcohol while you're on this plan.", "If you'd like to talk it through, your coach can help."]
    : ["If you do have a drink, have one, slowly, with food, and water alongside.", "Your coach will go through alcohol with you."];
}

export function alcoholCard(risk: boolean): AskCard {
  return {
    src: PLAN,
    heading: risk ? "Best to skip it for now" : "One, slowly, with food",
    lines: alcoholLines(risk),
    buttons: [{ to: "coach", label: "Message my coach", draft: "A question about alcohol: " }],
  };
}

/** The coach's standing answer to a missed capsule (21 Nov 2026). */
export function missedCapsuleCard(): AskCard {
  return {
    src: PLAN,
    heading: "No worries",
    lines: ["Just take the next one at its usual time. There's no need to take two to make up for it.", "Your phone can remind you at each supplement time."],
    buttons: [
      { to: "remind", label: "Yes, remind me", solid: true },
      { to: "remind", label: "Tell me how" },
    ],
  };
}
const RECORD = "From your record";

// ── small helpers ──────────────────────────────────────────────────────────

const STOP = new Set(
  "a an the my me i to of for and or with at in on is it this that some any can may could should do does did have has had eat take took taken tick ticked today tonight now please kya hai hu hoon main mai mujhe ko ka ki ke se bhi aaj kal le lu sakti sakta sakte".split(
    " ",
  ),
);
const words = (s: string): string[] => s.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter(Boolean);
const keyWords = (s: string): string[] => words(s).filter((w) => w.length >= 3 && !STOP.has(w));
const hasWord = (s: string, w: string): boolean => new RegExp(`\\b${w.replace(/[^a-z0-9]/g, ".")}`).test(s);

/** The row of today the question names ("my iron", "the magnesium"), if any.
 *  Scored by how many of the row's own words appear, so "vitamin d" does not
 *  pick "vitamin b12". */
export function findRow(s: string, rows: SqRow[]): SqRow | null {
  let best: SqRow | null = null;
  let bestScore = 0;
  for (const r of rows) {
    const keys = keyWords(r.name);
    if (keys.length === 0) continue;
    // The first word carries the name ("Iron (bisglycinate)"); it must be there.
    if (!hasWord(s, keys[0])) continue;
    const score = keys.filter((k) => hasWord(s, k)).length;
    if (score > bestScore) {
      best = r;
      bestScore = score;
    }
  }
  return best;
}

const SLOTS: [RegExp, RegExp][] = [
  [/br(ea|e)a?kfa?st|nashta/, /breakfast/i],
  [/mid.?morning/, /mid.?morning|brunch/i],
  [/lunch|dopahar/, /lunch/i],
  [/snack|tea.?time/, /snack|tea.?time|afternoon/i],
  [/dinner|tonight|supper|raat ka|raat ko khana/, /dinner|supper/i],
];

function mealFor(s: string, moments: SqMoment[]): SqMoment | null {
  for (const [ask, slot] of SLOTS) {
    if (ask.test(s)) return moments.find((m) => m.kind === "meal" && slot.test(m.slot || m.part)) ?? null;
  }
  return null;
}

function mealCard(m: SqMoment, data: ClientAppData, heading?: string): AskCard {
  const extra = m.slot ? data.mealExtra[m.slot] : undefined;
  const hasRecipe = !!extra && (extra.recipe.length > 0 || extra.ingredients.length > 0);
  return {
    src: PLAN,
    heading: heading ?? `${m.part}: ${m.title}`,
    lines: [m.sub, m.time].filter(Boolean),
    buttons: [
      ...(hasRecipe && m.slot ? [{ to: "recipe" as const, label: "See recipe", ref: m.slot, solid: true }] : []),
      { to: "day" as const, label: "Your whole day" },
    ],
  };
}

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function shiftYmd(ymd: string, by: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + by)).toISOString().slice(0, 10);
}
const dowOf = (ymd: string): number => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

/** The day a question is about: today (null), or a past date. A weekday name
 *  means the most recent one before today. */
function askedDay(s: string, todayYmd: string): string | null {
  if (/yesterday|\bkal\b/.test(s)) return shiftYmd(todayYmd, -1);
  const i = DAYS.findIndex((d) => s.includes(d) || new RegExp(`\\b${d.slice(0, 3)}\\b`).test(s));
  if (i < 0) return null;
  const back = (dowOf(todayYmd) - i + 7) % 7 || 7;
  return shiftYmd(todayYmd, -back);
}

/** A past day's row for the thing she named, matched by name. */
function pastItem(history: AppTickDay[], ymd: string, name: string) {
  const day = history.find((d) => d.date === ymd);
  if (!day) return { day: null, item: null };
  const key = keyWords(name)[0];
  const item = key ? day.items.find((it) => hasWord(it.name.toLowerCase(), key)) ?? null : null;
  return { day, item };
}

/** The most recent date she ticked it, looking at today then back. */
function lastTicked(row: SqRow, ctx: AskContext): string | null {
  if (isTicked(row.id, row.kind, ctx.ticks)) return ctx.todayYmd;
  const key = keyWords(row.name)[0];
  if (!key) return null;
  const past = [...(ctx.data.sq?.tickHistory ?? [])].filter((d) => d.date < ctx.todayYmd).sort((a, b) => (a.date < b.date ? 1 : -1));
  for (const d of past) {
    if (d.items.some((it) => it.done && hasWord(it.name.toLowerCase(), key))) return d.date;
  }
  return null;
}

// ── lookups ────────────────────────────────────────────────────────────────

function sessionAnswer(s: string, data: ClientAppData): AskResult {
  const next = data.coach.nextSession;
  const named = s.match(/week (\d{1,2})/);
  // "My week 12 review" asks about ONE session. The app knows only the next
  // one, so it must not answer with it as though it were the one she named.
  if (named && Number(named[1]) !== data.client.week) {
    return card(
      coachCard(
        next
          ? `I can see your next session, on ${next}, but not the date of your week ${named[1]} review. Shall I ask your coach?`
          : `I don't have the date of your week ${named[1]} review. Shall I ask your coach?`,
      ),
    );
  }
  if (!next) return card(coachCard("I don't have a date for your next session yet. Shall I ask your coach?"));
  return card({
    src: PLAN,
    heading: `Your next session: ${next}`,
    lines: ["With your coach."],
    buttons: [{ to: "coach", label: "Message my coach" }],
  });
}

function leftAnswer(ctx: AskContext): AskResult {
  const rows = dayRows(ctx.moments).filter((r) => r.counted && !isTicked(r.id, r.kind, ctx.ticks));
  const { ticked, total } = dayCount(ctx.moments, ctx.ticks);
  if (rows.length === 0) {
    return card({ src: RECORD, heading: "Nothing is left today", lines: [`${ticked} of ${total} ticked.`], buttons: [{ to: "day", label: "Your whole day" }] });
  }
  return card({
    src: RECORD,
    heading: `${rows.length} left today`,
    lines: [],
    list: rows.map((r) => ({ mark: "dot" as const, text: r.name })),
    buttons: [{ to: "day", label: "Your whole day", solid: true }],
  });
}

function doneAnswer(ctx: AskContext): AskResult {
  const rows = dayRows(ctx.moments).filter((r) => isTicked(r.id, r.kind, ctx.ticks));
  const { ticked, total } = dayCount(ctx.moments, ctx.ticks);
  return card({
    src: RECORD,
    heading: `${ticked} of ${total} ticked so far today`,
    lines: rows.length ? [] : ["Nothing is ticked yet today."],
    list: rows.map((r) => {
      const at = tickedAt(r.id, r.kind, ctx.ticks);
      return { mark: "yes" as const, text: at ? `${r.name} · ${at}` : r.name };
    }),
    buttons: [
      { to: "day", label: "Your whole day", solid: true },
      { to: "record", label: "Earlier days" },
    ],
  });
}

function tookAnswer(s: string, row: SqRow, ctx: AskContext): AskResult {
  const day = askedDay(s, ctx.todayYmd);
  if (!day) {
    const done = isTicked(row.id, row.kind, ctx.ticks);
    const at = tickedAt(row.id, row.kind, ctx.ticks);
    return card({
      src: RECORD,
      heading: done ? (at ? `${row.name}: ticked at ${at}` : `${row.name}: ticked today`) : `${row.name}: not ticked yet today`,
      lines: done ? [] : ["If you have had it, tick it in your whole day."],
      buttons: [{ to: "day", label: "Your whole day" }],
    });
  }
  const label = dayLabel(day);
  const { day: found, item } = pastItem(ctx.data.sq?.tickHistory ?? [], day, row.name);
  const buttons = [{ to: "record" as const, label: "Your record" }];
  if (!found) return card({ src: RECORD, heading: `Nothing is saved for ${label}`, lines: ["Your record has no ticks for that day."], buttons });
  if (!item) return card({ src: RECORD, heading: `${row.name} is not in your record for ${label}`, lines: [], buttons });
  return card({
    src: RECORD,
    heading: item.done ? `${row.name}: ticked on ${label}${item.at ? `, at ${item.at}` : ""}` : `${row.name}: not ticked on ${label}`,
    lines: [],
    buttons,
  });
}

/** "Is tomorrow an iron day?" — the plan says how often; the record says when
 *  she last ticked it. Where the record cannot tell, the coach is offered:
 *  which day to restart on is the coach's call, not the app's. */
function scheduleAnswer(s: string, row: SqRow, supp: AppSupplement, ctx: AskContext): AskResult {
  const every = supp.notDaily === "weekly" ? 7 : 2;
  const rule = supp.notDaily === "weekly" ? "once a week" : "every other day";
  const last = lastTicked(row, ctx);
  if (!last) {
    return card(coachCard(`${row.name} is ${rule} on your plan, and your record shows no recent tick, so I can't tell which day you are on. Shall I ask your coach?`));
  }
  const due = shiftYmd(last, every);
  const about = /tomorrow|\bkal\b/.test(s) ? shiftYmd(ctx.todayYmd, 1) : ctx.todayYmd;
  const aboutWord = about === ctx.todayYmd ? "Today" : "Tomorrow";
  const lastWord = last === ctx.todayYmd ? "today" : last === shiftYmd(ctx.todayYmd, -1) ? "yesterday" : `on ${dayLabel(last)}`;
  const isDay = due <= about;
  return card({
    src: RECORD,
    heading: `${aboutWord} is ${isDay ? "" : "not "}${/^[aeiou]/i.test(row.name) ? "an" : "a"} ${row.name.toLowerCase()} day`,
    lines: [`It is ${rule} on your plan, and you last ticked it ${lastWord}.`],
    note: "Check with your coach before changing it.",
    buttons: [{ to: "record", label: "Your record" }],
  });
}

function suppAnswer(row: SqRow, supp: AppSupplement): AskResult {
  const often = supp.notDaily === "weekly" ? "Once a week" : supp.notDaily === "alternate" ? "Every other day" : "";
  const when = [supp.dose, supp.timing, often].map((x) => (x || "").trim()).filter(Boolean).join(" · ");
  return card({
    src: PLAN,
    heading: row.name,
    lines: [when, (supp.why || "").trim()].filter(Boolean),
    note: "Check with your coach before changing it.",
    buttons: [{ to: "day", label: "Your whole day" }],
  });
}

/** Tomorrow's meals from the week's menu, or null when the menu does not
 *  reach tomorrow. */
function tomorrowSlots(data: ClientAppData) {
  const current = data.weekMenus.find((w) => w.current);
  if (!current) return null;
  const i = current.days.findIndex((d) => d.today);
  if (i < 0) return null;
  const next = current.days[i + 1] ?? data.weekMenus.find((w) => w.week === current.week + 1)?.days[0];
  return next ?? null;
}

/** "Can I eat idli?" — yes when it is literally on this week's menu. EVERY
 *  word of the food she named must be in one dish: "chicken curry" is not
 *  answered by a "lauki curry" on the menu. Anything else goes to the model. */
export function dishOnMenu(s: string, data: ClientAppData): { dish: string; where: string }[] {
  const en = s.match(/\b(?:eat|have)\s+(.+)$/);
  const hi = s.match(/^(.+?)\s+(?:kha|khana|le)\b/);
  const phrase = (en?.[1] ?? hi?.[1] ?? "").replace(/[?.!,].*$/, "");
  const want = keyWords(phrase).filter((w) => !/^(br(ea|e)a?kfa?st|lunch|dinner|snack|tomorrow|instead|something|anything|what)$/.test(w));
  if (want.length === 0) return [];
  const current = data.weekMenus.find((w) => w.current);
  if (!current) return [];
  const hits: { dish: string; where: string }[] = [];
  for (const d of current.days) {
    for (const slot of d.slots) {
      const text = [slot.dish, ...(slot.components ?? []).map((c) => c.title)].join(" ").toLowerCase();
      if (want.every((w) => hasWord(text, w))) hits.push({ dish: slot.dish, where: `${d.dow} ${slot.slot.toLowerCase()}` });
    }
  }
  return hits;
}

/**
 * An eating-out card: the coach's own lines for that place, as written in the
 * plan. Nothing is added or reworded. It answers at once and offers the coach
 * as well, so nobody waits a day before a meal.
 */
export function eatingOutCard(sit: AppEatingOutSituation, guide: AppEatingOut, q: string, withRules = false): AskCard {
  return {
    src: guide.label ? `From your plan · ${guide.label}` : PLAN,
    heading: sit.where,
    lines: withRules ? guide.rules.slice(0, 3) : [],
    list: [...sit.choose.map((text) => ({ mark: "yes" as const, text })), ...sit.skip.map((text) => ({ mark: "no" as const, text }))],
    note: sit.note || undefined,
    buttons: [
      { to: "eatout", label: "Other places" },
      { to: "coach", label: "Ask my coach", draft: q.trim() },
    ],
  };
}

/**
 * A named dish, settled by the coach's guide: her own line for it, as
 * written, and which card it is on. One row per dish asked about.
 */
export function dishCard(found: DishVerdict[], guide: AppEatingOut, q: string): AskCard {
  const no = found.filter((f) => f.verdict === "skip").length;
  const maybe = found.filter((f) => f.verdict === "depends").length;
  const all = found.length > 1;
  const heading = maybe
    ? "It depends which one"
    : no === 0
      ? all ? "Yes, both are fine" : "Yes, go ahead"
      : no === found.length
        ? all ? "Skip these" : "Skip this one"
        : "One yes, one to skip";
  const list: AskCard["list"] = [];
  const instead: string[] = [];
  for (const f of found) {
    list.push({ mark: f.verdict === "choose" ? "yes" : "no", text: f.line });
    if (f.verdict === "depends") list.push(...f.instead.map((text) => ({ mark: "yes" as const, text })));
    if (f.verdict === "skip") instead.push(...f.instead);
  }
  // With a skip, the coach's own lines for what to have there instead: nobody
  // should be left at a table with only a "no".
  const shown = new Set(list.map((x) => x.text));
  const swaps = [...new Set(instead)].filter((t) => !shown.has(t)).slice(0, 2);
  return {
    src: guide.label ? `From your plan · ${guide.label}` : PLAN,
    heading,
    lines: [],
    list: [...list, ...swaps.map((text) => ({ mark: "yes" as const, text }))],
    note: swaps.length ? "The ticked lines are what to have instead." : undefined,
    buttons: [
      { to: "eatout", label: "The whole guide" },
      { to: "coach", label: "Ask my coach", draft: q.trim() },
    ],
  };
}

/**
 * When the model has no answer to a food question, the client still gets the
 * coach's own line for a food the plan does not mention — never only "ask
 * your coach", which at a restaurant table means waiting a day.
 */
export function notOnListCard(guide: AppEatingOut, q: string): AskCard {
  return {
    src: guide.label ? `From your plan · ${guide.label}` : PLAN,
    heading: "Not on your list yet",
    lines: [guide.notOnList || "Choose something from your guide for now, and message your coach so this can be added."],
    buttons: [
      { to: "eatout", label: "The whole guide" },
      { to: "coach", label: "Ask my coach", draft: q.trim() },
    ],
  };
}

/** True when a question asks whether a food may be eaten. */
export const looksLikeDishQuestion = (q: string): boolean => DISH_ASK.test(dropSupplementForms(normalizeAsk(q)));

/** A question that asks about a food, as opposed to one that merely shares a
 *  word with a guide line. */
/** Words of a dish question that name no food: the slot, the place, the
 *  asking. What is left after these is the dish. */
const NOT_A_DISH = new Set(
  "dinner lunch breakfast snack snacks tonight tomorrow morning evening night dinnertime restaurant hotel buffet airport flight home house guests guest party wedding shaadi dhaba cafe office work outside bahar ghar ghare mehman time today aaj raat subah shaam plate bowl glass piece little small bit some one two thoda chalega chalegi chahiye okay allowed fine good bad healthy order eat eating have having drink can could should may would will kha khaa khana khaun khau sakti sakta sakte hoon kya main mai mujhe meri mera mere abhi kal ek also too with without and plan list allowed instead what about which please".split(" "),
);

/** The food words of a dish question that her plan never mentions: not in
 *  today's or tomorrow's meals, the eat / sometimes / leave-out lists, or her
 *  coach's eating-out guide. Empty when every food word is known. */
/** The food a question asks about: "can I have dahi vada at dinner" → "dahi
 *  vada", "is moussaka ok" → "moussaka", "kya main adai kha sakti hoon" →
 *  "adai". Empty when the question names no food this way. */
export function askedFood(s: string): string {
  const pats = [
    /\b(?:can|may|should|could) i (?:eat|have|order|try|get)\s+(.+?)(?:\?|$|\bat\b|\bfor\b|\btonight\b|\btoday\b|\btomorrow\b|\bin\b|\bwith\b|\bif\b)/,
    /^(?:is|are) (?:a |an |the )?(.+?) (?:ok|okay|fine|allowed|alright)\b/,
    /\bkya (?:main|mai|hum) (.+?) (?:kha|khaa|le|pi|pee)\b/,
    /^(.+?) (?:chalega|chalegi|chal jayega|kha sakti|kha sakta|kha sakte|khaa sakti)\b/,
    /\bwhat about (.+?)(?:\?|$)/,
  ];
  for (const p of pats) {
    const m = s.match(p);
    if (m && !/^(something|anything|what|this|that|it|one minute|five minutes|for|at|in|on)\b/.test(m[1].trim())) return m[1].trim();
  }
  return "";
}

export function unnamedDishWords(s: string, data: ClientAppData): string[] {
  const food = askedFood(s);
  if (!food || dishOnMenu(s, data).length) return [];
  const known = [
    ...data.meals.flatMap((m) => m.pills),
    ...(data.planRef?.foods?.eat ?? []),
    ...(data.planRef?.foods?.sometimes ?? []),
    ...(data.planRef?.foods?.avoid ?? []),
    JSON.stringify(data.planRef?.eatingOut ?? ""),
  ]
    .join(" ")
    .toLowerCase();
  return keyWords(food).filter((w) => !NOT_A_DISH.has(w) && !/^\d/.test(w) && !hasWord(known, w));
}

const DISH_ASK = /\b(can|may|should|could) i\b|\bis\b.*\b(ok|okay|fine|allowed)\b|\b(ok|okay|allowed)\b|what about|which one|\border\b|\beat\b|\bhave\b|\bkha\b|sakt/;

/** Away from home, but not about food: these keep going to the model, which
 *  uses the detail in the question or hands to the coach. */
const NOT_FOOD = /\bgym\b|workout|exercise|sleep|jet ?lag|supplement|vitamin|capsule|run(ning)? out|ran out|medicine|tablet/;
const ABOUT_FOOD = /\b(eat|eating|order|ordering|food|khana|kha|menu|meals?|breakfast|lunch|dinner|snack|buffet|restaurant)\b|what (do|should|can) i (do|have|get|choose|pick)/;

// ── practices ──────────────────────────────────────────────────────────────

/**
 * A feeling, a bad night, a hot flush: the practice on her plan that suits
 * it, one tap from starting. Only practices the coach prescribed are offered;
 * a client with none is offered the coach.
 *
 * The wording of each answer is the prototype's, which the testers saw. A
 * symptom never reaches here: the safety rules send those to the coach first.
 */
function practiceAnswer(s: string, q: string, data: ClientAppData): AskResult {
  const list = practiceList({ eft: data.eft, sleep: data.sleep, breathwork: data.breathwork, somatic: data.somatic });
  const has = (r: RegExp) => r.test(s);
  const get = (id: string) => list.find((p) => p.id === id) ?? null;
  const reset = list.find((p) => p.kind === "reset") ?? null;
  const start = (p: SqPractice): AskResult => ({ type: "open", sheet: { k: "practice", id: p.id } });
  const tell = { to: "coach" as const, label: "Tell my coach", draft: q.trim() };

  if (list.length === 0) return card(coachCard("That is worth telling your coach. Send it to your coach?"));

  // asked for by name
  const tap = get("tap");
  const sleep = get("sleep");
  if (tap && has(/tapping|\beft\b/)) return start(tap);
  if (reset && has(/body reset|somatic/)) return start(reset);
  if (sleep && has(/wind.?down/) && has(/sleep|night|bed/)) return start(sleep);

  /** A card offering the first two of `want` that she has; null when none. */
  const offer = (heading: string, both: string, want: (SqPractice | null)[], note?: string): AskResult | null => {
    const have = want.filter((p): p is SqPractice => !!p);
    if (have.length === 0) return null;
    const all = have.length === want.filter(Boolean).length && have.length === want.length;
    return card({
      src: PLAN,
      heading,
      // The fuller line names two practices; it is used only when she has both.
      lines: [all ? both : `${have[0].title} suits this, and it is on your plan.`],
      note,
      buttons: [
        ...have.slice(0, 2).map((p, i) => ({ to: "practice" as const, ref: p.id, label: i === 0 ? `Begin ${p.title.toLowerCase()}` : p.title, solid: i === 0 })),
        tell,
      ],
    });
  };
  const one = get("one");
  const breath = get("breath");
  const tries: (AskResult | null)[] = [];
  if (has(/don'?t have (five|5|time)|no time|only (a|one) minute|one minute|\bquick\b/)) {
    tries.push(offer("One minute is enough", "A single minute of slow out-breaths still tells your body it is safe.", [one]));
  } else if (has(/hot flush|hot flash|flush|heart is racing|racing heart/)) {
    tries.push(
      offer(
        "Right now, where you are",
        "Lengthen your out-breath for one minute. You can do it wherever you are, sitting, standing or lying down.",
        [one, reset],
        "If your heart keeps racing, or this is new for you, tell your coach.",
      ),
    );
  } else if (has(/irritab|angry|anger|snapping|short fuse|furious/)) {
    tries.push(offer("For a short fuse", "Tapping takes the charge out of it. The body reset is quicker if you are in company.", [tap, reset]));
  } else if (has(/sleep|woke|awake|\b3 ?am\b|at 3\b|insomnia|neend|wired|night|11 ?pm|\bbed\b|soaked/)) {
    tries.push(
      offer(
        "For tonight",
        "Your sleep wind-down is about five minutes, lights low. If you would rather have quiet, slow breathing works lying down.",
        [sleep, breath],
        "Your coach would want to hear about nights like this, whenever you like.",
      ),
    );
  } else if (has(/\bmind\b|\bbrain\b|thoughts?|overthink/)) {
    tries.push(offer("For a busy mind", "Tapping gives the mind one small thing to follow. Slow breathing is quieter if you would rather not speak.", [tap, breath]));
  }
  const hit = tries.find(Boolean);
  if (hit) return hit;
  // Anything else, and any mood whose own practices she does not have.
  return card({
    src: PLAN,
    heading: "Let's slow things down",
    lines: ["Pick whichever suits the moment. None of them need anything but you."],
    note: "Your coach would want to hear about this, whenever you like.",
    buttons: [
      ...[breath, tap, reset, sleep, one]
        .filter((p): p is SqPractice => !!p)
        .slice(0, 2)
        .map((p, i) => ({ to: "practice" as const, ref: p.id, label: p.title, solid: i === 0 })),
      tell,
    ],
  });
}

// ── released results ───────────────────────────────────────────────────────

/**
 * A results question once the coach has shared them: the number, its date and
 * its plain tag, from released-results.ts. What it means stays the coach's,
 * so every card says so and offers the coach. A marker the question does not
 * name opens the whole results screen.
 */
function resultsAnswer(s: string, results: AppResults): AskResult {
  const ask = { to: "coach" as const, label: "Ask my coach about it", draft: "Could you walk me through my results?" };
  const all = { to: "soon" as const, label: "All your results", ref: "results" };
  if (/body age|biological age|bio age|how old is my body/.test(s)) {
    const ba = results.bodyAge;
    if (!ba) return card(coachCard("Your body age has not been worked out from your tests yet. Shall I ask your coach?"));
    return card({
      src: "From your results",
      heading: `Your body age: ${ba.value} years`,
      lines: [ba.calendarAge !== null ? `You were ${ba.calendarAge} at the test. One test is a snapshot; it is measured again at your recheck.` : "One test is a snapshot; it is measured again at your recheck."],
      note: "What it means for you is for your coach.",
      buttons: [ask],
    });
  }
  const rows = results.groups.flatMap((g) => g.rows);
  const words = s.replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length >= 3 && !/^(is|my|the|and|low|high|range|normal|level|report|result|results|number|numbers|what|how|okay|fine|in)$/.test(w));
  const hit = rows.find((r) => {
    const n = r.name.toLowerCase();
    return words.some((w) => n.includes(w) || (w === "sugar" && /glucose|hba1c/.test(n)) || (w.startsWith("vit") && n.includes("vitamin")));
  });
  if (!hit) return { type: "open", sheet: { k: "results" } };
  return card({
    src: "From your results",
    heading: `Your ${hit.name}: ${hit.value} ${hit.unit}`.trim(),
    lines: [`${TAG_WORDS[hit.tag]}${hit.range ? ` (${hit.range})` : ""}. From your test on ${hit.date}.`],
    note: "What it means for you, and what to do about it, is for your coach.",
    buttons: [ask, all],
  });
}

// ── the router ─────────────────────────────────────────────────────────────

const TRAVEL = /travel|\btrip\b|flight|flying|abroad|out of (town|station)|on tour|hotel|airport|jet ?lag|buffet|wedding|shaadi|restaurant|eating out|eat out|(client|business|office|team) (dinner|lunch)|(dinner|lunch) out|italian|chinese|pizza|takeaway|order in|swiggy|zomato/;

const PRACTICE =
  /stress|anxious|anxiety|overwhelm|panic|tense\b|nervous|worr|racing|overthink|(mind|brain|head|thoughts?) (off|won'?t|wont|will not|doesn'?t|is so|is too|keeps?)|can'?t (relax|unwind|settle|calm|switch)|hot flush|hot flash|flush|irritab|angry|anger|furious|snapping|short fuse|upset|feeling low|low today|sleep|woke|awake|\b3 ?am\b|insomnia|neend|soaked|night sweat|wind.?down|calm|relax|breathing|breath ?work|tapping|\beft\b|somatic|body reset|meditat|wired|restless|don'?t have (five|5|time)|no time|one minute/;

export function routeAsk(q: string, ctx: AskContext): AskResult {
  const r = routeAskEn(q, ctx);
  return r.type === "card" ? { ...r, card: inLanguageOf(q, r.card) } : r;
}

function routeAskEn(q: string, ctx: AskContext): AskResult {
  const raw = normalizeAsk(q);
  if (!raw) return { type: "empty" };
  const s = dropSupplementForms(raw);
  const has = (r: RegExp) => r.test(s);
  const { data, moments, ticks } = ctx;

  // 1. self-harm, emergency
  const urgent = askUrgent(q);
  if (urgent) return card(urgentCard(urgent));

  // 2. cannot be clinical
  if (has(/(when|what time|how (long|soon)|kab).{0,30}coach.{0,20}(reply|replies|respond|answer|get back)|coach.{0,20}(reply|replies|respond).{0,20}(when|time|long)/)) {
    return card({ src: "How it works", heading: "Within 24 hours", lines: [REPLY_LINE, "If something is urgent, see a doctor. Do not wait for a reply."], buttons: [{ to: "coach", label: "Message my coach" }] });
  }
  if (has(/next (session|review|call|appointment|meeting|consult)|when (is|do|will) .*(session|review|appointment|call with|meet (my|the|your) coach|see (my|the|your) coach)|(session|review|appointment) (date|kab)/)) {
    return sessionAnswer(s, data);
  }
  if (has(/\b(remind|reminders?|notifications?|alerts?|yaad dila)/) && !has(/\bdid i\b/)) return { type: "open", sheet: { k: "remind" } };
  if (has(/where (do|should) i (even )?(start|begin)|what (do|should) i do first|\bon day (one|1)\b|what do i do on day|\bi'?m new\b|\bim new\b|how (do|should) i (start|begin)|start here|getting started|new here|first day|do i (have|need) to do (all|everything)|is (all|everything) (of this )?(compulsory|necessary|mandatory)|too much to do|what is (the|this|that) (ring|circle|logo)|what are (the|these) rings|how does (this|the) app work/)) {
    return { type: "open", sheet: { k: "start" } };
  }
  if (has(/(tell|message|msg|talk to|speak to|write to|call) (my |the |your )?coach/)) return { type: "tab", tab: "coach" };

  // 3. the coach answers these personally
  const guide = data.planRef?.eatingOut ?? null;
  const situation = guide ? matchSituation(s, guide) : null;
  const handoff = askHandoff(q);
  // Alcohol leads the answer; the guide's food card joins it only when the
  // question is also about food ("client dinner with drinks").
  if (handoff === "alcohol" && guide && situation && has(ABOUT_FOOD)) {
    // "Late client dinner with drinks": the food is answered now, from the
    // plan. The drinks stay the coach's call, and the card says so.
    return card({ ...eatingOutCard(situation, guide, q), buttons: [], note: alcoholLines(data.sq?.alcoholRisk !== false)[0] });
  }
  if (handoff === "alcohol") return card(alcoholCard(data.sq?.alcoholRisk !== false));
  // A shared result is answered; what to DO about it ("should I take more?")
  // is still the coach's, so any question about acting on it is handed over.
  const actsOnIt = /\b(should|can|do|must) i\b|\bneed to\b|\btake\b|\bstop\b|\bincrease\b|\breduce\b|\bmore\b|\bless\b|\bdose\b|\bfix\b|\btreat/.test(s);
  if (handoff === "results" && data.sq?.results && !actsOnIt) return resultsAnswer(s, data.sq.results);
  // Coach, 21 Nov 2026: a missed capsule is answered, not handed over: no
  // worries, take the next one, and the app can remind you.
  if (handoff === "dose" && isMissedCapsule(q)) return card(missedCapsuleCard());
  if (handoff) return card(handoffCard(handoff));
  if (has(/(shift|change|move|adjust|push).{0,24}(time|timing)|eat (breakfast|lunch|dinner) at \d|(late|night|early) shift/)) {
    return card(coachCard("Changing when you eat or take things is your coach's call. Send this to your coach?"));
  }

  // 4. plan lookups
  // Anything about being away from home uses the detail in the question, so
  // it goes to the model rather than to a card that ignores it.
  // Eating away from home: answered at once from the coach's guide for this
  // plan week, when the plan has one and the question is about food.
  // "I already ate it": answered before any dish lookup. She is not asking
  // whether she may have it, and a skip list now would read as a scolding.
  if (has(/(i|maine) (just )?(ate|had|have eaten|have had)\b.*\b(wrong|shouldn'?t|not allowed|off.?plan|cheat|junk|samosa|sweet|dessert|rice|fried)|already ate|i (slipped|cheated)|broke (my|the) (diet|plan)|kha liya/)) {
    return card({
      src: PLAN,
      heading: "You pick up from your next meal",
      lines: ["One meal does not undo your plan. Nothing here has expired, and there is nothing to make up for."],
      buttons: [
        { to: "day", label: "Your whole day", solid: true },
        { to: "coach", label: "Tell my coach", draft: q.trim() },
      ],
    });
  }
  if (guide && has(/\b(guide|list)\b/) && has(/eat(ing)? out|restaurant|outside|bahar|dish(es)?|foods?\b/)) return { type: "open", sheet: { k: "eatout" } };
  if (guide) {
    // A dish she names, when the guide settles it: her coach's line for it.
    if (has(DISH_ASK) || s.split(" ").length <= 3) {
      const found = dishesInGuide(s, guide);
      if (found.length) return card(dishCard(found, guide, q));
    }
  }
  // A dish her plan never mentions: the model's automatic "likely yes / likely
  // skip", which also goes to the coach (coach, 21 Nov 2026), never a meal
  // card or a whole guide that leaves her question unanswered.
  if (!has(NOT_FOOD) && unnamedDishWords(s, data).length) return { type: "model" };
  if (guide) {
    const food = has(ABOUT_FOOD);
    if (situation && (food || !has(NOT_FOOD))) return card(eatingOutCard(situation, guide, q));
    if (food && has(TRAVEL)) {
      const fallback = defaultSituation(guide);
      if (fallback) return card(eatingOutCard(fallback, guide, q, true));
    }
  }
  if (has(TRAVEL)) return { type: "model" };

  // "Which supplements after lunch, and at what time?": her own list, by time.
  if (has(/\b(which|what|my|all)\b.{0,12}\bsupplements?\b|\bsupplements?\b.{0,30}\b(when|what time|times|schedule|kab)\b/) && !has(/\b(why|for what|kis liye|order|buy|run out|ran out|did i|have i|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/)) {
    const slotWord = (s.match(/breakfast|lunch|dinner|bed(time)?|morning|night|evening|empty stomach/) ?? [""])[0];
    const list = data.supplements.filter((x) => !slotWord || `${x.timing} ${x.slot}`.toLowerCase().includes(slotWord.replace("bedtime", "bed")));
    if (list.length) {
      return card({
        src: PLAN,
        heading: slotWord ? `Supplements: ${slotWord}` : "Your supplements today",
        lines: [],
        list: list.map((x) => ({ mark: "dot" as const, text: `${x.name}${x.dose ? `, ${x.dose}` : ""} · ${x.timing || x.slot}` })),
        buttons: [{ to: "day", label: "Your whole day" }],
      });
    }
  }
  const rows = dayRows(moments);
  const row = findRow(s, rows);
  const supp = row ? data.supplements.find((x) => x.id === row.id) ?? null : null;


  // a thing she named: her record of it, its schedule, what it is for.
  // Before the feelings rules, so "why magnesium for sleep" is about magnesium.
  if (row && has(/(what time|when|kab) did i|did i (take|have|tick|do|eat)|have i (taken|had|ticked|done|eaten)/)) return tookAnswer(s, row, ctx);
  if (row && supp?.notDaily && has(/\bday\b|today|tomorrow|\bkal\b|aaj|how often|every other|alternate/)) return scheduleAnswer(s, row, supp, ctx);
  if (row && supp && !has(/coffee|\btea\b|chai|milk|doodh/) && has(/\bwhy\b|what (is|are|does).*(for|do)|what for|when (do|should)|what time|at night|morning|kab|kyu|kyon|kis liye/)) return suppAnswer(row, supp);

  if (has(/(no energy|too tired|can'?t|don'?t want|not up) to cook|can'?t cook/)) return { type: "model" };
  if (has(/tired|thakan|thak gay|exhaust|no energy|fatigue|kamzor|weak\b|drained/)) {
    return card(coachCard("Feeling this tired is worth telling your coach. Send it to your coach?"));
  }
  if (has(/coach.*(see|know|notice)|(see|know).*(i was away|been away)/)) {
    return card({ src: "How it works", heading: "What your coach sees", lines: ["What you tick, when you last opened the app, and anything you send. Nothing else."], followUps: ["Tell my coach how I feel"] });
  }
  if (has(/^practices?$|which practice|my practices|all practices|other practices/)) return { type: "tab", tab: "practices" };
  if (has(PRACTICE)) return practiceAnswer(s, q, data);
  if (has(/\bi feel\b|feeling|failed|guilty|ashamed|\bsad\b|crying|lonely|can'?t do this|cannot do this|too much|too hard|give up|giving up|fed up|what'?s the point/)) {
    return card(coachCard("That sounds heavy. I can send this to your coach, and you don't have to do anything else today."));
  }
  if (has(/ruined|lost (all )?(my )?progress|undone|too late|wasted|back to (zero|square)/)) {
    return card({ src: PLAN, heading: "You pick up from today", lines: [`Nothing here has expired. Today is week ${data.client.week}, and your plan is where you left it.`], buttons: [{ to: "day", label: "Your whole day", solid: true }] });
  }
  if (has(/fell off|fallen off|restart|start (it |this |the |my |all |over|.{0,24})?again|start over|from (day|week) (1|one)|from scratch|gave up|\bbehind\b|been away|was away|ease me/)) {
    return card({ src: PLAN, heading: "You start from today", lines: ["Nothing is waiting for you. Today's plan is the whole of it."], buttons: [{ to: "day", label: "Your whole day", solid: true }] });
  }
  if (has(/\b(undo|untick|un-tick)\b|tick(ed)?\b.{0,24}(by mistake|wrongly|accident)|(by mistake|wrongly|accident).{0,24}\btick/)) {
    return card({ src: "How it works", heading: "Tap the tick again to clear it", lines: ["Open your whole day. Every meal and every supplement has its own tick."], buttons: [{ to: "day", label: "Open my whole day", solid: true }] });
  }

  // her ticks and her record
  if (has(/what.?s left|what is left|left to (tick|do|take)|still (to|have to) (tick|do|take)|remaining|baaki|pending/)) return leftAnswer(ctx);
  if (has(/(tick|ticked|done|taken|took|take).*(today|so far)|how many.*(done|ticked)|what (have|did) i (tick|ticked|done|taken)/) && !has(/yesterday|last week/)) {
    return doneAnswer(ctx);
  }
  if (has(/what did i (tick|take|do|eat)|yesterday|history|\brecord\b|streak|in a row|how many days|proof|did i (take|have|tick)|what time did i/)) return { type: "open", sheet: { k: "record" } };

  // screens that arrive in later build steps
  if (has(/exercise|workout|strength|movement|\bgym\b|sit.?to.?stand|push.?up/)) return data.exerciseSessions?.length ? hosted("move") : soon("Movement");
  if (has(/book (a |my |the )?(blood )?test|(next|blood|lab) test|retest|\blab slot|collection slot/) && !has(/result|report|level|range|normal/)) return hosted("labs");
  if (has(/check.?in/)) return hosted("checkin");
  if (has(/weight|weigh|blood pressure|\bbp\b/)) return { type: "open", sheet: { k: "vitals" } };
  if (has(/how long|how many weeks|programme|program\b|when does (it|this) end|which week|what week/)) {
    return card({ src: PLAN, heading: `Week ${data.client.week} of ${data.client.totalWeeks}`, lines: [`Your programme runs ${data.client.totalWeeks} weeks.`] });
  }
  if (has(/shopping|grocer|sabzi list|what (do|should) i (need to )?buy|\bsaman\b/)) return data.grocery?.weeks?.some((w) => w.items.length) ? hosted("grocery") : soon("Shopping list");
  if (has(/\bcook\b|maharaj|\bbai\b|kitchen/) && has(/send|bhej|share|list|sheet/)) return soon("Send to my cook");
  if (has(/reorder|re-order|running out|run out|ran out|refill|order (my |the |more )?(supplement|iron|magnesium|vitamin|capsule)/)) return { type: "open", sheet: { k: "order" } };

  // her meals
  if (has(/mehman|\bguests?\b|party at home|kya banau|what (should|do|can) i (cook|make)/)) {
    return card({
      src: PLAN,
      heading: "Today on your plan",
      lines: ["I can only show what your plan has for today. For cooking for guests, your coach can say what fits."],
      list: moments.filter((m) => m.kind === "meal").map((m) => ({ mark: "dot" as const, text: `${m.part}: ${m.title}` })),
      buttons: [
        { to: "day", label: "Your whole day" },
        { to: "coach", label: "Ask my coach", draft: q.trim() },
      ],
    });
  }
  if (has(/swap|instead|replace|substitute|don'?t (have|eat|like)|can'?t find|nahin? mil|not available|out of stock|bored|lighter|something else|change (my |the )?(meal|lunch|dinner|breakfast)|how much|how many roti|portion|quantity|katori|kitn/)) {
    return { type: "model" };
  }
  if (has(/(can i|may i|allowed|sakt|ok to|okay to|is it ok)/)) {
    const hits = dishOnMenu(s, data);
    if (hits.length) {
      return card({
        src: "From your menu",
        heading: "Yes, it is on your menu this week",
        lines: [],
        list: hits.slice(0, 3).map((h) => ({ mark: "yes" as const, text: `${h.dish} · ${h.where}` })),
        buttons: [{ to: "day", label: "Your whole day" }],
      });
    }
    if (!mealFor(s, moments)) return { type: "model" };
  }
  if (has(/tomorrow|\bkal\b/)) {
    const day = tomorrowSlots(data);
    if (!day) return card(coachCard("Tomorrow's meals are not in the app yet. Shall I ask your coach?"));
    const want = SLOTS.find(([ask]) => ask.test(s));
    const slots = want ? day.slots.filter((x) => want[1].test(x.slot)) : day.slots;
    if (slots.length === 0) return card(coachCard("I can't see that meal for tomorrow. Shall I ask your coach?"));
    return card({
      src: "From your menu",
      heading: want ? `${slots[0].slot} tomorrow` : `Tomorrow, ${day.dow}`,
      lines: want ? [slots[0].dish] : [],
      list: want ? undefined : slots.map((x) => ({ mark: "dot" as const, text: `${x.slot}: ${x.dish}` })),
    });
  }
  if (has(/this week|week.?s menu|weekly menu|whole week/)) return data.weekMenus?.length ? hosted("menu") : soon("This week's menu");
  const meal = mealFor(s, moments);
  if (meal) return card(mealCard(meal, data));
  if (has(/(aaj|today).*(khana|kya|menu|meals?|eat|food)|(eat|khana|khau|khaun).*(today|aaj)|today.?s (meals|menu|food)|whole day|all meals/)) {
    return card({
      src: PLAN,
      heading: "Today",
      lines: [],
      list: moments.filter((m) => m.kind === "meal").map((m) => ({ mark: "dot" as const, text: `${m.part}: ${m.title}` })),
      buttons: [{ to: "day", label: "Your whole day", solid: true }],
    });
  }
  if (has(/what (do|should) i (do|eat|take|have)( right)? (now|next)|what.?s next|right now|\babhi\b/)) {
    const next = nextMoment(moments, ticks, ctx.nowRank);
    if (!next) return card({ src: PLAN, heading: "Nothing more for today", lines: ["Everything from this part of the day on is ticked."], buttons: [{ to: "day", label: "Your whole day" }] });
    return card(next.kind === "meal" ? mealCard(next, data, `Next: ${next.part.toLowerCase()}`) : { src: PLAN, heading: `Next: ${next.title}`, lines: [next.sub].filter(Boolean), buttons: [{ to: "day", label: "Your whole day" }] });
  }
  if (has(/changed|new this week|what.?s new|different|update/)) {
    if (data.clientUpdateNote) return card({ src: PLAN, heading: "Your coach's latest note", lines: [data.clientUpdateNote] });
    if (data.travel) return card({ src: PLAN, heading: "Your coach has your dates", lines: [`Away from ${data.travel.from} to ${data.travel.to}. Anything that changes for those days comes from your coach.`], buttons: [{ to: "coach", label: "Message my coach" }] });
    return card(coachCard("I can't see a change note on your plan. Shall I ask your coach?"));
  }

  // 5. everything else
  return { type: "model" };
}

/**
 * The tappable questions under the box. Each one is answered on the phone, at
 * no cost: a test walks every chip this can return and fails if one would
 * reach the model.
 */
export function askChips(ctx: AskContext): string[] {
  const ahead = upcomingMoments(ctx.moments, ctx.ticks, ctx.nowRank);
  const nextMeal = ahead.find((m) => m.kind === "meal");
  const chips: string[] = [];
  if (nextMeal) {
    const part = nextMeal.part.toLowerCase();
    if (SLOTS.some(([ask]) => ask.test(part))) chips.push(`What's for ${part}?`);
  }
  chips.push("What is left today?");
  if (ctx.data.planRef?.eatingOut?.situations.length) chips.push("I'm eating out");
  const supp = dayRows(ctx.moments).find((r) => r.kind === "supp" && ctx.data.supplements.some((x) => x.id === r.id && (x.why || x.timing)));
  if (supp) chips.push(`Why ${supp.name.toLowerCase()}?`);
  if (ctx.data.coach.nextSession) chips.push("When is my next session?");
  chips.push("I feel stressed");
  return chips.slice(0, 4);
}
