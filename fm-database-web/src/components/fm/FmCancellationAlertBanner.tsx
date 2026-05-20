/**
 * FmCancellationAlertBanner — dashboard alert for cal.com cancellations
 * received in the last 48 hours.
 *
 * Silent cancellations are a real risk — without this, a client cancels
 * their session and the coach finds out by checking cal.com or by the
 * session simply not happening. Cleared via the per-client Overview
 * `overview_seen_at` mark (same dismiss filter as Upcoming Bookings).
 */
import Link from "next/link";
import { FmPanel } from "./FmPanel";
import type { CancelledBooking } from "@/lib/fmdb/loader-extras";

function fmtStart(iso?: string): string {
  if (!iso) return "(unknown time)";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-IN", {
      weekday: "short",
      day: "numeric",
      month: "short",
    }) + " " + d.toLocaleTimeString("en-IN", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return iso;
  }
}

function fmtAgo(iso?: string): string {
  if (!iso) return "";
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

export function FmCancellationAlertBanner({
  cancellations,
}: {
  cancellations: CancelledBooking[];
}) {
  if (cancellations.length === 0) return null;

  return (
    <FmPanel
      title={`📭 Recent cancellations (${cancellations.length})`}
      style={{
        background: "rgba(231, 76, 60, 0.04)",
        border: "1px solid rgba(231, 76, 60, 0.20)",
      }}
    >
      <p
        style={{
          fontSize: 12,
          color: "var(--fm-text-secondary)",
          margin: "0 0 10px",
        }}
      >
        Sessions cancelled by clients on cal.com in the last 48 hours. Click
        any row to open the client&apos;s page — that dismisses the row from
        this banner (full cancellation history stays in the client&apos;s
        Bookings panel).
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {cancellations.map((r) => (
          <Link
            key={r.uid}
            href={`/clients-v2/${r.client_id}`}
            style={{
              display: "grid",
              gridTemplateColumns: "20px 1fr auto",
              gap: 10,
              alignItems: "center",
              padding: "8px 10px",
              background: "var(--fm-surface)",
              border: "1px solid rgba(231, 76, 60, 0.18)",
              borderRadius: 6,
              textDecoration: "none",
              color: "inherit",
              fontSize: 13,
            }}
          >
            <span style={{ fontSize: 14, lineHeight: 1 }}>❌</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, color: "var(--fm-text-primary)" }}>
                {r.display_name ?? r.client_id} cancelled{" "}
                <span style={{ fontWeight: 500, color: "var(--fm-text-secondary)" }}>
                  {r.event_title ?? r.event_slug ?? "session"}
                </span>
              </div>
              <div style={{ fontSize: 11, color: "var(--fm-text-tertiary)", marginTop: 1 }}>
                Was scheduled for {fmtStart(r.start_time)} · cancelled {fmtAgo(r.received_at)}
              </div>
            </div>
            <span
              style={{
                fontSize: 11,
                color: "#a32c1c",
                fontWeight: 700,
                whiteSpace: "nowrap",
              }}
            >
              Review →
            </span>
          </Link>
        ))}
      </div>
    </FmPanel>
  );
}
