/**
 * /order/body-age — the public order page for the body age report.
 *
 * OFF by default: 404 unless BODY_AGE_ORDER_PAGE is "test" or (from the launch moment) "live"; see
 * body-age-orders.ts. Every word a buyer reads here is in order-copy.ts and is a DRAFT until Shivani approves it.
 */
import { notFound } from "next/navigation";
import { BODY_AGE_PRICE_INR, orderPageMode } from "@/lib/fmdb/body-age-orders";
import { OrderForm } from "./order-form";

export const dynamic = "force-dynamic";

export default function BodyAgeOrderPage() {
  const mode = orderPageMode(process.env.BODY_AGE_ORDER_PAGE, Date.now());
  if (mode === "off") notFound();
  // The laboratory needs about 36 hours to arrange a home visit (India time).
  const minDate = new Date(Date.now() + (5.5 + 36) * 3600 * 1000).toISOString().slice(0, 10);
  return <OrderForm test={mode === "test"} minDate={minDate} prices={BODY_AGE_PRICE_INR} />;
}
