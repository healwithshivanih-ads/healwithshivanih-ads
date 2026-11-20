import "server-only";

/**
 * Supplement supply — the disk half. See supply.ts for the shape and the why.
 * Writes go to `_supply.<this host>.jsonl` only; reads merge every host's file.
 * app-staging-action.py copies Fly's file back to the Mac.
 */
import fs from "node:fs";
import path from "node:path";
import { clientDir, currentHost } from "./client-thread";
import { foldSupply, parseSupplyLines, type ItemSupply, type SupplyLine } from "./supply";

export function supplyFileName(host: string): string {
  return `_supply.${host.replace(/[^a-z0-9]/gi, "").toLowerCase() || "unknown"}.jsonl`;
}

export function appendSupplyLine(clientId: string, line: SupplyLine): boolean {
  const dir = clientDir(clientId);
  if (!dir) return false;
  fs.appendFileSync(path.join(dir, supplyFileName(currentHost())), JSON.stringify(line) + "\n", {
    encoding: "utf8",
    mode: 0o600,
  });
  return true;
}

export function loadSupply(clientId: string): Record<string, ItemSupply> {
  const dir = clientDir(clientId);
  if (!dir) return {};
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return {};
  }
  const lines: SupplyLine[] = [];
  for (const n of names) {
    if (!/^_supply\.[a-z0-9]+\.jsonl$/.test(n)) continue;
    try {
      lines.push(...parseSupplyLines(fs.readFileSync(path.join(dir, n), "utf8")));
    } catch {
      /* the other host's copy still reads */
    }
  }
  return foldSupply(lines);
}
