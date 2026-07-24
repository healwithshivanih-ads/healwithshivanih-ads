"use client";

/**
 * PendingExtractionsBanner — the "approve it" surface for a lab extraction
 * that was paid for but never imported.
 *
 * WHY THIS EXISTS: extract-symptoms.py writes a `<report>.extracted.json`
 * sidecar the instant an extraction is billed, so closing the tab no longer
 * loses the labs, and assess.py's Guard D refuses to run an assessment while
 * one is still unapplied. That combination without an approve button is a
 * trap — the coach hits a blocked assessment whose only escapes are
 * re-extracting (paying twice, the exact thing the sidecar prevents) or
 * force-bypassing (throwing the labs away). This banner is that button.
 *
 * Self-hiding: renders nothing when there is nothing pending, so it never
 * adds noise to a client whose labs are all imported.
 */

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  listPendingExtractionsAction,
  applyPendingExtractionAction,
  discardPendingExtractionAction,
  type PendingExtraction,
} from "@/lib/server-actions/assess";

export function PendingExtractionsBanner({ clientId }: { clientId: string }) {
  const [rows, setRows] = useState<PendingExtraction[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, startBusy] = useTransition();

  const refresh = async () => setRows(await listPendingExtractionsAction(clientId));
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  if (!rows || rows.length === 0) return null;

  const apply = (r: PendingExtraction) =>
    startBusy(async () => {
      const res = await applyPendingExtractionAction(clientId, r.file);
      if (res.ok) {
        toast.success(`Imported ${res.applied ?? 0} lab values from ${r.sourceFile}.`);
        await refresh();
      } else {
        toast.error(res.error ?? "Import failed.");
      }
    });

  const discard = (r: PendingExtraction) =>
    startBusy(async () => {
      const res = await discardPendingExtractionAction(clientId, r.file);
      if (res.ok) {
        toast.success("Marked as not a lab report.");
        await refresh();
      } else {
        toast.error(res.error ?? "Discard failed.");
      }
    });

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50/70 p-3 text-sm">
      <div className="font-medium text-amber-900">
        🧪 {rows.length} lab report{rows.length > 1 ? "s" : ""} read but not yet imported
      </div>
      <p className="mt-1 text-xs text-amber-800">
        These were already read and paid for — importing them costs nothing. Assessments stay
        blocked until you decide, so they can&apos;t quietly run without these results.
      </p>

      <div className="mt-3 grid gap-2">
        {rows.map((r) => (
          <div key={r.file} className="rounded-md border border-amber-200 bg-white/70 p-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-40 flex-1">
                <strong className="text-xs">{r.sourceFile}</strong>
                <span className="text-xs text-neutral-500">
                  {" "}
                  · {r.labCount} value{r.labCount > 1 ? "s" : ""}
                  {r.extractedAt ? ` · read ${r.extractedAt.slice(0, 10)}` : ""}
                </span>
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => setOpen(open === r.file ? null : r.file)}
                className="rounded-full border border-neutral-300 px-3 py-1 text-xs disabled:opacity-50"
              >
                {open === r.file ? "Hide" : "Review"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => apply(r)}
                className="rounded-full bg-emerald-700 px-3 py-1 text-xs text-white disabled:opacity-50"
              >
                Import {r.labCount}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => discard(r)}
                className="rounded-full border border-neutral-300 px-3 py-1 text-xs text-neutral-600 disabled:opacity-50"
              >
                Not a lab report
              </button>
            </div>

            {/* Review before importing — these values enter the clinical record,
                so the coach sees exactly what lands rather than trusting a count. */}
            {open === r.file && (
              <div className="mt-2 max-h-60 overflow-auto rounded border border-neutral-200">
                <table className="w-full border-collapse text-xs">
                  <tbody>
                    {r.labs.map((lv, i) => (
                      <tr key={i} className="border-b border-neutral-100 last:border-0">
                        <td className="px-2 py-1">{lv.test_name}</td>
                        <td className="px-2 py-1 text-right font-mono">{lv.value}</td>
                        <td className="px-2 py-1 text-neutral-500">{lv.unit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
