"use client";

/**
 * SessionMarkerChartsClient — 5-6 trend tiles for client-relevant markers.
 *
 * - Tile grid (auto-fill, minmax 150px). Each tile: label, big value, unit,
 *   tiny sparkline, delta line.
 * - Baseline toggle pill: vs Intake / vs Previous / 4-wk avg — changes the
 *   delta reference.
 * - Click a tile → popover with grouped, searchable marker list to swap
 *   that tile for any other marker the client has data for.
 * - Selection persisted via saveSessionChartMarkersAction.
 *
 * Range colouring uses per-client `lab_reference_ranges` first, then
 * catalogue LabTest record (FM optimal AND conventional). 🟢 in FM optimal,
 * 🟡 outside FM but in conventional, 🔴 outside both, no dot if no ranges.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { FmPanel } from "@/components/fm";
import {
  saveSessionChartMarkersAction,
  type CatalogueLabRange,
  type LabReferenceRanges,
} from "@/app/clients/actions";

// ─── Types ────────────────────────────────────────────────────────────────────

export type MarkerGroup =
  | "Body comp"
  | "Vitals"
  | "Blood markers"
  | "Other";

export interface MarkerPoint {
  date: string; // YYYY-MM-DD
  value: number;
}

export interface MarkerOption {
  key: string; // stable: e.g. "measurement:weight_kg" or "lab:TSH"
  label: string;
  unit: string;
  group: MarkerGroup;
  /** Lower is better? Used to colour the trend arrow when no ranges available. */
  desired?: "down" | "up" | "neutral";
}

export interface MarkerWithData extends MarkerOption {
  series: MarkerPoint[]; // sorted ascending by date
}

type Baseline = "intake" | "previous" | "fourwk";

// ─── Sparkline (per F5B spec) ────────────────────────────────────────────────

function Sparkline({
  values,
  color,
  width = 120,
  height = 22,
}: {
  values: number[];
  color: string;
  width?: number;
  height?: number;
}) {
  if (values.length < 2) {
    return (
      <svg width={width} height={height} aria-hidden>
        <line
          x1={2}
          y1={height - 2}
          x2={width - 2}
          y2={height - 2}
          stroke="var(--fm-border)"
          strokeWidth={1}
          strokeDasharray="2 2"
        />
      </svg>
    );
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pad = 2;
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (width - pad * 2);
    const y = pad + ((max - v) / range) * (height - pad * 2);
    return [x, y] as const;
  });
  const polyline = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <svg width={width} height={height} aria-hidden style={{ display: "block" }}>
      <polyline
        points={polyline}
        fill="none"
        stroke={color}
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ vectorEffect: "non-scaling-stroke" } as React.CSSProperties}
      />
      <circle cx={last[0]} cy={last[1]} r={2} fill={color} />
    </svg>
  );
}

// ─── Ranges + status ──────────────────────────────────────────────────────────

function findCatalogueLabTest(
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

type Status = "optimal" | "watch" | "outside" | null;

function classifyValue(
  value: number,
  marker: MarkerOption,
  refRanges: LabReferenceRanges,
  catalogue: CatalogueLabRange[],
): Status {
  // For measurements stored as "measurement:<key>" we strip the prefix when
  // looking up; for lab values we use the raw label.
  const lookup = refRanges[marker.label];
  const cat = findCatalogueLabTest(marker.label, catalogue);

  const fm = lookup && (lookup.optimal_low != null || lookup.optimal_high != null)
    ? { low: lookup.optimal_low, high: lookup.optimal_high }
    : cat && (cat.fm_optimal_low != null || cat.fm_optimal_high != null)
    ? { low: cat.fm_optimal_low ?? undefined, high: cat.fm_optimal_high ?? undefined }
    : null;

  const conv = cat && (cat.conventional_low != null || cat.conventional_high != null)
    ? { low: cat.conventional_low ?? undefined, high: cat.conventional_high ?? undefined }
    : null;

  if (!fm && !conv) return null;

  const inFm = fm
    ? (fm.low == null || value >= fm.low) && (fm.high == null || value <= fm.high)
    : false;
  if (fm && inFm) return "optimal";

  const inConv = conv
    ? (conv.low == null || value >= conv.low) && (conv.high == null || value <= conv.high)
    : false;
  if (inConv) return "watch";

  return "outside";
}

function statusColor(s: Status): string {
  if (s === "optimal") return "var(--fm-success)";
  if (s === "watch") return "var(--fm-warning)";
  if (s === "outside") return "var(--fm-danger)";
  return "var(--fm-text-tertiary)";
}

function statusDot(s: Status): string | null {
  if (s === "optimal") return "🟢";
  if (s === "watch") return "🟡";
  if (s === "outside") return "🔴";
  return null;
}

// ─── Delta math ───────────────────────────────────────────────────────────────

function computeBaseline(series: MarkerPoint[], baseline: Baseline): number | null {
  if (series.length === 0) return null;
  if (series.length === 1) return null;
  const latest = series[series.length - 1];
  if (baseline === "intake") return series[0].value;
  if (baseline === "previous") return series[series.length - 2].value;
  // fourwk: average of values within last 28d excluding the latest
  try {
    const latestMs = new Date(latest.date).getTime();
    const cutoff = latestMs - 28 * 24 * 60 * 60 * 1000;
    const window = series.slice(0, -1).filter((p) => {
      const t = new Date(p.date).getTime();
      return !Number.isNaN(t) && t >= cutoff;
    });
    if (window.length === 0) {
      // Fallback: avg of all-but-last
      const rest = series.slice(0, -1);
      if (rest.length === 0) return null;
      return rest.reduce((a, b) => a + b.value, 0) / rest.length;
    }
    return window.reduce((a, b) => a + b.value, 0) / window.length;
  } catch {
    return null;
  }
}

function formatDelta(delta: number, unit: string): string {
  const abs = Math.abs(delta);
  const decimals = abs >= 10 ? 1 : abs >= 1 ? 1 : 2;
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "±";
  return `${sign}${abs.toFixed(decimals)}${unit ? ` ${unit}` : ""}`;
}

// ─── Goal → marker key match ──────────────────────────────────────────────────

const GOAL_RULES: Array<{ patterns: RegExp[]; markers: string[] }> = [
  {
    patterns: [/weight\s*loss/i, /lose\s*weight/i, /\bweight\b/i, /\bbody\s*comp/i, /\bbmi\b/i],
    markers: ["measurement:weight_kg", "measurement:waist_cm", "measurement:bmi", "lab:Body Fat %"],
  },
  {
    patterns: [/insulin/i, /diabet/i, /pcos/i, /glucose/i, /sugar/i],
    markers: ["lab:HOMA-IR", "lab:Fasting Glucose", "lab:Fasting Insulin", "lab:HbA1c", "lab:TG/HDL"],
  },
  {
    patterns: [/thyroid/i, /hashimoto/i],
    markers: ["lab:TSH", "lab:fT3", "lab:fT4", "lab:Anti-TPO", "lab:Free T3", "lab:Free T4"],
  },
  {
    patterns: [/perimenopause/i, /menopause/i, /hormon/i, /estrogen/i, /oestrogen/i, /progesterone/i],
    markers: ["lab:Oestradiol", "lab:Estradiol", "lab:Progesterone", "lab:FSH", "lab:LH", "lab:SHBG"],
  },
  {
    patterns: [/energy/i, /fatigue/i, /tired/i],
    markers: ["lab:Vitamin D", "lab:Ferritin", "lab:B12", "lab:Vitamin B12", "lab:TSH", "lab:Cortisol"],
  },
  {
    patterns: [/inflammat/i, /joint/i, /autoimmun/i],
    markers: ["lab:hsCRP", "lab:CRP", "lab:ESR", "lab:Fibrinogen", "lab:Homocysteine"],
  },
];

function pickDefaultMarkers(
  available: MarkerWithData[],
  goals: string[],
  cap: number,
): string[] {
  const availableKeys = new Set(availMatch(available));
  const out: string[] = [];
  const goalText = goals.join(" • ");
  for (const rule of GOAL_RULES) {
    if (!rule.patterns.some((p) => p.test(goalText))) continue;
    for (const wantKey of rule.markers) {
      const resolved = resolveMarkerKey(wantKey, availableKeys);
      if (resolved && !out.includes(resolved)) out.push(resolved);
      if (out.length >= cap) break;
    }
    if (out.length >= cap) break;
  }
  // Fallback: top-N by series length (most-tracked).
  if (out.length < cap) {
    const sorted = [...available]
      .filter((m) => !out.includes(m.key))
      .sort((a, b) => b.series.length - a.series.length);
    for (const m of sorted) {
      out.push(m.key);
      if (out.length >= cap) break;
    }
  }
  return out.slice(0, cap);
}

function availMatch(available: MarkerWithData[]): string[] {
  return available.map((m) => m.key);
}

/**
 * Resolve a wanted key (case-sensitive label) against available keys, also
 * trying case-insensitive label-substring match — handles "lab:TSH" matching
 * "lab:TSH (mIU/L)" or "lab:Vitamin D" matching "lab:Vitamin D 25-OH".
 */
function resolveMarkerKey(wantKey: string, available: Set<string>): string | null {
  if (available.has(wantKey)) return wantKey;
  const [prefix, ...rest] = wantKey.split(":");
  const wantLabel = rest.join(":").toLowerCase();
  if (!wantLabel) return null;
  for (const k of available) {
    if (!k.startsWith(prefix + ":")) continue;
    const label = k.slice(prefix.length + 1).toLowerCase();
    if (label === wantLabel || label.includes(wantLabel) || wantLabel.includes(label)) {
      return k;
    }
  }
  return null;
}

// ─── Tile ─────────────────────────────────────────────────────────────────────

function Tile({
  marker,
  baseline,
  refRanges,
  catalogue,
  onClick,
}: {
  marker: MarkerWithData;
  baseline: Baseline;
  refRanges: LabReferenceRanges;
  catalogue: CatalogueLabRange[];
  onClick: () => void;
}) {
  const series = marker.series;
  const latest = series[series.length - 1];
  const values = series.map((p) => p.value);

  const status: Status = latest ? classifyValue(latest.value, marker, refRanges, catalogue) : null;

  const baselineValue = computeBaseline(series, baseline);
  const delta = latest && baselineValue != null ? latest.value - baselineValue : null;

  // Spark colour: if status, follow status. Otherwise, if marker has a desired
  // direction and trend matches, use success. Else tertiary.
  const sparkColor =
    status === "optimal"
      ? "var(--fm-success)"
      : status === "watch"
      ? "var(--fm-warning)"
      : status === "outside"
      ? "var(--fm-danger)"
      : delta != null && marker.desired === "down" && delta < 0
      ? "var(--fm-success)"
      : delta != null && marker.desired === "up" && delta > 0
      ? "var(--fm-success)"
      : "var(--fm-text-tertiary)";

  // Delta colour: positive vs desired direction
  let deltaColor = "var(--fm-text-tertiary)";
  if (delta != null && delta !== 0) {
    if (marker.desired === "down") {
      deltaColor = delta < 0 ? "var(--fm-success)" : "var(--fm-danger)";
    } else if (marker.desired === "up") {
      deltaColor = delta > 0 ? "var(--fm-success)" : "var(--fm-danger)";
    } else {
      deltaColor = "var(--fm-text-secondary)";
    }
  }

  const baselineLabel =
    baseline === "intake" ? "vs intake" : baseline === "previous" ? "vs prev" : "vs 4-wk avg";

  return (
    <button
      type="button"
      onClick={onClick}
      title="Click to swap this marker"
      style={{
        textAlign: "left",
        padding: 10,
        background: "var(--fm-surface)",
        border: "1px solid var(--fm-border-light)",
        borderRadius: "var(--fm-radius-md)",
        cursor: "pointer",
        fontFamily: "inherit",
        display: "grid",
        gap: 4,
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontSize: 9.5,
          letterSpacing: 0.7,
          textTransform: "uppercase",
          fontWeight: 700,
          color: "var(--fm-text-tertiary)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {marker.label}
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 4, flexWrap: "wrap" }}>
        <span style={{ fontSize: 18, fontWeight: 700, color: "var(--fm-text-primary)" }}>
          {latest ? formatNumber(latest.value) : "—"}
        </span>
        {marker.unit && (
          <span style={{ fontSize: 10, color: "var(--fm-text-tertiary)" }}>{marker.unit}</span>
        )}
        {statusDot(status) && <span style={{ fontSize: 9 }}>{statusDot(status)}</span>}
      </div>

      <Sparkline values={values} color={sparkColor} />

      <div style={{ fontSize: 10, color: deltaColor, fontWeight: 600 }}>
        {delta == null
          ? series.length === 1
            ? "1 point — need more data"
            : "—"
          : delta === 0
          ? `± 0  ${baselineLabel}`
          : `${delta < 0 ? "↓" : "↑"} ${formatDelta(delta, marker.unit)}  ${baselineLabel}`}
      </div>
    </button>
  );
}

function formatNumber(v: number): string {
  if (Number.isInteger(v)) return String(v);
  const abs = Math.abs(v);
  if (abs >= 100) return v.toFixed(0);
  if (abs >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

// ─── Picker popover ───────────────────────────────────────────────────────────

function PickerPopover({
  options,
  selectedKeys,
  currentKey,
  onPick,
  onClose,
}: {
  options: MarkerOption[];
  selectedKeys: string[];
  currentKey: string;
  onPick: (key: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [onClose]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((o) => o.label.toLowerCase().includes(needle));
  }, [options, q]);

  const groups: Record<MarkerGroup, MarkerOption[]> = {
    "Body comp": [],
    Vitals: [],
    "Blood markers": [],
    Other: [],
  };
  for (const o of filtered) groups[o.group].push(o);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.20)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        ref={ref}
        style={{
          width: "min(440px, 100%)",
          maxHeight: "70vh",
          background: "var(--fm-surface)",
          border: "1px solid var(--fm-border)",
          borderRadius: "var(--fm-radius-lg)",
          boxShadow: "0 16px 40px rgba(0,0,0,0.18)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--fm-border-light)" }}>
          <div
            style={{
              fontSize: 9.5,
              letterSpacing: 0.7,
              textTransform: "uppercase",
              fontWeight: 700,
              color: "var(--fm-text-tertiary)",
              marginBottom: 6,
            }}
          >
            Swap marker
          </div>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search markers…"
            style={{
              width: "100%",
              padding: "7px 10px",
              fontSize: 12.5,
              border: "1px solid var(--fm-border)",
              borderRadius: "var(--fm-radius-sm)",
              fontFamily: "inherit",
              background: "var(--fm-bg-cool)",
            }}
          />
        </div>
        <div style={{ overflowY: "auto", padding: "8px 6px" }}>
          {(Object.keys(groups) as MarkerGroup[]).map((g) => {
            const items = groups[g];
            if (items.length === 0) return null;
            return (
              <div key={g} style={{ padding: "6px 8px" }}>
                <div
                  style={{
                    fontSize: 9.5,
                    letterSpacing: 0.7,
                    textTransform: "uppercase",
                    fontWeight: 700,
                    color: "var(--fm-text-tertiary)",
                    marginBottom: 4,
                  }}
                >
                  {g}
                </div>
                <div style={{ display: "grid", gap: 2 }}>
                  {items.map((o) => {
                    const isCurrent = o.key === currentKey;
                    const isInUse = selectedKeys.includes(o.key) && !isCurrent;
                    return (
                      <button
                        key={o.key}
                        type="button"
                        disabled={isInUse}
                        onClick={() => onPick(o.key)}
                        style={{
                          textAlign: "left",
                          padding: "6px 8px",
                          background: isCurrent ? "var(--fm-bg-warm)" : "transparent",
                          border: `1px solid ${isCurrent ? "var(--fm-primary)" : "transparent"}`,
                          borderRadius: "var(--fm-radius-sm)",
                          fontFamily: "inherit",
                          fontSize: 12,
                          color: isInUse ? "var(--fm-text-tertiary)" : "var(--fm-text-primary)",
                          cursor: isInUse ? "default" : "pointer",
                          opacity: isInUse ? 0.55 : 1,
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <span>
                          {o.label}
                          {o.unit && (
                            <span
                              style={{ color: "var(--fm-text-tertiary)", marginLeft: 6, fontSize: 10.5 }}
                            >
                              {o.unit}
                            </span>
                          )}
                        </span>
                        {isCurrent && (
                          <span style={{ fontSize: 10, color: "var(--fm-primary)", fontWeight: 700 }}>
                            current
                          </span>
                        )}
                        {isInUse && (
                          <span style={{ fontSize: 10, color: "var(--fm-text-tertiary)" }}>
                            already shown
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div
              style={{
                padding: 14,
                fontSize: 11.5,
                color: "var(--fm-text-tertiary)",
                textAlign: "center",
              }}
            >
              No markers match.
            </div>
          )}
        </div>
        <div style={{ padding: "8px 12px", borderTop: "1px solid var(--fm-border-light)" }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "5px 12px",
              fontSize: 11,
              fontWeight: 700,
              border: "1px solid var(--fm-border)",
              background: "var(--fm-surface)",
              borderRadius: "var(--fm-radius-pill)",
              cursor: "pointer",
              fontFamily: "inherit",
              color: "var(--fm-text-secondary)",
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export interface SessionMarkerChartsClientProps {
  clientId: string;
  /** All markers the client has any history for. */
  allMarkers: MarkerWithData[];
  /** Initial set of selected marker keys (server-resolved: saved-or-defaulted). */
  initialKeys: string[];
  refRanges: LabReferenceRanges;
  catalogue: CatalogueLabRange[];
  cap: number;
}

export function SessionMarkerChartsClient({
  clientId,
  allMarkers,
  initialKeys,
  refRanges,
  catalogue,
  cap,
}: SessionMarkerChartsClientProps) {
  const [selectedKeys, setSelectedKeys] = useState<string[]>(initialKeys);
  const [baseline, setBaseline] = useState<Baseline>("intake");
  const [pickerIdx, setPickerIdx] = useState<number | null>(null);

  const markerByKey = useMemo(() => {
    const m = new Map<string, MarkerWithData>();
    for (const o of allMarkers) m.set(o.key, o);
    return m;
  }, [allMarkers]);

  const tiles = useMemo(
    () =>
      selectedKeys
        .map((k) => markerByKey.get(k))
        .filter((m): m is MarkerWithData => Boolean(m)),
    [selectedKeys, markerByKey],
  );

  function persist(next: string[]) {
    setSelectedKeys(next);
    void saveSessionChartMarkersAction(clientId, next);
  }

  function swap(idx: number, newKey: string) {
    const next = [...selectedKeys];
    next[idx] = newKey;
    persist(next);
    setPickerIdx(null);
  }

  const pickerOptions: MarkerOption[] = allMarkers.map(({ key, label, unit, group, desired }) => ({
    key,
    label,
    unit,
    group,
    desired,
  }));

  if (allMarkers.length === 0) {
    return null;
  }

  const subtitle = `${tiles.length} markers over time · pick any tile to swap`;

  return (
    <FmPanel
      title="Tracked markers"
      subtitle={subtitle}
      rightSlot={
        <div
          role="tablist"
          aria-label="Baseline"
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: 2,
            background: "var(--fm-surface)",
            border: "1px solid var(--fm-border)",
            borderRadius: 999,
          }}
        >
          {([
            ["intake", "vs Intake"],
            ["previous", "vs Previous"],
            ["fourwk", "4-wk avg"],
          ] as Array<[Baseline, string]>).map(([id, label]) => {
            const active = baseline === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setBaseline(id)}
                style={{
                  padding: "5px 14px",
                  fontSize: 11,
                  fontWeight: 700,
                  borderRadius: 999,
                  border: "none",
                  background: active ? "var(--fm-primary)" : "transparent",
                  color: active ? "#fff" : "var(--fm-text-secondary)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      }
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
          gap: 8,
        }}
      >
        {tiles.map((m, idx) => (
          <Tile
            key={m.key + ":" + idx}
            marker={m}
            baseline={baseline}
            refRanges={refRanges}
            catalogue={catalogue}
            onClick={() => setPickerIdx(idx)}
          />
        ))}
        {tiles.length < cap && (
          <button
            type="button"
            onClick={() => {
              // Insert an empty slot — open the picker on a synthetic index.
              const next = [...selectedKeys];
              // Find first available marker not already shown.
              const fallback = allMarkers.find((m) => !selectedKeys.includes(m.key));
              if (!fallback) return;
              next.push(fallback.key);
              persist(next);
              setPickerIdx(next.length - 1);
            }}
            style={{
              padding: 10,
              background: "transparent",
              border: "1px dashed var(--fm-border)",
              borderRadius: "var(--fm-radius-md)",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 11,
              fontWeight: 600,
              color: "var(--fm-text-tertiary)",
              minHeight: 88,
            }}
          >
            + Add tile
          </button>
        )}
      </div>

      {pickerIdx != null && tiles[pickerIdx] && (
        <PickerPopover
          options={pickerOptions}
          selectedKeys={selectedKeys}
          currentKey={tiles[pickerIdx].key}
          onPick={(k) => swap(pickerIdx, k)}
          onClose={() => setPickerIdx(null)}
        />
      )}
    </FmPanel>
  );
}

// ─── Helpers exported for server wrapper ─────────────────────────────────────

export { pickDefaultMarkers };
