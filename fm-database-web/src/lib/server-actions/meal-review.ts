"use server";

/**
 * Coach actions on the meal-photo queue.
 *
 * Deliberately thin: shadow mode's whole job is to collect the coach's
 * judgement on photos, so the only writes are her verdict and a pin.
 */
import { reviewPhoto } from "@/lib/fmdb/client-thread";
import { loadMealQueue, type MealRow } from "@/lib/fmdb/meal-queue";

const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/i;

export async function loadMealQueueAction(): Promise<MealRow[]> {
  return loadMealQueue();
}

export async function reviewMealAction(
  clientId: string,
  messageId: string,
  verdict: "agree" | "disagree" | null,
): Promise<{ ok: boolean }> {
  if (!SAFE_ID.test(clientId) || !SAFE_ID.test(messageId)) return { ok: false };
  return { ok: reviewPhoto(clientId, messageId, { coach_verdict: verdict }) };
}

export async function pinMealAction(
  clientId: string,
  messageId: string,
  pinned: boolean,
): Promise<{ ok: boolean }> {
  if (!SAFE_ID.test(clientId) || !SAFE_ID.test(messageId)) return { ok: false };
  return { ok: reviewPhoto(clientId, messageId, { pinned }) };
}
