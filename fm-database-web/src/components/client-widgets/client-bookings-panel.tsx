/**
 * Per-client bookings — shown on the client Overview page.
 *
 * Surfaces every cal.com booking we have for this client (upcoming +
 * past, including cancelled). Coach can join the next video call in one
 * click + see at a glance whether sessions are being kept or cancelled.
 *
 * Read from ~/fm-plans/_calcom_bookings.yaml via loadClientBookings().
 */
import Link from "next/link";
import type { UpcomingBooking } from "@/lib/fmdb/loader-extras";

function fmtWhen(iso: string): string {
  try {
    const d = new Date(iso);
    return (
      d.toLocaleDateString("en-IN", {
        weekday: "short",
        day: "numeric",
        month: "short",
      }) +
      " " +
      d.toLocaleTimeString("en-IN", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })
    );
  } catch {
    return iso;
  }
}

const EVENT_EMOJI: Record<string, string> = {
  "discovery-consultation": "🔍",
  "programme-intake-session": "🌿",
  "coaching-session": "💬",
  "facilitation-session": "🤝",
};

export function ClientBookingsPanel({ rows }: { rows: UpcomingBooking[] }) {
  if (rows.length === 0) return null;

  const now = Date.now();
  const upcoming: UpcomingBooking[] = [];
  const past: UpcomingBooking[] = [];
  for (const r of rows) {
    const ms = Date.parse(r.start_time);
    const isCancelled =
      r.current_state === "CANCELLED" || r.current_state === "CANCELED";
    if (!isCancelled && ms > now) upcoming.push(r);
    else past.push(r);
  }
  // Past: newest first, capped at 10 for the visible default.
  past.sort((a, b) => b.start_time.localeCompare(a.start_time));

  return (
    <section
      style={{
        background: "var(--fm-surface)",
        border: "1px solid var(--fm-border)",
        borderRadius: "var(--fm-radius-lg)",
        padding: 20,
        marginBottom: 16,
      }}
    >
      <h2
        style={{
          fontSize: 14,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: 0.5,
          color: "var(--fm-text-tertiary)",
          margin: "0 0 12px",
        }}
      >
        📅 Cal.com bookings
      </h2>
      {upcoming.length === 0 && past.length === 0 && (
        <p style={{ fontSize: 13, color: "var(--fm-text-secondary)", margin: 0 }}>
          No bookings on file for this client.
        </p>
      )}

      {upcoming.length > 0 && (
        <>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "var(--fm-text-secondary)",
              marginBottom: 6,
            }}
          >
            Upcoming
          </div>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            {upcoming.map((r) => (
              <li key={r.uid}>
                <BookingRow row={r} isPast={false} />
              </li>
            ))}
          </ul>
        </>
      )}

      {past.length > 0 && (
        <details style={{ marginTop: upcoming.length > 0 ? 12 : 0 }}>
          <summary
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "var(--fm-text-secondary)",
              cursor: "pointer",
              userSelect: "none",
              listStyle: "none",
            }}
          >
            ▸ Past + cancelled ({past.length})
          </summary>
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: "8px 0 0",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            {past.map((r) => (
              <li key={r.uid}>
                <BookingRow row={r} isPast={true} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function BookingRow({ row, isPast }: { row: UpcomingBooking; isPast: boolean }) {
  const emoji = EVENT_EMOJI[row.event_slug ?? ""] ?? "📅";
  const isCancelled =
    row.current_state === "CANCELLED" || row.current_state === "CANCELED";
  const isReschedule = row.current_state === "RESCHEDULED";
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: row.join_url && !isPast ? "20px 1fr auto auto" : "20px 1fr auto",
        gap: 10,
        alignItems: "center",
        padding: "8px 10px",
        background: isCancelled ? "rgba(231, 76, 60, 0.05)" : "var(--fm-surface)",
        border: `1px solid ${isCancelled ? "rgba(231, 76, 60, 0.20)" : "var(--fm-border-light)"}`,
        borderRadius: 6,
        fontSize: 12.5,
        opacity: isPast && !isCancelled ? 0.7 : 1,
      }}
    >
      <span style={{ fontSize: 14, lineHeight: 1 }}>
        {isCancelled ? "❌" : emoji}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, color: "var(--fm-text-primary)" }}>
          {row.event_title ?? row.event_slug ?? "Session"}
          {isReschedule && (
            <span style={{ marginLeft: 6, fontSize: 10, color: "#b45309", fontWeight: 700 }}>
              RESCHEDULED
            </span>
          )}
          {isCancelled && (
            <span style={{ marginLeft: 6, fontSize: 10, color: "#a32c1c", fontWeight: 700 }}>
              CANCELLED
            </span>
          )}
        </div>
        <div style={{ fontSize: 10.5, color: "var(--fm-text-tertiary)", marginTop: 1 }}>
          {fmtWhen(row.start_time)}
          {row.location && row.location !== "video" ? ` · ${row.location}` : ""}
        </div>
      </div>
      <span
        style={{
          fontSize: 10.5,
          color: "var(--fm-text-tertiary)",
          fontFamily: "var(--fm-font-mono)",
        }}
      >
        {row.uid.slice(0, 8)}
      </span>
      {row.join_url && !isPast && !isCancelled && (
        <a
          href={row.join_url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            padding: "4px 10px",
            borderRadius: 6,
            background: "#14532d",
            color: "white",
            fontSize: 11,
            fontWeight: 700,
            textDecoration: "none",
            whiteSpace: "nowrap",
          }}
        >
          Join →
        </a>
      )}
    </div>
  );
}
