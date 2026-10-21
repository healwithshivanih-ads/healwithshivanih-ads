/**
 * "Thought of you" notes — the slow track for prospects who have gone quiet.
 *
 * When a new video or guide goes live that matches what a quiet prospect told
 * us they care about, draft ONE short note pointing them to it. No price, no
 * pitch: it gives, it does not ask. The call follow-up (discovery-followup.ts)
 * is the track that asks.
 *
 * Coach decisions (2026-10-21): drafts only, email only, at most one note per
 * person per 30 days, only after the call follow-up has finished, and never to
 * anyone stopped, declined, signed up or opted out. Every note carries an
 * opt-out line; "Stop these" on the dashboard sets client.yaml#marketing_opt_out.
 *
 * Pure: no I/O, no clock.
 */

import type { ContentItem } from "./content-library";

/** Days between any two content emails to the same person. */
export const NOTE_GAP_DAYS = 30;
/** How recently an item must have gone live to count as "new". */
export const NEW_ITEM_WINDOW_DAYS = 21;
/** A message from them this recent means: reply personally, don't automate. */
export const NOTE_LIVE_CONVERSATION_DAYS = 7;
/** People quiet for longer than this are left alone entirely. */
export const NOTE_MAX_QUIET_DAYS = 365;

export const OPT_OUT_LINE = "If you'd rather not get notes like this, just reply \"no more\" and I'll stop.";

export interface NoteDecisionInput {
  todayYmd: string;
  engagementStatus: string | null;
  hasPlan: boolean;
  hasEmail: boolean;
  optedOut: boolean;
  /** The coach pressed Stop on their call follow-up. */
  followupStopped: boolean;
  /** Their call follow-up still has touches to come (or a draft waiting). */
  followupRunning: boolean;
  /** YYYY-MM-DD of the last email we sent them that carried content or a note. */
  lastContentEmailOn: string | null;
  /** A note draft is already waiting for approval. */
  notePending: boolean;
  /** YYYY-MM-DD of their last message to us. */
  lastInboundOn: string | null;
  /** YYYY-MM-DD of the newest thing we know about them (interest, session, booking). */
  lastActivityOn: string | null;
  /** The new item that matches them, if any (newlyLiveFor). */
  item: ContentItem | null;
}

export type NoteDecision = { draft: false; reason: string } | { draft: true; item: ContentItem; reason: string };

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
}

/** Should a "thought of you" note be drafted for this person today? */
export function noteDecision(i: NoteDecisionInput): NoteDecision {
  const es = (i.engagementStatus ?? "").trim();
  if (es === "signed_up") return { draft: false, reason: "signed up — client care, not content notes" };
  if (es === "declined") return { draft: false, reason: "declined — leaving them alone" };
  if (es !== "" && es !== "pending") return { draft: false, reason: `engagement "${es}" — leaving alone` };
  if (i.hasPlan) return { draft: false, reason: "has a plan" };
  if (i.optedOut) return { draft: false, reason: "asked not to get these notes" };
  if (i.followupStopped) return { draft: false, reason: "you stopped their follow-up" };
  if (!i.hasEmail) return { draft: false, reason: "no email address" };
  if (i.followupRunning) return { draft: false, reason: "call follow-up still running — this waits until it ends" };
  if (i.notePending) return { draft: false, reason: "a note is already waiting for you" };
  if (i.lastInboundOn && daysBetween(i.lastInboundOn, i.todayYmd) < NOTE_LIVE_CONVERSATION_DAYS) {
    return { draft: false, reason: `they messaged on ${i.lastInboundOn} — reply personally` };
  }
  if (i.lastContentEmailOn && daysBetween(i.lastContentEmailOn, i.todayYmd) < NOTE_GAP_DAYS) {
    return { draft: false, reason: `last emailed ${i.lastContentEmailOn} — at most one note a month` };
  }
  if (!i.lastActivityOn || daysBetween(i.lastActivityOn, i.todayYmd) > NOTE_MAX_QUIET_DAYS) {
    return { draft: false, reason: "no contact in over a year" };
  }
  if (!i.item) return { draft: false, reason: "nothing new that matches their concerns" };
  return { draft: true, item: i.item, reason: `new ${i.item.kind} "${i.item.title}" matches` };
}

export interface NoteEmail {
  subject: string;
  body: string;
}

/** The note itself — short, warm, no price, opt-out at the foot. */
export function renderNoteEmail(firstName: string, item: ContentItem): NoteEmail {
  const what = item.kind === "guide" ? "guide" : "video";
  return {
    subject: item.kind === "guide" ? "A guide I thought you'd find useful" : "A video I thought you'd find useful",
    body: [
      `Hi ${firstName},`,
      `I've just put out a new ${what} and thought of you: ${item.line}\n${item.url}`,
      "No need to reply, but if it raises any questions, I'm always happy to hear them.",
      "Warmly,\nShivani",
      `—\n${OPT_OUT_LINE}`,
    ].join("\n\n"),
  };
}

export interface NoteGateResult {
  ok: boolean;
  refuse: string[];
}

/**
 * Checked over what the coach has on screen at approval. A note gives; it
 * never sells — so no price, no credit, no call pitch — and it always keeps a
 * way out.
 */
export function checkNoteEmail(subject: string, body: string): NoteGateResult {
  const refuse: string[] = [];
  const all = `${subject}\n${body}`;
  if (!subject.trim()) refuse.push("the subject is empty");
  if (!body.trim()) refuse.push("the email is empty");
  if (/\[[^\]]*\]|\{\{/.test(all)) refuse.push("there is an unfilled [bracket] or {{placeholder}}");
  if (/₹|\brs\.?\s?\d|\bcredit\b|\bdiscount\b/i.test(all)) refuse.push("a content note carries no price, credit or offer");
  if (/free call|free discovery/i.test(all)) refuse.push("never call the call free");
  if (!/no more|unsubscribe|rather not (get|hear)/i.test(body)) refuse.push("keep the line that lets them opt out");
  if (body.length > 1500) refuse.push("keep the note short (under 1,500 characters)");
  return { ok: refuse.length === 0, refuse };
}
