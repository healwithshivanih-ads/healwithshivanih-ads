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

/**
 * Cron-driven reconciler for the intake staging layer.
 *
 * When FMDB_STAGING_DIR is set (the scoped-to-active-intakes deployment), the
 * public form on Fly only ever holds clients with an OPEN intake. This walks
 * the staging tree: mirrors each client's draft/submission back into the
 * authoritative ~/fm-plans store (so the coach keeps seeing fields populate),
 * then purges any whose form has been finalised / revoked / expired so the data
 * stops sitting on Fly. No-op (`staging_disabled: true`) when the env var is
 * unset — safe to call in the legacy full-replica mode.
 *
 * Called from POST /api/cron/intake-reconcile every minute.
 */
export async function reconcileIntakeStaging(): Promise<
  | { ok: true; staging_disabled?: boolean; reconciled?: unknown[]; purged?: string[]; errors?: unknown[] }
  | { ok: false; error: string }
> {
  try {
    // 120s: a reconcile that merges a fresh submission re-runs _apply_submit,
    // which fires the Haiku insights subprocess (up to ~60s).
    const res = (await runScript("intake-token-action.py", { action: "reconcile_all" }, 120_000)) as
      | { ok: true; staging_disabled?: boolean; reconciled?: unknown[]; purged?: string[]; errors?: unknown[] }
      | { ok: false; error: string };
    return res;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export type IntakeStage = "pre_discovery" | "full";

export type IntakeLookupOk = {
  ok: true;
  client_id: string;
  display_name: string;
  intake_form_draft: Record<string, unknown>;
  prefill: Record<string, unknown>;
  /**
   * v0.75 two-stage form gate. `pre_discovery` = short ~14-field form
   * shown before the discovery call. `full` = the full 3693-line form,
   * unlocked by the coach (typically after the client signs up for the
   * package). Server-side derived from intake_full_unlocked_at on the
   * client record.
   */
  stage: IntakeStage;
  /**
   * v0.75.4 — true if the client has ALREADY submitted at least once
   * (pre-discovery or full). Drives the welcome-back banner on the
   * full intake form so returning clients don't see "Begin" as if
   * starting from scratch.
   */
  previously_submitted: boolean;
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

/**
 * Coach-triggered recovery: promote a stranded `intake_form_draft` into the
 * real client fields.
 *
 * The intake form auto-saves a draft as the client fills it, but the final
 * Submit is a separate tap. A client who fills the whole form and then closes
 * the tab — mistaking the "Saved ✓" autosave indicator for "done" — leaves
 * every answer invisible in `client.intake_form_draft`: no top-level fields,
 * no intake session, and downstream panels (TierOneSuspicionsPanel, intake
 * insights) misfire because they read the promoted fields, not the draft.
 *
 * This runs the exact same merge as a client-side submit, resolved by
 * `clientId` (not token) so an expired intake link can't block recovery.
 * Surfaced as a one-click button on the client Overview when an orphaned
 * draft is detected.
 */
export async function promoteIntakeDraft(
  clientId: string,
): Promise<
  | {
      ok: true;
      client_id: string;
      fields_updated: string[];
      session_id: string;
      promoted_from_draft: true;
    }
  | { ok: false; error: string }
> {
  try {
    const res = (await runScript(
      "intake-token-action.py",
      { action: "promote_draft", client_id: clientId },
      60_000,
    )) as
      | {
          ok: true;
          client_id: string;
          fields_updated: string[];
          session_id: string;
          promoted_from_draft: true;
        }
      | { ok: false; error: string };
    return res;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Generate a fresh intake token.
 *
 * v0.75 — `unlockFull: true` for direct-signup clients (referrals, returning
 * clients, family-of-existing — anyone who's already committed and skips the
 * discovery call). Atomically stamps `intake_full_unlocked_at` + flips
 * engagement to `signed_up`, so the token they receive serves the full intake
 * form on first open. Default `false` keeps the normal pre-discovery flow.
 */
export async function generateIntakeToken(
  clientId: string,
  ttlDays?: number,
  unlockFull?: boolean,
): Promise<
  { ok: true; token: string; short_code?: string; url_path: string; expires_at: string; unlock_full: boolean } | { ok: false; error: string }
> {
  try {
    const res = (await runScript("intake-token-action.py", {
      action: "generate",
      client_id: clientId,
      ttl_days: ttlDays ?? 14,
      unlock_full: !!unlockFull,
    })) as
      | { ok: true; token: string; short_code?: string; url_path: string; expires_at: string; unlock_full: boolean }
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
 * B9 fix 2026-05-23 — undo a finalise so coach can send the client a
 * fresh editable link. Pairs with the new "🔓 Re-open for edits" button
 * in the Send-and-unlock panel.
 *
 * Clears `intake_finalised_at`. The Send-pre-discovery / Skip-full-intake
 * buttons (gated on `!isFinalised`) become visible again on the next
 * page render so coach can mint a new token + send.
 *
 * Coach asked 2026-05-23 (Deepti cl-011): "How do I re-issue Deepti's
 * intake form? It says go to Coach exam to unlock but there is no
 * option to re-issue on Coach exam." The old guidance referenced an
 * unlock button that never existed; this server action + the button
 * fix that gap.
 */
export async function reopenFinalisedIntake(
  clientId: string
): Promise<
  | { ok: true; client_id: string; was_finalised: boolean }
  | { ok: false; error: string }
> {
  try {
    const res = (await runScript("intake-token-action.py", {
      action: "reopen_finalised_intake",
      client_id: clientId,
    })) as
      | { ok: true; client_id: string; was_finalised: boolean }
      | { ok: false; error: string };
    return res;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * v0.75 — flip the intake form from pre-discovery to full. Coach calls
 * this after the client signs up for the package. Opens the deeper
 * sections (FM body systems, ACE-lite, timeline, etc.) on the same
 * intake URL the client already has. Also flips engagement_status to
 * 'signed_up' as the canonical "they're in the programme" marker.
 *
 * Idempotent. If no intake_token exists yet, coach should generate one
 * first via generateIntakeToken.
 */
export async function unlockFullIntake(
  clientId: string
): Promise<
  | { ok: true; client_id: string; intake_full_unlocked_at: string; engagement_status: "signed_up" }
  | { ok: false; error: string }
> {
  try {
    const res = (await runScript("intake-token-action.py", {
      action: "unlock_full_intake",
      client_id: clientId,
    })) as
      | { ok: true; client_id: string; intake_full_unlocked_at: string; engagement_status: "signed_up" }
      | { ok: false; error: string };
    return res;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * v0.75 — coach marks that the discovery call has happened. Stamps
 * `discovery_session_completed_at`. Pure journey-visibility marker —
 * no side effects on the intake form or engagement status.
 */
export async function markDiscoverySessionComplete(
  clientId: string
): Promise<
  | { ok: true; client_id: string; discovery_session_completed_at: string }
  | { ok: false; error: string }
> {
  try {
    const res = (await runScript("intake-token-action.py", {
      action: "mark_discovery_session_complete",
      client_id: clientId,
    })) as
      | { ok: true; client_id: string; discovery_session_completed_at: string }
      | { ok: false; error: string };
    return res;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * v0.75 — coach marks that the discovery-promised lab recommendation has
 * been delivered (WhatsApp / email / in-app). Pure journey marker.
 */
export async function markDiscoveryLabPackSent(
  clientId: string
): Promise<
  | { ok: true; client_id: string; discovery_lab_pack_sent_at: string }
  | { ok: false; error: string }
> {
  try {
    const res = (await runScript("intake-token-action.py", {
      action: "mark_discovery_lab_pack_sent",
      client_id: clientId,
    })) as
      | { ok: true; client_id: string; discovery_lab_pack_sent_at: string }
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

  const rawOrigin = (process.env.NEXT_PUBLIC_APP_URL || "").trim().replace(/\/$/, "");
  if (!rawOrigin || /localhost|127\.0\.0\.1/.test(rawOrigin)) {
    // Refuse to send a link the client can't open. cl-008 (Sudarshan) got
    // a localhost:3002 link on 2026-05-17 before this guard existed.
    return {
      ok: false,
      error:
        "NEXT_PUBLIC_APP_URL is unset or points to localhost — refusing to send an unreachable link. Set it to the public origin (e.g. https://intake.theochretree.com) in .env.local and restart pm2.",
    };
  }
  const shortCode = (c.intake_short_code as string | undefined) ?? "";
  const url = shortCode ? `${rawOrigin}/s/${shortCode}` : `${rawOrigin}/intake/${token}`;

  const sendRes = await sendWhatsAppAction(phone, "fm_intake_invite", [firstName, url]);
  if (!sendRes.ok) return { ok: false, error: sendRes.error || "Send failed" };

  // Log the send into the client's WhatsApp thread so it appears in the
  // chat panel. Without this the coach clicks Send, the message genuinely
  // goes out, but the thread shows nothing — looks like it failed.
  try {
    const { recordOutboundMessageAction } = await import("@/app/api/whatsapp/actions");
    await recordOutboundMessageAction({
      clientId,
      templateName: "fm_intake_invite",
      renderedBody:
        `Hi ${firstName}, here's your intake form to fill in before we work ` +
        `together — it saves as you go, so you can stop and resume any time:\n\n` +
        `${url}\n\n— Shivani Hari / Your Functional Health Coach`,
    });
  } catch (e) {
    // Non-fatal for the SEND — the WhatsApp message already went out. But
    // if the record fails, the chat panel will show nothing for this
    // outbound. Log loudly so the failure is visible in pm2 logs instead
    // of accumulating invisibly. (Deepti cl-011 hit this 2026-05-23.)
    console.error(
      `[intake] WA invite to ${clientId} sent but record threw: ${(e as Error).message}`,
    );
  }
  return { ok: true, url };
}

/**
 * Re-issue the intake purely to capture the Tier 1 screening section
 * (joints / standing / energy / environment — Section 11). Used by the
 * "Suspected Tier 1 signals" panel.
 *
 * Differs from sendIntakeInviteViaApi in three ways the coach asked for:
 *  1. Mints a FULL-stage token (unlock_full) — the Tier 1 section only
 *     exists on the full form, not the short pre-discovery one.
 *  2. The link carries `?focus=tier1` — the form then shows ONLY Section
 *     11 + the submit block; every other answer stays saved + hidden.
 *  3. The message is specific free-text ("a couple more answers …") sent
 *     inside the 24h window. There is no Meta template for "answer one
 *     more section" — fm_intake_invite ("before we work together") and
 *     fm_intake_unlocked_v1 ("opened the longer form") both have wrong
 *     copy here — so free-text is preferred, with fm_intake_invite as a
 *     last-resort fallback only when the 24h window is closed.
 */
export async function reissueTierOneIntakeAction(
  clientId: string,
): Promise<
  | { ok: true; url: string; via: "free_text" | "template" }
  | { ok: false; error: string }
> {
  const tok = await generateIntakeToken(clientId, 14, true);
  if (!tok.ok) return { ok: false, error: tok.error };

  const { loadAllClients } = await import("@/lib/fmdb/loader");
  const { sendWhatsAppAction, sendWhatsAppTextAction, recordOutboundMessageAction } =
    await import("@/app/api/whatsapp/actions");

  const clients = (await loadAllClients()) as Array<Record<string, unknown>>;
  const c = clients.find((x) => x.client_id === clientId);
  if (!c) return { ok: false, error: `Client ${clientId} not found` };

  const phone = ((c.mobile_number as string | undefined) ?? "").trim();
  if (!phone) return { ok: false, error: "No mobile number on file" };
  const displayName = (c.display_name as string | undefined) ?? "";
  const firstName = displayName.split(" ")[0] || "there";

  const rawOrigin = (process.env.NEXT_PUBLIC_APP_URL || "").trim().replace(/\/$/, "");
  if (!rawOrigin || /localhost|127\.0\.0\.1/.test(rawOrigin)) {
    return {
      ok: false,
      error:
        "NEXT_PUBLIC_APP_URL is unset or points to localhost — refusing to send an unreachable link. Set it to the public origin in .env.local and restart pm2.",
    };
  }
  const url = `${rawOrigin}/intake/${tok.token}?focus=tier1`;

  const freeText =
    `Hi ${firstName}, quick one — I need a couple more answers on your intake ` +
    `form: a short section on joints, standing and energy. Everything you ` +
    `filled in before is saved, so this should only take about 2 minutes:\n\n` +
    `${url}\n\n— Shivani Hari / Your Functional Health Coach`;

  // Send order (coach decision 2026-05-20):
  //   1. fm_intake_topup_v1 — the dedicated UTILITY template with the
  //      correct "one short section" copy. Works ANY time, in or out of
  //      the 24h window. This is the intended path.
  //   2. free-text — same correct copy, but only valid inside the 24h
  //      window. Used only while fm_intake_topup_v1 is still in Meta
  //      review (PENDING).
  // It must NEVER fall back to fm_intake_invite ("before we work
  // together") or fm_intake_unlocked_v1 ("opened the longer form") —
  // both have wrong copy for a Tier 1 top-up.
  let via: "template" | "free_text" = "template";
  const tpl = await sendWhatsAppAction(phone, "fm_intake_topup_v1", [firstName, url]);
  if (!tpl.ok) {
    const ft = await sendWhatsAppTextAction(phone, freeText, { name: displayName });
    if (!ft.ok) {
      return {
        ok: false,
        error:
          `fm_intake_topup_v1 template send failed (${tpl.error}) — it may still ` +
          `be in Meta review. Free-text fallback also failed (${ft.error}).`,
      };
    }
    via = "free_text";
  }

  try {
    await recordOutboundMessageAction({
      clientId,
      templateName: via === "free_text" ? "(free-text reply)" : "fm_intake_topup_v1",
      // freeText reads naturally and matches what the template says, so
      // it doubles as the thread-display body for both paths.
      renderedBody: freeText,
    });
  } catch {
    /* non-fatal — the WhatsApp message already went out */
  }

  return { ok: true, url, via };
}

/**
 * v0.75.9 — "your full intake is now open" notification, sent after the
 * coach clicks 🔓 Unlock full intake on the client Overview. Uses the
 * approved Meta template `fm_intake_unlocked_v1` (UTILITY, 2 params:
 * firstName + intakeUrl). Different copy from `fm_intake_invite` — this
 * is a welcome-back nudge, not a first-time invite.
 *
 * Template body (Meta-approved):
 *   "Hi {{1}}, now that we're working together I've opened up the longer
 *    intake form so I can build your specific plan. Your earlier answers
 *    are saved — pick up where you left off:
 *
 *    {{2}}
 *
 *    The newer sections are the ones I'm most keen to learn. Take your
 *    time, no rush.
 *
 *    — Shivani Hari
 *    Your Functional Health Coach"
 *
 * Falls back to `fm_intake_invite` if the env flag
 * `FM_INTAKE_UNLOCKED_TEMPLATE_APPROVED=1` is not set. Coach flips the
 * flag once Meta clears the new template — keeps the production send
 * working even if approval is delayed.
 */
export async function sendIntakeUnlockedViaApi(
  clientId: string,
): Promise<{ ok: true; url: string; template: string } | { ok: false; error: string }> {
  const { loadAllClients } = await import("@/lib/fmdb/loader");
  const { sendWhatsAppAction } = await import("@/app/api/whatsapp/actions");

  const clients = (await loadAllClients()) as Array<Record<string, unknown>>;
  const c = clients.find((x) => x.client_id === clientId);
  if (!c) return { ok: false, error: `Client ${clientId} not found` };

  const token = (c.intake_token as string | undefined) ?? "";
  if (!token) {
    return {
      ok: false,
      error:
        "No active intake token. Generate one first via 📨 Send intake form (this also re-opens the same URL the client used pre-discovery).",
    };
  }

  const phone = ((c.mobile_number as string | undefined) ?? "").trim();
  if (!phone) return { ok: false, error: "No mobile number on file" };

  const displayName = (c.display_name as string | undefined) ?? "";
  const firstName = displayName.split(" ")[0] || "there";

  const rawOrigin = (process.env.NEXT_PUBLIC_APP_URL || "").trim().replace(/\/$/, "");
  if (!rawOrigin || /localhost|127\.0\.0\.1/.test(rawOrigin)) {
    return {
      ok: false,
      error:
        "NEXT_PUBLIC_APP_URL is unset or points to localhost — refusing to send an unreachable link.",
    };
  }
  const url = `${rawOrigin}/intake/${token}`;

  // Template switching: prefer fm_intake_unlocked_v1 (unlock-specific copy)
  // when env flag confirms Meta approval; fall back to fm_intake_invite
  // (always-approved, generic "here's your intake link" body) otherwise.
  const useUnlockedTemplate =
    (process.env.FM_INTAKE_UNLOCKED_TEMPLATE_APPROVED || "").trim() === "1";
  const templateName = useUnlockedTemplate ? "fm_intake_unlocked_v1" : "fm_intake_invite";

  const sendRes = await sendWhatsAppAction(phone, templateName, [firstName, url]);
  if (!sendRes.ok) return { ok: false, error: sendRes.error || "Send failed" };

  // Log the send into the client's WhatsApp thread (mirrors
  // sendIntakeInviteViaApi). The recorded body matches whichever template
  // actually went out so the coach sees the real wording in the chat.
  try {
    const { recordOutboundMessageAction } = await import("@/app/api/whatsapp/actions");
    const renderedBody = useUnlockedTemplate
      ? `Hi ${firstName}, now that we're working together I've opened up the ` +
        `longer intake form so I can build your specific plan. Your earlier ` +
        `answers are saved — pick up where you left off:\n\n${url}\n\n` +
        `The newer sections are the ones I'm most keen to learn. Take your ` +
        `time, no rush.\n\n— Shivani Hari\nYour Functional Health Coach`
      : `Hi ${firstName}, here's your intake form to fill in before we work ` +
        `together — it saves as you go, so you can stop and resume any time:\n\n` +
        `${url}\n\n— Shivani Hari / Your Functional Health Coach`;
    await recordOutboundMessageAction({ clientId, templateName, renderedBody });
  } catch {
    /* non-fatal — the WhatsApp message already went out */
  }
  return { ok: true, url, template: templateName };
}
