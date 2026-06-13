"use server";

/**
 * Deferred / revisit-later plan items — dashboard surfacing + coach decisions.
 *
 * The assess AI sometimes holds an intervention back with a clinical gate
 * (e.g. Niti's seed cycling: "Revisit AFTER the day-21 progesterone workup").
 * Today that lives only as prose in plan.notes_for_coach, so it's invisible
 * unless someone reads the plan. These actions surface every such item on the
 * coach dashboard and let the coach act on it:
 *
 *   • Override — make the clinical call to include it now. Records the
 *     decision and appends a plan amendment so the NEXT menu/plan regeneration
 *     picks it up. Nothing in the plan content changes until that regen
 *     (coach decision 2026-06-13: "record + flag for inclusion").
 *   • Snooze until lab back — hide it until the revisit gate marker lands on
 *     file, then it reappears automatically.
 *
 * Decisions are stored in a sidecar (~/fm-plans/_deferred_items.yaml) keyed by
 * "<plan-stem>::<item-key>", so the Pydantic Plan model is untouched (lower
 * risk than a schema change on published PHI). The only write to the plan YAML
 * itself is appending an amendment on override — the same shape the menu
 * approve flow already uses.
 */

import path from "path";
import fs from "node:fs/promises";
import { revalidatePath } from "next/cache";
import yaml from "js-yaml";
import { getPlansRoot } from "@/lib/fmdb/paths";
import {
  parseDeferredItems,
  collectMarkerNames,
  markerPresent,
} from "@/lib/fmdb/deferred-items";

interface SidecarEntry {
  status?: "overridden" | "snoozed" | "dismissed";
  note?: string;
  decided_by?: string;
  decided_at?: string;
  flagged_for_inclusion?: boolean;
  snooze_markers?: string[];
  snooze_until?: string | null;
}
type Sidecar = Record<string, SidecarEntry>;

function sidecarPath(): string {
  return path.join(getPlansRoot(), "_deferred_items.yaml");
}
async function readSidecar(): Promise<Sidecar> {
  try {
    return (yaml.load(await fs.readFile(sidecarPath(), "utf-8")) as Sidecar) ?? {};
  } catch {
    return {};
  }
}
async function writeSidecar(s: Sidecar): Promise<void> {
  const tmp = `${sidecarPath()}.tmp-${process.pid}`;
  await fs.writeFile(tmp, yaml.dump(s, { sortKeys: false, lineWidth: 100 }), "utf-8");
  await fs.rename(tmp, sidecarPath());
}

function planStem(slugOrFile: string): string {
  return slugOrFile.replace(/\.yaml$/, "").replace(/-v\d+$/, "");
}
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

async function readClient(clientId: string): Promise<unknown | null> {
  if (!clientId) return null;
  try {
    const p = path.join(getPlansRoot(), "clients", clientId, "client.yaml");
    return (yaml.load(await fs.readFile(p, "utf-8")) as unknown) ?? null;
  } catch {
    return null;
  }
}

/** Highest-version published file for a plan stem. */
async function publishedFile(stem: string): Promise<string | null> {
  const dir = path.join(getPlansRoot(), "published");
  try {
    const matches = (await fs.readdir(dir))
      .filter((n) => n.endsWith(".yaml") && planStem(n) === stem)
      .sort();
    if (matches.length) return path.join(dir, matches[matches.length - 1]);
  } catch {
    /* none */
  }
  return null;
}

// ── List ─────────────────────────────────────────────────────────────────────

export interface DeferredRow {
  key: string; // sidecar key "<stem>::<item-key>"
  client_id: string;
  display_name: string | null;
  plan_slug: string; // stem
  item_key: string;
  title: string;
  body: string;
  gate_text: string;
  gate_markers: string[];
  gate_ready: boolean; // a watched gate marker is already on file
}

export async function listDeferredItemsAction(): Promise<
  { ok: true; rows: DeferredRow[] } | { ok: false; error: string }
> {
  try {
    const dir = path.join(getPlansRoot(), "published");
    let files: string[] = [];
    try {
      files = (await fs.readdir(dir)).filter((n) => n.endsWith(".yaml"));
    } catch {
      return { ok: true, rows: [] };
    }
    const sidecar = await readSidecar();

    // Dedupe by stem, keep the highest version (sorted ascending → last wins).
    const byStem = new Map<string, Record<string, unknown>>();
    for (const n of files.sort()) {
      const doc = (yaml.load(await fs.readFile(path.join(dir, n), "utf-8")) as Record<
        string,
        unknown
      >) ?? {};
      byStem.set(planStem(String(doc.slug || n)), doc);
    }

    const rows: DeferredRow[] = [];
    const today = todayIso();
    const clientCache = new Map<string, string[]>();

    for (const [stem, doc] of byStem) {
      if (doc.status && doc.status !== "published") continue;
      const items = parseDeferredItems(String(doc.notes_for_coach || ""));
      if (items.length === 0) continue;
      const clientId = String(doc.client_id || "");

      let markerNames = clientCache.get(clientId);
      let client: unknown = null;
      if (!markerNames) {
        client = await readClient(clientId);
        markerNames = collectMarkerNames(client);
        clientCache.set(clientId, markerNames);
      } else {
        client = await readClient(clientId);
      }
      const displayName =
        (client as { display_name?: unknown } | null)?.display_name != null
          ? String((client as { display_name?: unknown }).display_name)
          : null;

      for (const it of items) {
        const key = `${stem}::${it.itemKey}`;
        const sc = sidecar[key];
        if (sc?.status === "overridden" || sc?.status === "dismissed") continue;
        if (sc?.status === "snoozed") {
          const byMarker =
            (sc.snooze_markers?.length ?? 0) > 0 &&
            markerPresent(markerNames, sc.snooze_markers!);
          const byDate = !!sc.snooze_until && today >= sc.snooze_until;
          if (!byMarker && !byDate) continue; // still snoozed
        }
        rows.push({
          key,
          client_id: clientId,
          display_name: displayName,
          plan_slug: stem,
          item_key: it.itemKey,
          title: it.title,
          body: it.body,
          gate_text: it.gateText,
          gate_markers: it.gateMarkers,
          gate_ready: it.gateMarkers.length > 0 && markerPresent(markerNames, it.gateMarkers),
        });
      }
    }

    // Gate-ready (lab is back, ready to decide) first.
    rows.sort((a, b) => Number(b.gate_ready) - Number(a.gate_ready));
    return { ok: true, rows };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to load" };
  }
}

// ── Override ──────────────────────────────────────────────────────────────────

export async function overrideDeferredItemAction(
  planSlug: string,
  itemKey: string,
  title: string,
  note: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const stem = planStem(planSlug);
    const key = `${stem}::${itemKey}`;
    const cleanNote = (note || "").trim();

    const sidecar = await readSidecar();
    sidecar[key] = {
      ...(sidecar[key] || {}),
      status: "overridden",
      flagged_for_inclusion: true,
      note: cleanNote,
      decided_by: "coach",
      decided_at: new Date().toISOString(),
      snooze_markers: undefined,
      snooze_until: undefined,
    };
    await writeSidecar(sidecar);

    // Append an amendment so the next menu/plan regeneration sees the override.
    const file = await publishedFile(stem);
    if (file) {
      const doc = (yaml.load(await fs.readFile(file, "utf-8")) as Record<string, unknown>) ?? {};
      const amendments = Array.isArray(doc.amendments) ? doc.amendments : [];
      amendments.push({
        at: new Date().toISOString(),
        by: "coach",
        field: "app_menu",
        summary:
          `Coach override — INCLUDE previously-deferred "${title}" in the next menu/plan regeneration.` +
          (cleanNote ? ` Note: ${cleanNote}` : ""),
      });
      doc.amendments = amendments;
      const tmp = `${file}.tmp-${process.pid}`;
      await fs.writeFile(tmp, yaml.dump(doc, { sortKeys: false, lineWidth: 100 }), "utf-8");
      await fs.rename(tmp, file);
    }

    revalidatePath("/dashboard-v2");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed" };
  }
}

// ── Snooze until lab back ─────────────────────────────────────────────────────

export async function snoozeDeferredItemAction(
  planSlug: string,
  itemKey: string,
  gateMarkers: string[],
): Promise<{ ok: boolean; error?: string; markers?: string[]; until?: string }> {
  try {
    const stem = planStem(planSlug);
    const key = `${stem}::${itemKey}`;

    // Watch only markers NOT already on file (else it would un-snooze instantly).
    const file = await publishedFile(stem);
    let clientId = "";
    if (file) {
      const doc = (yaml.load(await fs.readFile(file, "utf-8")) as Record<string, unknown>) ?? {};
      clientId = String(doc.client_id || "");
    }
    const present = collectMarkerNames(await readClient(clientId));
    const absent = (gateMarkers || []).filter((g) => !markerPresent(present, [g]));

    const sidecar = await readSidecar();
    const entry: SidecarEntry = {
      ...(sidecar[key] || {}),
      status: "snoozed",
      decided_by: "coach",
      decided_at: new Date().toISOString(),
      flagged_for_inclusion: undefined,
    };
    if (absent.length > 0) {
      entry.snooze_markers = absent;
      entry.snooze_until = null;
    } else {
      // No watchable absent marker — fall back to a 30-day time snooze.
      const d = new Date();
      d.setDate(d.getDate() + 30);
      entry.snooze_markers = [];
      entry.snooze_until = d.toISOString().slice(0, 10);
    }
    sidecar[key] = entry;
    await writeSidecar(sidecar);

    revalidatePath("/dashboard-v2");
    return { ok: true, markers: entry.snooze_markers, until: entry.snooze_until ?? undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed" };
  }
}
