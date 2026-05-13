"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  catalogueChatAction,
  applyCatalogueProposalAction,
  type CatalogueChatProposal,
} from "./chat-actions";
import { kindEmoji, kindLabel } from "@/lib/fmdb/kinds";

type ChatTurn =
  | { role: "user"; content: string }
  | { role: "assistant"; proposal: CatalogueChatProposal; applied?: boolean };

const ACTION_LABEL: Record<CatalogueChatProposal["action"], string> = {
  move: "Move",
  merge: "Merge",
  delete: "Delete",
  noop: "No-op",
};

const ACTION_COLOR: Record<CatalogueChatProposal["action"], string> = {
  move: "bg-violet-100 text-violet-800 border-violet-300",
  merge: "bg-blue-100 text-blue-800 border-blue-300",
  delete: "bg-red-100 text-red-800 border-red-300",
  noop: "bg-slate-100 text-slate-800 border-slate-300",
};

export function CatalogueChatPanel() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, start] = useTransition();
  const [applyingIdx, setApplyingIdx] = useState<number | null>(null);

  const send = () => {
    const message = draft.trim();
    if (!message) return;
    setDraft("");
    setTurns((t) => [...t, { role: "user", content: message }]);
    start(async () => {
      const res = await catalogueChatAction({ userMessage: message });
      if (res.ok && res.proposal) {
        setTurns((t) => [...t, { role: "assistant", proposal: res.proposal! }]);
      } else {
        toast.error(res.error ?? "Catalogue chat failed");
        setTurns((t) => [
          ...t,
          {
            role: "assistant",
            proposal: {
              action: "noop",
              source_kind: null,
              source_slug: null,
              target_kind: null,
              merge_into_kind: null,
              merge_into_slug: null,
              reasoning: `Error: ${res.error ?? "unknown"}`,
              needs_clarification: true,
              clarification: "Please rephrase your request.",
            },
          },
        ]);
      }
    });
  };

  const apply = async (idx: number, createStub: boolean = false) => {
    const turn = turns[idx];
    if (!turn || turn.role !== "assistant") return;
    setApplyingIdx(idx);
    try {
      const res = await applyCatalogueProposalAction(turn.proposal, createStub);
      if (res.ok) {
        toast.success("✅ Applied");
        setTurns((t) =>
          t.map((tt, i) => (i === idx && tt.role === "assistant" ? { ...tt, applied: true } : tt)),
        );
        router.refresh();
      } else if (res.needs_stub && res.target_kind && res.target_slug) {
        const proceed = window.confirm(
          `No ${res.target_kind}/${res.target_slug} exists yet.\n\n` +
            `Create a minimal stub seeded from this entity's name + summary and move?`,
        );
        if (proceed) {
          await apply(idx, true);
        }
      } else {
        toast.error(res.error ?? "Apply failed");
      }
    } finally {
      setApplyingIdx(null);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 text-sm font-medium shadow-lg z-40"
      >
        💬 Catalogue chat
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 w-96 max-w-[95vw] h-[32rem] max-h-[80vh] bg-white border-2 border-emerald-200 rounded-lg shadow-2xl flex flex-col z-40">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b bg-emerald-50 rounded-t-md">
        <h3 className="text-sm font-semibold text-emerald-900">💬 Catalogue chat</h3>
        <button
          onClick={() => setOpen(false)}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3 text-xs">
        {turns.length === 0 && (
          <div className="text-muted-foreground italic space-y-1.5">
            <p>Ask in plain English to fix catalogue miscategorisations or duplicates. Example:</p>
            <ul className="list-disc pl-4">
              <li>&quot;Anti-gravity exercise isn&apos;t a condition; make it a healing program.&quot;</li>
              <li>&quot;Merge bloating-and-gas into bloating.&quot;</li>
              <li>&quot;Delete the duplicate antigravity topic.&quot;</li>
            </ul>
            <p>Haiku interprets your message and proposes a structured action. You confirm before anything changes on disk.</p>
          </div>
        )}

        {turns.map((t, i) =>
          t.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="bg-emerald-100 text-emerald-900 px-3 py-1.5 rounded-lg max-w-[85%]">
                {t.content}
              </div>
            </div>
          ) : (
            <div key={i} className="space-y-1.5">
              <div className={`rounded-lg border px-3 py-2 ${ACTION_COLOR[t.proposal.action]}`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] uppercase font-semibold tracking-wide">
                    {ACTION_LABEL[t.proposal.action]}
                  </span>
                  {t.proposal.source_kind && t.proposal.source_slug && (
                    <span className="text-[11px] font-mono">
                      {kindEmoji(t.proposal.source_kind)} {t.proposal.source_kind}/{t.proposal.source_slug}
                    </span>
                  )}
                  {t.proposal.action === "move" && t.proposal.target_kind && (
                    <span className="text-[11px]">
                      → {kindEmoji(t.proposal.target_kind)} {kindLabel(t.proposal.target_kind, "singular")}
                    </span>
                  )}
                  {t.proposal.action === "merge" && t.proposal.merge_into_kind && t.proposal.merge_into_slug && (
                    <span className="text-[11px] font-mono">
                      → {kindEmoji(t.proposal.merge_into_kind)} {t.proposal.merge_into_kind}/{t.proposal.merge_into_slug}
                    </span>
                  )}
                </div>
                <p className="text-[11px] italic">{t.proposal.reasoning}</p>
                {t.proposal.needs_clarification && t.proposal.clarification && (
                  <p className="mt-1.5 text-[11px] font-medium">❓ {t.proposal.clarification}</p>
                )}
                {!t.proposal.needs_clarification && t.proposal.action !== "noop" && !t.applied && (
                  <div className="flex gap-1.5 pt-2">
                    <button
                      onClick={() => apply(i)}
                      disabled={applyingIdx === i || pending}
                      className="px-2 py-1 rounded text-[11px] bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {applyingIdx === i ? "⏳ Applying…" : "✓ Apply"}
                    </button>
                    <button
                      onClick={() =>
                        setTurns((tt) =>
                          tt.map((x, idx) => (idx === i && x.role === "assistant" ? { ...x, applied: true } : x)),
                        )
                      }
                      className="px-2 py-1 rounded text-[11px] border bg-white hover:bg-muted"
                    >
                      Reject
                    </button>
                  </div>
                )}
                {t.applied && (
                  <p className="mt-1.5 text-[10px] text-emerald-700">✓ Done</p>
                )}
              </div>
            </div>
          ),
        )}

        {pending && (
          <p className="text-[11px] text-muted-foreground italic">⏳ Haiku interpreting…</p>
        )}
      </div>

      <div className="border-t px-2 py-2 flex gap-1.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="e.g. 'antigravity should be a healing program'"
          disabled={pending}
          className="flex-1 px-2 py-1 rounded border text-xs"
        />
        <button
          onClick={send}
          disabled={pending || !draft.trim()}
          className="px-3 py-1 rounded text-xs bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  );
}
