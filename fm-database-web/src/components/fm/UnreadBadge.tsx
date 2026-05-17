import type { ClientUnreadCounts } from "@/lib/fmdb/loader-extras";

/**
 * Phone-style numbered chip showing how much unread activity a client has.
 * Renders nothing when total = 0.
 *
 * Visual: indigo pill with the total count. `title` attribute provides a
 * native browser tooltip listing the breakdown — keeps the markup tiny
 * (no popover state to manage on the server-rendered side).
 *
 * The badge clears when the coach opens the relevant tab on that client's
 * page. See markCoachTabViewed() in loader-extras.ts.
 */
export function UnreadBadge({ counts }: { counts?: ClientUnreadCounts }) {
  if (!counts || counts.total <= 0) return null;
  const parts: string[] = [];
  if (counts.whatsapp > 0) parts.push(`${counts.whatsapp} WhatsApp`);
  if (counts.intake > 0) parts.push(`${counts.intake} intake`);
  if (counts.alerts > 0) parts.push(`${counts.alerts} alert`);
  if (counts.bookings > 0) parts.push(`${counts.bookings} booking`);
  const tooltip = parts.join(" · ");
  return (
    <span
      title={tooltip}
      aria-label={`${counts.total} unread: ${tooltip}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 20,
        height: 20,
        padding: "0 6px",
        borderRadius: 10,
        fontSize: 11,
        fontWeight: 700,
        lineHeight: 1,
        background: "#4f46e5",
        color: "white",
        marginLeft: 8,
        verticalAlign: "middle",
      }}
    >
      {counts.total}
    </span>
  );
}
