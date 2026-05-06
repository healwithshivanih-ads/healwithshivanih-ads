"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { MindMapNode } from "@/lib/fmdb/loader-extras";

interface Props {
  slug: string;
  mermaidSource: string | null;
  renderError: string | null;
  fallbackTree: MindMapNode[] | undefined;
}

const KIND_COLORS: Record<string, string> = {
  topic: "bg-blue-100 text-blue-800 hover:bg-blue-200",
  mechanism: "bg-purple-100 text-purple-800 hover:bg-purple-200",
  symptom: "bg-amber-100 text-amber-800 hover:bg-amber-200",
  supplement: "bg-emerald-100 text-emerald-800 hover:bg-emerald-200",
  claim: "bg-rose-100 text-rose-800 hover:bg-rose-200",
  cooking_adjustment: "bg-orange-100 text-orange-800 hover:bg-orange-200",
  home_remedy: "bg-teal-100 text-teal-800 hover:bg-teal-200",
};

const KIND_LABELS: Record<string, string> = {
  topic: "Topic",
  mechanism: "Mechanism",
  symptom: "Symptom",
  supplement: "Supplement",
  claim: "Claim",
  cooking_adjustment: "Cooking",
  home_remedy: "Remedy",
};

// Map kind → catalogue URL segment (plural)
const KIND_URL: Record<string, string> = {
  topic: "topics",
  mechanism: "mechanisms",
  symptom: "symptoms",
  supplement: "supplements",
  claim: "claims",
  cooking_adjustment: "cooking_adjustments",
  home_remedy: "home_remedies",
};

function NodeTree({ nodes }: { nodes: MindMapNode[] | undefined }) {
  if (!nodes || nodes.length === 0) return null;
  return (
    <ul className="ml-4 border-l border-border pl-3 space-y-1">
      {nodes.map((n, i) => (
        <li key={i} className="text-sm">
          <div className="flex items-baseline gap-2 flex-wrap py-0.5">
            <span className="leading-snug">{n.label}</span>
            {n.linked_kind && n.linked_slug && KIND_URL[n.linked_kind] && (
              <Link
                href={`/catalogue/${KIND_URL[n.linked_kind]}/${n.linked_slug}`}
                className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded transition-colors cursor-pointer ${
                  KIND_COLORS[n.linked_kind] ?? "bg-muted text-muted-foreground hover:bg-accent"
                }`}
                title={`View full ${n.linked_kind} entry: ${n.linked_slug}`}
              >
                <span>{KIND_LABELS[n.linked_kind] ?? n.linked_kind}</span>
                <span className="opacity-60">↗</span>
              </Link>
            )}
            {n.notes && (
              <span className="text-xs text-muted-foreground italic">
                — {n.notes}
              </span>
            )}
          </div>
          {n.children && n.children.length > 0 && <NodeTree nodes={n.children} />}
        </li>
      ))}
    </ul>
  );
}

export function MindMapMermaid({ slug, mermaidSource, renderError, fallbackTree }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<"mermaid" | "outline">(
    mermaidSource && !renderError ? "mermaid" : "outline"
  );
  const [renderFailure, setRenderFailure] = useState<string | null>(renderError);
  const [renderedSvg, setRenderedSvg] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== "mermaid" || !mermaidSource) return;
    let cancelled = false;

    (async () => {
      try {
        // Heavy client-only dep — dynamic import keeps it out of SSR.
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "loose",
          theme: "base",
          themeVariables: {
            primaryColor: "#14532d",
            primaryTextColor: "#ffffff",
            primaryBorderColor: "#14532d",
            lineColor: "#86efac",
            secondaryColor: "#dcfce7",
            tertiaryColor: "#f0fdf4",
            fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
          },
          mindmap: {
            padding: 12,
            maxNodeWidth: 220,
          },
        });

        const id = `mm-${slug.replace(/[^a-zA-Z0-9]/g, "-")}-${Date.now()}`;
        const { svg } = await mermaid.render(id, mermaidSource);
        if (cancelled) return;
        setRenderedSvg(svg);
        setRenderFailure(null);
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setRenderFailure(msg);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [mode, mermaidSource, slug]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">View:</span>
        <Button
          type="button"
          size="sm"
          variant={mode === "mermaid" ? "default" : "outline"}
          onClick={() => setMode("mermaid")}
          disabled={!mermaidSource}
        >
          Mermaid map
        </Button>
        <Button
          type="button"
          size="sm"
          variant={mode === "outline" ? "default" : "outline"}
          onClick={() => setMode("outline")}
        >
          Show as outline
        </Button>
      </div>

      {mode === "mermaid" && mermaidSource && (
        <>
          {renderFailure && (
            <p className="text-xs text-amber-700 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 rounded p-2">
              Mermaid render failed: {renderFailure}. Showing outline below.
            </p>
          )}
          {!renderFailure && !renderedSvg && (
            <div className="border rounded-md p-4 bg-background overflow-auto max-h-[80vh]">
              <p className="text-xs text-muted-foreground italic">
                Rendering mind map…
              </p>
            </div>
          )}
          {!renderFailure && renderedSvg && (
            <div
              ref={containerRef}
              className="border rounded-md p-4 bg-background overflow-auto max-h-[80vh]"
              dangerouslySetInnerHTML={{ __html: renderedSvg }}
            />
          )}
          {renderFailure && <NodeTree nodes={fallbackTree} />}
        </>
      )}

      {mode === "mermaid" && !mermaidSource && (
        <p className="text-xs text-muted-foreground italic">
          No Mermaid source available — showing outline.
        </p>
      )}

      {mode === "outline" && <NodeTree nodes={fallbackTree} />}
    </div>
  );
}
