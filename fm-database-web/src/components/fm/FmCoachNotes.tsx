"use client";

/**
 * FmCoachNotes — read-only renderer for the Plan tab's "Notes for coach"
 * blob. Replaces the old <div style={{ whiteSpace: 'pre-wrap' }}> inline
 * block which made a 600–2,000-word AI synthesis dump unscannable.
 *
 * Implements Group E1 (RECOMMENDED) + E3 (collapse) + E4 (print) from the
 * "FM Backlog Explorations" design file:
 *   - Regex-based section parsing — pulls headers the AI already emits
 *     ("Synthesis:", "Key drivers:", "Supplement rationale:", "Lifestyle
 *     priorities:", "Watch for:", "Follow-up timing:", "Do not:",
 *     "AI sanity-check concerns:") into typographic sections with index +
 *     icon + tone (warn/danger/meta).
 *   - Hazard lines (containing 🚨 / ⚠️ / "URGENT" / "watch for" / "do not")
 *     render as pull-quote callouts with a coloured left bar so they pop
 *     during a 30-second pre-consult scan.
 *   - Lists detected (lines starting "- ", "* ", "•", "1. ") render as
 *     <ul>/<ol> with hazard items still as callouts inline.
 *   - Catalogue chips: known supplement / mechanism / condition / marker /
 *     practice terms become subtle inline chips linking to
 *     /catalogue/<kind>/<slug>. Body text stays slate; chips are the only
 *     inline accent.
 *   - Show-less / show-more: blobs > 480 words collapse at the next
 *     section boundary past 400 words. Open/closed state persists per
 *     planSlug in localStorage so coach doesn't see the same accordion
 *     animation every page load.
 *   - Print friendly: @media print drops chip styling for plain inline
 *     text + renders section dividers as horizontal rules. No "show more"
 *     button on paper.
 *
 * Engine-agnostic — same notes_for_coach string the AI already writes; no
 * schema migration. If the AI drops or adds new section headers, the
 * regex parser falls back to "preamble" tone and renders verbatim.
 */
import { useEffect, useMemo, useState, type CSSProperties } from "react";

export interface FmCoachNotesProps {
  /** The raw notes_for_coach string from the plan. */
  text: string;
  /** Plan slug — used to persist show-more state in localStorage. */
  planSlug: string;
  /**
   * Override the catalogue-chip dictionary. Each entry takes a regex
   * matcher + the kind/slug it resolves to. If omitted, a sensible
   * default of common FM terms is used.
   */
  catalogue?: CatalogueChip[];
  /** Word count above which the show-less/more collapse kicks in. */
  collapseThresholdWords?: number;
}

export interface CatalogueChip {
  /** Case-insensitive regex with the `g` flag — used to find inline mentions. */
  term: RegExp;
  /** Kind segment in the catalogue URL: /catalogue/{kind}/{slug}. */
  kind: "supplement" | "mechanism" | "condition" | "marker" | "practice" | "topic";
  /** Slug segment in the catalogue URL. */
  slug: string;
}

// ───────────────────────────────────────────────────────────────────
// Section pattern dictionary — pulled from the AI's typical emit shape.
// Order matters: first match wins on a given paragraph.
// ───────────────────────────────────────────────────────────────────

type SectionTone = "neutral" | "warn" | "danger" | "meta";

interface SectionPattern {
  id: string;
  match: RegExp;
  icon: string;
  label: string;
  tone?: SectionTone;
}

const SECTION_PATTERNS: SectionPattern[] = [
  { id: "synthesis", match: /^synthesis:/i, icon: "◐", label: "Synthesis" },
  { id: "drivers", match: /^key drivers?:/i, icon: "↟", label: "Key drivers" },
  {
    id: "supps",
    match: /^supplement rationale:/i,
    icon: "℞",
    label: "Supplement rationale",
  },
  {
    id: "lifestyle",
    match: /^lifestyle priorities:/i,
    icon: "✱",
    label: "Lifestyle priorities",
  },
  {
    id: "watch",
    match: /^watch for:/i,
    icon: "⚠",
    label: "Watch for",
    tone: "warn",
  },
  {
    id: "followup",
    match: /^follow-?up timing:/i,
    icon: "↻",
    label: "Follow-up timing",
  },
  { id: "donot", match: /^do not:/i, icon: "⊘", label: "Do not", tone: "danger" },
  {
    id: "aicheck",
    match: /^ai sanity-?check concerns?:/i,
    icon: "◈",
    label: "AI sanity-check concerns",
    tone: "meta",
  },
  {
    id: "outcomes",
    match: /^expected outcomes?:/i,
    icon: "✓",
    label: "Expected outcomes",
  },
  {
    id: "rationale",
    match: /^(?:rationale|reasoning):/i,
    icon: "ϕ",
    label: "Rationale",
  },
];

interface ParsedSection {
  id: string;
  label: string;
  icon: string;
  tone: SectionTone;
  body: string[]; // paragraphs (each may be a list or hazard line)
}

function parseNotes(text: string): ParsedSection[] {
  const paras = text
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const sections: ParsedSection[] = [];
  let current: ParsedSection = {
    id: "preamble",
    label: "Preamble",
    icon: "◇",
    tone: "neutral",
    body: [],
  };
  for (const p of paras) {
    const hit = SECTION_PATTERNS.find((sp) => sp.match.test(p));
    if (hit) {
      if (current.body.length) sections.push(current);
      const stripped = p.replace(/^[^:]+:\s*/, "");
      current = {
        id: hit.id,
        label: hit.label,
        icon: hit.icon,
        tone: hit.tone ?? "neutral",
        body: stripped ? [stripped] : [],
      };
    } else {
      current.body.push(p);
    }
  }
  if (current.body.length) sections.push(current);
  // Drop empty preamble (common when text starts with "Synthesis:")
  return sections.filter(
    (s) => s.id !== "preamble" || s.body.some((b) => b.length > 0),
  );
}

// ───────────────────────────────────────────────────────────────────
// Default catalogue chip dictionary — covers the common FM terms the AI
// writes about. Coach can extend by passing `catalogue` prop. Note: the
// /catalogue URL maps to existing routes; clicks navigate via <a>.
// ───────────────────────────────────────────────────────────────────

const DEFAULT_CATALOGUE: CatalogueChip[] = [
  { term: /\bashwagandha\b/gi, kind: "supplement", slug: "ashwagandha" },
  { term: /\brhodiola\b/gi, kind: "supplement", slug: "rhodiola" },
  {
    term: /\bmagnesium glycinate\b/gi,
    kind: "supplement",
    slug: "magnesium-glycinate",
  },
  { term: /\bselenium\b/gi, kind: "supplement", slug: "selenium" },
  {
    term: /\bmethyl b-?complex\b/gi,
    kind: "supplement",
    slug: "methyl-b-complex",
  },
  { term: /\bvitamin d3?\b/gi, kind: "supplement", slug: "vitamin-d3" },
  { term: /\bberberine\b/gi, kind: "supplement", slug: "berberine" },
  { term: /\bNAC\b/g, kind: "supplement", slug: "nac" },
  { term: /\binositol\b/gi, kind: "supplement", slug: "inositol" },
  {
    term: /\bHPA[ -]axis(?:[ -]dysregulation)?\b/gi,
    kind: "mechanism",
    slug: "hpa-axis-dysregulation",
  },
  {
    term: /\bMTHFR(?: C677T)?(?: het(?:erozygous)?)?\b/g,
    kind: "mechanism",
    slug: "mthfr-c677t",
  },
  { term: /\binsulin resistance\b/gi, kind: "mechanism", slug: "insulin-resistance" },
  { term: /\bleaky gut\b/gi, kind: "mechanism", slug: "leaky-gut" },
  { term: /\bhashimoto'?s?\b/gi, kind: "condition", slug: "hashimotos" },
  { term: /\bPCOS\b/g, kind: "condition", slug: "pcos" },
  {
    term: /\bperimenopause\b/gi,
    kind: "condition",
    slug: "perimenopause",
  },
  {
    term: /\bTPO(?: antibod(?:y|ies))?\b/g,
    kind: "marker",
    slug: "tpo-antibodies",
  },
  { term: /\brT3\b/g, kind: "marker", slug: "reverse-t3" },
  { term: /\bfT3\b/g, kind: "marker", slug: "free-t3" },
  { term: /\bTSH\b/g, kind: "marker", slug: "tsh" },
  { term: /\bhs[-]?CRP\b/gi, kind: "marker", slug: "hs-crp" },
  { term: /\bhomocysteine\b/gi, kind: "marker", slug: "homocysteine" },
  { term: /\bHcy\b/g, kind: "marker", slug: "homocysteine" },
  { term: /\bDHEA-?S\b/gi, kind: "marker", slug: "dhea-s" },
  { term: /\bHOMA-?IR\b/gi, kind: "marker", slug: "homa-ir" },
  { term: /\bferritin\b/gi, kind: "marker", slug: "ferritin" },
  { term: /\bbox breath\b/gi, kind: "practice", slug: "box-breath" },
  { term: /\bcold (?:water )?immersion\b/gi, kind: "practice", slug: "cold-water-immersion" },
];

const KIND_PALETTE: Record<
  string,
  { bg: string; fg: string; underline: string }
> = {
  supplement: {
    bg: "rgba(255, 107, 53, 0.08)",
    fg: "var(--fm-primary, #E65527)",
    underline: "#FF6B35",
  },
  mechanism: {
    bg: "rgba(110, 76, 200, 0.08)",
    fg: "#5a3fb0",
    underline: "#7556d0",
  },
  condition: {
    bg: "rgba(0, 78, 137, 0.08)",
    fg: "var(--fm-secondary, #004E89)",
    underline: "#004E89",
  },
  marker: {
    bg: "rgba(46, 204, 113, 0.08)",
    fg: "#1E8449",
    underline: "#1E8449",
  },
  practice: {
    bg: "rgba(184, 119, 10, 0.08)",
    fg: "#8a560a",
    underline: "#B8770A",
  },
  topic: {
    bg: "rgba(43, 45, 66, 0.08)",
    fg: "var(--fm-text-secondary, #5a5a5a)",
    underline: "var(--fm-text-tertiary, #999)",
  },
};

// ───────────────────────────────────────────────────────────────────
// Inline tokenizer — walks the text once, finds catalogue chip matches,
// drops overlaps (earliest + longest wins), returns a flat token stream.
// ───────────────────────────────────────────────────────────────────

type InlineToken =
  | { kind: "text"; text: string }
  | { kind: "chip"; label: string; slug: string; kindSlug: CatalogueChip["kind"] };

function tokenizeInline(text: string, catalogue: CatalogueChip[]): InlineToken[] {
  type Match = {
    start: number;
    end: number;
    raw: string;
    kind: CatalogueChip["kind"];
    slug: string;
  };
  const matches: Match[] = [];
  for (const c of catalogue) {
    const re = new RegExp(c.term.source, c.term.flags.includes("g") ? c.term.flags : c.term.flags + "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      matches.push({
        start: m.index,
        end: m.index + m[0].length,
        raw: m[0],
        kind: c.kind,
        slug: c.slug,
      });
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }
  matches.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const kept: Match[] = [];
  let cursor = 0;
  for (const m of matches) {
    if (m.start >= cursor) {
      kept.push(m);
      cursor = m.end;
    }
  }
  const out: InlineToken[] = [];
  let i = 0;
  for (const m of kept) {
    if (m.start > i) out.push({ kind: "text", text: text.slice(i, m.start) });
    out.push({ kind: "chip", label: m.raw, slug: m.slug, kindSlug: m.kind });
    i = m.end;
  }
  if (i < text.length) out.push({ kind: "text", text: text.slice(i) });
  return out;
}

function CatalogueChipNode({
  label,
  slug,
  kindSlug,
}: {
  label: string;
  slug: string;
  kindSlug: CatalogueChip["kind"];
}) {
  const palette = KIND_PALETTE[kindSlug] ?? KIND_PALETTE.topic;
  return (
    <a
      className="fm-coach-notes-chip"
      href={`/catalogue/${kindSlug === "supplement" ? "supplements" : kindSlug === "mechanism" ? "mechanisms" : kindSlug === "condition" ? "topics" : kindSlug === "marker" ? "lab_tests" : kindSlug === "practice" ? "topics" : "topics"}/${slug}`}
      title={`Open ${label} in catalogue`}
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: 4,
        padding: "0 5px",
        borderRadius: 3,
        background: palette.bg,
        color: palette.fg,
        fontWeight: 600,
        fontSize: "0.95em",
        textDecoration: "none",
        borderBottom: `1px dashed ${palette.underline}`,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </a>
  );
}

// Hazard detection
const HAZARD_PATTERNS = [/🚨/, /⚠️/, /⚠/, /\bURGENT\b/i, /\bwatch for\b/i, /\bdo not\b/i];
function isHazardLine(s: string): boolean {
  return HAZARD_PATTERNS.some((re) => re.test(s));
}

// Render inline tokens — chips + plain bold (**x**) support
function renderInline(text: string, catalogue: CatalogueChip[]) {
  const tokens = tokenizeInline(text, catalogue);
  return tokens.map((t, i) => {
    if (t.kind === "chip") {
      return (
        <CatalogueChipNode
          key={i}
          label={t.label}
          slug={t.slug}
          kindSlug={t.kindSlug}
        />
      );
    }
    const parts = t.text.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((p, j) => {
      if (/^\*\*[^*]+\*\*$/.test(p)) {
        return <strong key={`${i}-${j}`}>{p.slice(2, -2)}</strong>;
      }
      return <span key={`${i}-${j}`}>{p}</span>;
    });
  });
}

// List detection — lines starting "- ", "* ", "• ", "1. "
function asList(p: string): { ordered: boolean; items: string[] } | null {
  const lines = p
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const bulletRe = /^[-*•]\s+/;
  const numRe = /^\d+\.\s+/;
  if (lines.length >= 2 && lines.every((l) => bulletRe.test(l) || numRe.test(l))) {
    return {
      ordered: lines.every((l) => numRe.test(l)),
      items: lines.map((l) => l.replace(bulletRe, "").replace(numRe, "")),
    };
  }
  return null;
}

// ───────────────────────────────────────────────────────────────────
// Section + hazard rendering
// ───────────────────────────────────────────────────────────────────

const TONE_STYLE: Record<
  SectionTone,
  { rule: string; ink: string }
> = {
  neutral: { rule: "var(--fm-border, #E8E8E8)", ink: "var(--fm-text-primary, #1A1A1A)" },
  warn: { rule: "rgba(184, 119, 10, 0.40)", ink: "#8a560a" },
  danger: { rule: "rgba(231, 76, 60, 0.40)", ink: "#c0392b" },
  meta: { rule: "rgba(110, 76, 200, 0.30)", ink: "#5a3fb0" },
};

function HazardLine({
  text,
  listItem = false,
  tone = "warn",
  catalogue,
}: {
  text: string;
  listItem?: boolean;
  tone?: SectionTone;
  catalogue: CatalogueChip[];
}) {
  const palette =
    tone === "danger"
      ? { bg: "rgba(231, 76, 60, 0.06)", bar: "#E74C3C", ink: "#a93226" }
      : { bg: "rgba(184, 119, 10, 0.06)", bar: "#B8770A", ink: "#8a560a" };
  const node = (
    <div
      className="fm-coach-notes-hazard"
      style={{
        padding: "10px 14px",
        background: palette.bg,
        borderLeft: `3px solid ${palette.bar}`,
        borderRadius: "0 4px 4px 0",
        margin: "6px 0 8px",
        fontSize: 12.5,
        lineHeight: 1.55,
        color: palette.ink,
        fontWeight: 500,
      }}
    >
      {renderInline(text, catalogue)}
    </div>
  );
  return listItem ? <li style={{ listStyle: "none", marginLeft: -18 }}>{node}</li> : node;
}

function SectionBlock({
  sec,
  index,
  catalogue,
}: {
  sec: ParsedSection;
  index: number;
  catalogue: CatalogueChip[];
}) {
  const tone = TONE_STYLE[sec.tone];
  return (
    <section
      className="fm-coach-notes-section"
      style={{ marginBottom: 22, breakInside: "avoid" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <span
          style={{
            fontFamily: 'ui-monospace, "SF Mono", monospace',
            fontSize: 11,
            color: "var(--fm-text-tertiary, #999)",
            fontWeight: 600,
            width: 22,
            textAlign: "center",
          }}
        >
          {String(index + 1).padStart(2, "0")}
        </span>
        <span style={{ fontSize: 16, color: tone.ink }}>{sec.icon}</span>
        <h4
          style={{
            fontFamily: 'var(--fm-font-display, "Libre Baskerville", Georgia, serif)',
            fontWeight: 400,
            fontSize: 16,
            margin: 0,
            color: tone.ink,
            letterSpacing: "-0.2px",
          }}
        >
          {sec.label}
        </h4>
        <div
          className="fm-coach-notes-rule"
          style={{ flex: 1, height: 1, background: tone.rule, marginLeft: 6 }}
        />
      </div>
      <div style={{ paddingLeft: 32 }}>
        {sec.body.map((para, i) => {
          const list = asList(para);
          if (list) {
            const Tag = list.ordered ? "ol" : "ul";
            return (
              <Tag
                key={i}
                style={{
                  margin: "0 0 10px 0",
                  paddingLeft: 18,
                  fontSize: 12.5,
                  lineHeight: 1.65,
                  color: "var(--fm-text-primary, #1A1A1A)",
                }}
              >
                {list.items.map((it, j) => {
                  if (isHazardLine(it)) {
                    return (
                      <HazardLine
                        key={j}
                        text={it}
                        listItem
                        tone={sec.tone}
                        catalogue={catalogue}
                      />
                    );
                  }
                  return (
                    <li key={j} style={{ marginBottom: 4 }}>
                      {renderInline(it, catalogue)}
                    </li>
                  );
                })}
              </Tag>
            );
          }
          if (isHazardLine(para)) {
            return (
              <HazardLine
                key={i}
                text={para}
                tone={sec.tone}
                catalogue={catalogue}
              />
            );
          }
          return (
            <p
              key={i}
              style={{
                margin: "0 0 10px 0",
                fontSize: 12.5,
                lineHeight: 1.65,
                color: "var(--fm-text-primary, #1A1A1A)",
                maxWidth: "64ch",
              }}
            >
              {renderInline(para, catalogue)}
            </p>
          );
        })}
      </div>
    </section>
  );
}

// ───────────────────────────────────────────────────────────────────
// Main component — handles parsing, collapse state, render
// ───────────────────────────────────────────────────────────────────

function wordCountSections(sections: ParsedSection[]): number {
  return sections.reduce(
    (acc, s) => acc + s.body.join(" ").split(/\s+/).filter(Boolean).length,
    0,
  );
}

export function FmCoachNotes({
  text,
  planSlug,
  catalogue,
  collapseThresholdWords = 480,
}: FmCoachNotesProps) {
  const sections = useMemo(() => parseNotes(text), [text]);
  const chips = catalogue ?? DEFAULT_CATALOGUE;
  const totalWords = useMemo(() => wordCountSections(sections), [sections]);
  const needsCollapse = totalWords > collapseThresholdWords;

  // Persist expanded/collapsed state per plan. Default for new visits:
  //   - short blob (under threshold) → no toggle, always full
  //   - long blob (over threshold)   → collapsed by default
  const storageKey = `fm-coach-notes:${planSlug}`;
  const [open, setOpen] = useState<boolean>(!needsCollapse);
  useEffect(() => {
    if (!needsCollapse) {
      setOpen(true);
      return;
    }
    try {
      const stored = window.localStorage.getItem(storageKey);
      setOpen(stored === "open");
    } catch {
      // localStorage blocked — fall back to collapsed
    }
  }, [storageKey, needsCollapse]);
  const toggle = () => {
    setOpen((v) => {
      const next = !v;
      try {
        window.localStorage.setItem(storageKey, next ? "open" : "closed");
      } catch {
        // ignore
      }
      return next;
    });
  };

  // Slice for collapsed view — drop sections past the word threshold,
  // but always show at least one full section.
  const visibleSections = useMemo(() => {
    if (open || !needsCollapse) return sections;
    let acc = 0;
    const out: ParsedSection[] = [];
    for (const sec of sections) {
      const w = sec.body.join(" ").split(/\s+/).filter(Boolean).length;
      if (out.length === 0 || acc + w <= collapseThresholdWords) {
        out.push(sec);
        acc += w;
      } else {
        break;
      }
    }
    return out;
  }, [sections, open, needsCollapse, collapseThresholdWords]);
  const hiddenCount = sections.length - visibleSections.length;

  // Empty input → nothing to render. Caller can decide to hide the wrapping
  // FmPanel; this component just renders nothing.
  if (sections.length === 0) return null;

  const rootStyle: CSSProperties = {
    // Body wrapper — primary container for the print rules below.
  };

  return (
    <div className="fm-coach-notes" style={rootStyle}>
      <article>
        {visibleSections.map((sec, i) => (
          <SectionBlock
            key={`${sec.id}-${i}`}
            sec={sec}
            index={i}
            catalogue={chips}
          />
        ))}
      </article>

      {needsCollapse && (
        <div
          className="fm-coach-notes-toggle no-print"
          style={{
            marginTop: 4,
            paddingTop: 12,
            borderTop: "1px dashed var(--fm-border, #E8E8E8)",
            display: "flex",
            alignItems: "center",
            gap: 12,
            fontSize: 11.5,
            color: "var(--fm-text-tertiary, #999)",
          }}
        >
          <span>
            {totalWords} words · {sections.length} sections
          </span>
          {hiddenCount > 0 && !open && (
            <span style={{ color: "var(--fm-text-secondary, #5a5a5a)" }}>
              + {hiddenCount} more section{hiddenCount === 1 ? "" : "s"} hidden
            </span>
          )}
          <button
            type="button"
            onClick={toggle}
            style={{
              marginLeft: "auto",
              padding: "5px 12px",
              fontSize: 11.5,
              fontWeight: 700,
              background: "var(--fm-surface, #fff)",
              border: "1px solid var(--fm-border, #E8E8E8)",
              borderRadius: 6,
              cursor: "pointer",
              color: "var(--fm-text-primary, #1A1A1A)",
              fontFamily: "inherit",
            }}
          >
            {open ? "Show less" : "Show all"}
          </button>
        </div>
      )}

      {/* Print rules — coach prints these for in-session reference.
          Drop chip styling (paper has no clickable links), render dividers
          as horizontal rules, hide the show-more toggle. */}
      <style>{`
        @media print {
          .fm-coach-notes-chip {
            background: transparent !important;
            border: 0 !important;
            color: inherit !important;
            padding: 0 !important;
            border-bottom: none !important;
          }
          .fm-coach-notes-hazard {
            background: transparent !important;
            border-left: 2px solid #000 !important;
            color: #000 !important;
          }
          .fm-coach-notes-rule {
            background: #000 !important;
            height: 1px !important;
          }
          .fm-coach-notes-toggle,
          .fm-coach-notes .no-print {
            display: none !important;
          }
          .fm-coach-notes-section {
            page-break-inside: avoid;
          }
        }
      `}</style>
    </div>
  );
}
