"use client";

import { useEffect, useState, useTransition } from "react";
import {
  loadHandoutScheduleAction,
  previewHandoutDripAction,
  setupHandoutDripAction,
  type HandoutDripItem,
} from "@/lib/server-actions/handout-drip";

function fmtDate(d: string): string {
  try {
    return new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  } catch {
    return d;
  }
}

export function HandoutDripPanel({ clientId }: { clientId: string }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<HandoutDripItem[] | null>(null);
  const [active, setActive] = useState(false); // schedule persisted/enqueued
  const [msg, setMsg] = useState<string>("");
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open || items !== null) return;
    start(async () => {
      try {
        const loaded = await loadHandoutScheduleAction(clientId);
        if (loaded.ok && (loaded.schedule?.length ?? 0) > 0) {
          setItems(loaded.schedule!);
          setActive(true);
        } else {
          const prev = await previewHandoutDripAction(clientId);
          if (prev.ok) setItems(prev.schedule ?? []);
          else {
            setItems([]);
            setMsg(prev.error ?? "");
          }
        }
      } catch (e) {
        // Audit Phase-1b: a thrown action left the panel blank (no loading, no
        // content, no error). Show the failure instead.
        setItems([]);
        setMsg((e as Error).message);
      }
    });
  }, [open, items, clientId]);

  const setup = () => {
    start(async () => {
      const res = await setupHandoutDripAction(clientId);
      if (res.ok) {
        setItems(res.schedule ?? []);
        setActive(true);
        setMsg(`✓ Drip activated — ${res.enqueued ?? 0} guides queued. They send automatically once the WhatsApp template is approved.`);
      } else {
        setMsg(res.error ?? "Setup failed");
      }
    });
  };

  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50/40 mb-4">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between gap-2 px-4 py-2.5 text-left">
        <span className="text-sm font-semibold text-indigo-900">📬 Handout drip {active ? "· active" : ""}</span>
        <span className="text-xs text-indigo-700">{open ? "Hide ▲" : "Show ▼"}</span>
      </button>

      {open && (
        <div className="px-4 pb-3 text-sm">
          <p className="text-xs text-muted-foreground mb-2">
            Short branded guides, staggered to the client over the plan — priority-first, one at a time, so they&apos;re
            not overwhelmed. Anchored to the plan&apos;s Day 1.
          </p>

          {pending && items === null && <p className="text-xs italic text-muted-foreground">Loading…</p>}

          {items !== null && items.length === 0 && (
            <p className="text-xs text-amber-700">
              {msg || "No handouts attached to an active plan yet — generate & publish a plan first (handouts auto-attach)."}
            </p>
          )}

          {items !== null && items.length > 0 && (
            <>
              <div className="rounded-md bg-white border divide-y">
                {items.map((it) => (
                  <div key={it.slug} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <div className="font-medium text-slate-800 truncate">{it.title}</div>
                      <a href={`/handouts/${it.slug}.html`} target="_blank" rel="noreferrer" className="text-[11px] text-indigo-600 hover:underline">
                        preview ↗
                      </a>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xs text-slate-600">wk {it.week} · {fmtDate(it.send_on)}</div>
                      <div className="text-[11px]">
                        {it.sent_at ? <span className="text-emerald-700">✓ sent</span> : <span className="text-slate-400">scheduled</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {!active ? (
                <button
                  onClick={setup}
                  disabled={pending}
                  className="mt-3 px-3 py-1.5 rounded text-sm bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {pending ? "Setting up…" : "📬 Activate automatic drip"}
                </button>
              ) : (
                <p className="mt-2 text-[11px] text-emerald-700">✓ Drip active — guides send automatically on their dates.</p>
              )}
              {msg && <p className="mt-2 text-[11px] text-slate-600">{msg}</p>}
            </>
          )}

          <p className="text-[10px] text-muted-foreground mt-2">
            Sends fire via the WhatsApp <code>fm_handout_v1</code> template (pending Meta approval). Until approved, the
            schedule is set but messages wait in the queue.
          </p>
        </div>
      )}
    </div>
  );
}
