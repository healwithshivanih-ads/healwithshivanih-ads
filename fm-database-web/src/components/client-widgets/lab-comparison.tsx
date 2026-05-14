"use client";

/**
 * LabComparison — side-by-side comparison of two health snapshots.
 *
 * Shows a table with rows = markers present in either snapshot,
 * columns = Marker | Snapshot A (date + value) | Snapshot B (date + value) | Delta
 */

import { useState } from "react";
import type { Client } from "@/lib/fmdb/types";

type Snapshot = NonNullable<Client["health_snapshots"]>[number];

// ── Helpers ────────────────────────────────────────────────────────────────────

function parseNum(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.-]/g, ""));
  return isNaN(n) ? null : n;
}

function fmtSnap(snap: Snapshot): string {
  return snap.date + (snap.source ? ` · ${snap.source.slice(0, 30)}` : "");
}

interface MarkerRow {
  name: string;
  unit: string;
  valA: string | null;
  valB: string | null;
  numA: number | null;
  numB: number | null;
}

function buildRows(snapA: Snapshot | null, snapB: Snapshot | null): MarkerRow[] {
  const names = new Set<string>();
  const unitMap: Record<string, string> = {};

  for (const snap of [snapA, snapB]) {
    if (!snap) continue;
    for (const lv of snap.lab_values ?? []) {
      names.add(lv.test_name);
      if (lv.unit && !unitMap[lv.test_name]) unitMap[lv.test_name] = lv.unit;
    }
  }

  // Also add measurement keys that have values in either snapshot
  const MEAS_KEYS: Array<[keyof NonNullable<Snapshot["measurements"]>, string, string]> = [
    ["weight_kg",             "Weight",           "kg"],
    ["waist_cm",              "Waist",             "cm"],
    ["hip_cm",                "Hip",               "cm"],
    ["height_cm",             "Height",            "cm"],
    ["bp_systolic",           "BP Systolic",       "mmHg"],
    ["bp_diastolic",          "BP Diastolic",      "mmHg"],
    ["hr_bpm",                "Heart Rate",        "bpm"],
  ];

  const measRows: MarkerRow[] = [];
  for (const [key, label, unit] of MEAS_KEYS) {
    const a = snapA?.measurements?.[key];
    const b = snapB?.measurements?.[key];
    if (a == null && b == null) continue;
    measRows.push({
      name: label,
      unit,
      valA: a != null ? String(a) : null,
      valB: b != null ? String(b) : null,
      numA: parseNum(a),
      numB: parseNum(b),
    });
  }

  // Lab rows
  const labRows: MarkerRow[] = Array.from(names).map((name) => {
    const lvA = snapA?.lab_values?.find((l) => l.test_name === name);
    const lvB = snapB?.lab_values?.find((l) => l.test_name === name);
    return {
      name,
      unit: unitMap[name] ?? "",
      valA: lvA?.value ?? null,
      valB: lvB?.value ?? null,
      numA: parseNum(lvA?.value),
      numB: parseNum(lvB?.value),
    };
  });

  return [...measRows, ...labRows];
}

// ── Delta cell ─────────────────────────────────────────────────────────────────

function DeltaCell({ numA, numB, lowerIsBetter }: { numA: number | null; numB: number | null; lowerIsBetter?: boolean }) {
  if (numA == null || numB == null) return <td className="px-3 py-2 text-xs text-muted-foreground">—</td>;
  const delta = numB - numA;
  if (delta === 0) return <td className="px-3 py-2 text-xs text-muted-foreground">±0</td>;

  const improved = lowerIsBetter ? delta < 0 : delta > 0;
  const cls = improved ? "text-emerald-700" : "text-red-600";
  const arrow = delta > 0 ? "↑" : "↓";
  const absStr = Math.abs(delta) < 10 ? Math.abs(delta).toFixed(1) : Math.abs(delta).toFixed(0);

  return (
    <td className={`px-3 py-2 text-xs font-semibold ${cls}`}>
      {arrow} {absStr}
    </td>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function LabComparison({ client }: { client: Client }) {
  const snapshots: Snapshot[] = [...(client.health_snapshots ?? [])].sort(
    (a, b) => b.date.localeCompare(a.date)          // newest first for dropdowns
  );

  const [idxA, setIdxA] = useState(0);
  const [idxB, setIdxB] = useState(Math.min(1, snapshots.length - 1));

  if (snapshots.length < 2) return null;

  const snapA = snapshots[idxA] ?? null;
  const snapB = snapshots[idxB] ?? null;
  const rows = buildRows(snapA, snapB);

  const hasData = rows.length > 0;

  return (
    <details className="group">
      <summary className="cursor-pointer select-none list-none flex items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-foreground mb-3">
        <span className="group-open:hidden">▶</span>
        <span className="hidden group-open:inline">▼</span>
        <span>📊 Compare snapshots</span>
      </summary>

      <div className="space-y-4 mt-3">
        {/* Snapshot selectors */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Snapshot A (baseline)
            </label>
            <select
              value={idxA}
              onChange={(e) => setIdxA(Number(e.target.value))}
              className="w-full rounded border border-input bg-background px-2 py-1.5 text-sm"
            >
              {snapshots.map((s, i) => (
                <option key={i} value={i} disabled={i === idxB}>
                  {s.date}{s.source ? ` · ${s.source.slice(0, 25)}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Snapshot B (follow-up)
            </label>
            <select
              value={idxB}
              onChange={(e) => setIdxB(Number(e.target.value))}
              className="w-full rounded border border-input bg-background px-2 py-1.5 text-sm"
            >
              {snapshots.map((s, i) => (
                <option key={i} value={i} disabled={i === idxA}>
                  {s.date}{s.source ? ` · ${s.source.slice(0, 25)}` : ""}
                </option>
              ))}
            </select>
          </div>
        </div>

        {!hasData && (
          <p className="text-xs text-muted-foreground italic">
            Neither snapshot contains numeric lab values or measurements to compare.
          </p>
        )}

        {hasData && (
          <div className="overflow-x-auto rounded border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/40 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 text-left">Marker</th>
                  <th className="px-3 py-2 text-left">
                    A — {snapA?.date ?? "—"}
                  </th>
                  <th className="px-3 py-2 text-left">
                    B — {snapB?.date ?? "—"}
                  </th>
                  <th className="px-3 py-2 text-left">Change (B − A)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const hasNumeric = row.numA != null || row.numB != null;
                  return (
                    <tr key={i} className={`border-t border-muted/40 ${i % 2 === 0 ? "" : "bg-muted/10"}`}>
                      <td className="px-3 py-2 text-xs font-medium whitespace-nowrap">
                        {row.name}
                        {row.unit && (
                          <span className="ml-1 text-muted-foreground font-normal">({row.unit})</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {row.valA != null ? (
                          <span className="font-semibold">{row.valA}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {row.valB != null ? (
                          <span className="font-semibold">{row.valB}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      {hasNumeric ? (
                        <DeltaCell numA={row.numA} numB={row.numB} />
                      ) : (
                        <td className="px-3 py-2 text-xs text-muted-foreground">—</td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-[11px] text-muted-foreground">
          Snapshots are recorded when labs are uploaded or health data is manually entered.
          ↑ = increased, ↓ = decreased vs Snapshot A. Delta colours assume lower = better for most markers.
        </p>
      </div>
    </details>
  );
}
