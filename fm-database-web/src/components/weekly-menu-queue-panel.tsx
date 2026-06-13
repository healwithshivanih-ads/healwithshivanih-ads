"use client";

/**
 * WeeklyMenuQueuePanel — the weekly-cadence review queue (2026-06-12).
 *
 * One row per client whose next week starts within 3 days:
 *   · no draft yet  → "✨ Draft now" (the 07:00 cron also does this)
 *   · draft pending → "Review in studio →" (Plan tab, phone preview)
 * Self-hides when the queue is empty. Approval always happens in the
 * studio where the coach can SEE the menu on the live phone.
 */

import { useEffect, useState } from "react";
import { FmPanel } from "@/components/fm";
import { weeklyMenuQueueAction } from "@/lib/server-actions/weekly-menu";

type Row = Awaited<ReturnType<typeof weeklyMenuQueueAction>>[number];

export function WeeklyMenuQueuePanel({ names }: { names: Record<string, string> }) {
  const [rows, setRows] = useState<Row[] | null>(null);

  const refresh = () =>
    weeklyMenuQueueAction(3)
      .then(setRows)
      .catch(() => setRows([]));

  useEffect(() => {
    void refresh();
  }, []);

  if (!rows || rows.length === 0) return null;

  return (
    <FmPanel
      title="🗓 Weekly menus due"
      subtitle="Next week starts soon for these clients — draft, review on the live phone, approve."
    >
      <div style={{ display: "grid", gap: 8 }}>
        {rows.map((r) => (
          <div
            key={r.clientId}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
              padding: "8px 10px",
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
              {r.pending && r.changeNote && (
                <span style={{ display: "block", fontStyle: "italic", color: "var(--fm-text-secondary)", fontSize: 11.5 }}>
                  “{r.changeNote}”
                </span>
              )}
            </span>
            {r.pending ? (
              <a
                href={`/clients-v2/${r.clientId}/plan`}
                style={{
                  padding: "6px 12px",
                  borderRadius: 999,
                  background: "var(--fm-primary, #4a6152)",
                  color: "#fff",
                  fontSize: 11.5,
                  fontWeight: 600,
                  textDecoration: "none",
                }}
              >
                Review in studio →
              </a>
            ) : (
              <span style={{ fontSize: 11.5, color: "var(--fm-text-tertiary)", fontStyle: "italic" }}>
                drafts automatically (7am) →
              </span>
            )}
          </div>
        ))}
      </div>
    </FmPanel>
  );
}
