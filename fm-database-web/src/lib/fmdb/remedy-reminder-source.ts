/**
 * The client's prescribed remedies with their catalogue timings — the ONE
 * resolver shared by the app loader and the reminder cron.
 *
 * Both derive reminders from the same plan, and both must see the same
 * remedies. If only the app resolved them it would offer a switch for a push
 * the cron never sends; if only the cron did, a client would get a notification
 * for something the app never showed. That divergence is the exact failure this
 * reminder module was written to prevent for supplement timings.
 */

import { loadAllOfKind } from "./loader";

interface RemedyEntry {
  slug?: string;
  display_name?: string;
  name?: string;
  timing_notes?: string;
  timing?: string;
}

export interface RemedyForReminder {
  slug: string;
  name: string;
  timing: string;
}

/** Resolve the plan's remedy slugs against the catalogue. Unknown slugs are
 *  dropped — a remedy nobody can look up cannot be timed. */
export async function remediesForReminders(
  plan: Record<string, unknown>,
): Promise<RemedyForReminder[]> {
  const nut = (plan.nutrition ?? {}) as Record<string, unknown>;
  const ayur = (plan.ayurveda ?? {}) as Record<string, unknown>;
  const slugs = [
    ...(Array.isArray(nut.home_remedies) ? nut.home_remedies : []),
    ...(Array.isArray(ayur.remedies) ? ayur.remedies : []),
  ]
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter(Boolean);
  if (!slugs.length) return [];

  let all: RemedyEntry[] = [];
  try {
    all = await loadAllOfKind<RemedyEntry>("home_remedies");
  } catch {
    return []; // no catalogue → no remedy reminders, rather than untimed ones
  }
  const bySlug = new Map(all.filter((r) => r.slug).map((r) => [r.slug as string, r]));

  const out: RemedyForReminder[] = [];
  const seen = new Set<string>();
  for (const s of slugs) {
    if (seen.has(s)) continue;
    seen.add(s);
    const e = bySlug.get(s);
    if (!e) continue;
    out.push({
      slug: s,
      name: (e.display_name || e.name || s).trim(),
      timing: (e.timing_notes || e.timing || "").trim(),
    });
  }
  return out;
}
