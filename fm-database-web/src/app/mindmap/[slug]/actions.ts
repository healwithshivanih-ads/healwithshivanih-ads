"use server";

import { spawn } from "node:child_process";
import path from "node:path";

const FMDB_ROOT = "/Users/shivani/code/healwithshivanih-ads/fm-database";
const WEB_ROOT = "/Users/shivani/code/healwithshivanih-ads/fm-database-web";
const TIMEOUT_MS = 30_000;

export interface RenderMindmapResult {
  ok: boolean;
  mermaid?: string | null;
  error?: string | null;
}

export async function renderMindmap(slug: string): Promise<RenderMindmapResult> {
  return new Promise<RenderMindmapResult>((resolve) => {
    const py = path.join(FMDB_ROOT, ".venv/bin/python");
    const script = path.join(WEB_ROOT, "scripts", "render-mindmap.py");
    const child = spawn(py, [script], { stdio: ["pipe", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
    }, TIMEOUT_MS);

    child.stdout.on("data", (b) => (stdout += b.toString()));
    child.stderr.on("data", (b) => (stderr += b.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: String(err) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (!stdout.trim()) {
        resolve({
          ok: false,
          error: `render-mindmap.py exited ${code}: ${stderr.slice(0, 500)}`,
        });
        return;
      }
      try {
        resolve(JSON.parse(stdout) as RenderMindmapResult);
      } catch (e) {
        resolve({ ok: false, error: `parse error: ${e}` });
      }
    });

    child.stdin.write(JSON.stringify({ slug }));
    child.stdin.end();
  });
}
