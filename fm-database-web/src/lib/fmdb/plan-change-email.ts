/**
 * plan-change-email — render material plan changes as a client email.
 *
 * Brand rules this file exists to enforce, all of them learned the hard way:
 *   - Warm, plain English. No grams-as-jargon, no labs, no mechanism, no
 *     evidence hedging. The client surface is not the coach surface.
 *   - Points AT the app rather than restating the plan. They already have the
 *     live plan; a second copy in an inbox is a second source of truth that
 *     drifts the moment the plan is edited again.
 *   - Always an opt-out line. The plan is a conversation, not a prescription.
 *   - A stop always carries the coach's reason.
 *
 * Pure — no disk, no network — so the copy is testable.
 */

import type { MaterialChange } from "./plan-change-diff";

export interface PlanChangeEmail {
  subject: string;
  /** Plain-text body. The existing pending-sends dispatcher sends text. */
  body: string;
}

function firstName(displayName: string): string {
  return displayName.trim().split(/\s+/)[0] || "there";
}

/** One client-readable line per change. */
function line(c: MaterialChange): string {
  switch (c.kind) {
    case "supplement_added": {
      const bits = [c.dose, c.timing].map((s) => (s ?? "").trim()).filter(Boolean);
      return bits.length
        ? `• ${c.label} — ${bits.join(", ")}.`
        : `• ${c.label} — details are in your app.`;
    }
    case "supplement_dose_changed":
      return `• ${c.label} — the amount has changed to ${c.to}.`;
    case "supplement_timing_changed":
      return `• ${c.label} — take this at a different time now: ${c.to}.`;
    case "supplement_stopped":
      return `• ${c.label} — you can stop this one.`;
    case "practice_added":
      return `• ${c.label}`;
    case "practice_stopped":
      return `• ${c.label} — you can let this one go.`;
  }
}

function heading(changes: MaterialChange[]): string {
  const stops = changes.filter(
    (c) => c.kind === "supplement_stopped" || c.kind === "practice_stopped",
  ).length;
  const adds = changes.filter(
    (c) => c.kind === "supplement_added" || c.kind === "practice_added",
  ).length;
  const tweaks = changes.length - stops - adds;

  if (changes.length === 1) {
    if (stops === 1) return "A small update — one thing to stop";
    if (adds === 1) return "A small update to your plan — one new thing";
    return "A small update to your plan";
  }
  if (stops > 0 && adds === 0 && tweaks === 0) return "A small update — a couple of things to stop";
  return "A few small updates to your plan";
}

/**
 * Build the email. `reason` is the coach's own words and is REQUIRED whenever
 * anything is being stopped — see requiresReason() in plan-change-diff.
 */
export function renderPlanChangeEmail(opts: {
  displayName: string;
  changes: MaterialChange[];
  /** Coach's context line. Mandatory for stops, optional otherwise. */
  reason?: string;
  appUrl?: string;
}): PlanChangeEmail {
  const { displayName, changes, reason, appUrl } = opts;
  const name = firstName(displayName);

  const stopped = changes.filter(
    (c) => c.kind === "supplement_stopped" || c.kind === "practice_stopped",
  );
  const added = changes.filter(
    (c) => c.kind === "supplement_added" || c.kind === "practice_added",
  );
  const changed = changes.filter(
    (c) => c.kind === "supplement_dose_changed" || c.kind === "supplement_timing_changed",
  );

  const sections: string[] = [];
  if (added.length) sections.push(["What's new", ...added.map(line)].join("\n"));
  if (changed.length) sections.push(["What's changed", ...changed.map(line)].join("\n"));
  if (stopped.length) sections.push(["What you can stop", ...stopped.map(line)].join("\n"));

  const why = (reason ?? "").trim();
  const whyBlock = why ? `Why now\n${why}\n\n` : "";

  const body =
    `Hi ${name},\n\n` +
    `I've made a small change to your plan today.\n\n` +
    sections.join("\n\n") +
    `\n\n` +
    whyBlock +
    `Everything is already updated in your app, with the timing built into your daily reminders.\n\n` +
    (appUrl ? `Open your plan: ${appUrl}\n\n` : "") +
    `As always — if it doesn't sit well, or you'd rather start next week, just reply and tell me. Nothing here is fixed.\n\n` +
    `Warmly,\nShivani\n\n` +
    `—\nShivani Hari · The Ochre Tree`;

  return { subject: heading(changes), body };
}
