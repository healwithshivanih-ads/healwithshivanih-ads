/**
 * dirty-genes-prefill.ts — PURE overlay logic (P2). The client's record already
 * holds the answers; this pre-flags pathways so the coach confirms rather than
 * re-enters. Validated on 4 clients:
 *   - Hariharan: homocysteine 22 → MTHFR HIGH (symptom quiz alone: mild)
 *   - Geetika:   "histamine intolerance" condition → DAO items pre-ticked
 *   - Sudarshan: NAFLD condition → PEMT; dyslipidaemia/BP → NOS3
 *
 * Two overlays:
 *   LAB       → escalates a pathway band (returns DgLabFlag, never auto-ticks)
 *   CONDITION → pre-ticks questionnaire items (coach can untick)
 *
 * No fs — the server (page.tsx) extracts the plain fields and calls this.
 * Gene language never leaves this layer for the client; it only drives the
 * coach-side screen.
 */

import type { DgBand, DgLabFlag } from "@/lib/fmdb/dirty-genes";

export interface PrefillInput {
  /** lowercased marker name → most-recent numeric value */
  labValues: Record<string, number>;
  /** active_conditions + reported_triggers + foods_to_avoid, joined + lowercased */
  conditionsText: string;
  /** client.dietary_preference (lowercased) */
  dietaryPreference: string;
}

export interface PrefillProvenance {
  pathwayId: string;
  source: "lab" | "condition" | "diet";
  evidence: string;
}

export interface PrefillResult {
  /** questionnaire item ids to pre-tick */
  autoChecked: string[];
  /** lab escalations (feed to scoreAssessment) */
  labFlags: DgLabFlag[];
  provenance: PrefillProvenance[];
}

/** Short pathway labels for at-a-glance surfaces (Overview card). */
export const PATHWAY_LABEL: Record<string, string> = {
  mthfr: "Methylation (MTHFR)",
  comt: "Catechols (COMT)",
  dao: "Histamine (DAO)",
  maoa: "Monoamines (MAOA)",
  gst_gpx: "Detox (GST/GPX)",
  nos3: "Circulation (NOS3)",
  pemt: "Choline (PEMT)",
};

/** Whether the client's record trips the screen at all — drives the Overview
 *  card's self-hide (mirrors tier1-advisory: show only when something fires). */
export function prefillHasSignal(p: PrefillResult): boolean {
  return p.labFlags.length > 0 || p.autoChecked.length > 0;
}

/** Unique pathway ids that the record flags (lab or condition/diet), most
 *  objective (lab) first — for the Overview card chips. */
export function prefillFlaggedPathways(p: PrefillResult): Array<{ pathwayId: string; label: string; source: "lab" | "condition" | "diet" }> {
  const seen = new Set<string>();
  const out: Array<{ pathwayId: string; label: string; source: "lab" | "condition" | "diet" }> = [];
  const push = (pid: string, source: "lab" | "condition" | "diet") => {
    if (seen.has(pid)) return;
    seen.add(pid);
    out.push({ pathwayId: pid, label: PATHWAY_LABEL[pid] ?? pid, source });
  };
  for (const f of p.labFlags) push(f.pathwayId, "lab");
  for (const pr of p.provenance) if (pr.source !== "lab") push(pr.pathwayId, pr.source);
  return out;
}

// ---- LAB signals: marker substrings + threshold → pathway escalation --------

interface LabRule {
  pathwayId: string;
  markers: string[]; // substrings matched against marker names (lowercased)
  op: ">" | "<";
  value: number;
  escalateTo: DgBand;
  note: string;
}

const LAB_RULES: LabRule[] = [
  { pathwayId: "mthfr", markers: ["homocysteine"], op: ">", value: 10, escalateTo: "high",
    note: "Elevated homocysteine — methylation cycle under strain" },
  { pathwayId: "mthfr", markers: ["tsh"], op: ">", value: 4, escalateTo: "moderate",
    note: "Raised TSH — hypothyroidism blunts B2 activation, worsening MTHFR" },
  { pathwayId: "nos3", markers: ["blood pressure - systolic", "systolic"], op: ">", value: 135, escalateTo: "moderate",
    note: "Elevated systolic BP" },
  { pathwayId: "nos3", markers: ["cholesterol - ldl", "ldl cholesterol"], op: ">", value: 130, escalateTo: "moderate",
    note: "Elevated LDL — endothelial/cardiovascular load" },
  { pathwayId: "nos3", markers: ["apob"], op: ">", value: 100, escalateTo: "moderate",
    note: "Elevated ApoB — atherogenic particle burden" },
];

// ---- CONDITION signals: keyword → item pre-ticks -----------------------------

interface CondRule {
  pathwayId: string;
  patterns: RegExp[];
  ticks: string[];
  evidence: string;
}

const COND_RULES: CondRule[] = [
  { pathwayId: "mthfr", patterns: [/elevated homocysteine|hyperhomocystein|functional b12/i],
    ticks: ["mthfr_homocysteine"], evidence: "elevated homocysteine / functional B12 in record" },
  { pathwayId: "dao", patterns: [/histamine intoleran|antihistamine|allegra|cetirizine|\bhives\b|urticaria|mast cell|\bflush/i],
    ticks: ["dao_food_react", "dao_flush"], evidence: "histamine intolerance documented" },
  { pathwayId: "dao", patterns: [/multiple food intoleran|food sensitivit|leftover|fermented/i],
    ticks: ["dao_gut", "dao_leftovers"], evidence: "food intolerances / leftover reactions" },
  { pathwayId: "comt", patterns: [/anxiety|can'?t switch off|mind runs|racing thoughts|overstimulat/i],
    ticks: ["comt_overstimulated", "comt_stress_reactive"], evidence: "anxiety / overstimulation" },
  { pathwayId: "comt", patterns: [/insomnia|sleeplessness|can'?t sleep/i],
    ticks: ["comt_overstimulated"], evidence: "sleep difficulty" },
  { pathwayId: "comt", patterns: [/\bpcos\b|estrogen dominan|\bpms\b|pmdd|heavy period|fibroid/i],
    ticks: ["comt_estrogen"], evidence: "estrogen-pattern / PCOS" },
  { pathwayId: "nos3", patterns: [/hypertension|high blood pressure/i],
    ticks: ["nos3_bp"], evidence: "hypertension documented" },
  { pathwayId: "pemt", patterns: [/nafld|fatty liver|gallbladder|gallstone|bile/i],
    ticks: ["pemt_gallbladder"], evidence: "fatty liver / gallbladder issue" },
  { pathwayId: "gst_gpx", patterns: [/chemical sensitiv|multiple chemical|\bmcs\b|\bmould\b|\bmold\b/i],
    ticks: ["gst_chem_sensitive", "gst_mould"], evidence: "chemical / mould sensitivity" },
  { pathwayId: "maoa", patterns: [/mood swing|bipolar/i],
    ticks: ["maoa_mood_swings"], evidence: "mood swings documented" },
];

function passes(v: number, op: ">" | "<", t: number): boolean {
  return op === ">" ? v > t : v < t;
}

/** Extract PrefillInput from a raw client dict (health_snapshots + structured
 *  fields). Pure — shared by the screen page and the Overview card so they can
 *  never disagree on what the record says. */
export function extractPrefillInput(client: Record<string, unknown>): PrefillInput {
  const labValues: Record<string, number> = {};
  const snaps = (client.health_snapshots as Array<Record<string, unknown>>) ?? [];
  for (const snap of snaps) {
    for (const lv of (snap.lab_values as Array<Record<string, unknown>>) ?? []) {
      const name = String(lv.test_name ?? "").trim().toLowerCase();
      const num = typeof lv.value === "number" ? lv.value : parseFloat(String(lv.value ?? ""));
      if (name && !Number.isNaN(num)) labValues[name] = num; // later snapshot wins
    }
  }
  const toText = (v: unknown): string =>
    typeof v === "string" ? v : Array.isArray(v) ? v.filter((x) => typeof x === "string").join(" · ") : "";
  const conditionsText = [
    toText(client.active_conditions),
    toText(client.reported_triggers),
    toText(client.foods_to_avoid),
    toText(client.medical_history),
  ]
    .join(" · ")
    .toLowerCase();
  return {
    labValues,
    conditionsText,
    dietaryPreference: String(client.dietary_preference ?? "").toLowerCase(),
  };
}

export function computePrefill(input: PrefillInput): PrefillResult {
  const autoChecked = new Set<string>();
  const labFlags: DgLabFlag[] = [];
  const provenance: PrefillProvenance[] = [];

  // LAB overlay
  for (const rule of LAB_RULES) {
    for (const [name, val] of Object.entries(input.labValues)) {
      if (typeof val !== "number" || Number.isNaN(val)) continue;
      if (!rule.markers.some((m) => name.includes(m))) continue;
      if (!passes(val, rule.op, rule.value)) continue;
      labFlags.push({ pathwayId: rule.pathwayId, escalateTo: rule.escalateTo, marker: name, value: val, note: rule.note });
      provenance.push({ pathwayId: rule.pathwayId, source: "lab", evidence: `${name} ${val} — ${rule.note}` });
      break; // one match per rule is enough
    }
  }

  // CONDITION overlay
  const text = input.conditionsText;
  for (const rule of COND_RULES) {
    if (!rule.patterns.some((re) => re.test(text))) continue;
    for (const t of rule.ticks) autoChecked.add(t);
    provenance.push({ pathwayId: rule.pathwayId, source: "condition", evidence: rule.evidence });
  }

  // DIET overlay — vegetarian/vegan raises choline demand (PEMT). Eggetarian/
  // non-veg have egg-yolk choline, so they don't trip it.
  const diet = input.dietaryPreference;
  if (/vegan/.test(diet) || (/vegetarian/.test(diet) && !/egg/.test(diet))) {
    autoChecked.add("pemt_low_choline_diet");
    provenance.push({ pathwayId: "pemt", source: "diet", evidence: `${input.dietaryPreference} — low dietary choline` });
  }

  return { autoChecked: [...autoChecked], labFlags, provenance };
}
