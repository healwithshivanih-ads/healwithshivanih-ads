/**
 * Resolving the token that opens a client's app.
 *
 * THERE ARE TWO AND THE CLIENT-LEVEL ONE WINS. `Client.app_token` is stable
 * and survives re-plans; a plan's `letter_token` is per-plan and may simply
 * not exist. `resolveAppToken` (letter-token.ts) already tries client-first
 * for exactly this reason, and its comment warns that every app-facing path
 * MUST resolve the same way or the two disagree.
 *
 * The weekly grocery + recipe generators did not, and it cost a real client
 * real weeks. Kamla (cl-021) opens her app daily on a client-level token;
 * her plan carries no letter_token, so both generators refused with "Plan
 * has no app token yet — share the app first" and her grocery list and
 * recipe pack silently stopped regenerating. The message was not merely
 * wrong, it was misleading in the most expensive direction: it described a
 * client who had never been given the app, so the log read like an
 * onboarding to-do rather than a fault. Nidhi hit the same split on
 * 2026-06-12.
 *
 * One resolver, used by both, so a third caller cannot re-introduce it.
 */
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { getPlansRoot } from "./paths";

const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/i;

async function readYaml(file: string): Promise<Record<string, unknown> | null> {
  try {
    return (yaml.load(await fs.readFile(file, "utf-8")) as Record<string, unknown>) ?? null;
  } catch {
    return null;
  }
}

/** The client-level token, which survives re-plans. */
export async function clientAppToken(clientId: string): Promise<string | null> {
  if (!SAFE_ID.test(clientId)) return null;
  const doc = await readYaml(path.join(getPlansRoot(), "clients", clientId, "client.yaml"));
  const t = doc?.app_token;
  return typeof t === "string" && t.length >= 16 ? t : null;
}

/**
 * The token to open this client's app with — client-level first, then the
 * plan's own. Returns null only when the app genuinely has not been shared.
 */
export async function resolveClientAppToken(
  clientId: string,
  planLetterToken: string | null | undefined,
): Promise<string | null> {
  return (await clientAppToken(clientId)) ?? (planLetterToken || null);
}
