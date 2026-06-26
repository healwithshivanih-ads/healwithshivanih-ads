/**
 * Lab provider catalogue (Acumen) — loader + server-side price derivation.
 *
 * Reads `fm-database/data/lab_providers/acumen.yaml#profiles_final` (the locked
 * 2026-06-25 deal: 4 sex/age-gated profiles), NOT the superseded `packages:`
 * block. Exposes the bookable menu + a price function that derives the amount
 * ENTIRELY from the catalogue — a client-sent price is never trusted (see
 * docs/LAB_BOOKING_SPEC.md, "Price is computed server-side").
 *
 * The pure functions (parseAcumen / profilesForClient / priceSelection) take a
 * plain object so they're unit-testable without disk; loadLabProvider() is the
 * thin fs wrapper.
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
}

export interface LabProvider {
  slug: string;
  displayName: string;
  phoneE164: string;
  homeCollection: boolean;
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

/** Parse the raw acumen.yaml object into the typed provider. Reads ONLY
 *  `profiles_final` (ignores the superseded `packages:`). */
export function parseAcumen(raw: Record<string, unknown>): LabProvider {
  const prov = (raw.provider as Record<string, unknown>) ?? {};
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
        // Acumen bills us 50% of catalogue (final deal). Round to whole rupees.
        ourCostInr: cat != null ? Math.round(cat * 0.5) : null,
        // Client price intentionally null — pending the coach's add-on margin
        // decision (see spec "Open decisions"). Not bookable in-app until set.
        clientInr: null,
      };
    })
    .filter((a) => a.slug);

  return {
    slug: String(prov.slug ?? ACUMEN_SLUG),
    displayName: String(prov.display_name ?? "Acumen Diagnostics"),
    phoneE164: String(prov.phone_e164 ?? ""),
    homeCollection: prov.home_collection === true,
    profiles,
    addons,
  };
}

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

/** Read + parse the Acumen provider config from disk. */
export async function loadLabProvider(slug: string = ACUMEN_SLUG): Promise<LabProvider | null> {
  const { getCataloguePath } = await import("@/lib/fmdb/paths");
  const file = path.join(getCataloguePath(), "lab_providers", `${slug.replace(/^acumen.*/, "acumen")}.yaml`);
  try {
    const raw = (yaml.load(await fs.readFile(file, "utf8")) as Record<string, unknown>) ?? {};
    return parseAcumen(raw);
  } catch {
    return null;
  }
}
