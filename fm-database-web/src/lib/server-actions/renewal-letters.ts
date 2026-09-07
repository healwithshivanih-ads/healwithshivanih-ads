"use server";

/**
 * Renewal-letter actions — the read + approve half of the "Plans ending" flow.
 *
 * A letter is authored in chat and staged as `drafted` (see
 * scripts/stage-renewal-letter.mjs). These actions let the dashboard panel READ
 * that draft and APPROVE it for sending on the plan-end day. The send itself is
 * the renewal-send cron, never these — approving only sets a date.
 */

import { revalidatePath } from "next/cache";
import {
  loadAllRenewalLetters,
  approveRenewalLetter,
  unapproveRenewalLetter,
  type RenewalLetter,
} from "@/lib/fmdb/renewal-letters";

/** Every letter on file, keyed by plan slug — the dashboard hands this to the
 *  panel so each renewal row can show its letter's status inline. */
export async function listRenewalLettersAction(): Promise<Record<string, RenewalLetter>> {
  return loadAllRenewalLetters();
}

/**
 * Approve a drafted letter to send on `scheduledFor` (YYYY-MM-DD, the plan-end
 * date the row carries). The letter still does not go out until the cron reaches
 * that date.
 */
export async function approveRenewalLetterAction(
  planSlug: string,
  scheduledFor: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!planSlug) return { ok: false, error: "missing plan" };
  const res = approveRenewalLetter(planSlug, scheduledFor);
  if (res.ok) revalidatePath("/dashboard-v2");
  return res;
}

/** Undo an approval — the letter drops back to a draft and will not send. */
export async function unapproveRenewalLetterAction(
  planSlug: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!planSlug) return { ok: false, error: "missing plan" };
  const res = unapproveRenewalLetter(planSlug);
  if (res.ok) revalidatePath("/dashboard-v2");
  return res;
}
