/**
 * FmUnmatchedMessagesBanner — "someone who is not on your list wrote on
 * WhatsApp". One line + a link to /messages/unmatched, shown on the dashboard
 * and at the top of /messages while any such message is unseen.
 *
 * It shows a COUNT only, never the text: the list page is the one place those
 * messages are read. Nothing here sends anything.
 */
import Link from "next/link";
import { FmPanel } from "./FmPanel";

export interface FmUnmatchedMessagesBannerProps {
  /** Unseen messages from numbers not on the roster. Renders nothing at 0. */
  unread: number;
  /** How many different numbers those came from. */
  senders: number;
  href?: string;
}

export function FmUnmatchedMessagesBanner({
  unread,
  senders,
  href = "/messages/unmatched",
}: FmUnmatchedMessagesBannerProps) {
  if (unread <= 0) return null;
  return (
    <FmPanel
      style={{
        padding: "12px 16px",
        marginTop: 10,
        background: "rgba(46, 110, 213, 0.05)",
        borderColor: "rgba(46, 110, 213, 0.30)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 22 }}>📨</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--fm-text-primary)" }}>
            {`${unread} WhatsApp message${unread === 1 ? "" : "s"} from ${senders === 1 ? "a new number" : `${senders} new numbers`}`}
          </div>
          <div style={{ fontSize: 12, color: "var(--fm-text-secondary)" }}>
            {`Not a client or a prospect on your list, so ${unread === 1 ? "it is" : "they are"} in no one's thread.`}
          </div>
        </div>
        <Link
          href={href}
          style={{
            background: "#2E6ED5",
            color: "#fff",
            padding: "6px 12px",
            fontSize: 12,
            fontWeight: 700,
            borderRadius: "var(--fm-radius-sm)",
            textDecoration: "none",
            whiteSpace: "nowrap",
          }}
        >
          See {unread === 1 ? "it" : "them"} →
        </Link>
      </div>
    </FmPanel>
  );
}
