/**
 * /report-orders — every body age report order, and where each one stands.
 *
 * The coach works an order by hand: book the home visit with the laboratory, mark the sample collected, add the
 * results to the person's record, then build and send the report from their page. Nothing on this page contacts
 * the buyer. Opening it gives each paid order its records (server-actions/body-age-orders.ts).
 */
import { FmAppShell, FmPageHeader, FmPanel } from "@/components/fm";
import { loadBodyAgeOrderList } from "@/lib/server-actions/body-age-orders";
import { labItemsFor } from "@/lib/fmdb/body-age-lab-items";
import { OrderCard } from "./order-card";

export const dynamic = "force-dynamic";

export default async function ReportOrdersPage() {
  const rows = await loadBodyAgeOrderList();
  const items = { standard: await labItemsFor("standard"), deeper: await labItemsFor("deeper") };
  const open = rows.filter((r) => r.order.status !== "report_sent");
  const done = rows.filter((r) => r.order.status === "report_sent");
  return (
    <FmAppShell activeNavId="report-orders" crumbs={[{ label: "Report orders" }]}>
      <FmPageHeader
        title="Body age report orders"
        subtitle={`${open.length} open. Nothing here is sent to the buyer: you book the visit, and the report goes from the person's page.`}
      />
      {rows.length === 0 && (
        <FmPanel title="No orders yet">
          <p style={{ fontSize: 14, margin: 0 }}>Paid orders from the order page appear here.</p>
        </FmPanel>
      )}
      {open.map((r) => (
        <OrderCard key={r.order.order_id} row={r} labItems={items[r.order.report_kind]} />
      ))}
      {done.length > 0 && (
        <FmPanel title={`Report sent (${done.length})`}>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
            {done.map((r) => (
              <li key={r.order.order_id}>
                {r.order.people.map((p) => p.full_name).join(" and ")} · sample {r.order.collected_on ?? "?"}
              </li>
            ))}
          </ul>
        </FmPanel>
      )}
    </FmAppShell>
  );
}
