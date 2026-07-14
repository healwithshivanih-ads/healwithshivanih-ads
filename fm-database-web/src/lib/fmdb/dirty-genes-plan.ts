/**
 * dirty-genes-plan.ts — PURE translation from a Dirty Genes screen result into
 * a plan contribution, with the hard house rule baked in:
 *
 *   Gene / pathway language lives ONLY in the coach-only note.
 *   Everything client-facing (nutrition.add foods, lifestyle practices,
 *   supplement schedule) is pure food / lifestyle language — never a gene word.
 *
 * No fs / no server-only imports so the screen can preview the contribution
 * live before the coach commits it. The server action
 * (server-actions/dirty-genes-plan.ts) consumes this and writes the draft plan.
 */

import { DG_BAND_LABEL, type DgPathwayResult } from "@/lib/fmdb/dirty-genes";

export interface PlanSupplementSuggestion {
  supplement_slug: string;
  /** coach-facing rationale (NOT shown to the client) — may reference the pathway */
  coach_rationale: string;
  /** which pathway proposed it (for de-dup + audit) */
  from_pathway: string;
}

export interface PlanContribution {
  supplements: PlanSupplementSuggestion[];
  /** client-facing food emphases — gene-free */
  nutrition_add: string[];
  /** client-facing lifestyle practices — gene-free */
  lifestyle: string[];
  /** coach-only markdown block (carries ALL the gene/pathway reasoning) */
  coach_note: string;
}

/** de-dup a list case-insensitively, preserving first-seen order */
function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of items) {
    const k = it.trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(it.trim());
  }
  return out;
}

/**
 * Build a gene-free plan contribution from the pathways the coach chose to act
 * on (normally the flagged ones). `screenDate` is stamped into the coach note.
 */
export function buildPlanContribution(
  pathways: DgPathwayResult[],
  screenDate: string,
): PlanContribution {
  const supplements: PlanSupplementSuggestion[] = [];
  const nutrition: string[] = [];
  const lifestyle: string[] = [];

  // coach-only note lines
  const noteLines: string[] = [
    "## 🧬 Gene-pathway screen (coach-only)",
    "",
    "_Do NOT surface gene/pathway language to the client — the food + lifestyle" +
      " + supplement items below are worded plainly on purpose._",
    "",
    `Screened ${screenDate}. Functional burden from symptoms + labs (not a genetic diagnosis):`,
  ];

  const cautions: string[] = [];

  for (const p of pathways) {
    const iv = p.interventions;
    const driverText = p.drivers.map((d) => d.text.toLowerCase()).join("; ");
    noteLines.push(
      `- **${p.label}** — ${DG_BAND_LABEL[p.band]} (${Math.round(p.fraction * 100)}%).` +
        (driverText ? ` Drivers: ${driverText}.` : "") +
        (p.genetics.some((g) => g.risk)
          ? ` Genetics on file supports (context, not verdict).`
          : ""),
    );
    if (!iv) continue;

    // supplements → coach-facing rationale may name the pathway
    for (const slug of iv.supplements ?? []) {
      supplements.push({
        supplement_slug: slug,
        coach_rationale: `Supports ${p.label.toLowerCase()} — from gene-pathway screen.`,
        from_pathway: p.id,
      });
    }
    // client-facing: foods + lifestyle, gene-free by construction
    for (const f of iv.foods_emphasise ?? []) nutrition.push(f);
    for (const l of iv.lifestyle ?? []) lifestyle.push(l);
    if (iv.caution) cautions.push(`- ${p.label}: ${iv.caution}`);
  }

  if (cautions.length) {
    noteLines.push("", "**Sequencing / safety:**", ...cautions);
  }

  return {
    supplements,
    nutrition_add: dedupe(nutrition),
    lifestyle: dedupe(lifestyle),
    coach_note: noteLines.join("\n"),
  };
}
