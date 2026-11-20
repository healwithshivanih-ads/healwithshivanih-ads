/**
 * /messages/unmatched — WhatsApp messages from numbers that are not on the
 * roster (not a client, not a parked prospect).
 *
 * The webhook has always parked these in ~/fm-plans/_whatsapp_unmatched.yaml;
 * this page is the first thing that shows them. Read-only: newest first, with
 * the sender's WhatsApp name, number, time and text, and a "Mark seen" button.
 * There is deliberately no reply box, no auto-reply and no link that sends
 * anything — the coach answers from WhatsApp herself if she wants to.
 */
import Link from "next/link";
import { FmAppShell, FmPageHeader, FmPanel } from "@/components/fm";
import {
  loadUnmatchedMessages,
  countUnread,
  UNMATCHED_UNREAD_DAYS,
  type UnmatchedMessage,
} from "@/lib/fmdb/whatsapp-unmatched";
import { UnmatchedMarkSeenButton } from "./mark-seen-button";

export const dynamic = "force-dynamic";

/** The list is append-only and never pruned; show the newest slice. */
const MAX_ROWS = 200;

/** "919876543210" → "+91 98765 43210". Anything else is shown as stored. */
function formatPhone(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) return `+91 ${d.slice(2, 7)} ${d.slice(7)}`;
  if (d.length > 10) return `+${d}`;
  return phone;
}

/** "18/11/2026, 8:17:05 am" (how the webhook stores IST time) → "18 Nov 2026, 8:17 am".
 *  Anything that does not look like that is shown as stored. */
function formatWhen(m: UnmatchedMessage): string {
  const x = /^(\d{1,2})\/(\d{1,2})\/(\d{4}),\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap])\.?m\.?$/i.exec(m.receivedAt);
  if (!x) return m.receivedAt || m.date;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const mon = months[Number(x[2]) - 1];
  if (!mon) return m.receivedAt;
  return `${Number(x[1])} ${mon} ${x[3]}, ${Number(x[4])}:${x[5]} ${x[6].toLowerCase()}m`;
}

export default async function UnmatchedMessagesPage() {
  const all = await loadUnmatchedMessages();
  const unread = countUnread(all);
  const rows = all.slice(0, MAX_ROWS);

  return (
    <FmAppShell
      activeNavId="messages"
      crumbs={[{ label: "Messages", href: "/messages" }, { label: "New numbers" }]}
    >
      <FmPageHeader
        title="Messages from new numbers"
        subtitle={`WhatsApp messages from people who are not on your client or prospect list. ${
          unread > 0 ? `${unread} not seen yet.` : "Nothing new."
        }`}
      />

      {rows.length === 0 ? (
        <FmPanel style={{ marginTop: 16 }}>
          <div style={{ padding: "40px 16px", textAlign: "center", color: "var(--fm-text-secondary)" }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
            <p style={{ fontSize: 13, margin: 0 }}>No messages from new numbers.</p>
          </div>
        </FmPanel>
      ) : (
        <FmPanel style={{ marginTop: 16, padding: 0 }}>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {rows.map((m, i) => (
              <li
                key={`${m.id}-${i}`}
                data-unread={m.isUnread ? "1" : "0"}
                style={{
                  display: "grid",
                  gridTemplateColumns: "190px minmax(0, 1fr) auto",
                  gap: 14,
                  alignItems: "start",
                  padding: "12px 16px",
                  borderBottom: i === rows.length - 1 ? 0 : "1px solid var(--fm-border-light)",
                  background: m.isUnread ? "rgba(46, 110, 213, 0.04)" : "transparent",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: m.isUnread ? 700 : 600,
                      color: "var(--fm-text-primary)",
                      overflowWrap: "anywhere",
                    }}
                  >
                    {m.isUnread && (
                      <span
                        style={{
                          display: "inline-block",
                          width: 7,
                          height: 7,
                          borderRadius: "50%",
                          background: "#2E6ED5",
                          marginRight: 7,
                        }}
                      />
                    )}
                    {m.name ?? "No name on WhatsApp"}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--fm-text-secondary)",
                      fontFamily: "var(--fm-font-mono)",
                      marginTop: 2,
                    }}
                  >
                    {formatPhone(m.phone)}
                  </div>
                </div>
                <div
                  style={{
                    fontSize: 13,
                    lineHeight: 1.5,
                    color: m.isUnread ? "var(--fm-text-primary)" : "var(--fm-text-secondary)",
                    whiteSpace: "pre-wrap",
                    overflowWrap: "anywhere",
                  }}
                >
                  {m.text || (
                    <span style={{ fontStyle: "italic", color: "var(--fm-text-tertiary)" }}>
                      No text (a photo, voice note or file). Open WhatsApp to see it.
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                  <span style={{ fontSize: 11, color: "var(--fm-text-tertiary)", whiteSpace: "nowrap" }}>
                    {formatWhen(m)}
                  </span>
                  {m.isUnread ? (
                    <UnmatchedMarkSeenButton phoneKey={m.phoneKey} />
                  ) : m.seenAt ? (
                    <span style={{ fontSize: 11, color: "var(--fm-text-tertiary)" }}>✓ Seen</span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </FmPanel>
      )}

      <div
        style={{
          marginTop: 14,
          padding: "8px 12px",
          fontSize: 11,
          color: "var(--fm-text-tertiary)",
          fontStyle: "italic",
          lineHeight: 1.5,
        }}
      >
        Nothing is sent from this page. Reply from WhatsApp if you want to. A message counts as new for{" "}
        {UNMATCHED_UNREAD_DAYS} days or until you mark it seen; once someone is added as a client or prospect, their
        messages go to their own thread instead.{" "}
        {all.length > MAX_ROWS ? `Showing the newest ${MAX_ROWS} of ${all.length}. ` : ""}
        <Link href="/messages" style={{ color: "var(--fm-primary)" }}>
          Back to client messages
        </Link>
      </div>
    </FmAppShell>
  );
}
