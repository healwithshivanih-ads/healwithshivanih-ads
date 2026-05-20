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
            fontSize: 13,
            lineHeight: 1.5,
            color: "var(--fm-text-secondary)",
          }}
        >
          <strong>Waiting on slice 2 —</strong> the WA server doesn&apos;t
          forward cal.com bookings to fm-coach yet.{" "}
          <code style={{ fontSize: 12 }}>POST /api/cal-com-webhook</code>{" "}
          is live on this side, just needs the WA-server-side
          <code style={{ fontSize: 12 }}>{" "}forwardBookingToFmCoach()</code>{" "}
          to be wired into{" "}
          <code style={{ fontSize: 12 }}>src/routes/webhooks/cal-com.js</code>.
          See{" "}
          <code style={{ fontSize: 12 }}>project_calcom_integration.md</code>{" "}
          slice 2 for the contract.
        </div>
      </FmPanel>
    );
  }

  // Split: next 24 hours = always visible + Join-call buttons; the rest
  // tucked into a <details> dropdown so the dashboard stays scannable.
  const TWENTY_FOUR_HOURS_MS = 24 * 3_600_000;
  const now = Date.now();
  const next24h: UpcomingBooking[] = [];
  const later: UpcomingBooking[] = [];
  for (const r of rows) {
    const startMs = Date.parse(r.start_time);
    if (Number.isFinite(startMs) && startMs - now <= TWENTY_FOUR_HOURS_MS) next24h.push(r);
    else later.push(r);
  }

  const renderRow = (r: UpcomingBooking, opts: { showJoin: boolean }) => {
    const when = fmtWhen(r.start_time);
    const days = daysAway(r.start_time);
    const startMs = Date.parse(r.start_time);
    const minutesAway = Math.round((startMs - now) / 60000);
    const daysLabel =
      days === 0
        ? minutesAway >= 0 && minutesAway <= 120
          ? minutesAway <= 5
            ? "now"
            : `in ${minutesAway}m`
          : "today"
        : days === 1
          ? "tomorrow"
          : `in ${days}d`;
    const emoji =
      EVENT_EMOJI[r.event_slug ?? ""] ??
      (r.current_state === "RESCHEDULED" ? "🔄" : "📅");
    const hasJoin = opts.showJoin && !!r.join_url;
    return (
      <div
        key={r.uid}
        style={{
          display: "grid",
          gridTemplateColumns: hasJoin ? "24px 1fr auto auto" : "24px 1fr auto",
          gap: 10,
          alignItems: "center",
          padding: "8px 10px",
          background: "var(--fm-surface)",
          border: "1px solid var(--fm-border-light)",
          borderRadius: 6,
          fontSize: 13,
        }}
      >
        <span style={{ fontSize: 16, lineHeight: 1 }}>{emoji}</span>
        <Link
          href={`/clients-v2/${r.client_id}`}
          style={{ minWidth: 0, textDecoration: "none", color: "inherit" }}
        >
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
              <span style={{ marginLeft: 6, fontSize: 10, color: "#b45309", fontWeight: 600 }}>
                RESCHEDULED
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, color: "var(--fm-text-tertiary)", marginTop: 1 }}>
            {r.event_title ?? r.event_slug ?? "Session"} · {when.date} {when.time}
            {r.location && r.location !== "video" ? ` · ${r.location}` : ""}
          </div>
        </Link>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: days <= 1 ? "#b45309" : "var(--fm-text-tertiary)",
            whiteSpace: "nowrap",
          }}
        >
          {daysLabel}
        </span>
        {hasJoin && (
          <a
            href={r.join_url ?? "#"}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding: "5px 10px",
              borderRadius: 6,
              background: "#14532d",
              color: "white",
              fontSize: 12,
              fontWeight: 700,
              textDecoration: "none",
              whiteSpace: "nowrap",
            }}
            title={r.location ? `Open ${r.location} call` : "Open video call"}
          >
            Join →
          </a>
        )}
      </div>
    );
  };

  return (
    <FmPanel title={`📅 Upcoming bookings (${rows.length})`}>
      {next24h.length > 0 ? (
        <>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: 0.6,
              color: "#b45309",
              marginBottom: 6,
            }}
          >
            Next 24 hours
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {next24h.map((r) => renderRow(r, { showJoin: true }))}
          </div>
        </>
      ) : (
        <p
          style={{ color: "var(--fm-text-secondary)", fontSize: 13, margin: 0 }}
        >
          No sessions in the next 24 hours.
        </p>
      )}
      {later.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary
            style={{
              fontSize: 12,
              color: "var(--fm-text-secondary)",
              cursor: "pointer",
              userSelect: "none",
              listStyle: "none",
            }}
          >
            ▸ Later upcoming ({later.length})
          </summary>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              marginTop: 8,
            }}
          >
            {later.map((r) => renderRow(r, { showJoin: false }))}
          </div>
        </details>
      )}
    </FmPanel>
  );
}
