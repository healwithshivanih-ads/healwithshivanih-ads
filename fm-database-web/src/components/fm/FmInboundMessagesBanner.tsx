/**
 * FmInboundMessagesBanner — WhatsApp inbox banner on the dashboard.
 *
 * Renamed from FmAisensyBanner 2026-05-15 as part of the AiSensy
 * decommission. Inbound messages now come from the self-hosted WhatsApp
 * Cloud API server (whatsapp-server-shivani on Fly) via the
 * /api/whatsapp-webhook endpoint. Messages get tagged
 * `[source: whatsapp_webhook]` on the session record;
 * getRecentInboundMessages() scans for that tag.
 *
 * WhatsApp green (distinct from orange CTAs so it reads as "inbound", not
 * "you must act"). Lists clients with new messages as chips with unread
 * counts; clicking a chip routes to that client's session tab.
 *
 * Messages are grouped by client_id since the underlying loader returns
 * one entry per message — coach wants to see "3 from Archana", not 3 rows.
 */
import Link from "next/link";
import { FmPanel } from "./FmPanel";
import type { InboundMessage } from "@/lib/fmdb/loader-extras";

export interface FmInboundMessagesBannerProps {
  messages: InboundMessage[];
  /** Days back the loader queried — surfaced as a chip in the title. */
  windowDays?: number;
  /** Inbox CTA href (defaults to the legacy session view). */
  inboxHref?: string;
}

export function FmInboundMessagesBanner({
  messages,
  windowDays = 7,
  inboxHref = "/messages",
}: FmInboundMessagesBannerProps) {
  if (messages.length === 0) return null;

  // Group by client_id, keep the most recent message as the preview.
  const grouped = new Map<
    string,
    { client_id: string; display_name?: string; latest: InboundMessage; count: number }
  >();
  for (const m of messages) {
    const g = grouped.get(m.client_id);
    if (!g) {
      grouped.set(m.client_id, {
        client_id: m.client_id,
        display_name: m.display_name,
        latest: m,
        count: 1,
      });
    } else {
      g.count += 1;
      if (m.date > g.latest.date) g.latest = m;
    }
  }
  const clients = [...grouped.values()].sort((a, b) =>
    b.latest.date.localeCompare(a.latest.date),
  );

  return (
    <FmPanel
      style={{
        padding: "12px 16px",
        background:
          "linear-gradient(135deg, rgba(37,211,102,0.10), rgba(46,204,113,0.06))",
        borderColor: "rgba(37,211,102,0.35)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
        <span style={{ fontSize: 22 }}>💬</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#0E6B3E" }}>
            {messages.length} new WhatsApp message{messages.length === 1 ? "" : "s"}
            <span
              style={{
                fontSize: 9.5,
                marginLeft: 8,
                padding: "1px 6px",
                borderRadius: 3,
                background: "rgba(0,0,0,0.06)",
                color: "#1E8449",
                letterSpacing: 0.6,
                textTransform: "uppercase",
                fontWeight: 700,
              }}
            >
              last {windowDays} days
            </span>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--fm-text-secondary)" }}>
            From {clients.length} client{clients.length === 1 ? "" : "s"}
          </div>
        </div>
        <Link
          href={inboxHref}
          style={{
            background: "#1E8449",
            color: "#fff",
            border: 0,
            padding: "6px 12px",
            fontSize: 11.5,
            fontWeight: 700,
            borderRadius: "var(--fm-radius-sm)",
            textDecoration: "none",
            whiteSpace: "nowrap",
          }}
        >
          Open inbox →
        </Link>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {clients.map((c) => {
          const initials = (c.display_name ?? c.client_id)
            .split(" ")
            .map((p) => p[0])
            .filter(Boolean)
            .slice(0, 2)
            .join("")
            .toUpperCase();
          return (
            <Link
              key={c.client_id}
              href={`/clients-v2/${c.client_id}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "5px 10px",
                background: "var(--fm-surface)",
                border: "1px solid var(--fm-border-light)",
                borderRadius: "var(--fm-radius-pill)",
                fontSize: 11,
                textDecoration: "none",
                color: "inherit",
              }}
            >
              <span
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  background: "var(--fm-bg-warm)",
                  color: "var(--fm-primary-dark)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 10,
                  fontWeight: 700,
                }}
              >
                {initials}
              </span>
              <span style={{ fontWeight: 700 }}>
                {c.display_name ?? c.client_id}
              </span>
              <span
                style={{
                  color: "var(--fm-text-tertiary)",
                  maxWidth: 180,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {c.latest.text || "—"}
              </span>
              <span
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: "50%",
                  background: "#25D366",
                  color: "#fff",
                  fontSize: 10,
                  fontWeight: 700,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {c.count}
              </span>
            </Link>
          );
        })}
      </div>
    </FmPanel>
  );
}
