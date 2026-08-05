/**
 * plan-change-diff — what changed in a plan that the CLIENT has to act on.
 *
 * Published plans get edited in place all the time (quick-edit practices,
 * remedies.ts, weekly-menu.ts, supplement-change-notify.ts). Most of those
 * edits are invisible to the client; a few change what they do tomorrow
 * morning. This module is the line between the two, and it is deliberately
 * pure so the line is testable without touching disk or email.
 *
 * The bar is: **would the client do something different tomorrow?**
 *
 * Real evidence for where the bar sits — cl-013's six published quick-edits:
 *   Added supplement: Creatine Monohydrate            → material
 *   Added supplement: Psyllium Husk                   → material
 *   Adjusted iron timing to "4h after Thyronorm"      → material
 *   Added practice: EFT tapping                       → material
 *   Added practice: Electrolytes/Celtic Salts         → material
 *   Adjusted practice "Dim lights by 9:30pm" — NAME   → NOT material (rename)
 * Plus every coach-notes edit, which the client never sees at all.
 *
 * A false positive here emails a client about nothing and trains them to
 * ignore us, so the rules err toward silence.
 */

export type PlanChangeKind =
  | "supplement_added"
  | "supplement_stopped"
  | "supplement_dose_changed"
  | "supplement_timing_changed"
  | "practice_added"
  | "practice_stopped";

export interface MaterialChange {
  kind: PlanChangeKind;
  /** Client-facing label — the supplement or practice name, never a slug. */
  label: string;
  /** Stable identity used for diffing (slug for supplements, name for practices). */
  key: string;
  /** Previous value, for dose/timing changes. */
  from?: string;
  /** New value — dose/timing for changes, the instruction for additions. */
  to?: string;
  /** Dose + timing, for a freshly added supplement. */
  dose?: string;
  timing?: string;
}

type Dict = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());

/**
 * Normalise for COMPARISON only.
 *
 * Strips ALL non-alphanumerics rather than collapsing them to spaces, because
 * separator placement is exactly what differs between a rename and a real
 * change: "Dim lights by 9:30pm" → "dimlightsby930pm" and "Dim lights by
 * 9:30 PM" → "dimlightsby930pm". Collapsing to spaces instead leaves "930pm"
 * vs "930 pm" and reports cl-013's real rename-only edit as a change.
 */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Words that are acronyms in supplement names and should stay capitalised.
 * A blanket "short words are acronyms" rule turns `algae-oil-dha-epa` into
 * "Algae OIL DHA EPA", which looks like shouting at the client.
 */
const SLUG_ACRONYMS = new Set([
  "dha", "epa", "mk", "hcl", "nac", "pqq", "tmg", "cla", "mct", "ala", "gla",
  "b12", "b6", "d3", "k2", "coq10", "5htp", "gaba", "smax", "iu",
]);

/**
 * Turn a catalogue slug into something a client can read. Falls back to the
 * slug's own words — never shows raw kebab-case.
 * `vitaone-magnesium-glycinate` → `Magnesium Glycinate`.
 */
export function humaniseSlug(slug: string): string {
  return slug
    .replace(/^vitaone-/, "")
    .split("-")
    .filter(Boolean)
    .map((w) =>
      SLUG_ACRONYMS.has(w.toLowerCase())
        ? w.toUpperCase()
        : w[0].toUpperCase() + w.slice(1),
    )
    .join(" ");
}

interface SuppView {
  key: string;
  label: string;
  dose: string;
  timing: string;
}

function supplements(plan: Dict | null): Map<string, SuppView> {
  const out = new Map<string, SuppView>();
  const list = (plan?.supplement_protocol as Dict[] | undefined) ?? [];
  for (const s of list) {
    if (!s || typeof s !== "object") continue;
    const slug = str(s.supplement_slug) || str(s.name);
    if (!slug) continue;
    out.set(norm(slug), {
      key: slug,
      label: str(s.display_name) || humaniseSlug(slug),
      dose: str(s.dose),
      timing: str(s.timing),
    });
  }
  return out;
}

function practices(plan: Dict | null): Map<string, string> {
  const out = new Map<string, string>();
  const list = (plan?.lifestyle_practices as Dict[] | undefined) ?? [];
  for (const p of list) {
    if (!p || typeof p !== "object") continue;
    const name = str(p.name);
    if (!name) continue;
    out.set(norm(name), name);
  }
  return out;
}

/**
 * Diff two versions of the same plan into the changes worth telling a client.
 *
 * `before` null (first time we've seen this plan) returns [] rather than
 * announcing every supplement as "new" — a plan's initial contents are
 * delivered by the plan itself, not by a change email.
 */
export function diffPlanForClient(before: Dict | null, after: Dict | null): MaterialChange[] {
  if (!before || !after) return [];
  const out: MaterialChange[] = [];

  const sBefore = supplements(before);
  const sAfter = supplements(after);

  for (const [k, v] of sAfter) {
    const prev = sBefore.get(k);
    if (!prev) {
      out.push({
        kind: "supplement_added",
        label: v.label,
        key: v.key,
        dose: v.dose,
        timing: v.timing,
      });
      continue;
    }
    // Dose and timing are reported separately — they read differently to a
    // client ("take more" vs "take it at a different time") and a single
    // combined line would bury one of them.
    if (norm(prev.dose) !== norm(v.dose) && v.dose) {
      out.push({
        kind: "supplement_dose_changed",
        label: v.label,
        key: v.key,
        from: prev.dose,
        to: v.dose,
      });
    }
    if (norm(prev.timing) !== norm(v.timing) && v.timing) {
      out.push({
        kind: "supplement_timing_changed",
        label: v.label,
        key: v.key,
        from: prev.timing,
        to: v.timing,
      });
    }
  }

  for (const [k, v] of sBefore) {
    if (!sAfter.has(k)) {
      out.push({ kind: "supplement_stopped", label: v.label, key: v.key });
    }
  }

  const pBefore = practices(before);
  const pAfter = practices(after);
  for (const [k, name] of pAfter) {
    if (!pBefore.has(k)) out.push({ kind: "practice_added", label: name, key: name });
  }
  for (const [k, name] of pBefore) {
    if (!pAfter.has(k)) out.push({ kind: "practice_stopped", label: name, key: name });
  }

  return out;
}

/**
 * A STOP is never sent without a coach-written reason.
 *
 * "Stop taking X" arriving cold reads as something went wrong, and a client
 * who is already anxious will fill the silence themselves. The coach types one
 * line of context; until she does, the draft is held rather than sent.
 */
export function requiresReason(changes: MaterialChange[]): boolean {
  return changes.some((c) => c.kind === "supplement_stopped" || c.kind === "practice_stopped");
}
