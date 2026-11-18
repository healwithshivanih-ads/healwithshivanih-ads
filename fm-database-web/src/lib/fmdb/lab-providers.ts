/**
 * Lab provider catalogues — loader + server-side price derivation.
 *
 * Two providers (Nov 2026): Thyrocare is PRIMARY (`thyrocare.yaml`), Acumen is
 * the BACKUP (`acumen.yaml`). Each file carries `profiles_final` (4 sex/age-gated
 * profiles, same id contract) + `addon_tests`; Acumen's superseded `packages:`
 * block is ignored. A stored order remembers its `provider`, and every price
 * check (pay / rebook / webhook / invoice) must load THAT provider — never the
 * default — so an Acumen order is never validated against Thyrocare's prices.
 * The amount is derived ENTIRELY from the catalogue — a client-sent price is
 * never trusted (see docs/LAB_BOOKING_SPEC.md, "Price is computed server-side").
 *
 * The pure functions (parseLabProvider / profilesForClient / priceSelection)
 * take a plain object so they're unit-testable without disk; loadLabProvider()
 * is the thin fs wrapper.
 *
 * PROFILE-ID CONTRACT: selection + pricing key off `profiles_final[].id`
 *   1 = Base Panel (everyone) · 2 = Women's Reproductive (women <45)
 *   3 = Perimenopause (women 40+) · 4 = Male (men)
 * If the yaml ids ever change, update PROFILE_RULES below in lockstep.
 */

import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
// NB: getCataloguePath ("@/…") is dynamically imported inside loadLabProvider so
// this module stays free of path-alias imports at the top level — the codebase
// convention that keeps pure modules unit-testable under vitest (no alias config).

export interface LabProfile {
  id: number;
  name: string;
  audience: string;
  ourCostInr: number;
  mrpInr: number;
  marginInr: number;
  /** À-la-carte total if every test were booked individually at Acumen's
   *  catalogue (DOS list) price — the strike-through "regular price" anchor on
   *  the client app. null when not set in the yaml (no deal shown). */
  catalogueInr: number | null;
  /** Client-friendly "what we'll check" groups — the Base list plus this
   *  profile's extras. Drives the personalised in-app view. */
  includes: string[];
  /** Add-on slugs already inside this panel (Base coverage ∪ this profile's own)
   *  — the coach add-on picker hides these when this profile is selected, and
   *  buildOrder drops them, so a test is never recommended + charged twice. */
  coveredAddonSlugs: string[];
}

export interface LabAddon {
  slug: string;
  name: string;
  /** Acumen catalogue (DOS list) price, or null when not on file. */
  catalogueInr: number | null;
  /** What Acumen bills us = 50% of catalogue (null when catalogue unknown). */
  ourCostInr: number | null;
  /** Client-facing price. NULL until the coach sets the add-on margin policy —
   *  so add-ons are surfaced but NOT bookable in-app yet (priceSelection rejects
   *  them). The yaml's `quoted_inr` is the SUPERSEDED pre-deal quote, not this. */
  clientInr: number | null;
  /** A charge, not a test (e.g. Acumen's per-booking collection fee): priced and
   *  billed like an add-on, but never listed under "What we'll check". */
  isFee?: boolean;
  /** Needs a fasting draw (catalogue `fasting: true`). An order carrying one is
   *  marked fasting even with no profile, so the app shows the fasting line. */
  fasting?: boolean;
}

/** How a paid order reaches the lab. `manual`: alert the coach, she books it
 *  herself. `partner_whatsapp`: alert the lab partner's WhatsApp (Acumen).
 *  `api`: reserved for the Thyrocare partner API (not wired yet). */
export type LabBookingMode = "manual" | "partner_whatsapp" | "api";

export interface LabProvider {
  slug: string;
  displayName: string;
  /** "primary" (Thyrocare) or "backup" (Acumen). */
  role: "primary" | "backup";
  booking: LabBookingMode;
  /** Env var holding the comma-separated WhatsApp numbers alerted when an order
   *  is paid. Per provider so a Thyrocare order never pings Acumen's partner. */
  alertRecipientsEnv: string;
  phoneE164: string;
  homeCollection: boolean;
  /** Client-facing "before your test" lines shown on the pay screen. */
  pretestInstructions: string[];
  profiles: LabProfile[];
  addons: LabAddon[];
}

export interface ClientLabContext {
  /** "M" | "F" | "" — anything non-F/M means we can only offer Base. */
  sex: string;
  /** Years; null/undefined when DOB unknown → only Base is offered. */
  age: number | null | undefined;
}

export interface LabSelection {
  /** A `profiles_final` id, or null for an add-on-only order. */
  profileId: number | null;
  /** Add-on slugs (currently always rejected until margin policy is set). */
  addonSlugs?: string[];
}

export type PriceResult =
  | { ok: true; amountInr: number; ourCostInr: number; lines: { label: string; inr: number }[] }
  | { ok: false; error: string };

const ACUMEN_SLUG = "acumen-diagnostics";
const THYROCARE_SLUG = "thyrocare";

/** The lab every new recommendation defaults to. */
export const PRIMARY_LAB_PROVIDER = THYROCARE_SLUG;
/** Used when the primary has no priced panel yet, or the coach picks it. */
export const BACKUP_LAB_PROVIDER = ACUMEN_SLUG;

/** Provider slug → catalogue file stem. Also the allowlist: an unknown slug
 *  (e.g. a tampered order) loads nothing rather than an arbitrary path. */
const PROVIDER_FILES: Record<string, string> = {
  [THYROCARE_SLUG]: "thyrocare",
  [ACUMEN_SLUG]: "acumen",
};

/** Every known provider, primary first. */
export const LAB_PROVIDER_SLUGS: readonly string[] = [PRIMARY_LAB_PROVIDER, BACKUP_LAB_PROVIDER];

export function isKnownLabProvider(slug: unknown): slug is string {
  return typeof slug === "string" && Object.prototype.hasOwnProperty.call(PROVIDER_FILES, slug);
}

/** The provider a stored order belongs to. Orders written before Thyrocare
 *  existed were all Acumen; a missing/odd value reads as Acumen, never as the
 *  primary (re-pricing an old order against a new lab would be wrong). */
export function orderProviderSlug(order: { provider?: unknown }): string {
  return isKnownLabProvider(order.provider) ? order.provider : ACUMEN_SLUG;
}

/** Predicate per profile id. age is years; sex is "M"/"F"/"". */
const PROFILE_RULES: Record<number, (ctx: ClientLabContext) => boolean> = {
  1: () => true, // Base — everyone
  2: (c) => c.sex === "F" && c.age != null && c.age < 45, // Women's Reproductive
  3: (c) => c.sex === "F" && c.age != null && c.age >= 40, // Perimenopause
  4: (c) => c.sex === "M", // Male
};

function asNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** Parse a raw provider yaml object into the typed provider. Reads ONLY
 *  `profiles_final` (ignores Acumen's superseded `packages:`). */
export function parseLabProvider(raw: Record<string, unknown>): LabProvider {
  const prov = (raw.provider as Record<string, unknown>) ?? {};
  const slug = String(prov.slug ?? ACUMEN_SLUG);
  const isAcumen = slug === ACUMEN_SLUG;
  // Add-on pricing rule. Acumen's deal: we pay 50% of catalogue, the client pays
  // catalogue — the default for the Acumen slug even when the yaml predates these
  // fields. Any other lab must state prices explicitly per add-on.
  const costFraction = asNum(prov.addon_our_cost_fraction) ?? (isAcumen ? 0.5 : null);
  const clientFromCatalogue =
    prov.addon_client_price === "catalogue" || (prov.addon_client_price == null && isAcumen);
  const booking: LabBookingMode =
    prov.booking === "manual" || prov.booking === "api" || prov.booking === "partner_whatsapp"
      ? prov.booking
      : isAcumen
        ? "partner_whatsapp"
        : "manual";
  const rawList = (Array.isArray(raw.profiles_final) ? raw.profiles_final : []) as Record<string, unknown>[];
  // The Base profile (id 1) carries the full `includes`; other profiles add
  // `includes_extra` on top of it (the deal is "base + X").
  const base = (rawList.find((p) => asNum((p ?? {}).id) === 1) ?? {}) as Record<string, unknown>;
  const baseIncludes = strArr(base.includes);
  // Every gender/age profile is "Base + extras", so it inherits Base's covered
  // add-ons too (e.g. ApoB/Lp(a)/cortisol are in every panel).
  const baseCovered = strArr(base.covered_addon_slugs);
  const rawProfiles: LabProfile[] = rawList
    .map((p) => {
      const o = (p ?? {}) as Record<string, unknown>;
      const own = strArr(o.includes);
      const includes = own.length > 0 ? own : baseIncludes.concat(strArr(o.includes_extra));
      const coveredAddonSlugs = Array.from(new Set([...baseCovered, ...strArr(o.covered_addon_slugs)]));
      return {
        id: asNum(o.id) ?? -1,
        name: String(o.name ?? ""),
        audience: String(o.audience ?? ""),
        ourCostInr: asNum(o.our_cost_inr) ?? 0,
        mrpInr: asNum(o.mrp_inr) ?? 0,
        marginInr: asNum(o.margin_inr) ?? 0,
        catalogueInr: asNum(o.catalogue_inr),
        includes,
        coveredAddonSlugs,
      };
    })
    // Both the client price (mrp) AND our cost are REQUIRED — a profile missing
    // either fails CLOSED (unbookable) rather than booking at a ₹0 cost (which
    // would record margin = full MRP and corrupt B2B reconciliation).
    .filter((p) => p.id >= 0 && p.mrpInr > 0 && p.ourCostInr > 0);

  // Drop any id that appears MORE THAN ONCE. priceSelection resolves the chosen
  // profile by id via .find() (first match), and the yaml deliberately keeps
  // superseded blocks in-place — so a stale duplicate `id:` line is a realistic
  // edit. Fail CLOSED: a collision makes that profile unbookable until the yaml
  // is corrected, rather than silently charging whichever entry sorts first.
  const idCounts = new Map<number, number>();
  for (const p of rawProfiles) idCounts.set(p.id, (idCounts.get(p.id) ?? 0) + 1);
  const profiles: LabProfile[] = rawProfiles.filter((p) => idCounts.get(p.id) === 1);

  const addons: LabAddon[] = (Array.isArray(raw.addon_tests) ? raw.addon_tests : [])
    .map((a) => {
      const o = (a ?? {}) as Record<string, unknown>;
      const cat = asNum(o.dos_list_inr);
      return {
        slug: String(o.slug ?? ""),
        name: String(o.name ?? ""),
        catalogueInr: cat,
        // An explicit `our_cost_inr` always wins (e.g. a fee passed straight
        // through). Otherwise Acumen bills us 50% of catalogue (final deal),
        // rounded to whole rupees; a lab with no fraction rule → unknown (null).
        ourCostInr:
          asNum(o.our_cost_inr) ??
          (cat != null && costFraction != null ? Math.round(cat * costFraction) : null),
        // Acumen: client pays the full catalogue price for add-ons (coach rule
        // 2026-07-01). Other labs: only an explicit `client_inr`. Null → not
        // bookable at a catalogue price until priced (the coach can still set one).
        clientInr: asNum(o.client_inr) ?? (clientFromCatalogue ? cat : null),
        isFee: o.fee === true,
        fasting: o.fasting === true,
      };
    })
    .filter((a) => a.slug);

  return {
    slug,
    displayName: String(prov.display_name ?? (isAcumen ? "Acumen Diagnostics" : slug)),
    role: prov.role === "primary" ? "primary" : prov.role === "backup" ? "backup" : isAcumen ? "backup" : "primary",
    booking,
    alertRecipientsEnv: String(prov.alert_recipients_env ?? (isAcumen ? "LAB_PARTNER_WHATSAPP" : "")),
    phoneE164: String(prov.phone_e164 ?? ""),
    homeCollection: prov.home_collection === true,
    pretestInstructions: strArr(prov.pretest_instructions),
    profiles,
    addons,
  };
}

/** @deprecated kept for existing callers/tests — use parseLabProvider. */
export const parseAcumen = parseLabProvider;

/**
 * The profiles to OFFER this client: Base + the matching gender/age profile(s).
 * NOTE: women 40–44 satisfy BOTH "women <45" and "women 40+", so they're offered
 * Base + Women's Reproductive + Perimenopause and pick (the deal's audience bands
 * overlap by design — surfacing both beats guessing a cutoff). Missing sex/age →
 * Base only.
 */
export function profilesForClient(provider: LabProvider, ctx: ClientLabContext): LabProfile[] {
  return provider.profiles.filter((p) => (PROFILE_RULES[p.id] ?? (() => false))(ctx));
}

/**
 * Derive the price for a selection ENTIRELY from the catalogue. The caller must
 * pass only an id + slugs; the amount is computed here, never accepted from the
 * client. Rejects unknown/unpriced items and empty selections.
 */
export function priceSelection(provider: LabProvider, sel: LabSelection): PriceResult {
  const addonSlugs = sel.addonSlugs ?? [];
  if (sel.profileId == null && addonSlugs.length === 0) {
    return { ok: false, error: "empty selection — pick a profile or an add-on" };
  }

  let amountInr = 0;
  let ourCostInr = 0;
  const lines: { label: string; inr: number }[] = [];

  if (sel.profileId != null) {
    const p = provider.profiles.find((x) => x.id === sel.profileId);
    if (!p) return { ok: false, error: `unknown profile id ${sel.profileId}` };
    amountInr += p.mrpInr;
    ourCostInr += p.ourCostInr;
    lines.push({ label: p.name, inr: p.mrpInr });
  }

  for (const slug of addonSlugs) {
    const a = provider.addons.find((x) => x.slug === slug);
    if (!a) return { ok: false, error: `unknown add-on "${slug}"` };
    if (a.clientInr == null) {
      return { ok: false, error: `add-on "${slug}" is not yet priced (margin policy pending)` };
    }
    amountInr += a.clientInr;
    ourCostInr += a.ourCostInr ?? 0;
    lines.push({ label: a.name, inr: a.clientInr });
  }

  return { ok: true, amountInr, ourCostInr, lines };
}

/** Read + parse one provider's config from disk. Defaults to the PRIMARY lab
 *  (Thyrocare) — callers handling a stored order must pass the order's own
 *  provider (orderProviderSlug). An unknown slug returns null. */
export async function loadLabProvider(slug: string = PRIMARY_LAB_PROVIDER): Promise<LabProvider | null> {
  const stem = PROVIDER_FILES[slug];
  if (!stem) return null;
  const { getCataloguePath } = await import("@/lib/fmdb/paths");
  const file = path.join(getCataloguePath(), "lab_providers", `${stem}.yaml`);
  try {
    const raw = (yaml.load(await fs.readFile(file, "utf8")) as Record<string, unknown>) ?? {};
    return parseLabProvider(raw);
  } catch {
    return null;
  }
}

/** True when the provider has at least one priced (bookable) panel. */
export function hasBookablePanel(provider: LabProvider | null | undefined): boolean {
  return !!provider && provider.profiles.length > 0;
}

/**
 * The provider a NEW recommendation should use: the requested one if known,
 * else the primary when it has a priced panel, else the backup. `fellBack` tells
 * the coach UI to explain why it's showing Acumen.
 */
export async function resolveRecommendProvider(
  requested?: string | null,
): Promise<{ provider: LabProvider | null; fellBack: boolean }> {
  if (requested && isKnownLabProvider(requested)) {
    return { provider: await loadLabProvider(requested), fellBack: false };
  }
  const primary = await loadLabProvider(PRIMARY_LAB_PROVIDER);
  if (hasBookablePanel(primary)) return { provider: primary, fellBack: false };
  return { provider: await loadLabProvider(BACKUP_LAB_PROVIDER), fellBack: true };
}
