import type {
  PlanCheckResult,
  SupplementInteraction,
} from "@/lib/server-actions/plans";

/**
 * The catalogue contraindications still open on a plan, from a plan-check result.
 *
 * `fit_required` lists every flag. check_plan raises a finding only for the ones
 * that still stand: an answered client_fit row clears a flag, and a lapsed client's
 * old plan raises nothing. So a flag counts only if its finding is there, and none
 * of those rules is decided again here. A finding's target is `<slug>:<flag id>`
 * (fmdb/plan/client_fit.py::check_client_fit).
 */
export function openContraindications(
  check: Pick<PlanCheckResult, "findings" | "fit_required">,
): SupplementInteraction[] {
  const raised = new Set(
    (check.findings ?? [])
      .filter((f) => f.section === "client_fit")
      .map((f) => f.target),
  );
  return (check.fit_required ?? [])
    .filter((need) => need.kind === "supplement")
    .flatMap((need) =>
      need.flags
        .filter((flag) => flag.field === "contraindications")
        .filter((flag) => raised.has(`${need.item}:${flag.id}`))
        .map((flag) => ({
          supplement_slug: need.item,
          supplement_name: need.label,
          flag_id: flag.id,
          contraindication_text: flag.reason,
          ask: flag.ask,
          matched: flag.matched,
          soft: flag.soft ?? false,
        })),
    );
}
