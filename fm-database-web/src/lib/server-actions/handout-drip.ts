"use server";

import { runShim } from "@/lib/fmdb/shim";
import { revalidatePath } from "next/cache";

export interface HandoutDripItem {
  slug: string;
  title: string;
  week: number;
  send_on: string; // YYYY-MM-DD
  url: string;
  sent_at: string | null;
}

export interface HandoutDripResult {
  ok: boolean;
  schedule?: HandoutDripItem[];
  day1?: string;
  enqueued?: number;
  note?: string;
  error?: string;
}

export interface HandoutItem {
  slug: string;
  title: string;
  attached: boolean;
  matched: boolean;
}

export interface HandoutListResult {
  ok: boolean;
  handouts?: HandoutItem[];
  plan_slug?: string;
  error?: string;
}

async function run(action: string, clientId: string): Promise<HandoutDripResult> {
  try {
    const raw = (await runShim("handout-drip.py", { action, client_id: clientId }, 60_000)) as HandoutDripResult;
    return raw ?? { ok: false, error: "no output" };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** List all available handouts with attached/auto-matched flags for this client's active plan. */
export async function listHandoutsForClientAction(clientId: string): Promise<HandoutListResult> {
  try {
    const raw = (await runShim("handout-drip.py", { action: "list", client_id: clientId }, 60_000)) as HandoutListResult;
    return raw ?? { ok: false, error: "no output" };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Write the selected slugs to the plan's attached_resources field. */
export async function updateHandoutAttachmentsAction(clientId: string, slugs: string[]): Promise<{ ok: boolean; error?: string }> {
  try {
    const raw = (await runShim("handout-drip.py", { action: "update_attachments", client_id: clientId, slugs }, 60_000)) as { ok: boolean; error?: string };
    if (raw?.ok) {
      revalidatePath(`/clients-v2/${clientId}`);
    }
    return raw ?? { ok: false, error: "no output" };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Existing stored schedule (empty if drip not set up yet). */
export async function loadHandoutScheduleAction(clientId: string): Promise<HandoutDripResult> {
  return run("load", clientId);
}

/** Compute (but don't persist/enqueue) the proposed drip from the active plan's handouts. */
export async function previewHandoutDripAction(clientId: string): Promise<HandoutDripResult> {
  return run("preview", clientId);
}

/** Persist the schedule + enqueue rows into the WhatsApp cron (fully automatic). */
export async function setupHandoutDripAction(clientId: string): Promise<HandoutDripResult> {
  const res = await run("setup", clientId);
  if (res.ok) {
    revalidatePath(`/clients-v2/${clientId}`);
    revalidatePath(`/clients-v2/${clientId}/communicate`);
  }
  return res;
}
