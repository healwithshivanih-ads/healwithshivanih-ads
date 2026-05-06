"use server";

import { runShim } from "@/lib/fmdb/shim";
import { loadPlanBySlug } from "@/lib/fmdb/loader";
import { updatePlan } from "./actions";
import type { Plan } from "@/lib/fmdb/types";
import path from "node:path";
import fs from "node:fs/promises";

const FMDB_PLANS_DIR = process.env.FMDB_PLANS_DIR ?? `${process.env.HOME}/fm-plans`;

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface PlanChatResult {
  ok: boolean;
  reply?: string;
  updated?: boolean; // true if a patch was applied
  error?: string;
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

  // Only allow chat on drafts
  const status = (plan.status ?? plan._bucket) as string;
  if (status !== "draft") {
    return { ok: false, error: `Plan is ${status} — only draft plans can be edited via chat.` };
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
    error?: string;
  };

  if (!result.ok) {
    return { ok: false, error: result.error ?? "Unknown error" };
  }

  const reply = result.reply ?? "Done.";
  const patch = result.patch ?? {};

  // Apply patch if non-empty
  let updated = false;
  if (Object.keys(patch).length > 0) {
    const applyResult = await updatePlan(slug, patch as Partial<Plan>);
    if (!applyResult.ok) {
      return { ok: false, error: (applyResult as { ok: false; error: string }).error };
    }
    updated = true;
  }

  return { ok: true, reply, updated };
}
