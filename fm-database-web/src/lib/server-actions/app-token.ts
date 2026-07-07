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
import { dumpYaml } from "@/lib/fmdb/yaml-dump";
import { revalidatePath } from "next/cache";
import { getPlansRoot } from "@/lib/fmdb/paths";
import { stageClientAppArtifacts, stageDiscoveryClientArtifacts } from "./letter-token";
import { generateIntakeToken } from "./intake";
import { resolveDiscoveryCredit, type DiscoveryCredit } from "@/lib/fmdb/discovery-tier";

const IST = "Asia/Kolkata";

/** Today in IST as YYYY-MM-DD (en-CA formats that way). */
function istTodayYmd(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: IST });
}

/** Coerce a YAML date field to YYYY-MM-DD (js-yaml may parse it into a Date). */
function asYmd(v: unknown): string {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
  if (typeof v === "string") {
    const m = v.match(/^\d{4}-\d{2}-\d{2}/);
    return m ? m[0] : "";
  }
  return "";
}

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
  await fs.writeFile(clientYaml, dumpYaml(data, { sortKeys: false }), "utf-8");

  // Re-stage so Fly picks up the new client token
  const planSlug = await _latestPublishedPlanSlug(clientId);
  if (planSlug) {
    await stageClientAppArtifacts(clientId, planSlug).catch(() => {/* best-effort */});
  }

  return { ok: true, token };
}

/**
 * Share the app at the DISCOVERY stage — a consult-tier client with no plan yet.
 * Idempotently ensures the stable `app_token`, starts the 15-day upgrade-credit
 * window (sets `discovery_call_date` to today IST if not already set — never
 * silently resets an existing window), and projects the client to Fly so the
 * read-only discovery app resolves there. ONE token for life: the same
 * /app/<token> link flips to the full app in place once a plan is published.
 */
export async function shareDiscoveryApp(
  clientId: string,
): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const tok = await ensureClientAppToken(clientId);
  if (!tok.ok) return tok;

  // One app link, intake inside: ensure the client has an intake token so the
  // app's first onboarding step can launch the form. Only mint one if absent —
  // action_generate always rotates the token, so re-sharing must NOT invalidate
  // an intake link already sent. unlock_full: discovery clients do the full intake.
  await _ensureIntakeToken(clientId);

  // NOTE: sharing the app does NOT start the credit clock and does NOT reveal
  // recommendations — those wait for the discovery call (markDiscoveryCallDone),
  // which only happens after the client's labs are in. Sharing just opens the
  // app so the client can do their intake + book labs.
  const planSlug = await _latestPublishedPlanSlug(clientId);
  if (planSlug) {
    await stageClientAppArtifacts(clientId, planSlug).catch(() => {/* best-effort */});
  } else {
    await stageDiscoveryClientArtifacts(clientId).catch(() => {/* best-effort */});
  }
  revalidatePath(`/clients-v2/${clientId}`);
  return { ok: true, token: tok.token };
}

/**
 * Mark the discovery call done (the coach taps this after the client's labs are
 * in and the call has happened). Sets `discovery_call_date` — which REVEALS the
 * Starting Map recommendations in the app AND starts the 15-day upgrade-credit
 * countdown. Idempotent: re-tapping doesn't reset an existing window.
 */
export async function markDiscoveryCallDoneAction(
  clientId: string,
): Promise<{ ok: true; callDate: string; credit: DiscoveryCredit } | { ok: false; error: string }> {
  if (!clientId) return { ok: false, error: "missing_client_id" };
  const clientYaml = path.join(getPlansRoot(), "clients", clientId, "client.yaml");
  let data: Record<string, unknown>;
  try {
    data = yaml.load(await fs.readFile(clientYaml, "utf-8")) as Record<string, unknown>;
  } catch {
    return { ok: false, error: "client_not_found" };
  }
  let callDate = asYmd(data.discovery_call_date);
  if (!callDate) {
    callDate = istTodayYmd();
    data.discovery_call_date = callDate;
    await fs.writeFile(clientYaml, dumpYaml(data, { sortKeys: false }), "utf-8");
  }
  await stageDiscoveryClientArtifacts(clientId).catch(() => {/* best-effort */});
  const credit = resolveDiscoveryCredit(callDate, istTodayYmd());
  revalidatePath(`/clients-v2/${clientId}`);
  revalidatePath(`/clients-v2/${clientId}/analyse/discovery`);
  return { ok: true, callDate, credit };
}

/** One titled point in the Starting Map (a hypothesis or a foundational change). */
export interface DiscoverySummaryPointInput {
  title: string;
  note: string;
}
/** One coach-decided supplement in the Starting Map — the deliberate, per-client
 *  exception to "no protocol." Hard-capped at 2 below (MAX_INCLUDED_SUPPLEMENTS)
 *  regardless of what the caller sends, so this can never drift into a de-facto
 *  free protocol. */
export interface DiscoverySummarySupplementInput {
  supplementSlug?: string;
  name: string;
  dose: string;
  timing: string;
  why: string;
}

export interface DiscoverySummaryInput {
  headline: string;
  hypotheses: DiscoverySummaryPointInput[];
  foundationalChanges: DiscoverySummaryPointInput[];
  journeyPreview: string[];
  includedSupplements?: DiscoverySummarySupplementInput[];
}

const MAX_INCLUDED_SUPPLEMENTS = 2;

const _trim = (v: unknown, max: number): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

function _points(v: unknown, maxItems: number): DiscoverySummaryPointInput[] {
  if (!Array.isArray(v)) return [];
  return v
    .slice(0, maxItems)
    .map((it) => {
      const o = (it ?? {}) as Record<string, unknown>;
      return { title: _trim(o.title, 160), note: _trim(o.note, 400) };
    })
    .filter((p) => p.title || p.note);
}

function _supplements(v: unknown): Record<string, string>[] {
  if (!Array.isArray(v)) return [];
  return v
    .slice(0, MAX_INCLUDED_SUPPLEMENTS)
    .map((it) => {
      const o = (it ?? {}) as Record<string, unknown>;
      return {
        supplement_slug: _trim(o.supplementSlug, 80),
        name: _trim(o.name, 120),
        dose: _trim(o.dose, 100),
        timing: _trim(o.timing, 100),
        why: _trim(o.why, 300),
      };
    })
    .filter((s) => s.name);
}

/**
 * Author the consult-tier "Starting Map" (client.yaml#discovery_summary). Coach
 * input — bounded + trimmed, then written in the snake_case shape the client app
 * reads (parseDiscoverySummary). An entirely-empty save clears the block. Re-stages
 * to Fly so the discovery app picks it up. Does NOT touch discovery_call_date —
 * revealing the map (marking the call done) is a separate action.
 */
export async function saveDiscoverySummaryAction(
  clientId: string,
  input: DiscoverySummaryInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!clientId) return { ok: false, error: "missing_client_id" };
  const clientYaml = path.join(getPlansRoot(), "clients", clientId, "client.yaml");
  let data: Record<string, unknown>;
  try {
    data = yaml.load(await fs.readFile(clientYaml, "utf-8")) as Record<string, unknown>;
  } catch {
    return { ok: false, error: "client_not_found" };
  }
  const headline = _trim(input?.headline, 200);
  const hypotheses = _points(input?.hypotheses, 8);
  const foundational_changes = _points(input?.foundationalChanges, 8);
  const journey_preview = Array.isArray(input?.journeyPreview)
    ? input.journeyPreview.map((x) => _trim(x, 200)).filter(Boolean).slice(0, 12)
    : [];
  const included_supplements = _supplements(input?.includedSupplements);

  if (
    !headline &&
    !hypotheses.length &&
    !foundational_changes.length &&
    !journey_preview.length &&
    !included_supplements.length
  ) {
    delete data.discovery_summary; // empty → clear the map
  } else {
    data.discovery_summary = { headline, hypotheses, foundational_changes, journey_preview, included_supplements };
  }
  data.updated_at = new Date().toISOString();
  await fs.writeFile(clientYaml, dumpYaml(data, { sortKeys: false }), "utf-8");
  await stageDiscoveryClientArtifacts(clientId).catch(() => {/* best-effort */});
  revalidatePath(`/clients-v2/${clientId}`);
  revalidatePath(`/clients-v2/${clientId}/analyse/discovery`);
  return { ok: true };
}

/**
 * Ensure the client has a (non-expired) intake_token, minting one only if
 * absent. Best-effort — never blocks the share if it fails (the app falls back
 * to "your intake link is on its way"). Idempotent across re-shares.
 */
async function _ensureIntakeToken(clientId: string): Promise<void> {
  const clientYaml = path.join(getPlansRoot(), "clients", clientId, "client.yaml");
  try {
    const data = yaml.load(await fs.readFile(clientYaml, "utf-8")) as Record<string, unknown>;
    const tok = typeof data.intake_token === "string" ? data.intake_token.trim() : "";
    const exp = asYmd(data.intake_token_expires_at);
    const stillValid = tok.length >= 16 && (!exp || exp >= istTodayYmd());
    if (stillValid) return; // keep the existing link
    await generateIntakeToken(clientId, 14, true); // unlock_full for discovery
  } catch {
    /* best-effort — share still proceeds */
  }
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
