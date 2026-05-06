import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { loadAllResources } from "@/lib/fmdb/loader-extras";
import { getResourcesRoot } from "@/lib/fmdb/paths";

export const dynamic = "force-dynamic";

export default async function ResourcesPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; audience?: string; q?: string }>;
}) {
  const { kind, audience, q } = await searchParams;
  const all = await loadAllResources();

  const kinds = Array.from(new Set(all.map((r) => r.kind ?? "other"))).sort();
  const audiences = Array.from(
    new Set(all.map((r) => r.audience ?? "both"))
  ).sort();

  const qLower = (q ?? "").toLowerCase();
  const filtered = all.filter((r) => {
    if (kind && (r.kind ?? "") !== kind) return false;
    if (audience && (r.audience ?? "") !== audience) return false;
    if (qLower && !(r.title ?? r.slug).toLowerCase().includes(qLower))
      return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) =>
    (a.title ?? a.slug).localeCompare(b.title ?? b.slug)
  );

  function buildHref(updates: Record<string, string | undefined>) {
    const params = new URLSearchParams();
    const next = { kind, audience, q, ...updates };
    for (const [k, v] of Object.entries(next)) {
      if (v) params.set(k, v);
    }
    const qs = params.toString();
    return qs ? `/resources?${qs}` : "/resources";
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Resources Toolkit</h1>
        <p className="text-muted-foreground mt-1">
          Reading from{" "}
          <code className="font-mono">{getResourcesRoot()}/resources/</code>.
          Read-only.
        </p>
      </div>

      <form className="flex gap-2 flex-wrap items-end" action="/resources">
        <div className="flex flex-col">
          <label className="text-xs text-muted-foreground mb-1">Kind</label>
          <select
            name="kind"
            defaultValue={kind ?? ""}
            className="text-sm border rounded-md px-2 py-1.5 bg-background"
          >
            <option value="">All kinds</option>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-muted-foreground mb-1">Audience</label>
          <select
            name="audience"
            defaultValue={audience ?? ""}
            className="text-sm border rounded-md px-2 py-1.5 bg-background"
          >
            <option value="">All audiences</option>
            {audiences.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-muted-foreground mb-1">Search</label>
          <input
            name="q"
            defaultValue={q ?? ""}
            placeholder="title contains..."
            className="text-sm border rounded-md px-2 py-1.5 bg-background"
          />
        </div>
        <button
          type="submit"
          className="text-xs px-3 py-1.5 rounded-md border bg-primary text-primary-foreground"
        >
          Filter
        </button>
        {(kind || audience || q) && (
          <Link href="/resources" className="text-xs underline self-center">
            clear
          </Link>
        )}
      </form>

      {sorted.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            No resources match.{" "}
            <Link href={buildHref({ kind: "", audience: "", q: "" })}>
              clear filters
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Audience</TableHead>
                <TableHead># topics</TableHead>
                <TableHead>Shareable</TableHead>
                <TableHead>Lifecycle</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((r) => (
                <TableRow key={r.slug}>
                  <TableCell>
                    <Link
                      href={`/resources/${r.slug}`}
                      className="hover:underline"
                    >
                      {r.title ?? r.slug}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{r.kind ?? "—"}</Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    {r.audience ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {(r.related_topics ?? []).length}
                  </TableCell>
                  <TableCell className="text-sm">
                    {r.shareable ? "yes" : "no"}
                  </TableCell>
                  <TableCell className="text-sm">{r.status ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
