import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { getPlansRoot } from "./paths";
import { isLapsed } from "./engagement";
import { cardStatus, type StoredMonthlyCard } from "./monthly-cards";

/**
 * Which clients are owed monthly cards, and which cards are waiting for the
 * coach. Read-only — every write goes through generate-monthly-card.py so the
 * published plan YAML is only ever dumped by PyYAML.
 */

export interface MaintenanceCardClient {
  clientId: string;
  clientName: string;
  planSlug: string;
  planStart: string | null;
  paidThrough: string | null;
  cards: Record<string, StoredMonthlyCard>;
}

export interface HeldMonthlyCard {
  clientId: string;
  clientName: string;
  planSlug: string;
  month: string;
  card: StoredMonthlyCard;
}

function ymd(v: unknown): string | null {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
}

/** One row per client on a published MAINTENANCE plan who is not lapsed —
 *  their newest maintenance plan, which is the one the app shows. */
export async function maintenanceCardClients(): Promise<MaintenanceCardClient[]> {
  const root = getPlansRoot();
  let names: string[] = [];
  try {
    names = await fs.readdir(path.join(root, "published"));
  } catch {
    return [];
  }
  const best = new Map<string, { slug: string; start: string; cards: Record<string, StoredMonthlyCard> }>();
  for (const n of names) {
    if (!n.endsWith(".yaml")) continue; // skips .bak-* copies
    let p: Record<string, unknown>;
    try {
      p = (yaml.load(await fs.readFile(path.join(root, "published", n), "utf-8")) as Record<string, unknown>) ?? {};
    } catch {
      continue;
    }
    if (p.is_maintenance !== true) continue;
    const cid = String(p.client_id ?? "");
    const slug = String(p.slug ?? "");
    if (!cid || !slug) continue;
    const start = ymd(p.plan_period_start) ?? "";
    const prev = best.get(cid);
    if (prev && prev.start >= start) continue;
    const cards = p.monthly_cards && typeof p.monthly_cards === "object" ? (p.monthly_cards as Record<string, StoredMonthlyCard>) : {};
    best.set(cid, { slug, start, cards });
  }

  const out: MaintenanceCardClient[] = [];
  for (const [clientId, b] of best) {
    let c: Record<string, unknown> = {};
    try {
      c = (yaml.load(await fs.readFile(path.join(root, "clients", clientId, "client.yaml"), "utf-8")) as Record<string, unknown>) ?? {};
    } catch {
      continue;
    }
    if (isLapsed(c) || c.archived === true) continue;
    out.push({
      clientId,
      clientName: String(c.display_name || clientId),
      planSlug: b.slug,
      planStart: b.start || null,
      paidThrough: ymd(c.maintenance_paid_through),
      cards: b.cards,
    });
  }
  return out.sort((a, b) => a.clientName.localeCompare(b.clientName));
}

/** Every card the cron held for the coach, oldest month first. */
export async function loadHeldMonthlyCards(): Promise<HeldMonthlyCard[]> {
  const rows = await maintenanceCardClients();
  const held: HeldMonthlyCard[] = [];
  for (const r of rows) {
    for (const [month, card] of Object.entries(r.cards)) {
      if (cardStatus(card) === "pending_review") {
        held.push({ clientId: r.clientId, clientName: r.clientName, planSlug: r.planSlug, month, card });
      }
    }
  }
  return held.sort((a, b) => a.month.localeCompare(b.month) || a.clientName.localeCompare(b.clientName));
}
