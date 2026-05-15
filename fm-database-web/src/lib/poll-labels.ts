/**
 * Weekly-poll button-label classifier.
 *
 * Pure helper — lives outside `"use server"` so it can be imported from any
 * runtime (server route, server action, client component without dynamic
 * import). See lib/server-actions/weekly-poll.ts for the async actions that
 * send polls + scan for adherence drops.
 *
 * The label set mirrors what the coach has registered as interactive reply
 * buttons in WhatsApp templates: fm_weekly_check_in_v1, fm_weekly_supplement_v1,
 * fm_weekly_meals_v1, fm_weekly_movement_v1.
 */

export type PollDimension = "overall" | "supplements" | "meals" | "movement";
export type PollScore = "good" | "partial" | "struggling";

export interface PollLabel {
  match: string;
  dim: PollDimension;
  score: PollScore;
}

export const POLL_BUTTON_LABELS: PollLabel[] = [
  // overall
  { match: "all good", dim: "overall", score: "good" },
  { match: "some struggles", dim: "overall", score: "partial" },
  { match: "need help", dim: "overall", score: "struggling" },
  // supplements
  { match: "all taken", dim: "supplements", score: "good" },
  { match: "missed 1-2", dim: "supplements", score: "partial" },
  { match: "missed 1", dim: "supplements", score: "partial" },
  { match: "stopped", dim: "supplements", score: "struggling" },
  // meals
  { match: "yes mostly", dim: "meals", score: "good" },
  { match: "half the time", dim: "meals", score: "partial" },
  { match: "struggling", dim: "meals", score: "struggling" },
  // movement
  { match: "most days", dim: "movement", score: "good" },
  { match: "a few times", dim: "movement", score: "partial" },
  { match: "none", dim: "movement", score: "struggling" },
];

export function classifyPollReply(
  text: string,
): { dim: PollDimension; score: PollScore } | null {
  const t = (text || "").toLowerCase().trim();
  if (!t) return null;
  for (const lbl of POLL_BUTTON_LABELS) {
    if (t.includes(lbl.match)) return { dim: lbl.dim, score: lbl.score };
  }
  return null;
}
