"use client";

/**
 * MindMapRadial — F1 (radial cluster cards) + F5 (printable 2-column outline)
 *
 * Replaces the spider-web Mermaid view as the default. Reads the existing
 * `MindMapNode[]` tree, groups the top-level branches into colored
 * cluster cards arranged around a central hub. F5 is a print-leaning
 * 2-column outline of the same data — A4-friendly, page-break-avoid
 * inside each branch.
 *
 * Design fidelity ref: `fm-app/project/fm-explorations-8.jsx` from the
 * Anthropic design handoff. Tone palette + pixel positions match.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import type { MindMapNode } from "@/lib/fmdb/loader-extras";

// Avoid useLayoutEffect-on-server warning in Next.js dev — fall back to
// useEffect when window is undefined.
const useIsoLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

/* ─────────────────────────────────────────────────────────────────────
 *  Tone palette (6 hues at matched lightness/chroma — read as one family)
 * ─────────────────────────────────────────────────────────────────────*/
type ToneKey =
  | "clinical"
  | "mech"
  | "fm"
  | "labs"
  | "rx"
  | "coach";

interface Tone {
  ink: string;
  soft: string;
  edge: string;
  dot: string;
}

const TONES: Record<ToneKey, Tone> = {
  clinical: { ink: "#C0392B", soft: "#FCEDEA", edge: "rgba(192,57,43,0.32)", dot: "#C0392B" },
  mech:     { ink: "#7556D0", soft: "#F1ECFB", edge: "rgba(117,86,208,0.32)", dot: "#7556D0" },
  fm:       { ink: "#1A7FBB", soft: "#E7F1FA", edge: "rgba(26,127,187,0.32)", dot: "#1A7FBB" },
  labs:     { ink: "#1E8449", soft: "#E6F3EC", edge: "rgba(30,132,73,0.32)", dot: "#1E8449" },
  rx:       { ink: "#B8770A", soft: "#FAF0DC", edge: "rgba(184,119,10,0.32)", dot: "#B8770A" },
  coach:    { ink: "#5A4A7B", soft: "#EDEAF3", edge: "rgba(90,74,123,0.32)", dot: "#5A4A7B" },
};

/* Per-branch icon by tone. */
const ICONS: Record<ToneKey, string> = {
  clinical: "◐",
  mech: "↟",
  fm: "✱",
  labs: "◆",
  rx: "℞",
  coach: "✿",
};

/* ─────────────────────────────────────────────────────────────────────
 *  Branch normalisation — figure out which tone each top-level branch
 *  should adopt based on the label (Hashimoto-style mindmaps don't have
 *  the same 6 branches; the heuristic falls back to position).
 * ─────────────────────────────────────────────────────────────────────*/
function classifyBranch(label: string, index: number): ToneKey {
  const lower = label.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "");
  if (lower.includes("clinical") || lower.includes("symptom") || lower.includes("presentation")) return "clinical";
  if (lower.includes("mechanism") || lower.includes("root") || lower.includes("driver") || lower.includes("pathophys")) return "mech";
  if (lower.includes("fm approach") || lower.includes("approach") || lower.includes("framework")) return "fm";
  if (lower.includes("lab") || lower.includes("test") || lower.includes("marker") || lower.includes("track")) return "labs";
  if (lower.includes("intervention") || lower.includes("supplement") || lower.includes("protocol") || lower.includes("treatment") || lower.includes("rx")) return "rx";
  if (lower.includes("coach") || lower.includes("goal") || lower.includes("practice") || lower.includes("habit") || lower.includes("lifestyle")) return "coach";
  // fallback: rotate through the 6 tones by index
  const order: ToneKey[] = ["clinical", "mech", "fm", "labs", "rx", "coach"];
  return order[index % order.length];
}

/** Strip leading emoji + spaces from a label. */
function cleanLabel(label: string): string {
  return label.replace(/^[\p{Extended_Pictographic}\p{So}\p{Sk}\s]+/u, "").trim();
}

/* Total leaf count under a branch (for the header chip). */
function leafCount(node: MindMapNode): number {
  if (!node.children || node.children.length === 0) return 1;
  // leaf = a node with linked_kind/linked_slug (or empty children & not a group)
  let total = 0;
  for (const c of node.children) {
    if (c.children && c.children.length > 0) {
      total += leafCount(c);
    } else {
      total += 1;
    }
  }
  return total;
}

/* ─────────────────────────────────────────────────────────────────────
 *  Catalogue URL segments — match existing routing.
 * ─────────────────────────────────────────────────────────────────────*/
const KIND_URL: Record<string, string> = {
  topic: "topics",
  mechanism: "mechanisms",
  symptom: "symptoms",
  supplement: "supplements",
  claim: "claims",
  cooking_adjustment: "cooking_adjustments",
  home_remedy: "home_remedies",
  lab_test: "lab_tests",
  lab_panel: "lab_panels",
};

const KIND_LABEL: Record<string, string> = {
  topic: "topic",
  mechanism: "mech",
  symptom: "sx",
  supplement: "supp",
  claim: "claim",
  cooking_adjustment: "cooking",
  home_remedy: "remedy",
  lab_test: "lab",
  lab_panel: "panel",
};

/* ─────────────────────────────────────────────────────────────────────
 *  Item chip — one leaf inside a cluster card. Clickable when linked.
 * ─────────────────────────────────────────────────────────────────────*/
function ItemChip({ node, tone }: { node: MindMapNode; tone: Tone }) {
  const linked = node.linked_kind && node.linked_slug && KIND_URL[node.linked_kind];
  const inner = (
    <span
      style={{
        fontSize: 11,
        fontWeight: 500,
        color: "var(--fm-text-primary)",
        padding: "1px 7px",
        borderRadius: 3,
        background: tone.soft,
        borderBottom: `1.5px solid ${tone.edge}`,
        lineHeight: 1.4,
        display: "inline-block",
      }}
    >
      {cleanLabel(node.label)}
    </span>
  );
  if (linked) {
    return (
      <Link
        href={`/catalogue/${KIND_URL[node.linked_kind!]}/${node.linked_slug}`}
        style={{ textDecoration: "none" }}
        title={`Open ${node.linked_kind}: ${node.linked_slug}`}
      >
        {inner}
      </Link>
    );
  }
  return inner;
}

/* ─────────────────────────────────────────────────────────────────────
 *  F1 · Radial cluster cards — 3 cards top, hub middle, 3 cards bottom
 * ─────────────────────────────────────────────────────────────────────*/
function MMRadial({
  branches,
  centerLabel,
}: {
  branches: NormalisedBranch[];
  centerLabel: string;
}) {
  // Layout: 3 cards top, central black hub, 3 cards bottom. For >6 branches we
  // wrap extras into a third row underneath. Connector lines are SVG curves
  // measured from real DOM positions (the cards stretch to fill width, so
  // we can't pixel-position them ahead of time).
  const topRow = branches.slice(0, 3);
  const botRow = branches.slice(3, 6);
  const extras = branches.slice(6);

  const containerRef = useRef<HTMLDivElement>(null);
  const hubRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const [paths, setPaths] = useState<{ d: string; color: string }[]>([]);
  const [svgBox, setSvgBox] = useState({ w: 0, h: 0 });

  const recompute = () => {
    const container = containerRef.current;
    const hub = hubRef.current;
    if (!container || !hub) return;
    const cRect = container.getBoundingClientRect();
    const hRect = hub.getBoundingClientRect();
    const hubCx = hRect.left - cRect.left + hRect.width / 2;
    const hubCy = hRect.top - cRect.top + hRect.height / 2;
    const hubR = hRect.width / 2;

    const out: { d: string; color: string }[] = [];
    for (const b of branches) {
      const card = cardRefs.current.get(b.id);
      if (!card) continue;
      const r = card.getBoundingClientRect();
      const cardCx = r.left - cRect.left + r.width / 2;
      const cardTop = r.top - cRect.top;
      const cardBot = r.bottom - cRect.top;
      // Anchor on the card edge that faces the hub.
      const cardEdgeY = cardBot < hubCy ? cardBot : cardTop;

      const dx = cardCx - hubCx;
      const dy = cardEdgeY - hubCy;
      const len = Math.hypot(dx, dy) || 1;
      const hubX = hubCx + (dx / len) * hubR;
      const hubY = hubCy + (dy / len) * hubR;
      // Cubic bezier: control points pulled vertically halfway (matches the
      // original F1 prototype's curve feel).
      const c1x = hubX;
      const c1y = (hubY + cardEdgeY) / 2;
      const c2x = cardCx;
      const c2y = (hubY + cardEdgeY) / 2;
      const d = `M${hubX.toFixed(1)},${hubY.toFixed(1)} C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${cardCx.toFixed(1)},${cardEdgeY.toFixed(1)}`;
      out.push({ d, color: TONES[b.tone].edge });
    }
    setPaths(out);
    setSvgBox({ w: cRect.width, h: cRect.height });
  };

  useIsoLayoutEffect(() => {
    recompute();
    const ro = new ResizeObserver(() => recompute());
    if (containerRef.current) ro.observe(containerRef.current);
    // Also recompute on window resize (covers font-load / scrollbar shifts).
    window.addEventListener("resize", recompute);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", recompute);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branches]);

  // Helper for card refs by id.
  const setCardRef = (id: string) => (el: HTMLDivElement | null) => {
    if (el) cardRefs.current.set(id, el);
    else cardRefs.current.delete(id);
  };

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        background: "#FAFAFA",
        border: "1px solid var(--fm-border-light)",
        borderRadius: "var(--fm-radius-md)",
        padding: 24,
        overflow: "hidden",
        minHeight: 760,
      }}
    >
      {/* SVG connectors layer — sits behind cards (zIndex 1). */}
      {svgBox.w > 0 && (
        <svg
          width={svgBox.w}
          height={svgBox.h}
          viewBox={`0 0 ${svgBox.w} ${svgBox.h}`}
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            zIndex: 1,
          }}
        >
          {paths.map((p, i) => (
            <path
              key={i}
              d={p.d}
              stroke={p.color}
              strokeWidth={1.4}
              fill="none"
              strokeLinecap="round"
            />
          ))}
        </svg>
      )}

      {/* Top row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${Math.max(1, topRow.length)}, minmax(0, 1fr))`,
          gap: 20,
          marginBottom: 36,
          position: "relative",
          zIndex: 2,
        }}
      >
        {topRow.map((b) => (
          <ClusterCard key={b.id} branch={b} cardRef={setCardRef(b.id)} />
        ))}
      </div>

      {/* Center hub */}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          marginBottom: 36,
          position: "relative",
          zIndex: 2,
        }}
      >
        <div
          ref={hubRef}
          style={{
            width: 172,
            height: 172,
            borderRadius: "50%",
            background: "#0D0D0D",
            color: "#FAFAFA",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily:
              '"Libre Baskerville", Georgia, var(--fm-font-display), serif',
            fontSize: 16,
            lineHeight: 1.25,
            letterSpacing: "-0.3px",
            textAlign: "center",
            padding: 18,
            boxSizing: "border-box",
            boxShadow:
              "0 0 0 8px #FAFAFA, 0 0 0 9px rgba(13,13,13,0.08)",
            whiteSpace: "pre-line",
          }}
        >
          {centerLabel}
        </div>
      </div>

      {/* Bottom row */}
      {botRow.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${Math.max(1, botRow.length)}, minmax(0, 1fr))`,
            gap: 20,
            position: "relative",
            zIndex: 2,
          }}
        >
          {botRow.map((b) => (
            <ClusterCard key={b.id} branch={b} cardRef={setCardRef(b.id)} />
          ))}
        </div>
      )}

      {/* Extra branches (>6) wrap into a third row */}
      {extras.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${Math.min(3, extras.length)}, minmax(0, 1fr))`,
            gap: 20,
            marginTop: 36,
            position: "relative",
            zIndex: 2,
          }}
        >
          {extras.map((b) => (
            <ClusterCard key={b.id} branch={b} cardRef={setCardRef(b.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

interface NormalisedBranch {
  id: string;
  tone: ToneKey;
  label: string;
  icon: string;
  groups: { label: string; items: MindMapNode[] }[];
  leafTotal: number;
}

function ClusterCard({
  branch,
  cardRef,
}: {
  branch: NormalisedBranch;
  cardRef?: (el: HTMLDivElement | null) => void;
}) {
  const tone = TONES[branch.tone];
  return (
    <div
      ref={cardRef}
      style={{
        background: "#fff",
        borderRadius: 8,
        border: `1px solid ${tone.edge}`,
        padding: "11px 13px",
        boxShadow:
          "0 1px 2px rgba(0,0,0,0.04), 0 8px 22px rgba(13,13,13,0.06)",
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 7,
        }}
      >
        <span
          style={{
            width: 22,
            height: 22,
            borderRadius: "50%",
            background: tone.soft,
            color: tone.ink,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {branch.icon}
        </span>
        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: 0.8,
            color: tone.ink,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {branch.label}
        </div>
        <div
          style={{
            marginLeft: "auto",
            fontSize: 11,
            color: "var(--fm-text-tertiary)",
            fontFamily: "var(--fm-font-mono, ui-monospace, monospace)",
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          {branch.leafTotal}
        </div>
      </div>
      {branch.groups.map((g, i) => (
        <div
          key={i}
          style={{
            marginBottom: i === branch.groups.length - 1 ? 0 : 6,
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: 0.6,
              color: "var(--fm-text-secondary)",
              marginBottom: 3,
            }}
          >
            {g.label}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
            {g.items.map((it, j) => (
              <ItemChip key={j} node={it} tone={tone} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 *  F2 · Column groups — newspaper layout, one column per branch.
 *  Used for the on-screen "Outline" mode (visually distinct from Print).
 * ─────────────────────────────────────────────────────────────────────*/
function MMColumns({
  branches,
  centerLabel,
  totalLeaves,
}: {
  branches: NormalisedBranch[];
  centerLabel: string;
  totalLeaves: number;
}) {
  const subgroupTotal = branches.reduce((s, b) => s + b.groups.length, 0);
  return (
    <div
      style={{
        background: "#FAFAFA",
        border: "1px solid var(--fm-border-light)",
        borderRadius: "var(--fm-radius-md)",
        overflow: "hidden",
      }}
    >
      {/* Hero strip — black bar, serif title, mono node count */}
      <div
        style={{
          padding: "22px 24px 18px",
          background: "#0D0D0D",
          color: "#FAFAFA",
          display: "flex",
          alignItems: "baseline",
          gap: 18,
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            fontFamily:
              '"Libre Baskerville", Georgia, var(--fm-font-display), serif',
            fontSize: 26,
            lineHeight: 1.1,
            letterSpacing: "-0.5px",
            fontWeight: 400,
            maxWidth: 540,
          }}
        >
          {centerLabel.replace(/\n/g, " ")}
        </div>
        <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.20)", minWidth: 60 }} />
        <div
          style={{
            fontSize: 12,
            opacity: 0.7,
            fontFamily: "var(--fm-font-mono, ui-monospace, monospace)",
            whiteSpace: "nowrap",
          }}
        >
          {branches.length} branches · {subgroupTotal} subgroups · {totalLeaves} nodes
        </div>
      </div>

      <div style={{ padding: "18px", overflowX: "auto" }}>
        <div
          style={{
            display: "grid",
            // Up to 6 columns on wide screens, wraps gracefully on narrow.
            gridTemplateColumns: `repeat(${Math.min(branches.length, 6)}, minmax(180px, 1fr))`,
            gap: 14,
            alignItems: "flex-start",
          }}
        >
          {branches.map((b) => {
            const tone = TONES[b.tone];
            return (
              <div
                key={b.id}
                style={{
                  background: "#fff",
                  border: `1px solid ${tone.edge}`,
                  borderTop: `4px solid ${tone.ink}`,
                  borderRadius: "0 0 6px 6px",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    padding: "12px 14px 10px",
                    borderBottom: "1px solid var(--fm-border-light)",
                  }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: 1,
                      color: tone.ink,
                      marginBottom: 4,
                    }}
                  >
                    {b.icon} &nbsp; Branch
                  </div>
                  <div
                    style={{
                      fontFamily:
                        '"Libre Baskerville", Georgia, var(--fm-font-display), serif',
                      fontSize: 16,
                      fontWeight: 400,
                      color: "var(--fm-text-primary)",
                      letterSpacing: "-0.2px",
                      lineHeight: 1.2,
                    }}
                  >
                    {b.label}
                  </div>
                </div>
                <div style={{ padding: "10px 14px 14px" }}>
                  {b.groups.map((g, i) => (
                    <div key={i} style={{ marginBottom: 12 }}>
                      <div
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          textTransform: "uppercase",
                          letterSpacing: 0.7,
                          color: "var(--fm-text-tertiary)",
                          marginBottom: 6,
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <span
                          style={{
                            width: 4,
                            height: 4,
                            borderRadius: "50%",
                            background: tone.ink,
                          }}
                        />
                        {g.label}
                        <span
                          style={{
                            marginLeft: "auto",
                            color: "var(--fm-text-tertiary)",
                            fontFamily:
                              "var(--fm-font-mono, ui-monospace, monospace)",
                            fontWeight: 600,
                          }}
                        >
                          {g.items.length}
                        </span>
                      </div>
                      <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                        {g.items.map((it, j) => {
                          const linked =
                            it.linked_kind &&
                            it.linked_slug &&
                            KIND_URL[it.linked_kind];
                          return (
                            <li
                              key={j}
                              style={{
                                fontSize: 12,
                                color: "var(--fm-text-primary)",
                                fontWeight: 500,
                                padding: "4px 0",
                                borderBottom:
                                  j === g.items.length - 1
                                    ? "none"
                                    : "1px dashed var(--fm-border-light)",
                                lineHeight: 1.35,
                              }}
                            >
                              {linked ? (
                                <Link
                                  href={`/catalogue/${KIND_URL[it.linked_kind!]}/${it.linked_slug}`}
                                  style={{
                                    color: "var(--fm-text-primary)",
                                    textDecoration: "none",
                                  }}
                                >
                                  {cleanLabel(it.label)}
                                </Link>
                              ) : (
                                cleanLabel(it.label)
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 *  F5 · Printable outline — 2-column typographic
 *  Hidden until "Print" mode; uses @media print to format A4.
 * ─────────────────────────────────────────────────────────────────────*/
function MMOutline({
  branches,
  centerLabel,
  description,
  totalLeaves,
}: {
  branches: NormalisedBranch[];
  centerLabel: string;
  description?: string;
  totalLeaves: number;
}) {
  // Split into two columns evenly.
  const half = Math.ceil(branches.length / 2);
  const left = branches.slice(0, half);
  const right = branches.slice(half);

  const Column = ({
    items,
    start,
  }: {
    items: NormalisedBranch[];
    start: number;
  }) => (
    <div>
      {items.map((b, bi) => {
        const tone = TONES[b.tone];
        const num = String(start + bi).padStart(2, "0");
        return (
          <section
            key={b.id}
            style={{ marginBottom: 26, breakInside: "avoid" }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 10,
                marginBottom: 10,
              }}
            >
              <span
                style={{
                  fontFamily: "var(--fm-font-mono, ui-monospace, monospace)",
                  fontSize: 11,
                  fontWeight: 700,
                  color: tone.ink,
                  width: 22,
                }}
              >
                {num}
              </span>
              <h4
                style={{
                  margin: 0,
                  fontFamily:
                    '"Libre Baskerville", Georgia, var(--fm-font-display), serif',
                  fontSize: 17,
                  fontWeight: 400,
                  color: "var(--fm-text-primary)",
                  letterSpacing: "-0.3px",
                }}
              >
                {b.label}
              </h4>
              <div
                style={{ flex: 1, height: 1, background: tone.edge }}
              />
            </div>
            <div style={{ paddingLeft: 32 }}>
              {b.groups.map((g, gi) => (
                <div key={gi} style={{ marginBottom: 12 }}>
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: 1,
                      color: tone.ink,
                      marginBottom: 4,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <span
                      style={{
                        fontFamily:
                          "var(--fm-font-mono, ui-monospace, monospace)",
                        color: "var(--fm-text-tertiary)",
                        fontWeight: 600,
                      }}
                    >
                      {num}.{gi + 1}
                    </span>
                    {g.label}
                  </div>
                  <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                    {g.items.map((it, ii) => {
                      const linked =
                        it.linked_kind &&
                        it.linked_slug &&
                        KIND_URL[it.linked_kind];
                      return (
                        <li
                          key={ii}
                          style={{
                            padding: "3px 0",
                            display: "flex",
                            alignItems: "baseline",
                            gap: 8,
                            fontSize: 13,
                            color: "var(--fm-text-primary)",
                            lineHeight: 1.45,
                          }}
                        >
                          <span
                            style={{
                              width: 4,
                              height: 4,
                              borderRadius: "50%",
                              background: tone.ink,
                              flexShrink: 0,
                              transform: "translateY(-3px)",
                            }}
                          />
                          {linked ? (
                            <Link
                              href={`/catalogue/${KIND_URL[it.linked_kind!]}/${it.linked_slug}`}
                              style={{
                                flex: 1,
                                color: "var(--fm-text-primary)",
                                textDecoration: "none",
                              }}
                            >
                              {cleanLabel(it.label)}
                            </Link>
                          ) : (
                            <span style={{ flex: 1 }}>
                              {cleanLabel(it.label)}
                            </span>
                          )}
                          {it.linked_kind && (
                            <span
                              style={{
                                fontSize: 9,
                                color: "var(--fm-text-tertiary)",
                                textTransform: "uppercase",
                                letterSpacing: 0.6,
                                fontWeight: 600,
                                fontFamily:
                                  "var(--fm-font-mono, ui-monospace, monospace)",
                              }}
                            >
                              {KIND_LABEL[it.linked_kind] ?? it.linked_kind}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );

  const todayStr = new Date().toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <div
      id="mindmap-print-root"
      style={{
        background: "var(--fm-surface)",
        padding: "24px 32px 40px",
        border: "1px solid var(--fm-border-light)",
        borderRadius: "var(--fm-radius-md)",
      }}
    >
      <header
        style={{
          marginBottom: 22,
          paddingBottom: 14,
          borderBottom: "1px solid var(--fm-text-primary)",
        }}
      >
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: 1.4,
            color: "var(--fm-text-tertiary)",
          }}
        >
          Mind map · printable
        </div>
        <div
          style={{
            fontFamily:
              '"Libre Baskerville", Georgia, var(--fm-font-display), serif',
            fontSize: 32,
            fontWeight: 400,
            letterSpacing: "-0.5px",
            lineHeight: 1.1,
            marginTop: 4,
            color: "var(--fm-text-primary)",
          }}
        >
          {centerLabel.replace(/\n/g, " ")}
        </div>
        {description && (
          <div
            style={{
              fontSize: 12,
              color: "var(--fm-text-secondary)",
              marginTop: 6,
              lineHeight: 1.45,
              maxWidth: 720,
            }}
          >
            {description}
          </div>
        )}
        <div
          style={{
            display: "flex",
            gap: 18,
            marginTop: 10,
            fontSize: 11,
            color: "var(--fm-text-secondary)",
            flexWrap: "wrap",
          }}
        >
          <span>
            <strong style={{ color: "var(--fm-text-primary)" }}>
              {branches.length}
            </strong>{" "}
            branches
          </span>
          <span>
            <strong style={{ color: "var(--fm-text-primary)" }}>
              {branches.reduce((s, b) => s + b.groups.length, 0)}
            </strong>{" "}
            subgroups
          </span>
          <span>
            <strong style={{ color: "var(--fm-text-primary)" }}>
              {totalLeaves}
            </strong>{" "}
            nodes
          </span>
          <span
            style={{
              marginLeft: "auto",
              fontFamily: "var(--fm-font-mono, ui-monospace, monospace)",
            }}
          >
            printed {todayStr} · Shivani
          </span>
        </div>
      </header>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 32,
        }}
      >
        <Column items={left} start={1} />
        <Column items={right} start={left.length + 1} />
      </div>

      {/* Print rules: isolate #mindmap-print-root */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #mindmap-print-root,
          #mindmap-print-root * { visibility: visible !important; }
          #mindmap-print-root {
            position: absolute !important;
            top: 0; left: 0; width: 100% !important;
            border: 0 !important;
            padding: 12mm 14mm !important;
          }
          @page { size: A4; margin: 12mm; }
        }
      `}</style>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 *  Normalisation: tree[] → NormalisedBranch[]
 *  Top-level child = branch
 *  Second level = group ("subgroup")
 *  Third level onwards = items (flattened if deeper than 1)
 * ─────────────────────────────────────────────────────────────────────*/
function normaliseTree(tree: MindMapNode[]): NormalisedBranch[] {
  return tree.map((branch, i) => {
    const tone = classifyBranch(branch.label, i);
    const cleanedLabel = cleanLabel(branch.label);
    const total = leafCount(branch);
    const groups: NormalisedBranch["groups"] = (branch.children ?? []).map(
      (group) => {
        // Flatten leaves at any depth under the group.
        const items: MindMapNode[] = [];
        const walk = (n: MindMapNode) => {
          if (!n.children || n.children.length === 0) {
            items.push(n);
          } else {
            for (const c of n.children) walk(c);
          }
        };
        if (group.children && group.children.length > 0) {
          for (const c of group.children) walk(c);
        } else {
          // group itself is a leaf — show the group label as a single item
          items.push(group);
        }
        return { label: cleanLabel(group.label), items };
      },
    );
    return {
      id: branch.label.replace(/\s+/g, "-").toLowerCase().slice(0, 40) || `branch-${i}`,
      tone,
      label: cleanedLabel,
      icon: ICONS[tone],
      groups,
      leafTotal: total,
    };
  });
}

/* ─────────────────────────────────────────────────────────────────────
 *  Wrapper component — switcher across the 4 modes.
 * ─────────────────────────────────────────────────────────────────────*/
type Mode = "radial" | "outline" | "mermaid" | "print";

interface Props {
  slug: string;
  tree: MindMapNode[] | undefined;
  centerLabel: string;
  description?: string;
  mermaidSlot: React.ReactNode;
}

export function MindMapRadial({
  tree,
  centerLabel,
  description,
  mermaidSlot,
}: Props) {
  const [mode, setMode] = useState<Mode>("radial");

  if (!tree || tree.length === 0) {
    return (
      <p style={{ fontSize: 12, color: "var(--fm-text-tertiary)", fontStyle: "italic" }}>
        No nodes.
      </p>
    );
  }

  const branches = normaliseTree(tree);
  const totalLeaves = branches.reduce((s, b) => s + b.leafTotal, 0);

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {/* Mode pill — small toggle bar */}
      <div
        style={{
          display: "inline-flex",
          border: "1px solid var(--fm-border)",
          borderRadius: 999,
          padding: 2,
          background: "var(--fm-surface)",
          gap: 0,
          width: "fit-content",
        }}
      >
        {(
          [
            { id: "radial", label: "🌸 Radial" },
            { id: "outline", label: "📑 Outline" },
            { id: "mermaid", label: "🌐 Mermaid" },
            { id: "print", label: "📄 Print" },
          ] as { id: Mode; label: string }[]
        ).map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => setMode(o.id)}
            style={{
              padding: "5px 12px",
              border: "none",
              borderRadius: 999,
              background: mode === o.id ? "var(--fm-text-primary)" : "transparent",
              color: mode === o.id ? "#fff" : "var(--fm-text-secondary)",
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
              letterSpacing: 0.2,
              fontFamily: "inherit",
            }}
          >
            {o.label}
          </button>
        ))}
        {mode === "print" && (
          <button
            type="button"
            onClick={() => window.print()}
            style={{
              marginLeft: 8,
              padding: "5px 12px",
              border: "1px solid var(--fm-primary)",
              borderRadius: 999,
              background: "var(--fm-primary)",
              color: "#fff",
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
              letterSpacing: 0.2,
              fontFamily: "inherit",
            }}
            title="Print / Save as PDF"
          >
            🖨 Print
          </button>
        )}
      </div>

      {mode === "radial" && (
        <MMRadial branches={branches} centerLabel={centerLabel} />
      )}
      {mode === "outline" && (
        <MMColumns
          branches={branches}
          centerLabel={centerLabel}
          totalLeaves={totalLeaves}
        />
      )}
      {mode === "print" && (
        <MMOutline
          branches={branches}
          centerLabel={centerLabel}
          description={description}
          totalLeaves={totalLeaves}
        />
      )}
      {mode === "mermaid" && mermaidSlot}
    </div>
  );
}
