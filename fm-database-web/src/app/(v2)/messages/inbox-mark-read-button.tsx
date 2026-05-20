"use client";

/**
 * Mark-read button for the inbox list. Stamps the
 * _whatsapp_inbox_state.yaml entry for this client to `now`, which
 * filters this (and any older) message out of the unread bucket on
 * the next render. Server action revalidates /messages so the row
 * updates in-place.
 */

import { useTransition } from "react";
import { toast } from "sonner";
import { markInboxReadAction } from "./actions";

export function InboxMarkReadButton({ clientId }: { clientId: string }) {
  const [pending, start] = useTransition();
  const onClick = () => {
    start(async () => {
      const r = await markInboxReadAction(clientId);
      if (!r.ok) toast.error(r.error);
    });
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      style={{
        fontSize: 11,
        fontWeight: 600,
        padding: "4px 10px",
        background: "var(--fm-surface)",
        color: "var(--fm-text-secondary)",
        border: "1px solid var(--fm-border)",
        borderRadius: "var(--fm-radius-sm)",
        cursor: pending ? "wait" : "pointer",
        fontFamily: "inherit",
      }}
      title="Mark all messages from this client as read"
    >
      {pending ? "…" : "✓ Mark read"}
    </button>
  );
}
