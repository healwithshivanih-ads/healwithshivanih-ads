"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { MindMapNode } from "@/lib/fmdb/loader-extras";

interface Props {
  slug: string;
  mermaidSource: string | null;
  renderError: string | null;
  fallbackTree: MindMapNode[] | undefined;
}

const KIND_COLORS: Record<string, string> = {
  topic: "bg-blue-100 text-blue-900",
  mechanism: "bg-purple-100 text-purple-900",
  symptom: "bg-amber-100 text-amber-900",
  supplement: "bg-emerald-100 text-emerald-900",
  claim: "bg-rose-100 text-rose-900",
  cooking_adjustment: "bg-orange-100 text-orange-900",
  home_remedy: "bg-teal-100 text-teal-900",
};

function NodeTree({ nodes }: { nodes: MindMapNode[] | undefined }) {
  if (!nodes || nodes.length === 0) return null;
  return (
    <ul className="ml-4 border-l border-border pl-3 space-y-1">
      {nodes.map((n, i) => (
        <li key={i} className="text-sm">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span>{n.label}</span>
            {n.linked_kind && n.linked_slug && (
              <span
                className={`text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded ${
                  KIND_COLORS[n.linked_kind] ?? "bg-muted text-muted-foreground"
                }`}
                title={`linked to ${n.linked_kind}/${n.linked_slug}`}
              >
                {n.linked_kind}: {n.linked_slug}
              </span>
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
          {!renderFailure && (
            <div
              ref={containerRef}
              className="border rounded-md p-4 bg-background overflow-auto max-h-[80vh]"
              dangerouslySetInnerHTML={renderedSvg ? { __html: renderedSvg } : undefined}
            >
              {!renderedSvg && (
                <p className="text-xs text-muted-foreground italic">
                  Rendering mind map…
                </p>
              )}
            </div>
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
