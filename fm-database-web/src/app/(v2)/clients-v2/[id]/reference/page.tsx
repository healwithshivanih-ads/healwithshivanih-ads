/**
 * Active-plan reference card — fast lookup for mid-call coach use.
 *
 * Use case: client phones in and asks "what time should I take the
 * niacin?" or "am I supposed to be eating eggs?" — coach needs a
 * one-screen view of the active protocol without hunting through the
 * Plan tab's editor surfaces or scrolling the long client letter.
 *
 * Shows the published (or, if no published, latest active) plan as:
 *   - Supplements: timing-grouped cards with dose / form / notes,
 *     searchable by name/timing.
 *   - Nutrition: pattern + add[] + reduce[] + cooking notes. If the
 *     client opted out of daily meal plans, this is the only menu
 *     surface they get. Link to the full saved meal-plan letter when
 *     `letter_types_active` includes meal_plan.
 *   - Lifestyle practices: quick chips.
 *   - Notes for coach.
 *
 * Standalone page (not in the 6-tab subnav). Linked from the FAB and
 * inline from the Quick Note form. Print-friendly via @media print.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadClientById } from "@/lib/fmdb/loader-extras";
import { loadAllPlans } from "@/lib/fmdb/loader";
import { loadCatalogueChipDict } from "@/lib/fmdb/catalogue-chip-dict";
import type { Plan, PlanStatus } from "@/lib/fmdb/types";
import { ReferenceClient } from "./reference-client";

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
  cooking_adjustments?: unknown[];
  home_remedies?: unknown[];
  // Some plans nest free-form keys; we render the whole record best-effort.
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

  // Same precedence rule as the Plan tab:
  //   published > ready_to_publish > draft, then version DESC, then updated_at DESC.
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

  // Build a slug → display-name lookup for supplements. Chip dict already
  // includes every catalogue supplement; for slugs that aren't in the chip
  // dict (custom / not-yet-catalogued slugs), we render the slug verbatim.
  const supplementNameMap: Record<string, string> = {};
  for (const c of chips) {
    if (c.kind !== "supplement") continue;
    // term is normalised to a string at chip-build time; ?? guard for the
    // RegExp case (we don't use that path here).
    const term = typeof c.term === "string" ? c.term : String(c.term);
    // First chip per slug wins (chip dict is sorted by length DESC so the
    // longest canonical phrase comes first — that's the display name).
    if (!supplementNameMap[c.slug]) supplementNameMap[c.slug] = term;
  }

  const supplements: SupplementItem[] = (activePlan?.supplement_protocol as SupplementItem[]) ?? [];
  const nutrition: NutritionShape = (activePlan?.nutrition as NutritionShape) ?? {};
  const lifestyle: PracticeItem[] = (activePlan?.lifestyle_practices as PracticeItem[]) ?? [];

  // Letter types active on the client — controls whether a daily meal plan
  // letter exists on disk. When meal_plan ISN'T in the active set, the
  // nutrition card below is the ONLY menu surface for this client.
  const letterTypesActive = (client.letter_types_active as string[] | undefined) ?? ["consolidated"];
  const hasMealPlanLetter = letterTypesActive.includes("meal_plan");
  const hasConsolidated = letterTypesActive.includes("consolidated");

  return (
    <ReferenceClient
      clientId={id}
      displayName={displayName}
      firstName={firstName}
      activePlanSlug={(activePlan?.slug as string | undefined) ?? null}
      activePlanStatus={activePlan ? planStatusOf(activePlan) : null}
      planUpdatedAt={(activePlan?.updated_at as string | undefined) ?? null}
      supplements={supplements}
      supplementNameMap={supplementNameMap}
      nutrition={nutrition}
      lifestyle={lifestyle}
      notesForCoach={(activePlan?.notes_for_coach as string | undefined) ?? null}
      hasMealPlanLetter={hasMealPlanLetter}
      hasConsolidated={hasConsolidated}
    />
  );
}
