/**
 * FmStrandedIntakeBanner — dashboard surfacing for "client filled the
 * intake form but never tapped Submit". The auto-save fires as fields
 * change, but Submit is a separate tap; many clients mistake "Saved ✓"
 * for "done" and close the tab, stranding all their answers in
 * client.intake_form_draft. Without this banner, those answers sit
 * invisible until coach opens that client's Overview.
 *
 * Pranati Kar (cl-009) hit this 2026-05-23 — 63 filled fields, never
 * promoted, only discovered because coach asked about Deepti's WhatsApp
 * history. This banner makes the issue self-evident from the dashboard.
 *
 * Each row shows:
 *   - client name (links to Overview)
 *   - fields filled count
 *   - hours since last edit
 *   - "Promote answers" button → calls promoteIntakeDraft(clientId)
 *
 * Once promoted, the client.intake_form_draft is cleared by the shim,
 * so the row drops off this banner naturally on the next page load.
 */
"use client";

import { useState } from "react";
import Link from "next/link";
import { FmPanel } from "./FmPanel";
import type { StrandedIntakeDraft } from "@/lib/fmdb/loader-extras";

export interface FmStrandedIntakeBannerProps {
  drafts: StrandedIntakeDraft[];
}

function relativeHours(hours: number): string {
  if (hours < 1) return "minutes ago";
  if (hours < 24) return `${hours}h ago`;
  const d = Math.round(hours / 24);
  return `${d}d ago`;
}

export function FmStrandedIntakeBanner({ drafts }: FmStrandedIntakeBannerProps) {
  // Hooks must run on every render — call before any early returns.
  const [promoting, setPromoting] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  if (drafts.length === 0) return null;
  const visible = drafts.filter((d) => !done.has(d.client_id));
  if (visible.length === 0) return null;

  async function promote(clientId: string) {
    setPromoting(clientId);
    setError(null);
    try {
      const { promoteIntakeDraft } = await import("@/lib/server-actions/intake");
      const res = await promoteIntakeDraft(clientId);
      if (res.ok) {
        setDone((s) => new Set(s).add(clientId));
      } else {
        setError(`${clientId}: ${res.error ?? "promote failed"}`);
      }
    } catch (e) {
      setError(`${clientId}: ${(e as Error).message}`);
    } finally {
      setPromoting(null);
    }
  }

  return (
    <FmPanel
      title="📝 Filled but never submitted"
      subtitle="Clients who filled the intake form, didn't tap Submit, and walked away. The form auto-saves but the final tap matters — without it, downstream panels show empty."
      style={{
        background: "rgba(245, 158, 11, 0.06)",
        borderColor: "rgba(245, 158, 11, 0.32)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {visible.map((d) => {
          const name = d.display_name || d.client_id;
          const isBusy = promoting === d.client_id;
          return (
            <div
              key={d.client_id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "8px 12px",
                background: "rgba(255, 255, 255, 0.6)",
                border: "1px solid rgba(245, 158, 11, 0.25)",
                borderRadius: 6,
                fontSize: 14,
              }}
            >
              <Link
                href={`/clients-v2/${d.client_id}`}
                style={{ fontWeight: 600, color: "#92400e", textDecoration: "none" }}
              >
                {name}
              </Link>
              <span style={{ color: "#78716c" }}>
                · {d.fields_filled} field{d.fields_filled === 1 ? "" : "s"} filled
              </span>
              <span style={{ color: "#a8a29e", fontSize: 13 }}>
                · last edit {relativeHours(d.hours_since_edit)}
              </span>
              <span style={{ flex: 1 }} />
              <button
                type="button"
                onClick={() => promote(d.client_id)}
                disabled={isBusy}
                style={{
                  padding: "5px 12px",
                  fontSize: 13,
                  fontWeight: 600,
                  background: isBusy ? "#d6d3d1" : "#92400e",
                  color: "white",
                  border: "none",
                  borderRadius: 5,
                  cursor: isBusy ? "wait" : "pointer",
                }}
              >
                {isBusy ? "Promoting…" : "Promote answers"}
              </button>
            </div>
          );
        })}
        {error && (
          <div style={{ color: "#b91c1c", fontSize: 13, padding: "4px 12px" }}>{error}</div>
        )}
        <div style={{ color: "#78716c", fontSize: 12, padding: "2px 12px" }}>
          Promoting copies their answers from the draft into the real client
          fields (same as if they'd tapped Submit). Coach can then review and
          finalise the intake normally.
        </div>
      </div>
    </FmPanel>
  );
}
