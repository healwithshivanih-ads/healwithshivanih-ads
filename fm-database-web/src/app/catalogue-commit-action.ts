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

/** Per-file row in the change breakdown — gives coach concrete diffs to
 *  audit before clicking Commit. `status` is the two-char git porcelain
 *  flag ("M ", " M", "??", "A ", "D " etc.). */
export interface CatalogueFile {
  path: string;       // relative to repo root, e.g. "fm-database/data/topics/foo.yaml"
  kind: CatalogueFileKind;
  status: string;     // git porcelain flag
  slug: string;       // basename minus .yaml
}

export type CatalogueFileKind =
  | "topic"
  | "mechanism"
  | "symptom"
  | "supplement"
  | "claim"
  | "source"
  | "other";

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
  // file-level breakdown — populated alongside the counts so the panel
  // can show coach exactly WHICH files will be committed.
  files: CatalogueFile[];
}

export interface CommitResult {
  ok: boolean;
  message?: string;
  error?: string;
}

function _kindFromPath(p: string): CatalogueFileKind {
  if (p.includes("/topics/")) return "topic";
  if (p.includes("/mechanisms/")) return "mechanism";
  if (p.includes("/symptoms/")) return "symptom";
  if (p.includes("/supplements/")) return "supplement";
  if (p.includes("/claims/")) return "claim";
  if (p.includes("/sources/")) return "source";
  return "other";
}

/** Count uncommitted changes in fm-database/data/ + return per-file
 *  rows so the dashboard can show coach the file list (clickable for
 *  diffs) before she hits Commit. Previous version returned only
 *  numeric counts, which left the coach committing blind. */
export async function getCatalogueStatus(): Promise<CatalogueStatus> {
  try {
    // -z null-terminates entries so we don't trip on filenames with
    // spaces. Format: XY<space>filepath\0
    const { stdout } = await exec("git", ["status", "--porcelain=v1", "-z", "--", DATA_DIR], {
      cwd: REPO_ROOT,
      env: GIT_ENV,
    });

    const entries = stdout.split("\0").filter(Boolean);
    let modified = 0, added = 0;
    let topics = 0, mechanisms = 0, symptoms = 0;
    let supplements = 0, claims = 0, sources = 0, other = 0;
    const files: CatalogueFile[] = [];

    for (const entry of entries) {
      // First two chars are the XY status; char 3 is a space; rest is path.
      const flag = entry.slice(0, 2);
      const trimmedFlag = flag.trim();
      const filePath = entry.slice(3);
      if (!filePath) continue;

      if (trimmedFlag === "M" || trimmedFlag === "A") modified++;
      else if (trimmedFlag === "??") added++;
      else modified++;

      const kind = _kindFromPath(filePath);
      if (kind === "topic") topics++;
      else if (kind === "mechanism") mechanisms++;
      else if (kind === "symptom") symptoms++;
      else if (kind === "supplement") supplements++;
      else if (kind === "claim") claims++;
      else if (kind === "source") sources++;
      else other++;

      const base = filePath.split("/").pop() || filePath;
      const slug = base.replace(/\.yaml$/, "");
      files.push({ path: filePath, kind, status: flag, slug });
    }

    // Sort: by kind, then slug — predictable list in the UI.
    const KIND_ORDER: CatalogueFileKind[] = [
      "topic", "mechanism", "symptom", "supplement", "claim", "source", "other",
    ];
    files.sort((a, b) => {
      const ka = KIND_ORDER.indexOf(a.kind);
      const kb = KIND_ORDER.indexOf(b.kind);
      if (ka !== kb) return ka - kb;
      return a.slug.localeCompare(b.slug);
    });

    return {
      modified, added,
      topics, mechanisms, symptoms, supplements, claims, sources, other,
      files,
    };
  } catch {
    return {
      modified: 0, added: 0,
      topics: 0, mechanisms: 0, symptoms: 0, supplements: 0, claims: 0, sources: 0, other: 0,
      files: [],
    };
  }
}

/** Read the working-tree content of a single catalogue file (used by the
 *  panel's "view" modal when coach clicks a file in the change list).
 *  For new (untracked) files there's no diff yet — we show the full
 *  file. For modified files we show a unified diff against HEAD. */
export async function getCatalogueFileDiff(
  filePath: string,
): Promise<{ ok: true; mode: "new" | "modified"; content: string } | { ok: false; error: string }> {
  // Safety: must live under fm-database/data/. Coach UI never sends
  // anything else, but a defensive prefix check costs nothing.
  if (!filePath.startsWith(DATA_DIR + "/") && !filePath.startsWith("fm-database/data/")) {
    return { ok: false, error: "Path outside catalogue data dir" };
  }
  try {
    // Is the file tracked? `git ls-files <path>` returns the path if so,
    // empty if untracked.
    const { stdout: tracked } = await exec("git", ["ls-files", "--", filePath], {
      cwd: REPO_ROOT,
      env: GIT_ENV,
    });

    if (!tracked.trim()) {
      // Untracked new file — read working tree directly.
      const abs = path.join(REPO_ROOT, filePath);
      const fs = await import("node:fs/promises");
      const content = await fs.readFile(abs, "utf-8");
      return { ok: true, mode: "new", content };
    }

    // Modified file — show diff vs HEAD with reasonable context.
    const { stdout } = await exec(
      "git",
      ["diff", "--no-color", "-U6", "HEAD", "--", filePath],
      { cwd: REPO_ROOT, env: GIT_ENV, maxBuffer: 8 * 1024 * 1024 },
    );
    return { ok: true, mode: "modified", content: stdout || "(no diff — file matches HEAD)" };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
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
