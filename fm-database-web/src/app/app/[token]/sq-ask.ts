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
 * Deliberately NOT answered here, though the prototype did: tea and coffee,
 * eating out, swaps, portions, "can I eat X". The prototype's answers were
 * written for one demo client. In the real app they depend on each client's
 * own food list, so they go to the model with her plan in front of it.
 *
 * Screens that arrive in later build steps (shopping list, check-in, weight,
 * reorder, the week's menu) open the "not built yet" sheet for now; only the
 * test account sees the new front until they are built.
 */

import type { AppSupplement, AppTickDay, ClientAppData } from "@/lib/fmdb/client-app";
import { coachCard, handoffCard, urgentCard, type AskCard } from "@/lib/fmdb/ask-card";
import { REPLY_LINE, askHandoff, askUrgent, dropSupplementForms, normalizeAsk } from "@/lib/fmdb/ask-safety";
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
const PLAN = "From your plan";
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

// ── the router ─────────────────────────────────────────────────────────────

const TRAVEL = /travel|\btrip\b|flight|flying|abroad|out of (town|station)|on tour|hotel|airport|jet ?lag|buffet|wedding|shaadi|restaurant|eating out|eat out|(client|business|office|team) (dinner|lunch)|(dinner|lunch) out|italian|chinese|pizza|takeaway|order in|swiggy|zomato/;

const PRACTICE =
  /stress|anxious|anxiety|overwhelm|panic|tense\b|nervous|worr|racing|overthink|(mind|brain|head|thoughts?) (off|won'?t|wont|will not|doesn'?t|is so|is too|keeps?)|can'?t (relax|unwind|settle|calm|switch)|hot flush|hot flash|flush|irritab|angry|anger|furious|snapping|short fuse|upset|feeling low|low today|sleep|woke|awake|\b3 ?am\b|insomnia|neend|soaked|night sweat|wind.?down|calm|relax|breathing|breath ?work|tapping|\beft\b|somatic|body reset|meditat|wired|restless|don'?t have (five|5|time)|no time|one minute/;

export function routeAsk(q: string, ctx: AskContext): AskResult {
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
  if (has(/where (do|should) i (start|begin)|how (do|should) i (start|begin)|start here|getting started|new here|first day|do i (have|need) to do (all|everything)|is (all|everything) (of this )?(compulsory|necessary|mandatory)|too much to do|what is (the|this|that) (ring|circle|logo)|what are (the|these) rings|how does (this|the) app work/)) {
    return { type: "open", sheet: { k: "start" } };
  }
  if (has(/(tell|message|msg|talk to|speak to|write to|call) (my |the |your )?coach/)) return { type: "tab", tab: "coach" };

  // 3. the coach answers these personally
  const handoff = askHandoff(q);
  if (handoff) return card(handoffCard(handoff));
  if (has(/(shift|change|move|adjust|push).{0,24}(time|timing)|eat (breakfast|lunch|dinner) at \d|(late|night|early) shift/)) {
    return card(coachCard("Changing when you eat or take things is your coach's call. Send this to your coach?"));
  }

  // 4. plan lookups
  // Anything about being away from home uses the detail in the question, so
  // it goes to the model rather than to a card that ignores it.
  if (has(TRAVEL)) return { type: "model" };

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
  if (has(PRACTICE)) {
    const mine = data.practices.filter((p) => p.kind === "daily").slice(0, 3);
    return card({
      src: PLAN,
      heading: "Let's slow things down",
      lines: ["Your practices are in the Practices tab. Pick whichever suits the moment."],
      list: mine.map((p) => ({ mark: "dot" as const, text: p.name.split(" — ")[0] })),
      note: "Your coach would want to hear about this, whenever you like.",
      buttons: [
        { to: "practices", label: "Open Practices", solid: true },
        { to: "coach", label: "Tell my coach", draft: q.trim() },
      ],
    });
  }
  if (has(/\bi feel\b|feeling|failed|guilty|ashamed|\bsad\b|crying|lonely/)) {
    return card(coachCard("That sounds heavy. I can send this to your coach, and you don't have to do anything else today."));
  }
  if (has(/ruined|lost (all )?(my )?progress|wasted|back to (zero|square)/)) {
    return card({ src: PLAN, heading: "You pick up from today", lines: [`Nothing here has expired. Today is week ${data.client.week}, and your plan is where you left it.`], buttons: [{ to: "day", label: "Your whole day", solid: true }] });
  }
  if (has(/fell off|fallen off|restart|start (it |this |the |my |all |over|.{0,24})?again|start over|from (day|week) (1|one)|from scratch|gave up|\bbehind\b|been away|was away|ease me/)) {
    return card({ src: PLAN, heading: "You start from today", lines: ["Nothing is waiting for you. Today's plan is the whole of it."], buttons: [{ to: "day", label: "Your whole day", solid: true }] });
  }
  if (has(/undo|by mistake|untick|un-tick|wrongly|accident/)) {
    return card({ src: "How it works", heading: "Tap the tick again to clear it", lines: ["Open your whole day. Every meal and every supplement has its own tick."], buttons: [{ to: "day", label: "Open my whole day", solid: true }] });
  }

  // her ticks and her record
  if (has(/what.?s left|what is left|left to (tick|do|take)|still (to|have to) (tick|do|take)|remaining|baaki|pending/)) return leftAnswer(ctx);
  if (has(/(tick|ticked|done|taken|took|take).*(today|so far)|how many.*(done|ticked)|what (have|did) i (tick|ticked|done|taken)/) && !has(/yesterday|last week/)) {
    return doneAnswer(ctx);
  }
  if (has(/what did i (tick|take|do|eat)|yesterday|history|\brecord\b|streak|in a row|how many days|proof/)) return { type: "open", sheet: { k: "record" } };

  // screens that arrive in later build steps
  if (has(/exercise|workout|strength|movement|\bgym\b|sit.?to.?stand|push.?up/)) return soon("Movement");
  if (has(/check.?in/)) return soon("Your check-in");
  if (has(/weight|weigh|blood pressure|\bbp\b/)) return soon("Weight and blood pressure");
  if (has(/how long|how many weeks|programme|program\b|when does (it|this) end|which week|what week/)) {
    return card({ src: PLAN, heading: `Week ${data.client.week} of ${data.client.totalWeeks}`, lines: [`Your programme runs ${data.client.totalWeeks} weeks.`] });
  }
  if (has(/shopping|grocer|sabzi list|what (do|should) i (need to )?buy|\bsaman\b/)) return soon("Shopping list");
  if (has(/\bcook\b|maharaj|\bbai\b|kitchen/) && has(/send|bhej|share|list|sheet/)) return soon("Send to my cook");
  if (has(/reorder|re-order|running out|run out|ran out|refill|order (my |the |more )?(supplement|iron|magnesium|vitamin|capsule)/)) return soon("Order supplements");

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
  if (has(/this week|week.?s menu|weekly menu|whole week/)) return soon("This week's menu");
  const meal = mealFor(s, moments);
  if (meal) return card(mealCard(meal, data));
  if (has(/(aaj|today).*(khana|kya|menu|meals?|eat|food)|today.?s (meals|menu|food)|whole day|all meals/)) {
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
    if (data.clientUpdateNote) return card({ src: "From your coach", heading: "Your coach's latest note", lines: [data.clientUpdateNote] });
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
  const supp = dayRows(ctx.moments).find((r) => r.kind === "supp" && ctx.data.supplements.some((x) => x.id === r.id && (x.why || x.timing)));
  if (supp) chips.push(`Why ${supp.name.toLowerCase()}?`);
  if (ctx.data.coach.nextSession) chips.push("When is my next session?");
  chips.push("I feel stressed");
  return chips.slice(0, 4);
}
