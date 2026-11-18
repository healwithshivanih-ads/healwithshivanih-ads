"use server";

/**
 * Coach-side lab-order actions — the "Recommend labs" gate.
 *
 * The coach approves which profile + add-ons are right for a client; this creates
 * a `recommended` order the client then pays for. The charged amount is derived
 * server-side (profile price from the catalogue via the order builder; add-on
 * prices are the coach's per-recommendation values). See LAB_BOOKING_SPEC.md.
 */

import { revalidatePath } from "next/cache";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { getPlansRoot } from "@/lib/fmdb/paths";
import { ageFromDob } from "@/lib/fmdb/age";
import {
  LAB_PROVIDER_SLUGS,
  hasBookablePanel,
  loadLabProvider,
  profilesForClient,
  resolveRecommendProvider,
  type LabProfile,
  type LabAddon,
  type LabBookingMode,
} from "@/lib/fmdb/lab-providers";
import {
  createRecommendedOrder,
  loadOrder,
  loadClientOrders,
  transitionOrder,
  type LabOrder,
  type RecommendAddon,
} from "@/lib/fmdb/lab-orders";

/** Positive allowlist — rejects "..", ".", "", null bytes, and any path
 *  separator. A substring `/[\/\\]/` test would let "../other" through. */
const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const safeId = (id: unknown): id is string => typeof id === "string" && SAFE_ID.test(id);

/** Defense-in-depth: these coach actions must never run on the public Fly box,
 *  even if the FLY_INTAKE_ONLY middleware 404 gate is ever misconfigured. They
 *  create / mutate price-bearing orders and read client PHI. */
const onPublicBox = (): boolean => process.env.FLY_INTAKE_ONLY === "1";

async function readClient(clientId: string): Promise<Record<string, unknown> | null> {
  if (!safeId(clientId)) return null;
  try {
    const raw = await fs.readFile(path.join(getPlansRoot(), "clients", clientId, "client.yaml"), "utf8");
    return (yaml.load(raw) as Record<string, unknown>) ?? null;
  } catch {
    return null;
  }
}

function ageFromBand(band: unknown): number | null {
  if (typeof band !== "string") return null;
  const r = band.match(/(\d+)\s*-\s*(\d+)/);
  if (r) return Math.round((Number(r[1]) + Number(r[2])) / 2);
  const s = band.match(/^(\d+)/);
  return s ? Number(s[1]) : null;
}

function clientSexAge(client: Record<string, unknown>): { sex: string; age: number | null } {
  const raw = String(client.sex ?? "").toUpperCase();
  const sex = raw.startsWith("M") ? "M" : raw.startsWith("F") ? "F" : "";
  const age = ageFromDob(client.date_of_birth) ?? ageFromBand(client.age_band);
  return { sex, age };
}

/** One lab the coach can recommend from (Thyrocare primary, Acumen backup). */
export interface LabProviderChoice {
  slug: string;
  displayName: string;
  role: "primary" | "backup";
  booking: LabBookingMode;
  /** false while the lab has no priced panel (e.g. Thyrocare before its rates
   *  are filled in) — add-on-only orders are still possible. */
  bookable: boolean;
}

export interface LabMenu {
  ok: true;
  /** The lab this menu is for. */
  provider: LabProviderChoice;
  /** Every lab the coach can switch to, primary first. */
  providers: LabProviderChoice[];
  /** True when the primary (Thyrocare) has no priced panel yet, so the menu
   *  fell back to the backup (Acumen). */
  fellBack: boolean;
  /** all profiles (the coach can override the suggestion). */
  profiles: LabProfile[];
  /** the profile id(s) suggested for this client's sex/age. */
  suggestedIds: number[];
  /** add-on catalogue (clientInr is null — coach sets the price per recommendation). */
  addons: { slug: string; name: string; ourCostInr: number | null }[];
  homeCollection: boolean;
  /** FM-marker → this lab's coverage map, for the "is the call's lab list
   *  covered by this package?" check (lab-coverage.ts). */
  coverage: import("@/lib/fmdb/lab-coverage").LabCoverageRegistry;
}

/** Load the menu the coach builder renders for one lab: all profiles + which
 *  are suggested for this client + the add-on catalogue. With no `providerSlug`
 *  it opens on Thyrocare, or on Acumen while Thyrocare has no priced panel. */
export async function loadLabMenuAction(
  clientId: string,
  providerSlug?: string,
): Promise<LabMenu | { ok: false; error: string }> {
  if (onPublicBox()) return { ok: false, error: "unavailable" };
  const { provider, fellBack } = await resolveRecommendProvider(providerSlug);
  if (!provider) return { ok: false, error: "lab catalogue unavailable" };
  const providers: LabProviderChoice[] = [];
  for (const slug of LAB_PROVIDER_SLUGS) {
    const p = slug === provider.slug ? provider : await loadLabProvider(slug);
    if (p) providers.push(choiceOf(p));
  }
  const client = await readClient(clientId);
  if (!client) return { ok: false, error: "client not found" };
  const { sex, age } = clientSexAge(client);
  const { loadLabCoverage } = await import("@/lib/fmdb/lab-coverage");
  return {
    ok: true,
    provider: choiceOf(provider),
    providers,
    fellBack,
    profiles: provider.profiles,
    suggestedIds: profilesForClient(provider, { sex, age }).map((p) => p.id),
    // fees are added automatically on recommend — never offered as a pickable test
    addons: provider.addons
      .filter((a: LabAddon) => !a.isFee)
      .map((a: LabAddon) => ({ slug: a.slug, name: a.name, ourCostInr: a.ourCostInr })),
    homeCollection: provider.homeCollection,
    coverage: await loadLabCoverage(provider.slug),
  };
}

function choiceOf(p: import("@/lib/fmdb/lab-providers").LabProvider): LabProviderChoice {
  return { slug: p.slug, displayName: p.displayName, role: p.role, booking: p.booking, bookable: hasBookablePanel(p) };
}

/** Coach approves labs → creates a `recommended` order for the client to pay. */
export async function recommendLabsAction(input: {
  clientId: string;
  profileId: number | null;
  addons: RecommendAddon[];
  coachNote?: string;
  /** The lab the coach recommended from (the card's lab switch). Omitted →
   *  Thyrocare, or Acumen while Thyrocare has no priced panel. */
  providerSlug?: string;
}): Promise<{ ok: true; order: LabOrder } | { ok: false; error: string }> {
  if (onPublicBox()) return { ok: false, error: "unavailable" };
  if (!safeId(input.clientId)) return { ok: false, error: "bad client id" };
  const { provider } = await resolveRecommendProvider(input.providerSlug);
  if (!provider) return { ok: false, error: "lab catalogue unavailable" };
  // Per-booking charges (catalogue `fee: true`, e.g. Acumen's ₹250) ride on every
  // recommendation at their catalogue price, so the coach never has to remember them.
  const addons = Array.isArray(input.addons) ? [...input.addons] : [];
  for (const fee of provider.addons.filter((a) => a.isFee && a.clientInr != null)) {
    if (!addons.some((a) => a.slug === fee.slug)) addons.push({ slug: fee.slug, inr: fee.clientInr as number });
  }
  const res = await createRecommendedOrder(provider, {
    clientId: input.clientId,
    profileId: input.profileId,
    addons,
    coachNote: input.coachNote ?? null,
    recommendedBy: process.env.COACH_NAME || "Shivani",
  });
  if (res.ok) revalidatePath(`/clients-v2/${input.clientId}`);
  return res;
}

export async function loadClientLabOrdersAction(clientId: string): Promise<LabOrder[]> {
  if (onPublicBox() || !safeId(clientId)) return [];
  return loadClientOrders(clientId);
}

/** Coach cancels a RECOMMENDED (unpaid) order, e.g. wrong panel. A paid order is
 *  NOT cancellable here — that needs a Razorpay refund flow (not built), so we
 *  refuse rather than silently void a paid order with no money returned. */
export async function cancelLabOrderAction(
  clientId: string,
  orderId: string,
): Promise<{ ok: true; order: LabOrder } | { ok: false; error: string }> {
  if (onPublicBox()) return { ok: false, error: "unavailable" };
  if (!safeId(clientId) || !safeId(orderId)) return { ok: false, error: "bad id" };
  const existing = await loadOrder(clientId, orderId);
  if (!existing) return { ok: false, error: "order not found" };
  if (existing.status !== "recommended") {
    return { ok: false, error: "only an unpaid (recommended) order can be cancelled — a paid order needs a refund" };
  }
  const res = await transitionOrder(clientId, orderId, "cancelled", { notes: "cancelled by coach" });
  if (res.ok) revalidatePath(`/clients-v2/${clientId}`);
  return res;
}

/** Coach fulfilment: advance a paid order through booked → sample_collected →
 *  results_in. transitionOrder validates the move, so an out-of-order advance is
 *  rejected. */
export async function advanceLabOrderAction(
  clientId: string,
  orderId: string,
  to: "booked" | "sample_collected" | "results_in",
): Promise<{ ok: true; order: LabOrder } | { ok: false; error: string }> {
  if (onPublicBox()) return { ok: false, error: "unavailable" };
  if (!safeId(clientId) || !safeId(orderId)) return { ok: false, error: "bad id" };
  const patch: Partial<LabOrder> = {};
  const now = new Date().toISOString();
  // Field name predates Thyrocare — it records the booking with whichever lab.
  if (to === "booked") patch.booked_with_acumen_at = now;
  else if (to === "sample_collected") patch.sample_collected_on = now.slice(0, 10);
  else if (to === "results_in") patch.results_snapshot_date = now.slice(0, 10);
  const res = await transitionOrder(clientId, orderId, to, patch);
  if (res.ok) revalidatePath(`/clients-v2/${clientId}`);
  return res;
}
