"use client";

/**
 * WeeklyMenuQueuePanel — the weekly-cadence review queue (2026-06-12).
 *
 * Three buckets:
 *   · PENDING & not on travel → loud amber banner at the TOP of the dashboard,
 *     with per-client "Review & approve" + a one-click "Approve all" (clients
 *     stay frozen on their last week until approved — must be impossible to
 *     miss; coach asked for this 2026-06-30).
 *   · PENDING but on travel → a draft was generated before a travel/maintenance
 *     window was set (or overlaps one). Shown muted with "Dismiss" — we don't
 *     push a holiday-week menu.
 *   · UPCOMING (no draft yet, auto-drafts at 07:00) → quiet sub-list.
 * Self-hides only when there is genuinely nothing in any bucket.
 */

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FmPanel } from "@/components/fm";
import {
  weeklyMenuQueueAction,
  approveAllPendingMenusAction,
  dismissPendingMenuAction,
} from "@/lib/server-actions/weekly-menu";

type Row = Awaited<ReturnType<typeof weeklyMenuQueueAction>>[number];

export function WeeklyMenuQueuePanel({ names }: { names: Record<string, string> }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [armed, setArmed] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const refresh = () =>
    weeklyMenuQueueAction(7)
      .then(setRows)
      .catch(() => setRows([]));

  useEffect(() => {
    void refresh();
  }, []);

  if (!rows || rows.length === 0) return null;

  const approveRows = rows.filter((r) => r.pending && !r.onTravel);
  const travelRows = rows.filter((r) => r.pending && r.onTravel);
  const upcoming = rows.filter((r) => !r.pending && !r.onTravel);
  if (approveRows.length === 0 && travelRows.length === 0 && upcoming.length === 0) return null;

  const approveAll = () => {
    setArmed(false);
    startTransition(async () => {
      const res = await approveAllPendingMenusAction();
      setMsg(
        res.ok
          ? `Approved ${res.approved}${res.failed.length ? ` · ${res.failed.length} failed` : ""}.`
          : "Approve-all failed.",
      );
      await refresh();
      router.refresh();
    });
  };

  const dismiss = (clientId: string) =>
    startTransition(async () => {
      await dismissPendingMenuAction(clientId);
      await refresh();
      router.refresh();
    });

  return (
    <div style={{ display: "grid", gap: 14, marginBottom: 24 }}>
      {approveRows.length > 0 && (
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
              flexWrap: "wrap",
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
              {approveRows.length}
            </span>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontWeight: 800, fontSize: 16, lineHeight: 1.2 }}>
                Weekly {approveRows.length === 1 ? "menu" : "menus"} waiting for your approval
              </div>
              <div style={{ fontSize: 12.5, opacity: 0.92 }}>
                These clients stay on their current week until you approve. Review on the live phone, then Approve.
              </div>
            </div>
            {armed ? (
              <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                <button
                  onClick={approveAll}
                  disabled={pending}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 999,
                    border: "none",
                    background: "#fff",
                    color: "#9a4f10",
                    fontSize: 12.5,
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  {pending ? "Approving…" : `Yes, approve ${approveRows.length} & push`}
                </button>
                <button
                  onClick={() => setArmed(false)}
                  disabled={pending}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 999,
                    border: "1px solid rgba(255,255,255,0.6)",
                    background: "transparent",
                    color: "#fff",
                    fontSize: 12.5,
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                onClick={() => setArmed(true)}
                disabled={pending}
                style={{
                  padding: "9px 16px",
                  borderRadius: 999,
                  border: "1px solid rgba(255,255,255,0.7)",
                  background: "rgba(255,255,255,0.16)",
                  color: "#fff",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                Approve all →
              </button>
            )}
          </div>

          {msg && (
            <div style={{ padding: "8px 18px", fontSize: 12.5, color: "#9a4f10", background: "#fdeed6" }}>{msg}</div>
          )}

          <div style={{ display: "grid", gap: 8, padding: 14 }}>
            {approveRows.map((r) => (
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

      {travelRows.length > 0 && (
        <FmPanel
          title="🏖 On travel — menu paused"
          subtitle="A draft overlaps a travel/maintenance window. Dismiss it — the client isn't on the normal plan this week."
        >
          <div style={{ display: "grid", gap: 6 }}>
            {travelRows.map((r) => (
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
                  <span style={{ color: "var(--fm-text-tertiary)" }}>
                    {" "}
                    · week {r.targetWeek} · {r.travelNote ?? "travel"}
                  </span>
                </span>
                <button
                  onClick={() => dismiss(r.clientId)}
                  disabled={pending}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 999,
                    border: "1px solid rgba(120,113,108,0.3)",
                    background: "transparent",
                    color: "var(--fm-text-secondary)",
                    fontSize: 11.5,
                    cursor: "pointer",
                  }}
                >
                  Dismiss draft
                </button>
              </div>
            ))}
          </div>
        </FmPanel>
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
