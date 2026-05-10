"use client";

import { useEffect, useState } from "react";
import type { Client } from "@/lib/fmdb/types";
import {
  loadLabReferenceRangesAction,
  loadLabTestsCatalogueAction,
  type LabReferenceRanges,
  type CatalogueLabRange,
} from "@/app/clients/actions";

type Snapshot = NonNullable<Client["health_snapshots"]>[number];

// ─── SVG sparkline ────────────────────────────────────────────────────────────

function Sparkline({
  values,
  color = "#059669",
  height = 40,
  width = 160,
}: {
  values: number[];
  color?: string;
  height?: number;
  width?: number;
}) {
  if (values.length < 2) {
    return (
      <span className="text-[10px] text-muted-foreground italic">
        {values.length === 1 ? `${values[0]}` : "—"}
      </span>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pad = 4;

  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (width - pad * 2);
    const y = pad + ((max - v) / range) * (height - pad * 2);
    return [x, y] as [number, number];
  });

  const d = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x} ${y}`).join(" ");
  const last = pts[pts.length - 1];

  return (
    <svg width={width} height={height} className="overflow-visible">
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      {/* Last value dot */}
      <circle cx={last[0]} cy={last[1]} r={3} fill={color} />
      {/* Tooltip-style label at each point */}
      {pts.map(([x, y], i) => (
        <title key={i}>{`${values[i]}`}</title>
      ))}
    </svg>
  );
}

// ─── Reference range status ───────────────────────────────────────────────────

function rangeStatus(
  value: number,
  range?: { optimal_low?: number; optimal_high?: number }
): "optimal" | "outside" | null {
  if (!range) return null;
  const { optimal_low, optimal_high } = range;
  if (optimal_low == null && optimal_high == null) return null;
  const tooLow = optimal_low != null && value < optimal_low;
  const tooHigh = optimal_high != null && value > optimal_high;
  return tooLow || tooHigh ? "outside" : "optimal";
}

// ─── Catalogue match: find LabTest record matching a free-form test name ──────
// Used to surface FM-optimal AND conventional ranges side-by-side. Match is
// case-insensitive substring across slug + display_name + full_name + aliases.
// Bidirectional — handles "TSH" matching alias "tsh" AND "Vitamin D 25-OH"
// matching alias "vitamin d".
function findCatalogueLabTest(
  testName: string,
  catalogue: CatalogueLabRange[],
): CatalogueLabRange | null {
  const needle = testName.trim().toLowerCase();
  if (!needle) return null;
  // First pass — exact key match (fastest path)
  for (const t of catalogue) {
    if (t.match_keys.includes(needle)) return t;
  }
  // Second pass — bidirectional substring (handles "TSH (mIU/L)" matching "tsh")
  for (const t of catalogue) {
    for (const key of t.match_keys) {
      if (needle.includes(key) || key.includes(needle)) return t;
    }
  }
  return null;
}

// ─── Metric row ───────────────────────────────────────────────────────────────

function MetricRow({
  label,
  unit,
  data,
  color,
  refRange,
  catalogueMatch,
}: {
  label: string;
  unit: string;
  data: Array<{ date: string; value: number }>;
  color?: string;
  /** Per-client override (from client.lab_reference_ranges). Takes precedence over catalogue. */
  refRange?: { optimal_low?: number; optimal_high?: number; unit?: string };
  /** Catalogue LabTest record (FM optimal + conventional ranges). Fallback when no per-client override. */
  catalogueMatch?: CatalogueLabRange | null;
}) {
  if (data.length === 0) return null;
  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));
  const values = sorted.map(d => d.value);
  const latest = values[values.length - 1];
  const prev = values.length > 1 ? values[values.length - 2] : null;
  const delta = prev != null ? latest - prev : null;

  // Effective FM-optimal range — per-client override first, else catalogue.
  const effectiveOptimal = refRange && (refRange.optimal_low != null || refRange.optimal_high != null)
    ? { low: refRange.optimal_low, high: refRange.optimal_high, unit: refRange.unit, source: "client" as const }
    : catalogueMatch && (catalogueMatch.fm_optimal_low != null || catalogueMatch.fm_optimal_high != null)
    ? { low: catalogueMatch.fm_optimal_low ?? undefined, high: catalogueMatch.fm_optimal_high ?? undefined, unit: catalogueMatch.units, source: "catalogue" as const }
    : null;

  // Conventional range — only from catalogue.
  const conventional = catalogueMatch && (catalogueMatch.conventional_low != null || catalogueMatch.conventional_high != null)
    ? { low: catalogueMatch.conventional_low ?? undefined, high: catalogueMatch.conventional_high ?? undefined, unit: catalogueMatch.units }
    : null;

  const status = rangeStatus(latest, effectiveOptimal ? { optimal_low: effectiveOptimal.low, optimal_high: effectiveOptimal.high } : undefined);

  // Cross-reference: is value within conventional but outside FM-optimal?
  const inConventional = conventional && (
    (conventional.low == null || latest >= conventional.low) &&
    (conventional.high == null || latest <= conventional.high)
  );
  const subOptimalGap = status === "outside" && inConventional;  // the "your lab calls this fine but FM flags it" case

  const statusDot = status === "optimal"
    ? <span title="Within FM optimal range" className="ml-1 text-emerald-600 text-[10px]">🟢</span>
    : subOptimalGap
    ? <span title="Within conventional 'normal' but outside FM optimal" className="ml-1 text-amber-500 text-[10px]">🟡</span>
    : status === "outside"
    ? <span title="Outside FM + conventional ranges" className="ml-1 text-red-500 text-[10px]">🔴</span>
    : null;

  const rangeBlock = (effectiveOptimal || conventional) ? (
    <div className="text-[9px] text-muted-foreground mt-0.5 space-x-2">
      {effectiveOptimal && (
        <span title={effectiveOptimal.source === "client" ? "Per-client override" : "FM catalogue default"}>
          <span className="text-emerald-700 font-medium">FM: </span>
          {effectiveOptimal.low ?? "—"}–{effectiveOptimal.high ?? "—"}
          {effectiveOptimal.unit ? ` ${effectiveOptimal.unit}` : ""}
          {effectiveOptimal.source === "client" && <span className="ml-0.5 opacity-60">(custom)</span>}
        </span>
      )}
      {conventional && (
        <span>
          <span className="text-slate-500 font-medium">conv: </span>
          {conventional.low ?? "—"}–{conventional.high ?? "—"}
          {conventional.unit ? ` ${conventional.unit}` : ""}
        </span>
      )}
    </div>
  ) : null;

  return (
    <tr className="border-t border-muted/50">
      <td className="py-2 pr-3 text-xs font-medium whitespace-nowrap">{label}</td>
      <td className="py-2 pr-3 text-xs">
        <div className="flex items-center gap-0.5">
          <span className="font-semibold">{latest}</span>
          <span className="text-muted-foreground ml-1">{unit}</span>
          {statusDot}
          {delta != null && (
            <span className={`ml-1.5 text-[10px] ${delta < 0 ? "text-emerald-600" : delta > 0 ? "text-red-500" : "text-muted-foreground"}`}>
              {delta > 0 ? `+${delta.toFixed(1)}` : delta < 0 ? delta.toFixed(1) : "±0"}
            </span>
          )}
        </div>
        {rangeBlock}
      </td>
      <td className="py-2 pr-3">
        <Sparkline values={values} color={color} />
      </td>
      <td className="py-2 text-[10px] text-muted-foreground whitespace-nowrap">{sorted[sorted.length - 1].date}</td>
    </tr>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function HealthTrends({ client }: { client: Client }) {
  const [tab, setTab] = useState<"charts" | "timeline">("charts");
  const [refRanges, setRefRanges] = useState<LabReferenceRanges>({});
  const [labCatalogue, setLabCatalogue] = useState<CatalogueLabRange[]>([]);

  useEffect(() => {
    const clientId = (client as { client_id?: string }).client_id;
    if (clientId) {
      loadLabReferenceRangesAction(clientId).then(setRefRanges).catch(() => {});
    }
    loadLabTestsCatalogueAction().then(setLabCatalogue).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [(client as { client_id?: string }).client_id]);
  const snapshots: Snapshot[] = (client.health_snapshots ?? []).sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  if (snapshots.length === 0) return null;

  // ── Collect per-metric time series ──────────────────────────────────────────
  const series: Record<string, Array<{ date: string; value: number }>> = {};

  const push = (key: string, date: string, value: number | null | undefined) => {
    if (value == null) return;
    const num = Number(value);
    if (isNaN(num)) return;
    if (!series[key]) series[key] = [];
    series[key].push({ date, value: num });
  };

  // Measurement series
  for (const snap of snapshots) {
    const m = snap.measurements ?? {};
    push("weight_kg", snap.date, m.weight_kg);
    push("height_cm", snap.date, m.height_cm);
    push("bp_systolic", snap.date, m.bp_systolic);
    push("bp_diastolic", snap.date, m.bp_diastolic);
    push("hr_bpm", snap.date, m.hr_bpm);
    push("waist_cm", snap.date, m.waist_cm);
    push("hip_cm", snap.date, m.hip_cm);
    // Derived: waist-to-hip ratio
    if (m.waist_cm != null && m.hip_cm != null && m.hip_cm > 0) {
      push("whr", snap.date, Math.round((m.waist_cm / m.hip_cm) * 100) / 100);
    }
  }

  // Lab value series
  for (const snap of snapshots) {
    for (const lv of snap.lab_values ?? []) {
      const num = parseFloat(lv.value);
      if (!isNaN(num)) push(`lab:${lv.test_name}`, snap.date, num);
    }
  }

  // Also pull from lab_markers on the client (single point, latest)
  for (const lm of client.lab_markers ?? []) {
    const key = `ratio:${lm.marker_name}`;
    if (!series[key]) {
      series[key] = [{ date: client.lab_markers_date ?? "—", value: lm.value }];
    }
  }

  const labKeys = Object.keys(series).filter(k => k.startsWith("lab:"));
  const ratioKeys = Object.keys(series).filter(k => k.startsWith("ratio:"));

  const measConfig: [string, string, string, string][] = [
    ["weight_kg", "Weight", "kg", "#059669"],
    ["bp_systolic", "BP Systolic", "mmHg", "#dc2626"],
    ["bp_diastolic", "BP Diastolic", "mmHg", "#f97316"],
    ["hr_bpm", "Heart Rate", "bpm", "#7c3aed"],
    ["waist_cm", "Waist", "cm", "#0284c7"],
    ["hip_cm", "Hip", "cm", "#0891b2"],
    ["whr", "Waist-to-Hip Ratio", "", "#b45309"],
    ["height_cm", "Height", "cm", "#6b7280"],
  ];

  return (
    <div className="space-y-4">
      {/* Tab switcher */}
      <div className="flex gap-1 text-xs border-b">
        {([["charts", "📈 Charts & trends"], ["timeline", "🗓 Timeline"]] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-3 py-1.5 -mb-px border-b-2 transition-colors ${
              tab === key
                ? "border-emerald-600 text-emerald-700 font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "charts" && (
        <div className="space-y-6">
          {/* Measurements */}
          {measConfig.some(([key]) => series[key]?.length) && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Measurements</p>
              <table className="w-full">
                <thead>
                  <tr className="text-[10px] text-muted-foreground text-left">
                    <th className="pr-3 pb-1 font-medium">Metric</th>
                    <th className="pr-3 pb-1 font-medium">Latest</th>
                    <th className="pr-3 pb-1 font-medium">Trend ({snapshots.length} point{snapshots.length !== 1 ? "s" : ""})</th>
                    <th className="pb-1 font-medium">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {measConfig.map(([key, label, unit, color]) =>
                    series[key] ? (
                      <MetricRow
                        key={key}
                        label={label}
                        unit={unit}
                        data={series[key]}
                        color={color}
                        refRange={refRanges[label]}
                        catalogueMatch={findCatalogueLabTest(label, labCatalogue)}
                      />
                    ) : null
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Lab values */}
          {labKeys.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Lab values (across reports)</p>
              <table className="w-full">
                <thead>
                  <tr className="text-[10px] text-muted-foreground text-left">
                    <th className="pr-3 pb-1 font-medium">Test</th>
                    <th className="pr-3 pb-1 font-medium">Latest</th>
                    <th className="pr-3 pb-1 font-medium">Trend</th>
                    <th className="pb-1 font-medium">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {labKeys.map(key => {
                    const testName = key.replace("lab:", "");
                    // Try to get unit from last snapshot that has this lab
                    let unit = "";
                    for (const snap of [...snapshots].reverse()) {
                      const lv = (snap.lab_values ?? []).find(l => l.test_name === testName);
                      if (lv?.unit) { unit = lv.unit; break; }
                    }
                    return (
                      <MetricRow
                        key={key}
                        label={testName}
                        unit={unit}
                        data={series[key]}
                        color="#0284c7"
                        refRange={refRanges[testName]}
                        catalogueMatch={findCatalogueLabTest(testName, labCatalogue)}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* FM lab markers from last assess run, split into computed ratios vs raw values */}
          {ratioKeys.length > 0 && (() => {
            const isComputed = (name: string) => {
              const n = name.toLowerCase();
              return n.includes("ratio") || n.includes("homa") || n.startsWith("non-hdl") || n.startsWith("non hdl");
            };
            const markers = client.lab_markers ?? [];
            const computed = markers.filter((lm) => isComputed(lm.marker_name));
            const values = markers.filter((lm) => !isComputed(lm.marker_name));
            const renderCard = (lm: typeof markers[number], i: number) => (
              <div key={i} className="rounded border px-3 py-2 text-xs space-y-0.5 min-w-[120px]">
                <p className="font-medium">{lm.marker_name}</p>
                <p>
                  <span className={`font-semibold ${lm.flag === "optimal" ? "text-emerald-700" : lm.flag === "suboptimal" ? "text-amber-600" : "text-red-600"}`}>
                    {lm.value}
                  </span>
                  {lm.unit && <span className="text-muted-foreground ml-1">{lm.unit}</span>}
                </p>
                <p className="text-[10px] text-muted-foreground">{lm.flag}</p>
              </div>
            );
            return (
              <div className="space-y-5">
                {computed.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">FM computed ratios (latest assess)</p>
                    <div className="flex flex-wrap gap-3">{computed.map(renderCard)}</div>
                  </div>
                )}
                {values.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">FM lab markers (latest assess)</p>
                    <div className="flex flex-wrap gap-3">{values.map(renderCard)}</div>
                  </div>
                )}
              </div>
            );
          })()}

          {!measConfig.some(([key]) => series[key]?.length) && labKeys.length === 0 && ratioKeys.length === 0 && (
            <p className="text-xs text-muted-foreground italic">No numeric data to chart yet. Snapshots with lab values or measurements will appear here.</p>
          )}
        </div>
      )}

      {tab === "timeline" && (
        <div className="space-y-3">
          {[...snapshots].reverse().map((snap, i) => (
            <div key={i} className="rounded-lg border bg-card p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold">{snap.date}</span>
                <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{snap.source}</span>
              </div>

              {snap.measurements && Object.values(snap.measurements).some(v => v != null) && (
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
                  {snap.measurements.weight_kg != null && <span>Weight: <strong>{snap.measurements.weight_kg} kg</strong></span>}
                  {snap.measurements.height_cm != null && <span>Height: <strong>{snap.measurements.height_cm} cm</strong></span>}
                  {snap.measurements.bp_systolic != null && snap.measurements.bp_diastolic != null && (
                    <span>BP: <strong>{snap.measurements.bp_systolic}/{snap.measurements.bp_diastolic}</strong></span>
                  )}
                  {snap.measurements.hr_bpm != null && <span>HR: <strong>{snap.measurements.hr_bpm}</strong></span>}
                  {snap.measurements.waist_cm != null && <span>Waist: <strong>{snap.measurements.waist_cm} cm</strong></span>}
                  {snap.measurements.hip_cm != null && <span>Hip: <strong>{snap.measurements.hip_cm} cm</strong></span>}
                  {snap.measurements.waist_cm != null && snap.measurements.hip_cm != null && snap.measurements.hip_cm > 0 && (
                    <span>W:H ratio: <strong>{(snap.measurements.waist_cm / snap.measurements.hip_cm).toFixed(2)}</strong></span>
                  )}
                </div>
              )}

              {(snap.lab_values ?? []).length > 0 && (
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                  {snap.lab_values!.map((lv, j) => (
                    <span key={j} className="text-[11px]">
                      <span className="text-muted-foreground">{lv.test_name}:</span>{" "}
                      <strong>{lv.value}</strong>{lv.unit && <span className="text-muted-foreground"> {lv.unit}</span>}
                    </span>
                  ))}
                </div>
              )}

              {(snap.medications ?? []).length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Meds: {snap.medications!.join(", ")}
                </p>
              )}

              {(snap.conditions ?? []).length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {snap.conditions!.map((c, j) => (
                    <span key={j} className="rounded-full border px-1.5 py-0.5 text-[10px] bg-background">{c}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
