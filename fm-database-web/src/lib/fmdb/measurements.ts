/**
 * Canonical body-measurement reader — the single source of truth for weight
 * and body measurements across the app.
 *
 * WHY THIS EXISTS: measurements live in THREE stores that don't sync:
 *   · health_snapshots[]         — client app self-logging + labs + intake
 *                                  (keys: bp_systolic / bp_diastolic / hr_bpm)
 *   · measurements_log[]         — the coach's "Log entry" / weight editor
 *                                  (keys: blood_pressure_systolic /
 *                                   blood_pressure_diastolic / resting_heart_rate)
 *   · measurements (flat bio)    — intake block
 *                                  (may carry blood_pressure as a "118/76" string)
 * Every surface that shows weight/measurements must union all three or a coach
 * edit "disappears" there — the bug that hit the dormant check, the outcomes
 * panel, and the health-trends sparklines. Route ALL of them through
 * `collectMeasurementSnapshots` / `latestMeasurements` instead of reading one
 * store directly.
 *
 * Output uses the health_snapshots CANONICAL keys (bp_systolic / bp_diastolic /
 * hr_bpm) so it drops into existing snapshot-shaped consumers unchanged.
 */

export interface UnifiedMeasurements {
  height_cm?: number;
  weight_kg?: number;
  bp_systolic?: number;
  bp_diastolic?: number;
  hr_bpm?: number;
  waist_cm?: number;
  hip_cm?: number;
}

export interface UnifiedSnapshot {
  date: string; // YYYY-MM-DD
  source: string;
  measurements: UnifiedMeasurements;
  lab_values: Array<{ test_name: string; value: string; unit?: string }>;
  medications: string[];
  conditions: string[];
}

// Loose on purpose: callers pass the fully-typed Client (whose MeasurementEntry[]
// / health_snapshots[] aren't assignable to Record index types). We cast each
// element internally.
interface ClientLike {
  measurements?: unknown;
  measurements_log?: readonly unknown[] | null;
  health_snapshots?: readonly unknown[] | null;
}

const num = (v: unknown): number | undefined => {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return undefined;
};

const ymd = (v: unknown): string | undefined => {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  if (!t) return undefined;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(t) ? new Date(`${t}T00:00:00Z`) : new Date(t);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
};

/** Pull canonical measurement fields from a record that may use EITHER naming
 *  convention (health_snapshots or measurements_log or flat bio). */
function extract(src: Record<string, unknown> | null | undefined): UnifiedMeasurements {
  if (!src) return {};
  const m: UnifiedMeasurements = {
    weight_kg: num(src.weight_kg),
    height_cm: num(src.height_cm),
    waist_cm: num(src.waist_cm),
    hip_cm: num(src.hip_cm),
    bp_systolic: num(src.bp_systolic) ?? num(src.blood_pressure_systolic),
    bp_diastolic: num(src.bp_diastolic) ?? num(src.blood_pressure_diastolic),
    hr_bpm: num(src.hr_bpm) ?? num(src.resting_heart_rate),
  };
  // Flat bio may store BP as a "118/76" string.
  if ((m.bp_systolic === undefined || m.bp_diastolic === undefined) && typeof src.blood_pressure === "string") {
    const mo = src.blood_pressure.match(/(\d{2,3})\s*\/\s*(\d{2,3})/);
    if (mo) {
      m.bp_systolic = m.bp_systolic ?? Number(mo[1]);
      m.bp_diastolic = m.bp_diastolic ?? Number(mo[2]);
    }
  }
  return m;
}

const FIELDS: (keyof UnifiedMeasurements)[] = [
  "height_cm",
  "weight_kg",
  "bp_systolic",
  "bp_diastolic",
  "hr_bpm",
  "waist_cm",
  "hip_cm",
];

/**
 * Union weight + body measurements + labs across all three stores, merged
 * FIELD-LEVEL per date (so a date with a lab-only snapshot and a coach weight
 * log keeps both). Rank on collision: measurements_log (2) > health_snapshots
 * (1) > flat bio (0). Returns ascending by date.
 */
export function collectMeasurementSnapshots(client: ClientLike): UnifiedSnapshot[] {
  interface Acc {
    date: string;
    source: string;
    meas: Partial<Record<keyof UnifiedMeasurements, { v: number; rank: number }>>;
    labs: Array<{ test_name: string; value: string; unit?: string }>;
    meds: string[];
    conds: string[];
    rank: number; // best source rank seen (for the source label)
  }
  const byDate = new Map<string, Acc>();

  const acc = (date: string, source: string, rank: number): Acc => {
    let a = byDate.get(date);
    if (!a) {
      a = { date, source, meas: {}, labs: [], meds: [], conds: [], rank: -1 };
      byDate.set(date, a);
    }
    if (rank > a.rank) {
      a.rank = rank;
      a.source = source;
    }
    return a;
  };

  const mergeMeas = (a: Acc, m: UnifiedMeasurements, rank: number) => {
    for (const f of FIELDS) {
      const val = m[f];
      if (val === undefined) continue;
      const cur = a.meas[f];
      if (!cur || rank >= cur.rank) a.meas[f] = { v: val, rank };
    }
  };

  // health_snapshots (rank 1): measurements + labs + meds/conditions
  for (const raw of client.health_snapshots ?? []) {
    const s = raw as Record<string, unknown>;
    const date = ymd(s?.date);
    if (!date) continue;
    const a = acc(date, String(s?.source ?? "health_snapshot"), 1);
    mergeMeas(a, extract((s?.measurements as Record<string, unknown>) ?? s), 1);
    const lvs = s?.lab_values;
    if (Array.isArray(lvs)) {
      for (const lv of lvs) {
        const tn = (lv as { test_name?: unknown })?.test_name;
        const val = (lv as { value?: unknown })?.value;
        if (typeof tn === "string" && val != null) {
          a.labs.push({ test_name: tn, value: String(val), unit: (lv as { unit?: string })?.unit });
        }
      }
    }
    if (Array.isArray(s?.medications)) a.meds = (s.medications as unknown[]).filter((x): x is string => typeof x === "string");
    if (Array.isArray(s?.conditions)) a.conds = (s.conditions as unknown[]).filter((x): x is string => typeof x === "string");
  }

  // measurements_log (rank 2): coach's explicit record — wins measurement fields
  for (const raw of client.measurements_log ?? []) {
    const e = raw as Record<string, unknown>;
    const date = ymd(e?.date);
    if (!date) continue;
    mergeMeas(acc(date, "coach_log", 2), extract(e), 2);
  }

  // flat bio measurements (rank 0)
  const flat = client.measurements as Record<string, unknown> | null | undefined;
  if (flat) {
    const date = ymd(flat.measured_on) ?? ymd(new Date().toISOString());
    if (date) mergeMeas(acc(date, "intake", 0), extract(flat), 0);
  }

  return [...byDate.values()]
    .map((a) => {
      const measurements: UnifiedMeasurements = {};
      for (const f of FIELDS) {
        const c = a.meas[f];
        if (c) measurements[f] = c.v;
      }
      return { date: a.date, source: a.source, measurements, lab_values: a.labs, medications: a.meds, conditions: a.conds };
    })
    .sort((x, y) => x.date.localeCompare(y.date));
}

/** The most recent non-empty measurements across all three stores. */
export function latestMeasurements(client: ClientLike): { date: string; measurements: UnifiedMeasurements } | null {
  const snaps = collectMeasurementSnapshots(client).filter(
    (s) => Object.keys(s.measurements).length > 0,
  );
  if (snaps.length === 0) return null;
  const last = snaps[snaps.length - 1];
  return { date: last.date, measurements: last.measurements };
}
