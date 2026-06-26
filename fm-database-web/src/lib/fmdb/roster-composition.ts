/**
 * Roster composition extras — top symptoms + root causes across clients.
 *
 * Companion to the pure computePracticeOverview (which derives top conditions
 * with no I/O). Symptoms + root causes need a session scan, so they live here
 * as an async reader (batched, like getClientHealthSignals): per client, union
 * `selected_symptoms` + `ai_analysis.likely_drivers[].mechanism_slug`, then
 * count clients per item.
 */
import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { getPlansRoot } from "./paths";

type Dict = Record<string, unknown>;

export interface CompositionItem {
  label: string;
  count: number;
}
export interface RosterComposition {
  symptoms: CompositionItem[];
  drivers: CompositionItem[];
}

const CAP = 6;

const prettifySlug = (s: string): string => {
  const t = s.replace(/[-_]+/g, " ").trim();
  return t ? t[0].toUpperCase() + t.slice(1) : s;
};

async function scanSets(root: string, clientId: string): Promise<{ symptoms: Set<string>; drivers: Set<string> }> {
  const dir = path.join(root, "clients", clientId, "sessions");
  const symptoms = new Set<string>();
  const drivers = new Set<string>();
  let names: string[];
  try {
    names = (await fs.readdir(dir)).filter((n) => n.endsWith(".yaml") || n.endsWith(".yml"));
  } catch {
    return { symptoms, drivers };
  }
  for (const n of names) {
    let s: Dict | null = null;
    try {
      s = yaml.load(await fs.readFile(path.join(dir, n), "utf-8")) as Dict;
    } catch {
      continue;
    }
    if (!s) continue;
    const sel = s.selected_symptoms;
    if (Array.isArray(sel)) for (const x of sel) if (typeof x === "string" && x.trim()) symptoms.add(x.trim().toLowerCase());
    const ai = s.ai_analysis as Dict | undefined;
    const ld = ai?.likely_drivers;
    if (Array.isArray(ld))
      for (const d of ld) {
        const slug = (d as Dict)?.mechanism_slug;
        if (typeof slug === "string" && slug.trim()) drivers.add(slug.trim().toLowerCase());
      }
  }
  return { symptoms, drivers };
}

export async function getRosterComposition(clients: { client_id: string }[]): Promise<RosterComposition> {
  const root = getPlansRoot();
  const sets = await Promise.all(clients.map((c) => scanSets(root, c.client_id)));
  const symCount = new Map<string, number>();
  const drvCount = new Map<string, number>();
  for (const s of sets) {
    for (const sl of s.symptoms) symCount.set(sl, (symCount.get(sl) ?? 0) + 1);
    for (const sl of s.drivers) drvCount.set(sl, (drvCount.get(sl) ?? 0) + 1);
  }
  const top = (m: Map<string, number>): CompositionItem[] =>
    [...m.entries()]
      .map(([k, v]) => ({ label: prettifySlug(k), count: v }))
      .sort((a, b) => b.count - a.count)
      .slice(0, CAP);
  return { symptoms: top(symCount), drivers: top(drvCount) };
}
