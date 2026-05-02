import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PlanStatusBadge } from "@/components/plan-status-badge";
import { loadPlanBySlug } from "@/lib/fmdb/loader";

export const dynamic = "force-dynamic";

function ChipList({ items }: { items?: string[] }) {
  if (!items || items.length === 0) {
    return <p className="text-sm text-muted-foreground italic">None</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((it) => (
        <Badge key={it} variant="secondary" className="font-mono text-xs">
          {it}
        </Badge>
      ))}
    </div>
  );
}

export default async function PlanDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const plan = await loadPlanBySlug(slug);
  if (!plan) notFound();

  return (
    <div className="space-y-6 max-w-4xl">
      <Link
        href="/plans"
        className="text-sm text-muted-foreground hover:underline"
      >
        ← Back to plans
      </Link>

      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-3xl font-bold">{plan.slug}</h1>
        <PlanStatusBadge status={plan.status ?? plan._bucket} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Overview</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">Client</div>
            <div className="font-mono">{plan.client_id ?? "—"}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Version</div>
            <div>{plan.version ?? "—"}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Period start</div>
            <div>{plan.plan_period_start ?? "—"}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Recheck</div>
            <div>{plan.plan_period_recheck_date ?? "—"}</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Topics</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="text-xs text-muted-foreground mb-1">Primary</div>
            <ChipList items={plan.primary_topics} />
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">
              Contributing
            </div>
            <ChipList items={plan.contributing_topics} />
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">
              Presenting symptoms
            </div>
            <ChipList items={plan.presenting_symptoms} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Raw plan</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="text-xs bg-muted/40 p-4 rounded-md overflow-x-auto max-h-[600px]">
            {JSON.stringify(plan, null, 2)}
          </pre>
        </CardContent>
      </Card>

      {/* TODO(next-turn): structured editor; supplement-protocol / lifestyle / nutrition / education / labs / referrals / tracking sections; plan-check sidebar. */}
    </div>
  );
}
