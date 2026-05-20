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
import { loadClientById, markCoachTabViewed } from "@/lib/fmdb/loader-extras";
import { loadAllPlans } from "@/lib/fmdb/loader";
import { loadCatalogueChipDict } from "@/lib/fmdb/catalogue-chip-dict";
// Letter send history moved to Communicate tab — single source of truth
// for all client comms. Plan tab no longer reads the send log.
import { getLetterStalenessAction } from "@/lib/server-actions/plan-lifecycle";
import type { Plan, PlanStatus } from "@/lib/fmdb/types";
import { LabsViewPanel } from "./labs-view-panel";

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
// PlanChatAndPreview moved to draft editor only (per coach feedback).
import { ReworkBanner } from "@/components/client-widgets/rework-banner";
import { PlanDiffAlert } from "@/components/client-widgets/plan-diff-alert";
import { computePlanVersionDiffAction } from "@/lib/server-actions/plan-version-diff";
import { AttachedProtocolsPanel } from "./attached-protocols-panel";
import { QuickEditSupplementsPanel } from "./quick-edit-supplements-panel";
import { FollowUpPanel } from "./follow-up-panel";
// PhaseLetterPanel was here through 2026-05-18 — moved back to the
// Communicate tab so letter generation lives in one place. Import kept
// out of this file to avoid an unused-import warning.
import { PlanOutcomesPanel } from "./plan-outcomes-panel";
import { ActivateDraftButton } from "./activate-draft-button";
// GeneratedLettersPanel moved to Communicate tab — see plan/page.tsx
// around line 745 for the pointer card that replaced it.
// RegenerateStaleButton import removed 2026-05-20 — the letter-staleness
// banner it served is gone; the coach regenerates from the letter editor.
import { loadAllOfKind } from "@/lib/fmdb/loader";
import { detectPlanConflicts } from "@/lib/fmdb/plan-conflicts";
import { PlanConflictPanel } from "./plan-conflict-panel";

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

  // Clears plan/system-alerts chip on the unread badge for this client.
  void markCoachTabViewed(id, "plan");

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
  // If separate drafts exist alongside a published plan, call them out
  // so the coach knows in-progress next versions are waiting. Multiple
  // drafts can accumulate when a coach re-runs Assess more than once
  // without activating the previous draft — the BACKLOG flagged the bug
  // that all but the first were hidden in "archivedPlans".
  const pendingDrafts = activePlan && planStatusOf(activePlan) === "published"
    ? activeSorted.filter(
        (p) =>
          p !== activePlan &&
          (planStatusOf(p) === "draft" || planStatusOf(p) === "ready_to_publish"),
      )
    : [];
  const pendingDraft = pendingDrafts[0];
  const pendingDraftSet = new Set(pendingDrafts);
  // Compute structural diff between active and the first pending draft so
  // the coach can see at-a-glance whether the draft is worth publishing.
  // Cheap, runs server-side; AI semantic check is on-demand from the alert.
  const draftDiff = activePlan && pendingDraft
    ? await computePlanVersionDiffAction(
        activePlan.slug as string,
        pendingDraft.slug as string,
      )
    : null;
  const archivedPlans = plans
    .filter((p) => p !== activePlan && !pendingDraftSet.has(p))
    .sort((a, b) =>
      (planVersionOf(b) - planVersionOf(a)) ||
      ((b.updated_at ?? "") as string).localeCompare(
        (a.updated_at ?? "") as string,
      ),
    );

  const stage = deriveStage(activePlan, todayStr, id);
  const status = activePlan ? planStatusOf(activePlan) : undefined;
  const isPublished = status === "published";

  // Plan-conflict check — rules-based detector that flags client.dietary_preference
  // vs client.non_negotiables / allergies contradictions. Runs whenever there's
  // any plan (draft, ready_to_publish, or published) so the coach sees the
  // signal both during authoring and after publication.
  const planConflicts = activePlan
    ? detectPlanConflicts(
        client as unknown as Parameters<typeof detectPlanConflicts>[0],
        activePlan as unknown as Record<string, unknown>,
      )
    : [];

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

  // Rows for the in-place QuickEditSupplementsPanel (published plans only).
  // Carries display_name so the panel can show a clean name; the slug is
  // the edit key passed to quickEditActivePlanSupplement.
  const quickEditSupplementRows = supplementItems
    .filter((it): it is Record<string, unknown> => !!it && typeof it === "object")
    .map((it) => ({
      slug: (it.supplement_slug as string | undefined) ?? "",
      displayName: (it.display_name as string | undefined) ?? undefined,
      dose: (it.dose as string | undefined) ?? "",
      timing: (it.timing as string | undefined) ?? "",
    }))
    .filter((it) => it.slug);

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
  // Anchor for retest dates — in priority:
  //   1. meal_plan_started_on (client-confirmed; locks the dates)
  //   2. supplements_started_on (also coach-confirmed for supps)
  //   3. **letter-emailed date + 3 days** — when neither is set, fall
  //      back to the earliest savedAt of the meal_plan / consolidated
  //      letter on disk + a 3-day adoption lag (the typical gap
  //      between "I got the letter" and "I actually started"). The
  //      panel marks this status as "derived" so the coach knows to
  //      confirm with the client to lock it in.
  //   4. plan_period_start — last resort if no letters exist.
  const planAny = activePlan as Record<string, unknown> | undefined;
  let derivedFromLetter: string | null = null;
  if (!planAny?.meal_plan_started_on && !planAny?.supplements_started_on && staleness?.entries) {
    const candidates = staleness.entries
      .filter((e) => e.type === "meal_plan" || e.type === "consolidated")
      .map((e) => new Date(e.savedAt).getTime())
      .filter((t) => !Number.isNaN(t));
    if (candidates.length > 0) {
      const earliest = Math.min(...candidates);
      const plus3 = new Date(earliest + 3 * 24 * 60 * 60 * 1000);
      derivedFromLetter = plus3.toISOString().slice(0, 10);
    }
  }
  const planStartAnchor =
    (planAny?.meal_plan_started_on as string | undefined) ||
    (planAny?.supplements_started_on as string | undefined) ||
    derivedFromLetter ||
    (planAny?.plan_period_start as string | undefined) ||
    null;
  const planStartConfirmed = Boolean(planAny?.meal_plan_started_on);
  const planStartSource: "confirmed" | "supplements" | "letter+3d" | "plan_period" | "none" =
    planAny?.meal_plan_started_on
      ? "confirmed"
      : planAny?.supplements_started_on
        ? "supplements"
        : derivedFromLetter
          ? "letter+3d"
          : planAny?.plan_period_start
            ? "plan_period"
            : "none";

  function computeDueIso(weeks: number | undefined): string | null {
    if (!planStartAnchor || !weeks || weeks <= 0) return null;
    const start = new Date(`${planStartAnchor}T00:00:00`);
    if (Number.isNaN(start.getTime())) return null;
    const due = new Date(start.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);
    return due.toISOString().slice(0, 10);
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
    .map((it) => {
      const weeks =
        typeof it.due_in_weeks === "number" && it.due_in_weeks > 0
          ? (it.due_in_weeks as number)
          : 8; // sensible default for "follow-up bloods" mid-protocol
      return {
        label: (it.test as string) ?? "",
        detail: labDetail(it),
        dueInWeeks: weeks,
        dueDate: computeDueIso(weeks),
      };
    })
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

      {/* Letter-staleness banner removed from Plan page 2026-05-19.
          The Communicate tab already surfaces this banner ABOVE the
          new layout — same fields, same RegenerateStaleButton wired
          to the same action. Duplicating it on the Plan page added
          noise without changing any workflow (coach lives in
          Communicate for letter actions; Plan is for protocol edits). */}

      {/* Plan-conflict check — dietary preference vs non-negotiables vs
          allergies. Renders only when the rules-based detector finds
          something; each item has an optional one-click apply that
          patches the underlying client.yaml. */}
      {planConflicts.length > 0 && (
        <PlanConflictPanel clientId={id} conflicts={planConflicts} />
      )}

      {/* Pending-draft callout — only when there's a draft sitting next
          to the published plan. Without this surface the coach has no
          visual cue that a newer AI synthesis exists and is waiting for
          review. */}
      {pendingDrafts.length > 0 && (
        <div
          style={{
            marginTop: 12,
            padding: "10px 14px",
            background: "rgba(110, 76, 200, 0.06)",
            border: "1.5px solid rgba(110, 76, 200, 0.35)",
            borderRadius: "var(--fm-radius-md)",
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: 18, lineHeight: "20px" }}>📋</span>
          <div style={{ flex: 1, minWidth: 240, fontSize: 12 }}>
            <div style={{ fontWeight: 700, color: "#5a3fb0" }}>
              {pendingDrafts.length === 1
                ? "A new draft is waiting for review"
                : `${pendingDrafts.length} drafts are waiting for review`}
            </div>
            <div style={{ color: "var(--fm-text-secondary)", marginTop: 1 }}>
              This card below still shows your <strong>live</strong>{" "}
              published plan.{" "}
              {pendingDrafts.length === 1 ? "The draft is a" : "Drafts are"}{" "}
              candidate next-version{pendingDrafts.length === 1 ? "" : "s"}{" "}
              generated from recent Full Assessment runs — review and activate
              to supersede.
            </div>
            <div
              style={{
                marginTop: 8,
                display: "flex",
                gap: 6,
                flexWrap: "wrap",
              }}
            >
              {pendingDrafts.map((d) => (
                <Link
                  key={d.slug as string}
                  href={`/clients-v2/${id}/plan/edit/${d.slug}`}
                  style={{
                    padding: "5px 10px",
                    fontSize: 11,
                    fontWeight: 700,
                    fontFamily: "var(--fm-font-mono)",
                    background: "#5a3fb0",
                    color: "#fff",
                    borderRadius: "var(--fm-radius-sm)",
                    textDecoration: "none",
                    whiteSpace: "nowrap",
                  }}
                >
                  {d.slug} →
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Structural + AI-assisted diff between active and first pending
          draft. Only renders when both exist and there's at least one
          material change to surface. Coach can opt-in to a Haiku semantic
          read of coach notes via a button inside the alert. */}
      {activePlan && pendingDraft && draftDiff?.ok && draftDiff.diff && (
        <PlanDiffAlert
          clientId={id}
          activeSlug={activePlan.slug as string}
          draftSlug={pendingDraft.slug as string}
          diff={draftDiff.diff}
        />
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
            {/* AI assistant lives ONLY on the draft editor page now
                (/clients-v2/[id]/plan/edit/[slug]) as a floating bubble.
                Coach asked: the chat shouldn't clutter the plan overview
                — only show up where editing actually happens. */}

            {/* Meal plan / letters used to live here (GeneratedLettersPanel).
                Moved to Communicate tab — coach feedback 2026-05-15: protocol
                lives on Plan, letters live on Communicate, no duplication. A
                pointer card replaces the panel so coach can still jump there
                in one click while reviewing the protocol. */}
            {(() => {
              const planSlug = activePlan.slug as string;
              return (
                <a
                  href={`/clients-v2/${id}/communicate`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 14px",
                    background: "rgba(75, 110, 175, 0.06)",
                    border: "1px dashed rgba(75, 110, 175, 0.30)",
                    borderRadius: "var(--fm-radius-md)",
                    textDecoration: "none",
                    color: "inherit",
                    marginBottom: 12,
                  }}
                  title="The meal plan, supplement guide and other letters live on the Communicate tab"
                >
                  <span style={{ fontSize: 20 }}>📬</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--fm-text-primary)" }}>
                      Letters for the client live on Communicate
                    </div>
                    <div style={{ fontSize: 11, color: "var(--fm-text-secondary)" }}>
                      Meal plan, supplement guide, lifestyle guide, consolidated letter — preview, refine and send from there.
                    </div>
                  </div>
                  <span style={{ fontSize: 12, color: "var(--fm-primary)", fontWeight: 700 }}>
                    Open Communicate →
                  </span>
                  {/* keep planSlug referenced so the hint chip below can use it if needed */}
                  <span style={{ display: "none" }}>{planSlug}</span>
                </a>
              );
            })()}

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
                    fontSize: 12,
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
                  <MiniLabel>Primary conditions</MiniLabel>
                  <ChipList items={primaryTopics} tone="primary" />
                </div>
                <div>
                  <MiniLabel>Presenting symptoms</MiniLabel>
                  <ChipList items={presentingSymptoms} />
                </div>
                {contributingTopics.length > 0 && (
                  <div style={{ gridColumn: "1 / -1" }}>
                    <MiniLabel>Contributing conditions</MiniLabel>
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

            {/* In-place quick edit — published plans only. Lets the coach
                adjust a dose / timing or remove a supplement without the
                4-step supersede flow. Drafts use the full plan editor. */}
            {isPublished && (
              <QuickEditSupplementsPanel
                planSlug={activePlan.slug}
                supplements={quickEditSupplementRows}
              />
            )}

            {/* Nutrition — pattern + add/reduce + meal timing + cooking
                adjustments + home remedies. The 7-day meal grid itself
                lives in the generated client letter (panel pinned at top). */}
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

            {/* Labs — two view modes via LabsViewPanel: cadence (when to
                order) or sample type (what client gives on the day, with
                "order now" vs "at recheck" split inside each bucket).
                Retest due dates derive from the coach-confirmed
                meal_plan_started_on; the panel auto-surfaces a reminder
                banner when any retest is overdue or due within 14 days. */}
            <LabsViewPanel
              newLabs={newLabs}
              repeatLabs={repeatLabs}
              planStartAnchor={planStartAnchor}
              planStartConfirmed={planStartConfirmed}
              planStartSource={planStartSource}
              planSlug={activePlan.slug as string}
              clientId={id}
              clientEmail={
                (client as { email?: string } | null)?.email ?? null
              }
            />

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
                subtitle="Condition / root-cause explainers attached to the client letter."
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
                title={`🧬 Root causes (${drivers.length})`}
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
            {/* Quick actions — 4 evergreen verbs, kept lean (Framing A
                from 2026-05-15 brainstorm). The "next big thing to do"
                primary action lives in the workflow banner at the top
                of the page (computed from plan stage), so this panel
                is just the everyday verbs. SOAP note + handoff packet +
                run-another-assessment are reachable via the FAB.
                Quick note is the highest-frequency action (capture a
                thought / call / message) so it leads. */}
            <FmPanel
              title="⚙ Quick actions"
              subtitle="Everyday verbs. Big next-step CTA lives in the banner at the top of the page."
            >
              <div style={{ display: "grid", gap: 6 }}>
                <ActionLink
                  href={`/clients-v2/${id}/analyse/quick`}
                  icon="📝"
                  label="Quick note"
                />
                <ActionLink
                  href={`/clients-v2/${id}/communicate`}
                  icon="📤"
                  label={
                    isPublished
                      ? "Send letter / message"
                      : "Communicate (locks at publish)"
                  }
                />
                <ActionLink
                  href={`/clients-v2/${id}/plan/edit/${activePlan.slug}`}
                  icon="✏️"
                  label="Edit plan"
                />
                <ActionLink
                  href={`/clients-v2/${id}/soap`}
                  icon="📋"
                  label="SOAP note (1-pager)"
                />
              </div>
            </FmPanel>

            {/* 📊 Outcomes since plan publish — Phase 1 of the outcome
                feedback loop. Pulls Plan.baseline_snapshot (captured at
                publish, or backfilled from the closest pre-publish
                health_snapshot) and diffs it against the latest client
                state. Lab + measurement deltas surfaced with FM-direction
                colouring (improving / worsening / unchanged). */}
            {isPublished && activePlan && (
              <PlanOutcomesPanel
                planSlug={activePlan.slug as string}
                clientId={id}
              />
            )}

            {/* Continue meal plan moved BACK to Communicate tab on
                2026-05-18 per coach decision: "letter generation should
                only sit in the communication tab. Plan tab for
                underlying plan changes."
                See /clients-v2/[id]/communicate — PhaseLetterPanel is
                rendered there above the SendPackageButton. */}
            {isPublished && activePlan && (
              <div
                style={{
                  padding: "10px 14px",
                  marginBottom: 14,
                  background: "var(--fm-bg-cool)",
                  border: "1px dashed var(--fm-border-light)",
                  borderRadius: "var(--fm-radius-sm)",
                  fontSize: 12,
                  color: "var(--fm-text-secondary)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <span>
                  🍽 Generate next weeks' meal plan letter — moved to the
                  Communicate tab so all client-facing letters live in one
                  place.
                </span>
                <Link
                  href={`/clients-v2/${id}/communicate`}
                  style={{
                    padding: "5px 10px",
                    background: "var(--fm-primary)",
                    color: "#fff",
                    borderRadius: "var(--fm-radius-sm)",
                    textDecoration: "none",
                    fontSize: 12,
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                  }}
                >
                  Open Communicate →
                </Link>
              </div>
            )}

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
                      <div style={{ flex: 1, minWidth: 0, fontSize: 12 }}>
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
        fontSize: 12,
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
