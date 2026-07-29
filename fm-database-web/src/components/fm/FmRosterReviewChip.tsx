"use client";

/**
 * FmRosterReviewChip — standing guardrail against an over-generous roster.
 *
 * `fmdb prospects-sweep` parks people who never signed up, but it only ever
 * looks at records that are NOT signed_up. A record wrongly marked signed_up is
 * invisible to it and quietly inflates the active count — Anita Pansari
 * (cl-020) sat in the roster for a month on a discovery consult alone.
 *
 * Self-loading like FmCatalogueOrphanChip: fetches on mount so it adds zero
 * latency to the dashboard's server render, and renders nothing when clean.
 *
 * Informational only — no mutate action. Auto-correcting a signed_up record
 * risks exiling a genuinely paying client over a data gap, so this points the
 * coach at the record and lets them judge.
 */
import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import {
  getRosterReviewStatus,
  type RosterReviewStatus,
} from "@/app/roster-review-action";

export function FmRosterReviewChip() {
  const [status, setStatus] = useState<RosterReviewStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  const load = () =>
    start(async () => {
      setStatus(await getRosterReviewStatus());
    });

  useEffect(() => {
    void (async () => setStatus(await getRosterReviewStatus()))();
  }, []);

  // Nothing until loaded, and hidden when the roster is clean.
  if (!status || status.flagged === 0) return null;

  const n = status.flagged;

  return (
    <section
      style={{
        padding: "14px 16px",
        borderRadius: "var(--fm-radius-lg)",
        background:
          "linear-gradient(135deg, rgba(217,119,6,0.08), rgba(180,83,9,0.13))",
        border: "1.5px solid rgba(217,119,6,0.35)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 22 }}>🧾</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#92400e" }}>
            {n} client{n === 1 ? "" : "s"} marked signed up with nothing to show for it
          </div>
          <div style={{ fontSize: 12, color: "var(--fm-text-secondary)" }}>
            No intake submitted, no plan, and gone quiet — counted in your{" "}
            {status.rosterSize} active. Confirm each, or set them back to pending.
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          style={{
            background: "transparent",
            border: "1px solid rgba(0,0,0,0.10)",
            padding: "6px 12px",
            fontSize: 12,
            fontWeight: 600,
            color: "#92400e",
            borderRadius: "var(--fm-radius-sm)",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          {open ? "Hide list" : "Review"}
        </button>
        <button
          type="button"
          onClick={load}
          disabled={pending}
          title="Re-scan"
          style={{
            background: "transparent",
            border: "1px solid rgba(0,0,0,0.10)",
            padding: "6px 10px",
            fontSize: 12,
            color: "#b45309",
            borderRadius: "var(--fm-radius-sm)",
            cursor: pending ? "wait" : "pointer",
            fontFamily: "inherit",
            opacity: pending ? 0.6 : 1,
          }}
        >
          ↻
        </button>
      </div>

      {open && (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            background: "var(--fm-surface)",
            border: "1px solid var(--fm-border-light)",
            borderRadius: "var(--fm-radius-md)",
          }}
        >
          <div
            style={{
              fontSize: 11,
              color: "var(--fm-text-tertiary)",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: 0.7,
              marginBottom: 10,
            }}
          >
            Fix: open the client and set engagement to pending or declined — the
            next sweep parks them
          </div>
          <div style={{ display: "grid", gap: 4, maxHeight: 260, overflowY: "auto" }}>
            {status.items.map((c) => (
              <Link
                key={c.client_id}
                href={`/clients-v2/${c.client_id}`}
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 8,
                  padding: "6px 8px",
                  background: "var(--fm-bg-cool)",
                  border: "1px solid var(--fm-border-light)",
                  borderRadius: "var(--fm-radius-sm)",
                  fontSize: 12,
                  textDecoration: "none",
                  color: "inherit",
                }}
                title={c.reason}
              >
                <span style={{ fontWeight: 600, color: "#b45309" }}>
                  {c.display_name}
                </span>
                <span
                  style={{
                    fontFamily: "var(--fm-font-mono, ui-monospace, Menlo, monospace)",
                    color: "var(--fm-text-tertiary)",
                    fontSize: 11,
                  }}
                >
                  {c.client_id}
                </span>
                <span style={{ marginLeft: "auto", color: "var(--fm-text-tertiary)" }}>
                  {c.quiet_days === null ? "no dateable activity" : `quiet ${c.quiet_days}d`}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
