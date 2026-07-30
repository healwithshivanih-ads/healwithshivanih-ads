"use server";

/**
 * Retiring a condition without losing it.
 *
 * `active_conditions` is a flat list of free text with no notion of resolved,
 * temporary or severe — so a bout of constipation that cleared in a fortnight
 * sat beside chronic hypertension forever, and 71 files that read the field
 * had no way to tell them apart. It surfaced on a real client: his app led
 * with a constipation reading while his blood pressure and thyroid were
 * nowhere, and the coach's only choices were to delete the condition (losing
 * the history) or leave it wrong.
 *
 * No new field. `medical_history` already exists for exactly this — "past
 * diagnoses, in-remission conditions, prior dx with current status" — and is
 * consumed correctly everywhere: it feeds lab-vault relevance (a cleared
 * episode IS still context for a lab result) but never renders as something
 * the client currently has, and never drives the mind-body read. So resolving
 * is a MOVE between two existing lists, which means all 71 consumers do the
 * right thing with no change at all.
 *
 * Kept as its own module rather than another flag on `updateClientProfile`
 * because it is a distinct clinical act — "this is over" — and should be one
 * greppable place when someone asks why a condition stopped appearing.
 */

import fs from "node:fs/promises";
import path from "node:path";

import yaml from "js-yaml";
import { revalidatePath } from "next/cache";

import { getPlansRoot } from "@/lib/fmdb/paths";
import { resolvedLabel, stripResolvedStamp } from "@/lib/fmdb/condition-status";
import { dumpYaml } from "@/lib/fmdb/yaml-dump";

type Dict = Record<string, unknown>;

async function readClient(clientId: string): Promise<{ file: string; data: Dict }> {
  if (!clientId || clientId.includes("/") || clientId.includes("..")) {
    throw new Error("valid clientId required");
  }
  const file = path.join(getPlansRoot(), "clients", clientId, "client.yaml");
  const data = (yaml.load(await fs.readFile(file, "utf8")) ?? {}) as Dict;
  return { file, data };
}

async function writeClient(file: string, data: Dict, clientId: string): Promise<void> {
  await fs.writeFile(file, dumpYaml(data, { noRefs: true, sortKeys: false }), "utf8");
  for (const p of [
    `/clients-v2/${clientId}`,
    `/clients-v2/${clientId}/plan`,
    `/clients-v2/${clientId}/sessions`,
    "/clients-v2",
    "/dashboard-v2",
  ]) {
    revalidatePath(p);
  }
}

const asArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : "")).filter(Boolean) : [];

export type ConditionStatusResult =
  | { ok: true; active: string[]; history: string[] }
  | { ok: false; error: string };

/**
 * Move one condition out of `active_conditions` and into `medical_history`,
 * stamped with the month it was retired.
 */
export async function resolveCondition(
  clientId: string,
  condition: string,
): Promise<ConditionStatusResult> {
  try {
    const target = condition.trim();
    if (!target) return { ok: false, error: "condition required" };
    const { file, data } = await readClient(clientId);

    const active = asArr(data.active_conditions);
    const idx = active.findIndex((c) => c.trim() === target);
    if (idx < 0) return { ok: false, error: `"${target}" is not an active condition` };

    const history = asArr(data.medical_history);
    const entry = resolvedLabel(target, new Date());
    // Don't double-record if this was resolved, reactivated and resolved again.
    const already = history.some((h) => stripResolvedStamp(h) === target);

    data.active_conditions = active.filter((_, i) => i !== idx);
    data.medical_history = already ? history : [...history, entry];
    await writeClient(file, data, clientId);
    return { ok: true, active: data.active_conditions as string[], history: data.medical_history as string[] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** The reverse — it came back. Restores the original wording, unstamped. */
export async function reactivateCondition(
  clientId: string,
  historyEntry: string,
): Promise<ConditionStatusResult> {
  try {
    const target = historyEntry.trim();
    if (!target) return { ok: false, error: "entry required" };
    const { file, data } = await readClient(clientId);

    const history = asArr(data.medical_history);
    const idx = history.findIndex((h) => h.trim() === target);
    if (idx < 0) return { ok: false, error: `"${target}" is not in medical history` };

    const restored = stripResolvedStamp(target);
    const active = asArr(data.active_conditions);
    data.medical_history = history.filter((_, i) => i !== idx);
    data.active_conditions = active.some((c) => c.trim() === restored)
      ? active
      : [...active, restored];
    await writeClient(file, data, clientId);
    return { ok: true, active: data.active_conditions as string[], history: data.medical_history as string[] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
