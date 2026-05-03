"use server";

import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { revalidatePath } from "next/cache";

const execFileP = promisify(execFile);

const FMDB_REPO = path.resolve(process.cwd(), "../fm-database");
const PYTHON = path.join(FMDB_REPO, ".venv/bin/python");

export type CreateClientInput = {
  client_id: string;
  display_name?: string;
  intake_date: string;       // YYYY-MM-DD
  age_band: string;          // e.g. "45-50"
  sex: "F" | "M" | "other";
  conditions?: string[];     // free-text
  medications?: string[];
  allergies?: string[];
  goals?: string[];
  notes?: string;
};

export type CreateClientResult =
  | { ok: true; client_id: string }
  | { ok: false; error: string };

/**
 * Create a new client by shelling out to `fmdb client-new`.
 * Mirrors the existing Python CLI semantics so storage stays canonical.
 */
export async function createClient(
  input: CreateClientInput
): Promise<CreateClientResult> {
  if (!input.client_id || !input.intake_date || !input.age_band || !input.sex) {
    return { ok: false, error: "client_id, intake_date, age_band, sex are required" };
  }
  if (!/^[a-z0-9-]+$/.test(input.client_id)) {
    return {
      ok: false,
      error: "client_id must be lowercase letters, digits, and hyphens",
    };
  }

  const args: string[] = [
    "-m",
    "fmdb.cli",
    "client-new",
    input.client_id,
    "--intake-date",
    input.intake_date,
    "--age-band",
    input.age_band,
    "--sex",
    input.sex,
  ];
  if (input.display_name) args.push("--display-name", input.display_name);
  for (const c of input.conditions ?? []) args.push("--condition", c);
  for (const m of input.medications ?? []) args.push("--medication", m);
  for (const a of input.allergies ?? []) args.push("--allergy", a);
  for (const g of input.goals ?? []) args.push("--goal", g);
  if (input.notes) args.push("--notes", input.notes);

  try {
    await execFileP(PYTHON, args, {
      cwd: FMDB_REPO,
      timeout: 15000,
    });
  } catch (err) {
    const e = err as { stderr?: string | Buffer; message?: string };
    const stderr =
      typeof e.stderr === "string" ? e.stderr : e.stderr?.toString() ?? "";
    return { ok: false, error: stderr.trim() || e.message || "client-new failed" };
  }

  revalidatePath("/clients");
  revalidatePath(`/clients/${input.client_id}`);
  return { ok: true, client_id: input.client_id };
}
