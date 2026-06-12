"use server";

/**
 * Coach-side "Manage remedies" quick toggle.
 *
 * Lets the coach add/remove a remedy for a client AFTER the plan is published,
 * without a full re-submit/republish — driven by what the client reports
 * ("the jatamansi tea helps me sleep, the ghee milk doesn't suit me").
 *
 * Writes straight to the published plan's remedy fields + stamps
 * app_content_updated_at, which the client app reads (force-dynamic) and uses
 * to surface the "Plan updated" banner. No API calls.
 *
 * The browse/search of the full eligible library lives ONLY here (coach side);
 * the client app shows just the assigned set.
 */

import { revalidatePath } from "next/cache";
import path from "node:path";
import { promises as fs } from "node:fs";
import yaml from "js-yaml";
import { getPlansRoot } from "@/lib/fmdb/paths";
import { loadAllPlans } from "@/lib/fmdb/loader";
import { writePlan } from "@/lib/fmdb/writer";
import type { Plan } from "@/lib/fmdb/types";
import {
  loadAllRemedies,
  deriveClientGates,
  filterEligible,
  CONCERNS,
  type CatalogueRemedy,
} from "@/lib/fmdb/remedy-catalogue";

type Dict = Record<string, unknown>;

const asStrArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

async function readClient(clientId: string): Promise<Dict | null> {
  const p = path.join(getPlansRoot(), "clients", clientId, "client.yaml");
  try {
    const d = yaml.load(await fs.readFile(p, "utf-8"));
    return d && typeof d === "object" ? (d as Dict) : null;
  } catch {
    return null;
  }
}

/** Latest published plan for a client (highest version). */
async function latestPublishedPlan(clientId: string) {
  const all = await loadAllPlans();
  const mine = all.filter((p) => p._bucket === "published" && p.client_id === clientId);
  if (!mine.length) return null;
  mine.sort((a, b) => (Number(b.version ?? 0) - Number(a.version ?? 0)));
  return mine[0];
}

export interface RemedyManagerRow {
  slug: string;
  name: string;
  also: string;
  summary: string;
  route: "internal" | "external";
  concerns: string[];
  assigned: boolean;
  stub: boolean;
}

export interface RemedyManagerData {
  ok: true;
  planSlug: string;
  concerns: string[]; // concern labels present in this client's eligible set
  rows: RemedyManagerRow[];
}

export async function loadRemedyManager(
  clientId: string,
): Promise<RemedyManagerData | { ok: false; error: string }> {
  const client = await readClient(clientId);
  if (!client) return { ok: false, error: `Client ${clientId} not found` };
  const plan = await latestPublishedPlan(clientId);
  if (!plan) return { ok: false, error: "No published plan for this client yet." };

  const assignedSet = new Set([
    ...asStrArr((plan.nutrition as Dict)?.home_remedies),
    ...asStrArr((plan.ayurveda as Dict)?.remedies),
  ]);

  const gates = deriveClientGates(client);
  const eligible = filterEligible(await loadAllRemedies(), gates);
  // Always include already-assigned remedies even if they'd fail a gate now
  // (the coach prescribed them deliberately) — so unticking still works.
  const eligibleSlugs = new Set(eligible.map((r) => r.slug));
  const all = await loadAllRemedies();
  const extraAssigned = all.filter((r) => assignedSet.has(r.slug) && !eligibleSlugs.has(r.slug));

  const present = new Set<string>();
  const rows: RemedyManagerRow[] = [...eligible, ...extraAssigned]
    .map((r: CatalogueRemedy) => {
      r.concerns.forEach((c) => present.add(c));
      return {
        slug: r.slug,
        name: r.name,
        also: r.also,
        summary: r.summary,
        route: r.route,
        concerns: r.concerns,
        assigned: assignedSet.has(r.slug),
        stub: r.stub,
      };
    })
    .sort((a, b) => Number(b.assigned) - Number(a.assigned) || a.name.localeCompare(b.name));

  const concerns = CONCERNS.map((c) => c.label).filter((l) => present.has(l));
  return { ok: true, planSlug: plan.slug, concerns, rows };
}

/**
 * Set the full assigned-remedy list for a client's published plan.
 * Adds go to ayurveda.remedies (assigned, not "daily" — won't clutter the
 * Today list); removals prune from BOTH ayurveda.remedies and the daily
 * nutrition.home_remedies list so unticking always works.
 */
export async function setClientRemedies(
  clientId: string,
  desiredSlugs: string[],
  note?: string,
): Promise<{ ok: true; planSlug: string } | { ok: false; error: string }> {
  const plan = await latestPublishedPlan(clientId);
  if (!plan) return { ok: false, error: "No published plan for this client." };

  const desired = [...new Set(desiredSlugs)];
  const desiredSet = new Set(desired);

  // strip loader-only fields
  const { _bucket, _file, ...rest } = plan;
  void _bucket;
  void _file;
  const next = { ...rest } as unknown as Dict;

  const nutrition = { ...((next.nutrition as Dict) ?? {}) };
  const ayur = { ...((next.ayurveda as Dict) ?? {}) };

  // keep daily flags only for remedies still desired
  const keptDaily = asStrArr(nutrition.home_remedies).filter((s) => desiredSet.has(s));
  nutrition.home_remedies = keptDaily;
  // everything else desired is an assigned (non-daily) ayurveda remedy
  const keptDailySet = new Set(keptDaily);
  ayur.remedies = desired.filter((s) => !keptDailySet.has(s));

  next.nutrition = nutrition;
  next.ayurveda = ayur;
  next.app_content_updated_at = new Date().toISOString();
  next.updated_at = next.app_content_updated_at;
  if (note && note.trim()) next.client_update_note = note.trim();

  await writePlan(next as unknown as Plan);

  // client app is force-dynamic; revalidate coach surfaces
  revalidatePath(`/clients-v2/${clientId}`);
  revalidatePath(`/clients-v2/${clientId}/plan`);
  revalidatePath(`/plans/${plan.slug}`);
  return { ok: true, planSlug: plan.slug };
}
