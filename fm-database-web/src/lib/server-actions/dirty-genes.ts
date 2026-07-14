"use server";

/**
 * Server actions for the coach-side "Dirty Genes" pathway-burden screen.
 *
 *   loadDirtyGenesQuestionnaire  — reads the catalogue data file
 *   loadClientSnps               — pulls any genetic-report SNPs on file
 *                                  (overlay context; nudge, not verdict)
 *   saveDirtyGenesAssessment     — persists a completed screen to the client dir
 *   loadLatestDirtyGenesAssessment — rehydrates the most recent screen
 *
 * Scoring itself is pure (src/lib/fmdb/dirty-genes.ts) so it runs live in the
 * browser as the coach ticks boxes. These actions only touch disk.
 */

import path from "path";
import fs from "node:fs/promises";
import { revalidatePath } from "next/cache";
import { getCataloguePath, getPlansRoot } from "@/lib/fmdb/paths";
import { dumpYaml } from "@/lib/fmdb/yaml-dump";
import type { DgQuestionnaire, ClientSnp } from "@/lib/fmdb/dirty-genes";

async function readYaml<T>(fp: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(fp, "utf-8");
    const yaml = await import("js-yaml");
    return (yaml.load(raw) as T) ?? null;
  } catch {
    return null;
  }
}

export async function loadDirtyGenesQuestionnaire(): Promise<{
  ok: boolean;
  questionnaire: DgQuestionnaire | null;
  error?: string;
}> {
  const fp = path.join(getCataloguePath(), "dirty_genes_assessment.yaml");
  const q = await readYaml<DgQuestionnaire>(fp);
  if (!q || !Array.isArray(q.pathways)) {
    return { ok: false, questionnaire: null, error: "questionnaire data not found" };
  }
  return { ok: true, questionnaire: q };
}

/** Collect SNPs from any genetic reports saved under the client's
 *  functional_tests dir (parse-genetic-report.py writes test_type: genetic). */
export async function loadClientSnps(
  clientId: string,
): Promise<{ ok: boolean; snps: ClientSnp[]; sourceCount: number; error?: string }> {
  try {
    const dir = path.join(getPlansRoot(), "clients", clientId, "functional_tests");
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      return { ok: true, snps: [], sourceCount: 0 };
    }
    const snps: ClientSnp[] = [];
    let sourceCount = 0;
    for (const name of entries) {
      if (!name.endsWith(".yaml")) continue;
      const parsed = await readYaml<Record<string, unknown>>(path.join(dir, name));
      if (!parsed) continue;
      const isGenetic =
        String(parsed.test_type ?? "").toLowerCase() === "genetic" ||
        Array.isArray(parsed.snps);
      if (!isGenetic || !Array.isArray(parsed.snps)) continue;
      sourceCount += 1;
      for (const s of parsed.snps as ClientSnp[]) {
        if (s && (s.gene || s.rsid)) snps.push(s);
      }
    }
    return { ok: true, snps, sourceCount };
  } catch (e) {
    return { ok: false, snps: [], sourceCount: 0, error: String(e) };
  }
}

export interface SaveDirtyGenesInput {
  clientId: string;
  checkedIds: string[];
  /** free coach note */
  note?: string;
  /** snapshot of pathway bands at save time (for quick history reading) */
  summary?: Array<{ id: string; label: string; band: string; fraction: number }>;
}

export async function saveDirtyGenesAssessment(
  input: SaveDirtyGenesInput,
): Promise<{ ok: boolean; filePath?: string; error?: string }> {
  try {
    const { clientId, checkedIds, note, summary } = input;
    if (!clientId) return { ok: false, error: "clientId required" };
    const dir = path.join(getPlansRoot(), "clients", clientId, "dirty_genes");
    await fs.mkdir(dir, { recursive: true });
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const record = {
      kind: "dirty_genes_screen",
      framework: "Dirty Genes (Ben Lynch, 2018) — functional pathway-burden screen",
      client_id: clientId,
      screen_date: date,
      recorded_at: now.toISOString(),
      checked_item_ids: checkedIds,
      pathway_summary: summary ?? [],
      coach_note: note ?? "",
      scope_note:
        "Coaching screen. Functional burden from symptoms + lifestyle, not a genetic diagnosis.",
    };
    const fp = path.join(dir, `dirty-genes-${date}.yaml`);
    await fs.writeFile(fp, dumpYaml(record), "utf-8");
    revalidatePath(`/clients-v2/${clientId}`);
    revalidatePath(`/clients-v2/${clientId}/dirty-genes`);
    return { ok: true, filePath: fp };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function loadLatestDirtyGenesAssessment(
  clientId: string,
): Promise<{
  ok: boolean;
  checkedIds: string[];
  note: string;
  screenDate?: string;
  error?: string;
}> {
  try {
    const dir = path.join(getPlansRoot(), "clients", clientId, "dirty_genes");
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      return { ok: true, checkedIds: [], note: "" };
    }
    const yamls = entries.filter((n) => n.endsWith(".yaml")).sort().reverse();
    if (!yamls.length) return { ok: true, checkedIds: [], note: "" };
    const parsed = await readYaml<Record<string, unknown>>(path.join(dir, yamls[0]));
    if (!parsed) return { ok: true, checkedIds: [], note: "" };
    return {
      ok: true,
      checkedIds: Array.isArray(parsed.checked_item_ids)
        ? (parsed.checked_item_ids as string[])
        : [],
      note: typeof parsed.coach_note === "string" ? parsed.coach_note : "",
      screenDate: parsed.screen_date as string | undefined,
    };
  } catch (e) {
    return { ok: false, checkedIds: [], note: "", error: String(e) };
  }
}
