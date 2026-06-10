"use client";

import { useEffect, useState, useTransition } from "react";
import {
  loadHandoutScheduleAction,
  previewHandoutDripAction,
  setupHandoutDripAction,
  listHandoutsForClientAction,
  updateHandoutAttachmentsAction,
  type HandoutDripItem,
  type HandoutItem,
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
  const [view, setView] = useState<"schedule" | "configure">("schedule");

  // Schedule state
  const [items, setItems] = useState<HandoutDripItem[] | null>(null);
  const [active, setActive] = useState(false);
  const [scheduleMsg, setScheduleMsg] = useState<string>("");

  // Configure state
  const [allHandouts, setAllHandouts] = useState<HandoutItem[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [configMsg, setConfigMsg] = useState<string>("");

  const [pending, start] = useTransition();

  // Load schedule when panel first opens
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
            setScheduleMsg(prev.error ?? "");
          }
        }
      } catch (e) {
        setItems([]);
        setScheduleMsg((e as Error).message);
      }
    });
  }, [open, items, clientId]);

  // Load configure list when switching to configure view
  useEffect(() => {
    if (view !== "configure" || allHandouts !== null) return;
    start(async () => {
      const res = await listHandoutsForClientAction(clientId);
      if (res.ok && res.handouts) {
        setAllHandouts(res.handouts);
        // Pre-select: explicitly attached, else auto-matched
        const preselect = new Set(
          res.handouts
            .filter((h) => h.attached || (!res.handouts!.some((x) => x.attached) && h.matched))
            .map((h) => h.slug)
        );
        setSelected(preselect);
      } else {
        setAllHandouts([]);
        setConfigMsg(res.error ?? "Could not load handouts");
      }
    });
  }, [view, allHandouts, clientId]);

  const toggleSelect = (slug: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  const saveAttachments = () => {
    start(async () => {
      const res = await updateHandoutAttachmentsAction(clientId, Array.from(selected));
      if (res.ok) {
        setConfigMsg("✓ Saved. Switching to schedule preview…");
        // Reset schedule so it reloads with new attachments
        setItems(null);
        setActive(false);
        setScheduleMsg("");
        setTimeout(() => {
          setView("schedule");
          setConfigMsg("");
        }, 800);
      } else {
        setConfigMsg(res.error ?? "Save failed");
      }
    });
  };

  const setup = () => {
    start(async () => {
      const res = await setupHandoutDripAction(clientId);
      if (res.ok) {
        setItems(res.schedule ?? []);
        setActive(true);
        setScheduleMsg(`✓ Drip activated — ${res.enqueued ?? 0} guide(s) queued. They'll send automatically on schedule via WhatsApp.`);
      } else {
        setScheduleMsg(res.error ?? "Setup failed");
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

          {/* Tab bar */}
          <div className="flex gap-1 mb-3 border-b border-indigo-100">
            <button
              onClick={() => setView("schedule")}
              className={`px-3 py-1 text-xs rounded-t ${view === "schedule" ? "bg-white border border-b-white border-indigo-200 font-medium text-indigo-900" : "text-muted-foreground hover:text-slate-700"}`}
            >
              Schedule
            </button>
            <button
              onClick={() => setView("configure")}
              className={`px-3 py-1 text-xs rounded-t ${view === "configure" ? "bg-white border border-b-white border-indigo-200 font-medium text-indigo-900" : "text-muted-foreground hover:text-slate-700"}`}
            >
              Configure guides
            </button>
          </div>

          {/* Schedule view */}
          {view === "schedule" && (
            <>
              {pending && items === null && <p className="text-xs italic text-muted-foreground">Loading…</p>}

              {items !== null && items.length === 0 && (
                <p className="text-xs text-amber-700">
                  {scheduleMsg || 'No handouts matched to this plan. Use "Configure guides" to select them manually.'}
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
                    <div className="mt-3 flex items-center gap-3">
                      <button
                        onClick={setup}
                        disabled={pending}
                        className="px-3 py-1.5 rounded text-sm bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                      >
                        {pending ? "Setting up…" : "📬 Activate automatic drip"}
                      </button>
                      <button
                        onClick={() => setView("configure")}
                        className="text-xs text-indigo-600 hover:underline"
                      >
                        Change selection
                      </button>
                    </div>
                  ) : (
                    <div className="mt-2 flex items-center gap-3">
                      <p className="text-[11px] text-emerald-700">✓ Drip active — guides send automatically on their dates.</p>
                      <button onClick={() => setView("configure")} className="text-[11px] text-indigo-600 hover:underline">
                        Edit guides
                      </button>
                    </div>
                  )}
                  {scheduleMsg && <p className="mt-2 text-[11px] text-slate-600">{scheduleMsg}</p>}
                </>
              )}
            </>
          )}

          {/* Configure view */}
          {view === "configure" && (
            <>
              {pending && allHandouts === null && <p className="text-xs italic text-muted-foreground">Loading handouts…</p>}

              {allHandouts !== null && allHandouts.length === 0 && (
                <p className="text-xs text-amber-700">{configMsg || "No handout guides found in the resources library."}</p>
              )}

              {allHandouts !== null && allHandouts.length > 0 && (
                <>
                  <p className="text-xs text-muted-foreground mb-2">
                    Select the guides to include in this client&apos;s drip.
                    <span className="ml-1 text-indigo-600">● auto-matched</span> guides are pre-ticked based on the plan&apos;s topics.
                  </p>
                  <div className="rounded-md bg-white border divide-y mb-3">
                    {allHandouts.map((h) => (
                      <label key={h.slug} className="flex items-start gap-3 px-3 py-2 cursor-pointer hover:bg-slate-50">
                        <input
                          type="checkbox"
                          checked={selected.has(h.slug)}
                          onChange={() => toggleSelect(h.slug)}
                          className="mt-0.5 accent-indigo-600"
                        />
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-slate-800">{h.title}</div>
                          <div className="text-[11px] text-muted-foreground flex gap-2">
                            <span className="font-mono">{h.slug}</span>
                            {h.matched && <span className="text-indigo-600">● matched</span>}
                            {h.attached && <span className="text-emerald-700">✓ attached</span>}
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={saveAttachments}
                      disabled={pending || selected.size === 0}
                      className="px-3 py-1.5 rounded text-sm bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {pending ? "Saving…" : `Save ${selected.size} guide${selected.size !== 1 ? "s" : ""}`}
                    </button>
                    <button onClick={() => setView("schedule")} className="text-xs text-muted-foreground hover:text-slate-700">
                      Cancel
                    </button>
                  </div>
                  {configMsg && <p className="mt-2 text-[11px] text-slate-600">{configMsg}</p>}
                </>
              )}
            </>
          )}

          <p className="text-[10px] text-muted-foreground mt-2">
            Sends fire automatically via the Meta-approved WhatsApp <code>fm_handout_v1</code> template, each on its
            scheduled date.
          </p>
        </div>
      )}
    </div>
  );
}
