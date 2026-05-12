/**
 * /clients-v2/[id]/plan/edit/[slug] — Phase 4.5 v2 plan editor.
 *
 * Mounts the existing v1 PlanEditor + PlanCheckPanel components inside
 * the v2 shell (PlanPageShell + FmAppShell). The editor is 2,200+ lines
 * of self-contained React (10 collapsible sections, plan-chat, lifecycle
 * panel) — rebuilding it natively in v2 chrome would be wasteful;
 * wrapping is the cheap migration.
 *
 * Security guard: the slug must belong to the client_id in the URL.
 * Otherwise a v2 surface could deep-link to another client's plan via
 * URL manipulation. Returns 404 on mismatch.
 *
 * "Edit in classic" CTAs across v2 surfaces now point here instead of
 * legacy /plans/[slug] — closes the workflow loop without leaving v2.
 */
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  loadAllOfKind,
  loadAllPlans,
  loadAllClients,
  loadPlanBySlug,
} from "@/lib/fmdb/loader";
import { getResourcesRoot } from "@/lib/fmdb/paths";
import type {
  CookingAdjustment,
  HomeRemedy,
  Mechanism,
  Supplement,
  Symptom,
  Topic,
} from "@/lib/fmdb/types";
import type { MultiSelectOption } from "@/components/multi-select";
import { PlanEditor } from "@/app/plans/[slug]/plan-editor";
import { PlanCheckPanel } from "@/app/plans/[slug]/plan-check-panel";
import { FloatingChatBubble } from "./floating-chat-bubble";
import { DeletePlanButton } from "@/app/plans/[slug]/delete-plan-button";
import { SendToClientButton } from "@/app/plans/[slug]/send-to-client-modal";
import { loadSupplementSources } from "@/app/plans/[slug]/actions";
import { PlanStatusBadge } from "@/components/plan-status-badge";
import { PlanPageShell } from "../../plan-page-shell";

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
  items: T[],
): MultiSelectOption[] {
  return items
    .map((i) => ({ value: i.slug, label: i.display_name ?? i.slug }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export default async function V2PlanEditorPage({
  params,
}: {
  params: Promise<{ id: string; slug: string }>;
}) {
  const { id, slug } = await params;

  const plan = await loadPlanBySlug(slug);
  if (!plan) notFound();

  // Cross-client guard: the URL claims this plan belongs to <id>; refuse
  // to render if the plan's actual client_id doesn't match. Returns 404
  // rather than redirecting so we don't leak the real client_id.
  if (plan.client_id && plan.client_id !== id) {
    notFound();
  }

  const [
    topics,
    symptoms,
    mechanisms,
    supplements,
    cooking,
    remedies,
    resources,
    allPlans,
    supplementSources,
    allClients,
  ] = await Promise.all([
    loadAllOfKind<Topic>("topics"),
    loadAllOfKind<Symptom>("symptoms"),
    loadAllOfKind<Mechanism>("mechanisms"),
    loadAllOfKind<Supplement>("supplements"),
    loadAllOfKind<CookingAdjustment>("cooking_adjustments"),
    loadAllOfKind<HomeRemedy>("home_remedies"),
    loadResourceOptions(),
    loadAllPlans(),
    loadSupplementSources(),
    loadAllClients(),
  ]);

  const allPlanSlugs = allPlans.map((p) => p.slug).sort();
  const planClient = plan.client_id
    ? allClients.find((c) => c.client_id === plan.client_id)
    : undefined;

  const status = plan.status ?? plan._bucket;
  const locked = status !== "draft";

  // Strip loader-only fields so they don't leak into the RSC boundary.
  const { _bucket, _file, ...editable } = plan;
  void _bucket;
  void _file;

  return (
    <PlanPageShell clientId={id}>
      {/* Header row: back to v2 plan tab + plan slug + status + actions */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 16,
        }}
      >
        <Link
          href={`/clients-v2/${id}/plan`}
          style={{
            fontSize: 11.5,
            color: "var(--fm-text-secondary)",
            textDecoration: "none",
            padding: "4px 10px",
            background: "var(--fm-surface)",
            border: "1px solid var(--fm-border)",
            borderRadius: "var(--fm-radius-sm)",
          }}
        >
          ← Plan tab
        </Link>
        <div
          style={{
            fontFamily: "var(--fm-font-mono)",
            fontSize: 13,
            fontWeight: 700,
            color: "var(--fm-text-primary)",
            wordBreak: "break-all",
          }}
        >
          {plan.slug}
        </div>
        <PlanStatusBadge status={status} />
        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            gap: 8,
            alignItems: "center",
          }}
        >
          <SendToClientButton
            planSlug={plan.slug}
            clientId={plan.client_id}
            clientEmail={planClient?.email}
            clientName={planClient?.display_name ?? planClient?.client_id}
          />
          <DeletePlanButton slug={plan.slug} status={status} />
        </div>
      </div>

      {/* 2-col layout — editor on left, plan-check on right. Mirrors v1
          /plans/<slug> exactly. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 320px",
          gap: 24,
          alignItems: "start",
        }}
      >
        <div style={{ minWidth: 0, maxWidth: "100%" }}>
          <PlanEditor
            plan={editable}
            topicOptions={toOptions(topics)}
            symptomOptions={toOptions(symptoms)}
            mechanismOptions={toOptions(mechanisms)}
            supplementOptions={toOptions(supplements)}
            cookingOptions={toOptions(cooking)}
            remedyOptions={toOptions(remedies)}
            resourceOptions={resources}
            supplementSources={supplementSources}
            locked={locked}
            clientId={plan.client_id as string | undefined}
            lifecycleProps={{
              status: status as typeof plan.status,
              version: plan.version,
              catalogueSnapshot:
                (plan.catalogue_snapshot as
                  | { git_sha?: string; snapshot_date?: string }
                  | undefined) ?? null,
              statusHistory:
                (plan.status_history as Array<{
                  state?: string;
                  by?: string;
                  at?: string;
                  reason?: string;
                }>) ?? [],
              supersedes: plan.supersedes as string | undefined,
              allPlanSlugs,
            }}
          />
        </div>
        <aside>
          <PlanCheckPanel slug={plan.slug} />
        </aside>
      </div>

      {/* Floating AI chat — bottom-right bubble. Hidden on
          published / superseded / revoked plans (those are
          read-only; the chat would just error). On drafts it
          stays available while the coach scrolls anywhere in
          the editor. */}
      <FloatingChatBubble
        slug={plan.slug}
        clientId={id}
        isLocked={locked}
      />
    </PlanPageShell>
  );
}
