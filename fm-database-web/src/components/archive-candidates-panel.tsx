"use client";

/**
 * ArchiveCandidatesPanel — the "declutter" nudge on the dashboard.
 *
 * Lists inactive clients (declined, or never signed up, quiet 21+ days, no
 * active plan) the coach can one-click archive. Nothing is archived without
 * her confirming each row. Self-hides when there are no candidates.
 *
 * Archiving flips client.yaml#archived → the client drops off the dashboard
 * triage AND the default /clients-v2 roster, reappearing under the
 * "🗄 Archived" filter where it can be unarchived any time.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { archiveClient } from "@/lib/server-actions/clients";
import type { ArchiveCandidate } from "@/lib/fmdb/archive-candidates";
import { FmPanel } from "@/components/fm";

function reasonFor(c: ArchiveCandidate): string {
  return c.category === "declined"
    ? "declined"
    : `no sign-up (${c.daysInactive}d quiet)`;
}

export function ArchiveCandidatesPanel({
  candidates,
}: {
  candidates: ArchiveCandidate[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Track which client_ids have been archived this render so their rows
  // disappear immediately (before the refresh lands).
  const [done, setDone] = useState<Set<string>>(new Set());

  const rows = candidates.filter((c) => !done.has(c.client_id));
  if (rows.length === 0) return null;

  function archive(c: ArchiveCandidate) {
    startTransition(async () => {
      const res = await archiveClient(c.client_id, reasonFor(c));
      if (res.ok) {
        setDone((prev) => new Set(prev).add(c.client_id));
        toast.success(`Archived ${c.display_name}`);
        router.refresh();
      } else {
        toast.error(res.error || "Failed to archive");
      }
    });
  }

  function archiveAll() {
    startTransition(async () => {
      let ok = 0;
      for (const c of rows) {
        const res = await archiveClient(c.client_id, reasonFor(c));
        if (res.ok) {
          ok += 1;
          setDone((prev) => new Set(prev).add(c.client_id));
        }
      }
      if (ok > 0) {
        toast.success(`Archived ${ok} client${ok === 1 ? "" : "s"}`);
        router.refresh();
      }
    });
  }

  return (
    <FmPanel
      style={{
        background: "rgba(120, 120, 128, 0.05)",
        borderColor: "rgba(120, 120, 128, 0.28)",
        padding: "12px 14px",
        marginBottom: 16,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          marginBottom: 10,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div
            style={{
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: 0.7,
              fontWeight: 700,
              color: "#5b6472",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span>🗄</span>
            <span>Archive suggestions ({rows.length})</span>
          </div>
          <div
            style={{
              fontSize: 11.5,
              color: "var(--fm-text-tertiary)",
              marginTop: 3,
            }}
          >
            Inactive 21+ days · never signed up or declined. Archiving hides
            them from the dashboard — you can unarchive any time.
          </div>
        </div>
        {rows.length > 1 && (
          <button
            type="button"
            onClick={archiveAll}
            disabled={pending}
            style={{
              border: "1px solid rgba(120, 120, 128, 0.4)",
              background: "var(--fm-surface)",
              color: "#5b6472",
              borderRadius: "var(--fm-radius-sm)",
              padding: "6px 12px",
              fontSize: 12,
              fontWeight: 700,
              cursor: pending ? "wait" : "pointer",
              fontFamily: "inherit",
              opacity: pending ? 0.6 : 1,
            }}
          >
            Archive all {rows.length}
          </button>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {rows.map((c) => (
          <div
            key={c.client_id}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              padding: "7px 10px",
              background: "var(--fm-surface)",
              border: "1px solid var(--fm-border-light)",
              borderRadius: "var(--fm-radius-sm)",
            }}
          >
            <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <Link
                href={`/clients-v2/${c.client_id}`}
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "var(--fm-text-primary)",
                  textDecoration: "none",
                }}
              >
                {c.display_name}
              </Link>
              <span
                style={{
                  fontSize: 11,
                  color: c.category === "declined" ? "#c0392b" : "var(--fm-text-secondary)",
                  fontWeight: 600,
                }}
              >
                {c.reason}
              </span>
            </div>
            <button
              type="button"
              onClick={() => archive(c)}
              disabled={pending}
              style={{
                flexShrink: 0,
                border: "1px solid rgba(120, 120, 128, 0.4)",
                background: "transparent",
                color: "#5b6472",
                borderRadius: "var(--fm-radius-pill)",
                padding: "4px 12px",
                fontSize: 12,
                fontWeight: 700,
                cursor: pending ? "wait" : "pointer",
                fontFamily: "inherit",
                opacity: pending ? 0.6 : 1,
              }}
            >
              🗄 Archive
            </button>
          </div>
        ))}
      </div>
    </FmPanel>
  );
}
