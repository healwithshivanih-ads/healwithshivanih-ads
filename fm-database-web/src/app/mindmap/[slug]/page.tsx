import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  loadMindMapBySlug,
  countMindMapNodes,
} from "@/lib/fmdb/loader-extras";
import { renderMindmap } from "./actions";
import { MindMapMermaid } from "./mindmap-mermaid";

export const dynamic = "force-dynamic";

export default async function MindMapDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const m = await loadMindMapBySlug(slug);
  if (!m) notFound();

  const counts = countMindMapNodes(m.tree);
  const rendered = await renderMindmap(slug);
  const mermaidSource = rendered.ok && rendered.mermaid ? rendered.mermaid : null;
  const renderError = rendered.ok ? null : (rendered.error ?? "Render failed");

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/mindmap"
          className="text-xs text-muted-foreground hover:underline"
        >
          ← All mind maps
        </Link>
        <h1 className="text-3xl font-bold mt-1">
          {m.display_name ?? m.slug}
        </h1>
        <div className="flex gap-2 mt-2 flex-wrap text-xs text-muted-foreground">
          <span>{counts.total} nodes</span>
          <span>·</span>
          <span>{counts.linked} linked</span>
          {m.evidence_tier && (
            <>
              <span>·</span>
              <Badge variant="outline">{m.evidence_tier}</Badge>
            </>
          )}
        </div>
      </div>

      {m.description && (
        <Card>
          <CardContent className="pt-6 text-sm">{m.description}</CardContent>
        </Card>
      )}

      {m.related_topics && m.related_topics.length > 0 && (
        <div className="flex gap-2 flex-wrap items-center">
          <span className="text-xs text-muted-foreground">Related topics:</span>
          {m.related_topics.map((t) => (
            <Link key={t} href={`/catalogue/topics/${t}`}>
              <Badge variant="outline" className="hover:bg-accent">
                {t}
              </Badge>
            </Link>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tree</CardTitle>
        </CardHeader>
        <CardContent>
          {m.tree && m.tree.length > 0 ? (
            <MindMapMermaid
              slug={slug}
              mermaidSource={mermaidSource}
              renderError={renderError}
              fallbackTree={m.tree}
            />
          ) : (
            <p className="italic text-muted-foreground text-sm">No nodes.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
