import "server-only";

/**
 * The meal-photo review queue (docs/MEAL_PHOTO_CHECK_SPEC.md, phase 2a).
 *
 * SHADOW MODE. Nothing scores photos yet and nothing replies to clients —
 * this is the surface the coach reviews in, built first so the checker has
 * somewhere honest to land. `meal_outcome` is empty on every row today; when
 * the checker ships it fills that field and this screen starts showing a
 * proposal beside each photo. Her agree/disagree is what calibrates it, and
 * per the spec no client sees an automated affirmation until it has.
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
