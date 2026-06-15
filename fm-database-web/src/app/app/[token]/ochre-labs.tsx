"use client";

/**
 * Labs tab — the client-facing Lab Vault (Phase 2 of LAB_VAULT_SPEC).
 *
 * Read-only. Each marker is shown against the standard "normal" band AND the
 * tighter functional-optimal band, with the client's value pinned on top and a
 * trend sparkline. Plan-targeted markers are pinned to a "What we're working on"
 * section at the top.
 *
 * Scope-safe by construction: shows values, the two range bands, a status pill
 * ("In optimal range" / "Worth exploring"), and a computed trend caption —
 * NEVER clinical interpretation prose or a diagnosis. Status is amber-not-red.
 */

import { useState, type ReactNode } from "react";
import { useOchre, Icon } from "./ochre-context";
import { clientStatusLabel, vaultSummaryLine, exploreNoun, type LabMarker, type LabVaultMode } from "@/lib/fmdb/lab-vault";

const SAGE = "var(--forest, #4a6152)";
const SAND = "var(--paper-2, #f4efe6)";
const INK = "var(--ink, #262219)";
const MUTED = "var(--muted, #6f6a5d)";

function statusPill(status: LabMarker["status"], mode: LabVaultMode): { label: string; bg: string; fg: string } {
  if (status === "optimal")
    return { label: clientStatusLabel(status, mode), bg: "rgba(74,97,82,0.12)", fg: "var(--forest-deep, #3a4d41)" };
  if (status === "explore")
    return { label: clientStatusLabel(status, mode), bg: "var(--ochre-tint, rgba(169,101,31,0.10))", fg: "var(--ochre-deep, #8c5318)" };
  return { label: "On file", bg: "rgba(111,106,93,0.10)", fg: MUTED };
}

/** Two-band range bar with the client's value pinned. */
function RangeBar({ m }: { m: LabMarker }) {
  const lows = [m.conventional?.low, m.fmOptimal?.low, m.latestValue].filter((v): v is number => v != null);
  const highs = [m.conventional?.high, m.fmOptimal?.high, m.latestValue].filter((v): v is number => v != null);
  if (!lows.length || !highs.length) return null;
  let lo = Math.min(...lows);
  let hi = Math.max(...highs);
  const span0 = hi - lo || Math.abs(hi) || 1;
  lo -= span0 * 0.12;
  hi += span0 * 0.12;
  const span = hi - lo || 1;
  const pct = (v: number) => Math.max(0, Math.min(100, ((v - lo) / span) * 100));
  const band = (low?: number, high?: number) => {
    const l = low != null ? pct(low) : 0;
    const r = high != null ? pct(high) : 100;
    return { left: `${Math.min(l, r)}%`, width: `${Math.abs(r - l)}%` };
  };
  const conv = m.conventional ? band(m.conventional.low, m.conventional.high) : null;
  const opt = m.fmOptimal ? band(m.fmOptimal.low, m.fmOptimal.high) : null;
  return (
    <div style={{ position: "relative", margin: "12px 0 8px" }}>
      <div style={{ position: "relative", height: 12, borderRadius: 6, background: "rgba(38,34,25,0.06)", overflow: "hidden" }}>
        {conv && <div style={{ position: "absolute", top: 0, bottom: 0, left: conv.left, width: conv.width, background: "rgba(38,34,25,0.14)" }} />}
        {opt && <div style={{ position: "absolute", top: 0, bottom: 0, left: opt.left, width: opt.width, background: "rgba(74,97,82,0.34)" }} />}
      </div>
      <div
        style={{
          position: "absolute",
          top: 6,
          left: `${pct(m.latestValue)}%`,
          transform: "translate(-50%,-50%)",
          width: 14,
          height: 14,
          borderRadius: "50%",
          background: "var(--paper, #faf9f7)",
          border: `2px solid ${INK}`,
        }}
      />
    </div>
  );
}

function Sparkline({ pts }: { pts: { date: string; value: number }[] }) {
  if (pts.length < 2) return null;
  const vals = pts.map((p) => p.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const W = 60;
  const H = 20;
  const pad = 2;
  const coords = vals.map((v, i) => [pad + (i / (vals.length - 1)) * (W - pad * 2), pad + ((max - v) / range) * (H - pad * 2)] as [number, number]);
  const d = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const last = coords[coords.length - 1];
  return (
    <svg width={W} height={H} aria-hidden style={{ overflow: "visible", flexShrink: 0 }}>
      <path d={d} fill="none" stroke={SAGE} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r={2.4} fill={SAGE} />
    </svg>
  );
}

function trendCaption(m: LabMarker): string | null {
  if (!m.hasTrend || m.delta == null) return null;
  const first = m.trend[0];
  if (m.delta === 0) return `Steady since ${first.date.slice(0, 7)}`;
  return `${m.delta > 0 ? "Up" : "Down"} from ${first.value}${m.unit ? ` ${m.unit}` : ""}`;
}

function MarkerCard({ m, mode }: { m: LabMarker; mode: LabVaultMode }) {
  const pill = statusPill(m.status, mode);
  const cap = trendCaption(m);
  const hasBands = !!(m.conventional || m.fmOptimal) && !m.unitMismatch;
  return (
    <div style={{ background: "var(--paper, #faf9f7)", border: "1px solid rgba(38,34,25,0.08)", borderRadius: 14, padding: 14, marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: INK }}>{m.displayName}</div>
          <div style={{ fontSize: 11.5, color: MUTED, marginTop: 2 }}>
            {m.system} · {m.latestDate}
          </div>
        </div>
        <span style={{ fontSize: 11, padding: "3px 9px", borderRadius: 999, background: pill.bg, color: pill.fg, whiteSpace: "nowrap" }}>{pill.label}</span>
      </div>
      <div style={{ fontSize: 22, fontWeight: 600, color: INK, marginTop: 8 }}>
        {m.latestValue}
        {m.unit && <span style={{ fontSize: 12.5, color: MUTED, fontWeight: 400, marginLeft: 6 }}>{m.unit}</span>}
      </div>
      {hasBands && <RangeBar m={m} />}
      {hasBands && (
        <div style={{ fontSize: 11.5, color: MUTED }}>
          You {m.latestValue}
          {m.conventional && (
            <>
              {" "}· standard {m.conventional.low ?? "—"}–{m.conventional.high ?? "—"}
            </>
          )}
          {m.fmOptimal && (
            <>
              {" "}· optimal {m.fmOptimal.low ?? "—"}–{m.fmOptimal.high ?? "—"}
            </>
          )}
        </div>
      )}
      {m.unitMismatch && (
        <div style={{ fontSize: 11.5, color: MUTED, marginTop: 6 }}>Units differ from our reference — Shivani will confirm.</div>
      )}
      {cap && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(38,34,25,0.07)" }}>
          <Sparkline pts={m.trend} />
          <span style={{ fontSize: 11.5, color: MUTED }}>{cap}</span>
        </div>
      )}
    </div>
  );
}

function ScreenHead({ sub }: { sub?: string }) {
  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 600, color: INK, margin: 0 }}>Your labs</h1>
      {sub && (
        <div className="muted" style={{ fontSize: 13.5, marginTop: 2 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function CollapsibleSection({
  title,
  count,
  exploreN,
  noun,
  defaultOpen,
  children,
}: {
  title: string;
  count?: number;
  exploreN?: number;
  noun: string;
  defaultOpen: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginTop: 16 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          background: "none",
          border: "none",
          padding: "6px 0",
          cursor: "pointer",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name="chev" size={15} style={{ color: MUTED, transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }} />
          <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: 0.4, textTransform: "uppercase", color: SAGE }}>{title}</span>
        </span>
        <span style={{ fontSize: 11.5, color: exploreN ? "var(--ochre-deep, #8c5318)" : MUTED }}>
          {exploreN ? `${exploreN} ${noun}` : count != null ? `${count}` : ""}
        </span>
      </button>
      {open && <div style={{ marginTop: 4 }}>{children}</div>}
    </div>
  );
}

export function LabsScreen() {
  const { labVault, coach } = useOchre();
  const firstName = coach.name.split(" ")[0];

  if (!labVault || labVault.summary.total === 0) {
    return (
      <div className="screen-anim" style={{ padding: "18px 16px 90px" }}>
        <ScreenHead />
        <div className="card" style={{ padding: 20, textAlign: "center", marginTop: 14 }}>
          <Icon name="droplet" size={22} style={{ color: SAGE }} />
          <h3 style={{ margin: "8px 0 4px", fontSize: 16, color: INK }}>No labs on file yet</h3>
          <p style={{ fontSize: 13, color: MUTED, lineHeight: 1.6, margin: 0 }}>
            When you share your blood work with {firstName}, your results appear here — each one against its functional-optimal range.
          </p>
        </div>
      </div>
    );
  }

  const { groups, pinned, summary, mode } = labVault;
  const noun = exploreNoun(mode);
  const allOptimal = summary.explore === 0 && summary.optimal > 0;
  const pinnedKeys = new Set(pinned.map((m) => m.key));
  const restGroups = groups
    .map((g) => ({ ...g, markers: g.markers.filter((m) => !pinnedKeys.has(m.key)) }))
    .filter((g) => g.markers.length > 0);

  return (
    <div className="screen-anim" style={{ padding: "18px 16px 90px" }}>
      <ScreenHead sub={vaultSummaryLine(summary, mode)} />

      <div style={{ background: SAND, borderRadius: 14, padding: "12px 14px", marginTop: 12 }}>
        <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55, color: INK }}>
          Your results against two yardsticks — the standard lab “normal” range, and the tighter functional-optimal range we work toward. For our conversation, not a diagnosis.
        </p>
        <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 11.5, color: MUTED }}>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 14, height: 9, borderRadius: 2, background: "rgba(74,97,82,0.45)" }} />
            Functional optimal
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 14, height: 9, borderRadius: 2, background: "rgba(38,34,25,0.18)" }} />
            Standard normal
          </span>
        </div>
      </div>

      {allOptimal && (
        <div style={{ background: "rgba(74,97,82,0.10)", borderRadius: 14, padding: "12px 14px", marginTop: 12, fontSize: 13, color: "var(--forest-deep, #3a4d41)" }}>
          Everything on file is sitting in its optimal range. Lovely work.
        </div>
      )}

      {pinned.length > 0 && (
        <CollapsibleSection
          title="What we’re working on"
          count={pinned.length}
          noun={noun}
          defaultOpen
        >
          {pinned.map((m) => (
            <MarkerCard key={`pin-${m.key}`} m={m} mode={mode} />
          ))}
        </CollapsibleSection>
      )}

      {restGroups.map((g) => {
        const exploreN = g.markers.filter((m) => m.status === "explore").length;
        return (
          <CollapsibleSection key={g.system} title={g.system} count={g.markers.length} exploreN={exploreN} noun={noun} defaultOpen={exploreN > 0}>
            {g.markers.map((m) => (
              <MarkerCard key={`${g.system}-${m.key}`} m={m} mode={mode} />
            ))}
          </CollapsibleSection>
        );
      })}
    </div>
  );
}
