"use server";

/**
 * The coach's list of body age report orders, and the steps she moves each one through by hand:
 * paid → booked with the laboratory → sample collected → results in → report sent.
 *
 * Opening the list turns every paid, real order into people's records (body-age-order-intake.ts). Nothing here
 * contacts the buyer: booking is done by her with the laboratory, and the report is sent from the person's page.
 */
import { revalidatePath } from "next/cache";
import {
  canMoveOrder,
  loadBodyAgeOrder,
  loadBodyAgeOrders,
  patchBodyAgeOrder,
  type BodyAgeOrder,
  type BodyAgeOrderStatus,
} from "@/lib/fmdb/body-age-orders";
import { placeBodyAgeOrder } from "@/lib/fmdb/body-age-order-intake";
import { TEST_PROFILE } from "@/lib/fmdb/body-age-send";

export interface OrderRow {
  order: Omit<BodyAgeOrder, "access_key">;
  /** Why a paid order has no records yet, in the coach's words. Null when it has them (or is not paid). */
  unplaced: string | null;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Every order that reached payment, newest first. Unpaid attempts older than a day are left out. */
export async function loadBodyAgeOrderList(): Promise<OrderRow[]> {
  const rows: OrderRow[] = [];
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  for (const o of await loadBodyAgeOrders()) {
    if (o.status === "cancelled" || (o.status === "pending" && o.created_at < dayAgo)) continue;
    let order = o;
    let unplaced: string | null = null;
    if (o.status !== "pending" && !o.client_ids?.length) {
      const placed = await placeBodyAgeOrder(o).catch((e) => ({ ok: false as const, why: e instanceof Error ? e.message : "could not create the record" }));
      if (placed.ok) order = (await loadBodyAgeOrder(o.order_id)) ?? o;
      else unplaced = placed.why;
    }
    const { access_key: _secret, ...safe } = order;
    void _secret;
    rows.push({ order: safe, unplaced });
  }
  return rows;
}

type Done = { ok: true } | { ok: false; error: string };

/** Move one order a step on. `date` is the visit date for "booked" and the sample date for "collected". */
export async function moveBodyAgeOrder(orderId: string, to: BodyAgeOrderStatus, date?: string): Promise<Done> {
  const order = await loadBodyAgeOrder(orderId);
  if (!order) return { ok: false, error: "That order was not found." };
  if (to === "paid" || to === "pending") return { ok: false, error: "Only a verified payment marks an order paid." };
  if (!canMoveOrder(order.status, to)) return { ok: false, error: `An order that is "${order.status}" cannot move to "${to}".` };
  if (order.status === "paid" && !order.client_ids?.length) return { ok: false, error: "Give this order its records first." };
  const patch: Partial<BodyAgeOrder> = { status: to };
  if (to === "booked" || to === "collected") {
    if (!date || !YMD.test(date)) return { ok: false, error: "Pick the date." };
    if (to === "booked") patch.booked_for = date;
    else patch.collected_on = date;
  }
  await patchBodyAgeOrder(orderId, patch);
  revalidatePath("/report-orders");
  return { ok: true };
}

/** A TEST order goes on the test profile, for every person on it. Never creates a record. */
export async function attachTestOrder(orderId: string): Promise<Done> {
  const order = await loadBodyAgeOrder(orderId);
  if (!order || !order.test) return { ok: false, error: "That is not a test order." };
  if (order.status === "pending" || order.status === "cancelled") return { ok: false, error: "That order is not paid." };
  await patchBodyAgeOrder(orderId, { client_ids: order.people.map(() => TEST_PROFILE) });
  revalidatePath("/report-orders");
  return { ok: true };
}

/** The coach looked at an unclear match and wants new records for everyone on the order. */
export async function createRecordsForOrder(orderId: string): Promise<Done> {
  const order = await loadBodyAgeOrder(orderId);
  if (!order) return { ok: false, error: "That order was not found." };
  const placed = await placeBodyAgeOrder(order, true);
  revalidatePath("/report-orders");
  return placed.ok ? { ok: true } : { ok: false, error: placed.why };
}
