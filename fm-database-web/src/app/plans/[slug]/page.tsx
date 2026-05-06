import Link from "next/link";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { notFound } from "next/navigation";
import { PlanStatusBadge } from "@/components/plan-status-badge";
import { loadAllOfKind, loadAllPlans, loadPlanBySlug } from "@/lib/fmdb/loader";
import { getResourcesRoot } from "@/lib/fmdb/paths";
import type {
  CookingAdjustment,
  HomeRemedy,
  Mechanism,
  Supplement,
  Symptom,
  Topic,
} from "@/lib/fmdb/types";
import { PlanEditor } from "./plan-editor";
import { PlanCheckPanel } from "./plan-check-panel";
import { LifecyclePanel } from "./lifecycle-panel";
import type { MultiSelectOption } from "@/components/multi-select";

export const dynamic = "force-dynamic";

interface ResourceLite {
  slug: string;
  title?: string;
}

async function loadResourceOptions(): Promise<MultiSelectOption[]> {
  const dir = path.join(getResourcesRoot(), "resources");
  let entries: string[] = [];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out: MultiSelectOption[] = [];
  for (const e of entries) {
    if (!e.endsWith(".yaml") && !e.endsWith(".yml")) continue;
    try {
      const raw = await fs.readFile(path.join(dir, e), "utf-8");
      const r = yaml.load(raw) as ResourceLite | null;
      if (r?.slug) out.push({ value: r.slug, label: r.title ?? r.slug });
    } catch {
      // skip
    }
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

function toOptions<T extends { slug: string; display_name?: string }>(
  items: T[]
): MultiSelectOption[] {
  return items
    .map((i) => ({ value: i.slug, label: i.display_name ?? i.slug }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export default async function PlanDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const plan = await loadPlanBySlug(slug);
  if (!plan) notFound();

  const [topics, symptoms, mechanisms, supplements, cooking, remedies, resources, allPlans] =
    await Promise.all([
      loadAllOfKind<Topic>("topics"),
      loadAllOfKind<Symptom>("symptoms"),
      loadAllOfKind<Mechanism>("mechanisms"),
      loadAllOfKind<Supplement>("supplements"),
      loadAllOfKind<CookingAdjustment>("cooking_adjustments"),
      loadAllOfKind<HomeRemedy>("home_remedies"),
      loadResourceOptions(),
      loadAllPlans(),
    ]);
  const allPlanSlugs = allPlans.map((p) => p.slug).sort();

  const status = plan.status ?? plan._bucket;
  const locked = status !== "draft";

  // Strip the loader-only fields so they don't leak into the client snapshot
  // sent across the RSC boundary.
  const { _bucket, _file, ...editable } = plan;
  void _bucket;
  void _file;

  return (
    <div className="space-y-6">
      <Link
        href="/plans"
        className="text-sm text-muted-foreground hover:underline"
      >
        ← Back to plans
      </Link>

      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-3xl font-bold">{plan.slug}</h1>
        <PlanStatusBadge status={status} />
        <span className="text-sm text-muted-foreground font-mono">
          {plan.client_id ?? "—"}
        </span>
      </div>

      <LifecyclePanel
        slug={plan.slug}
        status={status as typeof plan.status}
        version={plan.version}
        catalogueSnapshot={
          (plan.catalogue_snapshot as { git_sha?: string; snapshot_date?: string } | undefined) ?? null
        }
        statusHistory={
          (plan.status_history as Array<{
            state?: string;
            by?: string;
            at?: string;
            reason?: string;
          }>) ?? []
        }
        supersedes={plan.supersedes as string | undefined}
        allPlanSlugs={allPlanSlugs}
      />

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-6 items-start">
        <div className="min-w-0 max-w-5xl">
          <PlanEditor
            plan={editable}
            topicOptions={toOptions(topics)}
            symptomOptions={toOptions(symptoms)}
            mechanismOptions={toOptions(mechanisms)}
            supplementOptions={toOptions(supplements)}
            cookingOptions={toOptions(cooking)}
            remedyOptions={toOptions(remedies)}
            resourceOptions={resources}
            locked={locked}
          />
        </div>
        <aside>
          <PlanCheckPanel slug={plan.slug} />
        </aside>
      </div>
    </div>
  );
}
