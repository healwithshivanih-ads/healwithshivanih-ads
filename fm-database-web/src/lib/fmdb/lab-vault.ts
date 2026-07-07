/**
 * Lab Vault — shared, pure lab view-model logic.
 *
 * Phase 1 of docs/LAB_VAULT_SPEC.md. Single source of truth for:
 *  - the range primitives (`rangeStatus`, `findCatalogueLabTest`) — previously
 *    private inside health-trends.tsx, now ported here so the coach UI AND the
 *    client app (/app/[token]) share one implementation.
 *  - `buildLabVault()` — turns a client's `health_snapshots` + the lab catalogue
 *    + per-client overrides into grouped, client-facing `LabMarker`s.
 *
 * Deliberately PURE: no React, no "use server", no fs. Imports from
 * server-actions/clients are type-only (erased at compile time) so this module
 * carries no server runtime into the client bundle.
 *
 * Client-facing status is two-state by design (anxiety guardrail): "optimal" /
 * "explore" — never "red"/"abnormal". The richer 3-state (optimal/conventional-
 * gap/outside) stays in the coach UI.
 */

import type { Client } from "@/lib/fmdb/types";
import type { CatalogueLabRange, LabReferenceRanges } from "@/lib/server-actions/clients";
import { LAB_PANELS } from "@/lib/fmdb/lab-panels";

export type LabSnapshot = NonNullable<Client["health_snapshots"]>[number];

// ── Range primitives (ported verbatim from health-trends.tsx) ─────────────────

export function rangeStatus(
  value: number,
  range?: { optimal_low?: number; optimal_high?: number },
): "optimal" | "outside" | null {
  if (!range) return null;
  const { optimal_low, optimal_high } = range;
  if (optimal_low == null && optimal_high == null) return null;
  const tooLow = optimal_low != null && value < optimal_low;
  const tooHigh = optimal_high != null && value > optimal_high;
  return tooLow || tooHigh ? "outside" : "optimal";
}

// ── Client-app sensitivity gate ───────────────────────────────────────────
// Markers too alarming/sensitive to surface in the self-serve client Lab Vault.
// Primary mechanism is the catalogue `client_visible: false` flag (precise,
// coach-editable). This regex list is a SAFETY NET that also hides sensitive
// markers whose raw name never resolved to a catalogue entry (variant spellings
// / new labs), so a stray "CA 27.29" or "Body Fat %" can't leak through the
// "Other" bucket. Coach-side surfaces never call buildLabVault, so nothing here
// affects what the coach sees. Keep patterns specific to avoid false hides.
const CLIENT_HIDDEN_MARKER_PATTERNS: RegExp[] = [
  // Tumour / cancer markers
  /\bpsa\b/, /\bcea\b/, /\bca[\s-]?125\b/, /\bca[\s-]?15[\s.-]?3\b/,
  /\bca[\s-]?19[\s.-]?9\b/, /\bca[\s-]?27\b/, /cancer antigen/, /tumou?r marker/,
  /alpha[\s-]?feto/, /\bafp\b/, /\bpsa[\s-]?(total|free)\b/,
  // Algorithmic disease-risk / propensity scores
  /disease propensity/, /disease risk score/,
  // Body-composition fat metrics (body-image sensitive)
  /body[\s-]?fat/, /fat[\s-]?mass/, /android[\s-]?fat/, /gynoid[\s-]?fat/,
  /android[\s/]?gynoid/, /adiposity/,
  // Cardiac-injury, infectious-disease, psych-drug levels
  /troponin/, /\bhcv\b/, /hepatitis/, /\bhbsag\b/, /\bhiv\b/, /lithium/,
];

/** True if a marker name should be hidden from the client Lab Vault by the
 *  safety-net patterns above (independent of the catalogue flag). */
export function isClientHiddenMarkerName(testName: string): boolean {
  const n = testName.trim().toLowerCase();
  if (!n) return false;
  return CLIENT_HIDDEN_MARKER_PATTERNS.some((re) => re.test(n));
}

/**
 * Find the catalogue LabTest record matching a free-form test name.
 * Case-insensitive: exact key match first, then bidirectional substring.
 * (Behaviour preserved exactly from the coach-side original.)
 */
export function findCatalogueLabTest(
  testName: string,
  catalogue: CatalogueLabRange[],
): CatalogueLabRange | null {
  const needle = testName.trim().toLowerCase();
  if (!needle) return null;
  for (const t of catalogue) {
    if (t.match_keys.includes(needle)) return t;
  }
  for (const t of catalogue) {
    for (const key of t.match_keys) {
      if (needle.includes(key) || key.includes(needle)) return t;
    }
  }
  return null;
}

// ── System grouping (keyed off LAB_PANELS — the catalogue has no category) ────

const _lc = (s: string) => s.trim().toLowerCase();
const PANEL_INDEX = LAB_PANELS.flatMap((p) =>
  // Bundle groups (items carry `components` + their own `system`) index each
  // bundle's component markers to that bundle's system, so a result like
  // "Serum Creatinine" classifies as Kidney instead of falling through to
  // "Other" now that it lives inside the KFT bundle rather than as its own lab.
  p.labs.some((l) => l.components && l.components.length)
    ? p.labs.map((l) => ({
        system: l.system ?? p.group,
        icon: l.icon ?? p.icon,
        keys: [l.name, ...(l.components ?? [])].map(_lc).filter(Boolean),
      }))
    : [
        {
          system: p.group,
          icon: p.icon,
          keys: p.labs.map((l) => _lc(l.name)).filter(Boolean),
        },
      ],
);

/** Map a marker name → its FM lab-panel system (Thyroid / Iron / …) or "Other". */
export function markerSystem(
  testName: string,
  catalogueDisplay?: string,
): { system: string; icon: string } {
  const cands = [testName, catalogueDisplay]
    .filter((s): s is string => !!s)
    .map((s) => s.trim().toLowerCase());
  for (const c of cands) {
    for (const p of PANEL_INDEX) {
      if (p.keys.includes(c)) return { system: p.system, icon: p.icon };
    }
  }
  for (const c of cands) {
    for (const p of PANEL_INDEX) {
      for (const k of p.keys) {
        if (k.length >= 4 && (c.includes(k) || k.includes(c))) {
          return { system: p.system, icon: p.icon };
        }
      }
    }
  }
  return { system: "Other", icon: "🧪" };
}

// ── View-model ────────────────────────────────────────────────────────────────

export type LabClientStatus = "optimal" | "explore" | "no_reference";
export type LabVaultMode = "plan" | "discovery";

export interface LabRangeBand {
  low?: number;
  high?: number;
  unit?: string;
}

export interface LabMarker {
  /** stable key — catalogue slug when matched, else slugified name */
  key: string;
  /** raw name as recorded on the snapshot */
  testName: string;
  /** catalogue display_name when matched, else the raw name */
  displayName: string;
  unit: string;
  latestValue: number;
  latestDate: string;
  prevValue: number | null;
  /** latest − previous, rounded to 2dp; null with a single point */
  delta: number | null;
  status: LabClientStatus;
  /** FM-optimal band: per-client override wins, else catalogue */
  fmOptimal: (LabRangeBand & { source: "client" | "catalogue" }) | null;
  /** standard "normal" band — catalogue only */
  conventional: LabRangeBand | null;
  system: string;
  systemIcon: string;
  /** true when the plan is actively targeting this marker (plan tier) */
  targetedByPlan: boolean;
  /** coach-authored catalogue note for the side it's out on — plan-tier context */
  interpretation?: string;
  /** value unit and reference-range unit disagree → don't assert a status */
  unitMismatch: boolean;
  /** time series, oldest → newest */
  trend: { date: string; value: number }[];
  /** ≥2 points → render a sparkline */
  hasTrend: boolean;
}

export interface LabGroup {
  system: string;
  icon: string;
  markers: LabMarker[];
}

export interface LabVault {
  groups: LabGroup[];
  /** plan mode → plan-targeted markers; discovery mode → status==="explore" */
  pinned: LabMarker[];
  summary: { total: number; optimal: number; explore: number; noReference: number };
  /** latest snapshot date across all markers, null when empty */
  asOf: string | null;
  /** which tier this vault was built for — drives client-facing vocabulary */
  mode: LabVaultMode;
}

export interface LabVaultOptions {
  mode: "plan" | "discovery";
  /** marker names/slugs the plan is actively targeting (plan-mode pin source) */
  targetedMarkers?: string[];
  /** the client's concern areas (conditions + goals) — used to order the system
   *  groups so the most relevant panels surface first (after the pinned set). */
  concernTerms?: string[];
}

const STATUS_ORDER: Record<LabClientStatus, number> = {
  explore: 0,
  optimal: 1,
  no_reference: 2,
};

function normUnit(u?: string): string {
  let s = (u ?? "").trim().toLowerCase().replace(/\s+/g, "").replace(/μ|µ/g, "u");
  // Known equivalences — same numeric scale, different notation. Without these,
  // a textual difference would wrongly suppress a valid range comparison.
  if (s === "uiu/ml") s = "miu/l"; // 1 µIU/mL ≡ 1 mIU/L (thyroid, insulin)
  return s;
}

// Concern keywords (matched against the client's conditions + goals) that make a
// given lab-panel system relevant — drives group ordering. Keyed by LAB_PANELS
// group name. Soft signal only; non-matches just keep their default order.
const SYSTEM_CONCERN_HINTS: Record<string, string[]> = {
  "Thyroid Function": ["thyroid", "hashimoto", "hypothyroid", "hyperthyroid", "graves", "goit", "tsh", "tpo"],
  "Blood Sugar & Insulin": ["diabet", "insulin", "blood sugar", "glucose", "hba1c", "prediab", "pcos", "metabolic syndrome", "weight"],
  "Inflammation": ["inflamm", "crp", "autoimmun", "arthrit", "pain", "fatigue", "long covid", "histamine", "mcas"],
  "Lipids": ["cholesterol", "lipid", "ldl", "hdl", "triglycer", "dyslipid", "statin"],
  "Blood Count": ["anaem", "anemia", "iron", "fatigue", "blood count", "cbc", "platelet"],
  "Kidney": ["kidney", "renal", "egfr", "creatinine", "urea", "uric acid", "kft"],
  "Liver": ["liver", "fatty liver", "hepatic", "sgot", "sgpt", "bilirubin", "lft"],
  "Advanced Kidney & Metabolic": ["kidney", "renal", "egfr", "creatinine", "metabolic", "cystatin"],
  "Nutrients": ["vitamin", "deficien", "b12", "vit d", "magnesium", "zinc", "iron", "ferritin", "fatigue", "hair"],
  "Sex Hormones — Female": ["perimenopaus", "menopaus", "estrogen", "oestrogen", "progesterone", "pcos", "fertil", "period", "cycle", "amenorr", "pms", "hormone", "fibroid", "endometrios"],
  "Sex Hormones — Common": ["testosterone", "shbg", "dhea", "prolactin", "pcos", "hormone", "libido", "androgen", "acne"],
  "Adrenal & Stress": ["adrenal", "cortisol", "stress", "burnout", "fatigue", "hpa", "sleep", "anxiety"],
  "Cardiovascular Risk": ["cardiovascular", "heart", "apob", "lp(a)", "lipoprotein", "cardiac", "cholesterol"],
  "Methylation & Genetics": ["methylat", "mthfr", "comt", "homocysteine", "genetic"],
  "Autoimmune Screening": ["autoimmun", "ana", "lupus", "rheumatoid", "celiac", "coeliac", "gluten", "hashimoto", "arthrit"],
  "Cancer Screening": ["cancer", "oncolog", "tumor", "tumour", "malignan"],
  "Gut Health": ["gut", "ibs", "sibo", "bloat", "h. pylori", "h pylori", "reflux", "gerd", "constipat", "diarrh", "leaky gut", "digest", "gastro"],
};

/**
 * Build the client-facing lab vault from a client's snapshots.
 *
 * @param snapshots  client.health_snapshots (any order)
 * @param catalogue  loadLabTestsCatalogueAction() output
 * @param refRanges  client.lab_reference_ranges (per-client FM-optimal overrides)
 * @param options    mode + plan-targeted marker names (Phase 2 wires these from
 *                   plan.lab_followups / monitoring markers)
 */
export function buildLabVault(
  snapshots: LabSnapshot[],
  catalogue: CatalogueLabRange[],
  refRanges: LabReferenceRanges,
  options: LabVaultOptions,
): LabVault {
  const sorted = [...snapshots].sort((a, b) => a.date.localeCompare(b.date));

  // Time series per test_name (latest non-empty unit wins).
  const series = new Map<string, { points: { date: string; value: number }[]; unit: string }>();
  for (const snap of sorted) {
    for (const lv of snap.lab_values ?? []) {
      const num = parseFloat(lv.value);
      if (isNaN(num)) continue;
      const name = lv.test_name.trim();
      if (!name) continue;
      const entry = series.get(name) ?? { points: [], unit: lv.unit ?? "" };
      entry.points.push({ date: snap.date, value: num });
      if (lv.unit) entry.unit = lv.unit;
      series.set(name, entry);
    }
  }

  const targeted = (options.targetedMarkers ?? [])
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const markers: LabMarker[] = [];
  for (const [testName, { points, unit }] of Array.from(series.entries())) {
    points.sort((a, b) => a.date.localeCompare(b.date));
    const latest = points[points.length - 1];
    const prev = points.length > 1 ? points[points.length - 2] : null;

    const match = findCatalogueLabTest(testName, catalogue);

    // Client-app sensitivity gate: drop markers the catalogue flags coach-only
    // (client_visible === false), or that match the sensitive-name safety net
    // even when unresolved. These never enter any group, the pinned set, or the
    // summary count — the client simply never sees them. Coach surfaces don't
    // use buildLabVault, so their view is unaffected.
    if (match?.client_visible === false || isClientHiddenMarkerName(testName)) {
      continue;
    }

    const override = refRanges[testName];

    const fmOptimal =
      override && (override.optimal_low != null || override.optimal_high != null)
        ? { low: override.optimal_low, high: override.optimal_high, unit: override.unit, source: "client" as const }
        : match && (match.fm_optimal_low != null || match.fm_optimal_high != null)
        ? { low: match.fm_optimal_low ?? undefined, high: match.fm_optimal_high ?? undefined, unit: match.units, source: "catalogue" as const }
        : null;

    const conventional =
      match && (match.conventional_low != null || match.conventional_high != null)
        ? { low: match.conventional_low ?? undefined, high: match.conventional_high ?? undefined, unit: match.units }
        : null;

    // If the value's unit and the reference band's unit disagree, the numeric
    // comparison is invalid — don't assert optimal/explore.
    const refUnit = fmOptimal?.unit ?? conventional?.unit;
    const unitMismatch = !!(normUnit(unit) && normUnit(refUnit) && normUnit(unit) !== normUnit(refUnit));

    const rs = rangeStatus(
      latest.value,
      fmOptimal ? { optimal_low: fmOptimal.low, optimal_high: fmOptimal.high } : undefined,
    );
    const status: LabClientStatus = unitMismatch
      ? "no_reference"
      : rs === "optimal"
      ? "optimal"
      : rs === "outside"
      ? "explore"
      : "no_reference";

    const { system, icon } = markerSystem(testName, match?.display_name);

    const keyset = [testName.toLowerCase(), match?.slug?.toLowerCase(), match?.display_name?.toLowerCase()]
      .filter((s): s is string => !!s);
    const targetedByPlan =
      targeted.length > 0 &&
      targeted.some((t) => keyset.some((k) => k === t || k.includes(t) || t.includes(k)));

    let interpretation: string | undefined;
    if (match && !unitMismatch) {
      if (fmOptimal?.low != null && latest.value < fmOptimal.low) interpretation = match.interpretation_low;
      else if (fmOptimal?.high != null && latest.value > fmOptimal.high) interpretation = match.interpretation_high;
    }

    markers.push({
      key: match?.slug ?? testName.toLowerCase().replace(/\s+/g, "-"),
      testName,
      displayName: match?.display_name ?? testName,
      unit,
      latestValue: latest.value,
      latestDate: latest.date,
      prevValue: prev?.value ?? null,
      delta: prev ? Math.round((latest.value - prev.value) * 100) / 100 : null,
      status,
      fmOptimal,
      conventional,
      system,
      systemIcon: icon,
      targetedByPlan,
      interpretation,
      unitMismatch,
      trend: points,
      hasTrend: points.length >= 2,
    });
  }

  // ── Collapse name-variants of the SAME test ────────────────────────────────
  // The series above is keyed by raw test_name, so two names that resolve to
  // the same catalogue marker (e.g. "CRP" + "hsCRP" → hs-crp) render as two
  // look-alike cards. Group by catalogue key and keep one card per test:
  //   - keep the most recent (latestDate, tie → more points → longer name);
  //   - merge trend points from SAME-unit siblings (dedupe by date, latest wins)
  //     so a marker recorded under different names across reports shows one
  //     continuous trend;
  //   - a sibling with a DIFFERENT unit is a genuinely different measurement
  //     (e.g. total vs active B12) — keep it separate but fall back to its raw
  //     name so the two don't look identical.
  const byKey = new Map<string, LabMarker[]>();
  for (const m of markers) {
    const arr = byKey.get(m.key);
    if (arr) arr.push(m);
    else byKey.set(m.key, [m]);
  }
  const deduped: LabMarker[] = [];
  for (const group of Array.from(byKey.values())) {
    if (group.length === 1) {
      deduped.push(group[0]);
      continue;
    }
    const keep = [...group].sort(
      (a, b) =>
        b.latestDate.localeCompare(a.latestDate) ||
        b.trend.length - a.trend.length ||
        b.testName.length - a.testName.length,
    )[0];
    const byDate = new Map<string, number>();
    for (const m of group) {
      if (normUnit(m.unit) !== normUnit(keep.unit)) continue;
      for (const p of m.trend) byDate.set(p.date, p.value); // latest write wins
    }
    // ensure the kept card's own latest value wins for its date
    byDate.set(keep.latestDate, keep.latestValue);
    const mergedTrend = Array.from(byDate.entries())
      .map(([date, value]) => ({ date, value }))
      .sort((a, b) => a.date.localeCompare(b.date));
    keep.trend = mergedTrend;
    keep.hasTrend = mergedTrend.length >= 2;
    if (mergedTrend.length > 1) {
      keep.prevValue = mergedTrend[mergedTrend.length - 2].value;
      keep.delta =
        Math.round((keep.latestValue - keep.prevValue) * 100) / 100;
    } else {
      keep.prevValue = null;
      keep.delta = null;
    }
    deduped.push(keep);
    for (const m of group) {
      if (m === keep) continue;
      if (normUnit(m.unit) !== normUnit(keep.unit)) {
        deduped.push({ ...m, displayName: m.testName });
      }
    }
  }
  markers.length = 0;
  markers.push(...deduped);

  // Group by system.
  const groupMap = new Map<string, LabGroup>();
  for (const m of markers) {
    let g = groupMap.get(m.system);
    if (!g) {
      g = { system: m.system, icon: m.systemIcon, markers: [] };
      groupMap.set(m.system, g);
    }
    g.markers.push(m);
  }
  const groups = Array.from(groupMap.values());
  for (const g of groups) {
    g.markers.sort(
      (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.displayName.localeCompare(b.displayName),
    );
  }
  // Order: "Other" always last; otherwise concern-relevant systems first, then
  // systems with more flagged markers, then alphabetical.
  const concernBlob = (options.concernTerms ?? []).join(" | ").toLowerCase();
  const relevance = (system: string): number => {
    const hints = SYSTEM_CONCERN_HINTS[system];
    if (!hints || !concernBlob) return 0;
    let s = 0;
    for (const h of hints) if (concernBlob.includes(h)) s++;
    return s;
  };
  const exploreCount = (g: LabGroup): number => g.markers.filter((m) => m.status === "explore").length;
  groups.sort((a, b) => {
    const ao = a.system === "Other" ? 1 : 0;
    const bo = b.system === "Other" ? 1 : 0;
    if (ao !== bo) return ao - bo;
    const dr = relevance(b.system) - relevance(a.system);
    if (dr !== 0) return dr;
    const de = exploreCount(b) - exploreCount(a);
    if (de !== 0) return de;
    return a.system.localeCompare(b.system);
  });

  const pinned =
    options.mode === "plan"
      ? markers.filter((m) => m.targetedByPlan)
      : markers.filter((m) => m.status === "explore");

  const summary = {
    total: markers.length,
    optimal: markers.filter((m) => m.status === "optimal").length,
    explore: markers.filter((m) => m.status === "explore").length,
    noReference: markers.filter((m) => m.status === "no_reference").length,
  };

  return {
    groups,
    pinned,
    summary,
    asOf: sorted.length ? sorted[sorted.length - 1].date : null,
    mode: options.mode,
  };
}

// ── Display-string helpers (scope-safe, shared by both tiers' UI) ─────────────

/** Umbrella noun for out-of-optimal markers, tier-aware. Active/plan clients must
 *  NOT see "worth exploring" (that's the discovery conversion framing). */
export function exploreNoun(mode: LabVaultMode = "discovery"): string {
  return mode === "plan" ? "we’re working on" : "worth exploring";
}

export function clientStatusLabel(s: LabClientStatus, mode: LabVaultMode = "discovery"): string {
  if (s === "optimal") return "In optimal range";
  if (s === "explore") return mode === "plan" ? "Working on it" : "Worth exploring";
  return "No reference on file";
}

/** Lead-with-positive summary line. */
export function vaultSummaryLine(summary: LabVault["summary"], mode: LabVaultMode = "discovery"): string {
  const parts: string[] = [];
  if (summary.optimal) parts.push(`${summary.optimal} in optimal range`);
  if (summary.explore) parts.push(`${summary.explore} ${exploreNoun(mode)}`);
  return parts.join(" · ") || "No markers on file yet";
}
