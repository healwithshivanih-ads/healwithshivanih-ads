"use server";

/**
 * 2-stage handover from ochre-followup (the funnel app) — server actions.
 *
 *   Stage 1: /api/handover/discovery-complete  → create prospect record
 *   Stage 2: /api/handover/programme-signup    → flip to programme_active,
 *                                                fire onboarding kit
 *
 * See docs/HANDOVER_SPEC.md for the full contract.
 *
 * These actions are NOT directly callable from coach UI — they're invoked
 * by the route handlers in src/app/api/handover/*. Kept in server-actions
 * because the logic is reusable (e.g., for a manual "simulate handover"
 * coach debug button).
 */

import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { loadAllClients } from "@/lib/fmdb/loader";
import { getPlansRoot } from "@/lib/fmdb/paths";

export interface HandoverClientIdentity {
  display_name: string;
  email: string;
  phone_e164: string;       // digits only, no '+', e.g. "919876543210"
}

export interface DiscoveryCompletePayload {
  source: string;            // "ochre-followup"
  client: HandoverClientIdentity;
  discovery_completed_at: string;   // ISO timestamp
  discovery_call_notes?: string;
  wix_member_id?: string;
}

export interface ProgrammeSignupPayload {
  source: string;
  client: HandoverClientIdentity;
  razorpay_payment_id: string;
  razorpay_order_id?: string;
  paid_at: string;
  amount_paisa?: number;
  programme_slug?: string;
}

export type HandoverResult =
  | { ok: true; client_id: string; is_new_client: boolean; already_handed_over?: boolean }
  | { ok: false; error: string; code?: string };

// ── Helpers ──────────────────────────────────────────────────────────────

function normalisePhone(raw: string): string {
  return (raw || "").replace(/[^0-9]/g, "");
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Match candidate by phone + email (both must agree). Returns:
 *   - { client_id }            — single matching client
 *   - "no_match"               — no client matches either field
 *   - { conflict, matched_by } — phone OR email matches but not both → flag-and-stop
 */
async function findMatchingClient(
  identity: HandoverClientIdentity,
): Promise<
  | { kind: "match"; client_id: string }
  | { kind: "none" }
  | { kind: "conflict"; matched_by: "phone" | "email"; existing_client_id: string }
> {
  const targetPhone = normalisePhone(identity.phone_e164);
  const targetEmail = (identity.email || "").trim().toLowerCase();
  if (!targetPhone && !targetEmail) return { kind: "none" };

  const clients = (await loadAllClients()) as Array<Record<string, unknown>>;
  let phoneMatch: string | null = null;
  let emailMatch: string | null = null;

  for (const c of clients) {
    const cid = c.client_id as string;
    const cPhone = normalisePhone((c.mobile_number as string) || (c.mobile as string) || "");
    const cEmail = ((c.email as string) || "").trim().toLowerCase();

    const phoneHits = targetPhone && cPhone && cPhone === targetPhone;
    const emailHits = targetEmail && cEmail && cEmail === targetEmail;

    if (phoneHits && emailHits) return { kind: "match", client_id: cid };
    if (phoneHits) phoneMatch = cid;
    if (emailHits) emailMatch = cid;
  }

  if (phoneMatch && !emailMatch) {
    return { kind: "conflict", matched_by: "phone", existing_client_id: phoneMatch };
  }
  if (emailMatch && !phoneMatch) {
    return { kind: "conflict", matched_by: "email", existing_client_id: emailMatch };
  }
  return { kind: "none" };
}

/**
 * Auto-numbered client_id: scan existing clients for `cl-NNN` pattern,
 * pick max + 1. Falls back to `cl-001` when none exist.
 */
async function nextClientId(): Promise<string> {
  const clients = (await loadAllClients()) as Array<Record<string, unknown>>;
  let max = 0;
  for (const c of clients) {
    const m = /^cl-(\d{3,})$/.exec((c.client_id as string) || "");
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `cl-${String(max + 1).padStart(3, "0")}`;
}

/**
 * Write a fresh client.yaml — used when the handover finds no match. Set
 * minimal fields the Pydantic Client model requires: client_id, intake_date,
 * sex, created_at, updated_at, updated_by, version. Everything else can be
 * left as model defaults / filled later via intake form + coach edits.
 */
async function writeNewClient(
  clientId: string,
  identity: HandoverClientIdentity,
  source: string,
): Promise<void> {
  const dir = path.join(getPlansRoot(), "clients", clientId);
  await fs.mkdir(dir, { recursive: true });
  const now = nowIso();
  const payload: Record<string, unknown> = {
    client_id: clientId,
    display_name: identity.display_name,
    intake_date: now.slice(0, 10),
    sex: "F", // placeholder — coach updates after intake. Pydantic requires the field.
    email: identity.email,
    mobile_number: identity.phone_e164,
    lifecycle_state: "prospect",
    handover_source: source,
    handover_received_at: now,
    created_at: now,
    updated_at: now,
    updated_by: source,
    version: 1,
    status: "active",
  };
  await fs.writeFile(
    path.join(dir, "client.yaml"),
    yaml.dump(payload, { noRefs: true, sortKeys: false }),
    "utf8",
  );
  // Sibling dirs the rest of the app expects to exist
  await fs.mkdir(path.join(dir, "files"), { recursive: true });
  await fs.mkdir(path.join(dir, "sessions"), { recursive: true });
}

async function readClientYaml(clientId: string): Promise<Record<string, unknown>> {
  const file = path.join(getPlansRoot(), "clients", clientId, "client.yaml");
  const raw = await fs.readFile(file, "utf8");
  return yaml.load(raw) as Record<string, unknown>;
}

async function writeClientYaml(clientId: string, data: Record<string, unknown>): Promise<void> {
  const file = path.join(getPlansRoot(), "clients", clientId, "client.yaml");
  data.updated_at = nowIso();
  await fs.writeFile(file, yaml.dump(data, { noRefs: true, sortKeys: false }), "utf8");
}

// ── Stage 1: discovery-complete ──────────────────────────────────────────

export async function processDiscoveryComplete(
  payload: DiscoveryCompletePayload,
): Promise<HandoverResult> {
  if (!payload.client?.phone_e164 || !payload.client?.email) {
    return { ok: false, error: "client.phone_e164 and client.email both required", code: "bad_payload" };
  }

  const match = await findMatchingClient(payload.client);
  if (match.kind === "conflict") {
    return {
      ok: false,
      code: "phone_email_conflict",
      error:
        `Phone or email matches client ${match.existing_client_id} but the OTHER field differs. ` +
        `Matched by ${match.matched_by}. Refusing handover — coach to investigate.`,
    };
  }

  let clientId: string;
  let isNewClient = false;
  if (match.kind === "match") {
    clientId = match.client_id;
  } else {
    clientId = await nextClientId();
    await writeNewClient(clientId, payload.client, payload.source);
    isNewClient = true;
  }

  // Stamp the discovery-complete fields. If we just wrote a new client,
  // these merge into the freshly-created YAML.
  const data = await readClientYaml(clientId);
  data.lifecycle_state = data.lifecycle_state || "prospect";
  data.handover_source = data.handover_source || payload.source;
  data.handover_received_at = data.handover_received_at || nowIso();
  data.discovery_completed_at = payload.discovery_completed_at || nowIso();
  if (payload.discovery_call_notes?.trim()) {
    // Append, don't overwrite — coach may have added notes since
    const existing = (data.discovery_call_notes as string) || "";
    data.discovery_call_notes = existing
      ? existing + "\n\n---\n" + payload.discovery_call_notes.trim()
      : payload.discovery_call_notes.trim();
  }
  await writeClientYaml(clientId, data);

  return { ok: true, client_id: clientId, is_new_client: isNewClient };
}

// ── Stage 2: programme-signup ────────────────────────────────────────────

export async function processProgrammeSignup(
  payload: ProgrammeSignupPayload,
): Promise<HandoverResult> {
  if (!payload.client?.phone_e164 || !payload.client?.email) {
    return { ok: false, error: "client.phone_e164 and client.email both required", code: "bad_payload" };
  }
  if (!payload.razorpay_payment_id) {
    return { ok: false, error: "razorpay_payment_id required", code: "bad_payload" };
  }

  const match = await findMatchingClient(payload.client);
  if (match.kind === "conflict") {
    return {
      ok: false,
      code: "phone_email_conflict",
      error:
        `Phone or email matches client ${match.existing_client_id} but the OTHER field differs. ` +
        `Matched by ${match.matched_by}. Refusing — coach to investigate.`,
    };
  }
  if (match.kind === "none") {
    return {
      ok: false,
      code: "no_prospect_found",
      error:
        "No prospect record exists for this client. ochre-followup should fire " +
        "/api/handover/discovery-complete BEFORE /api/handover/programme-signup.",
    };
  }

  const clientId = match.client_id;
  const data = await readClientYaml(clientId);

  // Idempotency: if already handed over with the same payment_id, return ok.
  if (
    data.lifecycle_state === "programme_active" &&
    data.programme_payment_id === payload.razorpay_payment_id
  ) {
    return { ok: true, client_id: clientId, is_new_client: false, already_handed_over: true };
  }

  // Flip lifecycle + stamp programme metadata
  data.lifecycle_state = "programme_active";
  data.programme_started_at = payload.paid_at || nowIso();
  data.programme_payment_id = payload.razorpay_payment_id;
  data.handover_source = data.handover_source || payload.source;
  await writeClientYaml(clientId, data);

  // Fire onboarding kit (best-effort — handover succeeds even if WA fails)
  const onboardingResult = await fireOnboardingKit(
    clientId,
    payload.client,
    payload.programme_slug ?? "",
  );

  return {
    ok: true,
    client_id: clientId,
    is_new_client: false,
    ...((onboardingResult.errors.length > 0)
      ? { onboarding_partial_failures: onboardingResult.errors } as Record<string, unknown>
      : {}),
  };
}

// ── Onboarding kit (fires inside programme-signup) ───────────────────────

interface OnboardingResult {
  intake_token?: string;
  intake_url?: string;
  calcom_url?: string;
  whatsapp_sent: boolean;
  errors: string[];
}

async function fireOnboardingKit(
  clientId: string,
  identity: HandoverClientIdentity,
  _programmeSlug: string,
): Promise<OnboardingResult> {
  const errors: string[] = [];
  const result: OnboardingResult = { whatsapp_sent: false, errors };

  // 1. Generate intake token (uses the existing Python shim)
  try {
    const { generateIntakeToken } = await import("./intake");
    const tokRes = await generateIntakeToken(clientId, 30);
    if (!tokRes.ok) {
      errors.push(`intake_token_failed: ${tokRes.error}`);
    } else {
      result.intake_token = tokRes.token;
      const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "").trim().replace(/\/$/, "");
      if (!appUrl || /localhost|127\.0\.0\.1/.test(appUrl)) {
        errors.push("NEXT_PUBLIC_APP_URL unset or localhost — intake_url omitted (link would be unreachable from client device)");
      } else {
        result.intake_url = `${appUrl}/intake/${tokRes.token}`;
      }
    }
  } catch (err) {
    errors.push(`intake_token_exception: ${(err as Error).message}`);
  }

  // 2. Cal.com Programme Intake Session URL — from env, set in .env.local
  //    after Phase 3 cal.com webhook setup. For now we use the public booking
  //    URL directly (no token, just the page).
  result.calcom_url =
    process.env.CAL_INTAKE_URL ||
    "https://cal.com/shivani-hariharan-0xyy3l/programme-intake-session";

  // 3. Send the welcome WhatsApp template
  if (result.intake_url) {
    try {
      const { sendAndRecordOutboundAction } = await import("@/app/api/whatsapp/actions");
      const firstName = identity.display_name.split(" ")[0] || identity.display_name;
      // fm_programme_welcome body (approved Meta template):
      const renderedBody =
        `Hi ${firstName} 🎉 Welcome to the programme — I'm so glad you're here.\n\n` +
        `Two things to do this week to get us started:\n\n` +
        `1) Your full intake form (saves as you go): ${result.intake_url}\n\n` +
        `2) Book your programme intake session: ${result.calcom_url}\n\n` +
        `Message me here if anything's unclear.\n\n— ${(identity as { assigned_coach?: string }).assigned_coach || process.env.COACH_NAME || "Shivani"}`;
      const wa = await sendAndRecordOutboundAction({
        phone: identity.phone_e164,
        clientId,
        templateName: "fm_programme_welcome",
        templateParams: [firstName, result.intake_url, result.calcom_url],
        renderedBody,
        opts: { name: identity.display_name },
      });
      if (wa.ok) {
        result.whatsapp_sent = true;
      } else {
        errors.push(`whatsapp_send_failed: ${wa.error}`);
      }
    } catch (err) {
      errors.push(`whatsapp_send_exception: ${(err as Error).message}`);
    }
  } else {
    errors.push("whatsapp_skipped: no intake_url");
  }

  // 4. Append a handover audit quick_note session — best-effort; failures
  //    here are silent (handover itself already succeeded).
  try {
    const sessionDir = path.join(getPlansRoot(), "clients", clientId, "sessions");
    await fs.mkdir(sessionDir, { recursive: true });
    const date = nowIso().slice(0, 10);
    const seq = String(Date.now()).slice(-6);
    const sessionId = `${date}-handover-${seq}`;
    const sessionFile = path.join(sessionDir, `${sessionId}.yaml`);
    const sessionDoc = {
      session_id: sessionId,
      date,
      session_type: "quick_note",
      presenting_complaints:
        `[source: handover_programme_signup] Programme handover from ochre-followup. ` +
        `Onboarding kit dispatched: intake_url=${result.intake_url ?? "(none)"}, ` +
        `calcom_url=${result.calcom_url}, whatsapp_sent=${result.whatsapp_sent}.` +
        (errors.length > 0 ? ` Errors: ${errors.join("; ")}` : ""),
      created_at: nowIso(),
      updated_at: nowIso(),
      updated_by: "handover-system",
      version: 1,
      status: "active",
    };
    await fs.writeFile(sessionFile, yaml.dump(sessionDoc, { noRefs: true, sortKeys: false }), "utf8");
  } catch {
    // Silent — handover audit nice-to-have, not blocking.
  }

  return result;
}
