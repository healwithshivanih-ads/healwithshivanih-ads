/**
 * Weekly-poll button-label classifier.
 *
 * Pure helper — lives outside `"use server"` so it can be imported from any
 * runtime (server route, server action, client component without dynamic
 * import). See lib/server-actions/weekly-poll.ts for the async actions that
 * send polls + scan for adherence drops.
 *
 * The label set mirrors what the coach has registered as interactive reply
 * buttons in WhatsApp templates. Five Pillars rotation templates added
 * 2026-05-24 (Tier 1): fm_weekly_sleep_v1, fm_weekly_stress_v1,
 * fm_weekly_connection_v1 — plus existing fm_weekly_meals_v1 (nutrition) and
 * fm_weekly_movement_v1 (movement). The adherence-only campaigns
 * (fm_weekly_check_in_v1, fm_weekly_supplement_v1) stay for coach-initiated
 * deep dives but are NOT part of the rotation.
 */

export type PollDimension =
  | "overall"
  | "supplements"
  | "meals"
  | "movement"
  | "sleep"
  | "stress"
  | "connection";

export type PollScore = "good" | "partial" | "struggling";

export interface PollLabel {
  match: string;
  dim: PollDimension;
  score: PollScore;
}

export const POLL_BUTTON_LABELS: PollLabel[] = [
  // overall (legacy adherence campaign — kept for deep-dive use)
  { match: "all good", dim: "overall", score: "good" },
  { match: "some struggles", dim: "overall", score: "partial" },
  { match: "need help", dim: "overall", score: "struggling" },
  // supplements (adherence, not a pillar)
  { match: "all taken", dim: "supplements", score: "good" },
  { match: "missed 1-2", dim: "supplements", score: "partial" },
  { match: "missed 1", dim: "supplements", score: "partial" },
  { match: "stopped", dim: "supplements", score: "struggling" },
  // meals → nutrition pillar
  { match: "yes mostly", dim: "meals", score: "good" },
  { match: "half the time", dim: "meals", score: "partial" },
  // movement
  { match: "most days", dim: "movement", score: "good" },
  { match: "a few times", dim: "movement", score: "partial" },
  { match: "none", dim: "movement", score: "struggling" },
  // sleep
  { match: "sleeping well", dim: "sleep", score: "good" },
  { match: "some restless", dim: "sleep", score: "partial" },
  { match: "struggling to sleep", dim: "sleep", score: "struggling" },
  // stress — INVERTED relative to felt experience: "Manageable" is good
  // (low stress), "Overwhelming" is struggling (high stress). The score
  // here is the wellness reading, NOT the stress level — same convention
  // as FivePillarsAssessment.stress where higher = healthier.
  { match: "manageable", dim: "stress", score: "good" },
  { match: "some pressure", dim: "stress", score: "partial" },
  { match: "overwhelming", dim: "stress", score: "struggling" },
  // connection
  { match: "connected", dim: "connection", score: "good" },
  { match: "some of the time", dim: "connection", score: "partial" },
  { match: "disconnected", dim: "connection", score: "struggling" },
  // GENERIC last-resort matches — must come AFTER specific matches because
  // .includes() returns the first hit. "struggling" alone is ambiguous —
  // any pillar template can produce it. The webhook flow uses
  // classifyPollReply alongside the most-recent outbound campaign to
  // disambiguate (see weekly-poll.ts > inferPillarFromReply).
  { match: "struggling", dim: "meals", score: "struggling" },
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

/** Map a poll dimension to the canonical Five Pillars key. Returns null
 *  for non-pillar dimensions (overall / supplements). Used by the webhook
 *  to decide whether to also update client.derived_five_pillars. */
export type PillarKey = "sleep" | "stress" | "movement" | "nutrition" | "connection";

export function pillarFromDimension(dim: PollDimension): PillarKey | null {
  if (dim === "sleep") return "sleep";
  if (dim === "stress") return "stress";
  if (dim === "movement") return "movement";
  if (dim === "meals") return "nutrition";
  if (dim === "connection") return "connection";
  return null; // overall, supplements — adherence signals, not pillars
}

/** Score → 1-5 scale matching FivePillarsAssessment fields. The buttons
 *  are 3-way; we map good=5, partial=3, struggling=2 (low-but-not-floor so
 *  the trend line still has room to go either way). */
export function scoreToPillarRating(score: PollScore): number {
  if (score === "good") return 5;
  if (score === "partial") return 3;
  return 2;
}

/** The Tier 1 rotating-poll sequence (added 2026-05-24). One pillar per
 *  week per client. After a full 5-week cycle every client has a fresh
 *  Five Pillars snapshot inferred from their poll taps. */
export const PILLAR_ROTATION: PillarKey[] = [
  "sleep",
  "stress",
  "movement",
  "nutrition",
  "connection",
];

/** Pillar → WA template name. Reuses existing meals/movement templates
 *  + the three new sleep/stress/connection templates submitted via
 *  whatsapp-server/scripts/submit-templates.js on 2026-05-24. */
export function pillarToTemplateName(pillar: PillarKey): string {
  switch (pillar) {
    case "sleep": return "fm_weekly_sleep_v1";
    case "stress": return "fm_weekly_stress_v1";
    case "movement": return "fm_weekly_movement_v1";
    case "nutrition": return "fm_weekly_meals_v1";
    case "connection": return "fm_weekly_connection_v1";
  }
}
