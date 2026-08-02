"use client";

/**
 * ClientArchiveControl — archive / unarchive a client from their Overview.
 *
 * Two states:
 *   - archived: a full-width gray banner at the top of the page with the
 *     reason + date and a one-click "↩ Unarchive" to restore.
 *   - not archived: a slim, right-aligned "🗄 Archive" button that expands
 *     to a two-step confirm (archiving hides the client from the dashboard
 *     and the default roster, so we never do it on a single stray click).
 *
 * Archiving is coach housekeeping for inactive / never-converted clients —
 * the record stays intact and reappears under the /clients-v2 "🗄 Archived"
 * filter.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { archiveClient, unarchiveClient } from "@/lib/server-actions/clients";

export function ClientArchiveControl({
  clientId,
  displayName,
  archived,
  archivedAt,
  archivedReason,
}: {
  clientId: string;
  displayName: string;
  archived: boolean;
  archivedAt?: string;
  archivedReason?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  function doArchive() {
    startTransition(async () => {
      const res = await archiveClient(clientId, "manual");
      if (res.ok) {
        toast.success(`Archived ${displayName}`);
        setConfirming(false);
        router.refresh();
      } else {
        toast.error(res.error || "Failed to archive");
      }
    });
  }

  function doUnarchive() {
    startTransition(async () => {
      const res = await unarchiveClient(clientId);
      if (res.ok) {
        toast.success(`Restored ${displayName}`);
        router.refresh();
      } else {
        toast.error(res.error || "Failed to unarchive");
      }
    });
  }

  if (archived) {
    const when = archivedAt ? archivedAt.slice(0, 10) : null;
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          padding: "10px 14px",
          marginBottom: 12,
          background: "rgba(120, 120, 128, 0.10)",
          border: "1px solid rgba(120, 120, 128, 0.4)",
          borderRadius: "var(--fm-radius-md)",
        }}
      >
        <div style={{ fontSize: 13, color: "#5b6472" }}>
          <strong>🗄 Archived</strong>
          {archivedReason ? ` · ${archivedReason}` : ""}
          {when ? ` · ${when}` : ""}
          <span style={{ color: "var(--fm-text-tertiary)", marginLeft: 8 }}>
            Hidden from the dashboard &amp; default roster.
          </span>
        </div>
        <button
          type="button"
          onClick={doUnarchive}
          disabled={pending}
          style={{
            border: "1px solid rgba(46, 204, 113, 0.4)",
            background: "var(--fm-surface)",
            color: "#1E8449",
            borderRadius: "var(--fm-radius-sm)",
            padding: "6px 14px",
            fontSize: 13,
            fontWeight: 700,
            cursor: pending ? "wait" : "pointer",
            fontFamily: "inherit",
            opacity: pending ? 0.6 : 1,
          }}
        >
          ↩ Unarchive
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "flex-end",
        marginBottom: 8,
      }}
    >
      {confirming ? (
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: "var(--fm-text-secondary)" }}>
            Archive {displayName}? Hides them from the dashboard.
          </span>
          <button
            type="button"
            onClick={doArchive}
            disabled={pending}
            style={{
              border: "1px solid rgba(120, 120, 128, 0.5)",
              background: "#5b6472",
              color: "#fff",
              borderRadius: "var(--fm-radius-sm)",
              padding: "5px 12px",
              fontSize: 12,
              fontWeight: 700,
              cursor: pending ? "wait" : "pointer",
              fontFamily: "inherit",
              opacity: pending ? 0.6 : 1,
            }}
          >
            🗄 Yes, archive
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={pending}
            style={{
              border: "0",
              background: "transparent",
              color: "var(--fm-text-tertiary)",
              fontSize: 12,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          style={{
            border: "1px solid var(--fm-border)",
            background: "transparent",
            color: "var(--fm-text-tertiary)",
            borderRadius: "var(--fm-radius-pill)",
            padding: "4px 12px",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          🗄 Archive client
        </button>
      )}
    </div>
  );
}
