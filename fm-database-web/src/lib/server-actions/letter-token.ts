"use server";

/**
 * Public letter access: token → {clientId, planSlug} resolver.
 *
 * Mirrors the /intake/<token> security model. Each published plan gets
 * a URL-safe random token written to plan.letter_token; the public
 * /letter/<token> route looks up the plan by scanning published/ for
 * the matching token. Revoking a plan clears the token so the URL
 * 404s.
 *
 * Read-side here; the write-side (token generation at publish time)
 * lives in the Python plan-publish flow. The TypeScript layer just
 * reads.
 */

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import yaml from "js-yaml";
import { getPlansRoot } from "@/lib/fmdb/paths";

export interface LetterTokenLookup {
  ok: true;
  client_id: string;
  plan_slug: string;
}

export type LetterTokenResult = LetterTokenLookup | { ok: false; error: string };

/** Scan ~/fm-plans/published/*.yaml for a plan with the given letter_token.
 *  Cheap enough — typical coach has <100 published plans, all under 50KB. */
export async function lookupLetterToken(token: string): Promise<LetterTokenResult> {
  if (!token || token.length < 16) return { ok: false, error: "invalid_token" };
  const root = getPlansRoot();
  const dir = path.join(root, "published");
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return { ok: false, error: "no_published_plans" };
  }
  for (const name of entries) {
    if (!name.endsWith(".yaml") && !name.endsWith(".yml")) continue;
    try {
      const raw = await fs.readFile(path.join(dir, name), "utf-8");
      const data = yaml.load(raw) as Record<string, unknown> | null;
      if (!data) continue;
      if (data.letter_token !== token) continue;
      const clientId = data.client_id as string | undefined;
      const planSlug = data.slug as string | undefined;
      if (!clientId || !planSlug) continue;
      return { ok: true, client_id: clientId, plan_slug: planSlug };
    } catch {
      /* skip corrupt files */
    }
  }
  return { ok: false, error: "not_found" };
}

/** Generate a URL-safe token. 32 chars after base64url → ~192 bits. */
function newLetterToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

/**
 * Lazily ensure a published plan has a letter_token. Reads the published
 * plan YAML, returns the existing token if present, otherwise generates,
 * writes back, and returns the new token. Idempotent.
 *
 * Returns null if the plan isn't published (no token issued for drafts).
 */
export async function ensureLetterToken(
  planSlug: string,
): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const root = getPlansRoot();
  const dir = path.join(root, "published");
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return { ok: false, error: "no_published_plans" };
  }
  // Versioned filename pattern: <slug>-v<N>.yaml. Pick newest match.
  const matches = entries
    .filter((n) => n.startsWith(`${planSlug}-v`) && (n.endsWith(".yaml") || n.endsWith(".yml")))
    .sort()
    .reverse();
  if (matches.length === 0) return { ok: false, error: "plan_not_published" };
  const filePath = path.join(dir, matches[0]);
  const raw = await fs.readFile(filePath, "utf-8");
  const data = yaml.load(raw) as Record<string, unknown>;
  if (typeof data.letter_token === "string" && data.letter_token.length >= 16) {
    return { ok: true, token: data.letter_token };
  }
  const token = newLetterToken();
  data.letter_token = token;
  data.letter_token_created_at = new Date().toISOString();
  await fs.writeFile(filePath, yaml.dump(data, { sortKeys: false }), "utf-8");
  return { ok: true, token };
}
