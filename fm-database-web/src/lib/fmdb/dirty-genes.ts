/**
 * dirty-genes.ts — PURE scoring engine for the coach-side "Dirty Genes"
 * functional pathway-burden screen (modelled on Ben Lynch, 2018).
 *
 * No fs, no server-only imports — safe to use in a client component so the
 * questionnaire scores live as the coach ticks boxes. The questionnaire data
 * itself lives in fm-database/data/dirty_genes_assessment.yaml and is loaded
 * server-side (see server-actions/dirty-genes.ts), then handed to these pure
 * functions.
 *
 * HOUSE STANCE (do not soften): this scores FUNCTIONAL burden from symptoms +
 * lifestyle. It is NOT a genetic diagnosis. Genetics (if a report is on file)
 * is an OVERLAY — a nudge, never a verdict — and NEVER changes the burden band.
 * Coach educates lifestyle; never interprets SNPs diagnostically.
 */

// ---- shapes loaded from the YAML data file -------------------------------

export interface DgItem {
  id: string;
  text: string;
  weight: number;
}

export interface DgGene {
  gene: string;
  rsids?: string[];
  risk_note?: string;
}

export interface DgInterventions {
  supplements?: string[];
  foods_emphasise?: string[];
  foods_reduce?: string[];
  lifestyle?: string[];
  labs_to_track?: string[];
  caution?: string;
}

export interface DgPathway {
  id: string;
  gene: string;
  label: string;
  plain: string;
  mechanism_slugs?: string[];
  genes?: DgGene[];
  items: DgItem[];
  interventions?: DgInterventions;
}

export interface DgBands {
  clear: number; // below this fraction => clear
  mild: number; // below this => mild
  moderate: number; // below this => moderate; at/above => high
}

export interface DgQuestionnaire {
  _meta: {
    version: number;
    framework?: string;
    source?: string;
    bands: DgBands;
    scope_note?: string;
  };
  pathways: DgPathway[];
}

// ---- a genetic SNP as parsed by scripts/parse-genetic-report.py ----------

export interface ClientSnp {
  gene?: string;
  rsid?: string;
  variant?: string;
  genotype?: string;
  zygosity?: string; // "homozygous_risk" | "heterozygous" | "homozygous_wild" | "unknown"
  implication?: string;
  fm_relevance?: string;
}

// ---- scored output -------------------------------------------------------

export type DgBand = "clear" | "mild" | "moderate" | "high";

/** An objective lab signal that escalates a pathway's band regardless of the
 *  symptom tally (e.g. homocysteine 22 → MTHFR high). Computed server-side from
 *  the client's health_snapshots by dirty-genes-prefill.ts. */
export interface DgLabFlag {
  pathwayId: string;
  escalateTo: DgBand;
  marker: string;
  value?: number;
  note: string;
}

export interface DgGeneticMatch {
  gene: string;
  rsid?: string;
  genotype?: string;
  /** true only when the report indicates a risk genotype (homozygous_risk or
   *  heterozygous). Wild-type / unknown still shown but flagged false. */
  risk: boolean;
  zygosity?: string;
  risk_note?: string;
  fm_relevance?: string;
}

export interface DgPathwayResult {
  id: string;
  gene: string;
  label: string;
  plain: string;
  score: number;
  max: number;
  /** 0..1 */
  fraction: number;
  band: DgBand;
  /** items the coach checked, in questionnaire order */
  drivers: DgItem[];
  /** genetics overlay matches for this pathway (may be empty) */
  genetics: DgGeneticMatch[];
  mechanism_slugs: string[];
  interventions?: DgInterventions;
  /** set when a lab signal raised the band above the symptom tally */
  labEscalated?: { to: DgBand; note: string; marker: string };
}

export interface DgResult {
  pathways: DgPathwayResult[];
  /** pathways at moderate+ burden, most-burdened first */
  flagged: DgPathwayResult[];
  totalChecked: number;
  hasGenetics: boolean;
}

const BAND_ORDER: Record<DgBand, number> = { clear: 0, mild: 1, moderate: 2, high: 3 };

const RISK_ZYGOSITY = new Set(["homozygous_risk", "heterozygous"]);

export function bandFor(fraction: number, bands: DgBands): DgBand {
  if (fraction < bands.clear) return "clear";
  if (fraction < bands.mild) return "mild";
  if (fraction < bands.moderate) return "moderate";
  return "high";
}

export const DG_BAND_LABEL: Record<DgBand, string> = {
  clear: "Clear",
  mild: "Mild",
  moderate: "Moderate",
  high: "High",
};

/** Match this pathway's associated genes against the client's SNP report.
 *  Gene-name match is case-insensitive; GSTM1-null etc. matched loosely. */
export function matchGenetics(pathway: DgPathway, snps: ClientSnp[]): DgGeneticMatch[] {
  if (!pathway.genes?.length || !snps.length) return [];
  const out: DgGeneticMatch[] = [];
  for (const g of pathway.genes) {
    const geneU = g.gene.trim().toUpperCase();
    for (const snp of snps) {
      const snpGene = (snp.gene ?? "").trim().toUpperCase();
      if (!snpGene) continue;
      // exact or contains (handles "GST/GPX" pathway gene 'GSTM1' vs report 'GSTM1')
      if (snpGene !== geneU && !snpGene.includes(geneU) && !geneU.includes(snpGene)) continue;
      out.push({
        gene: snp.gene ?? g.gene,
        rsid: snp.rsid,
        genotype: snp.genotype,
        zygosity: snp.zygosity,
        risk: RISK_ZYGOSITY.has((snp.zygosity ?? "").toLowerCase()),
        risk_note: g.risk_note,
        fm_relevance: snp.fm_relevance,
      });
    }
  }
  return out;
}

export function scorePathway(
  pathway: DgPathway,
  checked: Set<string>,
  bands: DgBands,
  snps: ClientSnp[] = [],
): DgPathwayResult {
  const max = pathway.items.reduce((s, it) => s + (it.weight || 0), 0) || 1;
  const drivers = pathway.items.filter((it) => checked.has(it.id));
  const score = drivers.reduce((s, it) => s + (it.weight || 0), 0);
  const fraction = score / max;
  return {
    id: pathway.id,
    gene: pathway.gene,
    label: pathway.label,
    plain: pathway.plain,
    score,
    max,
    fraction,
    band: bandFor(fraction, bands),
    drivers,
    genetics: matchGenetics(pathway, snps),
    mechanism_slugs: pathway.mechanism_slugs ?? [],
    interventions: pathway.interventions,
  };
}

export function scoreAssessment(
  q: DgQuestionnaire,
  checkedIds: string[],
  snps: ClientSnp[] = [],
  labFlags: DgLabFlag[] = [],
): DgResult {
  const checked = new Set(checkedIds);
  const bands = q._meta.bands;
  const pathways = q.pathways.map((p) => {
    const base = scorePathway(p, checked, bands, snps);
    // apply the strongest lab signal for this pathway; only ESCALATES.
    const lf = labFlags
      .filter((f) => f.pathwayId === p.id)
      .sort((a, b) => BAND_ORDER[b.escalateTo] - BAND_ORDER[a.escalateTo])[0];
    if (lf && BAND_ORDER[lf.escalateTo] > BAND_ORDER[base.band]) {
      return { ...base, band: lf.escalateTo, labEscalated: { to: lf.escalateTo, note: lf.note, marker: lf.marker } };
    }
    return base;
  });
  const flagged = pathways
    .filter((p) => BAND_ORDER[p.band] >= BAND_ORDER.moderate)
    // escalated pathways sort by band first, then symptom fraction
    .sort((a, b) => BAND_ORDER[b.band] - BAND_ORDER[a.band] || b.fraction - a.fraction);
  return {
    pathways,
    flagged,
    totalChecked: checked.size,
    hasGenetics: snps.length > 0,
  };
}
