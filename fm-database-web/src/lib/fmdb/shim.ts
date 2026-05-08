import "server-only";
import { execFile } from "node:child_process";
import path from "node:path";

export const PYTHON =
  path.resolve(process.cwd(), "..", "fm-database", ".venv/bin/python");
export const SCRIPTS_DIR = path.resolve(process.cwd(), "scripts");

export async function runShim(
  scriptName: string,
  payload: unknown,
  timeoutMs = 90_000
): Promise<unknown> {
  const scriptPath = path.join(SCRIPTS_DIR, scriptName);
  const child = execFile(PYTHON, [scriptPath], {
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
  });
  child.stdin?.end(JSON.stringify(payload));

  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => (stdout += chunk));
  child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk));

  await new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", () => resolve());
  });

  if (!stdout.trim()) {
    throw new Error(
      `${scriptName} produced no output.\nstderr: ${stderr.slice(0, 1200)}`
    );
  }
  try {
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(
      `${scriptName} produced invalid JSON: ${(err as Error).message}\n` +
        `stdout: ${stdout.slice(0, 800)}\nstderr: ${stderr.slice(0, 800)}`
    );
  }
}
