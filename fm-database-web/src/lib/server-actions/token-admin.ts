"use server";

/**
 * Coach-facing token administration — one place to see every live public
 * bearer URL (PHI behind a link) and revoke a leaked one.
 *
 * Read side: listIssuedTokens() flattens all clients + plans into IssuedToken[]
 * (pure flattening lives in token-admin-types.ts).
 *
 * Revoke side: revokeToken() dispatches to the right underlying action per
 * kind. intake + start_confirmation reuse the battle-tested actions; app +
 * letter clear the field on disk and re-stage so the public host drops it too.
 */

import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { dumpYaml } from "@/lib/fmdb/yaml-dump";
import { revalidatePath } from "next/cache";
import { getPlansRoot } from "@/lib/fmdb/paths";
import { loadAllClients, loadAllPlans } from "@/lib/fmdb/loader";
import {
  buildIssuedTokens,
  type IssuedToken,
  type TokenKind,
} from "@/lib/fmdb/token-admin-types";
import { stageClientAppArtifacts, stageDiscoveryClientArtifacts } from "./letter-token";
import { revokeIntakeToken } from "./intake";
import { revokeStartConfirmToken } from "./plans";

function publicBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "https://intake.theochretree.com").replace(/\/+$/, "");
}

/** Enumerate every issued token across all clients and plans. */
export async function listIssuedTokens(): Promise<IssuedToken[]> {
  const [clients, plans] = await Promise.all([loadAllClients(), loadAllPlans()]);
  const nameById = new Map<string, string>();
  for (const c of clients as unknown as Record<string, unknown>[]) {
    const id = typeof c.client_id === "string" ? c.client_id : "";
    const name = typeof c.display_name === "string" ? c.display_name : "";
    if (id) nameById.set(id, name || id);
  }
  const tokens = buildIssuedTokens(
    clients as unknown as Record<string, unknown>[],
    plans as unknown as (Record<string, unknown> & { _bucket?: string })[],
    publicBaseUrl(),
    Date.now(),
  );
  // Fill display names on plan-level rows (plans only carry client_id).
  for (const t of tokens) {
    if (t.clientName === t.clientId) t.clientName = nameById.get(t.clientId) ?? t.clientId;
  }
  return tokens;
}

/** Newest published <slug>-vN.yaml path for a plan slug, or null. */
async function newestPublishedFile(planSlug: string): Promise<string | null> {
  const dir = path.join(getPlansRoot(), "published");
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return null;
  }
  const matches = entries
    .filter((n) => n.startsWith(`${planSlug}-v`) && (n.endsWith(".yaml") || n.endsWith(".yml")))
    .sort()
    .reverse();
  return matches.length ? path.join(dir, matches[0]) : null;
}

/** Latest published plan slug for a client, or null. */
async function latestPublishedSlug(clientId: string): Promise<string | null> {
  const dir = path.join(getPlansRoot(), "published");
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return null;
  }
  let best: { slug: string; version: number } | null = null;
  for (const name of entries) {
    if (!name.endsWith(".yaml") && !name.endsWith(".yml")) continue;
    try {
      const d = yaml.load(await fs.readFile(path.join(dir, name), "utf-8")) as Record<
        string,
        unknown
      > | null;
      if (!d || d.client_id !== clientId) continue;
      const slug = typeof d.slug === "string" ? d.slug : "";
      const v = typeof d.version === "number" ? d.version : 0;
      if (slug && (!best || v > best.version)) best = { slug, version: v };
    } catch {
      /* skip */
    }
  }
  return best?.slug ?? null;
}

/** Clear client.yaml#app_token and re-stage so the public host drops the link. */
async function revokeAppToken(
  clientId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!clientId) return { ok: false, error: "missing_client_id" };
  const clientYaml = path.join(getPlansRoot(), "clients", clientId, "client.yaml");
  let data: Record<string, unknown>;
  try {
    data = yaml.load(await fs.readFile(clientYaml, "utf-8")) as Record<string, unknown>;
  } catch {
    return { ok: false, error: "client_not_found" };
  }
  if (!data.app_token) return { ok: true }; // already gone
  delete data.app_token;
  delete data.app_token_created_at;
  await fs.writeFile(clientYaml, dumpYaml(data, { sortKeys: false }), "utf-8");
  // Re-project to Fly so the cleared token is reflected on the public host.
  const slug = await latestPublishedSlug(clientId);
  if (slug) await stageClientAppArtifacts(clientId, slug).catch(() => {});
  else await stageDiscoveryClientArtifacts(clientId).catch(() => {});
  return { ok: true };
}

/** Clear letter_token / short_code on the newest published plan + re-stage. */
async function revokeLetterToken(
  planSlug: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!planSlug) return { ok: false, error: "missing_plan_slug" };
  const file = await newestPublishedFile(planSlug);
  if (!file) return { ok: false, error: "plan_not_published" };
  let data: Record<string, unknown>;
  try {
    data = yaml.load(await fs.readFile(file, "utf-8")) as Record<string, unknown>;
  } catch {
    return { ok: false, error: "read_failed" };
  }
  if (!data.letter_token) return { ok: true };
  const clientId = typeof data.client_id === "string" ? data.client_id : "";
  delete data.letter_token;
  delete data.letter_token_created_at;
  delete data.letter_short_code;
  await fs.writeFile(file, dumpYaml(data, { sortKeys: false }), "utf-8");
  if (clientId) await stageClientAppArtifacts(clientId, planSlug).catch(() => {});
  return { ok: true };
}

export interface RevokeTokenInput {
  kind: TokenKind;
  clientId?: string;
  planSlug?: string;
}

/** Revoke one token by kind. Returns {ok} or {ok:false,error}. */
export async function revokeToken(
  input: RevokeTokenInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let res: { ok: true } | { ok: false; error: string };
  switch (input.kind) {
    case "app":
      res = await revokeAppToken(input.clientId ?? "");
      break;
    case "letter":
      res = await revokeLetterToken(input.planSlug ?? "");
      break;
    case "intake":
      res = await revokeIntakeToken(input.clientId ?? "");
      break;
    case "start_confirmation":
      res = await revokeStartConfirmToken(input.planSlug ?? "");
      break;
    default:
      res = { ok: false, error: "unknown_kind" };
  }
  if (res.ok) revalidatePath("/token-admin");
  return res;
}
