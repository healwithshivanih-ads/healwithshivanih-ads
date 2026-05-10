"use client";

import { useEffect, useState, useTransition } from "react";
import {
  computeCoachingQueueAction,
  sendCoachingNudgeAction,
  skipCoachingNudgeAction,
  type QueueItem,
} from "@/app/coaching/actions";

interface Props {
  initialQueue: QueueItem[];
  aisensyConfigured: boolean;
}

interface RowState {
  body: string;
  sending: boolean;
  status: "idle" | "sent" | "skipped" | "error";
  error?: string;
}

function key(item: QueueItem): string {
  return `${item.client_id}::${item.sequence_slug}::${item.week}`;
}

export function CoachingNudgesPanel({ initialQueue, aisensyConfigured }: Props) {
  const [queue, setQueue] = useState<QueueItem[]>(initialQueue);
  const [open, setOpen] = useState(initialQueue.length > 0);
  const [rowState, setRowState] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(initialQueue.map((q) => [key(q), { body: q.rendered_body, sending: false, status: "idle" } as RowState]))
  );
  const [refreshing, startRefresh] = useTransition();

  useEffect(() => {
    setQueue(initialQueue);
    setRowState((prev) => {
      const next: Record<string, RowState> = {};
      for (const q of initialQueue) {
        const k = key(q);
        next[k] = prev[k] ?? { body: q.rendered_body, sending: false, status: "idle" };
      }
      return next;
    });
  }, [initialQueue]);

  const refresh = () => {
    startRefresh(async () => {
      const fresh = await computeCoachingQueueAction(7);
      setQueue(fresh);
    });
  };

  const updateBody = (k: string, body: string) =>
    setRowState((prev) => ({ ...prev, [k]: { ...prev[k], body } }));

  const handleSend = async (item: QueueItem) => {
    const k = key(item);
    setRowState((p) => ({ ...p, [k]: { ...p[k], sending: true, status: "idle", error: undefined } }));
    const res = await sendCoachingNudgeAction({
      client_id: item.client_id,
      sequence_slug: item.sequence_slug,
      week: item.week,
      rendered_body: rowState[k]?.body ?? item.rendered_body,
      campaign_name: item.campaign_name,
      mobile_number: item.mobile_number,
    });
    setRowState((p) => ({
      ...p,
      [k]: { ...p[k], sending: false, status: res.ok ? "sent" : "error", error: res.error },
    }));
  };

  const handleSkip = async (item: QueueItem) => {
    const k = key(item);
    setRowState((p) => ({ ...p, [k]: { ...p[k], sending: true } }));
    await skipCoachingNudgeAction({
      client_id: item.client_id, sequence_slug: item.sequence_slug, week: item.week, reason: "manual skip",
    });
    setRowState((p) => ({ ...p, [k]: { ...p[k], sending: false, status: "skipped" } }));
  };

  const pendingCount = queue.filter((q) => {
    const s = rowState[key(q)]?.status ?? "idle";
    return s === "idle";
  }).length;

  const todayStr = new Date().toISOString().slice(0, 10);

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/40">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 text-sm font-semibold text-left hover:bg-emerald-50 rounded-xl transition-colors"
      >
        <span>🌱</span>
        <span>Coaching nudges</span>
        {queue.length > 0 && (
          <span className="ml-2 inline-flex items-center justify-center min-w-[1.5rem] h-5 px-1.5 rounded-full bg-emerald-600 text-white text-[10px] font-bold">
            {pendingCount}
          </span>
        )}
        <span className="text-xs text-muted-foreground ml-2">
          {queue.length === 0 ? "no nudges due in next 7 days" : `${queue.length} due in next 7 days`}
        </span>
        <span className="ml-auto text-muted-foreground text-xs">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          {!aisensyConfigured && (
            <p className="text-xs text-amber-800 bg-amber-100 border border-amber-200 rounded-md px-3 py-2">
              ⚠ AISENSY_API_KEY not set — sends will fail. Add to <code>.env.local</code>.
            </p>
          )}

          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Review each draft, edit if needed, then send. Skip to log it as intentionally suppressed.
            </p>
            <button
              onClick={refresh}
              disabled={refreshing}
              className="text-xs text-emerald-700 hover:underline disabled:opacity-40"
            >
              {refreshing ? "Refreshing…" : "🔄 Refresh"}
            </button>
          </div>

          {queue.length === 0 && (
            <p className="text-xs text-muted-foreground italic px-1 py-3">
              No nudges scheduled. Set a coaching cadence on each client&apos;s Overview tab to enable.
            </p>
          )}

          <div className="space-y-2">
            {queue.map((item) => {
              const k = key(item);
              const s = rowState[k] ?? { body: item.rendered_body, sending: false, status: "idle" as const };
              const isOverdue = item.due_date < todayStr;
              const dueLabel =
                item.due_date === todayStr ? "today"
                : isOverdue ? `${Math.abs(Math.round((new Date(todayStr).getTime() - new Date(item.due_date).getTime()) / 86400000))}d overdue`
                : `in ${Math.round((new Date(item.due_date).getTime() - new Date(todayStr).getTime()) / 86400000)}d`;

              return (
                <div
                  key={k}
                  className={`rounded-lg border bg-white p-3 space-y-2 ${isOverdue ? "border-amber-300" : "border-border"}`}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm">{item.client_name}</span>
                    <span className="text-[10px] text-muted-foreground">·</span>
                    <span className="text-xs text-muted-foreground">{item.message_title}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${isOverdue ? "bg-amber-100 text-amber-800" : "bg-muted text-muted-foreground"}`}>
                      {dueLabel}
                    </span>
                    {item.already_sent && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">
                        already sent
                      </span>
                    )}
                    {!item.mobile_number && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">
                        no phone
                      </span>
                    )}
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {item.sequence_name} · week {item.week}
                    </span>
                  </div>

                  <textarea
                    value={s.body}
                    onChange={(e) => updateBody(k, e.target.value)}
                    rows={3}
                    className="w-full rounded-md border border-input bg-white px-3 py-2 text-xs font-mono leading-relaxed focus:outline-none focus:ring-1 focus:ring-emerald-400 resize-y"
                    disabled={s.sending || s.status === "sent" || s.status === "skipped"}
                  />

                  {s.status === "sent" && (
                    <p className="text-xs text-emerald-700">✓ Sent via {item.campaign_name}</p>
                  )}
                  {s.status === "skipped" && (
                    <p className="text-xs text-muted-foreground">⊘ Skipped — logged for this week.</p>
                  )}
                  {s.status === "error" && (
                    <p className="text-xs text-red-600">⚠ {s.error}</p>
                  )}

                  {s.status === "idle" && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleSend(item)}
                        disabled={s.sending || !item.mobile_number || !aisensyConfigured}
                        className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40"
                      >
                        {s.sending ? "Sending…" : "📤 Send"}
                      </button>
                      <button
                        onClick={() => handleSkip(item)}
                        disabled={s.sending}
                        className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground border border-border hover:bg-muted/40"
                      >
                        Skip
                      </button>
                      <span className="ml-auto text-[10px] text-muted-foreground self-center">
                        Template: <code className="font-mono">{item.campaign_name}</code>
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
