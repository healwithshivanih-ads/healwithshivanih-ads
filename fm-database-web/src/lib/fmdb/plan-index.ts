import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { getPlansRoot } from "./paths";

/** client_ids with ANY plan (draft, ready, published). */
export async function clientsWithPlans(): Promise<Set<string>> {
  const root = getPlansRoot();
  const out = new Set<string>();
  for (const bucket of ["drafts", "ready", "published"]) {
    let files: string[] = [];
    try {
      files = await fs.readdir(path.join(root, bucket));
    } catch {
      continue;
    }
    for (const f of files) {
      if (!/\.ya?ml$/.test(f)) continue;
      try {
        // client_id sits near the top of every plan; a regex read avoids
        // parsing ~50 large YAML files on every scan.
        const head = (await fs.readFile(path.join(root, bucket, f), "utf-8")).slice(0, 4000);
        const m = head.match(/^client_id:\s*['"]?([A-Za-z0-9_-]+)/m);
        if (m) out.add(m[1]);
      } catch {
        /* one unreadable plan must not empty the scan */
      }
    }
  }
  return out;
}
