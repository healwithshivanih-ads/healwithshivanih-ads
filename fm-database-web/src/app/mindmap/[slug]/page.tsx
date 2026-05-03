import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  loadMindMapBySlug,
  countMindMapNodes,
  type MindMapNode,
} from "@/lib/fmdb/loader-extras";

export const dynamic = "force-dynamic";

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

export default async function MindMapDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const m = await loadMindMapBySlug(slug);
  if (!m) notFound();

  const counts = countMindMapNodes(m.tree);

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
            <NodeTree nodes={m.tree} />
          ) : (
            <p className="italic text-muted-foreground text-sm">No nodes.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
