import Link from "next/link";
import { loadBacklog } from "@/lib/fmdb/loader-extras";
import { BacklogTableClient } from "./backlog-table-client";

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

      <BacklogTableClient items={sorted} />
    </div>
  );
}
