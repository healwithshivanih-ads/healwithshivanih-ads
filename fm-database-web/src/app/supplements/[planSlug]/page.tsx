/**
 * /supplements/<planSlug> — public supplement order page.
 *
 * Mobile-first standalone page. Lists every supplement in the
 * published plan with name + dose + timing + a per-item order button.
 * Buy links resolved via supplement_links.yaml + a VitaOne search
 * fallback (affiliate referral baked in).
 *
 * Auth: none — the plan slug is non-guessable in practice (UUID-ish).
 * If we ever surface a guessable slug we'll wrap this in a token like
 * /letter/<token> does.
 *
 * Linked from the fm_supplement_order_v1 WhatsApp template.
 */
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { getPlansRoot } from "@/lib/fmdb/paths";
import { resolveSupplementLink, type SupplementLink } from "@/lib/server-actions/supplement-links";

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

export default async function SupplementsPage({
  params,
}: {
  params: Promise<{ planSlug: string }>;
}) {
  const { planSlug } = await params;
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

  const rows: SupplementRow[] = await Promise.all(
    supps.map(async (s): Promise<SupplementRow> => {
      const name =
        ((s.display_name as string | undefined) ??
          (s.name as string | undefined) ??
          (s.slug as string | undefined) ??
          "Supplement").trim();
      return {
        name,
        dose: describeDose(s) ?? (s.dose_summary as string | undefined),
        timing: (s.timing as string | undefined) ?? (s.when as string | undefined),
        link: await resolveSupplementLink(name),
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
              Order on {sourceLabel(r.link.source)} →
            </a>
            {r.link.notes && <div style={NOTE}>{r.link.notes}</div>}
          </li>
        ))}
      </ul>
      {rows.length === 0 && (
        <p style={P}>This plan doesn&apos;t list any supplements yet.</p>
      )}
      <footer style={FOOTER}>
        Heal with Shivani · questions? Just reply on WhatsApp.
      </footer>
    </Wrap>
  );
}

function sourceLabel(s: SupplementLink["source"]): string {
  switch (s) {
    case "vitaone": return "VitaOne";
    case "amazon": return "Amazon";
    case "iherb": return "iHerb";
    case "custom": return "store";
    case "search": return "VitaOne";
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
const META = { fontSize: 12.5, color: "#6b7280" };
const NOTE = { fontSize: 11.5, color: "#6b7280", marginTop: 4, fontStyle: "italic" as const };
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
  fontSize: 11.5,
  color: "#9ca3af",
  textAlign: "center" as const,
};
