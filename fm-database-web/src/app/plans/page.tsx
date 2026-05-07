import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PlanStatusBadge } from "@/components/plan-status-badge";
import { loadAllPlans } from "@/lib/fmdb/loader";
import { loadAllClients } from "@/lib/fmdb/loader";
import { getPlansRoot } from "@/lib/fmdb/paths";
import type { Client } from "@/lib/fmdb/types";

export const dynamic = "force-dynamic";

const STATUS_ORDER: Record<string, number> = {
  draft: 0,
  ready_to_publish: 1,
  published: 2,
  superseded: 3,
  revoked: 4,
};

function planSortKey(p: { status?: string; _bucket?: string; plan_period_start?: string }) {
  const s = p.status ?? p._bucket ?? "";
  return `${STATUS_ORDER[s] ?? 9}-${p.plan_period_start ?? ""}`;
}

export default async function PlansPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; view?: string }>;
}) {
  const { status: statusFilter, view } = await searchParams;
  const flatView = view === "flat";

  const [allPlans, allClients] = await Promise.all([loadAllPlans(), loadAllClients()]);

  // Build a quick name lookup: client_id → display_name
  const clientName = new Map<string, string>();
  for (const c of allClients) {
    const cn = c as Client & { display_name?: string };
    clientName.set(c.client_id, cn.display_name || c.client_id);
  }

  const filtered = statusFilter
    ? allPlans.filter((p) => (p.status ?? p._bucket) === statusFilter)
    : allPlans;

  const STATUS_OPTIONS = ["all", "draft", "ready_to_publish", "published", "superseded", "revoked"];

  // ── Group by client ───────────────────────────────────────────────────────
  const byClient = new Map<string, typeof filtered>();
  const noClientPlans: typeof filtered = [];

  for (const p of filtered) {
    if (p.client_id) {
      if (!byClient.has(p.client_id)) byClient.set(p.client_id, []);
      byClient.get(p.client_id)!.push(p);
    } else {
      noClientPlans.push(p);
    }
  }

  // Sort plans within each client: drafts first, then by period desc
  for (const plans of byClient.values()) {
    plans.sort((a, b) => planSortKey(a).localeCompare(planSortKey(b)));
  }

  // Sort clients: those with a draft first, then by most recent plan period
  const clientGroups = [...byClient.entries()].sort(([, aPlans], [, bPlans]) => {
    const aDraft = aPlans.some((p) => (p.status ?? p._bucket) === "draft") ? 0 : 1;
    const bDraft = bPlans.some((p) => (p.status ?? p._bucket) === "draft") ? 0 : 1;
    if (aDraft !== bDraft) return aDraft - bDraft;
    const aDate = aPlans[0]?.plan_period_start ?? "";
    const bDate = bPlans[0]?.plan_period_start ?? "";
    return bDate.localeCompare(aDate);
  });

  function statusColor(s: string | undefined) {
    const st = s ?? "";
    if (st === "draft") return "bg-yellow-100 text-yellow-800 border-yellow-200";
    if (st === "ready_to_publish") return "bg-blue-100 text-blue-800 border-blue-200";
    if (st === "published") return "bg-green-100 text-green-800 border-green-200";
    if (st === "revoked") return "bg-red-100 text-red-800 border-red-200";
    return "bg-muted text-muted-foreground border-border";
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold">Plans</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Reading from <code className="font-mono text-xs">{getPlansRoot()}</code>
          </p>
        </div>
        <Link href={flatView ? "/plans" : "/plans?view=flat"} className="shrink-0">
          <Button variant="outline" size="sm">
            {flatView ? "👥 Group by client" : "☰ Flat list"}
          </Button>
        </Link>
      </div>

      {/* Status filter pills */}
      <div className="flex gap-2 flex-wrap">
        {STATUS_OPTIONS.map((opt) => {
          const base = flatView ? "?view=flat" : "?";
          const href = opt === "all"
            ? (flatView ? "/plans?view=flat" : "/plans")
            : `/plans${base}${flatView ? "&" : ""}status=${opt}`;
          const active = opt === "all" ? !statusFilter : statusFilter === opt;
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

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            No plans found. Run an assessment to generate a draft.
          </CardContent>
        </Card>
      ) : flatView ? (
        /* ── Flat table view ─────────────────────────────────────────────── */
        <div className="border rounded-md overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-muted-foreground">Client</th>
                <th className="text-left px-4 py-2 font-medium text-muted-foreground">Plan</th>
                <th className="text-left px-4 py-2 font-medium text-muted-foreground">Status</th>
                <th className="text-left px-4 py-2 font-medium text-muted-foreground">Period</th>
                <th className="text-left px-4 py-2 font-medium text-muted-foreground">Version</th>
              </tr>
            </thead>
            <tbody>
              {[...filtered]
                .sort((a, b) =>
                  planSortKey(a).localeCompare(planSortKey(b)) ||
                  (b.plan_period_start ?? "").localeCompare(a.plan_period_start ?? "")
                )
                .map((p) => (
                  <tr key={p.slug} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2">
                      {p.client_id ? (
                        <Link href={`/clients/${p.client_id}`} className="text-sm hover:underline font-medium">
                          {clientName.get(p.client_id) ?? p.client_id}
                        </Link>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-2">
                      <Link href={`/plans/${p.slug}`} className="font-mono text-xs hover:underline text-muted-foreground">
                        {p.slug}
                      </Link>
                    </td>
                    <td className="px-4 py-2">
                      <PlanStatusBadge status={p.status ?? p._bucket} />
                    </td>
                    <td className="px-4 py-2 text-sm">{p.plan_period_start ?? "—"}</td>
                    <td className="px-4 py-2 text-sm">{p.version ?? "—"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : (
        /* ── Client-grouped view ─────────────────────────────────────────── */
        <div className="space-y-4">
          {clientGroups.map(([clientId, plans]) => {
            const name = clientName.get(clientId) ?? clientId;
            const draft = plans.find((p) => (p.status ?? p._bucket) === "draft");
            const rest = plans.filter((p) => p !== draft);

            return (
              <Card key={clientId} className="overflow-hidden">
                <CardHeader className="py-3 px-4 bg-muted/20 border-b flex-row items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <Link
                      href={`/clients/${clientId}`}
                      className="font-semibold text-base hover:underline truncate"
                    >
                      {name}
                    </Link>
                    {name !== clientId && (
                      <span className="font-mono text-xs text-muted-foreground shrink-0">
                        {clientId}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="outline" className="text-xs">
                      {plans.length} plan{plans.length !== 1 ? "s" : ""}
                    </Badge>
                  </div>
                </CardHeader>

                <CardContent className="p-0">
                  {/* Current draft — shown prominently */}
                  {draft && (
                    <div className="flex items-center gap-3 px-4 py-3 border-b bg-yellow-50/60 dark:bg-yellow-950/20">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-semibold text-yellow-700 dark:text-yellow-400 uppercase tracking-wide">
                            Active draft
                          </span>
                          <span className="font-mono text-xs text-muted-foreground truncate">
                            {draft.slug}
                          </span>
                          {draft.plan_period_start && (
                            <span className="text-xs text-muted-foreground">
                              · from {draft.plan_period_start}
                            </span>
                          )}
                        </div>
                      </div>
                      <Link href={`/plans/${draft.slug}`} className="shrink-0">
                        <Button size="sm">✏️ Edit draft</Button>
                      </Link>
                    </div>
                  )}

                  {/* Other plans */}
                  {rest.length > 0 && (
                    <div className="divide-y">
                      {rest.map((p) => {
                        const st = p.status ?? p._bucket ?? "";
                        return (
                          <div key={p.slug} className="flex items-center gap-3 px-4 py-2.5">
                            <div className="flex-1 min-w-0 flex items-center gap-3 flex-wrap">
                              <span
                                className={`text-[11px] font-medium px-2 py-0.5 rounded border ${statusColor(st)}`}
                              >
                                {st}
                              </span>
                              <Link
                                href={`/plans/${p.slug}`}
                                className="font-mono text-xs text-muted-foreground hover:underline truncate"
                              >
                                {p.slug}
                              </Link>
                              {p.plan_period_start && (
                                <span className="text-xs text-muted-foreground">
                                  {p.plan_period_start}
                                </span>
                              )}
                              {p.version && (
                                <span className="text-xs text-muted-foreground">v{p.version}</span>
                              )}
                            </div>
                            <Link href={`/plans/${p.slug}`} className="shrink-0">
                              <Button size="sm" variant="ghost" className="text-xs h-7">
                                View →
                              </Button>
                            </Link>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* No plans at all after filter */}
                  {!draft && rest.length === 0 && (
                    <div className="px-4 py-3 text-sm text-muted-foreground">
                      No plans match the current filter.
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}

          {/* Plans without a client_id */}
          {noClientPlans.length > 0 && (
            <Card>
              <CardHeader className="py-3 px-4 bg-muted/20 border-b">
                <CardTitle className="text-sm text-muted-foreground">
                  Unassigned plans ({noClientPlans.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0 divide-y">
                {noClientPlans.map((p) => {
                  const st = p.status ?? p._bucket ?? "";
                  return (
                    <div key={p.slug} className="flex items-center gap-3 px-4 py-2.5">
                      <span className={`text-[11px] font-medium px-2 py-0.5 rounded border ${statusColor(st)}`}>
                        {st}
                      </span>
                      <Link href={`/plans/${p.slug}`} className="font-mono text-xs hover:underline flex-1">
                        {p.slug}
                      </Link>
                      <Link href={`/plans/${p.slug}`}>
                        <Button size="sm" variant="ghost" className="text-xs h-7">View →</Button>
                      </Link>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
