"use client";

/**
 * FmScheduleDuePanel — dashboard surface for "who needs a booking link".
 *
 * Two visual sections, both served from the same getSchedulingDueRows scan:
 *
 *   Amber "Due soon" (proactive, 3-day advance signal):
 *     - upcoming_in_days set (plan recheck / next_contact_date / session
 *       gap approaching 12-day threshold) AND not yet overdue
 *
 *   Indigo "Overdue" (already past the threshold):
 *     - plan_period_recheck_date already passed, OR
 *     - ≥ 12 days since last session
 *
 * Cal.com cross-reference: clients with a future booking are already
 * excluded server-side (scheduling-due.ts) — they never appear here.
 *
 * Bulk send: each row has its OWN slug. The "Send to N selected" button
 * fires sends respecting each row's individual slug — so a mixed batch
 * (3× Coaching + 1× Programme Intake) goes out correctly in one click.
 *
 * Safe by default: per-row checkboxes start checked, but bulk-send
 * shows a confirm dialog summarising "3 Coaching + 1 Intake = 4 sends"
 * so coach reviews before firing.
 */
import { useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { sendBookingLinkBulkAction } from "@/app/api/whatsapp/calcom-actions";
import { FmPanel } from "./FmPanel";
import type { BookingType, SchedulingDueRow } from "@/lib/fmdb/scheduling-due";
import type { ClientUnreadCounts } from "@/lib/fmdb/loader-extras";
import { UnreadBadge } from "./UnreadBadge";

const TYPE_META: Record<BookingType, { emoji: string; label: string }> = {
  "discovery": { emoji: "🔍", label: "Discovery" },
  "programme-intake": { emoji: "🌿", label: "Programme Intake" },
  "coaching": { emoji: "💬", label: "Coaching" },
};

export interface FmScheduleDuePanelProps {
  rows: SchedulingDueRow[];
  /** Per-client unread badge counts. Plain object so it serialises
   *  cleanly from RSC → client component. */
  unread?: Record<string, ClientUnreadCounts>;
}

/** True when a row is the "proactive due soon" signal (not yet overdue). */
function isUpcomingOnly(r: SchedulingDueRow): boolean {
  return (
    r.upcoming_in_days !== undefined &&
    !r.plan_recheck_overdue_days &&
    (r.days_since_last_session ?? 0) < 12
  );
}

export function FmScheduleDuePanel({ rows: initialRows, unread }: FmScheduleDuePanelProps) {
  const router = useRouter();
  const [rows, setRows] = useState<
    Array<SchedulingDueRow & { selected: boolean; override_type?: BookingType }>
  >(() => initialRows.map((r) => ({ ...r, selected: true })));
  const [sendingAll, setSendingAll] = useState(false);
  const [sendingRow, setSendingRow] = useState<string | null>(null);
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());

  if (rows.length === 0) return null;

  // Split into two groups
  const upcomingRows = rows.filter((r) => isUpcomingOnly(r));
  const overdueRows = rows.filter((r) => !isUpcomingOnly(r));

  const selected = rows.filter((r) => r.selected && !doneIds.has(r.client_id));
  const byType = selected.reduce<Record<BookingType, number>>(
    (acc, r) => {
      const t = r.override_type ?? r.recommended_type;
      acc[t] = (acc[t] ?? 0) + 1;
      return acc;
    },
    { "discovery": 0, "programme-intake": 0, "coaching": 0 },
  );
  const summary = (Object.keys(byType) as BookingType[])
    .filter((t) => byType[t] > 0)
    .map((t) => `${byType[t]}× ${TYPE_META[t].label}`)
    .join(" + ");

  const toggleRow = (id: string) =>
    setRows((rs) => rs.map((r) => (r.client_id === id ? { ...r, selected: !r.selected } : r)));

  const setOverrideType = (id: string, t: BookingType) =>
    setRows((rs) => rs.map((r) => (r.client_id === id ? { ...r, override_type: t } : r)));

  const onSendOne = async (clientId: string) => {
    const row = rows.find((r) => r.client_id === clientId);
    if (!row) return;
    setSendingRow(clientId);
    try {
      const r = await sendBookingLinkBulkAction([
        { clientId, slug: row.override_type ?? row.recommended_type },
      ]);
      if (r.results[0]?.ok) {
        toast.success(`📅 Sent ${TYPE_META[row.override_type ?? row.recommended_type].label} to ${row.display_name}`);
        setDoneIds((s) => new Set([...s, clientId]));
        router.refresh();
      } else {
        toast.error(r.results[0]?.error ?? "Send failed");
      }
    } finally {
      setSendingRow(null);
    }
  };

  const onSendAll = async () => {
    if (selected.length === 0) return;
    if (
      !confirm(
        `Send booking links to ${selected.length} client${selected.length === 1 ? "" : "s"}?\n\n${summary}\n\nEach client gets the type shown in their row.`,
      )
    ) {
      return;
    }
    setSendingAll(true);
    try {
      const payload = selected.map((r) => ({
        clientId: r.client_id,
        slug: r.override_type ?? r.recommended_type,
      }));
      const r = await sendBookingLinkBulkAction(payload);
      const okIds = new Set(r.results.filter((x) => x.ok).map((x) => x.clientId));
      setDoneIds((s) => new Set([...s, ...okIds]));
      if (r.summary.failed === 0) {
        toast.success(`📅 Sent to ${r.summary.sent} clients`);
      } else {
        toast.error(`Sent ${r.summary.sent} · ${r.summary.failed} failed (see results below)`);
      }
      router.refresh();
    } finally {
      setSendingAll(false);
    }
  };

  /** Shared row renderer — used in both sections. */
  const renderRow = (r: typeof rows[number]) => {
    const isDone = doneIds.has(r.client_id);
    const isSending = sendingRow === r.client_id;
    const type = r.override_type ?? r.recommended_type;
    const meta = TYPE_META[type];
    const upcoming = isUpcomingOnly(r);
    return (
      <div
        key={r.client_id}
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr auto auto",
          gap: 10,
          alignItems: "center",
          padding: "6px 10px",
          background: isDone
            ? "rgba(16, 185, 129, 0.08)"
            : upcoming
              ? "rgba(245, 158, 11, 0.04)"
              : "var(--fm-surface)",
          border: `1px solid ${
            isDone
              ? "rgba(16, 185, 129, 0.35)"
              : upcoming
                ? "rgba(245, 158, 11, 0.30)"
                : "var(--fm-border-light)"
          }`,
          borderRadius: "var(--fm-radius-sm)",
          opacity: isDone ? 0.7 : 1,
        }}
      >
        <input
          type="checkbox"
          checked={r.selected && !isDone}
          disabled={isDone}
          onChange={() => toggleRow(r.client_id)}
          style={{ accentColor: upcoming ? "#d97706" : "#4338ca" }}
        />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--fm-text-primary)" }}>
            {r.display_name}
            <UnreadBadge counts={unread?.[r.client_id]} />
            {upcoming && (
              <span
                style={{
                  marginLeft: 8,
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: 0.4,
                  textTransform: "uppercase",
                  padding: "2px 6px",
                  background: "rgba(245, 158, 11, 0.18)",
                  color: "#8a5a08",
                  border: "1px solid rgba(245, 158, 11, 0.45)",
                  borderRadius: "var(--fm-radius-pill)",
                }}
              >
                {r.upcoming_in_days === 0 ? "due today" : `in ${r.upcoming_in_days}d`}
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, color: "var(--fm-text-tertiary)", marginTop: 1 }}>
            {r.reason}
          </div>
        </div>
        <select
          value={type}
          disabled={isDone || isSending}
          onChange={(e) => setOverrideType(r.client_id, e.target.value as BookingType)}
          style={{
            fontSize: 12,
            padding: "3px 8px",
            border: "1px solid var(--fm-border)",
            borderRadius: 4,
            background: "var(--fm-surface)",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          <option value="discovery">🔍 Discovery</option>
          <option value="programme-intake">🌿 Programme Intake</option>
          <option value="coaching">💬 Coaching</option>
        </select>
        <button
          type="button"
          onClick={() => onSendOne(r.client_id)}
          disabled={isDone || isSending || sendingAll}
          style={{
            padding: "4px 10px",
            borderRadius: 4,
            border: 0,
            background: isDone
              ? "rgba(16, 185, 129, 0.2)"
              : isSending
                ? "rgba(0,0,0,0.1)"
                : "#25D366",
            color: isDone ? "#065f46" : "#fff",
            fontSize: 11,
            fontWeight: 600,
            cursor: isDone || isSending ? "default" : "pointer",
            fontFamily: "inherit",
            whiteSpace: "nowrap",
            minWidth: 64,
          }}
          title={
            isDone
              ? "Already sent in this session"
              : `Send ${meta.label} booking link to ${r.display_name}`
          }
        >
          {isDone ? "✓ Sent" : isSending ? "…" : `📤 ${meta.emoji}`}
        </button>
      </div>
    );
  };

  const totalDue = rows.filter((r) => !doneIds.has(r.client_id)).length;

  return (
    <FmPanel
      style={{
        padding: "12px 16px",
        background: "linear-gradient(135deg, rgba(99, 102, 241, 0.07), rgba(168, 85, 247, 0.04))",
        borderColor: "rgba(99, 102, 241, 0.28)",
      }}
    >
      {/* ── Panel header ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 22 }}>📅</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#3730a3" }}>
            Booking links to send
            <span
              style={{
                fontSize: 10,
                marginLeft: 8,
                padding: "1px 6px",
                borderRadius: 3,
                background: "rgba(0,0,0,0.06)",
                color: "#4338ca",
                letterSpacing: 0.6,
                textTransform: "uppercase",
                fontWeight: 700,
              }}
            >
              {totalDue} client{totalDue === 1 ? "" : "s"}
            </span>
          </div>
          <div style={{ fontSize: 12, color: "var(--fm-text-secondary)" }}>
            Clients without a future cal.com booking who need a link sent.
            Auto-picks event type per client — override per row.
          </div>
        </div>
        <button
          type="button"
          onClick={onSendAll}
          disabled={sendingAll || selected.length === 0}
          style={{
            background: selected.length === 0 ? "rgba(0,0,0,0.1)" : "#4338ca",
            color: "#fff",
            border: 0,
            padding: "6px 14px",
            fontSize: 12,
            fontWeight: 700,
            borderRadius: "var(--fm-radius-sm)",
            cursor: sendingAll ? "wait" : selected.length === 0 ? "not-allowed" : "pointer",
            fontFamily: "inherit",
            whiteSpace: "nowrap",
          }}
        >
          {sendingAll ? "Sending…" : `📤 Send to ${selected.length} selected`}
        </button>
      </div>

      {/* ── Amber section: Due soon (proactive 1–3 day signal) ── */}
      {upcomingRows.length > 0 && (
        <div style={{ marginBottom: overdueRows.length > 0 ? 12 : 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginBottom: 6,
              paddingBottom: 4,
              borderBottom: "1px solid rgba(245, 158, 11, 0.25)",
            }}
          >
            <span style={{ fontSize: 13 }}>⏰</span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: 0.6,
                color: "#92400e",
              }}
            >
              Due soon
            </span>
            <span
              style={{
                fontSize: 10,
                padding: "1px 6px",
                borderRadius: 3,
                background: "rgba(245, 158, 11, 0.15)",
                color: "#92400e",
                fontWeight: 700,
              }}
            >
              {upcomingRows.filter((r) => !doneIds.has(r.client_id)).length}
            </span>
            <span style={{ fontSize: 11, color: "var(--fm-text-tertiary)", marginLeft: 4 }}>
              — send now so they can book before the gap grows
            </span>
          </div>
          <div style={{ display: "grid", gap: 4 }}>
            {upcomingRows.map(renderRow)}
          </div>
        </div>
      )}

      {/* ── Indigo section: Already overdue ── */}
      {overdueRows.length > 0 && (
        <div>
          {upcomingRows.length > 0 && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginBottom: 6,
                paddingBottom: 4,
                borderBottom: "1px solid rgba(99, 102, 241, 0.20)",
              }}
            >
              <span style={{ fontSize: 13 }}>⚠️</span>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: 0.6,
                  color: "#3730a3",
                }}
              >
                Overdue
              </span>
              <span
                style={{
                  fontSize: 10,
                  padding: "1px 6px",
                  borderRadius: 3,
                  background: "rgba(99, 102, 241, 0.12)",
                  color: "#3730a3",
                  fontWeight: 700,
                }}
              >
                {overdueRows.filter((r) => !doneIds.has(r.client_id)).length}
              </span>
            </div>
          )}
          <div style={{ display: "grid", gap: 4 }}>
            {overdueRows.map(renderRow)}
          </div>
        </div>
      )}
    </FmPanel>
  );
}
