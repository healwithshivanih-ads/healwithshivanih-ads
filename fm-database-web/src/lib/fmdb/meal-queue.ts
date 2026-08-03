import "server-only";

/**
 * The meal-photo review queue (docs/MEAL_PHOTO_CHECK_SPEC.md, phase 2a).
 *
 * THE CHECKER RUNS ON EVERY PHOTO. This screen is the EXCEPTION list, not a
 * to-do list: reviewing each photo by hand is the work being replaced, not a
 * step on the way to it. It opens on what needs her — anything flagged for
 * safety, and anything off-plan — with everything else a tap away for a
 * spot-check she never has to do.
 *
 * Her agree/disagree stays because a checker nobody can correct is one that
 * cannot improve, and because the first weeks are when a systematic error is
 * cheapest to catch.
 *
 * Assembled by reading each client's thread rather than a separate index:
 * an index would be a second copy of the truth that can drift, and the
 * volume here is seventeen small append-only files.
 */
import { loadCoachIndex } from "./coach-mobile";
import { readThread, type ThreadMessage } from "./client-thread";

export type MealRow = {
  clientId: string;
  clientName: string;
  messageId: string;
  at: string;
  file: string;
  caption: string;
  outcome: ThreadMessage["meal_outcome"];
  verdict: ThreadMessage["coach_verdict"];
  pinned: boolean;
};

/**
 * Every meal photo across the roster, newest first.
 *
 * `reviewed` rows are kept rather than hidden: the queue doubles as the
 * record of what was decided, and a photo that vanishes on review gives her
 * no way back to something she got wrong.
 */
export function loadMealQueue(limit = 60): MealRow[] {
  const rows: MealRow[] = [];
  for (const c of loadCoachIndex()) {
    // CLIENTS ONLY. loadCoachIndex returns prospects too, and the roster
    // keeps them deliberately apart — /m/today filters the same way. A
    // declined prospect can still hold a live app token, so without this a
    // photo from someone who never signed up would land in a queue about
    // plan adherence, against a plan they do not have.
    if (c.kind !== "client") continue;
    let thread: ThreadMessage[];
    try {
      thread = readThread(c.id);
    } catch {
      continue; // one unreadable client must not empty the whole queue
    }
    for (const m of thread) {
      if (m.kind !== "photo" || !m.file || m.dir !== "inbound") continue;
      rows.push({
        clientId: c.id,
        clientName: c.name || c.id,
        messageId: m.id,
        at: m.at,
        file: m.file,
        caption: m.text ?? "",
        outcome: m.meal_outcome ?? null,
        verdict: m.coach_verdict ?? null,
        pinned: !!m.pinned_at,
      });
    }
  }
  rows.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return rows.slice(0, limit);
}
