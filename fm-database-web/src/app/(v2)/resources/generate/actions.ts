"use server";

import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { revalidatePath } from "next/cache";

const execFileP = promisify(execFile);

const FMDB_REPO = path.resolve(process.cwd(), "../fm-database");
const PYTHON = path.join(FMDB_REPO, ".venv/bin/python");
const SCRIPT = path.resolve(process.cwd(), "scripts/generate-info-pack.py");

export type GenerateInfoPackInput = {
  topic: string;
  keywords: string[];
  audience: "patient" | "coach";
  max_papers: number;
  save_slug: string;
  dry_run?: boolean;
};

export type GenerateInfoPackResult =
  | {
      ok: true;
      slug: string;
      title: string;
      papers_used: number;
      word_count: number;
      dry_run?: boolean;
    }
  | { ok: false; error: string };

export async function generateInfoPack(
  input: GenerateInfoPackInput
): Promise<GenerateInfoPackResult> {
  if (!input.topic.trim()) {
    return { ok: false, error: "Topic is required" };
  }
  if (!input.save_slug.trim()) {
    return { ok: false, error: "Slug is required" };
  }
  if (!/^[a-z0-9-]+$/.test(input.save_slug.trim())) {
    return { ok: false, error: "Slug must be lowercase letters, digits, hyphens" };
  }

  const payload = JSON.stringify(input);

  try {
    const { stdout, stderr } = await execFileP(
      PYTHON,
      [SCRIPT],
      {
        cwd: FMDB_REPO,
        timeout: 300_000, // 5 min — PubMed e-utils + Claude synthesis can run ~60–180s on big topics; 2 min was killing real queries
        maxBuffer: 4 * 1024 * 1024,
        input: payload,
      } as Parameters<typeof execFileP>[2] & { input: string }
    );

    const stderrStr = typeof stderr === "string" ? stderr : stderr?.toString() ?? "";
    if (stderrStr.trim()) {
      console.warn("[generate-info-pack] stderr:", stderrStr.trim());
    }

    const stdoutStr = typeof stdout === "string" ? stdout : stdout?.toString() ?? "";
    const result = JSON.parse(stdoutStr) as GenerateInfoPackResult;
    if (result.ok && !input.dry_run) {
      revalidatePath("/resources");
      revalidatePath(`/resources/${input.save_slug}`);
    }
    return result;
  } catch (err) {
    const e = err as {
      stderr?: string | Buffer;
      message?: string;
      stdout?: string | Buffer;
      code?: string;
      killed?: boolean;
      signal?: string;
    };
    const stderr = typeof e.stderr === "string" ? e.stderr : (e.stderr as Buffer | undefined)?.toString() ?? "";
    const rawOut = typeof e.stdout === "string" ? e.stdout : (e.stdout as Buffer | undefined)?.toString() ?? "";
    // Try to parse stdout even on error (script may have written JSON then exited non-zero)
    try {
      return JSON.parse(rawOut) as GenerateInfoPackResult;
    } catch {
      // Distinguish timeout / SIGTERM / silent crash so the toast tells the
      // coach what to do next instead of dumping the raw command line.
      const trimmedErr = stderr.trim();
      if (e.killed || e.signal === "SIGTERM") {
        return {
          ok: false,
          error:
            "PubMed + Claude synthesis took longer than 5 minutes and was cancelled. Try a narrower topic or fewer keywords, or reduce max papers.",
        };
      }
      if (trimmedErr) return { ok: false, error: trimmedErr.slice(0, 800) };
      return {
        ok: false,
        error:
          "Generator script failed without output. Check ANTHROPIC_API_KEY in fm-database-web/.env.local and that fm-database/.venv is set up.",
      };
    }
  }
}
