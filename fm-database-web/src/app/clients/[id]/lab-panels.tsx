"use client";

import { useState } from "react";

export type LabMarker = {
  marker_name: string;
  value: number;
  unit?: string;
  reference_range?: string;
  flag: string;
  fm_interpretation?: string;
  panel?: string;
  computed?: boolean;
};

// ── Visual helpers ──────────────────────────────────────────────────────────

const PANEL_META: Record<
  string,
  { icon: string; order: number; description: string }
> = {
  "Metabolic & Insulin":     { icon: "🍬", order: 1, description: "Glucose, insulin sensitivity, HOMA-IR, HbA1c" },
  "Thyroid":                 { icon: "🦋", order: 2, description: "TSH, T3, T4, antibodies, conversion ratios" },
  "Liver Function":          { icon: "🫁", order: 3, description: "ALT, AST, GGT, bilirubin, albumin" },
  "Kidney Function":         { icon: "🫘", order: 4, description: "BUN, creatinine, eGFR, BUN/Cr ratio" },
  "Cardiovascular & Lipids": { icon: "❤️",  order: 5, description: "Cholesterol, TG, HDL, hsCRP, homocysteine" },
  "Iron & Blood":            { icon: "🩸", order: 6, description: "Ferritin, hemoglobin, serum iron, MCV" },
  "Key Nutrients":           { icon: "💊", order: 7, description: "Vitamin D, B12, folate, magnesium, zinc" },
};

function flagDot(flag: string) {
  if (flag === "optimal") return { dot: "🟢", cls: "text-emerald-700 bg-emerald-50 border-emerald-200" };
  if (flag === "suboptimal" || flag === "low-normal") return { dot: "🟡", cls: "text-amber-700 bg-amber-50 border-amber-200" };
  return { dot: "🔴", cls: "text-red-700 bg-red-50 border-red-200" };
}

function panelSummary(markers: LabMarker[]) {
  const optimal = markers.filter((m) => m.flag === "optimal").length;
  const suboptimal = markers.filter((m) => m.flag === "suboptimal" || m.flag === "low-normal").length;
  const flagged = markers.length - optimal - suboptimal;
  return { optimal, suboptimal, flagged };
}

// ── Single panel accordion ──────────────────────────────────────────────────

function PanelSection({
  panelName,
  markers,
  open,
  onToggle,
}: {
  panelName: string;
  markers: LabMarker[];
  open: boolean;
  onToggle: () => void;
}) {
  const meta = PANEL_META[panelName] ?? { icon: "🔬", order: 99, description: "" };
  const { optimal, suboptimal, flagged } = panelSummary(markers);

  return (
    <div className="border rounded-lg overflow-hidden">
      {/* Header row */}
      <button
        type="button"
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors"
        onClick={onToggle}
      >
        <span className="text-lg leading-none shrink-0">{meta.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm">{panelName}</span>
            <span className="text-xs text-muted-foreground hidden sm:inline">{meta.description}</span>
          </div>
        </div>
        {/* Flag summary pills */}
        <div className="flex items-center gap-1.5 shrink-0">
          {flagged > 0 && (
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-200">
              🔴 {flagged}
            </span>
          )}
          {suboptimal > 0 && (
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
              🟡 {suboptimal}
            </span>
          )}
          {optimal > 0 && (
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">
              🟢 {optimal}
            </span>
          )}
          <span className="text-muted-foreground ml-1 text-sm">{open ? "▲" : "▼"}</span>
        </div>
      </button>

      {/* Expanded table */}
      {open && (
        <div className="border-t overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr className="text-xs text-muted-foreground">
                <th className="text-left px-4 py-2 font-medium">Marker</th>
                <th className="text-left px-4 py-2 font-medium">Value</th>
                <th className="text-left px-4 py-2 font-medium hidden md:table-cell">FM Optimal Range</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
                <th className="text-left px-4 py-2 font-medium hidden lg:table-cell">Interpretation</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {markers.map((m, i) => {
                const { dot, cls } = flagDot(m.flag);
                return (
                  <tr key={i} className="hover:bg-muted/20">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-medium">{m.marker_name}</span>
                        {m.computed && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-200 font-medium">
                            ratio
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-sm font-semibold">
                      {m.value}{m.unit ? <span className="font-normal text-xs text-muted-foreground ml-1">{m.unit}</span> : null}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground hidden md:table-cell max-w-[200px]">
                      {m.reference_range ?? "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded border ${cls}`}>
                        <span>{dot}</span>
                        <span className="capitalize">{m.flag}</span>
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground hidden lg:table-cell max-w-xs">
                      {m.fm_interpretation ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Mobile: show interpretation inline since lg column is hidden */}
          <div className="lg:hidden divide-y border-t">
            {markers.map((m, i) => (
              m.fm_interpretation ? (
                <div key={i} className="px-4 py-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{m.marker_name}:</span>{" "}
                  {m.fm_interpretation}
                </div>
              ) : null
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main export ─────────────────────────────────────────────────────────────

export function LabPanels({ markers }: { markers: LabMarker[] }) {
  // Group by panel
  const grouped = new Map<string, LabMarker[]>();
  const OTHER = "Other";

  for (const m of markers) {
    const key = m.panel && PANEL_META[m.panel] ? m.panel : OTHER;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(m);
  }

  // Sort panels by defined order, "Other" last
  const panels = [...grouped.entries()].sort(([a], [b]) => {
    const oa = PANEL_META[a]?.order ?? 99;
    const ob = PANEL_META[b]?.order ?? 99;
    return oa - ob;
  });

  const totalFlagged = markers.filter(
    (m) => m.flag !== "optimal" && m.flag !== "suboptimal" && m.flag !== "low-normal"
  ).length;
  const totalSuboptimal = markers.filter(
    (m) => m.flag === "suboptimal" || m.flag === "low-normal"
  ).length;
  const totalOptimal = markers.filter((m) => m.flag === "optimal").length;

  // Auto-open panels that have non-optimal markers
  const autoOpen = new Set<string>();
  for (const [name, ms] of panels) {
    if (ms.some((m) => m.flag !== "optimal")) autoOpen.add(name);
  }

  // Controlled open state — keyed by panel name so Expand All / Collapse All work
  const [openPanels, setOpenPanels] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const [name] of panels) init[name] = autoOpen.has(name);
    return init;
  });

  const allOpen  = panels.every(([name]) => openPanels[name]);
  const allClosed = panels.every(([name]) => !openPanels[name]);

  const expandAll  = () => setOpenPanels(Object.fromEntries(panels.map(([n]) => [n, true])));
  const collapseAll = () => setOpenPanels(Object.fromEntries(panels.map(([n]) => [n, false])));
  const toggle = (name: string) =>
    setOpenPanels((prev) => ({ ...prev, [name]: !prev[name] }));

  if (panels.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic">
        No lab markers on record. Run an assessment and save health data to see panels here.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {/* Summary bar */}
      <div className="flex items-center gap-4 flex-wrap text-sm">
        <span className="text-muted-foreground">{markers.length} markers across {panels.length} panels</span>
        <div className="flex items-center gap-2">
          {totalFlagged > 0 && (
            <span className="font-medium text-red-700">🔴 {totalFlagged} flagged</span>
          )}
          {totalSuboptimal > 0 && (
            <span className="font-medium text-amber-700">🟡 {totalSuboptimal} suboptimal</span>
          )}
          {totalOptimal > 0 && (
            <span className="font-medium text-emerald-700">🟢 {totalOptimal} optimal</span>
          )}
        </div>
        <div className="ml-auto flex gap-2 text-xs">
          {!allOpen && (
            <button
              type="button"
              onClick={expandAll}
              className="text-muted-foreground hover:text-foreground underline underline-offset-2"
            >
              Expand all
            </button>
          )}
          {!allClosed && (
            <button
              type="button"
              onClick={collapseAll}
              className="text-muted-foreground hover:text-foreground underline underline-offset-2"
            >
              Collapse all
            </button>
          )}
        </div>
      </div>

      {/* Panel accordions */}
      <div className="space-y-2">
        {panels.map(([name, ms]) => (
          <PanelSection
            key={name}
            panelName={name}
            markers={ms}
            open={openPanels[name] ?? false}
            onToggle={() => toggle(name)}
          />
        ))}
      </div>

      <p className="text-[11px] text-muted-foreground">
        FM optimal ranges are functional medicine targets and may differ from standard lab reference ranges.
        Individual markers updated during each assessment session.
      </p>
    </div>
  );
}
