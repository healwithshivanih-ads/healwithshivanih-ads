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
import { PlanStatusBadge } from "@/components/plan-status-badge";
import { loadAllPlans } from "@/lib/fmdb/loader";
import { getPlansRoot } from "@/lib/fmdb/paths";

export const dynamic = "force-dynamic";

export default async function PlansPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status: statusFilter } = await searchParams;
  const all = await loadAllPlans();

  const filtered = statusFilter
    ? all.filter((p) => (p.status ?? p._bucket) === statusFilter)
    : all;

  const sorted = [...filtered].sort((a, b) =>
    (b.plan_period_start ?? "").localeCompare(a.plan_period_start ?? "")
  );

  const STATUS_OPTIONS = [
    "all",
    "draft",
    "ready_to_publish",
    "published",
    "superseded",
    "revoked",
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Plans</h1>
        <p className="text-muted-foreground mt-1">
          Reading from <code className="font-mono">{getPlansRoot()}</code>.
          Read-only.
        </p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {STATUS_OPTIONS.map((opt) => {
          const href =
            opt === "all" ? "/plans" : `/plans?status=${opt}`;
          const active =
            opt === "all" ? !statusFilter : statusFilter === opt;
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

      {sorted.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            No plans found at <code>{getPlansRoot()}</code>. Create one with the
            Streamlit app or the <code>fmdb plan-new</code> CLI.
          </CardContent>
        </Card>
      ) : (
        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Slug</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Period start</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((p) => (
                <TableRow key={p.slug}>
                  <TableCell>
                    <Link
                      href={`/plans/${p.slug}`}
                      className="font-mono text-xs hover:underline"
                    >
                      {p.slug}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {p.client_id ? (
                      <Link
                        href={`/clients/${p.client_id}`}
                        className="hover:underline"
                      >
                        {p.client_id}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>
                    <PlanStatusBadge status={p.status ?? p._bucket} />
                  </TableCell>
                  <TableCell>{p.version ?? "—"}</TableCell>
                  <TableCell className="text-sm">
                    {p.plan_period_start ?? "—"}
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
