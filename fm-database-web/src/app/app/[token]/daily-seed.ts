/**
 * Today's seed — one line that is different every day, gone tomorrow.
 *
 * The daily-return hook from the 2026-08-05 audit: the app had nothing that
 * changed day to day except the menu, so there was no reason to open it "just
 * to see". The seed is deliberately small — a thought, not a task. It asks for
 * nothing, ticks nothing, and can't be dismissed because it doesn't nag.
 *
 * Pool = the client's OWN mind-body material first (inquiry questions and
 * reframes — already gated server-side by her depth setting, so nothing
 * sensitive can leak through this path), padded with evergreen lines in the
 * house voice: warm, food-first, never clinical, never a claim. Selection is
 * a deterministic hash of (clientId, date) so the same client sees the same
 * seed all day on every device, and a different one tomorrow.
 */

import type { AppMindBodyRead } from "@/lib/fmdb/somatic";

/** Evergreen seeds — house voice. Statements to sit with, not instructions. */
const EVERGREEN: string[] = [
  "Digestion begins before the first bite — arrive at one meal today.",
  "Warm food, warm water, warm company. The body counts all three.",
  "The breath you lengthen on the way out is the one that settles you.",
  "Hunger that comes on slowly is information. Hunger that comes on suddenly is usually something else.",
  "A ten-minute walk after a meal is the quietest medicine you own.",
  "Your body keeps every promise you keep to it.",
  "Rest is not the absence of progress.",
  "The plate is half vegetables because the day is half maintenance.",
  "One thing done gently beats three things done tensely.",
  "Sunlight before screens, most mornings you can manage it.",
  "Chew like you have time. You do.",
  "The evening starts winding down whenever you decide it does.",
  "Thirst wears many disguises. Offer water first.",
  "What you eat between Monday and Friday matters more than what you eat on your birthday.",
  "A craving observed for ninety seconds often finishes its speech and leaves.",
  "Steady is a speed.",
  "The gut likes rhythm more than rules — same meal times, most days.",
  "Tension you name is tension that has started to leave.",
  "Tomorrow's energy is mostly decided by tonight's last hour.",
  "Small portions of everything at a festival is still your plan, working.",
  "You are allowed to sit down to drink your tea.",
  "The second helping tastes like the first one. Wait five minutes and ask again.",
  "Feet on the floor, three slow breaths, then the phone.",
  "Nothing about today has to be perfect to count.",
];

export interface DailySeed {
  text: string;
  /** where it came from — the card renders questions slightly differently */
  kind: "question" | "line";
}

/** Deterministic 32-bit string hash (FNV-1a). */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * The seed for (client, local day). Client-specific material appears roughly
 * one day in three when it exists — often enough to feel personal, rare
 * enough that a reflective question never becomes wallpaper.
 */
export function dailySeed(clientId: string, dateIso: string, reads: AppMindBodyRead[]): DailySeed {
  const personal: DailySeed[] = [];
  for (const r of reads) {
    if (r.question) personal.push({ text: r.question, kind: "question" });
    if (r.reframe) personal.push({ text: r.reframe, kind: "line" });
  }
  const h = hash(`${clientId}|${dateIso}`);
  if (personal.length > 0 && h % 3 === 0) {
    return personal[Math.floor(h / 3) % personal.length];
  }
  return { text: EVERGREEN[h % EVERGREEN.length], kind: "line" };
}
