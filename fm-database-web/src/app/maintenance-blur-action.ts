"use server";

/**
 * Maintenance-blur guard — clients in maintenance mode whose PUBLISHED plan is
 * not actually a maintenance plan.
 *
 * Maintenance mode is driven by the client's maintenance flags, but the plan
 * they're on is a separate thing. Before `is_maintenance` existed, a graduate
 * could sit in maintenance on their full active protocol forever — the "lighter
 * coat on a full plan" problem: same weekly menu, same full supplement stack,
 * just a banner on top. This surfaces those clients so the coach can generate a
 * genuinely lighter maintenance plan (🌿 Maintenance in the follow-up panel).
 *
 * Report only, no mutation — regenerating a plan changes a real client's
 * protocol and is the coach's clinical call.
 */
import { loadAllClients, loadAllPlans } from "@/lib/fmdb/loader";

export interface MaintenanceBlurItem {
  client_id: string;
  display_name: string | null;
  planSlug: string;
}

export interface MaintenanceBlurStatus {
  /** How many maintenance-mode clients are still on a full plan. */
  flagged: number;
  items: MaintenanceBlurItem[];
}

/** Mirrors app-mode.ts: maintenance is "on" when status is active/lapsed OR a
 *  paid-through date is set. */
function maintenanceIsOn(c: Record<string, unknown>): boolean {
  const status = typeof c.maintenance_status === "string" ? c.maintenance_status : "";
  if (status === "active" || status === "lapsed") return true;
  const pt = c.maintenance_paid_through;
  return typeof pt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(pt);
}

export async function getMaintenanceBlurStatus(): Promise<MaintenanceBlurStatus> {
  const [clients, plans] = await Promise.all([loadAllClients(), loadAllPlans()]);

  // Newest published plan per client.
  const publishedByClient = new Map<string, Record<string, unknown>>();
  for (const p of plans as Array<Record<string, unknown>>) {
    const isPublished = p.status === "published" || p._bucket === "published";
    const id = p.client_id;
    if (!isPublished || typeof id !== "string" || !id) continue;
    const prev = publishedByClient.get(id);
    const cur = typeof p.updated_at === "string" ? p.updated_at : "";
    const prevAt = prev && typeof prev.updated_at === "string" ? prev.updated_at : "";
    if (!prev || cur > prevAt) publishedByClient.set(id, p);
  }

  const items: MaintenanceBlurItem[] = [];
  for (const c of clients as unknown as Array<Record<string, unknown>>) {
    const id = c.client_id;
    if (typeof id !== "string" || !id) continue;
    if (!maintenanceIsOn(c)) continue;
    const plan = publishedByClient.get(id);
    if (!plan) continue; // no published plan → not this guard's concern
    if (plan.is_maintenance === true) continue; // already a maintenance plan
    items.push({
      client_id: id,
      display_name: (c.display_name as string) ?? null,
      planSlug: (plan.slug as string) ?? "",
    });
  }

  items.sort((a, b) => (a.display_name ?? "").localeCompare(b.display_name ?? ""));
  return { flagged: items.length, items };
}
