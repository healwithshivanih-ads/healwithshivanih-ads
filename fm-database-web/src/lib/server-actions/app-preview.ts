"use server";

/**
 * Coach-side control of the client app — "the coach should know and be able
 * to edit, at all times, what the client is seeing" (coach rule 2026-06-12).
 *
 * loadAppPreviewAction reuses the app's OWN loader (same token path), so
 * the preview can never drift from what the client actually sees. Hides
 * are written to clients/<id>/app-overrides.yaml, which the loader filters
 * server-side — a hidden remedy disappears from the app's shelf AND its
 * search. Assigned remedies are removed via the existing plan write
 * (setClientRemedies), not the overrides file.
 */

import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { revalidatePath } from "next/cache";
import { getPlansRoot } from "@/lib/fmdb/paths";
import { loadClientAppData } from "@/lib/fmdb/client-app";
import { readAppOpens } from "@/lib/fmdb/app-opens";
import { readAppInstalled } from "@/lib/fmdb/app-installed";

export interface AppPreviewRemedy {
  slug: string;
  name: string;
  category: string;
  when?: string;
  whyFor?: string;
  buyUrl?: string;
  /** auto-suggested by relevance scoring (the shelf) vs coach-assigned */
  suggested: boolean;
  /** coach already reviewed this suggestion (Keep) */
  approved: boolean;
}

export interface AppPreviewMenuDay {
  dow: string;
  dateLabel?: string;
  slots: { slot: string; dish: string; overridden: boolean }[];
}

export interface AppPreview {
  ok: true;
  planSlug: string;
  /** the client's app token — powers the live phone-frame preview */
  token: string;
  supplements: { name: string; dose: string; timing: string; buyUrl?: string; linkSource?: string }[];
  assigned: AppPreviewRemedy[];
  suggested: AppPreviewRemedy[];
  hidden: string[];
  menu: { isSample: boolean; weeks: number; days: number; groceryGenerated: boolean };
  /** parsed recipes available to the app — 0 with a live menu = gap */
  recipeCount: number;
  /** the full menu grids, exactly as the app renders them */
  weekMenus: { week: number; days: AppPreviewMenuDay[] }[];
  practices: string[];
  resources: { title: string; kind: string }[];
  lessons: string[];
  /** app adoption — real client opens (Fly only; coach previews excluded) */
  access: {
    lastOpenedAt: string | null; // ISO of the client's most recent app open
    openCount: number;
    installed: boolean; // added to home screen (or coach-confirmed)
    firstInstalledAt: string | null;
  };
}

export type AppPreviewResult = AppPreview | { ok: false; error: string };

interface Overrides {
  hidden_remedies?: string[];
  approved_suggestions?: string[];
  /** "<week>|<dayIdx>|<slot lowercase>" → replacement dish text */
  meal_overrides?: Record<string, string>;
}

function overridesPath(clientId: string): string {
  return path.join(getPlansRoot(), "clients", clientId, "app-overrides.yaml");
}

async function readOverrides(clientId: string): Promise<Overrides> {
  try {
    return (yaml.load(await fs.readFile(overridesPath(clientId), "utf-8")) as Overrides) ?? {};
  } catch {
    return {};
  }
}

async function writeOverrides(clientId: string, ov: Overrides): Promise<void> {
  await fs.writeFile(
    overridesPath(clientId),
    yaml.dump(
      { ...ov, updated_at: new Date().toISOString() },
      { sortKeys: false },
    ),
    "utf-8",
  );
}

async function appTokenFor(clientId: string): Promise<string | null> {
  try {
    const c = yaml.load(
      await fs.readFile(path.join(getPlansRoot(), "clients", clientId, "client.yaml"), "utf-8"),
    ) as { app_token?: string };
    if (c?.app_token) return c.app_token;
  } catch {
    /* fall through to plan token */
  }
  try {
    const dir = path.join(getPlansRoot(), "published");
    for (const n of (await fs.readdir(dir)).sort().reverse()) {
      if (!n.endsWith(".yaml")) continue;
      const p = yaml.load(await fs.readFile(path.join(dir, n), "utf-8")) as {
        client_id?: string;
        letter_token?: string;
      };
      if (p?.client_id === clientId && p.letter_token) return p.letter_token;
    }
  } catch {
    /* none */
  }
  return null;
}

export async function loadAppPreviewAction(clientId: string): Promise<AppPreviewResult> {
  const token = await appTokenFor(clientId);
  if (!token) return { ok: false, error: "No app/letter token yet — share the app first." };
  const data = await loadClientAppData(token);
  if (!data) return { ok: false, error: "Could not load the client app data." };
  const ov = await readOverrides(clientId);
  const approved = new Set(ov.approved_suggestions ?? []);

  // "edited" chips come from the plan's app_menu original-markers (Option A)
  const editedKeys = new Set<string>();
  try {
    const f = await publishedFileFor(data.planSlug);
    if (f) {
      const doc = yaml.load(await fs.readFile(f, "utf-8")) as {
        app_menu?: { weeks?: { week?: number; days?: { slots?: { slot?: string; original?: string }[] }[] }[] };
      };
      for (const w of doc?.app_menu?.weeks ?? [])
        (w.days ?? []).forEach((d, di) =>
          (d.slots ?? []).forEach((s) => {
            if (s.original !== undefined) editedKeys.add(`${w.week}|${di}|${(s.slot ?? "").toLowerCase()}`);
          }),
        );
    }
  } catch {
    /* no markers */
  }

  const [opens, install] = await Promise.all([readAppOpens(clientId), readAppInstalled(clientId)]);

  const toRow = (r: (typeof data.remedies)[number], suggested: boolean): AppPreviewRemedy => ({
    slug: r.slug,
    name: r.name,
    category: r.category,
    when: r.when,
    whyFor: (r as { whyFor?: string }).whyFor,
    buyUrl: r.buyUrl,
    suggested,
    approved: approved.has(r.slug),
  });

  return {
    ok: true,
    planSlug: data.planSlug,
    token,
    supplements: data.supplements.map((s) => ({
      name: s.name,
      dose: s.dose,
      timing: s.timing,
      buyUrl: s.buyUrl,
      linkSource: s.buyUrl
        ? s.buyUrl.includes("vitaone")
          ? "VitaOne"
          : s.buyUrl.includes("fmnutrition")
            ? "FM Nutrition"
            : s.buyUrl.includes("amazon")
              ? "Amazon"
              : "Custom"
        : undefined,
    })),
    assigned: data.remedies.filter((r) => r.assigned).map((r) => toRow(r, false)),
    suggested: data.remedyShelf.map((r) => toRow(r, true)),
    hidden: ov.hidden_remedies ?? [],
    menu: {
      isSample: data.menuIsSample,
      weeks: data.weekMenus.length,
      days: data.weekMenus[0]?.days.length ?? 0,
      groceryGenerated: !!data.grocery,
    },
    recipeCount: data.recipePack.length,
    weekMenus: data.weekMenus.map((w) => ({
      week: w.week,
      days: w.days.map((d, di) => ({
        dow: d.dow,
        dateLabel: d.dateLabel,
        slots: d.slots.map((s) => ({
          slot: s.slot,
          dish: s.dish,
          overridden: editedKeys.has(`${w.week}|${di}|${s.slot.toLowerCase()}`),
        })),
      })),
    })),
    practices: data.practices.map((p) => p.name),
    resources: data.resources.map((r) => ({ title: r.title, kind: r.kind })),
    lessons: data.lessons.map((l) => l.title),
    access: {
      lastOpenedAt: opens.lastOpenedAt,
      openCount: opens.count,
      installed: install.installed,
      firstInstalledAt: install.firstInstalledAt,
    },
  };
}

/** Hide (or unhide) a remedy from the client's app shelf + search. */
export async function setRemedyHiddenAction(
  clientId: string,
  slug: string,
  hidden: boolean,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const ov = await readOverrides(clientId);
    const set = new Set(ov.hidden_remedies ?? []);
    if (hidden) set.add(slug);
    else set.delete(slug);
    await writeOverrides(clientId, { ...ov, hidden_remedies: [...set] });
    revalidatePath(`/clients-v2/${clientId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "write failed" };
  }
}

async function publishedFileFor(planSlug: string): Promise<string | null> {
  const dir = path.join(getPlansRoot(), "published");
  try {
    const match = (await fs.readdir(dir))
      .filter((n) => n.startsWith(`${planSlug}-v`) && n.endsWith(".yaml"))
      .sort()
      .reverse()[0];
    return match ? path.join(dir, match) : null;
  } catch {
    return null;
  }
}

/** Replace (or reset) one dish on the client's menu — OPTION A: this
 *  edits the published plan's app_menu DIRECTLY (the source of truth),
 *  preserving the original dish so Reset always works, appending to the
 *  plan's amendment log, and bumping app_content_updated_at so the
 *  client's app shows its "Plan updated" banner. */
export async function setMealOverrideAction(
  clientId: string,
  week: number,
  dayIdx: number,
  slot: string,
  dish: string | null,
): Promise<{ ok: boolean; error?: string }> {
  try {
    // loading the app data guarantees app_menu exists (self-migration)
    const token = await appTokenFor(clientId);
    if (!token) return { ok: false, error: "No app token for this client." };
    const data = await loadClientAppData(token);
    if (!data) return { ok: false, error: "Could not load app data." };
    const file = await publishedFileFor(data.planSlug);
    if (!file) return { ok: false, error: "Published plan not found." };

    const doc = (yaml.load(await fs.readFile(file, "utf-8")) as Record<string, unknown>) ?? {};
    const menu = doc.app_menu as { weeks?: { week?: number; days?: { slots?: { slot?: string; dish?: string; original?: string }[] }[] }[] } | undefined;
    const wk = menu?.weeks?.find((w) => Number(w.week) === week);
    const day = wk?.days?.[dayIdx];
    if (!day) return { ok: false, error: "That day isn't on the structured menu yet — reload and retry." };
    day.slots = day.slots ?? [];
    let entry = day.slots.find((s) => (s.slot ?? "").toLowerCase() === slot.toLowerCase());

    let summary: string;
    if (dish && dish.trim()) {
      if (!entry) {
        entry = { slot, dish: "", original: "" };
        day.slots.push(entry);
      }
      if (entry.original === undefined) entry.original = entry.dish ?? "";
      summary = `Week ${week}, day ${dayIdx + 1}, ${slot}: "${entry.dish || "—"}" → "${dish.trim()}"`;
      entry.dish = dish.trim();
    } else {
      if (!entry || entry.original === undefined)
        return { ok: true }; // nothing to reset
      summary = `Week ${week}, day ${dayIdx + 1}, ${slot}: reset to "${entry.original || "—"}"`;
      entry.dish = entry.original;
      delete entry.original;
      if (!entry.dish) day.slots = day.slots.filter((s) => s !== entry);
    }

    const amendments = Array.isArray(doc.amendments) ? (doc.amendments as unknown[]) : [];
    amendments.push({ at: new Date().toISOString(), by: "Shivani", field: "app_menu", summary });
    doc.amendments = amendments;
    doc.app_content_updated_at = new Date().toISOString();

    const tmp = `${file}.tmp-${process.pid}`;
    await fs.writeFile(tmp, yaml.dump(doc, { sortKeys: false, lineWidth: 100 }), "utf-8");
    await fs.rename(tmp, file);
    revalidatePath(`/clients-v2/${clientId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "write failed" };
  }
}

/** Mark an auto-suggested remedy as coach-reviewed (clears the flag). */
export async function approveSuggestionAction(
  clientId: string,
  slug: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const ov = await readOverrides(clientId);
    const set = new Set(ov.approved_suggestions ?? []);
    set.add(slug);
    await writeOverrides(clientId, { ...ov, approved_suggestions: [...set] });
    revalidatePath(`/clients-v2/${clientId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "write failed" };
  }
}

/** Save a coach referral buy link for a product (remedy or supplement) into
 *  supplement_links.yaml. VitaOne links get the referral code appended when
 *  missing; everything else is saved as pasted. */
export async function saveBuyLinkAction(
  key: string,
  displayName: string,
  rawUrl: string,
): Promise<{ ok: boolean; error?: string }> {
  let url = rawUrl.trim();
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: "That doesn't look like a URL." };
  // VitaOne's attributing param is ?ref= (confirmed on the product page:
  // "orders placed from it will be attributed to you"). Guard against BOTH
  // ref= and the legacy pr= so we never double-append a referral.
  if (/vitaone\.in/i.test(url) && !/[?&](ref|pr)=vita/i.test(url))
    url += (url.includes("?") ? "&" : "?") + "ref=vita13720sh";
  try {
    const file = path.join(getPlansRoot(), "supplement_links.yaml");
    const links =
      ((yaml.load(await fs.readFile(file, "utf-8").catch(() => "")) as Record<string, unknown>) ??
        {}) as Record<string, unknown>;
    const k = key
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    links[k] = {
      display_name: displayName,
      url,
      source: /vitaone/i.test(url)
        ? "vitaone"
        : /amazon/i.test(url)
          ? "amazon"
          : /fmnutrition/i.test(url)
            ? "fmnutrition"
            : "custom",
      category: "supplement",
      notes: "Added from the coach app-preview panel.",
    };
    await fs.writeFile(file, yaml.dump(links, { sortKeys: true }), "utf-8");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "write failed" };
  }
}
/** Generate (or regenerate) the structured app menu straight onto the
 *  published plan — NO letter. Reuses the meal-plan letter's full
 *  constraint engine via scripts/generate-app-menu.py; first generation
 *  anchors meal_plan_started_on (Day 1 = menu goes live in the app,
 *  coach decision 2026-06-12). ~1–2 min Sonnet call. */
export async function generateAppMenuAction(
  clientId: string,
  planSlug: string,
  weeks: number[] = [1, 2],
): Promise<{ ok: boolean; weeks?: number; dishes?: number; day1?: string | null; error?: string }> {
  try {
    const { runShim } = await import("@/lib/fmdb/shim");
    const res = (await runShim(
      "generate-app-menu.py",
      { client_id: clientId, plan_slug: planSlug, weeks },
      360_000,
    )) as { ok: boolean; weeks?: number; dishes?: number; day1_anchored?: string | null; error?: string };
    if (!res.ok) return { ok: false, error: res.error || "generation failed" };
    revalidatePath(`/clients-v2/${clientId}`);
    return { ok: true, weeks: res.weeks, dishes: res.dishes, day1: res.day1_anchored ?? null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "generation failed" };
  }
}
