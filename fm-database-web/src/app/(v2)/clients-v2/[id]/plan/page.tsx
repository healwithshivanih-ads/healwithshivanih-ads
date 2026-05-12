/**
 * /clients-v2/[id]/plan — Phase 4 Plan tab in v2.
 *
 * Dashboard + send hub view. NOT the editor — the 10-tab editor stays at
 * legacy /plans/[slug] for now (Phase 4.5). This view is what the coach
 * lands on after a Full Assessment generates a draft, and is the sticky
 * surface for letter sending + lifecycle navigation.
 *
 * Layout:
 *   - Client identity strip + 5-tab subnav (PlanPageShell)
 *   - Workflow stage banner (no_plan / draft / active / recheck)
 *   - Active plan card (status badge, version, plan period, status history)
 *   - 2-col body:
 *       LEFT  — plan summary (drivers, topics, supplements, practices, labs,
 *               education, notes_for_coach) — read-only digest
 *       RIGHT — Send letters panel (when published), Edit in classic deeplink,
 *               supersedes link, list of archived plans
 *   - No-plan empty state with CTA → /clients-v2/[id]/analyse/full
 */
import Link from "next/link";
import { loadClientById } from "@/lib/fmdb/loader-extras";
import { loadAllPlans } from "@/lib/fmdb/loader";
import { loadCatalogueChipDict } from "@/lib/fmdb/catalogue-chip-dict";
// Letter send history moved to Communicate tab — single source of truth
// for all client comms. Plan tab no longer reads the send log.
import { getLetterStalenessAction } from "@/app/plans/[slug]/lifecycle-actions";
import type { Plan, PlanStatus } from "@/lib/fmdb/types";

const PLAN_STATUSES = new Set<PlanStatus>([
  "draft",
  "ready_to_publish",
  "published",
  "superseded",
  "revoked",
]);

function asPlanStatus(s: string | undefined): PlanStatus | undefined {
  return s && PLAN_STATUSES.has(s as PlanStatus) ? (s as PlanStatus) : undefined;
}
import { PlanStatusBadge } from "@/components/plan-status-badge";
import {
  FmPanel,
  FmWorkflowBanner,
  FmCoachNotes,
  FmSupplementGrid,
  FmRecheckPanel,
  FmNutritionPanel,
} from "@/components/fm";
import type { FmWorkflowStage } from "@/components/fm";
import { PlanPageShell } from "./plan-page-shell";
// Letters live on Communicate now — single source of truth.
import { PlanChatAndPreview } from "./plan-chat-and-preview";
import { ReworkBanner } from "@/app/clients/[id]/rework-banner";
import { AttachedProtocolsPanel } from "./attached-protocols-panel";
import { FollowUpPanel } from "./follow-up-panel";
import { ActivateDraftButton } from "./activate-draft-button";
import { RegenerateStaleButton } from "../communicate/regenerate-stale-button";
import { loadAllOfKind } from "@/lib/fmdb/loader";

export const dynamic = "force-dynamic";

const ACTIVE_STATUSES = new Set(["draft", "ready_to_publish", "published"]);

interface PlanSummaryItem {
  label: string;
  detail?: string;
}

function planStatusOf(p: Plan): string {
  return (p.status as string | undefined) ?? p._bucket ?? "draft";
}

function planVersionOf(p: Plan): number {
  return (p.version as number | undefined) ?? 1;
}

function pretty(slug: string): string {
  return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Extract a short display-friendly digest from any unknown[] plan-section. */
function summariseSection(
  items: unknown[] | undefined,
  pickLabel: (it: Record<string, unknown>) => string | undefined,
  pickDetail?: (it: Record<string, unknown>) => string | undefined,
): PlanSummaryItem[] {
  if (!Array.isArray(items)) return [];
  const out: PlanSummaryItem[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const it = raw as Record<string, unknown>;
    const label = pickLabel(it);
    if (!label) continue;
    out.push({ label, detail: pickDetail ? pickDetail(it) : undefined });
  }
  return out;
}

function Chip({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "primary";
}) {
  const styles =
    tone === "primary"
      ? {
          background: "rgba(255, 107, 53, 0.10)",
          color: "var(--fm-primary)",
          border: "1px solid transparent",
        }
      : {
          background: "var(--fm-bg-cool)",
          color: "var(--fm-text-secondary)",
          border: "1px solid var(--fm-border-light)",
        };
  return (
    <span
      style={{
        ...styles,
        display: "inline-block",
        padding: "3px 9px",
        borderRadius: "var(--fm-radius-pill)",
        fontSize: 11,
        fontWeight: 600,
        marginRight: 5,
        marginBottom: 5,
      }}
    >
      {children}
    </span>
  );
}

function ChipList({
  items,
  tone,
}: {
  items: string[];
  tone?: "neutral" | "primary";
}) {
  if (items.length === 0) {
    return (
      <span style={{ fontSize: 12, color: "var(--fm-text-tertiary)" }}>—</span>
    );
  }
  return (
    <div style={{ display: "flex", flexWrap: "wrap", marginTop: 4 }}>
      {items.map((s, i) => (
        <Chip key={`${s}-${i}`} tone={tone}>
          {s}
        </Chip>
      ))}
    </div>
  );
}

function MiniLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 10,
        textTransform: "uppercase",
        letterSpacing: 0.6,
        fontWeight: 700,
        color: "var(--fm-text-tertiary)",
        marginTop: 2,
      }}
    >
      {children}
    </div>
  );
}

function deriveStage(
  activePlan: Plan | undefined,
  todayStr: string,
  clientId: string,
): {
  stage: FmWorkflowStage;
  title: React.ReactNode;
  detail?: React.ReactNode;
  cta?: React.ReactNode;
  ctaHref?: string;
} {
  if (!activePlan) {
    return {
      stage: "no_plan",
      title: "No plan on file",
      detail: "Run a Full Assessment to draft one.",
      cta: "Start full assessment",
      ctaHref: undefined,
    };
  }
  const status = planStatusOf(activePlan);
  if (status === "draft" || status === "ready_to_publish") {
    return {
      stage: "draft",
      title: `Plan in ${status.replace(/_/g, " ")}`,
      detail:
        "Activate below to publish + send letters. Open the editor first if you want to tweak any sections.",
      cta: "Open editor",
      ctaHref: `/clients-v2/${clientId}/plan/edit/${activePlan.slug}`,
    };
  }
  if (status === "published") {
    let recheckDate: string | undefined = activePlan.plan_period_recheck_date;
    if (
      !recheckDate &&
      activePlan.plan_period_start &&
      activePlan.plan_period_weeks
    ) {
      const d = new Date(`${activePlan.plan_period_start}T00:00:00`);
      d.setDate(d.getDate() + activePlan.plan_period_weeks * 7);
      recheckDate = d.toISOString().slice(0, 10);
    }
    if (recheckDate && recheckDate < todayStr) {
      // Point at the in-page Follow-up panel (carries forward the prior
      // plan + AI adjustments) rather than a blank Full Assessment. The
      // anchor id is set on the FollowUpPanel wrapper below.
      return {
        stage: "recheck",
        title: "Re-check due",
        detail: `Protocol ended ${recheckDate} · generate a follow-up plan ↓`,
        cta: "Go to follow-up panel",
        ctaHref: "#follow-up-panel",
      };
    }
    return {
      stage: "active",
      title: `Plan active — ${activePlan.slug}`,
      detail: recheckDate
        ? `Next follow-up ${recheckDate}.`
        : "Letters can go out now.",
      cta: "Generate letters",
      ctaHref: `/clients-v2/${clientId}/communicate`,
    };
  }
  return {
    stage: "no_plan",
    title: "No active plan",
    detail: "Latest plan is archived. Start a new Full Assessment.",
    cta: "New full assessment",
    ctaHref: undefined,
  };
}

export default async function PlanTabPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [client, allPlans, catalogueChips, allProtocols] = await Promise.all([
    loadClientById(id),
    loadAllPlans(),
    loadCatalogueChipDict(),
    loadAllOfKind<{ slug: string; display_name?: string; category?: string; summary?: string }>("protocols"),
  ]);
  if (!client) {
    return (
      <PlanPageShell clientId={id}>
        <div />
      </PlanPageShell>
    );
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const plans = allPlans.filter((p) => p.client_id === id);
  // Pick the "active" plan with this precedence:
  //   1. published   (the protocol that's actually live with the client)
  //   2. ready_to_publish
  //   3. draft       (only when nothing is live yet)
  // Within a status tier, latest by version then updated_at wins.
  //
  // Before this fix the Plan tab showed whichever active-bucket plan came
  // first from disk — so a fresh AI draft would visually replace the
  // currently-published plan, making the coach think her active protocol
  // had been silently rewritten. Bug surfaced after re-running assess on
  // Geetika (cl-006); plan-1 (published) is the live protocol but plan-2
  // (newly generated draft) was rendering as the headline plan.
  const STATUS_PRIORITY: Record<string, number> = {
    published: 3,
    ready_to_publish: 2,
    draft: 1,
  };
  const activeSorted = plans
    .filter((p) => ACTIVE_STATUSES.has(planStatusOf(p)))
    .sort((a, b) => {
      const dp = (STATUS_PRIORITY[planStatusOf(b)] ?? 0) - (STATUS_PRIORITY[planStatusOf(a)] ?? 0);
      if (dp !== 0) return dp;
      const dv = planVersionOf(b) - planVersionOf(a);
      if (dv !== 0) return dv;
      return ((b.updated_at ?? "") as string).localeCompare(
        (a.updated_at ?? "") as string,
      );
    });
  const activePlan = activeSorted[0];
  // Letter staleness — compares each saved letter mtime to plan.updated_at.
  // Only runs when we have a plan; cheap (per-letter fs.stat).
  const staleness = activePlan
    ? await getLetterStalenessAction(activePlan.slug as string, id)
    : null;
  // If a separate draft exists alongside a published plan, call it out
  // so the coach knows there's an in-progress next version.
  const pendingDraft = activePlan && planStatusOf(activePlan) === "published"
    ? activeSorted.find(
        (p) =>
          p !== activePlan &&
          (planStatusOf(p) === "draft" || planStatusOf(p) === "ready_to_publish"),
      )
    : undefined;
  const archivedPlans = plans
    .filter((p) => p !== activePlan && p !== pendingDraft)
    .sort((a, b) =>
      (planVersionOf(b) - planVersionOf(a)) ||
      ((b.updated_at ?? "") as string).localeCompare(
        (a.updated_at ?? "") as string,
      ),
    );

  const stage = deriveStage(activePlan, todayStr, id);
  const status = activePlan ? planStatusOf(activePlan) : undefined;
  const isPublished = status === "published";

  // Recheck context — used by FmRecheckPanel when stage === "recheck".
  let recheckDate: string | undefined =
    activePlan?.plan_period_recheck_date as string | undefined;
  if (
    !recheckDate &&
    activePlan?.plan_period_start &&
    activePlan?.plan_period_weeks
  ) {
    const d = new Date(`${activePlan.plan_period_start}T00:00:00`);
    d.setDate(d.getDate() + (activePlan.plan_period_weeks as number) * 7);
    recheckDate = d.toISOString().slice(0, 10);
  }
  // Auto-detection signals for the recheck panel:
  //   - hasFreshAssessment: at least one Full Assessment with synthesis
  //     notes recorded AFTER the recheck date
  //   - freshLabSnapshots: count of lab snapshots dated after the
  //     recheck date
  const sessionsAfterRecheck = recheckDate
    ? (
        (client as unknown as Record<string, unknown>).health_snapshots as
          | Array<{ date?: string; lab_values?: unknown[] }>
          | undefined
      ) ?? []
    : [];
  const freshLabSnapshots = sessionsAfterRecheck.filter(
    (s) =>
      s.date &&
      recheckDate &&
      s.date > recheckDate &&
      Array.isArray(s.lab_values) &&
      s.lab_values.length > 0,
  ).length;
  const hasFreshAssessment = !!pendingDraft;

  // Follow-up plan: suggest the next slug by bumping the plan number
  // embedded in the active slug. Pattern from generate-draft.py is
  // `<first-name>-plan-N-YYYY-MM-DD-<client-id>`. Falls back to a
  // generic `<slug>-followup-<today>` when the pattern doesn't match,
  // so a published plan with an unconventional slug still gets a
  // sensible suggestion.
  let suggestedFollowUpSlug = "";
  if (activePlan) {
    const m = (activePlan.slug as string).match(
      /^(.*?)-plan-(\d+)-\d{4}-\d{2}-\d{2}-(.+)$/,
    );
    if (m) {
      const [, namePart, nStr, clientPart] = m;
      const n = Number.parseInt(nStr, 10);
      suggestedFollowUpSlug = `${namePart}-plan-${n + 1}-${todayStr}-${clientPart}`;
    } else {
      suggestedFollowUpSlug = `${activePlan.slug}-followup-${todayStr}`;
    }
  }
  const followUpOverdue = !!(recheckDate && recheckDate < todayStr);

  // Plan summary digest (only meaningful when activePlan exists). Supplements
  // are now passed full-shape to FmSupplementGrid (timing bubble + detail).
  const supplementItems = (activePlan?.supplement_protocol as
    | Array<Record<string, unknown>>
    | undefined) ?? [];
  const supplementGridItems = supplementItems
    .filter((it): it is Record<string, unknown> => !!it && typeof it === "object")
    .map((it) => ({
      supplement_slug: (it.supplement_slug as string | undefined) ?? "",
      dose: (it.dose as string | undefined) ?? "",
      timing: (it.timing as string | undefined) ?? "",
      form: (it.form as string | undefined) ?? "",
      coach_rationale: (it.coach_rationale as string | undefined) ?? "",
      duration_weeks:
        typeof it.duration_weeks === "number" ? it.duration_weeks : null,
    }))
    .filter((it) => it.supplement_slug);

  const practices = activePlan
    ? summariseSection(
        activePlan.lifestyle_practices,
        (it) => it.name as string | undefined,
        (it) => it.cadence as string | undefined,
      )
    : [];

  // Lab orders split into "new" (order now) and "repeat" (re-check on file).
  // Pre-AI plans didn't have `kind`; default to "new" for backward compat.
  function labKind(it: Record<string, unknown>): "new" | "repeat" {
    return it.kind === "repeat" ? "repeat" : "new";
  }
  function labDueText(it: Record<string, unknown>): string | undefined {
    const w = it.due_in_weeks;
    return typeof w === "number" && w > 0 ? `re-test in ${w} wks` : undefined;
  }
  function labDetail(it: Record<string, unknown>): string | undefined {
    const reason = it.reason as string | undefined;
    const due = labDueText(it);
    return [due, reason].filter(Boolean).join(" — ");
  }
  const rawLabOrders = (activePlan?.lab_orders as Array<Record<string, unknown>> | undefined) ?? [];
  const newLabs = rawLabOrders
    .filter((it) => labKind(it) === "new")
    .map((it) => ({
      label: (it.test as string) ?? "",
      detail: it.reason as string | undefined,
    }))
    .filter((x) => x.label);
  const repeatLabs = rawLabOrders
    .filter((it) => labKind(it) === "repeat")
    .map((it) => ({ label: (it.test as string) ?? "", detail: labDetail(it) }))
    .filter((x) => x.label);
  // Total used in section header — kept inline; legacy `labs` removed below.

  const referrals = activePlan
    ? summariseSection(
        activePlan.referrals,
        (it) => it.to as string | undefined,
        (it) => {
          const urgency = it.urgency as string | undefined;
          const reason = it.reason as string | undefined;
          return [urgency, reason].filter(Boolean).join(" · ");
        },
      )
    : [];

  const education = activePlan
    ? summariseSection(
        activePlan.education,
        (it) => (it.target_slug as string) ?? (it.target_kind as string),
        (it) => it.client_facing_summary as string | undefined,
      )
    : [];

  const drivers = activePlan
    ? summariseSection(
        activePlan.hypothesized_drivers,
        (it) => it.mechanism as string | undefined,
        (it) => it.reasoning as string | undefined,
      )
    : [];

  const primaryTopics = (activePlan?.primary_topics ?? []) as string[];
  const contributingTopics = (activePlan?.contributing_topics ?? []) as string[];
  const presentingSymptoms = (activePlan?.presenting_symptoms ?? []) as string[];
  const notesForCoach = (activePlan?.notes_for_coach as string | undefined) ?? "";
  const planPeriodWeeks = activePlan?.plan_period_weeks;
  // Plan timeline dates — already on disk, surfaced here so the coach can
  // see when the AI generated the draft / when it went live / when the
  // last edit landed without inspecting the YAML directly.
  function fmtDateOnly(s: string | undefined): string | undefined {
    if (!s) return undefined;
    try {
      const d = new Date(s);
      if (Number.isNaN(d.getTime())) return s;
      return d.toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    } catch {
      return s;
    }
  }
  const planCreatedAt = fmtDateOnly(activePlan?.created_at as string | undefined);
  const planUpdatedAt = fmtDateOnly(activePlan?.updated_at as string | undefined);
  // first "published" entry in status_history → when the plan went live
  const publishedEvent = (
    (activePlan?.status_history as Array<Record<string, unknown>> | undefined) ?? []
  ).find((ev) => ev.state === "published");
  const planPublishedAt = fmtDateOnly(
    publishedEvent?.at as string | undefined,
  );
  const planPeriodStart = activePlan?.plan_period_start;
  const supersedes = activePlan?.supersedes as string | undefined;
  const statusHistory =
    (activePlan?.status_history as Array<Record<string, unknown>> | undefined) ??
    [];

  return (
    <PlanPageShell clientId={id}>
      {client.rework_suggestion && (
        <div style={{ marginBottom: 12 }}>
          <ReworkBanner clientId={id} suggestion={client.rework_suggestion} />
        </div>
      )}

      {/* Workflow stage banner */}
      <FmWorkflowBanner
        stage={stage.stage}
        title={stage.title}
        detail={stage.detail}
        cta={stage.cta}
        ctaHref={
          stage.ctaHref ??
          (stage.stage === "no_plan" || stage.stage === "recheck"
            ? `/clients-v2/${id}/analyse/full`
            : undefined)
        }
      />

      {/* Inline Activate row — one-click submit + publish for draft /
          ready_to_publish plans. Stays on the v2 surface; no detour to
          /plans/<slug> Lifecycle tab. */}
      {stage.stage === "draft" && activePlan && (
        <div
          style={{
            marginTop: 12,
            padding: "10px 14px",
            background: "rgba(20, 83, 45, 0.05)",
            border: "1.5px solid rgba(20, 83, 45, 0.3)",
            borderRadius: "var(--fm-radius-md)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ fontSize: 12, color: "var(--fm-text-secondary)" }}>
            Plan-check runs automatically — if anything blocks publish,
            you&rsquo;ll get a clear toast.
          </div>
          <ActivateDraftButton
            planSlug={activePlan.slug as string}
            status={planStatusOf(activePlan)}
          />
        </div>
      )}

      {/* Letter-staleness banner — plan was edited after letters were saved. */}
      {staleness?.anyStale && activePlan && (
        <div
          style={{
            marginTop: 12,
            padding: "10px 14px",
            background: "rgba(245, 158, 11, 0.08)",
            border: "1.5px solid rgba(245, 158, 11, 0.55)",
            borderRadius: "var(--fm-radius-md)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span style={{ fontSize: 16 }}>📄</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: "#92400e" }}>
                Letters are stale — plan edited after{" "}
                {staleness.staleCount === 1
                  ? "1 saved letter was generated"
                  : `${staleness.staleCount} saved letters were generated`}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "#78350f",
                  marginTop: 2,
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 6,
                }}
              >
                {staleness.entries
                  .filter((e) => e.stale)
                  .map((e) => (
                    <span
                      key={e.type}
                      style={{
                        padding: "1px 6px",
                        background: "rgba(245, 158, 11, 0.15)",
                        borderRadius: 4,
                        fontFamily: "var(--fm-font-mono)",
                      }}
                    >
                      {e.type.replace(/_/g, " ")}
                    </span>
                  ))}
              </div>
            </div>
          </div>
          <RegenerateStaleButton
            planSlug={activePlan.slug as string}
            clientId={id}
            staleTypes={staleness.entries
              .filter((e) => e.stale)
              .map((e) => e.type)}
          />
        </div>
      )}

      {/* Pending-draft callout — only when there's a draft sitting next
          to the published plan. Without this surface the coach has no
          visual cue that a newer AI synthesis exists and is waiting for
          review. */}
      {pendingDraft && (
        <div
          style={{
            marginTop: 12,
            padding: "10px 14px",
            background: "rgba(110, 76, 200, 0.06)",
            border: "1.5px solid rgba(110, 76, 200, 0.35)",
            borderRadius: "var(--fm-radius-md)",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span style={{ fontSize: 18 }}>📋</span>
          <div style={{ flex: 1, minWidth: 0, fontSize: 12 }}>
            <div style={{ fontWeight: 700, color: "#5a3fb0" }}>
              A new draft is waiting for review —{" "}
              <span
                style={{ fontFamily: "var(--fm-font-mono)", fontWeight: 600 }}
              >
                {pendingDraft.slug}
              </span>
            </div>
            <div style={{ color: "var(--fm-text-secondary)", marginTop: 1 }}>
              This card below still shows your <strong>live</strong>{" "}
              published plan. The draft is a candidate next-version generated
              from a recent Full Assessment — review and activate to
              supersede.
            </div>
          </div>
          <Link
            href={`/clients-v2/${id}/plan/edit/${pendingDraft.slug}`}
            style={{
              padding: "7px 14px",
              fontSize: 11.5,
              fontWeight: 700,
              background: "#5a3fb0",
              color: "#fff",
              borderRadius: "var(--fm-radius-sm)",
              textDecoration: "none",
              whiteSpace: "nowrap",
            }}
          >
            Open draft →
          </Link>
        </div>
      )}

      {/* Recheck workflow panel — only when the published plan's period
          is done. Drives the 5-step recheck cycle (order labs → book
          call → confirm measurements → run AI synthesis → activate
          Phase 2). Plan content below dims to anchor focus. */}
      {stage.stage === "recheck" && activePlan && (
        <div style={{ marginTop: 12 }}>
          <FmRecheckPanel
            clientId={id}
            activePlanSlug={activePlan.slug}
            recheckDate={recheckDate}
            pendingDraftSlug={pendingDraft?.slug}
            hasFreshAssessment={hasFreshAssessment}
            freshLabSnapshots={freshLabSnapshots}
          />
        </div>
      )}

      {!activePlan ? (
        <NoPlanEmpty clientId={id} archivedCount={archivedPlans.length} />
      ) : (
        <div
          className="fm-v2-2col"
          style={{
            marginTop: 16,
            // Dim the plan body when the protocol period is done — the
            // recheck panel above is where focus should land. Still
            // readable, but visually demoted.
            opacity: stage.stage === "recheck" ? 0.65 : 1,
            transition: "opacity 160ms ease",
          }}
        >
          {/* LEFT — active plan details */}
          <div style={{ minWidth: 0, display: "grid", gap: 16 }}>
            {/* AI assistant + client-letter preview (both collapsible).
                Coach asked for an in-tab chat + plan preview; both pull
                from the same legacy plumbing (PlanChatPanel, renderPlan)
                so behaviour matches the classic editor exactly. */}
            <PlanChatAndPreview
              clientId={id}
              // When there's a pending draft sitting next to a published
              // plan, target the DRAFT — that's the editable surface.
              // The published plan stays untouched. Without this, the
              // chat would aim at the published plan, the server action
              // would refuse the write ("only draft + ready_to_publish
              // can be edited"), and the coach would just see a toast.
              planSlug={pendingDraft ? (pendingDraft.slug as string) : activePlan.slug}
              isLocked={
                // Lock when there's NO editable plan in scope:
                //   - active plan is published AND no pending draft exists
                //   - active plan is archived (superseded / revoked)
                (status === "published" && !pendingDraft) ||
                status === "superseded" ||
                status === "revoked"
              }
              lockReason={
                status === "published" && !pendingDraft
                  ? "published"
                  : status === "superseded" || status === "revoked"
                    ? "archived"
                    : undefined
              }
              createDraftHref={
                status === "published" && !pendingDraft
                  ? "#follow-up-panel"
                  : undefined
              }
              draftTargetNote={
                pendingDraft && status === "published"
                  ? `Editing pending draft ${pendingDraft.slug} — the published plan stays untouched until you publish this one in its place.`
                  : undefined
              }
            />

            {/* Plan header card */}
            <FmPanel
              title={
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  🗂 {activePlan.slug}
                </span>
              }
              subtitle={
                planPeriodWeeks
                  ? `${planPeriodWeeks}-week protocol${planPeriodStart ? ` · started ${planPeriodStart}` : ""}`
                  : "No plan-period dates set"
              }
              rightSlot={
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                    fontSize: 11,
                  }}
                >
                  <PlanStatusBadge status={asPlanStatus(status)} />
                  <span style={{ color: "var(--fm-text-tertiary)" }}>
                    v{planVersionOf(activePlan)}
                  </span>
                </div>
              }
            >
              {(planCreatedAt || planPublishedAt || planUpdatedAt) && (
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--fm-text-tertiary)",
                    marginBottom: 10,
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 10,
                  }}
                >
                  {planCreatedAt && <span>Generated {planCreatedAt}</span>}
                  {planPublishedAt && (
                    <span>· Published {planPublishedAt}</span>
                  )}
                  {planUpdatedAt && planUpdatedAt !== planCreatedAt && (
                    <span>· Updated {planUpdatedAt}</span>
                  )}
                </div>
              )}
              {supersedes && (
                <div
                  style={{
                    fontSize: 11.5,
                    marginBottom: 10,
                    padding: "6px 10px",
                    background: "var(--fm-bg-cool)",
                    borderRadius: "var(--fm-radius-sm)",
                  }}
                >
                  ↩ Supersedes{" "}
                  <Link
                    href={`/clients-v2/${id}/plan/edit/${supersedes}`}
                    style={{
                      fontFamily: "var(--fm-font-mono)",
                      color: "var(--fm-text-primary)",
                    }}
                  >
                    {supersedes}
                  </Link>{" "}
                  ·{" "}
                  <Link
                    href={`/clients-v2/${id}/plan/edit/${activePlan.slug}`}
                    style={{
                      color: "var(--fm-primary)",
                      fontWeight: 600,
                    }}
                  >
                    Compare versions →
                  </Link>
                </div>
              )}

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 14,
                }}
              >
                <div>
                  <MiniLabel>Primary topics</MiniLabel>
                  <ChipList items={primaryTopics} tone="primary" />
                </div>
                <div>
                  <MiniLabel>Presenting symptoms</MiniLabel>
                  <ChipList items={presentingSymptoms} />
                </div>
                {contributingTopics.length > 0 && (
                  <div style={{ gridColumn: "1 / -1" }}>
                    <MiniLabel>Contributing topics</MiniLabel>
                    <ChipList items={contributingTopics} />
                  </div>
                )}
              </div>
            </FmPanel>

            {/* Attached FM protocol(s) — 5R, AIP, Whole30, etc. */}
            <AttachedProtocolsPanel
              planSlug={activePlan.slug}
              attached={
                (activePlan.attached_protocols as string[] | undefined) ?? []
              }
              allProtocols={allProtocols}
              locked={status !== "draft"}
            />

            {/* Supplements — timing bubble row + click-to-filter detail list.
                Slot classification matches render-client-letter.py exactly
                so the coach view + the client letter bucket the same way. */}
            <FmPanel
              title={`💊 Supplements (${supplementGridItems.length})`}
              subtitle="Daily timing bubbles + the same data the client letter ships. Click a slot to filter; click a row to read the coach rationale."
            >
              <FmSupplementGrid items={supplementGridItems} />
            </FmPanel>

            {/* Nutrition — pattern + add/reduce + meal timing + cooking
                adjustments + home remedies. The 7-day meal grid itself
                lives in the generated client letter. */}
            <FmPanel
              title="🥗 Nutrition guidance"
              subtitle="Pattern · foods to add or reduce · meal timing · cooking + home remedies. 7-day meal grid lives in the client letter."
            >
              <FmNutritionPanel
                nutrition={
                  activePlan.nutrition as
                    | Record<string, unknown>
                    | null
                    | undefined
                }
                planSlug={activePlan.slug}
              />
            </FmPanel>

            {/* Lifestyle */}
            <FmPanel
              title={`🌿 Lifestyle practices (${practices.length})`}
              subtitle="Daily / weekly habits the client commits to."
            >
              {practices.length === 0 ? (
                <EmptyHint>No practices set.</EmptyHint>
              ) : (
                <div style={{ display: "grid", gap: 6 }}>
                  {practices.map((p, i) => (
                    <Row key={`${p.label}-${i}`} label={p.label} detail={p.detail} />
                  ))}
                </div>
              )}
            </FmPanel>

            {/* Labs — split into NEW (order now) and REPEAT (re-check) */}
            {(newLabs.length > 0 || repeatLabs.length > 0) && (
              <FmPanel
                title={`🧪 Labs (${newLabs.length + repeatLabs.length})`}
                subtitle="Lab markers attached to this plan. Repeats are re-checks of values already on file."
              >
                {newLabs.length > 0 && (
                  <div style={{ marginBottom: repeatLabs.length > 0 ? 14 : 0 }}>
                    <div
                      style={{
                        fontSize: 10,
                        textTransform: "uppercase",
                        letterSpacing: 0.6,
                        fontWeight: 700,
                        color: "var(--fm-primary)",
                        marginBottom: 6,
                      }}
                    >
                      🆕 Order fresh ({newLabs.length})
                    </div>
                    <div style={{ display: "grid", gap: 6 }}>
                      {newLabs.map((l, i) => (
                        <Row
                          key={`new-${l.label}-${i}`}
                          label={l.label}
                          detail={l.detail}
                        />
                      ))}
                    </div>
                  </div>
                )}
                {repeatLabs.length > 0 && (
                  <div>
                    <div
                      style={{
                        fontSize: 10,
                        textTransform: "uppercase",
                        letterSpacing: 0.6,
                        fontWeight: 700,
                        color: "var(--fm-text-secondary)",
                        marginBottom: 6,
                      }}
                    >
                      🔁 Re-test on file ({repeatLabs.length})
                    </div>
                    <div style={{ display: "grid", gap: 6 }}>
                      {repeatLabs.map((l, i) => (
                        <Row
                          key={`rep-${l.label}-${i}`}
                          label={l.label}
                          detail={l.detail}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </FmPanel>
            )}

            {/* Referrals */}
            {referrals.length > 0 && (
              <FmPanel title={`👩‍⚕️ Referrals (${referrals.length})`}>
                <div style={{ display: "grid", gap: 6 }}>
                  {referrals.map((r, i) => (
                    <Row key={`${r.label}-${i}`} label={r.label} detail={r.detail} />
                  ))}
                </div>
              </FmPanel>
            )}

            {/* Education modules */}
            {education.length > 0 && (
              <FmPanel
                title={`🎓 Education (${education.length})`}
                subtitle="Topic / mechanism explainers attached to the client letter."
              >
                <div style={{ display: "grid", gap: 6 }}>
                  {education.map((e, i) => (
                    <Row key={`${e.label}-${i}`} label={e.label} detail={e.detail} />
                  ))}
                </div>
              </FmPanel>
            )}

            {/* Drivers */}
            {drivers.length > 0 && (
              <FmPanel
                title={`🧬 Hypothesised drivers (${drivers.length})`}
                subtitle="The mechanisms the AI synthesis identified as upstream root causes."
              >
                <div style={{ display: "grid", gap: 6 }}>
                  {drivers.map((d, i) => (
                    <Row key={`${d.label}-${i}`} label={d.label} detail={d.detail} />
                  ))}
                </div>
              </FmPanel>
            )}

            {/* Notes for coach — auto-sectioned + hazard pull-quotes +
                catalogue chips + show-less/more collapse + print-friendly.
                Replaces the inline <div whiteSpace: pre-wrap> wall of
                text — see Group E1 in the FM Backlog Explorations design. */}
            {notesForCoach.trim() && (
              <FmPanel
                title="📝 Notes for coach"
                subtitle="Private — never appears on client letters."
              >
                <FmCoachNotes
                  text={notesForCoach}
                  planSlug={activePlan.slug}
                  catalogue={catalogueChips}
                />
              </FmPanel>
            )}
          </div>

          {/* RIGHT — send + meta. Sticky + internally scrollable on
              wide viewports; under 1180px the parent grid collapses to
              single-column and the rail un-sticks (handled by the
              .fm-v2-2col-rail CSS class in fm-v2.css). */}
          <div className="fm-v2-2col-rail">
            {/* Quick actions — primary navigation hub. Letters live on
                Communicate (one source of truth); past sessions / plans
                are surfaced via deep-links. */}
            <FmPanel
              title="⚙ Actions"
              subtitle="Edit, preview and ship. Letter sending lives on Communicate."
            >
              <div style={{ display: "grid", gap: 6 }}>
                <ActionLink
                  href={`/clients-v2/${id}/communicate`}
                  icon="📤"
                  label={
                    isPublished
                      ? "Send client letters →"
                      : "Communicate (locks at publish)"
                  }
                />
                <ActionLink
                  href={`/clients-v2/${id}/plan/edit/${activePlan.slug}`}
                  icon="✏️"
                  label="Edit plan"
                />
                <ActionLink
                  href={`/clients-v2/${id}/plan/edit/${activePlan.slug}`}
                  icon="🚀"
                  label="Lifecycle (submit / publish)"
                />
                <ActionLink
                  href={`/clients-v2/${id}/sessions`}
                  icon="🗓"
                  label="Past sessions + analyses"
                />
                <ActionLink
                  href={`/clients-v2/${id}/analyse/full`}
                  icon="🔬"
                  label="Run another full assessment"
                />
              </div>
            </FmPanel>

            {/* Follow-up plan generator — only when the live plan is
                published. Closes the v1/v2 workflow gap: previously the
                coach had to drop into /clients/<id> (v1) to spin up a
                phase-2 successor. */}
            {isPublished && activePlan && (
              <div id="follow-up-panel" style={{ scrollMarginTop: 16 }}>
                <FollowUpPanel
                  activePlanSlug={activePlan.slug}
                  clientId={id}
                  clientName={
                    (client as unknown as { display_name?: string })
                      .display_name
                  }
                  recheckDate={recheckDate}
                  isOverdue={followUpOverdue}
                  suggestedSlug={suggestedFollowUpSlug}
                />
              </div>
            )}

            {/* Letter send history lives on the Communicate tab now —
                all client comms (send + history + clickable letter
                preview) live in one place. */}

            {/* Status history timeline */}
            {statusHistory.length > 0 && (
              <FmPanel
                title="📜 Status history"
                subtitle="Every transition is recorded."
              >
                <div style={{ display: "grid", gap: 6 }}>
                  {[...statusHistory].reverse().map((ev, i) => (
                    <div
                      key={i}
                      style={{
                        fontSize: 11,
                        padding: "5px 8px",
                        borderLeft: "2px solid var(--fm-border)",
                        background: "var(--fm-bg-cool)",
                        borderRadius: "0 var(--fm-radius-sm) var(--fm-radius-sm) 0",
                      }}
                    >
                      <PlanStatusBadge
                        status={asPlanStatus(ev.state as string | undefined)}
                      />{" "}
                      <span style={{ color: "var(--fm-text-tertiary)" }}>
                        {ev.at as string | undefined}
                      </span>
                      {ev.reason ? (
                        <div style={{ marginTop: 2 }}>
                          {ev.reason as string}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </FmPanel>
            )}

            {/* Other / archived plans */}
            {archivedPlans.length > 0 && (
              <FmPanel
                title={`🗄 Other plans (${archivedPlans.length})`}
                subtitle="Earlier or archived plans for this client."
              >
                <div style={{ display: "grid", gap: 6 }}>
                  {archivedPlans.map((p) => (
                    <Link
                      key={p.slug}
                      href={`/clients-v2/${id}/plan/edit/${p.slug}`}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "6px 10px",
                        border: "1px solid var(--fm-border-light)",
                        borderRadius: "var(--fm-radius-sm)",
                        textDecoration: "none",
                        background: "var(--fm-surface)",
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0, fontSize: 11.5 }}>
                        <div
                          style={{
                            fontFamily: "var(--fm-font-mono)",
                            fontWeight: 600,
                            color: "var(--fm-text-primary)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {p.slug}
                        </div>
                        <div
                          style={{
                            fontSize: 10,
                            color: "var(--fm-text-tertiary)",
                            marginTop: 1,
                          }}
                        >
                          v{planVersionOf(p)} ·{" "}
                          {(p.updated_at as string | undefined)?.slice(0, 10) ?? "—"}
                        </div>
                      </div>
                      <PlanStatusBadge status={asPlanStatus(planStatusOf(p))} />
                    </Link>
                  ))}
                </div>
              </FmPanel>
            )}
          </div>
        </div>
      )}
    </PlanPageShell>
  );
}

function ActionLink({
  href,
  icon,
  label,
}: {
  href: string;
  icon: string;
  label: string;
}) {
  return (
    <Link
      href={href}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 10px",
        background: "var(--fm-surface)",
        border: "1px solid var(--fm-border-light)",
        borderRadius: "var(--fm-radius-sm)",
        fontSize: 12,
        fontWeight: 600,
        color: "var(--fm-text-primary)",
        textDecoration: "none",
      }}
    >
      <span style={{ fontSize: 14 }}>{icon}</span>
      {label}
    </Link>
  );
}

function Row({ label, detail }: { label: string; detail?: string }) {
  return (
    <div
      style={{
        padding: "7px 10px",
        background: "var(--fm-surface)",
        border: "1px solid var(--fm-border-light)",
        borderRadius: "var(--fm-radius-sm)",
        fontSize: 12,
      }}
    >
      <div style={{ fontWeight: 700 }}>{pretty(label)}</div>
      {detail && (
        <div
          style={{
            fontSize: 11,
            color: "var(--fm-text-tertiary)",
            marginTop: 2,
            lineHeight: 1.5,
          }}
        >
          {detail}
        </div>
      )}
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11.5,
        color: "var(--fm-text-tertiary)",
        padding: "6px 10px",
        background: "var(--fm-bg-cool)",
        borderRadius: "var(--fm-radius-sm)",
      }}
    >
      {children}
    </div>
  );
}

function NoPlanEmpty({
  clientId,
  archivedCount,
}: {
  clientId: string;
  archivedCount: number;
}) {
  return (
    <FmPanel
      style={{
        marginTop: 16,
        textAlign: "center",
        padding: "40px 24px",
        background: "linear-gradient(135deg, var(--fm-bg-warm), var(--fm-surface) 70%)",
        borderColor: "rgba(255, 107, 53, 0.25)",
        borderWidth: 2,
      }}
    >
      <div style={{ fontSize: 40, marginBottom: 10 }}>🗂</div>
      <h2
        style={{
          fontFamily: "var(--fm-font-display)",
          fontSize: 22,
          fontWeight: 400,
          margin: "0 0 6px",
          letterSpacing: "-0.3px",
          color: "var(--fm-text-primary)",
        }}
      >
        No active plan
      </h2>
      <p
        style={{
          fontSize: 13,
          color: "var(--fm-text-secondary)",
          margin: "0 0 18px",
          lineHeight: 1.55,
          maxWidth: 480,
          marginLeft: "auto",
          marginRight: "auto",
        }}
      >
        Run a Full Assessment — the AI synthesises drivers, supplements and
        next steps from intake + reports, and drops a structured draft into{" "}
        <code>/plans/</code> ready to refine and send.
      </p>
      <Link
        href={`/clients-v2/${clientId}/analyse/full`}
        style={{
          display: "inline-block",
          background: "var(--fm-primary)",
          color: "#fff",
          padding: "10px 20px",
          fontSize: 13,
          fontWeight: 700,
          borderRadius: "var(--fm-radius-sm)",
          textDecoration: "none",
        }}
      >
        🔬 Start full assessment →
      </Link>
      {archivedCount > 0 && (
        <div
          style={{
            fontSize: 11,
            color: "var(--fm-text-tertiary)",
            marginTop: 14,
          }}
        >
          {archivedCount} archived plan{archivedCount === 1 ? "" : "s"} on file
          — review under <em>Other plans</em> below.
        </div>
      )}
    </FmPanel>
  );
}
