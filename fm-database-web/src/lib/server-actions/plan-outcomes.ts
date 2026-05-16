"use server";

/**
 * Plan outcome tracking — Phase 1 (Step 4 of the catalogue/AI roadmap).
 *
 * Computes the delta between:
 *   • Plan.baseline_snapshot       (captured at publish, or backfilled
 *                                    from the closest pre-publish
 *                                    health_snapshot)
 *   • Latest client state          (current Client.health_snapshots /
 *                                    measurements / lab_markers, or the
 *                                    most-recent health_snapshot)
 *
 * For each lab marker, measurement, and presenting symptom that's in
 * the baseline, we compute:
 *   - prev value          (the baseline)
 *   - now value           (most recent reading)
 *   - delta + direction   (improving / worsening / unchanged / unknown)
 *   - days_since_baseline
 *
 * "Direction" interpretation is marker-specific: a TSH drop from 4.2 →
 * 2.8 is improving; an hsCRP drop is improving; a ferritin RISE from 35
 * → 62 is improving. We hard-code a small "lower is better / higher is
 * better / closer to target is better" table — covers the common labs;
 * anything else falls back to "unknown direction" so coach decides.
 *
 * Out of scope here (Phase 2/3):
 *   - Cross-client aggregation
 *   - Auto evidence_tier adjustment
 *   - Per-supplement attribution beyond a naive "supplements whose
 *     linked_to_topics overlaps with marker.panel"
 */

import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { getPlansRoot } from "@/lib/fmdb/paths";

// ── Direction table ────────────────────────────────────────────────────
// Per FM optimal ranges. "lower" = lower value = better (until lower bound).
// "higher" = higher value = better. "midrange" = closer to the optimal
// midpoint is better (irrelevant for labs the coach tracks via FM ranges).
// Marker keys are case- and punctuation-insensitive — normalised below.
const DIRECTION_TABLE: Record<string, "lower" | "higher"> = {
  // Lower = better
  "tsh": "lower",
  "hscrp": "lower",
  "high sensitivity crp": "lower",
  "crp": "lower",
  "homaIR": "lower",
  "homa ir index": "lower",
  "homa-ir": "lower",
  "fasting insulin": "lower",
  "insulin - fasting": "lower",
  "apolipoproteins b": "lower",
  "apob": "lower",
  "ldl": "lower",
  "ldl cholesterol": "lower",
  "triglycerides": "lower",
  "fasting glucose": "lower",
  "glucose fasting": "lower",
  "tpo antibodies": "lower",
  "microsomal (tpo) antibody titre, serum": "lower",
  "thyroglobulin antibody, serum": "lower",
  "tg ab": "lower",
  "tgab": "lower",
  "uric acid": "lower",
  "ggt": "lower",
  "blood pressure systolic": "lower",
  "blood pressure diastolic": "lower",
  "weight kg": "lower",  // for this client cohort — most plans are weight-loss
  "waist cm": "lower",
  // Higher = better
  "ferritin": "higher",
  "vitamin d": "higher",
  "25-oh vitamin d": "higher",
  "vit d": "higher",
  "free t3": "higher",
  "free t4": "higher",
  "hdl": "higher",
  "hdl cholesterol": "higher",
  "magnesium": "higher",
  "zinc": "higher",
  "zinc by icpms, serum": "higher",
  "b12": "higher",
  "vitamin b12": "higher",
  "insulin sensitivity": "higher",
};

function normMarkerName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function directionFor(markerName: string): "lower" | "higher" | "unknown" {
  const k = normMarkerName(markerName);
  if (DIRECTION_TABLE[k]) return DIRECTION_TABLE[k];
  // Fuzzy fallback: substring match against the table keys
  for (const key of Object.keys(DIRECTION_TABLE)) {
    if (k.includes(key) || key.includes(k)) return DIRECTION_TABLE[key];
  }
  return "unknown";
}

function parseNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const m = v.trim().match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return Number.isFinite(n) ? n : null;
}

export interface LabDelta {
  marker_name: string;
  unit?: string;
  baseline_value: number | string;
  current_value: number | string;
  delta_numeric: number | null;
  delta_pct: number | null;
  direction: "improving" | "worsening" | "unchanged" | "unknown";
  baseline_date?: string;
  current_date?: string;
}

export interface MeasurementDelta {
  field: string;
  baseline_value: number | string | null;
  current_value: number | string | null;
  delta_numeric: number | null;
  direction: "improving" | "worsening" | "unchanged" | "unknown";
}

export interface PlanOutcomesResult {
  ok: boolean;
  error?: string;
  has_baseline: boolean;
  backfilled: boolean;
  baseline_date?: string;
  current_date?: string;
  days_since_baseline?: number;
  lab_deltas: LabDelta[];
  measurement_deltas: MeasurementDelta[];
  presenting_symptoms_baseline: string[];
  /** Symptoms the coach has logged as "still present" at follow-up.
   *  Phase 1: not yet wired — leave empty until symptom-tracking
   *  sessions are normalised. Surfaced as a placeholder. */
  presenting_symptoms_active_now?: string[];
}

interface BaselineSnapshot {
  captured_at?: string;
  plan_period_start?: string;
  lab_markers?: Array<Record<string, unknown>>;
  lab_markers_date?: string;
  measurements?: Record<string, unknown>;
  presenting_symptoms?: string[];
  backfilled?: boolean;
}

interface ClientSnapshotRow {
  date?: string;
  measurements?: Record<string, unknown>;
  lab_values?: Array<Record<string, unknown>>;
}

interface ClientYaml {
  client_id?: string;
  measurements?: Record<string, unknown>;
  lab_markers?: Array<Record<string, unknown>>;
  lab_markers_date?: string;
  health_snapshots?: ClientSnapshotRow[];
}

async function readYamlIfExists<T>(p: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(p, "utf-8");
    return yaml.load(raw) as T;
  } catch {
    return null;
  }
}

async function loadClient(clientId: string): Promise<ClientYaml | null> {
  const root = getPlansRoot();
  return await readYamlIfExists<ClientYaml>(
    path.join(root, "clients", clientId, "client.yaml"),
  );
}

async function loadPlan(planSlug: string): Promise<Record<string, unknown> | null> {
  const root = getPlansRoot();
  for (const bucket of ["published", "ready", "drafts", "superseded", "revoked"]) {
    const dir = path.join(root, bucket);
    try {
      const names = await fs.readdir(dir);
      for (const n of names) {
        // Versioned filenames: <slug>-vN.yaml
        if (n.startsWith(`${planSlug}-v`) || n === `${planSlug}.yaml`) {
          return await readYamlIfExists(path.join(dir, n));
        }
      }
    } catch {
      /* dir doesn't exist */
    }
  }
  return null;
}

/**
 * Pick the freshest data the client has for labs + measurements. Prefers
 * the latest health_snapshot; falls back to top-level Client.measurements
 * / Client.lab_markers when there's nothing in the log.
 */
function pickCurrentState(client: ClientYaml): {
  lab_values: Array<Record<string, unknown>>;
  lab_markers_date?: string;
  measurements: Record<string, unknown>;
  current_date?: string;
} {
  const snaps = (client.health_snapshots ?? []).slice();
  snaps.sort((a, b) => {
    const da = String(a.date ?? "");
    const db = String(b.date ?? "");
    return db.localeCompare(da);
  });
  const latest = snaps[0];
  if (latest && (latest.lab_values?.length || latest.measurements)) {
    return {
      lab_values: latest.lab_values ?? [],
      lab_markers_date: latest.date,
      measurements: latest.measurements ?? client.measurements ?? {},
      current_date: latest.date,
    };
  }
  return {
    lab_values: client.lab_markers ?? [],
    lab_markers_date: client.lab_markers_date,
    measurements: client.measurements ?? {},
    current_date: client.lab_markers_date,
  };
}

function indexByMarkerName(rows: Array<Record<string, unknown>>): Map<string, Record<string, unknown>> {
  const m = new Map<string, Record<string, unknown>>();
  for (const r of rows) {
    const k = String(r.marker_name ?? r.test_name ?? "").trim();
    if (!k) continue;
    const norm = normMarkerName(k);
    if (!m.has(norm)) m.set(norm, r);
  }
  return m;
}

export async function computePlanOutcomesAction(
  planSlug: string,
  clientId: string,
): Promise<PlanOutcomesResult> {
  const plan = await loadPlan(planSlug);
  if (!plan) {
    return {
      ok: false,
      error: `Plan ${planSlug} not found`,
      has_baseline: false,
      backfilled: false,
      lab_deltas: [],
      measurement_deltas: [],
      presenting_symptoms_baseline: [],
    };
  }
  const baseline = (plan.baseline_snapshot ?? {}) as BaselineSnapshot;
  const hasBaseline = !!(baseline.captured_at || baseline.lab_markers_date);
  if (!hasBaseline) {
    return {
      ok: true,
      has_baseline: false,
      backfilled: false,
      lab_deltas: [],
      measurement_deltas: [],
      presenting_symptoms_baseline: [],
    };
  }

  const client = await loadClient(clientId);
  if (!client) {
    return {
      ok: false,
      error: `Client ${clientId} not found`,
      has_baseline: true,
      backfilled: !!baseline.backfilled,
      lab_deltas: [],
      measurement_deltas: [],
      presenting_symptoms_baseline: baseline.presenting_symptoms ?? [],
    };
  }

  const current = pickCurrentState(client);

  // Lab deltas — pair on normalised marker name.
  const baseLabs = indexByMarkerName(baseline.lab_markers ?? []);
  const curLabs = indexByMarkerName(current.lab_values);
  const labDeltas: LabDelta[] = [];
  for (const [norm, baseRow] of baseLabs.entries()) {
    const curRow = curLabs.get(norm);
    if (!curRow) continue; // no follow-up reading for this marker
    const baseV = baseRow.value;
    const curV = curRow.value;
    const baseN = parseNum(baseV);
    const curN = parseNum(curV);
    let delta: number | null = null;
    let pct: number | null = null;
    let dir: LabDelta["direction"] = "unknown";
    if (baseN !== null && curN !== null) {
      delta = curN - baseN;
      pct = baseN !== 0 ? (delta / baseN) * 100 : null;
      const want = directionFor(String(baseRow.marker_name ?? baseRow.test_name ?? ""));
      if (Math.abs(delta) < 1e-9) dir = "unchanged";
      else if (want === "lower") dir = delta < 0 ? "improving" : "worsening";
      else if (want === "higher") dir = delta > 0 ? "improving" : "worsening";
      else dir = "unknown";
    }
    labDeltas.push({
      marker_name: String(baseRow.marker_name ?? baseRow.test_name ?? norm),
      unit: (baseRow.unit ?? curRow.unit) as string | undefined,
      baseline_value: (baseV ?? "—") as string | number,
      current_value: (curV ?? "—") as string | number,
      delta_numeric: delta,
      delta_pct: pct,
      direction: dir,
      baseline_date: String(baseRow.date_drawn ?? baseline.lab_markers_date ?? ""),
      current_date: String(curRow.date_drawn ?? current.lab_markers_date ?? ""),
    });
  }
  // Sort: improving first, then worsening, then unchanged, then unknown
  const orderOf = (d: LabDelta["direction"]) =>
    d === "improving" ? 0 : d === "worsening" ? 1 : d === "unchanged" ? 2 : 3;
  labDeltas.sort((a, b) => orderOf(a.direction) - orderOf(b.direction));

  // Measurement deltas (weight, BP, waist, HR)
  const MEAS_FIELDS = ["weight_kg", "waist_cm", "blood_pressure_systolic", "blood_pressure_diastolic", "resting_heart_rate"];
  const baseM = (baseline.measurements ?? {}) as Record<string, unknown>;
  const curM = (current.measurements ?? {}) as Record<string, unknown>;
  const measurementDeltas: MeasurementDelta[] = [];
  for (const f of MEAS_FIELDS) {
    if (baseM[f] === undefined || baseM[f] === null) continue;
    if (curM[f] === undefined || curM[f] === null) continue;
    const bN = parseNum(baseM[f]);
    const cN = parseNum(curM[f]);
    let delta: number | null = null;
    let dir: MeasurementDelta["direction"] = "unknown";
    if (bN !== null && cN !== null) {
      delta = cN - bN;
      const want = directionFor(f.replace(/_/g, " "));
      if (Math.abs(delta) < 1e-9) dir = "unchanged";
      else if (want === "lower") dir = delta < 0 ? "improving" : "worsening";
      else if (want === "higher") dir = delta > 0 ? "improving" : "worsening";
    }
    measurementDeltas.push({
      field: f,
      baseline_value: (baseM[f] ?? null) as number | string | null,
      current_value: (curM[f] ?? null) as number | string | null,
      delta_numeric: delta,
      direction: dir,
    });
  }

  // Days since baseline
  const baseDateStr = baseline.lab_markers_date ?? baseline.plan_period_start ?? baseline.captured_at?.slice(0, 10);
  const curDateStr = current.current_date ?? new Date().toISOString().slice(0, 10);
  let daysSince: number | undefined;
  if (baseDateStr) {
    const bd = Date.parse(`${baseDateStr.slice(0, 10)}T00:00:00`);
    const cd = Date.parse(`${curDateStr.slice(0, 10)}T00:00:00`);
    if (!Number.isNaN(bd) && !Number.isNaN(cd)) {
      daysSince = Math.round((cd - bd) / 86_400_000);
    }
  }

  return {
    ok: true,
    has_baseline: true,
    backfilled: !!baseline.backfilled,
    baseline_date: baseDateStr,
    current_date: curDateStr,
    days_since_baseline: daysSince,
    lab_deltas: labDeltas,
    measurement_deltas: measurementDeltas,
    presenting_symptoms_baseline: baseline.presenting_symptoms ?? [],
  };
}
