"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import {
  clientQuickChatAction,
  type QuickChatTurn,
} from "@/lib/server-actions/client-quick-chat";

const SUGGESTIONS = [
  "She's on HBOT 15 days, feeling better but very sleepy — continue?",
  "She asked if she can take her iron and thyroid tablet together.",
  "Is it normal to feel tired after starting a new supplement?",
];

export function ClientQuickChatPanel({
  clientId,
  clientName,
}: {
  clientId: string;
  clientName: string;
}) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<QuickChatTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, start] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns.length, pending]);

  const ask = (q: string) => {
    const question = q.trim();
    if (!question || pending) return;
    setDraft("");
    const history = turns.slice();
    setTurns((t) => [...t, { role: "user", content: question }]);
    start(async () => {
      const res = await clientQuickChatAction(clientId, question, history);
      setTurns((t) => [
        ...t,
        {
          role: "assistant",
          content: res.ok
            ? res.answer ?? "(no answer)"
            : `⚠️ ${res.error ?? "Something went wrong."}`,
        },
      ]);
    });
  };

  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 mb-4">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-4 py-2.5 text-left"
      >
        <span className="text-sm font-semibold text-emerald-900">
          💬 Quick question about {clientName}
        </span>
        <span className="text-xs text-emerald-700">
          {open ? "Hide ▲" : "Ask ▼"}
        </span>
      </button>

      {open && (
        <div className="px-4 pb-3">
          <p className="text-xs text-muted-foreground mb-2">
            Ask anything a client raises on a call or message — answered from{" "}
            <strong>this client&apos;s record</strong> + the FM catalogue. No analysis to run.
          </p>

          <div
            ref={scrollRef}
            className="max-h-[22rem] overflow-y-auto space-y-3 rounded-md bg-white border p-3 text-sm"
          >
            {turns.length === 0 && (
              <div className="text-xs text-muted-foreground space-y-1.5">
                <p>Try:</p>
                <div className="flex flex-col gap-1">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => ask(s)}
                      className="text-left text-emerald-800 hover:underline"
                    >
                      • {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {turns.map((t, i) =>
              t.role === "user" ? (
                <div key={i} className="flex justify-end">
                  <div className="bg-emerald-100 text-emerald-900 px-3 py-1.5 rounded-lg max-w-[85%] whitespace-pre-wrap">
                    {t.content}
                  </div>
                </div>
              ) : (
                <div key={i} className="flex justify-start">
                  <div className="bg-slate-50 border text-slate-800 px-3 py-2 rounded-lg max-w-[92%] whitespace-pre-wrap leading-relaxed">
                    {t.content}
                  </div>
                </div>
              ),
            )}

            {pending && (
              <p className="text-xs text-muted-foreground italic">⏳ Thinking…</p>
            )}
          </div>

          <div className="flex gap-1.5 pt-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  ask(draft);
                }
              }}
              placeholder="Type a quick question…"
              disabled={pending}
              className="flex-1 px-3 py-1.5 rounded border text-sm"
            />
            <button
              onClick={() => ask(draft)}
              disabled={pending || !draft.trim()}
              className="px-3 py-1.5 rounded text-sm bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              Ask
            </button>
          </div>

          <p className="text-[10px] text-muted-foreground mt-1.5">
            Educational support within coaching scope — not a diagnosis or a substitute for the
            client&apos;s clinician. Verify anything clinical before acting.
          </p>
        </div>
      )}
    </div>
  );
}
