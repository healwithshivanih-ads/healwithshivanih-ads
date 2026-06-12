"use server";

/**
 * Stable per-client app token — one token per client, forever.
 *
 * The companion app (/app/<app_token>) resolves to whatever published plan
 * that client has CURRENTLY — so the link survives plan superseding without
 * the coach needing to re-share it.
 *
 * The token is stored in client.yaml#app_token (same YAML, different key
 * from letter_token which lives on the plan). Generated lazily on first
 * "Get app link" click; never changes after that.
 */

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import yaml from "js-yaml";
import { getPlansRoot } from "@/lib/fmdb/paths";
import { stageClientAppArtifacts } from "./letter-token";

function newAppToken(): string {
  // 32 URL-safe chars — same entropy as letter_token
  return crypto.randomBytes(24).toString("base64url");
}

/**
 * Lazily ensure client.yaml has an app_token. Returns the existing token if
 * already set, otherwise generates one, writes it, and returns the new one.
 * Idempotent — safe to call on every "Get app link" click.
 */
export async function ensureClientAppToken(
  clientId: string,
): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  if (!clientId) return { ok: false, error: "missing_client_id" };
  const clientYaml = path.join(getPlansRoot(), "clients", clientId, "client.yaml");
  let raw: string;
  try {
    raw = await fs.readFile(clientYaml, "utf-8");
  } catch {
    return { ok: false, error: "client_not_found" };
  }
  const data = yaml.load(raw) as Record<string, unknown>;
  if (typeof data.app_token === "string" && data.app_token.length >= 16) {
    return { ok: true, token: data.app_token };
  }
  const token = newAppToken();
  data.app_token = token;
  data.app_token_created_at = new Date().toISOString();
  await fs.writeFile(clientYaml, yaml.dump(data, { sortKeys: false }), "utf-8");

  // Re-stage so Fly picks up the new client token
  const planSlug = await _latestPublishedPlanSlug(clientId);
  if (planSlug) {
    await stageClientAppArtifacts(clientId, planSlug).catch(() => {/* best-effort */});
  }

  return { ok: true, token };
}

async function _latestPublishedPlanSlug(clientId: string): Promise<string | null> {
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
      const raw = await fs.readFile(path.join(dir, name), "utf-8");
      const d = yaml.load(raw) as Record<string, unknown> | null;
      if (!d || d.client_id !== clientId) continue;
      const v = typeof d.version === "number" ? d.version : 0;
      const slug = typeof d.slug === "string" ? d.slug : "";
      if (!slug) continue;
      if (!best || v > best.version) best = { slug, version: v };
    } catch {
      /* skip corrupt files */
    }
  }
  return best?.slug ?? null;
}
