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

/**
 * Read the client's current depth, for the COACH's panel.
 *
 * The "off" fallback below is deliberate and stays. Two reasons, and both have
 * to hold or it would need the unavailable-state treatment the catalogue chips
 * got:
 *
 *  1. It is not the gate. The client app never calls this — client-app.ts reads
 *     `mind_body_depth` off the client record it already loaded. So a failure
 *     here cannot open or close anything for a client; it only mis-paints a
 *     control.
 *  2. It fails CLOSED. "off" is the most restrictive answer, matching the rule
 *     that every gate in this layer fails closed, and absent === off by design.
 *
 * That is why the failure is REPORTED rather than defaulted. The residual risk
 * is a coach reading "off" for someone actually at `deep` — on a control whose
 * whole job is recording a consent decision — and "off" is the legitimate value
 * for nearly every client, which is exactly what would make a wrong one
 * invisible. So an unreadable file returns `{ ok: false }` and the panel shows
 * no selection at all, instead of highlighting a setting nobody chose.
 *
 * The trigger is a YAML parse throw, not a missing file: js-yaml rejects a
 * duplicate top-level key that PyYAML tolerates last-wins, so the Python side
 * keeps working and never notices (the cl-021 shape — see
 * api/cron/client-yaml-integrity, and __tests__/client-yaml-unreadable.test.ts).
 * loader.ts's readYaml() guard does not help here: it logs and returns null,
 * and null collapses into the same default. The distinguishable state has to be
 * in the return type.
 *
 * Writes are unaffected either way: setMindBodyDepth re-reads the file before
 * dumping it, so a failed read here can never clobber the stored value.
 */
export async function loadMindBodyDepth(
  clientId: string,
): Promise<{ ok: true; depth: MindBodyDepth } | { ok: false; error: string }> {
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
    // Absent key === off, deliberately: there is only one state meaning
    // "not opened", and it is reached here without touching the catch.
    return { ok: true, depth: v === "full" || v === "deep" || v === "resets_only" ? v : "off" };
  } catch (e) {
    console.error(`[somatic] cannot read mind_body_depth for ${clientId}:`, e);
    return { ok: false, error: (e as Error)?.message?.split("\n")[0] ?? String(e) };
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


/**
 * Map slugs currently opened for this client by name.
 *
 * Reported rather than defaulted, for the same reason as loadMindBodyDepth and
 * with more at stake: `mind_body_shared` is the ONLY route past `coach_only`,
 * and those twelve entries are grief, recurrent pregnancy loss, infertility and
 * sexual trauma. An empty list is the overwhelmingly common true answer, so a
 * `[]` produced by an unreadable file is invisible — the coach would see every
 * map as un-shared and have no way to tell that reading was a guess.
 *
 * The panel already hides the per-map toggle while this is unknown, so an
 * unreadable file shows no toggle rather than a confident "not shared".
 */
export async function loadSharedMaps(
  clientId: string,
): Promise<{ ok: true; slugs: string[] } | { ok: false; error: string }> {
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
    const slugs = Array.isArray(d.mind_body_shared)
      ? (d.mind_body_shared as unknown[]).map(String).filter(Boolean)
      : [];
    // An absent key is a real, valid "nothing opened" — reached without the catch.
    return { ok: true, slugs };
  } catch (e) {
    console.error(`[somatic] cannot read mind_body_shared for ${clientId}:`, e);
    return { ok: false, error: (e as Error)?.message?.split("\n")[0] ?? String(e) };
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
