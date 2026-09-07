"use server";

/**
 * Coach-side generator for a shareable maintenance Payment Link.
 *
 * The coach UI runs on the Mac (TEST Razorpay keys); a LIVE payment link can
 * only be minted where the live keys are — on Fly. So this proxies to the Fly
 * route POST /api/maintenance/[clientId]/payment-link, authenticated with the
 * shared CRON_SECRET (must be set to the SAME value on Fly and in the Mac's
 * .env.local). Returns the Razorpay short_url for the coach to paste into an
 * email / WhatsApp.
 *
 * "Paid" is still set only by the verified webhook (payment_link.paid) — this
 * just mints the link + a pending order.
 */
const FLY_BASE =
  process.env.MAINTENANCE_LINK_BASE_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  "https://intake.theochretree.com";

export interface MaintenanceLinkResult {
  ok: boolean;
  shortUrl?: string;
  amountInr?: number;
  termMonths?: number;
  error?: string;
}

export async function generateMaintenanceLinkAction(
  clientId: string,
  termMonths = 6,
): Promise<MaintenanceLinkResult> {
  const secret = (process.env.CRON_SECRET || "").trim();
  if (!secret) {
    return { ok: false, error: "CRON_SECRET not set locally — can't authenticate to Fly." };
  }
  if (!/^[A-Za-z0-9_-]+$/.test(clientId)) {
    return { ok: false, error: "bad client id" };
  }
  let res: Response;
  try {
    res = await fetch(`${FLY_BASE}/api/maintenance/${clientId}/payment-link`, {
      method: "POST",
      headers: { "x-coach-secret": secret, "content-type": "application/json" },
      body: JSON.stringify({ termMonths }),
      cache: "no-store",
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error reaching Fly" };
  }
  let j: {
    ok?: boolean;
    short_url?: string;
    amount_inr?: number;
    term_months?: number;
    error?: string;
  };
  try {
    j = (await res.json()) as typeof j;
  } catch {
    return { ok: false, error: `Fly returned ${res.status} (non-JSON)` };
  }
  if (res.status === 401) {
    return {
      ok: false,
      error: "Fly rejected the coach secret (401) — set CRON_SECRET on Fly to match the Mac.",
    };
  }
  if (!res.ok || !j.ok || !j.short_url) {
    return { ok: false, error: j.error || `Fly returned ${res.status}` };
  }
  return { ok: true, shortUrl: j.short_url, amountInr: j.amount_inr, termMonths: j.term_months };
}
