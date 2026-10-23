import "server-only";

/**
 * Food diary — the disk half. See food-diary.ts for the shape and the why.
 *
 * Writes go to `_food_diary.<this host>.jsonl` only (currentHost() from the
 * chat thread, so both features agree on what "this host" is): the client's
 * photos land in the Fly file, the coach's corrections in the Mac file, and
 * app-staging-action.py copies each across without ever writing into the
 * other host's file. Reads merge every `_food_diary.*.jsonl` present.
 */
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { clientDir, currentHost } from "./client-thread";
import { getPlansRoot } from "./paths";
import {
  foldDiary,
  parseDiaryConfig,
  parseDiaryLines,
  type DiaryLine,
  type FoldedDiary,
  type FoodDiaryConfig,
} from "./food-diary";

export function diaryFileName(host: string): string {
  const safe = host.replace(/[^a-z0-9]/gi, "").toLowerCase() || "unknown";
  return `_food_diary.${safe}.jsonl`;
}

/** Append one event. Returns false when the client has no directory. */
export function appendDiaryLine(clientId: string, line: DiaryLine): boolean {
  const dir = clientDir(clientId);
  if (!dir) return false;
  fs.appendFileSync(path.join(dir, diaryFileName(currentHost())), JSON.stringify(line) + "\n", {
    encoding: "utf8",
    mode: 0o600,
  });
  return true;
}

/** Every host's lines, unsorted. */
export function readDiaryLines(clientId: string): DiaryLine[] {
  const dir = clientDir(clientId);
  if (!dir) return [];
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out: DiaryLine[] = [];
  for (const n of names) {
    if (!/^_food_diary\.[a-z0-9]+\.jsonl$/.test(n)) continue;
    try {
      out.push(...parseDiaryLines(fs.readFileSync(path.join(dir, n), "utf8")));
    } catch {
      /* unreadable file — the other host's copy still reads */
    }
  }
  return out;
}

/** The diary switch on client.yaml, or null. */
export function readDiaryConfig(clientId: string): FoodDiaryConfig | null {
  const dir = clientDir(clientId);
  if (!dir) return null;
  try {
    const doc = yaml.load(fs.readFileSync(path.join(dir, "client.yaml"), "utf8")) as Record<string, unknown> | null;
    return parseDiaryConfig(doc?.food_diary);
  } catch {
    return null;
  }
}

export function loadDiary(clientId: string, cfg: FoodDiaryConfig): FoldedDiary {
  return foldDiary(readDiaryLines(clientId), cfg.id);
}

/** The client's calendar day — client.yaml#timezone, else IST. */
export function diaryToday(doc: Record<string, unknown> | null | undefined): string {
  const tz = typeof doc?.timezone === "string" && doc.timezone.trim() ? doc.timezone.trim() : "Asia/Kolkata";
  try {
    return new Date().toLocaleDateString("en-CA", { timeZone: tz });
  } catch {
    return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  }
}

/** Everyone with a diary switch on client.yaml (clients + parked prospects). */
export function listDiaryClients(): { clientId: string; doc: Record<string, unknown>; cfg: FoodDiaryConfig }[] {
  const out: { clientId: string; doc: Record<string, unknown>; cfg: FoodDiaryConfig }[] = [];
  const root = getPlansRoot();
  for (const bucket of ["clients", "prospects"]) {
    let names: string[] = [];
    try {
      names = fs.readdirSync(path.join(root, bucket));
    } catch {
      continue;
    }
    for (const id of names) {
      const file = path.join(root, bucket, id, "client.yaml");
      let raw: string;
      try {
        raw = fs.readFileSync(file, "utf8");
      } catch {
        continue;
      }
      if (!raw.includes("food_diary:")) continue; // cheap skip before parsing
      try {
        const doc = (yaml.load(raw) ?? {}) as Record<string, unknown>;
        const cfg = parseDiaryConfig(doc.food_diary);
        if (cfg) out.push({ clientId: id, doc, cfg });
      } catch {
        /* a client.yaml js-yaml cannot parse is the integrity cron's job */
      }
    }
  }
  return out;
}

/** The client's published plan (for a prescribed protein powder), or null. */
export function publishedPlanFor(clientId: string): Record<string, unknown> | null {
  const dir = path.join(getPlansRoot(), "published");
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".yaml"));
  } catch {
    return null;
  }
  let best: Record<string, unknown> | null = null;
  for (const f of files) {
    try {
      const d = yaml.load(fs.readFileSync(path.join(dir, f), "utf8")) as Record<string, unknown> | null;
      if (!d || d.client_id !== clientId) continue;
      if (!best || String(d.plan_period_start ?? "") > String(best.plan_period_start ?? "")) best = d;
    } catch {
      /* skip malformed */
    }
  }
  return best;
}

export interface StoredDiarySummary {
  session_id: string;
  line: string;
  fingerprint: string;
}

/** The summary session already written for this diary, if any. */
export function readDiarySummary(clientId: string, diaryId: string): StoredDiarySummary | null {
  const dir = clientDir(clientId);
  if (!dir) return null;
  let names: string[] = [];
  try {
    names = fs.readdirSync(path.join(dir, "sessions")).filter((n) => n.endsWith("-app-fooddiary.yaml"));
  } catch {
    return null;
  }
  for (const n of names) {
    try {
      const d = yaml.load(fs.readFileSync(path.join(dir, "sessions", n), "utf8")) as Record<string, unknown> | null;
      const s = d?.food_diary_summary as Record<string, unknown> | undefined;
      if (s && s.diary_id === diaryId) {
        return { session_id: String(d?.session_id ?? n.replace(/\.yaml$/, "")), line: String(s.line ?? ""), fingerprint: String(s.fingerprint ?? "") };
      }
    } catch {
      /* skip */
    }
  }
  return null;
}
