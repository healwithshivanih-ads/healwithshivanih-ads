/**
 * THE ANSWER CARD — the one shape every ask-box answer takes, whether it came
 * from a fixed safety rule, a plan lookup on the phone, or the model.
 *
 * Shared by the phone and the server. The model never writes free text to the
 * client: it returns this card as JSON, `parseModelCard` checks every field,
 * and anything it cannot vouch for becomes "defer" (hand to the coach).
 */

import { HANDOFF_COPY, URGENT_COPY, type HandoffKind, type UrgentKind } from "./ask-safety";

/** Where a button on a card may lead. A fixed list: the model picks from the
 *  MODEL_BUTTONS subset and cannot invent a destination. */
export type AskTarget = "day" | "record" | "recipe" | "start" | "eatout" | "practice" | "practices" | "coach" | "soon";

export interface AskButton {
  to: AskTarget;
  label: string;
  /** recipe: the menu slot; practice: its id; soon: the screen's title */
  ref?: string;
  /** coach: words to put in the message box, for her to edit and send */
  draft?: string;
  solid?: boolean;
}

export interface AskListItem {
  /** yes = a tick, no = a cross, dot = neither (a plain list) */
  mark: "yes" | "no" | "dot";
  text: string;
}

export interface AskCard {
  tone?: "urgent";
  /** the small line over the card: where the answer came from */
  src: string;
  heading?: string;
  lines: string[];
  list?: AskListItem[];
  note?: string;
  buttons?: AskButton[];
  /** true when the card offers to send the question to the coach */
  handoff?: boolean;
  /** questions she may tap next; each must be answerable without the model */
  followUps?: string[];
}

export function urgentCard(kind: UrgentKind): AskCard {
  const c = URGENT_COPY[kind];
  return {
    tone: "urgent",
    src: c.src,
    heading: c.heading,
    lines: c.lines,
    // The self-harm card offers the coach; the emergency card offers nothing
    // that could slow down a call for help.
    buttons: kind === "selfharm" ? [{ to: "coach", label: "Message my coach", draft: "I need to talk." }] : [],
  };
}

/** A question the coach answers personally. */
export function coachCard(line: string, note?: string, heading?: string): AskCard {
  return { src: "One for your coach", heading, lines: [line], note, handoff: true };
}

export function handoffCard(kind: HandoffKind): AskCard {
  const c = HANDOFF_COPY[kind];
  return coachCard(c.line, c.note);
}

/** Shown when the model, the network or the daily limit gives no answer. */
export const NO_ANSWER_CARD: AskCard = coachCard(
  "I don't have an answer to that in your plan. Shall I pass it to your coach?",
);

// ── the model's card ───────────────────────────────────────────────────────

/** The only buttons the model may put on a card. */
export const MODEL_BUTTONS = {
  day: "Your whole day",
  record: "Your record",
  practices: "Open Practices",
  coach: "Message my coach",
} as const satisfies Partial<Record<AskTarget, string>>;
export type ModelButton = keyof typeof MODEL_BUTTONS;

export type ModelVerdict =
  | { verdict: "answer"; card: AskCard }
  | { verdict: "defer" }
  | { verdict: "emergency" }
  | { verdict: "selfharm" };

const MAX_LINES = 3;
const MAX_BUTTONS = 2;
const MAX_HEADING = 80;
const MAX_LINE = 240;

const clean = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

/**
 * Read what the model sent. Fails towards the coach: anything that is not a
 * well-formed card — bad JSON, no lines, a line too long, the coach's name —
 * is "defer", never shown.
 */
export function parseModelCard(raw: unknown): ModelVerdict {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return { verdict: "defer" };
  // The single words are honoured wherever they appear on their own: older
  // prompt wording, or a model that skipped the JSON.
  const bare = text.toUpperCase().replace(/[^A-Z]/g, "");
  if (bare === "EMERGENCY") return { verdict: "emergency" };
  if (bare === "SELFHARM") return { verdict: "selfharm" };
  if (bare === "DEFER") return { verdict: "defer" };

  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return { verdict: "defer" };
  let obj: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(text.slice(a, b + 1));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { verdict: "defer" };
    obj = parsed as Record<string, unknown>;
  } catch {
    return { verdict: "defer" };
  }

  const verdict = clean(obj.verdict).toLowerCase();
  if (verdict === "emergency") return { verdict: "emergency" };
  if (verdict === "selfharm" || verdict === "self_harm" || verdict === "self-harm") return { verdict: "selfharm" };
  if (verdict !== "answer") return { verdict: "defer" };

  const heading = clean(obj.heading);
  // A fourth line is dropped, not a reason to throw the answer away.
  const lines = (Array.isArray(obj.lines) ? obj.lines.map(clean).filter(Boolean) : []).slice(0, MAX_LINES);
  if (lines.length === 0) return { verdict: "defer" };
  if (heading.length > MAX_HEADING || lines.some((l) => l.length > MAX_LINE)) return { verdict: "defer" };
  const all = [heading, ...lines].join(" ");
  // Copy rule: the app says "your coach", never the coach's name. And the two
  // words that mean "do not answer" must never leak into an answer.
  if (/shivani/i.test(all) || /\b(DEFER|EMERGENCY|SELFHARM)\b/.test(all)) return { verdict: "defer" };

  const picked = Array.isArray(obj.buttons) ? obj.buttons.map(clean) : [];
  const buttons: AskButton[] = [];
  for (const key of picked) {
    if (buttons.length >= MAX_BUTTONS) break;
    if (!(key in MODEL_BUTTONS) || buttons.some((x) => x.to === key)) continue;
    buttons.push({ to: key as ModelButton, label: MODEL_BUTTONS[key as ModelButton] });
  }

  return {
    verdict: "answer",
    card: { src: "From your plan", heading: heading || undefined, lines, buttons },
  };
}
