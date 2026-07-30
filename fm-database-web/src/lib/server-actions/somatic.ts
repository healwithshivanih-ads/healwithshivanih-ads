"use server";

/**
 * Chief-complaint somatic read — coach-side only.
 *
 * Deterministic and free: no API call. It resolves the client's own recorded
 * conditions against the catalogue, so the cost of showing it is a file read.
 */

import { runShim } from "@/lib/fmdb/shim";

export interface SomaticRoot {
  pattern: string;
  note: string;
}

export interface SomaticReadItem {
  condition: string;
  target_slug: string;
  /** the map itself — the key `setMapShared` opens */
  map_slug: string;
  display_name: string;
  sensitivity: "general" | "sensitive" | "coach_only" | string;
  /** coach_only_note is set — never auto-surface, whatever the client's depth */
  gated: boolean;
  /** safe to show unsupervised at the client's `full` depth */
  client_safe: boolean;
  themes: string[];
  roots: SomaticRoot[];
  reframe: string;
  inquiry_question: string;
  somatic_practice: string;
  differential_note: string;
}

export async function loadSomaticRead(
  clientId: string,
): Promise<{ ok: true; reads: SomaticReadItem[] } | { ok: false; error: string }> {
  if (!clientId) return { ok: false, error: "clientId required" };
  try {
    const out = (await runShim("somatic-read.py", { client_id: clientId })) as {
      ok?: boolean;
      reads?: SomaticReadItem[];
      error?: string;
    } | null;
    if (!out?.ok) return { ok: false, error: out?.error || "read failed" };
    return { ok: true, reads: out.reads ?? [] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** What the client may be shown of the mind-body layer, unsupervised. */
export type MindBodyDepth = "off" | "resets_only" | "full" | "deep";

export async function loadMindBodyDepth(
  clientId: string,
): Promise<MindBodyDepth> {
  try {
    const yaml = await import("js-yaml");
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const { getPlansRoot } = await import("@/lib/fmdb/paths");
    const raw = await fs.readFile(
      path.join(getPlansRoot(), "clients", clientId, "client.yaml"),
      "utf8",
    );
    const d = (yaml.load(raw) ?? {}) as Record<string, unknown>;
    const v = typeof d.mind_body_depth === "string" ? d.mind_body_depth.trim().toLowerCase() : "";
    return v === "full" || v === "deep" || v === "resets_only" ? v : "off";
  } catch {
    return "off";
  }
}

/**
 * Open (or close) the mind-body layer for ONE client.
 *
 * Deliberately its own action rather than another field on
 * `updateClientProfile`: this decides whether a person is shown an emotional
 * reading of their illness without a coach present, and it should be greppable
 * as the single place that changes.
 */
export async function setMindBodyDepth(
  clientId: string,
  depth: MindBodyDepth,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!clientId || clientId.includes("/") || clientId.includes("..")) {
    return { ok: false, error: "valid clientId required" };
  }
  if (!["off", "resets_only", "full", "deep"].includes(depth)) {
    return { ok: false, error: `unknown depth ${depth}` };
  }
  try {
    const yaml = await import("js-yaml");
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const { getPlansRoot } = await import("@/lib/fmdb/paths");
    const { dumpYaml } = await import("@/lib/fmdb/yaml-dump");
    const { revalidatePath } = await import("next/cache");

    const file = path.join(getPlansRoot(), "clients", clientId, "client.yaml");
    const data = (yaml.load(await fs.readFile(file, "utf8")) ?? {}) as Record<string, unknown>;
    // "off" clears the key rather than writing a value — absent and off must
    // stay the same thing, so there is only one state meaning "not opened".
    if (depth === "off") delete data.mind_body_depth;
    else data.mind_body_depth = depth;

    await fs.writeFile(file, dumpYaml(data, { noRefs: true, sortKeys: false }), "utf8");
    revalidatePath(`/clients-v2/${clientId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}


/** Map slugs currently opened for this client by name. */
export async function loadSharedMaps(clientId: string): Promise<string[]> {
  try {
    const yaml = await import("js-yaml");
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const { getPlansRoot } = await import("@/lib/fmdb/paths");
    const raw = await fs.readFile(
      path.join(getPlansRoot(), "clients", clientId, "client.yaml"),
      "utf8",
    );
    const d = (yaml.load(raw) ?? {}) as Record<string, unknown>;
    return Array.isArray(d.mind_body_shared)
      ? (d.mind_body_shared as unknown[]).map(String).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

/**
 * Open (or close) ONE map for ONE client.
 *
 * The only route past `coach_only`, and deliberately the narrowest one there
 * is: a slug, a client, an act. Twelve entries sit behind it including
 * recurrent pregnancy loss and pelvic-floor dysfunction, and none of them
 * should ever open because a setting was flipped weeks ago for someone else.
 */
export async function setMapShared(
  clientId: string,
  mapSlug: string,
  shared: boolean,
): Promise<{ ok: true; shared: string[] } | { ok: false; error: string }> {
  if (!clientId || clientId.includes("/") || clientId.includes("..")) {
    return { ok: false, error: "valid clientId required" };
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(mapSlug)) {
    return { ok: false, error: "valid map slug required" };
  }
  try {
    const yaml = await import("js-yaml");
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const { getPlansRoot } = await import("@/lib/fmdb/paths");
    const { dumpYaml } = await import("@/lib/fmdb/yaml-dump");
    const { revalidatePath } = await import("next/cache");

    const file = path.join(getPlansRoot(), "clients", clientId, "client.yaml");
    const data = (yaml.load(await fs.readFile(file, "utf8")) ?? {}) as Record<string, unknown>;
    const cur: string[] = Array.isArray(data.mind_body_shared)
      ? (data.mind_body_shared as unknown[]).map(String).filter(Boolean)
      : [];
    const next = shared
      ? Array.from(new Set([...cur, mapSlug]))
      : cur.filter((s) => s !== mapSlug);
    if (next.length) data.mind_body_shared = next;
    else delete data.mind_body_shared;

    await fs.writeFile(file, dumpYaml(data, { noRefs: true, sortKeys: false }), "utf8");
    revalidatePath(`/clients-v2/${clientId}`);
    return { ok: true, shared: next };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
