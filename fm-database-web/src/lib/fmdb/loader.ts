import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { getCataloguePath, getPlansRoot } from "./paths";
import type { CatalogueKind, Plan, Client, PlanStatus } from "./types";

// Plans live under ~/fm-plans, which on the coaching Macs resolves through iCloud
// Drive's FileProvider. Under sync contention that layer intermittently returns
// EAGAIN (errno -11) — or EBUSY/EMFILE — on an otherwise-valid read, which would
// otherwise throw straight out of a dashboard RSC and 500 the whole page. Retry
// these transient errors a few times with a short backoff so one flaky read never
// takes the app down; genuine errors (ENOENT etc.) still surface immediately.
const _TRANSIENT_FS = new Set(["EAGAIN", "EBUSY", "EMFILE", "ENFILE", "EWOULDBLOCK", "ETIMEDOUT"]);

async function withFsRetry<T>(op: () => Promise<T>, attempts = 5): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await op();
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? "";
      if (!_TRANSIENT_FS.has(code) || i === attempts - 1) throw err;
      lastErr = err;
      await new Promise((r) => setTimeout(r, 60 * (i + 1) + Math.floor(Math.random() * 40)));
    }
  }
  throw lastErr;
}

async function readYaml<T>(absPath: string): Promise<T | null> {
  try {
    const raw = await withFsRetry(() => fs.readFile(absPath, "utf-8"));
    return yaml.load(raw) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function listYamlFiles(dir: string): Promise<string[]> {
  try {
    const names = await withFsRetry(() => fs.readdir(dir));
    return names
      .filter((n) => n.endsWith(".yaml") || n.endsWith(".yml"))
      .map((n) => path.join(dir, n));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

/**
 * Load every YAML in a catalogue subdirectory.
 * `kind` is the subdir name (e.g. "topics", "supplements").
 */
export async function loadAllOfKind<T>(kind: CatalogueKind): Promise<T[]> {
  const dir = path.join(getCataloguePath(), kind);
  const files = await listYamlFiles(dir);
  const results = await Promise.all(
    files.map(async (f) => {
      const data = await readYaml<T>(f);
      return data;
    })
  );
  return results.filter((r): r is Awaited<T> => r !== null) as T[];
}

export async function loadOne<T>(
  kind: CatalogueKind,
  slug: string
): Promise<T | null> {
  const dir = path.join(getCataloguePath(), kind);
  return readYaml<T>(path.join(dir, `${slug}.yaml`));
}

// ---- Plans + Clients ----

const PLAN_BUCKETS: PlanStatus[] = [
  "draft",
  "ready_to_publish",
  "published",
  "superseded",
  "revoked",
  "graduated",
];

const BUCKET_DIR: Record<PlanStatus, string> = {
  draft: "drafts",
  ready_to_publish: "ready",
  published: "published",
  superseded: "superseded",
  revoked: "revoked",
  graduated: "graduated",
};

export interface PlanWithBucket extends Plan {
  _bucket: PlanStatus;
  _file: string;
}

export async function loadAllPlans(): Promise<PlanWithBucket[]> {
  const root = getPlansRoot();
  const all: PlanWithBucket[] = [];
  for (const bucket of PLAN_BUCKETS) {
    const dir = path.join(root, BUCKET_DIR[bucket]);
    const files = await listYamlFiles(dir);
    for (const f of files) {
      const data = await readYaml<Plan>(f);
      if (data) {
        all.push({
          ...data,
          _bucket: bucket,
          _file: f,
          status: data.status ?? bucket,
        });
      }
    }
  }
  return all;
}

export async function loadPlanBySlug(
  slug: string
): Promise<PlanWithBucket | null> {
  const all = await loadAllPlans();
  return all.find((p) => p.slug === slug) ?? null;
}

export async function loadAllClients(): Promise<Client[]> {
  const root = getPlansRoot();
  const clientsDir = path.join(root, "clients");
  let entries: string[] = [];
  try {
    entries = await withFsRetry(() => fs.readdir(clientsDir));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const out: Client[] = [];
  for (const entry of entries) {
    const entryPath = path.join(clientsDir, entry);
    const stat = await withFsRetry(() => fs.stat(entryPath));
    if (stat.isDirectory()) {
      const data = await readYaml<Client>(path.join(entryPath, "client.yaml"));
      if (data) out.push(data);
    } else if (entry.endsWith(".yaml")) {
      // Legacy flat layout fallback
      const data = await readYaml<Client>(entryPath);
      if (data) out.push(data);
    }
  }
  return out;
}
