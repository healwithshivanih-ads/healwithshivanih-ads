/**
 * /supplements/<planSlug> — public supplement order page.
 *
 * Mobile-first standalone page. Lists every supplement in the
 * published plan with name + dose + timing + a per-item order button.
 * Buy links resolved via supplement_links.yaml + a VitaOne search
 * fallback (affiliate referral baked in).
 *
 * Auth: TOKEN-ONLY. The route param must be a valid letter_token
 * (resolved via lookupLetterToken) — plan slugs are guessable, so the
 * slug fallback was removed (PHI gate closed 2026-06-11). Do NOT
 * re-introduce a raw-slug lookup here.
 *
 * Linked from the fm_supplement_order_v1 WhatsApp template.
 */
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { getPlansRoot } from "@/lib/fmdb/paths";
import { lookupLetterToken } from "@/lib/server-actions/letter-token";
import { resolveSupplementLink } from "@/lib/server-actions/supplement-links";
import {
  isInternationalClient,
  type SupplementLink,
} from "@/lib/server-actions/supplement-links-match";
import { stripBrand } from "@/lib/fmdb/supplement-display";

export const dynamic = "force-dynamic";

interface SupplementRow {
  name: string;
  dose?: string;
  timing?: string;
  link: SupplementLink;
}

async function loadPublishedPlan(slug: string): Promise<Record<string, unknown> | null> {
  const dir = path.join(getPlansRoot(), "published");
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return null;
  }
  const matches = entries
    .filter((n) => n.startsWith(`${slug}-v`) && (n.endsWith(".yaml") || n.endsWith(".yml")))
    .sort()
    .reverse();
  if (matches.length === 0) return null;
  const raw = await fs.readFile(path.join(dir, matches[0]), "utf-8");
  return yaml.load(raw) as Record<string, unknown>;
}

function describeDose(s: Record<string, unknown>): string | undefined {
  // Plan supplements have a typed dose block; flatten the common fields
  // we expect to one human-readable line.
  const dose = s.dose as Record<string, unknown> | undefined;
  if (!dose) return undefined;
  const parts: string[] = [];
  if (dose.amount) parts.push(String(dose.amount));
  if (dose.unit) parts.push(String(dose.unit));
  if (dose.frequency) parts.push(String(dose.frequency));
  return parts.join(" ").trim() || undefined;
}

/**
 * Coach feedback 2026-05-23 — clients can't titrate in mg increments
 * (they don't have a scale; they buy capsules of a fixed size). Strip
 * "titrate by X mg" verbs and trailing clinical caveats from the dose
 * text so the client just sees "Start with [dose]". The full titration
 * logic stays on the coach's plan editor; the client-facing letter
 * speaks pill-count language and tells them to message the coach if
 * they're unsure.
 */
const DOSE_QTY_RE =
  /\b\d+(?:[.,\-–/]\d+)?\s?(?:ml|mg|mcg|µg|g|IU|drops?|tsp|tbsp|teaspoons?|tablespoons?|capsules?|caps?|tablets?|tabs?|pills?|scoops?|sachets?|billion(?:\s?CFU)?)\b/i;

function clientifyDose(text: string | undefined): string | undefined {
  if (!text) return undefined;
  let s = text.replace(/\s+/g, " ").trim();
  // A coach has sometimes stuffed a full titration schedule + brand name into
  // the dose field — e.g. deepti's iron: "TONOFERON LIQUID (Glenmark …) —
  // 7.5 ml ALTERNATE DAYS … push to 15 ml daily (~33 mg)". Clients order a
  // fixed product; show just the starting quantity. The "titrate"-only filter
  // below missed "increase to / push to / alternate days" phrasing (mobile
  // audit 2026-06-13).
  const qty = s.match(DOSE_QTY_RE);
  if (qty && (s.length > 45 || /\b(?:alternate days?|if\b|push to|increase to|week \d|FORM SWAP|OTC|pharmac|client reported|titrat|ALTERNATE|Glenmark|liquid \()/i.test(s)))
    return qty[0].replace(/\s+/g, " ").trim();
  // Drop "; titrate up/down by N mg every M nights to <whatever>" clause
  // and everything that follows on the same sentence.
  s = s.replace(/[;,]\s*titrat\w*[^.;]*(?:[.;]|$)/gi, ". ");
  // Drop standalone parentheticals like "(typical landing dose 300-400 mg)"
  s = s.replace(/\((?:typical|target|aim for|usually|landing|usual)[^)]*\)/gi, "");
  // Drop "back off one step if …" instructions — coach-side adjustment.
  s = s.replace(/\bback off[^.;]*(?:[.;]|$)/gi, "");
  // Drop "reassess at week N …" coach instructions.
  s = s.replace(/\breassess at week \d+[^.;]*(?:[.;]|$)/gi, "");
  // Drop "re-test … at week N" coach instructions.
  s = s.replace(/\bre-?test[^.;]*\b(week|month)\b[^.;]*(?:[.;]|$)/gi, "");
  // Tidy doubled punctuation + whitespace.
  s = s.replace(/\s{2,}/g, " ").replace(/\s+([.,;])/g, "$1").trim();
  // If we ended up with a trailing semicolon/period only, lose it.
  s = s.replace(/[;.]\s*$/, "").trim();
  return s || undefined;
}

export default async function SupplementsPage({
  params,
}: {
  params: Promise<{ planSlug: string }>;
}) {
  const { planSlug: routeParam } = await params;
  // TOKEN-ONLY (PHI gate closed 2026-06-11): the param must be a valid
  // letter_token — plan slugs are guessable, so the slug fallback is gone.
  const tok = await lookupLetterToken(routeParam);
  if (!tok.ok) {
    return (
      <Wrap>
        <h1 style={H1}>This link isn&apos;t active any more</h1>
        <p style={P}>
          Message Shivani on WhatsApp and she&apos;ll send you a fresh supplement
          list link.
        </p>
      </Wrap>
    );
  }
  const planSlug = tok.plan_slug;
  const plan = await loadPublishedPlan(planSlug);

  if (!plan) {
    return (
      <Wrap>
        <h1 style={H1}>We couldn&apos;t find your supplement list</h1>
        <p style={P}>
          The link looks expired. Please ask your coach for an updated one.
        </p>
      </Wrap>
    );
  }

  const supps = Array.isArray(plan.supplement_protocol)
    ? (plan.supplement_protocol as Array<Record<string, unknown>>)
    : [];

  // Non-India client → links must ship to their country: resolution is
  // restricted to international retailers (iHerb) and the search fallback
  // becomes an iHerb keyword search instead of the VitaOne shop.
  let international = false;
  try {
    const clientId = String(plan.client_id ?? "").trim();
    if (clientId) {
      const raw = await fs.readFile(
        path.join(getPlansRoot(), "clients", clientId, "client.yaml"),
        "utf-8",
      );
      const c = yaml.load(raw) as Record<string, unknown> | null;
      international = isInternationalClient(c?.country);
    }
  } catch {
    /* client.yaml unreadable → default India behaviour */
  }

  const rows: SupplementRow[] = await Promise.all(
    supps.map(async (s): Promise<SupplementRow> => {
      // Fix F26 2026-05-23 — the canonical Plan field is
      // `supplement_slug` (e.g. "magnesium-citrate"). Earlier code only
      // looked at display_name / name / slug, so the 5/6 supplements
      // with a populated supplement_slug but null display_name rendered
      // the literal "Supplement" placeholder. Read supplement_slug too,
      // and humanise the dashed slug for display when nothing better.
      const rawName =
        ((s.display_name as string | undefined) ??
          (s.name as string | undefined) ??
          (s.slug as string | undefined) ??
          (s.supplement_slug as string | undefined) ??
          "Supplement").trim();
      const humanised = rawName
        .replace(/[-_]+/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
      const name = stripBrand(humanised) || humanised;
      const rawDose =
        describeDose(s) ??
        (s.dose_summary as string | undefined) ??
        (typeof s.dose === "string" ? (s.dose as string) : undefined);
      return {
        name,
        // Strip "titrate by N mg" verbs + coach-only clauses — clients
        // can't dose in mg increments, only in capsule counts.
        dose: clientifyDose(rawDose),
        timing: (s.timing as string | undefined) ?? (s.when as string | undefined),
        // Catalogue slug binds the product deterministically (covers/slug),
        // never by a coincidental name substring.
        link: await resolveSupplementLink(
          name,
          (s.supplement_slug as string | undefined) ?? undefined,
          { international },
        ),
      };
    }),
  );

  return (
    <Wrap>
      <header style={{ marginBottom: 18 }}>
        <h1 style={H1}>Your supplements</h1>
        <p style={{ ...P, marginTop: 4 }}>
          Tap the link below each one to order. Brand and dose matter — if
          you&apos;re unsure about anything, message me before ordering.
        </p>
      </header>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 14 }}>
        {rows.map((r, i) => (
          <li key={i} style={CARD}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#1f2937" }}>
              {r.name}
            </div>
            {r.dose && <div style={META}>{r.dose}</div>}
            {r.timing && <div style={META}>🕐 {r.timing}</div>}
            <a href={r.link.url} target="_blank" rel="noopener noreferrer" style={BTN}>
              Order on {sourceLabel(r.link.source, r.link.url)} →
            </a>
            {r.link.notes && <div style={NOTE}>{r.link.notes}</div>}
          </li>
        ))}
      </ul>
      {rows.length === 0 && (
        <p style={P}>This plan doesn&apos;t list any supplements yet.</p>
      )}
      <footer style={FOOTER}>
        Questions? Just reply on WhatsApp.
      </footer>
    </Wrap>
  );
}

function sourceLabel(s: SupplementLink["source"], url?: string): string {
  switch (s) {
    case "vitaone": return "VitaOne";
    case "fmnutrition": return "FM Nutrition";
    case "amazon": return "Amazon";
    case "iherb": return "iHerb";
    case "custom": return "store";
    // The search fallback is retailer-dependent: iHerb keyword search for
    // international clients, the VitaOne shop for India.
    case "search": return url?.includes("iherb") ? "iHerb" : "VitaOne";
  }
}

const Wrap = ({ children }: { children: React.ReactNode }) => (
  <div style={{
    maxWidth: 520,
    margin: "0 auto",
    padding: "24px 18px 60px",
    fontFamily: "system-ui, -apple-system, sans-serif",
    color: "#1f2937",
    background: "#fafaf9",
    minHeight: "100vh",
  }}>{children}</div>
);
const H1 = { fontSize: 22, fontWeight: 700, margin: 0, color: "#14532d" };
const P = { fontSize: 14, lineHeight: 1.55, color: "#4b5563", margin: 0 };
const CARD = {
  background: "white",
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  padding: 14,
  display: "flex",
  flexDirection: "column" as const,
  gap: 4,
};
const META = { fontSize: 13, color: "#6b7280" };
const NOTE = { fontSize: 12, color: "#6b7280", marginTop: 4, fontStyle: "italic" as const };
const BTN = {
  display: "inline-block",
  marginTop: 8,
  padding: "8px 14px",
  background: "#14532d",
  color: "white",
  borderRadius: 8,
  textDecoration: "none",
  fontSize: 13,
  fontWeight: 600,
  alignSelf: "flex-start" as const,
};
const FOOTER = {
  marginTop: 32,
  fontSize: 12,
  color: "#9ca3af",
  textAlign: "center" as const,
};
