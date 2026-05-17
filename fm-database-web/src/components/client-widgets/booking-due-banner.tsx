import "server-only";
import Link from "next/link";
import {
  getSchedulingDueRows,
  type SchedulingDueRow,
} from "@/lib/fmdb/scheduling-due";

/**
 * BookingDueBanner — per-client Overview surface for the "12d / recheck
 * overdue" reminder.
 *
 * Companion to the dashboard's bulk FmScheduleDuePanel: same scanner
 * logic (getSchedulingDueRows), same threshold (≥12 days since last
 * session OR plan_period_recheck_date overdue), same auto-pick rules
 * (active programme → Coaching; intake pending → Programme Intake;
 * prospect → Discovery).
 *
 * Renders inline below the workflow stage banner. One row, one button —
 * tapping routes to /communicate?picker=book&type=<slug>. The
 * SendBookingLinkPanel reads the type param and pre-selects the right
 * event type so coach lands on a focused picker, one click from sending.
 *
 * Returns null when this client isn't due — most pages will render
 * nothing. The banner is purely additive context for the cases where
 * coach should act.
 */
interface Props {
  clientId: string;
  clientYaml: Record<string, unknown>;
  plansForClient: Array<Record<string, unknown>>;
  todayStr: string;
}

export async function BookingDueBanner({
  clientId,
  clientYaml,
  plansForClient,
  todayStr,
}: Props) {
  // Single-client invocation of the bulk scanner. Returns 0 or 1 rows.
  const rows: SchedulingDueRow[] = await getSchedulingDueRows(
    [{ ...clientYaml, client_id: clientId } as Record<string, unknown> & { client_id: string }],
    plansForClient,
    todayStr,
  );
  if (rows.length === 0) return null;
  const row = rows[0];

  return (
    <div
      style={{
        marginBottom: 16,
        padding: "10px 14px",
        background: "linear-gradient(135deg, rgba(99, 102, 241, 0.08), rgba(168, 85, 247, 0.05))",
        border: "1px solid rgba(99, 102, 241, 0.32)",
        borderRadius: "var(--fm-radius-md)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        <span style={{ fontSize: 18 }}>📅</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#3730a3" }}>
            Time to book the next session
          </div>
          <div style={{ fontSize: 11.5, color: "var(--fm-text-secondary)", marginTop: 1 }}>
            {row.reason}
          </div>
        </div>
      </div>
      <Link
        href={`/clients-v2/${clientId}/communicate?picker=book&type=${row.recommended_type}`}
        style={{
          background: "#4338ca",
          color: "#fff",
          padding: "6px 14px",
          fontSize: 12,
          fontWeight: 700,
          borderRadius: "var(--fm-radius-sm)",
          textDecoration: "none",
          whiteSpace: "nowrap",
        }}
      >
        📅 Send booking link →
      </Link>
    </div>
  );
}
