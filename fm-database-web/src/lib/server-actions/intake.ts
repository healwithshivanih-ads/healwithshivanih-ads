"use server";

import { execFile } from "child_process";
import path from "path";

const FMDB_REPO = path.resolve(process.cwd(), "../fm-database");
const PYTHON = path.join(FMDB_REPO, ".venv/bin/python");
const SCRIPTS_DIR = path.resolve(process.cwd(), "scripts");

async function runScript(
  scriptName: string,
  payload: unknown,
  timeoutMs = 30_000
): Promise<unknown> {
  const scriptPath = path.join(SCRIPTS_DIR, scriptName);
  const child = execFile(PYTHON, [scriptPath], {
    timeout: timeoutMs,
    maxBuffer: 8 * 1024 * 1024,
    cwd: FMDB_REPO,
  });
  child.stdin?.end(JSON.stringify(payload));

  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer | string) => (stdout += chunk));
  child.stderr?.on("data", (chunk: Buffer | string) => (stderr += chunk));

  await new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", () => resolve());
  });

  if (!stdout.trim()) {
    throw new Error(`intake-token-action produced no output. stderr: ${stderr.slice(0, 600)}`);
  }
  try {
    return JSON.parse(stdout);
  } catch (e) {
    throw new Error(`intake-token-action returned invalid JSON: ${stdout.slice(0, 400)}`);
  }
}

export type IntakeLookupOk = {
  ok: true;
  client_id: string;
  display_name: string;
  intake_form_draft: Record<string, unknown>;
  prefill: Record<string, unknown>;
};
export type IntakeLookupErr = { ok: false; error: string; message?: string };

export async function lookupIntakeToken(
  token: string
): Promise<IntakeLookupOk | IntakeLookupErr> {
  try {
    const res = (await runScript("intake-token-action.py", {
      action: "lookup",
      token,
    })) as IntakeLookupOk | IntakeLookupErr;
    return res;
  } catch (e) {
    return { ok: false, error: "script_error", message: e instanceof Error ? e.message : String(e) };
  }
}

export async function saveIntakeDraft(
  token: string,
  draft: Record<string, unknown>
): Promise<{ ok: true; saved_at: string } | { ok: false; error: string }> {
  try {
    const res = (await runScript("intake-token-action.py", {
      action: "save_draft",
      token,
      draft,
    })) as { ok: true; saved_at: string } | { ok: false; error: string };
    return res;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function submitIntakeForm(
  token: string,
  payload: Record<string, unknown>
): Promise<
  | { ok: true; client_id: string; fields_updated: string[]; session_id: string }
  | { ok: false; error: string }
> {
  try {
    const res = (await runScript(
      "intake-token-action.py",
      { action: "submit", token, payload },
      60_000
    )) as
      | { ok: true; client_id: string; fields_updated: string[]; session_id: string }
      | { ok: false; error: string };
    return res;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function generateIntakeToken(
  clientId: string,
  ttlDays?: number
): Promise<
  { ok: true; token: string; url_path: string; expires_at: string } | { ok: false; error: string }
> {
  try {
    const res = (await runScript("intake-token-action.py", {
      action: "generate",
      client_id: clientId,
      ttl_days: ttlDays ?? 14,
    })) as
      | { ok: true; token: string; url_path: string; expires_at: string }
      | { ok: false; error: string };
    return res;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function revokeIntakeToken(
  clientId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = (await runScript("intake-token-action.py", {
      action: "revoke",
      client_id: clientId,
    })) as { ok: true } | { ok: false; error: string };
    return res;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Coach-triggered lock for the intake form. Path A (2026-05-15): the
 * client retains edit access via the public link AFTER submit until the
 * coach explicitly finalises here. Once finalised, intake_token is cleared
 * and lookup/save_draft return {error: "locked"}. Idempotent.
 *
 * Use this right before the intake call so the form data the coach reviews
 * matches what the client agreed was their final version.
 */
export async function finaliseIntakeForm(
  clientId: string
): Promise<
  | { ok: true; client_id: string; intake_finalised_at: string }
  | { ok: false; error: string }
> {
  try {
    const res = (await runScript("intake-token-action.py", {
      action: "finalise",
      client_id: clientId,
    })) as
      | { ok: true; client_id: string; intake_finalised_at: string }
      | { ok: false; error: string };
    return res;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Send the intake form invite over WhatsApp via the self-hosted WA server,
 * using the approved `fm_intake_invite` template. Reads the client's current
 * `intake_token` from disk (assumes the coach generated one first via
 * `generateIntakeToken` — i.e. the SendIntakeFormButton panel is open and
 * showing a URL).
 *
 * Why this exists alongside the existing `wa.me/...` link button: the wa.me
 * flow opens WhatsApp on the coach's own phone, which sends from whatever
 * personal/business number is installed there — NOT from the registered
 * Cloud API number (+91 89765 63971). For unified branding under one number,
 * this API send is preferable. The wa.me button is kept as a fallback for
 * when the API send fails (e.g. recipient outside 24h window and no template
 * yet, or temporary outage).
 */
export async function sendIntakeInviteViaApi(
  clientId: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  // Local imports to keep this 'use server' module light and avoid forcing
  // the loader/sendWhatsAppAction modules into the build graph of pages that
  // import other intake actions.
  const { loadAllClients } = await import("@/lib/fmdb/loader");
  const { sendWhatsAppAction } = await import("@/app/api/whatsapp/actions");

  const clients = (await loadAllClients()) as Array<Record<string, unknown>>;
  const c = clients.find((x) => x.client_id === clientId);
  if (!c) return { ok: false, error: `Client ${clientId} not found` };

  const token = (c.intake_token as string | undefined) ?? "";
  if (!token) {
    return {
      ok: false,
      error: "No active intake token. Generate one first (click '📨 Send intake form').",
    };
  }

  const phone = ((c.mobile_number as string | undefined) ?? "").trim();
  if (!phone) return { ok: false, error: "No mobile number on file" };

  const displayName = (c.display_name as string | undefined) ?? "";
  const firstName = displayName.split(" ")[0] || "there";

  const origin = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3002")
    .replace(/\/$/, "");
  const url = `${origin}/intake/${token}`;

  const sendRes = await sendWhatsAppAction(phone, "fm_intake_invite", [firstName, url]);
  if (!sendRes.ok) return { ok: false, error: sendRes.error || "Send failed" };
  return { ok: true, url };
}
