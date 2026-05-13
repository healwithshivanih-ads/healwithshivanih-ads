"use server";

import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { revalidatePath } from "next/cache";
import { getPlansRoot } from "@/lib/fmdb/paths";
import { loadClientById } from "@/lib/fmdb/loader-extras";
import { loadPlanBySlug } from "@/lib/fmdb/loader";
import {
  detectPlanConflicts,
  type ConflictFix,
  type PlanConflict,
} from "@/lib/fmdb/plan-conflicts";

/**
 * Run the rules-based conflict detector for a client + their active plan.
 * Server-only because it reads YAML directly off disk.
 */
export async function runConflictCheckAction(
  clientId: string,
  planSlug: string | undefined,
): Promise<{ ok: true; conflicts: PlanConflict[] } | { ok: false; error: string }> {
  try {
    const client = await loadClientById(clientId);
    if (!client) return { ok: false, error: "Client not found" };
    const plan = planSlug ? await loadPlanBySlug(planSlug) : null;
    const conflicts = detectPlanConflicts(
      client as unknown as Parameters<typeof detectPlanConflicts>[0],
      (plan as unknown as Record<string, unknown>) ?? null,
    );
    return { ok: true, conflicts };
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? String(err) };
  }
}

/**
 * Apply a single ConflictFix to the underlying YAML. Returns ok:true on
 * success so the panel can drop the conflict from the list and refresh
 * the plan page. Re-runs revalidatePath for the relevant routes.
 */
export async function applyConflictFixAction(
  clientId: string,
  fix: ConflictFix,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const clientFile = path.join(
      getPlansRoot(),
      "clients",
      clientId,
      "client.yaml",
    );
    const raw = await fs.readFile(clientFile, "utf-8");
    const data = (yaml.load(raw) as Record<string, unknown>) ?? {};

    switch (fix.type) {
      case "patch_client_field": {
        // Whitelist of fields we permit auto-patching to. Block anything
        // sensitive (medications / allergies require coach review).
        const ALLOWED = new Set([
          "dietary_preference",
          "non_negotiables",
          "foods_to_avoid",
          "reported_triggers",
          "notes",
        ]);
        if (!ALLOWED.has(fix.field)) {
          return {
            ok: false,
            error: `Field ${fix.field} not allowed for auto-patch`,
          };
        }
        data[fix.field] = fix.value;
        break;
      }
      case "append_client_note": {
        const existing = typeof data.notes === "string" ? data.notes : "";
        const stamp = new Date().toISOString().slice(0, 10);
        const line = `[${stamp}] ${fix.text}`;
        data.notes = existing.trim() ? `${existing.trim()}\n${line}` : line;
        break;
      }
    }
    data.updated_at = new Date().toISOString();
    await fs.writeFile(
      clientFile,
      yaml.dump(data, { noRefs: true, sortKeys: false }),
      "utf-8",
    );
    revalidatePath(`/clients-v2/${clientId}`);
    revalidatePath(`/clients-v2/${clientId}/plan`);
    revalidatePath(`/clients/${clientId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? String(err) };
  }
}
