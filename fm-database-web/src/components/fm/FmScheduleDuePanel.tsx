"use client";

/**
 * FmScheduleDuePanel — dashboard surface for "who needs a booking link".
 *
 * Companion to FmInboundMessagesBanner + FmIntakeActivityBanner: a
 * passive heads-up that becomes actionable in two clicks.
 *
 * Rules (computed server-side in scheduling-due.ts):
 *   - Flag clients ≥ 12 days since their last session
 *   - Flag clients whose plan_period_recheck_date has passed
 *   - Each row gets an auto-picked event type:
 *       Active programme → Coaching (or "next-cycle Coaching" if
 *                                     plan recheck overdue)
 *       Intake-in-flight → Programme Intake
 *       Prospect         → Discovery
 *   - Coach can override the type per row via dropdown
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

export function FmScheduleDuePanel({ rows: initialRows, unread }: FmScheduleDuePanelProps) {
  const router = useRouter();
  const [rows, setRows] = useState<
    Array<SchedulingDueRow & { selected: boolean; override_type?: BookingType }>
  >(() => initialRows.map((r) => ({ ...r, selected: true })));
  const [sendingAll, setSendingAll] = useState(false);
  const [sendingRow, setSendingRow] = useState<string | null>(null);
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());

  if (rows.length === 0) return null;

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

  return (
    <FmPanel
      style={{
        padding: "12px 16px",
        background: "linear-gradient(135deg, rgba(99, 102, 241, 0.08), rgba(168, 85, 247, 0.05))",
        borderColor: "rgba(99, 102, 241, 0.3)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <span style={{ fontSize: 22 }}>📅</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#3730a3" }}>
            Time to schedule next session
            <span
              style={{
                fontSize: 9.5,
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
              {rows.filter((r) => !doneIds.has(r.client_id)).length} due
            </span>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--fm-text-secondary)" }}>
            12+ days since last session, or plan recheck overdue. Each row
            auto-picks the right booking type — override per row before sending.
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
            fontSize: 11.5,
            fontWeight: 700,
            borderRadius: "var(--fm-radius-sm)",
            cursor: sendingAll
              ? "wait"
              : selected.length === 0
                ? "not-allowed"
                : "pointer",
            fontFamily: "inherit",
            whiteSpace: "nowrap",
          }}
        >
          {sendingAll
            ? "Sending…"
            : `📤 Send to ${selected.length} selected`}
        </button>
      </div>

      <div style={{ display: "grid", gap: 4 }}>
        {rows.map((r) => {
          const isDone = doneIds.has(r.client_id);
          const isSending = sendingRow === r.client_id;
          const type = r.override_type ?? r.recommended_type;
          const meta = TYPE_META[type];
          return (
            <div
              key={r.client_id}
              style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr auto auto",
                gap: 10,
                alignItems: "center",
                padding: "6px 10px",
                background: isDone ? "rgba(16, 185, 129, 0.08)" : "var(--fm-surface)",
                border: `1px solid ${isDone ? "rgba(16, 185, 129, 0.35)" : "var(--fm-border-light)"}`,
                borderRadius: "var(--fm-radius-sm)",
                opacity: isDone ? 0.7 : 1,
              }}
            >
              <input
                type="checkbox"
                checked={r.selected && !isDone}
                disabled={isDone}
                onChange={() => toggleRow(r.client_id)}
                style={{ accentColor: "#4338ca" }}
              />
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 12.5,
                    fontWeight: 700,
                    color: "var(--fm-text-primary)",
                  }}
                >
                  {r.display_name}
                  <UnreadBadge counts={unread?.[r.client_id]} />
                </div>
                <div
                  style={{
                    fontSize: 10.5,
                    color: "var(--fm-text-tertiary)",
                    marginTop: 1,
                  }}
                >
                  {r.reason}
                </div>
              </div>
              <select
                value={type}
                disabled={isDone || isSending}
                onChange={(e) => setOverrideType(r.client_id, e.target.value as BookingType)}
                style={{
                  fontSize: 11.5,
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
        })}
      </div>
    </FmPanel>
  );
}
