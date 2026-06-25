/**
 * Cohort MSQ outcomes — the practice-level rollup of the Medical Symptom
 * Questionnaire that each client fills in the app's Progress tab.
 *
 * The app stores every MSQ submission as a `check_in` session carrying an
 * `msq_response` block (week, total 0–288, band, category_totals over the 15
 * systems, the raw 72-item answers, received_at). The client app already
 * graphs each client's MSQ *total* over time; this module disaggregates and
 * aggregates ACROSS clients so the dashboard can show:
 *   - the cohort's headline MSQ (the standard FM outcome number), and
 *   - per-system trajectory (improving / holding / worse) once retakes land.
 *
 * Pure read + aggregate — no app changes, no new capture. Reads only
 * `category_totals` + `total` (item-level `answers` is for the Phase 2
 * drill-down). Follows the batched-scan pattern of getClientHealthSignals.
 *
 * Until a client has ≥2 submissions (retakes are gated to every 21 days),
 * there is no trajectory yet — the rollup reports `mode: "baseline"` and
 * surfaces where the cohort's burden concentrates instead. Once any client
 * has a retake it flips to `mode: "trend"`.
 */
import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { getPlansRoot } from "./paths";
import { MSQ_CATEGORIES, msqBand } from "./msq";

/** Per-system point shift (baseline → latest) that counts as a real move.
 *  Anything inside ±this band is "holding". 2 points is a meaningful change
 *  for a single MSQ system (most systems sit in the 0–20 range). */
const IMPROVE_DELTA = 2;

type Dict = Record<string, unknown>;

interface MsqEntry {
  date: string;
  total: number;
  categoryTotals: Record<string, number>;
  /** Raw 72-item answers ("<categoryId>.<itemIndex>" → 0..4). For item-level drill-down. */
  answers: Record<string, number>;
}

export interface CohortMsqSystem {
  id: string;
  label: string;
  /** Mean baseline score for this system across clients with ≥1 MSQ. */
  avgBaseline: number;
  /** Mean latest score across clients with a retake (null in baseline mode). */
  avgLatest: number | null;
  /** Counts of trend clients whose score for this system moved. */
  improving: number;
  holding: number;
  worse: number;
  /** Mean % change (baseline → latest) across trend clients (null in baseline mode). */
  avgDeltaPct: number | null;
}

export interface CohortMsqOutcomes {
  mode: "trend" | "baseline" | "empty";
  /** Clients with ≥1 MSQ submission. */
  clientsWithMsq: number;
  /** Clients with ≥2 submissions (a baseline + at least one retake). */
  clientsWithTrend: number;
  avgBaselineTotal: number | null;
  avgLatestTotal: number | null;
  baselineBandLabel: string | null;
  latestBandLabel: string | null;
  /** Mean per-client % change in MSQ total (baseline → latest), trend clients. */
  deltaPct: number | null;
  /** Cohort average total at each submission index (0 = baseline). For a sparkline. */
  cohortPoints: number[];
  /** All 15 systems, sorted: trend mode → biggest movers first; baseline mode → worst burden first. */
  systems: CohortMsqSystem[];
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Read every MSQ submission for one client, deduped to one per date
 *  (latest received_at wins), sorted oldest → newest. */
async function readClientMsqEntries(root: string, clientId: string): Promise<MsqEntry[]> {
  const dir = path.join(root, "clients", clientId, "sessions");
  let names: string[];
  try {
    names = (await fs.readdir(dir)).filter((n) => n.endsWith(".yaml") || n.endsWith(".yml"));
  } catch {
    return [];
  }
  const byDate = new Map<string, { entry: MsqEntry; recv: string }>();
  for (const n of names) {
    let s: Dict | null = null;
    try {
      s = yaml.load(await fs.readFile(path.join(dir, n), "utf-8")) as Dict;
    } catch {
      continue;
    }
    const msq = s?.msq_response as Dict | undefined;
    const date = typeof s?.date === "string" ? s.date : "";
    if (!msq || !date) continue;
    const total = Number(msq.total);
    if (!Number.isFinite(total)) continue;
    const categoryTotals = (msq.category_totals as Record<string, number>) ?? {};
    const answers = (msq.answers as Record<string, number>) ?? {};
    const recv = typeof msq.received_at === "string" ? msq.received_at : "";
    const prev = byDate.get(date);
    if (!prev || recv > prev.recv) byDate.set(date, { entry: { date, total, categoryTotals, answers }, recv });
  }
  return [...byDate.values()].map((v) => v.entry).sort((a, b) => a.date.localeCompare(b.date));
}

export async function getCohortMsqOutcomes(clientIds: string[]): Promise<CohortMsqOutcomes> {
  const root = getPlansRoot();
  const perClient = await Promise.all(
    clientIds.map(async (id) => ({ id, entries: await readClientMsqEntries(root, id) })),
  );
  const withMsq = perClient.filter((c) => c.entries.length >= 1);
  const withTrend = perClient.filter((c) => c.entries.length >= 2);

  if (withMsq.length === 0) {
    return {
      mode: "empty",
      clientsWithMsq: 0,
      clientsWithTrend: 0,
      avgBaselineTotal: null,
      avgLatestTotal: null,
      baselineBandLabel: null,
      latestBandLabel: null,
      deltaPct: null,
      cohortPoints: [],
      systems: [],
    };
  }

  const mode: CohortMsqOutcomes["mode"] = withTrend.length > 0 ? "trend" : "baseline";

  // ── Headline totals ──────────────────────────────────────────────────────
  const avgBaselineTotal = Math.round(mean(withMsq.map((c) => c.entries[0].total)));
  let avgLatestTotal: number | null = null;
  let deltaPct: number | null = null;
  if (withTrend.length > 0) {
    avgLatestTotal = Math.round(mean(withTrend.map((c) => c.entries[c.entries.length - 1].total)));
    deltaPct = Math.round(
      mean(
        withTrend.map((c) => {
          const b = c.entries[0].total;
          const l = c.entries[c.entries.length - 1].total;
          return b > 0 ? ((l - b) / b) * 100 : 0;
        }),
      ),
    );
  }

  // ── Cohort sparkline: avg total at each submission index ──────────────────
  const maxLen = Math.max(...withMsq.map((c) => c.entries.length));
  const cohortPoints: number[] = [];
  for (let i = 0; i < maxLen; i++) {
    const vals = withMsq.filter((c) => c.entries.length > i).map((c) => c.entries[i].total);
    if (vals.length) cohortPoints.push(Math.round(mean(vals)));
  }

  // ── Per-system rollup ─────────────────────────────────────────────────────
  const systems: CohortMsqSystem[] = MSQ_CATEGORIES.map((cat) => {
    const avgBaseline = round1(mean(withMsq.map((c) => c.entries[0].categoryTotals[cat.id] ?? 0)));
    let avgLatest: number | null = null;
    let improving = 0;
    let holding = 0;
    let worse = 0;
    let avgDeltaPct: number | null = null;
    if (withTrend.length > 0) {
      avgLatest = round1(mean(withTrend.map((c) => c.entries[c.entries.length - 1].categoryTotals[cat.id] ?? 0)));
      const pcts: number[] = [];
      for (const c of withTrend) {
        const b = c.entries[0].categoryTotals[cat.id] ?? 0;
        const l = c.entries[c.entries.length - 1].categoryTotals[cat.id] ?? 0;
        const d = l - b;
        if (d <= -IMPROVE_DELTA) improving++;
        else if (d >= IMPROVE_DELTA) worse++;
        else holding++;
        if (b > 0) pcts.push(((l - b) / b) * 100);
      }
      avgDeltaPct = pcts.length ? Math.round(mean(pcts)) : 0;
    }
    return { id: cat.id, label: cat.label, avgBaseline, avgLatest, improving, holding, worse, avgDeltaPct };
  });

  if (mode === "trend") {
    // Biggest movers first: net improving, then most-negative % change.
    systems.sort(
      (a, b) => b.improving - b.worse - (a.improving - a.worse) || (a.avgDeltaPct ?? 0) - (b.avgDeltaPct ?? 0),
    );
  } else {
    // Baseline mode: where the cohort's burden concentrates.
    systems.sort((a, b) => b.avgBaseline - a.avgBaseline);
  }

  return {
    mode,
    clientsWithMsq: withMsq.length,
    clientsWithTrend: withTrend.length,
    avgBaselineTotal,
    avgLatestTotal,
    baselineBandLabel: msqBand(avgBaselineTotal).label,
    latestBandLabel: avgLatestTotal != null ? msqBand(avgLatestTotal).label : null,
    deltaPct,
    cohortPoints,
    systems,
  };
}

// ── Per-system drill-down (Phase 2) ──────────────────────────────────────────

export interface SystemMsqItem {
  index: number;
  label: string;
  /** Mean baseline score (0–4) for this item across clients with ≥1 MSQ. */
  avgBaseline: number;
  avgLatest: number | null;
  improving: number;
  holding: number;
  worse: number;
}

export interface SystemMsqClient {
  clientId: string;
  displayName: string;
  /** This client's baseline total for the system (0 … items×4). */
  baseline: number;
  latest: number | null;
  deltaPct: number | null;
}

export interface SystemMsqDetail {
  mode: "trend" | "baseline" | "empty";
  systemId: string;
  label: string;
  clientsWithMsq: number;
  clientsWithTrend: number;
  avgBaseline: number | null;
  avgLatest: number | null;
  deltaPct: number | null;
  /** Worst score the system can reach (item count × 4) — for bar scaling. */
  maxScore: number;
  items: SystemMsqItem[];
  clients: SystemMsqClient[];
}

/** Drill-down for one MSQ system: the items inside it + the clients carrying
 *  the most burden. Returns null for an unknown systemId (→ 404 at the page). */
export async function getSystemMsqDetail(
  clients: { client_id: string; display_name?: string }[],
  systemId: string,
): Promise<SystemMsqDetail | null> {
  const cat = MSQ_CATEGORIES.find((c) => c.id === systemId);
  if (!cat) return null;
  const root = getPlansRoot();
  const perClient = await Promise.all(
    clients.map(async (c) => ({
      id: c.client_id,
      name: c.display_name || c.client_id,
      entries: await readClientMsqEntries(root, c.client_id),
    })),
  );
  const withMsq = perClient.filter((c) => c.entries.length >= 1);
  const withTrend = perClient.filter((c) => c.entries.length >= 2);
  const maxScore = cat.items.length * 4;
  const lastOf = (es: MsqEntry[]) => es[es.length - 1];

  if (withMsq.length === 0) {
    return {
      mode: "empty",
      systemId,
      label: cat.label,
      clientsWithMsq: 0,
      clientsWithTrend: 0,
      avgBaseline: null,
      avgLatest: null,
      deltaPct: null,
      maxScore,
      items: [],
      clients: [],
    };
  }

  const mode: SystemMsqDetail["mode"] = withTrend.length > 0 ? "trend" : "baseline";

  const avgBaseline = round1(mean(withMsq.map((c) => c.entries[0].categoryTotals[systemId] ?? 0)));
  let avgLatest: number | null = null;
  let deltaPct: number | null = null;
  if (withTrend.length > 0) {
    avgLatest = round1(mean(withTrend.map((c) => lastOf(c.entries).categoryTotals[systemId] ?? 0)));
    deltaPct = Math.round(
      mean(
        withTrend.map((c) => {
          const b = c.entries[0].categoryTotals[systemId] ?? 0;
          const l = lastOf(c.entries).categoryTotals[systemId] ?? 0;
          return b > 0 ? ((l - b) / b) * 100 : 0;
        }),
      ),
    );
  }

  const items: SystemMsqItem[] = cat.items.map((label, index) => {
    const key = `${systemId}.${index}`;
    const avgB = round1(mean(withMsq.map((c) => c.entries[0].answers[key] ?? 0)));
    let avgL: number | null = null;
    let improving = 0;
    let holding = 0;
    let worse = 0;
    if (withTrend.length > 0) {
      avgL = round1(mean(withTrend.map((c) => lastOf(c.entries).answers[key] ?? 0)));
      for (const c of withTrend) {
        const d = (lastOf(c.entries).answers[key] ?? 0) - (c.entries[0].answers[key] ?? 0);
        if (d <= -1) improving++;
        else if (d >= 1) worse++;
        else holding++;
      }
    }
    return { index, label, avgBaseline: avgB, avgLatest: avgL, improving, holding, worse };
  });
  if (mode === "trend") {
    items.sort((a, b) => b.improving - b.worse - (a.improving - a.worse) || b.avgBaseline - a.avgBaseline);
  } else {
    items.sort((a, b) => b.avgBaseline - a.avgBaseline);
  }

  const clientsOut: SystemMsqClient[] = withMsq
    .map((c) => {
      const baseline = c.entries[0].categoryTotals[systemId] ?? 0;
      let latest: number | null = null;
      let dPct: number | null = null;
      if (c.entries.length >= 2) {
        latest = lastOf(c.entries).categoryTotals[systemId] ?? 0;
        dPct = baseline > 0 ? Math.round(((latest - baseline) / baseline) * 100) : 0;
      }
      return { clientId: c.id, displayName: c.name, baseline, latest, deltaPct: dPct };
    })
    .sort((a, b) => b.baseline - a.baseline);

  return {
    mode,
    systemId,
    label: cat.label,
    clientsWithMsq: withMsq.length,
    clientsWithTrend: withTrend.length,
    avgBaseline,
    avgLatest,
    deltaPct,
    maxScore,
    items,
    clients: clientsOut,
  };
}
