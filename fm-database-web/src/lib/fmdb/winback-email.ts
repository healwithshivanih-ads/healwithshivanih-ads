/**
 * The three win-back emails, rendered from facts and nothing else.
 *
 * DELIBERATELY NOT A MODEL CALL. Every other client-facing letter in this tree
 * is authored by a person (or in chat) and gated by check-renewal-letter.mjs,
 * because the failure mode of generated prose here is a plausible number in a
 * letter to someone who has been tracking their own. A template that can only
 * interpolate values it was handed cannot invent one — the property is
 * structural rather than checked after the fact. It also costs nothing to run,
 * which matters for something that fires daily across the roster.
 *
 * The coach edits every draft before it goes. These are a good first sentence,
 * not a finished letter.
 *
 * VOICE follows docs/RENEWAL_LETTER_VOICE.md, whose every rule exists because
 * it was got wrong first: open with something true about them from their own
 * data; say what the plan was for and that it is finished; say what takes
 * longer; only then the price; close by asking for a call. No "I want to be
 * straight with you". Never name a held-back supplement. Never quote app-usage
 * statistics — "you opened it 23 of 28 days" reads as surveillance. ₹, not Rs.
 */

import { MAINTENANCE_PRICING, DEFAULT_MAINTENANCE_TERM_MONTHS } from "./maintenance-orders";
import type { WinbackTouchKind } from "./winback-drip";

/**
 * The token a price the coach has not yet supplied renders as.
 *
 * Chosen to be impossible to mistake for prose and impossible to miss in a
 * preview. `approveWinbackDraftAction` refuses any body still containing it —
 * the one thing that could otherwise reach a client looking obviously
 * automated. check-renewal-letter.mjs learned this the same way: the price
 * placeholder passed every other check, because it carries no digits to source
 * and no malformed number to reject.
 */
export const PRICE_PLACEHOLDER = "[ENTER PRICE]";

/**
 * The maintenance price, from the constant that actually charges the client.
 *
 * NOT a number typed into a letter. `MAINTENANCE_PRICING` is described in its
 * own module as "the ONLY way to change what a client is charged for the
 * one-time block", and it is what the Razorpay checkout will bill. Sourcing the
 * letter from it means the email and the payment page cannot disagree — which a
 * hand-typed figure absolutely can, and would only be discovered by the client.
 */
export function maintenancePriceInr(): number | null {
  return MAINTENANCE_PRICING[DEFAULT_MAINTENANCE_TERM_MONTHS] ?? null;
}

/** Indian digit grouping — ₹10,000 rather than ₹10000. */
export function formatInr(n: number): string {
  return `₹${n.toLocaleString("en-IN")}`;
}

/** The subset of renewal-brief.py's output these letters are allowed to use. */
export interface WinbackFacts {
  name: string;
  /** Plan length in weeks, when the plan carried one. */
  weeks: number | null;
  /** MSQ entries oldest-first: { week, total }. */
  msq: ReadonlyArray<{ week: number | null; total: number }>;
  /** Free-text goals as the coach recorded them. */
  goals: readonly string[];
  /** Active conditions as the coach recorded them. */
  conditions: readonly string[];
}

export interface RenderedWinback {
  subject: string;
  body: string;
}

const firstName = (name: string) => (name.trim().split(/\s+/)[0] || name).trim();

/**
 * One true sentence about them, drawn from their own recorded data.
 *
 * Returns null rather than a generic line when there is nothing real to say.
 * An opener that could have been sent to anybody is worse than starting with
 * the second paragraph, and it is the exact thing a client notices.
 */
function openingFromData(f: WinbackFacts): string | null {
  // The MSQ trend is the strongest thing available: their own score, twice.
  if (f.msq.length >= 2) {
    const first = f.msq[0];
    const last = f.msq[f.msq.length - 1];
    if (last.total < first.total) {
      return `When you started, your symptom score was ${first.total}. By the end it was ${last.total} — that is your own scoring, not mine.`;
    }
    if (last.total > first.total) {
      // Named honestly. "Name what has NOT moved" is the rule that earns the
      // rest of the letter.
      return `Your symptom score went from ${first.total} to ${last.total} over the programme. I would rather say that plainly than skip past it.`;
    }
    return `Your symptom score sat at ${first.total} at both ends of the programme — steady, but not the shift we were working towards.`;
  }
  if (f.goals.length > 0) {
    return `When we started, what you wanted was ${f.goals[0].trim().replace(/\.$/, "")}.`;
  }
  if (f.conditions.length > 0) {
    return `We spent your programme working on ${f.conditions[0].trim().replace(/\.$/, "")}.`;
  }
  return null;
}

const SIGN_OFF = "Shivani";

/**
 * Touch 1 — day 22. A check-in, not a sale.
 *
 * Carries no price, no offer and no link. Someone whose programme ended three
 * weeks ago and who has said nothing since may have drifted, or may have had a
 * hard month; the first thing back through the door should not be an invoice.
 */
function renderCheckIn(f: WinbackFacts): RenderedWinback {
  const fn = firstName(f.name);
  const opener = openingFromData(f);
  const lines = [
    `Hi ${fn},`,
    "",
    opener
      ? `${opener}\n\nYour programme with me finished a few weeks ago, and I have not heard from you since — so this is me checking in as a person rather than as your coach.`
      : `Your programme with me finished a few weeks ago and I have not heard from you since, so this is me checking in.`,
    "",
    "How are you doing? I am genuinely asking — not about adherence, just how you are. If things have slipped, that is completely normal after a programme ends and it is not something you need to explain or apologise for.",
    "",
    "If you would like to tell me how it is going, reply to this and let me know — or give me a call and we can talk it through properly.",
    "",
    SIGN_OFF,
  ];
  return { subject: `How are you doing, ${fn}?`, body: lines.join("\n") };
}

/**
 * Touch 2 — day 32. The only touch that makes the full offer.
 *
 * Structure is the renewal letter's: something true about them, what the plan
 * was for, what takes longer and why, THEN the price, then a call. The
 * maintenance option is named alongside the full programme rather than held
 * back for touch 3, because "or something lighter" is what makes the bigger
 * ask answerable instead of just declinable.
 */
function renderOffer(f: WinbackFacts, renewalPriceInr: number | null): RenderedWinback {
  const fn = firstName(f.name);
  const opener = openingFromData(f);
  const maint = maintenancePriceInr();
  const weeksLine = f.weeks
    ? `Your programme ran ${f.weeks} weeks, and it did what a first phase is meant to do: find what your body responds to.`
    : `Your first phase did what a first phase is meant to do: find what your body responds to.`;

  const price = renewalPriceInr !== null ? formatInr(renewalPriceInr) : PRICE_PLACEHOLDER;
  const maintLine =
    maint !== null
      ? `If a full phase is more than you want to take on right now, there is a lighter option: ${formatInr(maint)} for ${DEFAULT_MAINTENANCE_TERM_MONTHS} months of maintenance — your recipes, your plan and check-ins with me, without a new protocol to follow.`
      : `If a full phase is more than you want to take on right now, there is a lighter maintenance option — ask me and I will explain how it works.`;

  const lines = [
    `Hi ${fn},`,
    "",
    opener ?? `I have been thinking about where your programme got to.`,
    "",
    weeksLine,
    "",
    "What I would want for a second phase is the part that takes longer than one programme can give you — the changes that only show up when something has been in place for months rather than weeks. That is not a reflection on how you did it. It is simply how this works.",
    "",
    `A next phase is ${price}.`,
    "",
    maintLine,
    "",
    "If either sounds right, give me a call and we can work out which one actually fits your year. If neither does, tell me that too — I would rather know.",
    "",
    SIGN_OFF,
  ];
  return { subject: `${fn} — what a second phase would look like`, body: lines.join("\n") };
}

/**
 * Touch 3 — day 42. The last one, and the door held open rather than pushed.
 *
 * Drops the full programme entirely. A third ask at the same price is a chase,
 * and the point of a final touch is to leave the relationship somewhere good
 * whether or not they come back.
 */
function renderMaintenance(f: WinbackFacts): RenderedWinback {
  const fn = firstName(f.name);
  const maint = maintenancePriceInr();
  const maintLine =
    maint !== null
      ? `The lighter option stays open: ${formatInr(maint)} for ${DEFAULT_MAINTENANCE_TERM_MONTHS} months, which keeps your recipes and your plan live and gives you check-ins with me. No new protocol.`
      : `The lighter maintenance option stays open — it keeps your recipes and plan live, with check-ins, and no new protocol.`;

  const lines = [
    `Hi ${fn},`,
    "",
    "This is the last you will hear from me about coming back — I am not going to keep asking.",
    "",
    "Your app stays yours either way. Your recipes, your plan and your keepsake do not expire, and you can open them whenever you want them.",
    "",
    maintLine,
    "",
    "If you would rather leave it here, that is a completely fine answer and you do not need to reply to say so. And if you want to pick it up in six months, call me then — I will still be here.",
    "",
    SIGN_OFF,
  ];
  return { subject: `Leaving the door open, ${fn}`, body: lines.join("\n") };
}

/**
 * Render one touch.
 *
 * `renewalPriceInr` is only consulted by touch 2. Passing null there yields the
 * placeholder, which the approval action refuses — so the price is a required
 * coach input at review time rather than a number this file could guess.
 */
export function renderWinbackEmail(
  kind: WinbackTouchKind,
  facts: WinbackFacts,
  renewalPriceInr: number | null,
): RenderedWinback {
  switch (kind) {
    case "check_in":
      return renderCheckIn(facts);
    case "offer":
      return renderOffer(facts, renewalPriceInr);
    case "maintenance":
      return renderMaintenance(facts);
  }
}
