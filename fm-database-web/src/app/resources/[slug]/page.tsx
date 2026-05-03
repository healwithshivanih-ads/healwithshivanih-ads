import path from "node:path";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { loadResourceBySlug } from "@/lib/fmdb/loader-extras";

export const dynamic = "force-dynamic";

export default async function ResourceDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const r = await loadResourceBySlug(slug);
  if (!r) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/resources"
          className="text-xs text-muted-foreground hover:underline"
        >
          ← All resources
        </Link>
        <h1 className="text-3xl font-bold mt-1">{r.title ?? r.slug}</h1>
        <div className="flex gap-2 mt-2 flex-wrap">
          {r.kind && <Badge variant="secondary">{r.kind}</Badge>}
          {r.audience && <Badge variant="outline">{r.audience}</Badge>}
          {r.shareable !== undefined && (
            <Badge variant={r.shareable ? "default" : "outline"}>
              {r.shareable ? "shareable" : "internal only"}
            </Badge>
          )}
          {r.status && <Badge variant="outline">{r.status}</Badge>}
        </div>
      </div>

      {r.description && (
        <Card>
          <CardHeader>
            <CardTitle>Description</CardTitle>
          </CardHeader>
          <CardContent className="text-sm whitespace-pre-wrap">
            {r.description}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Content</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-3">
          {r.url && (
            <div>
              <div className="text-xs uppercase text-muted-foreground">URL</div>
              <a
                href={r.url}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-xs hover:underline break-all"
              >
                {r.url}
              </a>
            </div>
          )}
          {r.file_path && (
            <div>
              <div className="text-xs uppercase text-muted-foreground">
                File
              </div>
              <div className="font-mono text-xs">
                {path.basename(r.file_path)}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {r.file_path}
              </div>
              {r.size_bytes !== undefined && (
                <div className="text-xs text-muted-foreground">
                  {Math.round(r.size_bytes / 1024)} KB · {r.mime_type ?? ""}
                </div>
              )}
              <div className="text-xs text-muted-foreground mt-1 italic">
                Open in Finder via the path above.
              </div>
            </div>
          )}
          {r.text && (
            <div>
              <div className="text-xs uppercase text-muted-foreground mb-1">
                Inline text
              </div>
              <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
                {r.text}
              </pre>
            </div>
          )}
          {!r.url && !r.file_path && !r.text && (
            <p className="italic text-muted-foreground">No content attached.</p>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Related topics</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-1">
            {(r.related_topics ?? []).length === 0 && (
              <span className="text-xs italic text-muted-foreground">none</span>
            )}
            {(r.related_topics ?? []).map((t) => (
              <Link key={t} href={`/catalogue/topics/${t}`}>
                <Badge variant="outline" className="hover:bg-accent">
                  {t}
                </Badge>
              </Link>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Related mechanisms</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-1">
            {(r.related_mechanisms ?? []).length === 0 && (
              <span className="text-xs italic text-muted-foreground">none</span>
            )}
            {(r.related_mechanisms ?? []).map((m) => (
              <Badge key={m} variant="outline">
                {m}
              </Badge>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Related supplements</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-1">
            {(r.related_supplements ?? []).length === 0 && (
              <span className="text-xs italic text-muted-foreground">none</span>
            )}
            {(r.related_supplements ?? []).map((s) => (
              <Link key={s} href={`/catalogue/supplements/${s}`}>
                <Badge variant="outline" className="hover:bg-accent">
                  {s}
                </Badge>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

      {r.license_notes && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">License notes</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">{r.license_notes}</CardContent>
        </Card>
      )}
    </div>
  );
}
