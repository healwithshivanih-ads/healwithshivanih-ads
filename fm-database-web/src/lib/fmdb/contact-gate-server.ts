/**
 * contact-gate-server.ts — resolve a person's lifecycle off disk and ask the
 * pure gate. Server-only so `contact-gate.ts` stays importable from tests and
 * client bundles.
 *
 * Reads the client record (clients/ then prospects/), EVERY plan that names
 * them, and the renewal decisions — the same three inputs the dashboard hands
 * `resolveLifecycles`, so the send door and the decisions inbox can never
 * disagree about who is in care.
 */
import "server-only";
import { loadAllPlans } from "./loader";
import { loadClientById } from "./loader-extras";
import { loadDecisions } from "./renewal-queue";
import { resolveLifecycle, type Lifecycle, type LifecycleClientLike, type LifecyclePlanLike } from "./lifecycle";
import { mayContact, type ContactPurpose, type ContactVerdict } from "./contact-gate";

const IST = "Asia/Kolkata";

/** Today in IST as YYYY-MM-DD (en-CA formats that way). */
export function istTodayYmd(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: IST });
}

export interface GateResult extends ContactVerdict {
  /** The lifecycle the verdict was made on; null when the record could not
   *  be loaded (then `ok` is false — nobody on file means nobody to send to). */
  lifecycle: Lifecycle | null;
}

/**
 * May this person be contacted for this purpose, as of today?
 *
 * A missing record REFUSES: every client-facing send names a client id, and
 * an id that resolves to nothing is a bug upstream, not a reason to send.
 */
export async function gateForClient(
  clientId: string,
  purpose: ContactPurpose,
  todayYmd: string = istTodayYmd(),
): Promise<GateResult> {
  const id = (clientId ?? "").trim();
  if (!id) return { ok: false, reason: "no client id", lifecycle: null };

  let client: LifecycleClientLike | null = null;
  try {
    client = (await loadClientById(id)) as LifecycleClientLike | null;
  } catch (e) {
    return { ok: false, reason: `could not read client ${id}: ${(e as Error).message}`, lifecycle: null };
  }
  if (!client) return { ok: false, reason: `no client record for ${id}`, lifecycle: null };
  if (!client.client_id) client.client_id = id;

  let plans: LifecyclePlanLike[] = [];
  try {
    plans = (await loadAllPlans()).filter(
      (p) => (p as { client_id?: string }).client_id === id,
    ) as unknown as LifecyclePlanLike[];
  } catch (e) {
    return { ok: false, reason: `could not read plans for ${id}: ${(e as Error).message}`, lifecycle: null };
  }

  const lifecycle = resolveLifecycle(client, plans, todayYmd, { decisions: loadDecisions() });
  const verdict = mayContact(lifecycle, purpose, todayYmd);
  return { ...verdict, lifecycle };
}

/** What every client-facing sender accepts alongside its own options. */
export interface ContactGateOpts {
  /** Why this is being sent. Required for the gate to run. */
  purpose?: ContactPurpose;
  /** Who it is going to. Required for the gate to run. */
  clientId?: string;
}

/**
 * The check each sender runs before touching the network.
 *
 *   clientId + purpose   → gate; refuse with the reason.
 *   clientId, no purpose → gate as "transactional" (only archived is refused)
 *                           and WARN, so the untagged caller shows in pm2.
 *   no clientId          → cannot gate (coach / staff alerts live here);
 *                           WARN and allow.
 *
 * `defaultPurpose` lets a channel that only ever reaches clients (web push)
 * gate by default instead of warning.
 */
export async function checkContactGate(
  label: string,
  opts: ContactGateOpts | undefined,
  defaultPurpose?: ContactPurpose,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const clientId = (opts?.clientId ?? "").trim();
  const purpose = opts?.purpose ?? defaultPurpose;
  if (!clientId) {
    console.warn(`[contact-gate] ungated send ${label} (no clientId${purpose ? `, ${purpose}` : ""})`);
    return { ok: true };
  }
  if (!purpose) {
    console.warn(`[contact-gate] ungated send ${label} to ${clientId} — treated as transactional`);
  }
  const g = await gateForClient(clientId, purpose ?? "transactional");
  if (!g.ok) {
    console.warn(`[contact-gate] REFUSED ${label} to ${clientId} (${purpose ?? "transactional"}): ${g.reason}`);
    return { ok: false, error: `not sent — ${g.reason}` };
  }
  return { ok: true };
}
