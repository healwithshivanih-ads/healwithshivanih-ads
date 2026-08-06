"use server";

/**
 * Renewal decisions — the coach's way of telling the end-of-plan queue that a
 * plan ending has been dealt with.
 *
 * WHY THIS EXISTS: the queue and the daily digest have told the coach since
 * 3 Aug 2026 to "mark anyone who has decided not to continue" — and there was
 * nowhere to do it. `setDecision` had exactly two callers, itself and its
 * test; the only two decisions on file were written by hand. So every plan
 * ending sat in the digest for its full 30 days no matter what had been
 * agreed, which is precisely how a queue teaches you to skim it.
 *
 * These are reads and writes of a small YAML keyed by plan slug. Nothing here
 * touches the client or sends anything.
 */

import { revalidatePath } from "next/cache";
import {
  openRenewals,
  setDecision,
  clearDecision,
  type RenewalDecision,
  type RenewalRow,
} from "@/lib/fmdb/renewal-queue";

/** The queue as the dashboard should show it — undecided plans only. */
export async function listOpenRenewalsAction(): Promise<RenewalRow[]> {
  return openRenewals();
}

/**
 * Record what was decided about a plan that is ending. The row leaves the
 * queue and stops appearing in the morning digest.
 */
export async function recordRenewalDecisionAction(
  planSlug: string,
  decision: RenewalDecision,
  note?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!planSlug) return { ok: false, error: "missing plan" };
  const ok = setDecision(planSlug, decision, note);
  if (!ok) return { ok: false, error: "could not write the decision" };
  revalidatePath("/dashboard-v2");
  return { ok: true };
}

/** Put a plan back in the queue — see clearDecision on why undo is required. */
export async function undoRenewalDecisionAction(
  planSlug: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!planSlug) return { ok: false, error: "missing plan" };
  const ok = clearDecision(planSlug);
  if (!ok) return { ok: false, error: "could not clear the decision" };
  revalidatePath("/dashboard-v2");
  return { ok: true };
}
