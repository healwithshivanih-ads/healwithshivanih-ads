/**
 * The order sheet's rows and the "running low" pick, pure, so the client app
 * (sq-everything.tsx, sq-home.tsx) and the reminders cron read the same thing.
 */
import type { ClientAppData } from "./client-app";
import { shortDay, supplyStatus, type SupplyStatus } from "./supply";

export interface OrderRow {
  id: string;
  name: string;
  buyUrl?: string;
  shop: string;
  pack?: { count: number; unit: string; perDay: number };
}

export function shopOf(url?: string): string {
  if (!url) return "";
  if (/vitaone/i.test(url)) return "VitaOne";
  if (/fmnutrition/i.test(url)) return "FM Nutrition";
  if (/amazon|amzn/i.test(url)) return "Amazon";
  if (/iherb/i.test(url)) return "iHerb";
  return "Shop page";
}

export function orderRows(data: ClientAppData): OrderRow[] {
  const rows: OrderRow[] = [...data.supplements, ...(data.upcomingSupplements ?? [])].map((s) => ({
    id: s.id,
    name: s.startsNextWeek ? `${s.name} (starts next week)` : s.name,
    buyUrl: s.buyUrl,
    shop: shopOf(s.buyUrl),
    ...(s.pack ? { pack: s.pack } : {}),
  }));
  for (const r of data.remedies) {
    if (r.assigned && r.buyUrl) rows.push({ id: "rx-" + r.slug, name: r.name, buyUrl: r.buyUrl, shop: shopOf(r.buyUrl) });
  }
  return rows;
}

/** Rows running low or out, soonest first: the Home card reads this. */
export function lowRows(data: ClientAppData, todayYmd: string): { row: OrderRow; st: SupplyStatus }[] {
  return orderRows(data)
    .map((row) => ({ row, st: supplyStatus(data.supply?.[row.id], row.pack, row.pack?.perDay, todayYmd) }))
    .filter((x) => x.st.state === "low" || x.st.state === "out")
    .sort((a, b) => (a.st.daysLeft ?? 0) - (b.st.daysLeft ?? 0));
}

/** "about 6 days left", "runs out today", "ran out on 2 Dec" */
export function leftWords(st: SupplyStatus): string {
  if (!st.runsOutOn || st.daysLeft === undefined) return "";
  if (st.daysLeft < 0) return `ran out around ${shortDay(st.runsOutOn)}`;
  if (st.daysLeft === 0) return "runs out today";
  if (st.daysLeft === 1) return "runs out tomorrow";
  return `about ${st.daysLeft} days left`;
}

