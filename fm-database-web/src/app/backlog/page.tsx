import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { loadBacklog, type BacklogItem } from "@/lib/fmdb/loader-extras";
import { promoteBacklogItem, rejectBacklogItem } from "./actions";

export const dynamic = "force-dynamic";

const KIND_OPTIONS = [
  "topic",
  "mechanism",
  "symptom",
  "supplement",
  "claim",
  "cooking_adjustment",
  "home_remedy",
];

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function PromoteForm({ item }: { item: BacklogItem }) {
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-blue-700 hover:underline">
        Promote
      </summary>
      <form
        action={promoteBacklogItem}
        className="flex flex-wrap gap-1.5 mt-2 items-end p-2 bg-muted/40 rounded"
      >
        <input type="hidden" name="id" value={item.id} />
        <div className="flex flex-col">
          <label className="text-[10px] uppercase text-muted-foreground">
            Kind
          </label>
          <select
            name="kind"
            defaultValue={item.kind}
            className="text-xs border rounded px-1.5 py-1 bg-background"
          >
            {KIND_OPTIONS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col">
          <label className="text-[10px] uppercase text-muted-foreground">
            Slug
          </label>
          <input
            name="slug"
            defaultValue={slugify(item.name)}
            className="text-xs border rounded px-1.5 py-1 bg-background font-mono w-40"
          />
        </div>
        <div className="flex flex-col">
          <label className="text-[10px] uppercase text-muted-foreground">
            Display name
          </label>
          <input
            name="display_name"
            defaultValue={item.name}
            className="text-xs border rounded px-1.5 py-1 bg-background w-48"
          />
        </div>
        <label className="flex items-center gap-1 text-xs">
          <input type="checkbox" name="force" />
          force
        </label>
        <button
          type="submit"
          className="text-xs px-2 py-1 rounded bg-primary text-primary-foreground"
        >
          Confirm
        </button>
      </form>
    </details>
  );
}

function RejectForm({ item }: { item: BacklogItem }) {
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-rose-700 hover:underline">
        Reject
      </summary>
      <form
        action={rejectBacklogItem}
        className="flex gap-1.5 mt-2 items-end p-2 bg-muted/40 rounded"
      >
        <input type="hidden" name="id" value={item.id} />
        <div className="flex flex-col">
          <label className="text-[10px] uppercase text-muted-foreground">
            Note (optional)
          </label>
          <input
            name="note"
            placeholder="why?"
            className="text-xs border rounded px-1.5 py-1 bg-background w-56"
          />
        </div>
        <button
          type="submit"
          className="text-xs px-2 py-1 rounded bg-destructive text-white"
        >
          Reject
        </button>
      </form>
    </details>
  );
}

export default async function BacklogPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; kind?: string; q?: string }>;
}) {
  const { status: statusParam, kind, q } = await searchParams;
  const status = statusParam ?? "open";
  const all = await loadBacklog();
  const qLower = (q ?? "").toLowerCase();

  const filtered = all.filter((it) => {
    if (status !== "all" && it.status !== status) return false;
    if (kind && it.kind !== kind) return false;
    if (qLower) {
      const blob = `${it.name ?? ""} ${it.why ?? ""}`.toLowerCase();
      if (!blob.includes(qLower)) return false;
    }
    return true;
  });

  const sorted = [...filtered].sort(
    (a, b) => (b.seen_count ?? 0) - (a.seen_count ?? 0)
  );

  const STATUS_OPTIONS = ["open", "added", "rejected", "all"];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Catalogue Backlog</h1>
        <p className="text-muted-foreground mt-1">
          Suggestions captured from AI runs and the mind-map miner. Promote good
          ones to the catalogue or reject the rest.
        </p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {STATUS_OPTIONS.map((opt) => {
          const params = new URLSearchParams();
          if (opt !== "open") params.set("status", opt);
          if (kind) params.set("kind", kind);
          if (q) params.set("q", q);
          const qs = params.toString();
          const href = qs ? `/backlog?${qs}` : "/backlog";
          const active = status === opt;
          return (
            <Link
              key={opt}
              href={href}
              className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${
                active
                  ? "bg-primary text-primary-foreground border-primary"
                  : "hover:bg-accent"
              }`}
            >
              {opt}
            </Link>
          );
        })}
      </div>

      <form className="flex gap-2 flex-wrap items-end" action="/backlog">
        <input type="hidden" name="status" value={status} />
        <div className="flex flex-col">
          <label className="text-xs text-muted-foreground mb-1">Kind</label>
          <select
            name="kind"
            defaultValue={kind ?? ""}
            className="text-sm border rounded-md px-2 py-1.5 bg-background"
          >
            <option value="">All kinds</option>
            {KIND_OPTIONS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-muted-foreground mb-1">Search</label>
          <input
            name="q"
            defaultValue={q ?? ""}
            placeholder="name or why..."
            className="text-sm border rounded-md px-2 py-1.5 bg-background"
          />
        </div>
        <button
          type="submit"
          className="text-xs px-3 py-1.5 rounded-md border bg-primary text-primary-foreground"
        >
          Filter
        </button>
        {(kind || q) && (
          <Link href={`/backlog?status=${status}`} className="text-xs underline self-center">
            clear
          </Link>
        )}
      </form>

      {sorted.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            No backlog items match.
          </CardContent>
        </Card>
      ) : (
        <div className="border rounded-md overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kind</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Why</TableHead>
                <TableHead>Seen</TableHead>
                <TableHead>By</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((it) => (
                <TableRow key={it.id}>
                  <TableCell>
                    <Badge variant="outline">{it.kind}</Badge>
                  </TableCell>
                  <TableCell className="text-sm">{it.name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-md">
                    <span className="line-clamp-2">{it.why ?? "—"}</span>
                  </TableCell>
                  <TableCell className="text-sm">
                    {it.seen_count ?? 1}
                  </TableCell>
                  <TableCell className="text-xs">
                    {it.suggested_by ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs">
                    {(it.created_at ?? "").slice(0, 10)}
                  </TableCell>
                  <TableCell>
                    {it.status === "open" ? (
                      <div className="flex flex-col gap-1.5">
                        <PromoteForm item={it} />
                        <RejectForm item={it} />
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground italic">
                        {it.status}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
