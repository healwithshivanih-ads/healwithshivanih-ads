import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { getPlansRoot } from "./paths";

/**
 * The one place a new `cl-NNN` id is picked.
 *
 * A person lives in `clients/<id>/` or, once `fmdb prospects-sweep` parks
 * them, in `prospects/<id>/` (see person-dir.ts). Parking is a MOVE, so the id
 * is still taken. Both allocators used to count `clients/` alone: on
 * 21 Nov 2026 the highest id there was cl-906 while cl-907 to cl-910 sat in
 * `prospects/`, so the next "new client" would have been handed cl-907, an id
 * that already belongs to someone else. Every reader that resolves a person by
 * id (resolvePersonDir, the Python `client_dir`) would then have two records
 * answering to one id.
 *
 * So: highest number across EVERY bucket a person can live in, plus one.
 * Ids are never reused, even when the highest one has been parked.
 */
export const PERSON_BUCKETS = ["clients", "prospects"] as const;

const ID_RE = /^cl-(\d+)(?:\.yaml)?$/;

/** Pure: the next id after the given directory / file names. */
export function nextIdAfter(names: Iterable<string>): string {
  let max = 0;
  for (const name of names) {
    const m = ID_RE.exec(name);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `cl-${String(max + 1).padStart(3, "0")}`;
}

/** The next free `cl-NNN`, counting active clients and parked prospects. */
export async function allocateNextClientId(root: string = getPlansRoot()): Promise<string> {
  const names: string[] = [];
  for (const bucket of PERSON_BUCKETS) {
    try {
      names.push(...(await fs.readdir(path.join(root, bucket))));
    } catch (err) {
      // A bucket that does not exist yet holds no ids. Anything else (a
      // permissions or I/O error) must not quietly hand out a low id.
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
  return nextIdAfter(names);
}
