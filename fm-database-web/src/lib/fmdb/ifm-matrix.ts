/**
 * IFM Matrix — Institute for Functional Medicine 7-node model.
 *
 * Scores are computed from the AI's likely_drivers (mechanism slugs) +
 * topics_in_play (topic slugs) + selected symptoms. Lab patterns are
 * detected separately from extracted_labs + computed_ratios.
 */

import type { LikelyDriver, TopicInPlay, ExtractedLab, ComputedRatio } from "./anthropic-types";

// ── Node definitions ────────────────────────────────────────────────────────

export const IFM_NODES = [
  {
    id: "assimilation",
    label: "Assimilation",
    emoji: "🦠",
    description: "Gut, digestion, microbiome, absorption",
    color: "#4CAF50",
  },
  {
    id: "defense_repair",
    label: "Defense & Repair",
    emoji: "🛡️",
    description: "Immune, inflammation, infection",
    color: "#FF5722",
  },
  {
    id: "energy",
    label: "Energy",
    emoji: "⚡",
    description: "Mitochondria, ATP, metabolism",
    color: "#FFC107",
  },
  {
    id: "biotransformation",
    label: "Biotransformation",
    emoji: "🔄",
    description: "Liver, detox pathways, elimination",
    color: "#9C27B0",
  },
  {
    id: "transport",
    label: "Transport",
    emoji: "🚢",
    description: "Cardiovascular, lymph, blood",
    color: "#2196F3",
  },
  {
    id: "communication",
    label: "Communication",
    emoji: "📡",
    description: "Hormones, neurotransmitters, signalling",
    color: "#E91E63",
  },
  {
    id: "structural",
    label: "Structural Integrity",
    emoji: "🏛️",
    description: "Bone, muscle, cell membranes",
    color: "#795548",
  },
] as const;

export type IFMNodeId = typeof IFM_NODES[number]["id"];

// ── Keyword → node mapping ──────────────────────────────────────────────────
// Each entry: [keywords to match against slug, node(s) with weight 1 or 2]
// Higher weight = stronger signal for that node.

type NodeHit = { node: IFMNodeId; weight: number };

const MECHANISM_MAP: Array<{ kw: string[]; hits: NodeHit[] }> = [
  // Assimilation
  { kw: ["leaky-gut", "intestinal-permeability"], hits: [{ node: "assimilation", weight: 2 }, { node: "defense_repair", weight: 1 }] },
  { kw: ["dysbiosis", "microbial-diversity", "microbiome"], hits: [{ node: "assimilation", weight: 2 }] },
  { kw: ["scfa", "short-chain-fatty"], hits: [{ node: "assimilation", weight: 2 }, { node: "energy", weight: 1 }] },
  { kw: ["sibo", "small-intestin"], hits: [{ node: "assimilation", weight: 2 }] },
  { kw: ["gut-hormone", "enteroendocrine"], hits: [{ node: "assimilation", weight: 1 }, { node: "communication", weight: 1 }] },
  { kw: ["bile-acid", "bile-salt"], hits: [{ node: "assimilation", weight: 1 }, { node: "biotransformation", weight: 1 }] },

  // Defense & Repair
  { kw: ["chronic-inflammation", "nf-kb", "inflamm"], hits: [{ node: "defense_repair", weight: 2 }] },
  { kw: ["oxidative-stress", "reactive-oxygen", "ros"], hits: [{ node: "defense_repair", weight: 2 }, { node: "energy", weight: 1 }] },
  { kw: ["mast-cell", "histamine"], hits: [{ node: "defense_repair", weight: 2 }, { node: "assimilation", weight: 1 }] },
  { kw: ["autoimmun", "molecular-mimicry", "immune-dysregul"], hits: [{ node: "defense_repair", weight: 2 }] },
  { kw: ["neuroinflammation"], hits: [{ node: "defense_repair", weight: 2 }, { node: "communication", weight: 1 }] },
  { kw: ["cytokine", "interleukin", "tnf"], hits: [{ node: "defense_repair", weight: 2 }] },

  // Energy
  { kw: ["mitochondr", "electron-transport", "atp-synthase"], hits: [{ node: "energy", weight: 2 }] },
  { kw: ["insulin-resistance"], hits: [{ node: "energy", weight: 2 }, { node: "communication", weight: 2 }, { node: "transport", weight: 1 }] },
  { kw: ["hpa-axis", "cortisol-dysregul", "adrenal-fatigue"], hits: [{ node: "energy", weight: 2 }, { node: "communication", weight: 2 }] },
  { kw: ["blood-sugar", "glucose-dysregul", "glyc"], hits: [{ node: "energy", weight: 2 }, { node: "communication", weight: 1 }] },
  { kw: ["nad", "coq10", "ribose"], hits: [{ node: "energy", weight: 2 }] },
  { kw: ["thyroid-conversion", "t4-to-t3", "deiodinase"], hits: [{ node: "energy", weight: 2 }, { node: "communication", weight: 1 }] },

  // Biotransformation
  { kw: ["estrogen-enterohepatic", "estrobolome", "beta-glucuronidase"], hits: [{ node: "biotransformation", weight: 2 }, { node: "communication", weight: 1 }] },
  { kw: ["methylation", "mthfr", "comt", "pemt"], hits: [{ node: "biotransformation", weight: 2 }, { node: "communication", weight: 1 }] },
  { kw: ["phase-1", "phase-2", "glucuronid", "sulfation", "glutathione"], hits: [{ node: "biotransformation", weight: 2 }] },
  { kw: ["liver", "hepat", "bile-flow"], hits: [{ node: "biotransformation", weight: 2 }] },
  { kw: ["heavy-metal", "lead", "mercury", "aluminum", "arsenic"], hits: [{ node: "biotransformation", weight: 2 }, { node: "defense_repair", weight: 1 }] },

  // Transport
  { kw: ["endotheli", "vascular", "arterio"], hits: [{ node: "transport", weight: 2 }] },
  { kw: ["iron-deficiency", "ferritin", "hemoglobin", "anemia"], hits: [{ node: "transport", weight: 2 }, { node: "energy", weight: 1 }] },
  { kw: ["lipid", "cholesterol", "triglycer", "ldl", "hdl"], hits: [{ node: "transport", weight: 2 }] },
  { kw: ["lymph", "edema", "fluid"], hits: [{ node: "transport", weight: 2 }] },
  { kw: ["platelet", "coagul", "fibrinogen"], hits: [{ node: "transport", weight: 2 }] },

  // Communication
  { kw: ["estrogen-decline", "estrogen-dominance", "progesterone", "oestrogen"], hits: [{ node: "communication", weight: 2 }] },
  { kw: ["low-progesterone", "luteal-phase"], hits: [{ node: "communication", weight: 2 }] },
  { kw: ["testosterone", "androgen", "dhea"], hits: [{ node: "communication", weight: 2 }] },
  { kw: ["gaba", "serotonin", "dopamine", "neurotransmit"], hits: [{ node: "communication", weight: 2 }] },
  { kw: ["melatonin", "circadian", "sleep-hormone"], hits: [{ node: "communication", weight: 2 }, { node: "energy", weight: 1 }] },
  { kw: ["tsh", "thyroid-stimulat"], hits: [{ node: "communication", weight: 2 }, { node: "energy", weight: 1 }] },
  { kw: ["leptin", "ghrelin", "adipokine"], hits: [{ node: "communication", weight: 2 }, { node: "energy", weight: 1 }] },
  { kw: ["cortisol-awaken", "diurnal-cortisol"], hits: [{ node: "communication", weight: 2 }, { node: "energy", weight: 1 }] },
  { kw: ["insulin-signal"], hits: [{ node: "communication", weight: 2 }, { node: "energy", weight: 1 }] },

  // Structural
  { kw: ["bone-remodel", "osteoblast", "osteoclast", "osteopenia", "osteoporosis"], hits: [{ node: "structural", weight: 2 }] },
  { kw: ["collagen", "connective-tissue", "tendon", "ligament", "cartilage"], hits: [{ node: "structural", weight: 2 }] },
  { kw: ["myelin", "nerve-conduction"], hits: [{ node: "structural", weight: 2 }, { node: "communication", weight: 1 }] },
  { kw: ["sarcopenia", "muscle-wasting", "protein-synthesis"], hits: [{ node: "structural", weight: 2 }, { node: "energy", weight: 1 }] },
  { kw: ["cell-membrane", "phospholipid", "omega-3-incorpor"], hits: [{ node: "structural", weight: 2 }] },
];

const TOPIC_MAP: Array<{ kw: string[]; hits: NodeHit[] }> = [
  // Assimilation
  { kw: ["gut", "digest", "bowel", "microbiom", "ibs", "sibo", "colon", "gastro", "celiac", "crohn", "colitis", "reflux", "gerd"], hits: [{ node: "assimilation", weight: 2 }] },
  { kw: ["bloat", "constip", "loose-stool", "diarrhea", "food-sensit"], hits: [{ node: "assimilation", weight: 2 }] },
  { kw: ["intestin", "absorpt", "probiotic", "prebiotic", "dysbiosis"], hits: [{ node: "assimilation", weight: 2 }] },
  { kw: ["leaky-gut", "intestinal-permeab"], hits: [{ node: "assimilation", weight: 2 }, { node: "defense_repair", weight: 1 }] },

  // Defense & Repair
  { kw: ["inflamm", "autoimmun", "immune", "allerg", "histamin", "mast-cell"], hits: [{ node: "defense_repair", weight: 2 }] },
  { kw: ["hashimoto", "graves", "lupus", "rheumatoid", "sjogren"], hits: [{ node: "defense_repair", weight: 2 }, { node: "communication", weight: 1 }] },
  { kw: ["eczema", "psoriasis", "urticaria", "rash", "skin-condition"], hits: [{ node: "defense_repair", weight: 2 }, { node: "structural", weight: 1 }] },
  { kw: ["chronic-pain", "fibromyalg", "oxidative-stress"], hits: [{ node: "defense_repair", weight: 2 }, { node: "energy", weight: 1 }] },

  // Energy
  { kw: ["fatigue", "chronic-fatigue", "energy", "exhaustion"], hits: [{ node: "energy", weight: 2 }] },
  { kw: ["thyroid", "hypothyroid", "hyperthyroid"], hits: [{ node: "energy", weight: 2 }, { node: "communication", weight: 2 }] },
  { kw: ["adrenal", "cortisol", "hpa-axis", "burnout"], hits: [{ node: "energy", weight: 2 }, { node: "communication", weight: 1 }] },
  { kw: ["blood-sugar", "insulin-resist", "metabolic", "prediabet", "diabet"], hits: [{ node: "energy", weight: 2 }, { node: "communication", weight: 1 }] },
  { kw: ["mitochondr", "coq10", "cellular-energy"], hits: [{ node: "energy", weight: 2 }] },
  { kw: ["iron-defici", "anemia"], hits: [{ node: "energy", weight: 2 }, { node: "transport", weight: 2 }] },

  // Biotransformation
  { kw: ["liver", "detox", "methylat", "mthfr"], hits: [{ node: "biotransformation", weight: 2 }] },
  { kw: ["estrogen-detox", "estrogen-metabol", "estrogen-clearanc"], hits: [{ node: "biotransformation", weight: 2 }, { node: "communication", weight: 1 }] },
  { kw: ["bile", "gallbladd"], hits: [{ node: "biotransformation", weight: 2 }, { node: "assimilation", weight: 1 }] },
  { kw: ["toxic", "mold", "heavy-metal", "environ"], hits: [{ node: "biotransformation", weight: 2 }] },

  // Transport
  { kw: ["cardiovasc", "heart", "blood-pressure", "hypertension", "arteriosclerosis"], hits: [{ node: "transport", weight: 2 }] },
  { kw: ["cholesterol", "lipid", "triglycerid"], hits: [{ node: "transport", weight: 2 }] },
  { kw: ["circulation", "lymph", "edema", "vascular"], hits: [{ node: "transport", weight: 2 }] },
  { kw: ["anemia", "ferritin", "iron-defici", "hemoglobin"], hits: [{ node: "transport", weight: 2 }, { node: "energy", weight: 1 }] },
  { kw: ["palpitat", "arrhythmia"], hits: [{ node: "transport", weight: 2 }] },

  // Communication
  { kw: ["hormone", "estrogen", "progesteron", "testosterone"], hits: [{ node: "communication", weight: 2 }] },
  { kw: ["pcos", "perimenopaus", "menopaus", "pms", "menstrual", "cycle"], hits: [{ node: "communication", weight: 2 }] },
  { kw: ["mood", "anxiety", "depress", "mental-health", "neurotransmit"], hits: [{ node: "communication", weight: 2 }] },
  { kw: ["insomnia", "sleep", "melatonin", "circadian"], hits: [{ node: "communication", weight: 2 }, { node: "energy", weight: 1 }] },
  { kw: ["brain-fog", "cognitive", "memory", "concentrat"], hits: [{ node: "communication", weight: 2 }, { node: "energy", weight: 1 }] },
  { kw: ["sex-hormone", "libido", "dhea", "pregnenolone"], hits: [{ node: "communication", weight: 2 }] },
  { kw: ["thyroid-hormone", "t3", "t4", "tsh"], hits: [{ node: "communication", weight: 2 }, { node: "energy", weight: 1 }] },

  // Structural
  { kw: ["bone", "osteopenia", "osteoporosis", "fracture"], hits: [{ node: "structural", weight: 2 }] },
  { kw: ["joint", "arthrit", "cartilage", "tendoni", "ligament"], hits: [{ node: "structural", weight: 2 }, { node: "defense_repair", weight: 1 }] },
  { kw: ["muscle", "sarcopenia", "muscle-weakness", "myalg"], hits: [{ node: "structural", weight: 2 }] },
  { kw: ["hair-loss", "hair-thin", "nail", "skin-health", "integument"], hits: [{ node: "structural", weight: 1 }, { node: "communication", weight: 1 }] },
];

const SYMPTOM_MAP: Array<{ kw: string[]; hits: NodeHit[] }> = [
  { kw: ["bloat", "gas", "flatulen", "digest"], hits: [{ node: "assimilation", weight: 1 }] },
  { kw: ["constip", "irregular-bowel", "ibs"], hits: [{ node: "assimilation", weight: 1 }] },
  { kw: ["loose-stool", "diarrhea", "colitis"], hits: [{ node: "assimilation", weight: 1 }] },
  { kw: ["food-sensit", "food-intoleranc"], hits: [{ node: "assimilation", weight: 1 }, { node: "defense_repair", weight: 1 }] },
  { kw: ["nausea", "heartburn", "reflux", "burping"], hits: [{ node: "assimilation", weight: 1 }] },
  { kw: ["fatigue", "exhaustion", "tired", "low-energy"], hits: [{ node: "energy", weight: 1 }] },
  { kw: ["brain-fog", "memory", "concentrat", "cognit"], hits: [{ node: "energy", weight: 1 }, { node: "communication", weight: 1 }] },
  { kw: ["weight-gain", "weight-loss", "obesity"], hits: [{ node: "energy", weight: 1 }, { node: "communication", weight: 1 }] },
  { kw: ["joint-pain", "arthralgia", "arthrit"], hits: [{ node: "defense_repair", weight: 1 }, { node: "structural", weight: 1 }] },
  { kw: ["muscle-pain", "myalgia", "fibromyalg"], hits: [{ node: "defense_repair", weight: 1 }, { node: "structural", weight: 1 }] },
  { kw: ["skin-rash", "eczema", "urticaria", "hives", "psoriasis"], hits: [{ node: "defense_repair", weight: 1 }, { node: "structural", weight: 1 }] },
  { kw: ["anxiety", "panic", "fear", "worried"], hits: [{ node: "communication", weight: 1 }] },
  { kw: ["depress", "low-mood", "sadness", "hopeless"], hits: [{ node: "communication", weight: 1 }] },
  { kw: ["insomnia", "poor-sleep", "waking", "restless"], hits: [{ node: "communication", weight: 1 }, { node: "energy", weight: 1 }] },
  { kw: ["hot-flash", "night-sweat", "perimenopaus"], hits: [{ node: "communication", weight: 1 }] },
  { kw: ["pms", "menstrual-pain", "irregular-period", "heavy-period"], hits: [{ node: "communication", weight: 1 }] },
  { kw: ["hair-loss", "hair-thin", "alopecia"], hits: [{ node: "structural", weight: 1 }, { node: "communication", weight: 1 }] },
  { kw: ["cold-hands", "cold-feet", "poor-circulation"], hits: [{ node: "transport", weight: 1 }] },
  { kw: ["palpitat", "heart-racing", "tachycard"], hits: [{ node: "transport", weight: 1 }] },
  { kw: ["headach", "migraine"], hits: [{ node: "transport", weight: 1 }, { node: "defense_repair", weight: 1 }] },
  { kw: ["chemical-sensit", "smell-sensit", "detox-react"], hits: [{ node: "biotransformation", weight: 1 }] },
  { kw: ["swelling", "edema", "puffiness"], hits: [{ node: "transport", weight: 1 }] },
  { kw: ["bone-pain", "osteopenia", "fracture"], hits: [{ node: "structural", weight: 1 }] },
  { kw: ["tingling", "numbness", "neuropath"], hits: [{ node: "structural", weight: 1 }, { node: "communication", weight: 1 }] },
];

// ── Helper: slug → matching hits ────────────────────────────────────────────

function matchSlug(
  slug: string,
  map: Array<{ kw: string[]; hits: NodeHit[] }>
): NodeHit[] {
  const lower = slug.toLowerCase();
  const result: NodeHit[] = [];
  for (const entry of map) {
    if (entry.kw.some((k) => lower.includes(k))) {
      result.push(...entry.hits);
    }
  }
  return result;
}

// ── Main scoring function ────────────────────────────────────────────────────

export interface IFMNodeScore {
  node: IFMNodeId;
  score: number;                // 0–100
  rawScore: number;             // sum of weights
  contributors: string[];       // slugs that contributed
}

export interface IFMMatrixResult {
  nodes: IFMNodeScore[];
  primaryNode: IFMNodeId | null;
  cascade: string | null;       // auto-generated cascade description
}

export function computeIFMMatrix(
  drivers: LikelyDriver[],
  topics: TopicInPlay[],
  symptoms: string[]
): IFMMatrixResult {
  // Accumulate raw scores per node
  const scores: Record<IFMNodeId, { raw: number; contributors: Set<string> }> = {
    assimilation: { raw: 0, contributors: new Set() },
    defense_repair: { raw: 0, contributors: new Set() },
    energy: { raw: 0, contributors: new Set() },
    biotransformation: { raw: 0, contributors: new Set() },
    transport: { raw: 0, contributors: new Set() },
    communication: { raw: 0, contributors: new Set() },
    structural: { raw: 0, contributors: new Set() },
  };

  const add = (hits: NodeHit[], contributor: string) => {
    for (const { node, weight } of hits) {
      if (scores[node]) {
        scores[node].raw += weight;
        scores[node].contributors.add(contributor);
      }
    }
  };

  // Process mechanism slugs from drivers (weight x 2 — primary signals)
  for (const d of drivers) {
    const hits = matchSlug(d.mechanism_slug, MECHANISM_MAP);
    if (hits.length > 0) {
      add(hits.map((h) => ({ ...h, weight: h.weight * 2 })), d.mechanism_slug);
    } else {
      // Fallback: try topic map
      const tHits = matchSlug(d.mechanism_slug, TOPIC_MAP);
      add(tHits.map((h) => ({ ...h, weight: h.weight * 2 })), d.mechanism_slug);
    }
  }

  // Process topic slugs
  for (const t of topics) {
    const hits = matchSlug(t.topic_slug, TOPIC_MAP);
    const roleMultiplier = t.role === "primary" ? 2 : 1;
    add(hits.map((h) => ({ ...h, weight: h.weight * roleMultiplier })), t.topic_slug);
  }

  // Process symptom slugs (lower weight)
  for (const s of symptoms) {
    const hits = matchSlug(s, SYMPTOM_MAP);
    add(hits, s);
  }

  // Find max raw score for normalisation
  const maxRaw = Math.max(1, ...Object.values(scores).map((v) => v.raw));

  // Build sorted node scores
  const nodeScores: IFMNodeScore[] = IFM_NODES.map((n) => {
    const s = scores[n.id];
    return {
      node: n.id,
      score: Math.min(100, Math.round((s.raw / maxRaw) * 100)),
      rawScore: s.raw,
      contributors: Array.from(s.contributors),
    };
  });

  nodeScores.sort((a, b) => b.rawScore - a.rawScore);

  const primary = nodeScores[0]?.rawScore > 0 ? nodeScores[0].node : null;
  const second = nodeScores[1]?.rawScore > 0 ? nodeScores[1].node : null;

  // Generate cascade description
  const cascade = primary ? describeCascade(primary, second) : null;

  return {
    nodes: nodeScores,
    primaryNode: primary,
    cascade,
  };
}

function describeCascade(primary: IFMNodeId, second: IFMNodeId | null): string {
  const cascades: Partial<Record<IFMNodeId, Partial<Record<IFMNodeId, string>>>> = {
    assimilation: {
      defense_repair: "Gut permeability → immune activation cascade. Undigested particles crossing the gut lining are driving systemic inflammation.",
      communication: "Gut dysbiosis → hormone metabolism disruption. The microbiome is affecting oestrogen recycling and neurotransmitter production.",
      energy: "Poor absorption → nutrient deficiencies driving fatigue. Fix digestion first before adding supplements.",
    },
    defense_repair: {
      communication: "Chronic inflammation → HPA axis dysregulation. The immune load is suppressing hormone production and disrupting signalling.",
      energy: "Inflammatory cytokines are suppressing mitochondrial function. Energy will not return until inflammation comes down.",
      structural: "Inflammatory mediators are breaking down connective tissue and joints.",
    },
    energy: {
      communication: "Mitochondrial/metabolic dysfunction is disrupting hormone signalling — particularly thyroid and sex hormones.",
      transport: "Low cellular energy is impairing circulation and cardiovascular function.",
      structural: "Chronic energy deficit is leading to muscle wasting and poor tissue repair.",
    },
    biotransformation: {
      communication: "Impaired detox → hormone accumulation (especially oestrogen). Poor methylation is affecting neurotransmitter balance.",
      defense_repair: "Toxic load is triggering immune reactivity and inflammation.",
    },
    transport: {
      energy: "Poor oxygen/nutrient delivery from circulation problems is compounding the energy deficit.",
    },
    communication: {
      energy: "Hormone dysregulation (thyroid, cortisol, insulin) is the primary driver of fatigue and metabolic disruption.",
      assimilation: "Stress hormones are slowing gastric motility and disrupting gut barrier function.",
      structural: "Hormonal imbalance is affecting bone density and muscle mass.",
    },
  };

  const desc = second ? cascades[primary]?.[second] : null;
  if (desc) return desc;

  // Generic descriptions
  const generic: Record<IFMNodeId, string> = {
    assimilation: "Gut health is the primary focus — address absorption and microbiome before adding other interventions.",
    defense_repair: "Chronic inflammation is the central driver — identify and remove triggers before adding supplements.",
    energy: "Mitochondrial and metabolic health is the foundation — support energy production before addressing downstream symptoms.",
    biotransformation: "Liver and detox pathways are under load — support elimination before addressing hormone balance.",
    transport: "Cardiovascular and blood health is implicated — assess circulation and oxygen delivery.",
    communication: "Hormonal and neurotransmitter signalling is the primary node — rebalancing signals before addressing structural issues.",
    structural: "Structural integrity is affected — assess nutrient status (minerals, collagen, omega-3) supporting tissue health.",
  };
  return generic[primary];
}

// ── Lab pattern recognition ──────────────────────────────────────────────────

export interface LabPattern {
  id: string;
  title: string;
  detail: string;
  severity: "info" | "warning" | "flag";
  node: IFMNodeId;
  value?: string;
}

export function detectLabPatterns(
  labs: ExtractedLab[],
  ratios: ComputedRatio[]
): LabPattern[] {
  const patterns: LabPattern[] = [];

  // Normalise lab name for matching
  const find = (keywords: string[]): ExtractedLab | undefined => {
    const lower = keywords.map((k) => k.toLowerCase());
    return labs.find((l) => lower.some((k) => l.test_name.toLowerCase().includes(k)));
  };

  const findRatio = (keyword: string): ComputedRatio | undefined => {
    const lower = keyword.toLowerCase();
    return ratios.find((r) => r.marker_name.toLowerCase().includes(lower));
  };

  const parseNum = (v: string | undefined): number | null => {
    if (!v) return null;
    const n = parseFloat(v.replace(/[^0-9.-]/g, ""));
    return isNaN(n) ? null : n;
  };

  // ── Thyroid ──────────────────────────────────────────────────────────────
  const tsh = find(["tsh", "thyroid stimulating"]);
  const tshVal = parseNum(tsh?.value);
  if (tshVal !== null) {
    if (tshVal > 2.0 && tshVal <= 4.5) {
      patterns.push({
        id: "subclinical_hypothyroid",
        title: "Subclinical hypothyroid pattern",
        detail: `TSH ${tshVal} mIU/L — lab range says 'normal' but FM optimal is 1.0–2.0. Worth monitoring T3, fT3, reverse T3, and TPO antibodies.`,
        severity: "warning",
        node: "communication",
        value: `TSH ${tshVal}`,
      });
    } else if (tshVal > 4.5) {
      patterns.push({
        id: "elevated_tsh",
        title: "Elevated TSH — hypothyroid",
        detail: `TSH ${tshVal} mIU/L is above range. Check fT3, fT4, and TPO antibodies if not already done.`,
        severity: "flag",
        node: "communication",
        value: `TSH ${tshVal}`,
      });
    }
  }

  const ft3 = find(["ft3", "free t3", "triiodothyronine"]);
  const ft4 = find(["ft4", "free t4", "thyroxine"]);
  const ft3Val = parseNum(ft3?.value);
  const ft4Val = parseNum(ft4?.value);
  if (ft3Val !== null && ft4Val !== null && ft4Val > 0) {
    const ratio = ft3Val / ft4Val;
    if (ratio < 0.2) {
      patterns.push({
        id: "poor_t4_t3_conversion",
        title: "Poor T4→T3 conversion",
        detail: `fT3:fT4 ratio is ${ratio.toFixed(2)} (optimal >0.25). Common causes: low selenium/zinc/iron, chronic stress, inflammation, elevated cortisol.`,
        severity: "warning",
        node: "energy",
        value: `fT3 ${ft3Val}, fT4 ${ft4Val}`,
      });
    }
  }

  // ── Iron ─────────────────────────────────────────────────────────────────
  const ferritin = find(["ferritin"]);
  const ferritinVal = parseNum(ferritin?.value);
  if (ferritinVal !== null) {
    if (ferritinVal < 30) {
      patterns.push({
        id: "iron_deficiency_ferritin",
        title: "Iron deficiency (FM range)",
        detail: `Ferritin ${ferritinVal} ng/mL — FM optimal is ≥50–70. Even without anaemia, low ferritin causes fatigue, hair loss, and impaired thyroid conversion.`,
        severity: ferritinVal < 15 ? "flag" : "warning",
        node: "transport",
        value: `Ferritin ${ferritinVal}`,
      });
    }
  }

  // ── B12 ──────────────────────────────────────────────────────────────────
  const b12 = find(["b12", "cobalamin", "vitamin b-12"]);
  const b12Val = parseNum(b12?.value);
  if (b12Val !== null && b12Val < 400) {
    patterns.push({
      id: "functional_b12_deficiency",
      title: "Functional B12 deficiency",
      detail: `B12 ${b12Val} pg/mL — lab 'normal' range starts at ~200, but FM optimal is >500. Functional deficiency causes fatigue, neuropathy, mood issues, and elevated homocysteine.`,
      severity: b12Val < 250 ? "flag" : "warning",
      node: "energy",
      value: `B12 ${b12Val}`,
    });
  }

  // ── Vitamin D ─────────────────────────────────────────────────────────────
  const vitD = find(["vitamin d", "25-oh", "25(oh)", "cholecalciferol"]);
  const vitDVal = parseNum(vitD?.value);
  if (vitDVal !== null) {
    if (vitDVal < 30) {
      patterns.push({
        id: "vitamin_d_deficiency",
        title: "Vitamin D deficient",
        detail: `25-OH-D3 ${vitDVal} ng/mL — clinically deficient. Affects immunity, bone density, mood, insulin sensitivity, and thyroid function.`,
        severity: "flag",
        node: "defense_repair",
        value: `Vitamin D ${vitDVal}`,
      });
    } else if (vitDVal < 50) {
      patterns.push({
        id: "vitamin_d_insufficiency",
        title: "Vitamin D insufficiency",
        detail: `25-OH-D3 ${vitDVal} ng/mL — lab 'sufficient' but FM optimal is 50–70. Insufficiency affects immune regulation, mood, and bone health.`,
        severity: "warning",
        node: "defense_repair",
        value: `Vitamin D ${vitDVal}`,
      });
    }
  }

  // ── Insulin / blood sugar ──────────────────────────────────────────────────
  const insulin = find(["fasting insulin", "insulin (fasting)", "serum insulin"]);
  const insulinVal = parseNum(insulin?.value);
  if (insulinVal !== null && insulinVal > 8) {
    patterns.push({
      id: "early_insulin_resistance",
      title: "Early insulin resistance",
      detail: `Fasting insulin ${insulinVal} μIU/mL — FM optimal is ≤5. Elevated insulin with normal glucose indicates early insulin resistance, years before glucose rises.`,
      severity: insulinVal > 15 ? "flag" : "warning",
      node: "energy",
      value: `Fasting insulin ${insulinVal}`,
    });
  }

  // ── Computed ratios ────────────────────────────────────────────────────────
  const homaIR = findRatio("homa-ir");
  const homaVal = homaIR ? parseNum(String(homaIR.value)) : null;
  if (homaVal !== null && homaVal > 1.5) {
    patterns.push({
      id: "homa_ir",
      title: "HOMA-IR elevated — insulin resistance",
      detail: `HOMA-IR ${homaVal.toFixed(2)} — values >1.5 indicate insulin resistance; >2.5 is significant. Key driver of fatigue, weight gain, and hormone imbalance.`,
      severity: homaVal > 2.5 ? "flag" : "warning",
      node: "energy",
      value: `HOMA-IR ${homaVal.toFixed(2)}`,
    });
  }

  const tgHdl = findRatio("tg/hdl") ?? findRatio("triglyceride");
  if (tgHdl && tgHdl.marker_name.toLowerCase().includes("tg")) {
    const tgHdlVal = parseNum(String(tgHdl.value));
    if (tgHdlVal !== null && tgHdlVal > 2.0) {
      patterns.push({
        id: "tg_hdl",
        title: "TG:HDL ratio elevated — metabolic risk",
        detail: `TG/HDL ${tgHdlVal.toFixed(1)} — above 2.0 indicates insulin resistance and atherogenic risk. Often precedes HbA1c changes by years.`,
        severity: tgHdlVal > 3.5 ? "flag" : "warning",
        node: "transport",
        value: `TG/HDL ${tgHdlVal.toFixed(1)}`,
      });
    }
  }

  // ── Inflammation ──────────────────────────────────────────────────────────
  const crp = find(["hs-crp", "hscrp", "high sensitivity crp", "hsCRP", "c-reactive protein"]);
  const crpVal = parseNum(crp?.value);
  if (crpVal !== null && crpVal > 1.0) {
    patterns.push({
      id: "elevated_crp",
      title: "Elevated hsCRP — systemic inflammation",
      detail: `hsCRP ${crpVal} mg/L — FM optimal <0.5. Chronic low-grade inflammation drives fatigue, hormone disruption, insulin resistance, and accelerated ageing.`,
      severity: crpVal > 3.0 ? "flag" : "warning",
      node: "defense_repair",
      value: `hsCRP ${crpVal}`,
    });
  }

  // ── Homocysteine ──────────────────────────────────────────────────────────
  const hcy = find(["homocysteine"]);
  const hcyVal = parseNum(hcy?.value);
  if (hcyVal !== null && hcyVal > 10) {
    patterns.push({
      id: "elevated_homocysteine",
      title: "Elevated homocysteine — methylation concern",
      detail: `Homocysteine ${hcyVal} μmol/L — FM optimal <7. Elevated homocysteine signals B12/folate/B6 deficiency or MTHFR polymorphism, increasing cardiovascular and cognitive risk.`,
      severity: hcyVal > 15 ? "flag" : "warning",
      node: "biotransformation",
      value: `Homocysteine ${hcyVal}`,
    });
  }

  // ── DHEA-S ────────────────────────────────────────────────────────────────
  const dhea = find(["dhea-s", "dheas", "dehydroepiandrost"]);
  if (dhea?.flag === "low") {
    patterns.push({
      id: "low_dhea",
      title: "Low DHEA-S — adrenal reserve low",
      detail: `DHEA-S ${dhea.value} — below optimal range. DHEA is the adrenal 'reserve tank'. Low DHEA indicates HPA axis suppression and reduced resilience to stress.`,
      severity: "warning",
      node: "communication",
      value: `DHEA-S ${dhea.value}`,
    });
  }

  // ── Magnesium ─────────────────────────────────────────────────────────────
  const mg = find(["magnesium", "serum magnesium"]);
  const mgVal = parseNum(mg?.value);
  if (mgVal !== null && mgVal < 0.85) {
    patterns.push({
      id: "low_magnesium",
      title: "Functional magnesium deficiency",
      detail: `Serum magnesium ${mgVal} mmol/L — serum is a poor marker (only 1% of body magnesium is in blood), but even borderline low is significant. Magnesium is required for 300+ enzymatic reactions.`,
      severity: "info",
      node: "energy",
      value: `Mg ${mgVal}`,
    });
  }

  // ── CBC pattern recognition ──────────────────────────────────────────────
  // Read CBC components once; many patterns combine multiple markers.
  const hgb = find(["hemoglobin", "hgb", "hb "]);
  const hgbVal = parseNum(hgb?.value);
  const mcv = find(["mcv", "mean corpuscular volume", "mean cell volume"]);
  const mcvVal = parseNum(mcv?.value);
  const rdw = find(["rdw"]);
  const rdwVal = parseNum(rdw?.value);
  const wbc = find(["wbc", "white blood cell", "total leucocyte", "tlc"]);
  const wbcVal = parseNum(wbc?.value);
  const neut = find(["neutrophil", "absolute neutrophil", "anc"]);
  const neutVal = parseNum(neut?.value);
  const lymph = find(["lymphocyte", "absolute lymphocyte"]);
  const lymphVal = parseNum(lymph?.value);
  const eos = find(["eosinophil"]);
  const eosVal = parseNum(eos?.value);
  const platelets = find(["platelet"]);
  const plateletVal = parseNum(platelets?.value);
  const tibc = find(["tibc", "total iron binding"]);
  const tibcVal = parseNum(tibc?.value);
  const tsat = find(["tsat", "transferrin saturation", "% saturation"]);
  const tsatVal = parseNum(tsat?.value);
  const ironSerum = find(["serum iron", "iron level"]);
  const ironVal = parseNum(ironSerum?.value);

  // CBC #1 — Iron deficiency by MCV+RDW (catches it BEFORE ferritin drops)
  if (mcvVal !== null && rdwVal !== null && mcvVal < 80 && rdwVal > 14.5) {
    const established = hgbVal !== null && hgbVal < 12;
    patterns.push({
      id: "cbc_iron_deficiency_pattern",
      title: established
        ? "Iron-deficiency anaemia (CBC pattern)"
        : "Early iron deficiency (CBC pattern)",
      detail: `MCV ${mcvVal} fL (low, < 80) + RDW ${rdwVal}% (high, > 14.5)${established ? ` + Hgb ${hgbVal} g/dL (low)` : ""} — classic iron-deficiency CBC signature${established ? ", anaemia present" : "; anaemia hasn't yet developed"}. Confirm with full iron studies (ferritin + TIBC + TSAT).`,
      severity: established ? "flag" : "warning",
      node: "transport",
      value: `MCV ${mcvVal}, RDW ${rdwVal}`,
    });
  }

  // CBC #2 — B12 / folate deficiency by MCV (macrocytic) + Hgb
  if (mcvVal !== null && mcvVal > 100) {
    const anaemic = hgbVal !== null && hgbVal < 12;
    patterns.push({
      id: "cbc_macrocytic_pattern",
      title: anaemic ? "Macrocytic anaemia (B12 / folate)" : "Macrocytic CBC (B12 / folate)",
      detail: `MCV ${mcvVal} fL (high, > 100)${anaemic ? ` + Hgb ${hgbVal} g/dL (low)` : ""} — suggests B12 / folate deficiency (most common FM cause). Other causes: hypothyroidism, alcohol use, MDS. Order B12, MMA (functional B12), folate, TSH.`,
      severity: anaemic ? "flag" : "warning",
      node: "energy",
      value: `MCV ${mcvVal}`,
    });
  }

  // CBC #3 — Mixed deficiency (normal MCV but elevated RDW — earliest signal)
  if (mcvVal !== null && rdwVal !== null && mcvVal >= 80 && mcvVal <= 100 && rdwVal > 14.5) {
    patterns.push({
      id: "cbc_mixed_deficiency",
      title: "Mixed nutritional deficiency (early)",
      detail: `MCV ${mcvVal} (normal) but RDW ${rdwVal}% (high, > 14.5) — RBC population is mixed. Classic early-mixed-deficiency signature: simultaneous iron + B12/folate dropout, before either deficiency dominates. Order ferritin, B12, folate.`,
      severity: "warning",
      node: "transport",
      value: `MCV ${mcvVal}, RDW ${rdwVal}`,
    });
  }

  // CBC #4 — Acute bacterial / inflammatory pattern (high WBC + high neutrophils)
  if (wbcVal !== null && wbcVal > 11 && neutVal !== null && neutVal > 7.5) {
    patterns.push({
      id: "cbc_bacterial_pattern",
      title: "Acute bacterial / inflammatory pattern",
      detail: `WBC ${wbcVal} × 10³/µL (high) + absolute neutrophils ${neutVal} × 10³/µL (high) — neutrophil-predominant leucocytosis. Suggests bacterial infection or acute inflammatory stress. If no infection symptoms, consider stress demargination, recent steroid, or significant tissue injury.`,
      severity: "flag",
      node: "defense_repair",
      value: `WBC ${wbcVal}, neut ${neutVal}`,
    });
  }

  // CBC #5 — Viral / immune-suppression pattern (low WBC + low neutrophils OR low lymphocytes)
  if (wbcVal !== null && wbcVal < 4) {
    const lowNeut = neutVal !== null && neutVal < 1.8;
    const lowLymph = lymphVal !== null && lymphVal < 1.0;
    if (lowNeut || lowLymph) {
      patterns.push({
        id: "cbc_viral_or_suppression_pattern",
        title: "Viral / immune-suppression CBC pattern",
        detail: `WBC ${wbcVal} (low)${lowNeut ? ` + absolute neutrophils ${neutVal} (low)` : ""}${lowLymph ? ` + lymphocytes ${lymphVal} (low)` : ""}. Pattern fits viral infection (acute/chronic), nutrient deficiency (B12, copper, folate), autoimmune (e.g. lupus), or marrow suppression. Repeat in 2 weeks if asymptomatic; if persistent, escalate.`,
        severity: "warning",
        node: "defense_repair",
        value: `WBC ${wbcVal}`,
      });
    }
  }

  // CBC #6 — Lymphocytosis pattern (viral / autoimmune)
  if (lymphVal !== null && wbcVal !== null && lymphVal > 4) {
    patterns.push({
      id: "cbc_lymphocytosis",
      title: "Lymphocyte-predominant CBC",
      detail: `Absolute lymphocytes ${lymphVal} × 10³/µL (high) — viral infection (acute or recovering), chronic viral (EBV reactivation, CMV, HIV), pertussis, or chronic lymphocytic process. Pair with EBV panel if persistent + fatigue / sore throat history.`,
      severity: "info",
      node: "defense_repair",
      value: `Lymph ${lymphVal}`,
    });
  }

  // CBC #7 — Eosinophilia (allergy / parasitic / atopic)
  if (eosVal !== null && eosVal > 0.5) {
    patterns.push({
      id: "cbc_eosinophilia",
      title: "Eosinophilia",
      detail: `Absolute eosinophils ${eosVal} × 10³/µL (high, > 0.5) — atopic / allergic inflammation, parasitic infection (consider stool O&P), or drug reaction. > 1.5 needs workup. Common in chronic urticaria, asthma, food sensitivities.`,
      severity: eosVal > 1.5 ? "warning" : "info",
      node: "defense_repair",
      value: `Eos ${eosVal}`,
    });
  }

  // CBC #8 — Reactive thrombocytosis (high platelets + inflammation/iron deficiency)
  if (plateletVal !== null && plateletVal > 450) {
    const reactive = (crpVal !== null && crpVal > 1) || (ferritinVal !== null && ferritinVal < 30);
    patterns.push({
      id: "cbc_thrombocytosis",
      title: reactive ? "Reactive thrombocytosis" : "Thrombocytosis",
      detail: `Platelets ${plateletVal} × 10³/µL (high)${reactive ? " + inflammation or iron-deficiency markers present" : ""} — most commonly reactive (inflammation, iron deficiency, post-bleed, post-splenectomy). Persistent > 450 with no obvious cause needs haematology referral to exclude essential thrombocythaemia.`,
      severity: plateletVal > 600 ? "warning" : "info",
      node: "transport",
      value: `Plt ${plateletVal}`,
    });
  }

  // ── Iron studies pattern (Fe + TIBC + TSAT + ferritin) ──────────────────
  if (ferritinVal !== null && tibcVal !== null && tsatVal !== null && ferritinVal < 30 && tibcVal > 380 && tsatVal < 20) {
    patterns.push({
      id: "iron_deficiency_full_pattern",
      title: "Iron deficiency (full iron-studies pattern)",
      detail: `Ferritin ${ferritinVal} (low) + TIBC ${tibcVal} (high, compensatory rise) + TSAT ${tsatVal}% (low) ${ironVal !== null ? `+ serum iron ${ironVal} ` : ""}— textbook iron-deficiency signature. Identify source (menstrual loss, GI loss, malabsorption, low intake) before supplementing.`,
      severity: "flag",
      node: "transport",
      value: `Ferritin ${ferritinVal}, TSAT ${tsatVal}%`,
    });
  } else if (tsatVal !== null && tsatVal > 50 && ferritinVal !== null && ferritinVal > 200) {
    patterns.push({
      id: "iron_overload_pattern",
      title: "Iron overload pattern",
      detail: `TSAT ${tsatVal}% (high, > 50) + ferritin ${ferritinVal} ng/mL (high) — possible hemochromatosis or iron overload. Confirm with HFE genetic testing; assess liver enzymes, glucose, joint symptoms.`,
      severity: "flag",
      node: "transport",
      value: `Ferritin ${ferritinVal}, TSAT ${tsatVal}%`,
    });
  }

  // ── NLR (computed from neutrophils ÷ lymphocytes) — chronic inflammation ──
  if (neutVal !== null && lymphVal !== null && lymphVal > 0) {
    const nlr = neutVal / lymphVal;
    // Only flag if not already caught by acute bacterial pattern above
    const acuteBacterialDetected = patterns.some((p) => p.id === "cbc_bacterial_pattern");
    if (nlr > 3 && !acuteBacterialDetected) {
      patterns.push({
        id: "elevated_nlr",
        title: "Elevated NLR — chronic inflammation / stress",
        detail: `Neutrophil/Lymphocyte ratio ${nlr.toFixed(1)} (FM optimal < 2, > 3 abnormal). Persistently high NLR with no acute infection signals chronic low-grade inflammation, sympathetic / cortisol overdrive, or post-viral state. Independent predictor of CV mortality.`,
        severity: nlr > 5 ? "warning" : "info",
        node: "defense_repair",
        value: `NLR ${nlr.toFixed(1)}`,
      });
    }
  }

  return patterns;
}
