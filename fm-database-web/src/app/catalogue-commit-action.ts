"use server";

import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { getCataloguePath } from "@/lib/fmdb/paths";

const exec = promisify(execFile);

const REPO_ROOT = path.resolve(getCataloguePath(), "..",".."); // fm-database/data → monorepo root
const DATA_DIR  = path.join("fm-database", "data");            // relative path for git add

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME:    "Shivani",
  GIT_AUTHOR_EMAIL:   "shivanihari@gmail.com",
  GIT_COMMITTER_NAME: "Shivani",
  GIT_COMMITTER_EMAIL:"shivanihari@gmail.com",
};

export interface CatalogueStatus {
  modified: number;
  added: number;
  // entity breakdown
  topics: number;
  mechanisms: number;
  symptoms: number;
  supplements: number;
  claims: number;
  sources: number;
  other: number;
}

export interface CommitResult {
  ok: boolean;
  message?: string;
  error?: string;
}

/** Count uncommitted changes in fm-database/data/ */
export async function getCatalogueStatus(): Promise<CatalogueStatus> {
  try {
    const { stdout } = await exec("git", ["status", "--short", "--", DATA_DIR], {
      cwd: REPO_ROOT,
      env: GIT_ENV,
    });

    const lines = stdout.trim().split("\n").filter(Boolean);
    let modified = 0, added = 0;
    let topics = 0, mechanisms = 0, symptoms = 0;
    let supplements = 0, claims = 0, sources = 0, other = 0;

    for (const line of lines) {
      const flag = line.slice(0, 2).trim();
      if (flag === "M" || flag === "A") modified++;
      else if (flag === "??") added++;
      else modified++;

      if (line.includes("/topics/")) topics++;
      else if (line.includes("/mechanisms/")) mechanisms++;
      else if (line.includes("/symptoms/")) symptoms++;
      else if (line.includes("/supplements/")) supplements++;
      else if (line.includes("/claims/")) claims++;
      else if (line.includes("/sources/")) sources++;
      else other++;
    }

    return { modified, added, topics, mechanisms, symptoms, supplements, claims, sources, other };
  } catch {
    return { modified: 0, added: 0, topics: 0, mechanisms: 0, symptoms: 0, supplements: 0, claims: 0, sources: 0, other: 0 };
  }
}

/** Stage + commit all changes in fm-database/data/ */
export async function commitCatalogueData(message?: string): Promise<CommitResult> {
  try {
    // Stage all data changes
    await exec("git", ["add", DATA_DIR], {
      cwd: REPO_ROOT,
      env: GIT_ENV,
    });

    // Check there's actually something staged
    const { stdout: staged } = await exec("git", ["diff", "--cached", "--name-only", "--", DATA_DIR], {
      cwd: REPO_ROOT,
      env: GIT_ENV,
    });

    if (!staged.trim()) {
      return { ok: false, error: "Nothing staged — catalogue is already up to date." };
    }

    const count = staged.trim().split("\n").filter(Boolean).length;

    const commitMsg = message?.trim()
      || `catalogue: approve ${count} file${count !== 1 ? "s" : ""} from ingest batches`;

    const { stdout: commitOut } = await exec(
      "git",
      ["commit", "-m", commitMsg, "--author", "Shivani <shivanihari@gmail.com>"],
      { cwd: REPO_ROOT, env: GIT_ENV }
    );

    const sha = commitOut.match(/\[.*?([a-f0-9]{6,})\]/)?.[1] ?? "";
    return { ok: true, message: `Committed ${count} files${sha ? ` (${sha})` : ""}.` };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    // "nothing to commit" is not a real error
    if (msg.includes("nothing to commit")) {
      return { ok: false, error: "Nothing to commit — catalogue is already up to date." };
    }
    return { ok: false, error: msg };
  }
}
