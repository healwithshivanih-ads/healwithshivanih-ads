"use client";

/**
 * Plan end-game nudge panel — lists clients whose programme is reaching its
 * recheck (REVIEW window) or maintenance renewal, with a one-tap WhatsApp nudge
 * (fm_review_checkin_v1). Self-hides when none. Mirrors StartDateReminderPanel.
 */

import { useEffect, useState } from "react";
import type { ReviewNudgeFlag } from "@/lib/server-actions/review-nudges";

const SEC = "var(--fm-text-secondary, #6f6a5d)";
const INK = "var(--fm-text-primary, #2c2a24)";
const LINE = "var(--fm-border, #e6e1d6)";
const FOREST = "#2d5a3d";

function human(ymd: string): string {
  const d = new Date(ymd + "T00:00:00Z");
  return Number.isNaN(d.getTime()) ? ymd : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}
function sentAgo(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "sent";
  const days = Math.floor((Date.now() - ms) / 86_400_000);
  return days <= 0 ? "today" : days === 1 ? "1d ago" : `${days}d ago`;
}

export function ReviewNudgePanel({ whatsappConfigured }: { whatsappConfigured: boolean }) {
  const [flags, setFlags] = useState<ReviewNudgeFlag[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { listReviewNudgesAction } = await import("@/lib/server-actions/review-nudges");
        const r = await listReviewNudgesAction();
        if (alive) setFlags(r);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "failed to load");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const send = async (clientId: string) => {
    setSendingId(clientId);
    setError(null);
    try {
      const { sendReviewNudgeAction } = await import("@/lib/server-actions/review-nudges");
      const r = await sendReviewNudgeAction(clientId);
      if (r.ok) setSentIds((s) => new Set(s).add(clientId));
      else setError(r.error || "send failed");
    } catch (e) {
      setError(e instanceof Error ? e.message : "send failed");
    } finally {
      setSendingId(null);
    }
  };

  if (loading || !flags || flags.length === 0) return null; // self-hide

  return (
    <div style={{ border: `1px solid ${LINE}`, borderRadius: 14, padding: "14px 16px", background: "var(--fm-surface, #fff)" }}>
      <div style={{ fontSize: 14.5, fontWeight: 600, color: INK }}>
        🌿 Wrapping up — {flags.length} to nudge
      </div>
      <p style={{ fontSize: 12.5, color: SEC, lineHeight: 1.5, margin: "4px 0 10px" }}>
        These clients are at their recheck point (or maintenance renewal). A nudge invites them to review progress + plan what&apos;s next.
      </p>
      <div style={{ display: "grid", gap: 8 }}>
        {flags.map((f) => {
          const done = sentIds.has(f.clientId) || !!f.lastSentAt;
          return (
            <div key={f.clientId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "8px 0", borderTop: `1px solid ${LINE}` }}>
              <div style={{ minWidth: 0 }}>
                <a href={`/clients-v2/${f.clientId}`} style={{ fontSize: 13.5, fontWeight: 600, color: INK, textDecoration: "none" }}>{f.name}</a>
                <div style={{ fontSize: 11.5, color: f.kind === "lapse" ? "#b3402a" : SEC, fontWeight: f.kind === "lapse" ? 600 : 400 }}>
                  {f.kind === "renewal"
                    ? `Maintenance renews ${human(f.date)}`
                    : f.kind === "lapse"
                      ? `⚠ Lapsed ${human(f.date)} — in grace`
                      : `Recheck ${human(f.date)}`}
                </div>
              </div>
              {done ? (
                <span style={{ fontSize: 12, color: FOREST, fontWeight: 600, whiteSpace: "nowrap" }}>
                  ✓ Sent {sentIds.has(f.clientId) ? "now" : f.lastSentAt ? sentAgo(f.lastSentAt) : ""}
                </span>
              ) : (
                <button
                  onClick={() => send(f.clientId)}
                  disabled={!whatsappConfigured || sendingId === f.clientId}
                  title={whatsappConfigured ? "" : "WhatsApp server not configured"}
                  style={{ fontSize: 12.5, padding: "6px 12px", borderRadius: 9, border: "none", background: whatsappConfigured ? FOREST : "#bbb", color: "#fff", cursor: whatsappConfigured ? "pointer" : "not-allowed", whiteSpace: "nowrap" }}
                >
                  {sendingId === f.clientId ? "Sending…" : "Send nudge"}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {error && <div style={{ fontSize: 12, color: "#b3402a", marginTop: 8 }}>{error}</div>}
    </div>
  );
}
