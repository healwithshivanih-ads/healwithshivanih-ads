"use client";

import { useState, useTransition } from "react";
import { getCatalogueStatus, commitCatalogueData } from "./catalogue-commit-action";
import type { CatalogueStatus } from "./catalogue-commit-action";

export function CatalogueCommitButton({
  initialStatus,
}: {
  initialStatus: CatalogueStatus;
}) {
  const [status, setStatus]     = useState(initialStatus);
  const [msg, setMsg]           = useState("");
  const [isError, setIsError]   = useState(false);
  const [commitNote, setNote]   = useState("");
  const [showNote, setShowNote] = useState(false);
  const [pending, start]        = useTransition();

  const total = status.modified + status.added;
  if (total === 0 && !msg) return null; // nothing pending — hide the widget entirely

  function refresh() {
    start(async () => {
      const s = await getCatalogueStatus();
      setStatus(s);
    });
  }

  function commit() {
    start(async () => {
      const res = await commitCatalogueData(commitNote || undefined);
      if (res.ok) {
        setMsg(res.message ?? "Committed ✓");
        setIsError(false);
        setNote("");
        setShowNote(false);
        // refresh count after commit
        const s = await getCatalogueStatus();
        setStatus(s);
      } else {
        setMsg(res.error ?? "Error");
        setIsError(true);
      }
    });
  }

  const breakdown = [
    status.topics      && `${status.topics} topics`,
    status.mechanisms  && `${status.mechanisms} mechanisms`,
    status.symptoms    && `${status.symptoms} symptoms`,
    status.supplements && `${status.supplements} supplements`,
    status.claims      && `${status.claims} claims`,
    status.sources     && `${status.sources} sources`,
    status.other       && `${status.other} other`,
  ].filter(Boolean).join(" · ");

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-amber-900 flex items-center gap-1.5">
            <span>📚</span>
            <span>{total} catalogue file{total !== 1 ? "s" : ""} uncommitted</span>
          </div>
          {breakdown && (
            <div className="text-[11px] text-amber-700 mt-0.5">{breakdown}</div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setShowNote((v) => !v)}
            disabled={pending || total === 0}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-amber-300 bg-white text-amber-800 hover:bg-amber-100 disabled:opacity-40 transition-colors"
          >
            {showNote ? "Hide note" : "Add note"}
          </button>
          <button
            onClick={commit}
            disabled={pending || total === 0}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-700 text-white hover:bg-amber-800 disabled:opacity-40 transition-colors"
          >
            {pending ? "Committing…" : "💾 Commit to git"}
          </button>
          <button
            onClick={refresh}
            disabled={pending}
            title="Refresh count"
            className="text-xs px-2 py-1.5 rounded-lg border border-amber-300 bg-white text-amber-700 hover:bg-amber-100 disabled:opacity-40 transition-colors"
          >
            ↻
          </button>
        </div>
      </div>

      {showNote && (
        <input
          type="text"
          value={commitNote}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional commit message (e.g. 'coconote: inflammation + gut batches')"
          className="text-sm border border-amber-300 rounded-lg px-3 py-1.5 bg-white w-full focus:outline-none focus:ring-1 focus:ring-amber-400"
          onKeyDown={(e) => { if (e.key === "Enter") commit(); }}
        />
      )}

      {msg && (
        <div className={`text-xs px-2 py-1 rounded ${isError ? "text-red-700 bg-red-50" : "text-emerald-700 bg-emerald-50"}`}>
          {isError ? "⚠ " : "✓ "}{msg}
        </div>
      )}
    </div>
  );
}
