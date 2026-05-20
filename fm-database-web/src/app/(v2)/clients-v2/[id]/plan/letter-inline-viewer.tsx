"use client";

/**
 * LetterInlineViewer — renders the actual meal plan + supplement schedule
 * from a generated client letter, INLINE on the plan tab, as collapsible
 * accordion sections (no detour to a new tab).
 *
 * Coach feedback 2026-05-14: "the html in new tab is hard to read. Can we
 * create a collapsible window that just shows the meal plan in the window
 * itself. Not the whole letter — just the week wise meal plan and
 * supplements the client was sent"
 *
 * IMPLEMENTATION
 * --------------
 * The brand HTML (scripts/brand_html.py) wraps each `## Week N` section
 * in `<div id="print-week-N" class="week-section">` and provides print
 * isolation via:
 *
 *   body[data-print-week="N"] .content > *:not(.week-section) { display: none }
 *   body[data-print-week="N"] .week-section:not(#print-week-N) { display: none }
 *   body[data-print-week] #supplement-schedule { display: none }
 *   body[data-print-week] .brand-footer { display: none }
 *
 * AND for the supplement schedule:
 *
 *   body[data-print-supplement] .page > .doc-title-block { display: none }
 *   body[data-print-supplement] .page > .content { display: none }
 *   body[data-print-supplement] .page > .brand-footer { display: none }
 *
 * So we can render the SAME letter HTML in 3+ iframes (one per week + one
 * for supplements), each with the right `data-print-*` body attribute,
 * and the brand CSS does the slicing for us. Zero parsing, zero style
 * collision with the v2 panel.
 *
 * Each iframe is auto-resized via postMessage from a tiny resize script
 * injected at the bottom of the srcdoc body — sends document.body.scrollHeight
 * back to the parent so we can size to content.
 */

import { useEffect, useRef, useState } from "react";
import {
  getLetterSectionsAction,
  type LetterSectionsResult,
} from "@/lib/server-actions/plan-lifecycle";

interface Props {
  clientId: string;
  planSlug: string;
  letterType: string;
}

interface SectionState {
  kind: "week" | "supplements";
  n?: number;                  // week number, when kind=week
  open: boolean;
  height: number;              // measured iframe content height, px
}

const HEIGHT_MIN = 200;
const HEIGHT_MAX = 1400;

/**
 * Inject `data-print-week="N"` or `data-print-supplement="1"` onto the
 * `<body ...>` tag of the letter HTML + a screen-mode isolation stylesheet
 * that mirrors brand_html.py's @media-print rules.
 *
 * WHY THE OVERRIDE STYLESHEET
 *   brand_html.py defines the isolation rules INSIDE `@media print { ... }`
 *   because they were designed for "print just this week" via window.print().
 *   In a normal browser/iframe view (no @media print active), the rules are
 *   inert and the iframe shows the whole letter — exactly what coach was
 *   seeing 2026-05-14: "Week 1 and Week 2 menu both are still showing the
 *   full letter not just the meal plans". The override below replicates
 *   the same isolation but at screen level so iframes slice cleanly.
 *
 * Also injects a tiny postMessage resizer so the parent can auto-size the
 * iframe to its content height.
 */
function buildSrcDoc(html: string, attr: string, value: string, channel: string): string {
  // Screen-mode isolation CSS. Mirrors brand_html.py @media-print rules
  // but applies always. Supports up to 12 weeks (real letters have 1-6).
  // !important on every rule because the brand stylesheet defines layout
  // on .content > * descendants and we need to win specificity.
  const isolateCss = `
<style id="fm-inline-viewer-isolate">
  /* Shared chrome hidden in any single-section view. */
  body[data-print-week] .brand-header,
  body[data-print-week] .brand-footer,
  body[data-print-week] .doc-title-block,
  body[data-print-week] #supplement-schedule,
  body[data-print-week] #supplement-shopping-list,
  body[data-print-supplement] .brand-header,
  body[data-print-supplement] .brand-footer,
  body[data-print-supplement] .doc-title-block { display: none !important; }

  /* Week mode: hide everything in .content except week-sections,
     then re-show only the targeted week. */
  body[data-print-week] .content > *:not(.week-section) { display: none !important; }
  body[data-print-week] .week-section { display: none !important; }
  body[data-print-week="1"] #print-week-1,
  body[data-print-week="2"] #print-week-2,
  body[data-print-week="3"] #print-week-3,
  body[data-print-week="4"] #print-week-4,
  body[data-print-week="5"] #print-week-5,
  body[data-print-week="6"] #print-week-6,
  body[data-print-week="7"] #print-week-7,
  body[data-print-week="8"] #print-week-8,
  body[data-print-week="9"] #print-week-9,
  body[data-print-week="10"] #print-week-10,
  body[data-print-week="11"] #print-week-11,
  body[data-print-week="12"] #print-week-12 { display: block !important; }

  /* Supplement mode: hide everything in .content except the schedule. */
  body[data-print-supplement] .content > *:not(#supplement-schedule) { display: none !important; }
  body[data-print-supplement] #supplement-schedule { display: block !important; }

  /* Tighten margins — we're inside a panel, not a full A4 sheet. */
  body[data-print-week],
  body[data-print-supplement] { margin: 0 !important; padding: 16px !important; }
  body[data-print-week] .page,
  body[data-print-supplement] .page { padding: 0 !important; max-width: none !important; }
</style>`;

  const resizerScript = `
<script>
(function() {
  var lastH = 0;
  function postH() {
    var h = document.body.scrollHeight;
    if (Math.abs(h - lastH) < 4) return;
    lastH = h;
    parent.postMessage({ type: "fm-letter-resize", channel: ${JSON.stringify(channel)}, height: h }, "*");
  }
  if (typeof ResizeObserver === "function") {
    new ResizeObserver(postH).observe(document.body);
  }
  window.addEventListener("load", postH);
  // first burst after webfonts settle
  setTimeout(postH, 200);
  setTimeout(postH, 800);
})();
</script>`;
  // Inject the isolation CSS just before </head> so it overrides any
  // earlier brand stylesheet. (Falls back to before <body> if no </head>.)
  let withCss = html;
  if (/<\/head>/i.test(html)) {
    withCss = html.replace(/<\/head>/i, `${isolateCss}</head>`);
  } else {
    withCss = html.replace(/<body/i, `${isolateCss}<body`);
  }
  const withAttr = withCss.replace(
    /<body([^>]*)>/i,
    `<body$1 ${attr}="${value}">`,
  );
  // Inject resizer before </body>
  return withAttr.replace(
    /<\/body>/i,
    `${resizerScript}</body>`,
  );
}

function SectionFrame({
  html,
  attr,
  value,
  channel,
  initiallyOpen,
  sourceLabel,
  savedAt,
}: {
  html: string;
  attr: string;
  value: string;
  channel: string;
  initiallyOpen: boolean;
  /** Coach-readable provenance, e.g. "consolidated letter" or "phase 3–4". */
  sourceLabel?: string;
  /** ISO mtime of the source file — used to surface "saved 5 days ago" style hints. */
  savedAt?: string;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const [height, setHeight] = useState<number>(HEIGHT_MIN);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const data = e.data as { type?: string; channel?: string; height?: number } | null;
      if (!data || data.type !== "fm-letter-resize" || data.channel !== channel) return;
      if (typeof data.height !== "number") return;
      const clamped = Math.max(HEIGHT_MIN, Math.min(HEIGHT_MAX, data.height + 32));
      setHeight(clamped);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [channel]);

  const srcDoc = buildSrcDoc(html, attr, value, channel);

  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      style={{
        border: "1px solid var(--fm-border)",
        borderRadius: 6,
        marginBottom: 8,
        background: "var(--fm-bg)",
      }}
    >
      <summary
        style={{
          padding: "10px 14px",
          cursor: "pointer",
          fontSize: 14,
          fontWeight: 500,
          listStyle: "none",
          display: "flex",
          alignItems: "center",
          gap: 8,
          userSelect: "none",
        }}
      >
        <span aria-hidden style={{ fontSize: 11, opacity: 0.6, transition: "transform 150ms" }}>
          {open ? "▼" : "▶"}
        </span>
        <SectionLabel attr={attr} value={value} />
        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexShrink: 0,
          }}
        >
          {sourceLabel && (
            <span
              style={{
                fontSize: 11,
                color: "var(--fm-text-tertiary, #9ca3af)",
                fontWeight: 400,
                textTransform: "lowercase",
                letterSpacing: 0.2,
              }}
              title={savedAt ? `Saved ${savedAt}` : undefined}
            >
              from {sourceLabel}
            </span>
          )}
          {/* 🖨 Print only THIS section. The brand-html's print-week-bar
              normally injects equivalent buttons at the top of the full
              letter, but in the inline viewer we render each section in
              its own iframe — so the bar doesn't exist there. This
              wrapper button calls the iframe's contentWindow.print(),
              which prints just the section's body. */}
          {open && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                try {
                  iframeRef.current?.contentWindow?.focus();
                  iframeRef.current?.contentWindow?.print();
                } catch { /* fails silently if sandbox blocks; safari quirk */ }
              }}
              title="Print this section"
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: "3px 10px",
                background: "var(--fm-surface)",
                color: "var(--fm-text-primary)",
                border: "1px solid var(--fm-border)",
                borderRadius: 4,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              🖨 Print
            </button>
          )}
        </div>
      </summary>
      {open && (
        <iframe
          ref={iframeRef}
          srcDoc={srcDoc}
          title={`${attr}=${value}`}
          // Sandbox: allow scripts (the resizer) but not top-nav or forms.
          sandbox="allow-scripts allow-same-origin"
          style={{
            display: "block",
            width: "100%",
            height: height,
            border: 0,
            borderTop: "1px solid var(--fm-border)",
            background: "white",
          }}
        />
      )}
    </details>
  );
}

function SectionLabel({ attr, value }: { attr: string; value: string }) {
  if (attr === "data-print-week") {
    return <span>🗓 Week {value} menu</span>;
  }
  if (attr === "data-print-supplement") {
    return <span>💊 Supplement schedule</span>;
  }
  return <span>{attr}={value}</span>;
}

export function LetterInlineViewer({ clientId, planSlug, letterType }: Props) {
  const [state, setState] = useState<{
    loading: boolean;
    data: LetterSectionsResult | null;
    error: string | null;
  }>({ loading: true, data: null, error: null });

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, data: null, error: null });
    getLetterSectionsAction(planSlug, clientId, letterType as never)
      .then((r) => {
        if (cancelled) return;
        if (r.ok) {
          setState({ loading: false, data: r, error: null });
        } else {
          setState({ loading: false, data: null, error: r.error ?? "Failed to load" });
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState({
          loading: false,
          data: null,
          error: e instanceof Error ? e.message : "Failed to load",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, planSlug, letterType]);

  if (state.loading) {
    return (
      <div style={{ padding: "8px 0", fontSize: 13, color: "var(--fm-text-secondary)" }}>
        Loading letter sections…
      </div>
    );
  }

  if (state.error || !state.data) {
    return (
      <div
        style={{
          padding: "8px 12px",
          fontSize: 13,
          color: "var(--fm-text-secondary)",
          background: "var(--fm-bg-subtle, rgba(0,0,0,0.03))",
          borderRadius: 4,
        }}
      >
        {state.error ?? "Couldn't read letter HTML"}
      </div>
    );
  }

  const weekSources = state.data.weekSources ?? [];
  const supplements = state.data.supplements ?? null;

  if (weekSources.length === 0 && !supplements) {
    return (
      <div style={{ fontSize: 13, color: "var(--fm-text-secondary)" }}>
        No week sections or supplement schedule in this letter.
      </div>
    );
  }

  return (
    <div style={{ marginTop: 4 }}>
      {weekSources.map((src, i) => (
        <SectionFrame
          // Key on the source label too — when a phase letter is added /
          // regenerated for an existing week, the source changes and we
          // want the iframe to remount with the fresh HTML.
          key={`week-${src.weekNumber}-${src.sourceLabel}`}
          html={src.html}
          attr="data-print-week"
          value={String(src.weekNumber)}
          channel={`${planSlug}-${letterType}-week-${src.weekNumber}-${src.sourceLabel}`}
          // First week opens by default — coach almost always reads
          // week 1 first; subsequent weeks she'll click in.
          initiallyOpen={i === 0}
          sourceLabel={src.sourceLabel}
          savedAt={src.savedAt}
        />
      ))}
      {supplements && (
        <SectionFrame
          html={supplements.html}
          attr="data-print-supplement"
          value="1"
          channel={`${planSlug}-${letterType}-supplements-${supplements.sourceLabel}`}
          initiallyOpen={false}
          sourceLabel={supplements.sourceLabel}
          savedAt={supplements.savedAt}
        />
      )}
    </div>
  );
}
