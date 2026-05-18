/**
 * plan-version-diff — deterministic structural comparison of two plan
 * VERSIONS for the same client (e.g. active vs unpublished draft).
 *
 * Surfaces material changes a coach would want to verify before publishing
 * a draft over an active plan.
 *
 * Distinct from `./plan-diff.ts` which diffs an AI patch against a plan.
 *
 * NB: This is the cheap, instant pass. The semantic comparison of
 * `notes_for_coach` (largely free-text rationale) is done by a Haiku
 * call on demand — character-count diffs over-trigger on rewording and
 * miss real changes.
 */

export type PlanDiffSeverity = "none" | "low" | "medium" | "high";

export interface PlanVersionDiffSummary {
  /** True when there is at least one material structural change */
  hasChanges: boolean;

  /** Auto-derived severity (see severityFor()) */
  severity: PlanDiffSeverity;

  /** Plan period change in weeks (positive = longer, negative = shorter) */
  periodWeeksDelta: number | null;
  activePeriodWeeks: number | null;
  draftPeriodWeeks: number | null;

  /** Supplement slug-level diff */
  supplementsAdded: string[];
  supplementsRemoved: string[];
  /** Supplements present in both with different dose or timing */
  supplementsModified: Array<{
    slug: string;
    field: "dose" | "timing";
    activeValue: string;
    draftValue: string;
  }>;

  /** Lab order changes by display label */
  labOrdersAdded: string[];
  labOrdersRemoved: string[];

  /** Referrals — by display label */
  referralsAdded: string[];
  referralsRemoved: string[];

  /** Lifestyle practice count changes — often noise, surface as count */
  lifestyleAdded: number;
  lifestyleRemoved: number;

  /** Coach notes signal for severity heuristic and AI trigger */
  notesLengthDelta: number;
  notesChanged: boolean;
}

interface SupplementItem {
  supplement_slug?: string;
  dose_display?: string;
  timing?: string;
}

interface LabItem {
  test_slug?: string;
  display_name?: string;
  reason?: string;
}

interface ReferralItem {
  specialty?: string;
  reason?: string;
  urgency?: string;
}

interface LifestyleItem {
  name?: string;
  cadence?: string;
}

export interface PlanLike {
  plan_period_weeks?: number;
  supplement_protocol?: SupplementItem[];
  lab_orders?: LabItem[];
  referrals?: ReferralItem[];
  lifestyle_practices?: LifestyleItem[];
  notes_for_coach?: string;
}

function slugsOf(items: SupplementItem[] | undefined): string[] {
  return (items ?? [])
    .map((i) => i.supplement_slug)
    .filter((s): s is string => !!s);
}

function labLabelOf(item: LabItem): string {
  return item.display_name || item.test_slug || "—";
}

function referralLabelOf(item: ReferralItem): string {
  const spec = item.specialty || "specialist";
  const reason = item.reason ? ` — ${item.reason.slice(0, 60)}` : "";
  return `${spec}${reason}`;
}

function setDiff<T>(a: T[], b: T[]): { added: T[]; removed: T[] } {
  const sa = new Set(a);
  const sb = new Set(b);
  return {
    added: b.filter((x) => !sa.has(x)),
    removed: a.filter((x) => !sb.has(x)),
  };
}

/**
 * Compute the deterministic diff between an active plan and a draft plan.
 * Pure function. Cheap. No I/O.
 */
export function computePlanVersionDiff(
  active: PlanLike,
  draft: PlanLike,
): PlanVersionDiffSummary {
  const ap = active.plan_period_weeks ?? null;
  const dp = draft.plan_period_weeks ?? null;
  const periodWeeksDelta = ap !== null && dp !== null ? dp - ap : null;

  const supA = slugsOf(active.supplement_protocol);
  const supD = slugsOf(draft.supplement_protocol);
  const { added: supplementsAdded, removed: supplementsRemoved } = setDiff(supA, supD);

  const supplementsModified: PlanVersionDiffSummary["supplementsModified"] = [];
  const supAMap = new Map(
    (active.supplement_protocol ?? [])
      .filter((s) => s.supplement_slug)
      .map((s) => [s.supplement_slug as string, s]),
  );
  for (const sd of draft.supplement_protocol ?? []) {
    if (!sd.supplement_slug) continue;
    const sa = supAMap.get(sd.supplement_slug);
    if (!sa) continue;
    const aDose = (sa.dose_display ?? "").trim();
    const dDose = (sd.dose_display ?? "").trim();
    if (aDose !== dDose) {
      supplementsModified.push({
        slug: sd.supplement_slug,
        field: "dose",
        activeValue: aDose || "(none)",
        draftValue: dDose || "(none)",
      });
    }
    const aTiming = (sa.timing ?? "").trim();
    const dTiming = (sd.timing ?? "").trim();
    if (aTiming !== dTiming) {
      supplementsModified.push({
        slug: sd.supplement_slug,
        field: "timing",
        activeValue: aTiming || "(none)",
        draftValue: dTiming || "(none)",
      });
    }
  }

  const labA = (active.lab_orders ?? []).map(labLabelOf);
  const labD = (draft.lab_orders ?? []).map(labLabelOf);
  const { added: labOrdersAdded, removed: labOrdersRemoved } = setDiff(labA, labD);

  const refA = (active.referrals ?? []).map(referralLabelOf);
  const refD = (draft.referrals ?? []).map(referralLabelOf);
  const { added: referralsAdded, removed: referralsRemoved } = setDiff(refA, refD);

  const lifeA = (active.lifestyle_practices ?? []).map((l) => l.name ?? "");
  const lifeD = (draft.lifestyle_practices ?? []).map((l) => l.name ?? "");
  const { added: lifeAdded, removed: lifeRemoved } = setDiff(lifeA, lifeD);

  const notesA = active.notes_for_coach ?? "";
  const notesD = draft.notes_for_coach ?? "";
  const notesLengthDelta = notesD.length - notesA.length;
  const notesChanged = notesA.trim() !== notesD.trim();

  const hasChanges =
    (periodWeeksDelta !== null && periodWeeksDelta !== 0) ||
    supplementsAdded.length > 0 ||
    supplementsRemoved.length > 0 ||
    supplementsModified.length > 0 ||
    labOrdersAdded.length > 0 ||
    labOrdersRemoved.length > 0 ||
    referralsAdded.length > 0 ||
    referralsRemoved.length > 0 ||
    lifeAdded.length > 0 ||
    lifeRemoved.length > 0 ||
    notesChanged;

  const severity = severityFor({
    periodWeeksDelta,
    supplementsAdded,
    supplementsRemoved,
    supplementsModified,
    labOrdersAdded,
    labOrdersRemoved,
    referralsAdded,
    referralsRemoved,
    notesLengthDelta,
  });

  return {
    hasChanges,
    severity,
    periodWeeksDelta,
    activePeriodWeeks: ap,
    draftPeriodWeeks: dp,
    supplementsAdded,
    supplementsRemoved,
    supplementsModified,
    labOrdersAdded,
    labOrdersRemoved,
    referralsAdded,
    referralsRemoved,
    lifestyleAdded: lifeAdded.length,
    lifestyleRemoved: lifeRemoved.length,
    notesLengthDelta,
    notesChanged,
  };
}

/**
 * Severity heuristic — combines deterministic signals into a single
 * verdict the coach can use to triage "is this draft worth publishing".
 *
 *   high   → multiple supplement changes OR new referral OR period change
 *            combined with supplement change
 *   medium → 1 supplement change OR lab orders changed OR period change
 *            alone OR notes grew substantially (>500 chars)
 *   low    → notes changed but nothing structural OR only lifestyle wording
 *   none   → no material changes
 *
 * The AI semantic check can upgrade severity if it detects a true
 * clinical pivot inside the notes_for_coach text.
 */
function severityFor(d: {
  periodWeeksDelta: number | null;
  supplementsAdded: string[];
  supplementsRemoved: string[];
  supplementsModified: Array<unknown>;
  labOrdersAdded: string[];
  labOrdersRemoved: string[];
  referralsAdded: string[];
  referralsRemoved: string[];
  notesLengthDelta: number;
}): PlanDiffSeverity {
  const supChanges =
    d.supplementsAdded.length +
    d.supplementsRemoved.length +
    d.supplementsModified.length;
  const labChanges = d.labOrdersAdded.length + d.labOrdersRemoved.length;
  const refChanges = d.referralsAdded.length + d.referralsRemoved.length;
  const periodChanged = d.periodWeeksDelta !== null && d.periodWeeksDelta !== 0;
  const bigNotes = Math.abs(d.notesLengthDelta) > 500;

  if (supChanges >= 2 || refChanges > 0 || (periodChanged && supChanges > 0)) {
    return "high";
  }
  if (supChanges === 1 || labChanges > 0 || periodChanged || bigNotes) {
    return "medium";
  }
  if (d.notesLengthDelta !== 0) {
    return "low";
  }
  return "none";
}
