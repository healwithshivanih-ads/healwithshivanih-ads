import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { resolvePersonDir } from "./person-dir";
import { dumpYaml } from "./yaml-dump";
import type { ConcernId } from "./concerns";
import { dismissConcern, mergeInterests, parseInterests, type InterestSignal } from "./interests";

/**
 * The read/write half of interests.ts. Resolves the person wherever they live
 * (clients/ or parked in prospects/) — a parked prospect is exactly the person
 * whose interests matter most for "thought of you" content.
 */

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

function recordPath(clientId: string): string {
  return path.join(resolvePersonDir(clientId), "client.yaml");
}

async function readRecord(clientId: string): Promise<Record<string, unknown> | null> {
  if (!SAFE_ID.test(clientId)) return null;
  try {
    const d = yaml.load(await fs.readFile(recordPath(clientId), "utf-8"));
    return d && typeof d === "object" ? (d as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function writeRecord(clientId: string, doc: Record<string, unknown>): Promise<void> {
  const f = recordPath(clientId);
  const tmp = `${f}.tmp-interests`;
  await fs.writeFile(tmp, dumpYaml(doc, { sortKeys: false }), "utf-8");
  await fs.rename(tmp, f);
}

export async function readInterests(clientId: string): Promise<InterestSignal[]> {
  const doc = await readRecord(clientId);
  return doc ? parseInterests(doc.interests) : [];
}

/**
 * Append signals to a person's record. No-op (no write) when nothing is new,
 * so re-running a backfill or a re-fired booking webhook never touches the
 * file.
 */
export async function addInterestSignals(
  clientId: string,
  signals: readonly InterestSignal[],
): Promise<{ ok: boolean; added: number; error?: string }> {
  if (!signals.length) return { ok: true, added: 0 };
  const doc = await readRecord(clientId);
  if (!doc) return { ok: false, added: 0, error: "client record not found" };
  const { merged, added } = mergeInterests(parseInterests(doc.interests), signals);
  if (!added.length) return { ok: true, added: 0 };
  doc.interests = merged;
  await writeRecord(clientId, doc);
  return { ok: true, added: added.length };
}

export async function dismissInterest(
  clientId: string,
  concern: ConcernId,
): Promise<{ ok: boolean; error?: string }> {
  const doc = await readRecord(clientId);
  if (!doc) return { ok: false, error: "client record not found" };
  doc.interests = dismissConcern(parseInterests(doc.interests), concern);
  await writeRecord(clientId, doc);
  return { ok: true };
}

export async function setMarketingOptOut(
  clientId: string,
  optOut: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const doc = await readRecord(clientId);
  if (!doc) return { ok: false, error: "client record not found" };
  doc.marketing_opt_out = optOut;
  doc.marketing_opt_out_at = optOut ? new Date().toISOString() : null;
  await writeRecord(clientId, doc);
  return { ok: true };
}
