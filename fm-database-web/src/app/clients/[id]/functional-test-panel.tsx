"use client";

/**
 * FunctionalTestPanel — upload DUTCH / GI-MAP PDFs, parse via Sonnet
 * tool-use, and surface structured findings + flagged drivers as
 * actionable cards.
 *
 * Mounted on the Client Overview tab. Renders a compact upload trigger
 * always; lists prior parsed tests below when any exist.
 */

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  parseFunctionalTestAction,
  loadFunctionalTestsAction,
  assessReworkBenefitAction,
  type FunctionalTestSummary,
} from "@/app/clients/actions";
import { uploadFileAction } from "@/app/assess/actions";

interface Props {
  clientId: string;
}

const TEST_LABEL: Record<string, string> = {
  dutch: "DUTCH (urine hormones)",
  gi_map: "GI-MAP (stool PCR)",
  unknown: "Functional test",
};

const TEST_EMOJI: Record<string, string> = {
  dutch: "🧬",
  gi_map: "🦠",
  unknown: "🧪",
};

export function FunctionalTestPanel({ clientId }: Props) {
  const [tests, setTests] = useState<FunctionalTestSummary[]>([]);
  const [open, setOpen] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [expandedFile, setExpandedFile] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void loadFunctionalTestsAction(clientId).then((r) => {
      if (!alive) return;
      setTests(r.tests);
    });
    return () => { alive = false; };
  }, [clientId]);

  const refresh = async () => {
    const r = await loadFunctionalTestsAction(clientId);
    setTests(r.tests);
  };

  const handleFile = async (file: File) => {
    setIsParsing(true);
    setParseError(null);
    try {
      const fd = new FormData();
      fd.append("client_id", clientId);
      fd.append("file", file);
      const filePath = await uploadFileAction(fd);
      startTransition(async () => {
        const result = await parseFunctionalTestAction(clientId, filePath);
        if (!result.ok) {
          setParseError(result.error ?? "Parse failed");
          toast.error(`Parse failed: ${(result.error ?? "").slice(0, 80)}`);
        } else {
          if (result.test_type === "unknown") {
            setParseError("Could not identify test type. Currently supported: DUTCH, GI-MAP.");
            toast.error("Test type not recognised");
          } else {
            const label = TEST_LABEL[result.test_type ?? "unknown"];
            toast.success(`✅ ${label} parsed — ${result.flagged_drivers?.length ?? 0} drivers flagged`);
            await refresh();

            // Fire-and-forget AI rework assessment.
            const drivers = (result.flagged_drivers ?? []).slice(0, 8).join(", ");
            const summary = result.summary ? `${result.summary}` : `${label} parsed`;
            void assessReworkBenefitAction({
              clientId,
              triggeredBy: "functional_test",
              eventSummary: `${label} findings: ${summary}${drivers ? ` | Drivers: ${drivers}` : ""}`,
            });
          }
        }
        setIsParsing(false);
      });
    } catch (e) {
      setParseError(String(e));
      setIsParsing(false);
    }
  };

  const hasAny = tests.length > 0;

  return (
    <div className="rounded-xl border-2 border-indigo-200 bg-indigo-50/30 p-4 space-y-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 text-left"
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-base font-semibold text-indigo-900">
            🧪 Functional test results
          </span>
          {hasAny && (
            <span className="inline-flex items-center text-[11px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-900 border border-indigo-300">
              {tests.length} report{tests.length !== 1 ? "s" : ""}
            </span>
          )}
          {!hasAny && (
            <span className="text-[11px] text-indigo-700/80">Upload a DUTCH or GI-MAP PDF to extract structured findings</span>
          )}
        </div>
        <span className="text-xs text-indigo-800">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="space-y-3 pt-1">
          {/* Upload control */}
          <label className="block rounded-lg border-2 border-dashed border-indigo-300 bg-white p-3 cursor-pointer hover:bg-indigo-50/40 transition-colors">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="text-xs">
                <div className="font-semibold text-indigo-900">📎 Upload PDF</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  Auto-detects: DUTCH (Precision Analytical) · GI-MAP (Diagnostic Solutions). Sonnet parse, ~30-60s, ~$0.30-0.60 per test.
                </div>
              </div>
              {isParsing && (
                <span className="text-[11px] text-indigo-700 font-medium animate-pulse">
                  ⏳ Parsing…
                </span>
              )}
            </div>
            <input
              type="file"
              accept="application/pdf"
              disabled={isParsing}
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
                e.target.value = ""; // allow re-uploading same file
              }}
            />
          </label>

          {parseError && (
            <p className="text-xs rounded-md bg-red-50 border border-red-200 px-2 py-1.5 text-red-700">
              {parseError}
            </p>
          )}

          {/* Test list */}
          {tests.map((t) => {
            const emoji = TEST_EMOJI[t.test_type] ?? "🧪";
            const label = TEST_LABEL[t.test_type] ?? t.test_type;
            const isExp = expandedFile === t.file_path;
            const drivers = t.flagged_drivers ?? [];
            const recs = t.clinical_recommendations ?? [];
            return (
              <div key={t.file_path} className="rounded-lg border bg-background p-3 space-y-2">
                <button
                  type="button"
                  onClick={() => setExpandedFile(isExp ? null : t.file_path)}
                  className="w-full text-left flex items-start justify-between gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold">
                        {emoji} {label}
                      </span>
                      {t.test_date && (
                        <span className="text-[11px] tabular-nums text-muted-foreground">
                          {t.test_date}
                        </span>
                      )}
                      {drivers.length > 0 && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-rose-50 text-rose-800 border border-rose-200">
                          {drivers.length} driver{drivers.length !== 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                    {t.summary && !isExp && (
                      <p className="text-xs leading-relaxed text-muted-foreground mt-1 line-clamp-2">
                        {t.summary}
                      </p>
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground shrink-0 mt-0.5">
                    {isExp ? "▲" : "▼"}
                  </span>
                </button>

                {isExp && (
                  <div className="pt-2 border-t space-y-3 text-xs">
                    {t.summary && (
                      <p className="leading-relaxed text-foreground/85 whitespace-pre-wrap">
                        {t.summary}
                      </p>
                    )}
                    {drivers.length > 0 && (
                      <div className="space-y-1">
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
                          Flagged drivers (FM mechanisms)
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {drivers.map((d, i) => (
                            <a
                              key={i}
                              href={`/catalogue/mechanisms/${d}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full bg-rose-50 text-rose-800 border border-rose-200 hover:bg-rose-100"
                            >
                              {d}
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                    {recs.length > 0 && (
                      <div className="space-y-1">
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
                          Clinical recommendations
                        </div>
                        <ul className="list-disc list-inside space-y-0.5 leading-relaxed">
                          {recs.map((r, i) => <li key={i}>{r}</li>)}
                        </ul>
                      </div>
                    )}
                    {/* Raw findings disclosure (for the full structured payload) */}
                    {t.findings && (
                      <details>
                        <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground font-medium select-none">
                          🔬 Raw structured findings
                        </summary>
                        <pre className="mt-2 text-[10px] bg-muted/40 rounded p-2 overflow-x-auto leading-relaxed">
                          {JSON.stringify(t.findings, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
