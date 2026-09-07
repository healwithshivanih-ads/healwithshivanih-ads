"use server";

/**
 * Foundation session onboarding (coach-side) — the ₹12,000 paid front door to
 * the discovery flow.
 *
 * `startFoundationSession` prepares a client for the pay → intake → book chain:
 * it ensures the stable app_token, mints a full intake token (so the form is
 * ready the instant payment lands), projects the client to Fly so the public
 * /foundation/<token> page resolves there, and returns the three links + a
 * ready-to-send WhatsApp message. It does NOT charge anything and does NOT
 * reveal the discovery app — the client only gets the pay link until they pay.
 *
 * `foundationSessionStatus` reads back where the client is in the chain (paid /
 * intake submitted / call booked) for the coach card.
 *
 * NOTE: all exports are async (Next "use server" constraint). The pay order
 * itself is created on Fly by /api/foundation/[clientId]/pay at pay time and
 * marked paid by the webhook — see foundation-orders.ts.
 */

import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { revalidatePath } from "next/cache";
import { getPlansRoot } from "@/lib/fmdb/paths";
import { ensureClientAppToken } from "./app-token";
import { generateIntakeToken } from "./intake";
import { stageClientAppArtifacts, stageDiscoveryClientArtifacts, resolveAppToken } from "./letter-token";
import {
  foundationCallUrl,
  foundationSessionPaid,
  FOUNDATION_SESSION_PRICE_INR,
} from "@/lib/fmdb/foundation-orders";

const IST = "Asia/Kolkata";

function istTodayYmd(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: IST });
}

/** Coerce a YAML date field to YYYY-MM-DD (js-yaml may parse it into a Date). */
function asYmd(v: unknown): string {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
  if (typeof v === "string") {
    const m = v.match(/^\d{4}-\d{2}-\d{2}/);
    return m ? m[0] : "";
  }
  return "";
}

function publicBase(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "https://intake.theochretree.com").replace(/\/+$/, "");
}

async function readClientYaml(clientId: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await fs.readFile(
      path.join(getPlansRoot(), "clients", clientId, "client.yaml"),
      "utf-8",
    );
    return yaml.load(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function latestPublishedPlanSlug(clientId: string): Promise<string | null> {
  const dir = path.join(getPlansRoot(), "published");
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return null;
  }
  let best: { slug: string; version: number } | null = null;
  for (const name of entries) {
    if (!name.endsWith(".yaml") && !name.endsWith(".yml")) continue;
    try {
      const d = yaml.load(await fs.readFile(path.join(dir, name), "utf-8")) as Record<
        string,
        unknown
      > | null;
      if (!d || d.client_id !== clientId) continue;
      const v = typeof d.version === "number" ? d.version : 0;
      const slug = typeof d.slug === "string" ? d.slug : "";
      if (slug && (!best || v > best.version)) best = { slug, version: v };
    } catch {
      /* skip corrupt */
    }
  }
  return best?.slug ?? null;
}

/** Ensure a still-valid full intake token, minting one only if absent/expired.
 *  Mirrors app-token.ts::_ensureIntakeToken but forces unlock_full (a foundation
 *  client does the full intake, same as discovery). Returns the token or "". */
async function ensureFullIntakeToken(clientId: string): Promise<string> {
  const data = await readClientYaml(clientId);
  if (!data) return "";
  const tok = typeof data.intake_token === "string" ? data.intake_token.trim() : "";
  const exp = asYmd(data.intake_token_expires_at);
  const stillValid = tok.length >= 16 && (!exp || exp >= istTodayYmd());
  if (stillValid) return tok;
  const res = await generateIntakeToken(clientId, 14, true);
  return res.ok ? res.token : "";
}

/**
 * Prepare `clientId` for the foundation-session chain and return the links to
 * send. Idempotent — safe to call repeatedly (never rotates an existing intake
 * link, never resets anything). Returns the pay/intake/booking URLs + a
 * copy-ready WhatsApp message + whether they've already paid.
 */
export async function startFoundationSession(clientId: string): Promise<
  | {
      ok: true;
      appToken: string;
      displayName: string;
      payUrl: string;
      intakeUrl: string | null;
      bookingUrl: string;
      amountInr: number;
      paid: boolean;
      waText: string;
    }
  | { ok: false; error: string }
> {
  if (!clientId) return { ok: false, error: "missing_client_id" };
  const tok = await ensureClientAppToken(clientId);
  if (!tok.ok) return tok;

  const intakeToken = await ensureFullIntakeToken(clientId);

  // Project to Fly so /foundation/<token> + /intake/<token> resolve there.
  const planSlug = await latestPublishedPlanSlug(clientId);
  if (planSlug) {
    await stageClientAppArtifacts(clientId, planSlug).catch(() => {
      /* best-effort */
    });
  } else {
    await stageDiscoveryClientArtifacts(clientId).catch(() => {
      /* best-effort */
    });
  }

  const data = await readClientYaml(clientId);
  const displayName =
    (typeof data?.display_name === "string" && data.display_name) ||
    (typeof data?.name === "string" && (data.name as string)) ||
    "there";
  const firstName = displayName.split(/\s+/)[0] || "there";

  const base = publicBase();
  const payUrl = `${base}/foundation/${tok.token}`;
  const intakeUrl = intakeToken ? `${base}/intake/${intakeToken}` : null;
  const bookingUrl = foundationCallUrl();
  const { paid } = await foundationSessionPaid(clientId);

  const waText =
    `Hi ${firstName}! Lovely to connect. Here's the link to book your Foundation Session ` +
    `(₹${FOUNDATION_SESSION_PRICE_INR.toLocaleString("en-IN")}):\n\n${payUrl}\n\n` +
    `Once your payment is through, that same page will let you fill in your health intake form ` +
    `and pick a time for our call. Looking forward to it! — Shivani`;

  revalidatePath(`/clients-v2/${clientId}`);
  return {
    ok: true,
    appToken: tok.token,
    displayName,
    payUrl,
    intakeUrl,
    bookingUrl,
    amountInr: FOUNDATION_SESSION_PRICE_INR,
    paid,
    waText,
  };
}

/**
 * Public: resolve a /foundation/<token> visitor to their onboarding state.
 * Token is the client's app_token (resolveAppToken handles plan-less prospects).
 * Returns only what the public page needs — no PHI beyond the display name.
 * URLs are same-origin RELATIVE paths so the page works on any host.
 */
export async function lookupFoundationToken(token: string): Promise<
  | {
      ok: true;
      clientId: string;
      displayName: string;
      firstName: string;
      paid: boolean;
      amountInr: number;
      intakePath: string | null;
      intakeSubmitted: boolean;
      bookingUrl: string;
    }
  | { ok: false; error: string }
> {
  if (!token || token.length < 16) return { ok: false, error: "invalid_or_expired" };
  const auth = await resolveAppToken(token);
  if (!auth.ok) return { ok: false, error: "invalid_or_expired" };
  const clientId = auth.client_id;
  const data = await readClientYaml(clientId);
  const displayName =
    (typeof data?.display_name === "string" && data.display_name) ||
    (typeof data?.name === "string" && (data.name as string)) ||
    "there";
  const firstName = displayName.split(/\s+/)[0] || "there";
  const intakeToken = typeof data?.intake_token === "string" ? data.intake_token.trim() : "";
  const intakeSubmitted = !!(data && asYmd(data.intake_submitted_at));
  const { paid } = await foundationSessionPaid(clientId);
  return {
    ok: true,
    clientId,
    displayName,
    firstName,
    paid,
    amountInr: FOUNDATION_SESSION_PRICE_INR,
    intakePath: intakeToken ? `/intake/${intakeToken}` : null,
    intakeSubmitted,
    bookingUrl: foundationCallUrl(),
  };
}

/** Read where the client is in the foundation chain, for the coach card. */
export async function foundationSessionStatus(clientId: string): Promise<
  | {
      ok: true;
      paid: boolean;
      paidAt: string | null;
      amountInr: number | null;
      intakeSubmitted: boolean;
      callBooked: boolean;
      callBookedFor: string | null;
    }
  | { ok: false; error: string }
> {
  if (!clientId) return { ok: false, error: "missing_client_id" };
  const { paid, order } = await foundationSessionPaid(clientId);
  const data = await readClientYaml(clientId);
  const intakeSubmitted = !!(data && asYmd(data.intake_submitted_at));

  // Booking (best-effort) from _calcom_bookings.yaml, keyed by client_id.
  let callBooked = false;
  let callBookedFor: string | null = null;
  try {
    const raw = await fs.readFile(path.join(getPlansRoot(), "_calcom_bookings.yaml"), "utf-8");
    const doc = yaml.load(raw) as Record<string, unknown> | null;
    const rows = doc && Array.isArray(doc[clientId]) ? (doc[clientId] as Record<string, unknown>[]) : [];
    const live = rows.find((r) => (r?.status ?? "") !== "cancelled");
    if (live) {
      callBooked = true;
      const start = live.start_time ?? live.start ?? live.startTime;
      callBookedFor = typeof start === "string" ? start : null;
    }
  } catch {
    /* no bookings file → not booked */
  }

  return {
    ok: true,
    paid,
    paidAt: order?.paid_at ?? null,
    amountInr: order?.amount_inr ?? null,
    intakeSubmitted,
    callBooked,
    callBookedFor,
  };
}
