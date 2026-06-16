/**
 * Weight-loss readiness gate (#4) — who you should promise weight loss to.
 *
 * A calorie deficit laid on top of an unaddressed metabolic/hormonal blocker
 * doesn't move the scale — the body defends its weight. The drivers are
 * already detected elsewhere (lab_ratios.py, the suggester) but nothing GATES
 * on them, so a client whose thyroid will defeat the plan still gets promised
 * loss. This reads what's on the client record and surfaces the blockers to
 * the coach BEFORE / during a weight-loss goal:
 *
 *   - Thyroid not at FM-optimal (TSH > 2.5; worse if on thyroid meds + still high)
 *   - Insulin resistance (HOMA-IR / fasting insulin / glucose / HbA1c)
 *   - Weight-gain / metabolism-blunting medications
 *   - Poor sleep / high stress (cortisol → visceral fat retention)
 *   - Perimenopause (estrogen decline → visceral shift + muscle loss)
 *
 * Pure + dependency-free. Reads ONLY data already on the client object; it
 * never fabricates a flag from missing data. A Python-side caveat block lives
 * in render-client-letter.py so the letter sets honest expectations + sequences
 * root-cause work.
 *
 * SCOPE: this is coaching decision-support — it flags what to address and what
 * to refer, it does NOT diagnose or change a prescription. Medication flags say
 * "coordinate with the prescriber", never "stop".
 */

export type ReadinessSeverity = "high" | "med" | "info";

export interface ReadinessFlag {
  key: string;
  severity: ReadinessSeverity;
  label: string;
  detail: string;
}

export type ReadinessVerdict = "ready" | "caution" | "address_first";

export interface WeightLossReadiness {
  /** "no_goal" sentinel via flags=[] + verdict "ready" is avoided — callers
   *  check hasGoal separately; this assessor runs regardless of goal so it
   *  can also gate goal SETUP. */
  verdict: ReadinessVerdict;
  flags: ReadinessFlag[];
  /** Which checks had data to run (for an honest "we looked at…" line). */
  considered: string[];
  /** Checks we couldn't run for lack of data (e.g. no thyroid labs on file). */
  missing: string[];
}

interface SnapLab {
  test_name?: string;
  value?: string | number | null;
  unit?: string | null;
}
interface ClientLike {
  sex?: string;
  date_of_birth?: string | null;
  age_band?: string | null;
  medications?: string[] | null;
  current_medications?: string[] | null;
  five_pillars?: {
    sleep_hours?: number;
    sleep_quality?: number;
    stress_level?: number;
  } | null;
  health_snapshots?: Array<{
    date?: string;
    lab_values?: SnapLab[] | null;
  }> | null;
}

/** Latest numeric value for a marker matching `re`, scanning snapshots newest-
 *  first. Returns null when no snapshot carries a parseable value. */
function latestLabValue(client: ClientLike, re: RegExp): { value: number; date: string } | null {
  const snaps = [...(client.health_snapshots ?? [])]
    .filter((s) => s && Array.isArray(s.lab_values))
    .sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
  for (const s of snaps) {
    for (const lv of s.lab_values ?? []) {
      const name = (lv?.test_name ?? "").trim();
      if (!name || !re.test(name)) continue;
      const raw = lv?.value;
      const num = typeof raw === "number" ? raw : parseFloat(String(raw ?? "").replace(/[, ]/g, ""));
      if (Number.isFinite(num)) return { value: num, date: String(s.date ?? "") };
    }
  }
  return null;
}

function clientAge(client: ClientLike): number | null {
  if (client.date_of_birth) {
    const t = Date.parse(client.date_of_birth);
    if (!Number.isNaN(t)) return Math.floor((Date.now() - t) / (365 * 24 * 60 * 60 * 1000));
  }
  if (client.age_band) {
    const parts = client.age_band.split("-").map((n) => parseInt(n, 10));
    if (parts.length === 2 && parts.every((n) => !Number.isNaN(n))) {
      return Math.floor((parts[0] + parts[1]) / 2);
    }
  }
  return null;
}

/** Curated weight-gain / metabolism-blunting drugs (generic-name substrings,
 *  lowercase) → mechanism note. Deliberately a focused list, not the whole
 *  catalogue: the point is to flag the common offenders for this population. */
const WEIGHT_GAIN_DRUGS: Array<{ match: string[]; note: string }> = [
  {
    match: ["mirtazapine", "amitriptyline", "nortriptyline", "imipramine", "paroxetine"],
    note: "antidepressant strongly linked to appetite ↑ / weight gain",
  },
  {
    match: ["sertraline", "citalopram", "escitalopram", "fluoxetine", "venlafaxine", "duloxetine", "trazodone"],
    note: "SSRI/SNRI — can drive carb cravings / modest weight gain",
  },
  {
    match: ["olanzapine", "quetiapine", "risperidone", "clozapine", "aripiprazole"],
    note: "atypical antipsychotic — appetite ↑ + insulin resistance",
  },
  {
    match: ["lithium", "valproate", "valproic", "divalproex", "gabapentin", "pregabalin"],
    note: "mood-stabiliser / neuro agent linked to weight gain",
  },
  {
    match: ["prednisolone", "prednisone", "dexamethasone", "hydrocortisone", "betamethasone", "methylprednisolone", "wysolone", "omnacortil"],
    note: "corticosteroid — central adiposity, appetite ↑, insulin resistance",
  },
  {
    match: ["propranolol", "atenolol", "metoprolol", "bisoprolol", "nebivolol"],
    note: "beta-blocker — lowers metabolic rate + blunts exercise capacity",
  },
  {
    match: ["insulin", "glipizide", "glimepiride", "gliclazide", "glibenclamide", "pioglitazone", "amaryl"],
    note: "diabetes drug that promotes weight gain (vs metformin/GLP-1, which don't)",
  },
];

export function assessWeightLossReadiness(client: ClientLike): WeightLossReadiness {
  const flags: ReadinessFlag[] = [];
  const considered: string[] = [];
  const missing: string[] = [];

  const meds = [
    ...(client.current_medications ?? []),
    ...(client.medications ?? []),
  ]
    .filter(Boolean)
    .map((m) => String(m));
  const medsLower = meds.map((m) => m.toLowerCase());

  // ── Thyroid ────────────────────────────────────────────────────────────
  const tsh = latestLabValue(client, /\btsh\b|thyroid.?stimulating|thyrotropin/i);
  const onThyroidMed = medsLower.some((m) =>
    /levothyrox|thyronorm|eltroxin|thyroxine|liothyron|synthroid|euthyrox/.test(m),
  );
  if (tsh) {
    considered.push("thyroid (TSH)");
    if (tsh.value > 4.0) {
      flags.push({
        key: "thyroid",
        severity: "high",
        label: `Thyroid underactive — TSH ${tsh.value}`,
        detail: onThyroidMed
          ? `On thyroid medication but TSH is still ${tsh.value} (FM-optimal < 2.5). Under-replaced thyroid will blunt weight loss — flag for a dose review before promising loss.`
          : `TSH ${tsh.value} is frankly high (FM-optimal < 2.5). Hypothyroidism defends body weight; weight loss will be slow until thyroid is addressed — refer / re-test before an aggressive deficit.`,
      });
    } else if (tsh.value > 2.5) {
      flags.push({
        key: "thyroid",
        severity: "med",
        label: `TSH ${tsh.value} above FM-optimal`,
        detail: `TSH ${tsh.value} is in the lab-normal but FM-suboptimal range (target < 2.5)${onThyroidMed ? ", despite thyroid medication" : ""}. Expect a slower pace; support thyroid (selenium, iodine status, T3 conversion) alongside the deficit.`,
      });
    }
  } else {
    missing.push("thyroid labs (no TSH on file)");
  }

  // ── Insulin resistance ───────────────────────────────────────────────────
  const insulin = latestLabValue(client, /fasting.*insulin|insulin.*fasting|\binsulin\b/i);
  const glucose = latestLabValue(client, /fasting.*glucose|glucose.*fasting|fasting.*sugar|\bfbs\b/i);
  const hba1c = latestLabValue(client, /hba1c|a1c|glycated|glycosylated/i);
  if (insulin || glucose || hba1c) {
    considered.push("insulin / glucose");
    let irFlag: ReadinessFlag | null = null;
    if (insulin && glucose) {
      const homa = (glucose.value * insulin.value) / 405;
      if (homa > 2.0)
        irFlag = mkIR("high", `Insulin resistance — HOMA-IR ${homa.toFixed(1)}`);
      else if (homa > 1.5)
        irFlag = mkIR("med", `Early insulin resistance — HOMA-IR ${homa.toFixed(1)}`);
    } else if (insulin) {
      if (insulin.value > 8) irFlag = mkIR("high", `High fasting insulin (${insulin.value})`);
      else if (insulin.value > 5) irFlag = mkIR("med", `Borderline fasting insulin (${insulin.value})`);
    }
    if (!irFlag && hba1c && hba1c.value >= 5.7) {
      irFlag = mkIR("med", `HbA1c ${hba1c.value}% — prediabetic range`);
    }
    if (!irFlag && glucose && glucose.value >= 100) {
      irFlag = mkIR("med", `Fasting glucose ${glucose.value} — impaired`);
    }
    if (irFlag) flags.push(irFlag);
  } else {
    missing.push("insulin / glucose labs");
  }

  // ── Weight-gain / metabolism-blunting medications ────────────────────────
  if (meds.length) considered.push("medications");
  for (const med of meds) {
    const m = med.toLowerCase();
    const hit = WEIGHT_GAIN_DRUGS.find((d) => d.match.some((name) => m.includes(name)));
    if (hit) {
      flags.push({
        key: `med:${med}`,
        severity: "med",
        label: `On ${med.trim()}`,
        detail: `${med.trim()} — ${hit.note}. Factor this into the expected pace and coordinate with the prescriber; do not just deepen the deficit to compensate.`,
      });
    }
  }

  // ── Cortisol / sleep / stress ────────────────────────────────────────────
  const fp = client.five_pillars ?? null;
  if (fp && (fp.sleep_hours != null || fp.sleep_quality != null || fp.stress_level != null)) {
    considered.push("sleep / stress");
    const poorSleep = (fp.sleep_hours != null && fp.sleep_hours < 6) || (fp.sleep_quality != null && fp.sleep_quality <= 2);
    const highStress = fp.stress_level != null && fp.stress_level >= 4;
    if (poorSleep || highStress) {
      const bits: string[] = [];
      if (fp.sleep_hours != null && fp.sleep_hours < 6) bits.push(`${fp.sleep_hours}h sleep`);
      if (fp.sleep_quality != null && fp.sleep_quality <= 2) bits.push("poor sleep quality");
      if (highStress) bits.push(`stress ${fp.stress_level}/5`);
      flags.push({
        key: "cortisol",
        severity: "med",
        label: `Sleep / stress load (${bits.join(", ")})`,
        detail: "Chronic stress + short sleep keep cortisol and insulin elevated, which retain visceral fat and stall loss regardless of the deficit. Prioritise sleep + stress regulation alongside — an aggressive cut here can backfire.",
      });
    }
  } else {
    missing.push("sleep / stress (no Five Pillars on file)");
  }

  // ── Perimenopause (informational) ────────────────────────────────────────
  const age = clientAge(client);
  const female = /^f/i.test(client.sex ?? "");
  if (female && age != null && age >= 44 && age <= 56) {
    considered.push("life stage");
    flags.push({
      key: "perimenopause",
      severity: "info",
      label: "Perimenopausal window",
      detail: "Falling estrogen shifts fat toward the middle and accelerates muscle loss. Lead with protein + resistance training and expect a slower, steadier pace — a steep deficit here loses muscle and stalls the scale.",
    });
  }

  // ── Verdict ──────────────────────────────────────────────────────────────
  const hasHigh = flags.some((f) => f.severity === "high");
  const hasMed = flags.some((f) => f.severity === "med");
  const verdict: ReadinessVerdict = hasHigh ? "address_first" : hasMed ? "caution" : "ready";

  return { verdict, flags, considered, missing };
}

function mkIR(severity: ReadinessSeverity, label: string): ReadinessFlag {
  return {
    key: "insulin_resistance",
    severity,
    label,
    detail:
      "Insulin resistance means the lever is carb quality + meal timing + protein, not calories alone — a straight deficit often won't move the scale. Build the meal plan around lower-glycaemic, protein-anchored meals and address IR directly.",
  };
}
