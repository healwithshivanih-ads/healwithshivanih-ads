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
 * Also manages letter_short_code — a 7-char base62 code issued
 * alongside letter_token for shorter WhatsApp-friendly share links
 * (/l/<code> → /letter/<token>). Generated lazily by ensureLetterToken.
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

/**
 * Resolve an APP token → { client_id, plan_slug }, the way the app page does.
 *
 * The companion app opens via a STABLE client-level `app_token` (survives
 * plan supersede), falling back to a per-plan `letter_token`. `loadClientAppData`
 * tries app_token FIRST — so every /api/app-* write-back route MUST use the
 * same two-path resolution, or the page loads under app_token while the POST
 * dies under letter_token-only lookup ("invalid or expired link" — exactly
 * Nidhi's case 2026-06-12: her app_token never matched any plan letter_token).
 */
export async function resolveAppToken(token: string): Promise<LetterTokenResult> {
  if (!token || token.length < 16) return { ok: false, error: "invalid_token" };
  // 1. Stable client-level app_token → latest published plan for that client.
  const clientsDir = path.join(getPlansRoot(), "clients");
  try {
    for (const id of await fs.readdir(clientsDir)) {
      const d = (await readPlanYaml(path.join(clientsDir, id, "client.yaml"))) as
        | Record<string, unknown>
        | null;
      if (!d || d.app_token !== token) continue;
      const slug = await latestPublishedSlugForClient(id);
      if (slug) return { ok: true, client_id: id, plan_slug: slug };
      // app_token matched but no published plan — surface as not_found so the
      // client sees a clean error rather than a silent fall-through.
      return { ok: false, error: "not_found" };
    }
  } catch {
    /* no clients dir — fall through to letter_token scan */
  }
  // 2. Backward-compat: per-plan letter_token (old shared links).
  return lookupLetterToken(token);
}

/** Read+parse a YAML file, null on any failure. */
async function readPlanYaml(file: string): Promise<unknown> {
  try {
    return yaml.load(await fs.readFile(file, "utf-8"));
  } catch {
    return null;
  }
}

/** Highest-version published plan slug for a client, or null. */
async function latestPublishedSlugForClient(clientId: string): Promise<string | null> {
  const dir = path.join(getPlansRoot(), "published");
  let best: { slug: string; version: number } | null = null;
  try {
    for (const name of await fs.readdir(dir)) {
      if (!name.endsWith(".yaml") && !name.endsWith(".yml")) continue;
      const d = (await readPlanYaml(path.join(dir, name))) as Record<string, unknown> | null;
      if (!d || d.client_id !== clientId) continue;
      const slug = typeof d.slug === "string" ? d.slug : null;
      if (!slug) continue;
      const v = typeof d.version === "number" ? d.version : 0;
      if (!best || v > best.version) best = { slug, version: v };
    }
  } catch {
    return null;
  }
  return best?.slug ?? null;
}

/** Generate a URL-safe token. 32 chars after base64url → ~192 bits. */
function newLetterToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

const SHORT_CODE_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** Generate a 7-char base62 short code. NOT collision-checked (caller must verify). */
function newShortCode(length = 7): string {
  const bytes = crypto.randomBytes(length * 2);
  let code = "";
  for (let i = 0; i < bytes.length && code.length < length; i++) {
    // Rejection sampling: only use bytes < 62 * floor(256/62) to avoid bias
    if (bytes[i] < 248) code += SHORT_CODE_ALPHABET[bytes[i] % 62];
  }
  // Pad with extra random picks if rejection left us short (very rare)
  while (code.length < length) {
    code += SHORT_CODE_ALPHABET[crypto.randomBytes(1)[0] % 62];
  }
  return code;
}

/** Collect every letter_short_code in use across all published plans. */
async function allLetterShortCodes(): Promise<Set<string>> {
  const root = getPlansRoot();
  const dir = path.join(root, "published");
  const codes = new Set<string>();
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return codes;
  }
  for (const name of entries) {
    if (!name.endsWith(".yaml") && !name.endsWith(".yml")) continue;
    try {
      const raw = await fs.readFile(path.join(dir, name), "utf-8");
      const d = yaml.load(raw) as Record<string, unknown> | null;
      const c = d?.letter_short_code;
      if (typeof c === "string") codes.add(c);
    } catch {
      /* skip */
    }
  }
  return codes;
}

/**
 * Lazily ensure a published plan has a letter_token (and letter_short_code).
 * Reads the published plan YAML, returns existing token if present, otherwise
 * generates, writes back, and returns the new token. Idempotent.
 *
 * Returns null if the plan isn't published (no token issued for drafts).
 */
export async function ensureLetterToken(
  planSlug: string,
): Promise<{ ok: true; token: string; short_code: string } | { ok: false; error: string }> {
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
  const hasToken = typeof data.letter_token === "string" && data.letter_token.length >= 16;
  const hasCode = typeof data.letter_short_code === "string" && data.letter_short_code.length > 0;
  if (hasToken && hasCode) {
    return { ok: true, token: data.letter_token as string, short_code: data.letter_short_code as string };
  }
  const token = hasToken ? (data.letter_token as string) : newLetterToken();
  let short_code = hasCode ? (data.letter_short_code as string) : "";
  if (!short_code) {
    const used = await allLetterShortCodes();
    for (let i = 0; i < 100; i++) {
      const candidate = newShortCode();
      if (!used.has(candidate)) { short_code = candidate; break; }
    }
    if (!short_code) return { ok: false, error: "short_code_collision" };
  }
  data.letter_token = token;
  data.letter_token_created_at = data.letter_token_created_at ?? new Date().toISOString();
  data.letter_short_code = short_code;
  await fs.writeFile(filePath, yaml.dump(data, { sortKeys: false }), "utf-8");
  await stageClientAppArtifacts(data.client_id as string, planSlug);
  return { ok: true, token, short_code };
}

/**
 * Mirror the client-facing artifacts (sanitized plan, letters, app client
 * keys) into the Fly staging tree so the public host can serve
 * /app/<token>, /letter/<token>, /recipes + /supplements for this client.
 * Without this, the staging-mode Fly machine has no published plans at all
 * and every token link dies with "link isn't active". No-op when
 * FMDB_STAGING_DIR is unset. Best-effort: a staging failure must never
 * block the coach getting her link.
 */
export async function stageClientAppArtifacts(clientId: string, planSlug: string): Promise<void> {
  if (!process.env.FMDB_STAGING_DIR || !clientId || !planSlug) return;
  try {
    const { runShim } = await import("@/lib/fmdb/shim");
    const out = (await runShim("app-staging-action.py", {
      action: "stage",
      client_id: clientId,
      plan_slug: planSlug,
    })) as { ok?: boolean; error?: string };
    if (!out.ok) console.error("[app-staging] stage failed:", out.error);
  } catch (err) {
    console.error("[app-staging] stage failed:", err);
  }
}

// ── Short-code redirect lookups ───────────────────────────────────────────────

/**
 * Resolve an intake short code → the client's intake_token so the /s/[code]
 * route can 302 to /intake/<token>.
 */
export async function lookupIntakeShortCode(
  code: string,
): Promise<{ ok: true; intake_token: string } | { ok: false }> {
  if (!code || code.length !== 7) return { ok: false };
  const clientsDir = path.join(getPlansRoot(), "clients");
  let subdirs: string[];
  try {
    subdirs = await fs.readdir(clientsDir);
  } catch {
    return { ok: false };
  }
  for (const id of subdirs) {
    const yml = path.join(clientsDir, id, "client.yaml");
    try {
      const raw = await fs.readFile(yml, "utf-8");
      const d = yaml.load(raw) as Record<string, unknown> | null;
      if (!d) continue;
      if (d.intake_short_code !== code) continue;
      const tok = d.intake_token;
      if (typeof tok !== "string" || !tok) continue;
      return { ok: true, intake_token: tok };
    } catch {
      /* skip */
    }
  }
  return { ok: false };
}

/**
 * Resolve a letter short code → the plan's letter_token so the /l/[code]
 * route can 302 to /letter/<token>.
 */
export async function lookupLetterShortCode(
  code: string,
): Promise<{ ok: true; letter_token: string } | { ok: false }> {
  if (!code || code.length !== 7) return { ok: false };
  const root = getPlansRoot();
  const dir = path.join(root, "published");
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return { ok: false };
  }
  for (const name of entries) {
    if (!name.endsWith(".yaml") && !name.endsWith(".yml")) continue;
    try {
      const raw = await fs.readFile(path.join(dir, name), "utf-8");
      const d = yaml.load(raw) as Record<string, unknown> | null;
      if (!d) continue;
      if (d.letter_short_code !== code) continue;
      const tok = d.letter_token;
      if (typeof tok !== "string" || !tok) continue;
      return { ok: true, letter_token: tok };
    } catch {
      /* skip */
    }
  }
  return { ok: false };
}
