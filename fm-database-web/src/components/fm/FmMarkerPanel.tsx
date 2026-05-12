"use client";

/**
 * FmMarkerPanel — the FM markers + ratios panel (design 2).
 *
 * Layout:
 *   - Title row + segmented toggle: "By group" | "Flagged only"
 *   - Search input that filters across all markers in the snapshot
 *   - By group mode: collapsible groups; force-open on any not-OK marker
 *     (high/low/watch), auto-close on all-OK groups
 *   - Flagged-only mode: flat grid of non-OK markers with group label
 *     travelling with each tile
 *
 * Per confirmation A, "any not-OK forces the group open" — watch counts too.
 */
import { useState, useMemo } from "react";
import { FmPanel } from "./FmPanel";
import { FmChip } from "./FmChip";

export type MarkerFlag = "ok" | "watch" | "low" | "high";

export interface FmMarker {
  name: string;
  value: string | number;
  unit?: string;
  /** Reference range string, e.g. "<5.7" or "0.5–2.0 optimal". */
  range?: string;
  flag: MarkerFlag;
  /** Optional inline note (e.g. for computed ratios). */
  meta?: string;
  /** Marks ratios / computed values for the "ratio" tag. */
  computed?: boolean;
}

export interface FmMarkerGroup {
  title: string;
  icon: string;
  markers: FmMarker[];
}

export interface FmMarkerPanelProps {
  groups: FmMarkerGroup[];
  /** Optional subtitle, e.g. "Lab values from May 9, 2026". */
  subtitle?: React.ReactNode;
}

function groupHasNotOk(g: FmMarkerGroup): boolean {
  return g.markers.some((m) => m.flag !== "ok");
}

function flagCounts(markers: FmMarker[]) {
  return markers.reduce(
    (a, m) => {
      a[m.flag] = (a[m.flag] || 0) + 1;
      return a;
    },
    { ok: 0, watch: 0, low: 0, high: 0 } as Record<MarkerFlag, number>,
  );
}

const FLAG_COLOR: Record<MarkerFlag, string> = {
  ok: "var(--fm-success)",
  watch: "var(--fm-warning)",
  low: "var(--fm-secondary)",
  high: "var(--fm-danger)",
};

export function FmMarkerPanel({ groups, subtitle }: FmMarkerPanelProps) {
  const [mode, setMode] = useState<"by-group" | "flagged">("by-group");
  const [q, setQ] = useState("");

  // Initial collapsed state — all-OK groups closed by default per design.
  const initialCollapsed = useMemo(() => {
    const m: Record<number, boolean> = {};
    groups.forEach((g, i) => {
      if (!groupHasNotOk(g)) m[i] = true;
    });
    return m;
  }, [groups]);

  const [collapsed, setCollapsed] = useState<Record<number, boolean>>(initialCollapsed);
  const toggle = (i: number) => setCollapsed((s) => ({ ...s, [i]: !s[i] }));
  const expandAll = () => setCollapsed({});
  const collapseAll = () => {
    const all: Record<number, boolean> = {};
    groups.forEach((_, i) => {
      all[i] = true;
    });
    setCollapsed(all);
  };

  const totalMarkers = groups.reduce((n, g) => n + g.markers.length, 0);
  const flagged = groups.flatMap((g) =>
    g.markers
      .filter((m) => m.flag !== "ok")
      .map((m) => ({ ...m, group: g.title, icon: g.icon })),
  );

  // Filter by search across the flat list (regardless of mode).
  const filteredFlagged = useMemo(() => {
    if (!q.trim()) return flagged;
    const needle = q.trim().toLowerCase();
    return flagged.filter((m) => m.name.toLowerCase().includes(needle));
  }, [flagged, q]);

  return (
    <FmPanel
      title={`Functional medicine markers · ${totalMarkers} values, ${groups.length} groups`}
      subtitle={
        subtitle ?? (
          <>
            Computed ratios highlighted with a <strong>ratio</strong> tag. Force-open on any
            not-OK marker, auto-close on all-green groups.
          </>
        )
      }
      rightSlot={
        <div
          style={{
            display: "inline-flex",
            border: "1px solid var(--fm-border)",
            borderRadius: "var(--fm-radius-pill)",
            padding: 2,
            background: "var(--fm-surface)",
          }}
        >
          {[
            { id: "by-group", l: `By group · ${totalMarkers}` },
            { id: "flagged", l: `Flagged only · ${flagged.length}` },
          ].map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => setMode(o.id as typeof mode)}
              style={{
                padding: "4px 12px",
                fontSize: 11,
                fontWeight: 700,
                border: 0,
                borderRadius: "var(--fm-radius-pill)",
                cursor: "pointer",
                background: mode === o.id ? "var(--fm-primary)" : "transparent",
                color:
                  mode === o.id ? "#fff" : "var(--fm-text-secondary)",
                fontFamily: "inherit",
              }}
            >
              {o.l}
            </button>
          ))}
        </div>
      }
    >
      {/* Search bar + Expand/Collapse-all action buttons */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 12,
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            flex: 1,
            minWidth: 220,
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "var(--fm-surface)",
            border: "1px solid var(--fm-border)",
            borderRadius: "var(--fm-radius-sm)",
            padding: "5px 10px",
          }}
        >
          <span style={{ color: "var(--fm-text-tertiary)", fontSize: 12 }}>🔍</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search across all ${totalMarkers} markers…`}
            style={{
              flex: 1,
              border: 0,
              outline: "none",
              background: "transparent",
              fontSize: 12,
              fontFamily: "inherit",
            }}
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ("")}
              style={{
                border: 0,
                background: "transparent",
                color: "var(--fm-text-tertiary)",
                fontSize: 14,
                cursor: "pointer",
              }}
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </div>
        {mode === "by-group" && (
          <>
            <button
              type="button"
              onClick={expandAll}
              style={{
                padding: "5px 10px",
                fontSize: 10.5,
                fontWeight: 600,
                border: "1px solid var(--fm-border)",
                borderRadius: "var(--fm-radius-sm)",
                background: "var(--fm-surface)",
                color: "var(--fm-text-secondary)",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Expand all
            </button>
            <button
              type="button"
              onClick={collapseAll}
              style={{
                padding: "5px 10px",
                fontSize: 10.5,
                fontWeight: 600,
                border: "1px solid var(--fm-border)",
                borderRadius: "var(--fm-radius-sm)",
                background: "var(--fm-surface)",
                color: "var(--fm-text-secondary)",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Collapse all
            </button>
          </>
        )}
      </div>

      {mode === "by-group" ? (
        <ByGroup
          groups={groups}
          collapsed={collapsed}
          toggle={toggle}
          searchFilter={q}
        />
      ) : (
        <FlaggedFlat markers={filteredFlagged} />
      )}
    </FmPanel>
  );
}

function ByGroup({
  groups,
  collapsed,
  toggle,
  searchFilter,
}: {
  groups: FmMarkerGroup[];
  collapsed: Record<number, boolean>;
  toggle: (i: number) => void;
  searchFilter: string;
}) {
  const needle = searchFilter.trim().toLowerCase();
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {groups.map((g, gi) => {
        const matched = needle
          ? g.markers.filter((m) => m.name.toLowerCase().includes(needle))
          : g.markers;
        if (needle && matched.length === 0) return null;
        const counts = flagCounts(g.markers);
        const flagged = counts.high + counts.low + counts.watch;
        const allOk = flagged === 0;
        const isForceOpen = !allOk && !searchFilter;
        const isCollapsed = !needle && collapsed[gi] && !isForceOpen;

        return (
          <div
            key={gi}
            style={{
              border: "1px solid var(--fm-border-light)",
              borderRadius: "var(--fm-radius-md)",
              background: isCollapsed ? "var(--fm-bg-cool)" : "var(--fm-surface)",
              overflow: "hidden",
            }}
          >
            <button
              type="button"
              onClick={() => {
                // Force-open groups can't be collapsed — clicking is a
                // no-op (with a `disabled` cursor as the visual cue).
                if (isForceOpen) return;
                toggle(gi);
              }}
              aria-disabled={isForceOpen}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                width: "100%",
                padding: "10px 14px",
                background: "transparent",
                border: 0,
                cursor: isForceOpen ? "default" : "pointer",
                fontFamily: "inherit",
                textAlign: "left",
              }}
            >
              <span style={{ fontSize: 14 }}>{g.icon}</span>
              <span
                style={{
                  fontSize: 11.5,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: 0.7,
                  color: "var(--fm-text-primary)",
                }}
              >
                {g.title}
              </span>
              <span
                style={{
                  fontSize: 10,
                  color: "var(--fm-text-tertiary)",
                  fontWeight: 600,
                  marginLeft: 4,
                }}
              >
                {g.markers.length}
              </span>
              <span
                style={{
                  marginLeft: "auto",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  fontSize: 10,
                  fontWeight: 600,
                  color: "var(--fm-text-secondary)",
                }}
              >
                {flagged > 0 ? (
                  <>
                    {counts.high > 0 && (
                      <span
                        title={`${counts.high} high`}
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: "50%",
                          background: FLAG_COLOR.high,
                        }}
                      />
                    )}
                    {counts.low > 0 && (
                      <span
                        title={`${counts.low} low`}
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: "50%",
                          background: FLAG_COLOR.low,
                        }}
                      />
                    )}
                    {counts.watch > 0 && (
                      <span
                        title={`${counts.watch} watch`}
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: "50%",
                          background: FLAG_COLOR.watch,
                        }}
                      />
                    )}
                    <span style={{ color: "var(--fm-text-tertiary)" }}>
                      {flagged} flagged
                    </span>
                    {isForceOpen && (
                      <span
                        title="Cannot collapse — group has flagged markers"
                        style={{
                          fontSize: 9,
                          fontWeight: 700,
                          color: "var(--fm-danger)",
                          background: "rgba(231, 76, 60, 0.10)",
                          padding: "1px 6px",
                          borderRadius: "var(--fm-radius-pill)",
                          textTransform: "uppercase",
                          letterSpacing: 0.4,
                          marginLeft: 4,
                        }}
                      >
                        forced open
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        background: FLAG_COLOR.ok,
                      }}
                    />
                    <span style={{ color: "var(--fm-text-tertiary)" }}>
                      all in range
                    </span>
                  </>
                )}
              </span>
              <span
                style={{
                  fontSize: 11,
                  color: isForceOpen
                    ? "transparent"
                    : "var(--fm-text-tertiary)",
                  transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)",
                  transition: "transform 160ms var(--fm-ease-out)",
                  display: "inline-block",
                  width: 12,
                }}
              >
                ▾
              </span>
            </button>

            {!isCollapsed && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
                  gap: 8,
                  padding: "4px 14px 14px",
                }}
              >
                {matched.map((m, mi) => (
                  <MarkerTile key={mi} m={m} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function FlaggedFlat({
  markers,
}: {
  markers: (FmMarker & { group: string; icon: string })[];
}) {
  if (markers.length === 0) {
    return (
      <div
        style={{
          padding: "20px 16px",
          textAlign: "center",
          background: "rgba(46, 204, 113, 0.04)",
          border: "1px dashed rgba(46, 204, 113, 0.30)",
          borderRadius: "var(--fm-radius-sm)",
          fontSize: 12.5,
          color: "var(--fm-success)",
          fontWeight: 600,
        }}
      >
        ✓ All markers in range right now
      </div>
    );
  }
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
        gap: 8,
      }}
    >
      {markers.map((m, i) => (
        <MarkerTile
          key={i}
          m={m}
          eyebrow={
            <span style={{ fontSize: 9, color: "var(--fm-text-tertiary)" }}>
              {m.icon} {m.group}
            </span>
          }
        />
      ))}
    </div>
  );
}

function MarkerTile({ m, eyebrow }: { m: FmMarker; eyebrow?: React.ReactNode }) {
  return (
    <div
      style={{
        padding: "9px 11px",
        borderRadius: "var(--fm-radius-sm)",
        background: "var(--fm-surface)",
        border: "1px solid var(--fm-border-light)",
        borderLeft: `3px solid ${FLAG_COLOR[m.flag]}`,
        position: "relative",
      }}
    >
      {m.computed && (
        <span
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            fontSize: 8,
            padding: "1px 5px",
            background: "rgba(255, 107, 53, 0.10)",
            color: "var(--fm-primary)",
            borderRadius: 3,
            fontWeight: 700,
            letterSpacing: 0.4,
            textTransform: "uppercase",
          }}
        >
          ratio
        </span>
      )}
      {eyebrow && (
        <div
          style={{
            fontSize: 9,
            textTransform: "uppercase",
            letterSpacing: 0.6,
            color: "var(--fm-text-tertiary)",
            fontWeight: 700,
            marginBottom: 2,
          }}
        >
          {eyebrow}
        </div>
      )}
      <div
        style={{
          fontSize: 9.5,
          color: "var(--fm-text-secondary)",
          textTransform: "uppercase",
          letterSpacing: 0.5,
          fontWeight: 600,
        }}
      >
        {m.name}
      </div>
      <div
        style={{
          fontSize: 17,
          fontWeight: 700,
          color: "var(--fm-text-primary)",
          marginTop: 2,
          lineHeight: 1.05,
          display: "flex",
          alignItems: "baseline",
          gap: 3,
        }}
      >
        {m.value}
        {m.unit && (
          <span
            style={{
              fontSize: 10,
              color: "var(--fm-text-tertiary)",
              fontWeight: 500,
            }}
          >
            {m.unit}
          </span>
        )}
      </div>
      {m.range && (
        <div
          style={{
            fontSize: 9.5,
            color: "var(--fm-text-tertiary)",
            marginTop: 3,
            fontFamily: "var(--fm-font-mono)",
          }}
        >
          {m.range}
        </div>
      )}
      {m.meta && (
        <div
          style={{
            fontSize: 9.5,
            color: "var(--fm-text-secondary)",
            marginTop: 3,
            fontStyle: "italic",
          }}
        >
          {m.meta}
        </div>
      )}
      <div style={{ marginTop: 5 }}>
        <FmChip
          tone={
            m.flag === "high"
              ? "danger"
              : m.flag === "low"
                ? "secondary"
                : m.flag === "watch"
                  ? "warning"
                  : "success"
          }
        >
          {m.flag === "ok" ? "in range" : m.flag}
        </FmChip>
      </div>
    </div>
  );
}
