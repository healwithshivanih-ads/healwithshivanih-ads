"use server";

import { runShim } from "@/lib/fmdb/shim";
import { loadPlanBySlug } from "@/lib/fmdb/loader";
import { updatePlanForChat } from "@/lib/server-actions/plans";
import { computePlanChanges, type PlanChange } from "@/lib/fmdb/plan-diff";
import type { Plan } from "@/lib/fmdb/types";
import { revalidatePath } from "next/cache";
import path from "node:path";
import fs from "node:fs/promises";

const FMDB_PLANS_DIR = process.env.FMDB_PLANS_DIR ?? `${process.env.HOME}/fm-plans`;

// Client fields the chat is allowed to patch from conversation. Keep this
// list narrow — only enduring preferences / triggers that should learn
// across plans. Everything else stays under explicit profile-edit control.
const CLIENT_PATCH_FIELDS = [
  "dietary_preference",
  "foods_to_avoid",
  "non_negotiables",
  "reported_triggers",
] as const;
type ClientPatchField = (typeof CLIENT_PATCH_FIELDS)[number];

export interface ClientFieldChange {
  field: ClientPatchField;
  before: string;
  after: string;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface PlanChatResult {
  ok: boolean;
  reply?: string;
  updated?: boolean; // true if a patch was applied
  changes?: PlanChange[]; // structured "what changed" list, computed from old plan vs patch
  revertedToDraft?: boolean; // true if plan was moved from ready back to draft
  clientUpdated?: boolean; // true if client_patch persisted
  clientChanges?: ClientFieldChange[];
  error?: string;
}

/**
 * Apply a client_patch from the chat tool to ~/fm-plans/clients/<id>/client.yaml.
 *
 * Returns the field-by-field diff so the chat panel can display chips. Skips
 * any non-whitelisted keys (defence in depth — schema already filters but
 * an AI could still return unexpected keys).
 */
async function applyClientPatch(
  clientId: string,
  patch: Record<string, unknown>,
): Promise<ClientFieldChange[]> {
  const keys = Object.keys(patch).filter((k): k is ClientPatchField =>
    (CLIENT_PATCH_FIELDS as readonly string[]).includes(k),
  );
  if (keys.length === 0) return [];

  const { load, dump } = await import("js-yaml");
  const clientFile = path.join(FMDB_PLANS_DIR, "clients", clientId, "client.yaml");

  let raw: string;
  try {
    raw = await fs.readFile(clientFile, "utf-8");
  } catch {
    return []; // missing client file — nothing to patch
  }

  const data = (load(raw) as Record<string, unknown>) ?? {};
  const diffs: ClientFieldChange[] = [];

  for (const k of keys) {
    const next = patch[k];
    if (typeof next !== "string") continue;
    const before = typeof data[k] === "string" ? (data[k] as string) : "";
    const trimmed = next.trim();
    if (!trimmed || trimmed === before) continue;
    data[k] = trimmed;
    diffs.push({ field: k, before, after: trimmed });
  }

  if (diffs.length === 0) return [];

  const yaml = dump(data, { sortKeys: false, lineWidth: 100 });
  await fs.writeFile(clientFile, yaml, "utf-8");

  // Invalidate every surface that reads client preferences.
  revalidatePath(`/clients/${clientId}`);
  revalidatePath(`/clients-v2/${clientId}`);
  revalidatePath(`/clients-v2/${clientId}/plan`);
  revalidatePath(`/clients-v2/${clientId}/communicate`);

  return diffs;
}

async function loadClientData(clientId: string): Promise<Record<string, unknown>> {
  try {
    const clientFile = path.join(FMDB_PLANS_DIR, "clients", clientId, "client.yaml");
    const { load } = await import("js-yaml");
    const raw = await fs.readFile(clientFile, "utf-8");
    return (load(raw) as Record<string, unknown>) ?? {};
  } catch {
    return {};
  }
}

export async function planChatAction(
  slug: string,
  clientId: string,
  message: string,
  history: ChatTurn[]
): Promise<PlanChatResult> {
  // Load current plan
  const plan = await loadPlanBySlug(slug);
  if (!plan) return { ok: false, error: `Plan ${slug} not found` };

  // Allow chat on draft + ready_to_publish (ready plans revert to draft on edit)
  const status = (plan.status ?? plan._bucket) as string;
  const editableStatuses = ["draft", "ready_to_publish", "ready"];
  if (!editableStatuses.includes(status)) {
    return { ok: false, error: `Plan is ${status} — only draft and ready-to-publish plans can be edited via chat.` };
  }

  // Load client data
  const clientData = await loadClientData(clientId);

  // Strip loader-only fields from plan
  const { _bucket, _file, ...planData } = plan as Plan & { _bucket?: string; _file?: string };
  void _bucket;
  void _file;

  const input = {
    plan_slug: slug,
    client_id: clientId,
    message,
    history,
    plan_data: planData,
    client_data: clientData,
  };

  const raw = await runShim("plan-chat.py", input);
  const result = raw as {
    ok: boolean;
    reply?: string;
    patch?: Record<string, unknown>;
    client_patch?: Record<string, unknown>;
    error?: string;
  };

  if (!result.ok) {
    return { ok: false, error: result.error ?? "Unknown error" };
  }

  const reply = result.reply ?? "Done.";
  const patch = result.patch ?? {};
  const clientPatch = result.client_patch ?? {};

  // Apply plan patch if non-empty
  let updated = false;
  let revertedToDraft = false;
  let changes: PlanChange[] = [];
  if (Object.keys(patch).length > 0) {
    changes = computePlanChanges(plan as Plan, patch);
    const applyResult = await updatePlanForChat(slug, patch as Partial<Plan>);
    if (!applyResult.ok) {
      return { ok: false, error: (applyResult as { ok: false; error: string }).error };
    }
    updated = true;
    revertedToDraft = (applyResult as { ok: true; revertedToDraft?: boolean }).revertedToDraft ?? false;
  }

  // Apply client_patch (writes to client.yaml). Independent of plan patch —
  // the coach can give us enduring info even if no plan change is needed.
  const clientChanges = await applyClientPatch(clientId, clientPatch);
  const clientUpdated = clientChanges.length > 0;

  return {
    ok: true,
    reply,
    updated,
    changes,
    revertedToDraft,
    clientUpdated,
    clientChanges,
  };
}
