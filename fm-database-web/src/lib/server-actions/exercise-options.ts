"use server";

/**
 * Screened exercise options for one client, for the plan editor's session block.
 *
 * WHY A SERVER ACTION AND NOT A THIRD SCREEN. The coach panel already screens
 * with `screenAll` (TS), the assess gate screens with `gate_prescription`
 * (Python), and those two are pinned to each other by a captured fixture. A
 * third implementation living in the editor would be the one nobody remembers
 * to update. This calls the same TS screen the panel does.
 *
 * BLOCKED ENTRIES ARE RETURNED, unlike the assess payload which withholds them.
 * The audiences are different: a model shown a flagged entry will reason its way
 * past the flag, whereas the coach is exactly the person who should see that
 * sit-to-stand is off the table for this client and why. She cannot pick them —
 * the editor renders them disabled with the reason attached.
 */

import { loadClientById } from "@/lib/fmdb/loader-extras";
import { loadAllOfKind } from "@/lib/fmdb/loader";
import { screenAll, type Verdict } from "@/lib/fmdb/exercise-screen";
import type { Exercise } from "@/lib/fmdb/types";

export interface ExerciseOption {
  slug: string;
  /** What the CLIENT would be shown. Never `display_name`, which is clinical. */
  name: string;
  displayName: string;
  modality: string;
  tier: string;
  summary: string;
  verdict: Verdict;
  /** Biomechanical shapes + muscles — the axes a balanced session covers. */
  patterns: string[];
  muscles: string[];
  /** The rung the screen would start this client on, if the entry has a ladder. */
  startLevel: string | null;
  startReason: string;
  /** Every level label on the entry, easiest first — what the coach may choose. */
  levels: { level: string; prescription: string; support: string }[];
  /** What the client must own. The screen does not check this — it screens what
   *  a body can take, not what is in the house — so it has to be visible at the
   *  moment of choosing or it is not checked at all. */
  equipment: string[];
  /** Why it is not simply `clear`: the block reason, or the caution's modification. */
  notes: { kind: string; label: string; detail: string; modification: string }[];
}

export async function loadExerciseOptions(
  clientId: string,
): Promise<{ ok: true; options: ExerciseOption[] } | { ok: false; error: string }> {
  if (!clientId) return { ok: false, error: "clientId required" };
  try {
    const [client, exercises] = await Promise.all([
      loadClientById(clientId),
      loadAllOfKind<Exercise>("exercises"),
    ]);
    if (!client) return { ok: false, error: `client ${clientId} not found` };
    if (exercises.length === 0) return { ok: true, options: [] };

    const bySlug = new Map(exercises.map((e) => [e.slug, e]));
    const verdicts = screenAll(
      exercises as unknown as Parameters<typeof screenAll>[0],
      client as unknown as Record<string, unknown>,
    );

    const options: ExerciseOption[] = verdicts.map((v) => {
      const e = bySlug.get(v.slug);
      const levels = (e?.levels ?? []).map((l) => ({
        level: String(l.level ?? ""),
        prescription: String(l.prescription ?? ""),
        support: String(l.support ?? ""),
      }));
      return {
        slug: v.slug,
        name: v.client_name || v.display_name || v.slug,
        displayName: v.display_name || v.slug,
        modality: v.modality ?? "",
        tier: String(e?.intensity_tier ?? ""),
        summary: String(e?.summary ?? ""),
        verdict: v.verdict,
        patterns: e?.movement_patterns ?? [],
        muscles: e?.muscles_worked ?? [],
        startLevel: v.start_level ?? null,
        startReason: v.start_reason ?? "",
        levels,
        equipment: (e?.equipment ?? []).map((x) => String(x).trim()).filter(Boolean),
        notes: (v.notes ?? []).map((n) => ({
          kind: n.kind,
          label: n.label,
          detail: n.detail,
          modification: n.modification ?? "",
        })),
      };
    });

    return { ok: true, options };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
