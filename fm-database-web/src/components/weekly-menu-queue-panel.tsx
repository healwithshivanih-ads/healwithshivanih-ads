"use client";

/**
 * WeeklyMenuQueuePanel — the weekly-cadence review queue (2026-06-12).
 *
 * Two parts:
 *   · PENDING (a draft is waiting) → loud amber banner at the TOP of the
 *     dashboard. Clients stay frozen on their last week until the coach
 *     approves, so this must be impossible to miss (2026-06-30 — coach asked
 *     for it to "stop being hidden and be very visible").
 *   · UPCOMING (no draft yet, auto-drafts at 07:00) → quiet sub-list.
 * Self-hides only when there is genuinely nothing in either bucket.
 * Approval happens in the Plan-tab studio (live phone preview).
 */

import { useEffect, useState } from "react";
import { FmPanel } from "@/components/fm";
import { weeklyMenuQueueAction } from "@/lib/server-actions/weekly-menu";

type Row = Awaited<ReturnType<typeof weeklyMenuQueueAction>>[number];

export function WeeklyMenuQueuePanel({ names }: { names: Record<string, string> }) {
  const [rows, setRows] = useState<Row[] | null>(null);

  const refresh = () =>
    weeklyMenuQueueAction(7)
      .then(setRows)
      .catch(() => setRows([]));

  useEffect(() => {
    void refresh();
  }, []);

  if (!rows || rows.length === 0) return null;

  const pending = rows.filter((r) => r.pending);
  const upcoming = rows.filter((r) => !r.pending);

  return (
    <div style={{ display: "grid", gap: 14, marginBottom: 24 }}>
      {pending.length > 0 && (
        <div
          style={{
            border: "2px solid #d98324",
            borderRadius: 14,
            background: "linear-gradient(180deg,#fff6e9 0%,#fdeed6 100%)",
            boxShadow: "0 2px 10px rgba(217,131,36,0.18)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "14px 18px",
              background: "#d98324",
              color: "#fff",
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                minWidth: 30,
                height: 30,
                padding: "0 9px",
                borderRadius: 999,
                background: "rgba(255,255,255,0.22)",
                fontWeight: 800,
                fontSize: 16,
              }}
            >
              {pending.length}
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 800, fontSize: 16, lineHeight: 1.2 }}>
                Weekly {pending.length === 1 ? "menu" : "menus"} waiting for your approval
              </div>
              <div style={{ fontSize: 12.5, opacity: 0.92 }}>
                These clients stay on their current week until you approve. Review on the live phone, then Approve.
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gap: 8, padding: 14 }}>
            {pending.map((r) => (
              <div
                key={r.clientId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  flexWrap: "wrap",
                  padding: "11px 13px",
                  background: "#fff",
                  border: "1px solid rgba(217,131,36,0.30)",
                  borderRadius: 10,
                }}
              >
                <span style={{ flex: 1, minWidth: 180 }}>
                  <strong style={{ fontSize: 14.5 }}>{names[r.clientId] ?? r.clientId}</strong>
                  <span style={{ color: r.behind ? "#b3402a" : "var(--fm-text-secondary)", fontSize: 12.5 }}>
                    {" "}
                    · week {r.targetWeek} drafted{r.behind ? " (current week — overdue)" : ""}
                  </span>
                  {r.changeNote && (
                    <span
                      style={{
                        display: "block",
                        fontStyle: "italic",
                        color: "var(--fm-text-secondary)",
                        fontSize: 11.5,
                        marginTop: 2,
                      }}
                    >
                      “{r.changeNote}”
                    </span>
                  )}
                </span>
                <a
                  href={`/clients-v2/${r.clientId}/plan`}
                  style={{
                    padding: "9px 16px",
                    borderRadius: 999,
                    background: "#d98324",
                    color: "#fff",
                    fontSize: 13,
                    fontWeight: 700,
                    textDecoration: "none",
                    whiteSpace: "nowrap",
                  }}
                >
                  Review &amp; approve →
                </a>
              </div>
            ))}
          </div>
        </div>
      )}

      {upcoming.length > 0 && (
        <FmPanel
          title="🗓 Weekly menus coming up"
          subtitle="Next week starts soon — these auto-draft at 07:00, then appear above for approval."
        >
          <div style={{ display: "grid", gap: 6 }}>
            {upcoming.map((r) => (
              <div
                key={r.clientId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  flexWrap: "wrap",
                  padding: "7px 10px",
                  border: "1px solid rgba(120,113,108,0.18)",
                  borderRadius: "var(--fm-radius-md, 10px)",
                  fontSize: 12.5,
                }}
              >
                <span style={{ flex: 1, minWidth: 160 }}>
                  <strong>{names[r.clientId] ?? r.clientId}</strong>
                  <span style={{ color: r.behind ? "#b3402a" : "var(--fm-text-tertiary)" }}>
                    {" "}
                    {r.behind
                      ? `· behind — week ${r.targetWeek} (current) has no menu`
                      : `· week ${r.targetWeek} starts ${r.daysToNextWeek <= 0 ? "today" : `in ${r.daysToNextWeek}d`}`}
                  </span>
                </span>
                <span style={{ fontSize: 11.5, color: "var(--fm-text-tertiary)", fontStyle: "italic" }}>
                  drafts automatically (7am) →
                </span>
              </div>
            ))}
          </div>
        </FmPanel>
      )}
    </div>
  );
}
