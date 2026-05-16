/**
 * Active-plan reference card — fast lookup for mid-call coach use.
 *
 * Use case: client phones in and asks "what time should I take the
 * niacin?" or "am I supposed to be eating eggs?" — coach needs a
 * one-screen view of the active protocol without hunting through the
 * Plan tab's editor surfaces or scrolling the long client letter.
 *
 * Layout (v2 — human-readable redesign):
 *   - Warm header: "Here's what <FirstName> is on right now."
 *   - Two big tile-buttons:
 *       💊 N supplements        → modal with brand-styled schedule
 *       📅 Weekly meal plan     → row of week buttons (current highlighted)
 *                                 → each opens a modal with that week's table
 *   - Inline nutrition guidance card (always shown — for clients who opted
 *     OUT of daily meal plans this is their menu reference)
 *   - Lifestyle practices + notes for coach
 *   - Subtle footer with plan slug / status / updated-at (the machine
 *     identifiers — relegated, not foregrounded)
 *
 * Standalone page, no sub-nav. Linked from the FAB and inline from the
 * Quick Note form.
 */
import { notFound } from "next/navigation";
import { loadClientById } from "@/lib/fmdb/loader-extras";
import { loadAllPlans } from "@/lib/fmdb/loader";
import { loadCatalogueChipDict } from "@/lib/fmdb/catalogue-chip-dict";
import { loadMealPlan, type LetterType } from "@/lib/server-actions/plan-lifecycle";
import type { Plan, PlanStatus } from "@/lib/fmdb/types";
import { ReferenceClient } from "./reference-client";
import {
  extractLetterSections,
  computeCurrentWeek,
  type LetterSections,
} from "./extract-letter-sections";

export const dynamic = "force-dynamic";

const ACTIVE_STATUSES = new Set<PlanStatus>(["draft", "ready_to_publish", "published"]);
const STATUS_PRIORITY: Record<string, number> = {
  published: 3,
  ready_to_publish: 2,
  draft: 1,
};

function planStatusOf(p: Plan): PlanStatus {
  return (p.status as PlanStatus) ?? "draft";
}

function planVersionOf(p: Plan): number {
  return (p.version as number) ?? 0;
}

interface SupplementItem {
  supplement_slug: string;
  form?: string;
  dose?: string;
  timing?: string;
  take_with_food?: string;
  duration_weeks?: number | null;
  titration?: string;
  coach_rationale?: string;
}

interface NutritionShape {
  pattern?: string;
  add?: string[];
  reduce?: string[];
  meal_timing?: string;
  [k: string]: unknown;
}

interface PracticeItem {
  name?: string;
  cadence?: string;
  details?: string;
}

export default async function ReferencePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [client, allPlans, chips] = await Promise.all([
    loadClientById(id),
    loadAllPlans(),
    loadCatalogueChipDict(),
  ]);

  if (!client) notFound();

  const displayName = client.display_name ?? client.client_id ?? id;
  const firstName = displayName.split(" ")[0];

  // Active plan precedence: published > ready_to_publish > draft, latest
  // version, latest updated_at. Matches the Plan tab so the reference
  // page never disagrees with what the coach sees as "the live plan".
  const activeSorted = allPlans
    .filter((p) => p.client_id === id && ACTIVE_STATUSES.has(planStatusOf(p)))
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
  const activePlanSlug = (activePlan?.slug as string | undefined) ?? null;

  // Catalogue display-name map for supplements.
  const supplementNameMap: Record<string, string> = {};
  for (const c of chips) {
    if (c.kind !== "supplement") continue;
    const term = typeof c.term === "string" ? c.term : String(c.term);
    if (!supplementNameMap[c.slug]) supplementNameMap[c.slug] = term;
  }

  const supplements: SupplementItem[] = (activePlan?.supplement_protocol as SupplementItem[]) ?? [];
  const nutrition: NutritionShape = (activePlan?.nutrition as NutritionShape) ?? {};
  const lifestyle: PracticeItem[] = (activePlan?.lifestyle_practices as PracticeItem[]) ?? [];

  const letterTypesActive = (client.letter_types_active as string[] | undefined) ?? ["consolidated"];
  const hasMealPlan = letterTypesActive.includes("meal_plan");
  const hasConsolidated = letterTypesActive.includes("consolidated");

  // Load the saved meal-plan letter HTML so the modals can show brand-
  // styled per-week tables + supplement schedule WITHOUT having to
  // re-render markdown→HTML ourselves. Prefer the dedicated meal_plan
  // letter; fall back to consolidated (which embeds the same week tables
  // inline). Best-effort — missing letter just means modal buttons hide.
  let letterSections: LetterSections | null = null;
  if (activePlanSlug) {
    const preferredType: LetterType = hasMealPlan ? "meal_plan" : "consolidated";
    const fallbackType: LetterType | null = hasMealPlan && hasConsolidated ? "consolidated" : null;
    let letterData = await loadMealPlan(activePlanSlug, id, preferredType);
    if ((!letterData.ok || !letterData.html) && fallbackType) {
      letterData = await loadMealPlan(activePlanSlug, id, fallbackType);
    }
    if (letterData.ok && letterData.html) {
      letterSections = extractLetterSections(letterData.html);
    }
  }

  // Current-week computation from plan_period_start. Capped at the
  // plan_period_weeks (typically 12) so the highlight doesn't wander
  // off the end of the buttons after the protocol completes.
  const todayStr = new Date().toISOString().slice(0, 10);
  const planWeeks = (activePlan?.plan_period_weeks as number | undefined) ?? 12;
  let currentWeek = computeCurrentWeek(
    activePlan?.plan_period_start as string | undefined,
    todayStr,
  );
  if (currentWeek !== null && currentWeek > planWeeks) currentWeek = planWeeks;

  return (
    <ReferenceClient
      clientId={id}
      displayName={displayName}
      firstName={firstName}
      activePlanSlug={activePlanSlug}
      activePlanStatus={activePlan ? planStatusOf(activePlan) : null}
      activePlanVersion={activePlan ? planVersionOf(activePlan) : null}
      planUpdatedAt={(activePlan?.updated_at as string | undefined) ?? null}
      planPeriodStart={(activePlan?.plan_period_start as string | undefined) ?? null}
      planPeriodWeeks={planWeeks}
      currentWeek={currentWeek}
      supplements={supplements}
      supplementNameMap={supplementNameMap}
      nutrition={nutrition}
      lifestyle={lifestyle}
      notesForCoach={(activePlan?.notes_for_coach as string | undefined) ?? null}
      letterSections={letterSections}
      hasMealPlanLetter={hasMealPlan}
      hasConsolidatedLetter={hasConsolidated}
    />
  );
}
