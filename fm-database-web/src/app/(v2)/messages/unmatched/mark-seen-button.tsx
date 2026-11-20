"use client";

/**
 * "Mark seen" for a message from a number that is not on the roster. Marks
 * every message from that number (one click per person), stored in
 * ~/fm-plans/_whatsapp_unmatched_seen.yaml so it survives a rebuild. It does
 * not send anything to anyone.
 */

import { useTransition } from "react";
import { toast } from "sonner";
import { markUnmatchedSenderSeenAction } from "../actions";

export function UnmatchedMarkSeenButton({ phoneKey }: { phoneKey: string }) {
  const [pending, start] = useTransition();
  const onClick = () => {
    start(async () => {
      const r = await markUnmatchedSenderSeenAction(phoneKey);
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
        whiteSpace: "nowrap",
      }}
      title="Marks every message from this number as seen. Nothing is sent."
    >
      {pending ? "…" : "✓ Mark seen"}
    </button>
  );
}
