"use server";

/**
 * The coach's call on a monthly card the cron held: approve it (optionally
 * dropping lines that don't fit) so it goes live on the client's app, or skip
 * the month. Both write through generate-monthly-card.py.
 */
import { revalidatePath } from "next/cache";
import { runShim } from "@/lib/fmdb/shim";

const SAFE = /^[A-Za-z0-9_-]+$/;

async function decide(
  action: "approve" | "skip",
  clientId: string,
  planSlug: string,
  month: string,
  drop: string[] = [],
): Promise<{ ok: boolean; error?: string }> {
  if (!SAFE.test(clientId) || !SAFE.test(planSlug) || !/^\d{4}-\d{2}$/.test(month)) {
    return { ok: false, error: "bad input" };
  }
  try {
    const out = (await runShim("generate-monthly-card.py", {
      action,
      client_id: clientId,
      plan_slug: planSlug,
      month,
      drop,
    })) as { ok: boolean; error?: string | null };
    if (out?.ok) {
      revalidatePath("/dashboard-v2");
      revalidatePath(`/clients-v2/${clientId}`);
    }
    return { ok: !!out?.ok, error: out?.error ?? undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "failed" };
  }
}

export async function approveMonthlyCardAction(clientId: string, planSlug: string, month: string, drop: string[]) {
  return decide("approve", clientId, planSlug, month, Array.isArray(drop) ? drop.map(String) : []);
}

export async function skipMonthlyCardAction(clientId: string, planSlug: string, month: string) {
  return decide("skip", clientId, planSlug, month);
}
