"use client";

/** One body age report order on the coach's list: who, what to book, and the next step as one button. */
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FmPanel } from "@/components/fm";
import type { OrderRow } from "@/lib/server-actions/body-age-orders";
import type { LabItems } from "@/lib/fmdb/body-age-lab-items";

const STATUS: Record<string, string> = {
  pending: "Payment not confirmed yet",
  paid: "Paid: book the home visit",
  booked: "Home visit booked",
  collected: "Sample collected: waiting for results",
  results_in: "Results in: build and send the report",
};
const SLOT: Record<string, string> = { morning: "early morning (7 to 9)", late_morning: "late morning (9 to 11)" };

export function OrderCard({ row, labItems }: { row: OrderRow; labItems: LabItems }) {
  const { order: o, unplaced } = row;
  const router = useRouter();
  const [date, setDate] = useState(o.status === "paid" ? o.visit.preferred_date : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const run = async (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setBusy(true);
    setError("");
    try {
      const out = await fn();
      if (!out.ok) setError(out.error);
      else router.refresh();
    } finally {
      setBusy(false);
    }
  };
  const move = (to: "booked" | "collected" | "results_in" | "report_sent" | "cancelled", d?: string) =>
    run(async () => (await import("@/lib/server-actions/body-age-orders")).moveBodyAgeOrder(o.order_id, to, d));

  const what = `${o.report_kind === "deeper" ? "With deeper tests" : "Body age report"}${o.people.length === 2 ? " · for two" : ""}`;
  const ids = o.client_ids ?? [];
  const needsRecords = o.status !== "pending" && ids.length === 0;

  return (
    <FmPanel
      title={`${o.test ? "TEST · " : ""}${o.people.map((p) => p.full_name).join(" and ")}`}
      subtitle={`${what} · ₹${o.amount_inr.toLocaleString("en-IN")} · ${STATUS[o.status] ?? o.status}`}
    >
      <div style={{ fontSize: 13.5, display: "grid", gap: 6 }}>
        {o.people.map((p, i) => (
          <div key={`${p.email}-${i}`}>
            {ids[i] ? <Link href={`/clients-v2/${ids[i]}/overview`}>{p.full_name}</Link> : <b>{p.full_name}</b>} · {p.sex} · born {p.date_of_birth} · {p.phone} · {p.email}
          </div>
        ))}
        <div>
          Home visit asked for <b>{o.visit.preferred_date}</b>, {SLOT[o.visit.preferred_slot] ?? o.visit.preferred_slot} · {o.visit.address}, {o.visit.pincode}
          {o.visit.notes ? ` · “${o.visit.notes}”` : ""}
        </div>
        {o.booked_for && <div>Booked for {o.booked_for}{o.collected_on ? ` · sample taken ${o.collected_on}` : ""}</div>}
        {labItems.items.length > 0 && (o.status === "paid" || o.status === "booked") && (
          <div style={{ color: "var(--fm-muted, #6f6a5d)" }}>
            To book at the laboratory{o.people.length === 2 ? ", for each person" : ""}: {labItems.items.join(" + ")}
          </div>
        )}
        {o.test && <div style={{ color: "#9a3412" }}>Test order: no real money was taken. Do not book the laboratory.</div>}
        {needsRecords && unplaced && !o.test && (
          <div style={{ color: "#9a3412" }}>
            No record yet: {unplaced}. Open those records to check, or create new ones.
          </div>
        )}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 12 }}>
        {needsRecords && o.test && (
          <button type="button" className="fm-btn" disabled={busy} onClick={() => run(async () => (await import("@/lib/server-actions/body-age-orders")).attachTestOrder(o.order_id))}>
            Attach to the test profile
          </button>
        )}
        {needsRecords && !o.test && (
          <button type="button" className="fm-btn" disabled={busy} onClick={() => run(async () => (await import("@/lib/server-actions/body-age-orders")).createRecordsForOrder(o.order_id))}>
            Create new records
          </button>
        )}
        {!needsRecords && (o.status === "paid" || o.status === "booked") && (
          <>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={busy} aria-label={o.status === "paid" ? "Visit date" : "Sample date"} />
            <button type="button" className="fm-btn" disabled={busy || !date} onClick={() => move(o.status === "paid" ? "booked" : "collected", date)}>
              {o.status === "paid" ? "Mark booked for this date" : "Mark sample collected on this date"}
            </button>
          </>
        )}
        {o.status === "collected" && (
          <button type="button" className="fm-btn" disabled={busy} onClick={() => move("results_in")}>
            Results are on their record
          </button>
        )}
        {o.status === "results_in" && (
          <button type="button" className="fm-btn" disabled={busy} onClick={() => move("report_sent")}>
            Report has been sent
          </button>
        )}
        {(o.status === "paid" || o.status === "booked") && (
          <button
            type="button"
            className="fm-btn"
            disabled={busy}
            style={{ marginLeft: "auto" }}
            onClick={() => window.confirm("Cancel this order? This does not refund the payment; do that with the payment company.") && move("cancelled")}
          >
            Cancel order
          </button>
        )}
      </div>
      {error && (
        <p role="alert" style={{ fontSize: 13, color: "#9a3412", margin: "8px 0 0" }}>{error}</p>
      )}
    </FmPanel>
  );
}
