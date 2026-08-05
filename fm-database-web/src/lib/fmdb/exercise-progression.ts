/**
 * Level-progression suggestions from the practice log.
 *
 * HISTORY OF THIS DECISION. exercise-adherence.ts originally reported and
 * refused to decide, so that the advance-a-level rule could be derived from a
 * season of real logs instead of invented. The coach overrode that on
 * 2026-08-05: build the product now. The compromise that keeps both halves
 * honest: the thresholds below are EXPLICIT, MARKED PROVISIONAL, and the output
 * is a suggestion the coach confirms — nothing advances a client automatically.
 * When real log seasons exist, revisit the constants against them.
 *
 * ATTRIBUTION HONESTY. The log records whole SESSIONS (practiceId), not
 * individual exercises. "Ready" therefore means "this session has been done
 * often enough, cleanly enough" — per-exercise readiness is inferred from that,
 * and every suggestion says so. Do not present these as per-exercise counts.
 */

import { loadAllPlans, loadAllOfKind } from "./loader";
import { loadExerciseAdherence } from "./exercise-adherence";
import { screenAll } from "./exercise-screen";
import { loadClientById } from "./loader-extras";
import type { Exercise } from "./types";

/**
 * PROVISIONAL (2026-08-05, not derived from data): six finished sessions in 28
 * days is 2-3 clean weeks at the Otago cadence — enough exposures that form has
 * settled, few enough that a responder is not held back for months.
 */
export const PROGRESSION_MIN_FINISHED = 6;
export const PROGRESSION_WINDOW_DAYS = 28;

export interface ProgressionSuggestion {
  slug: string;
  /** Client-facing exercise name. */
  name: string;
  currentLevel: string | null;
  /** "level" advances within the entry's ladder; "variant" moves to harder_variant. */
  kind: "level" | "variant";
  nextLevel: string | null;
  nextSlug: string | null;
  nextPrescription: string;
  /** Anything the coach should confirm first — support drop, screen caution. */
  confirmFirst: string;
}

export interface SessionProgression {
  practiceName: string;
  finished: number;
  partial: number;
  windowDays: number;
  /** True when the provisional rule fires. Always the coach's call to act on. */
  ready: boolean;
  /** Why ready is false, in coach language — empty when ready. */
  holdReason: string;
  suggestions: ProgressionSuggestion[];
}

/** The provisional readiness rule, pure and testable. */
export function progressionVerdict(
  finished: number,
  partial: number,
): { ready: boolean; holdReason: string } {
  if (finished < PROGRESSION_MIN_FINISHED) {
    return {
      ready: false,
      holdReason: `${finished} finished of ${PROGRESSION_MIN_FINISHED} needed in the window`,
    };
  }
  // More partials than finishes means the session is being abandoned part-way —
  // the signal that it is too long or too hard. Advancing on top of that would
  // read the log backwards.
  if (partial > finished) {
    return {
      ready: false,
      holdReason: `${partial} part-way sessions against ${finished} finished — the session may be too much as it stands`,
    };
  }
  return { ready: true, holdReason: "" };
}

/** The next rung inside one entry's ladder, pure and testable. */
export function nextRung(
  levels: { level?: unknown; prescription?: unknown; support?: unknown }[],
  currentLevel: string | null,
): { level: string; prescription: string; support: string } | null {
  if (levels.length === 0) return null;
  const norm = levels.map((l) => ({
    level: String(l.level ?? ""),
    prescription: String(l.prescription ?? ""),
    support: String(l.support ?? ""),
  }));
  if (!currentLevel) return norm.length > 1 ? norm[1] : null;
  const i = norm.findIndex((l) => l.level === String(currentLevel));
  if (i === -1 || i + 1 >= norm.length) return null;
  return norm[i + 1];
}

type Dict = Record<string, unknown>;
const asStr = (v: unknown): string => (typeof v === "string" ? v : "");
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export async function loadExerciseProgression(
  clientId: string,
): Promise<SessionProgression[]> {
  if (!clientId) return [];
  try {
    const [plans, adherence, exercises, client] = await Promise.all([
      loadAllPlans(),
      loadExerciseAdherence(clientId, PROGRESSION_WINDOW_DAYS),
      loadAllOfKind<Exercise>("exercises"),
      loadClientById(clientId),
    ]);
    const plan = plans
      .filter((p) => p.client_id === clientId && (p.status ?? "") === "published")
      .sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")))[0];
    if (!plan || !client) return [];

    const bySlug = new Map(exercises.map((e) => [e.slug, e]));
    // Screen once: a harder VARIANT is only suggestible if this client's screen
    // does not block it. Levels within an entry were already screened with the
    // entry itself.
    const verdicts = screenAll(
      exercises as unknown as Parameters<typeof screenAll>[0],
      client as unknown as Record<string, unknown>,
    );
    const blocked = new Set(verdicts.filter((v) => v.verdict === "blocked").map((v) => v.slug));

    const out: SessionProgression[] = [];
    const practices = asArr((plan as unknown as Dict).lifestyle_practices) as Dict[];
    for (const raw of practices) {
      const prescribed = asArr(raw.exercises) as Dict[];
      if (prescribed.length === 0) continue;

      const { ready, holdReason } = progressionVerdict(adherence.finished, adherence.partial);
      const suggestions: ProgressionSuggestion[] = [];
      if (ready) {
        for (const p of prescribed) {
          const slug = asStr(p.exercise).trim();
          const entry = bySlug.get(slug);
          if (!entry) continue;
          const name = asStr(entry.client_name).trim() || asStr(entry.display_name).trim() || slug;
          const currentLevel = asStr(p.level).trim() || null;
          const rung = nextRung(entry.levels ?? [], currentLevel);
          if (rung) {
            const droppingSupport =
              rung.support === "none" &&
              (entry.levels ?? []).some(
                (l) => String(l.level ?? "") === String(currentLevel ?? "") && String(l.support ?? "") !== "none",
              );
            suggestions.push({
              slug, name, currentLevel,
              kind: "level",
              nextLevel: rung.level,
              nextSlug: null,
              nextPrescription: rung.prescription,
              confirmFirst: droppingSupport
                ? "This rung drops the support — confirm balance is steady first."
                : "",
            });
            continue;
          }
          const harder = asStr(entry.harder_variant).trim();
          if (harder && !blocked.has(harder)) {
            const h = bySlug.get(harder);
            if (h) {
              const hv = verdicts.find((v) => v.slug === harder);
              suggestions.push({
                slug, name, currentLevel,
                kind: "variant",
                nextLevel: hv?.start_level ?? null,
                nextSlug: harder,
                nextPrescription:
                  asStr(h.client_name).trim() || asStr(h.display_name).trim() || harder,
                confirmFirst:
                  hv?.verdict === "caution"
                    ? "The screen carries a caution on the harder variant — read it before offering."
                    : "",
              });
            }
          }
        }
      }
      if (ready && suggestions.length === 0) continue;
      out.push({
        practiceName: asStr(raw.name) || "Movement session",
        finished: adherence.finished,
        partial: adherence.partial,
        windowDays: PROGRESSION_WINDOW_DAYS,
        ready,
        holdReason,
        suggestions,
      });
    }
    return out;
  } catch {
    // Fail closed: no progression panel is strictly better than a wrong one.
    return [];
  }
}
