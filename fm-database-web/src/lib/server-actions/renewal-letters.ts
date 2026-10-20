"use server";

/**
 * Renewal-letter actions — the read + approve half of the "Plans ending" flow.
 *
 * A letter is authored in chat and staged as `drafted` (see
 * scripts/stage-renewal-letter.mjs). These actions let the dashboard panel READ
 * that draft and APPROVE it for sending two days before the plan ends. The send itself is
 * the renewal-send cron, never these — approving only sets a date.
 */

import { revalidatePath } from "next/cache";
import {
  loadAllRenewalLetters,
  approveRenewalLetter,
  unapproveRenewalLetter,
  type RenewalLetter,
} from "@/lib/fmdb/renewal-letters";
import { isRenewalOfferKind, renewalSendDate, type RenewalOfferKind } from "@/lib/fmdb/renewal-offer";

/** Every letter on file, keyed by plan slug — the dashboard hands this to the
 *  panel so each renewal row can show its letter's status inline. */
export async function listRenewalLettersAction(): Promise<Record<string, RenewalLetter>> {
  return loadAllRenewalLetters();
}

/**
 * Approve a drafted letter with the decision taken on the account. It is
 * scheduled SEND_LEAD_DAYS before `endsOn` (the effective plan end the row
 * carries — never earlier than today) and does not go out until the send cron
 * reaches that date.
 */
export async function approveRenewalLetterAction(
  planSlug: string,
  endsOn: string,
  offerKind: RenewalOfferKind,
): Promise<{ ok: boolean; scheduledFor?: string; error?: string }> {
  if (!planSlug) return { ok: false, error: "missing plan" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endsOn)) return { ok: false, error: "missing plan end date" };
  if (!isRenewalOfferKind(offerKind)) return { ok: false, error: "choose the offer first" };
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Kolkata" });
  const scheduledFor = renewalSendDate(endsOn, today);
  const res = approveRenewalLetter(planSlug, scheduledFor, offerKind);
  if (res.ok) revalidatePath("/dashboard-v2");
  return res.ok ? { ok: true, scheduledFor } : res;
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
