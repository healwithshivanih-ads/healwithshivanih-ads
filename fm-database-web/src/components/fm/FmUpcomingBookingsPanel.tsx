/**
 * FmUpcomingBookingsPanel — dashboard widget showing upcoming cal.com
 * bookings.
 *
 * Reads from ~/fm-plans/_calcom_bookings.yaml via loadUpcomingBookings()
 * — populated by POST /api/cal-com-webhook (parallel subscriber to the
 * existing whatsapp-server-shivani receiver).
 *
 * Empty state surfaces a one-time setup prompt: cal.com needs the
 * fm-coach webhook URL added as a parallel subscriber before bookings
 * flow in. The whatsapp-server subscriber stays untouched — both URLs
 * get the same payload.
 */
import Link from "next/link";
import { FmPanel } from "./FmPanel";
import type { UpcomingBooking } from "@/lib/fmdb/loader-extras";

const EVENT_EMOJI: Record<string, string> = {
  "discovery-consultation": "🔍",
  "programme-intake-session": "🌿",
  "coaching-session": "💬",
  "facilitation-session": "🤝",
};

function fmtWhen(iso: string): { date: string; time: string } {
  try {
    const d = new Date(iso);
    const date = d.toLocaleDateString("en-IN", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
    const time = d.toLocaleTimeString("en-IN", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    return { date, time };
  } catch {
    return { date: iso, time: "" };
  }
}

function daysAway(iso: string): number {
  return Math.round((Date.parse(iso) - Date.now()) / 86_400_000);
}

export function FmUpcomingBookingsPanel({
  rows,
  webhookConfigured,
}: {
  rows: UpcomingBooking[];
  /** Heuristic: true if at least one event has ever landed in
   *  _calcom_bookings.yaml. False means cal.com isn't sending us
   *  events yet — show the setup hint. */
  webhookConfigured: boolean;
}) {
  if (rows.length === 0 && webhookConfigured) {
    return (
      <FmPanel title="📅 Upcoming bookings">
        <p
          style={{
            color: "var(--fm-text-secondary)",
            fontSize: 13,
            margin: 0,
          }}
        >
          No upcoming sessions on the books.
        </p>
      </FmPanel>
    );
  }

  if (rows.length === 0) {
    return (
      <FmPanel title="📅 Upcoming bookings">
        <div
          style={{
            background: "var(--fm-bg-warm, #fff7ed)",
            border: "1px solid var(--fm-border-light)",
            borderRadius: 6,
            padding: 12,
            fontSize: 12.5,
            lineHeight: 1.5,
            color: "var(--fm-text-secondary)",
          }}
        >
          <strong>Setup needed —</strong> cal.com webhook isn&apos;t pointing
          here yet. Add a parallel subscriber:
          <ol style={{ margin: "8px 0 0 18px", padding: 0 }}>
            <li>
              cal.com → Settings → Developer → Webhooks → <em>Add Webhook</em>
            </li>
            <li>
              URL: <code style={{ fontSize: 11.5 }}>https://intake.theochretree.com/api/cal-com-webhook</code>
            </li>
            <li>Events: BOOKING_CREATED, BOOKING_RESCHEDULED, BOOKING_CANCELLED</li>
          </ol>
          <p style={{ margin: "8px 0 0 0" }}>
            Leave the existing whatsapp-server subscriber in place — both
            URLs get the same payload.
          </p>
        </div>
      </FmPanel>
    );
  }

  return (
    <FmPanel title={`📅 Upcoming bookings (${rows.length})`}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {rows.map((r) => {
          const when = fmtWhen(r.start_time);
          const days = daysAway(r.start_time);
          const daysLabel =
            days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days}d`;
          const emoji =
            EVENT_EMOJI[r.event_slug ?? ""] ??
            (r.current_state === "RESCHEDULED" ? "🔄" : "📅");
          return (
            <Link
              key={r.uid}
              href={`/clients-v2/${r.client_id}`}
              style={{
                display: "grid",
                gridTemplateColumns: "24px 1fr auto",
                gap: 10,
                alignItems: "center",
                padding: "8px 10px",
                background: "var(--fm-surface)",
                border: "1px solid var(--fm-border-light)",
                borderRadius: 6,
                textDecoration: "none",
                color: "inherit",
                fontSize: 12.5,
              }}
            >
              <span style={{ fontSize: 16, lineHeight: 1 }}>{emoji}</span>
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 700,
                    color: "var(--fm-text-primary)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {r.display_name ?? r.client_id}
                  {r.current_state === "RESCHEDULED" && (
                    <span
                      style={{
                        marginLeft: 6,
                        fontSize: 10,
                        color: "#b45309",
                        fontWeight: 600,
                      }}
                    >
                      RESCHEDULED
                    </span>
                  )}
                </div>
                <div
                  style={{
                    fontSize: 10.5,
                    color: "var(--fm-text-tertiary)",
                    marginTop: 1,
                  }}
                >
                  {r.event_title ?? r.event_slug ?? "Session"} · {when.date}{" "}
                  {when.time}
                </div>
              </div>
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  color: days <= 1 ? "#b45309" : "var(--fm-text-tertiary)",
                  whiteSpace: "nowrap",
                }}
              >
                {daysLabel}
              </span>
            </Link>
          );
        })}
      </div>
    </FmPanel>
  );
}
