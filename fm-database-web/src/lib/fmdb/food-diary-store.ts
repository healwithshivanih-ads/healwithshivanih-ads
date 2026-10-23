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
