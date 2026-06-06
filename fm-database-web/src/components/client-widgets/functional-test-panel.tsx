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
} from "@/lib/server-actions/clients";
import { checkDuplicateUploadAction } from "@/lib/server-actions/assess";
import { uploadClientFile } from "@/lib/fmdb/upload-client-file";

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
  // Last uploaded file path — kept so the coach can override the test type
  // when auto-detection fails (some lab PDFs lose the brand header on
  // extraction; the rest of the report is still parseable).
  const [lastFilePath, setLastFilePath] = useState<string | null>(null);
  const [forcedType, setForcedType] = useState<"dutch" | "gi_map" | null>(null);

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

  const runParse = (filePath: string, testType?: "dutch" | "gi_map") => {
    setIsParsing(true);
    setParseError(null);
    startTransition(async () => {
      const result = await parseFunctionalTestAction(
        clientId,
        filePath,
        testType ? { testType } : undefined,
      );
      if (!result.ok) {
        setParseError(result.error ?? "Parse failed");
        toast.error(`Parse failed: ${(result.error ?? "").slice(0, 80)}`);
      } else if (result.test_type === "unknown") {
        setParseError(
          "Could not identify test type. Pick the test below and we'll re-parse the same file.",
        );
        toast.error("Test type not recognised — pick manually below");
      } else {
        const label = TEST_LABEL[result.test_type ?? "unknown"];
        if (result.duplicate) {
          toast.info(
            `📎 ${label} — this file was already parsed for this client. Showing existing record (no re-parse).`,
            { duration: 6000 },
          );
        } else {
          toast.success(`✅ ${label} parsed — ${result.flagged_drivers?.length ?? 0} drivers flagged`);
        }
        setLastFilePath(null);
        setForcedType(null);
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
      setIsParsing(false);
    });
  };

  const handleFile = async (file: File) => {
    setIsParsing(true);
    setParseError(null);
    try {
      // Pre-upload SHA-256 dedup. If the same PDF (any filename) is already
      // on file for this client, ask before re-parsing — a Sonnet parse is
      // ~$0.30–0.60. The parser also dedupes server-side, but blocking on
      // the UI side avoids a confusing "duplicate" toast appearing AFTER
      // a 60-second wait.
      const buf0 = await file.arrayBuffer();
      const bin = new Uint8Array(buf0);
      let b64 = "";
      const CHUNK = 0x8000;
      for (let i = 0; i < bin.length; i += CHUNK) {
        b64 += String.fromCharCode.apply(
          null,
          Array.from(bin.subarray(i, i + CHUNK)),
        );
      }
      const base64Bytes = typeof window !== "undefined" ? window.btoa(b64) : "";
      const dupCheck = await checkDuplicateUploadAction(clientId, base64Bytes);
      if (dupCheck.ok && dupCheck.duplicate) {
        const proceed = window.confirm(
          `This file is already on disk for this client:\n\n` +
          `  📄 ${dupCheck.existing_filename}\n` +
          `  uploaded ${dupCheck.existing_uploaded_at?.slice(0, 10) ?? "earlier"}\n\n` +
          `If a functional-test parse already exists for it, the existing record will be shown. ` +
          `Otherwise we'll parse the existing copy without re-uploading.\n\n` +
          `OK = continue · Cancel = leave it`,
        );
        if (!proceed) {
          setIsParsing(false);
          return;
        }
        // Use the existing path — no re-upload.
        setLastFilePath(dupCheck.existing_path ?? null);
        setForcedType(null);
        if (dupCheck.existing_path) {
          runParse(dupCheck.existing_path);
        } else {
          setIsParsing(false);
        }
        return;
      }

      const filePath = await uploadClientFile(clientId, file);
      setLastFilePath(filePath);
      setForcedType(null);
      runParse(filePath);
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
            <span className="text-[11px] text-indigo-700/80">Upload a DUTCH or GI-MAP report (PDF or .md/.txt) to extract structured findings</span>
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
                <div className="font-semibold text-indigo-900">📎 Upload report</div>
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
              accept="application/pdf,.md,.txt,text/markdown,text/plain"
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
            <div className="text-xs rounded-md bg-red-50 border border-red-200 px-2 py-2 text-red-700 space-y-2">
              <p>{parseError}</p>
              {lastFilePath && parseError.toLowerCase().includes("identify test type") && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] text-red-800/80">Force as:</span>
                  <button
                    type="button"
                    onClick={() => { setForcedType("gi_map"); runParse(lastFilePath, "gi_map"); }}
                    disabled={isParsing}
                    className="text-[11px] font-semibold px-2 py-1 rounded bg-white border border-red-300 text-red-900 hover:bg-red-100"
                  >
                    🦠 GI-MAP
                  </button>
                  <button
                    type="button"
                    onClick={() => { setForcedType("dutch"); runParse(lastFilePath, "dutch"); }}
                    disabled={isParsing}
                    className="text-[11px] font-semibold px-2 py-1 rounded bg-white border border-red-300 text-red-900 hover:bg-red-100"
                  >
                    🧬 DUTCH
                  </button>
                  {isParsing && forcedType && (
                    <span className="text-[11px] text-red-800 animate-pulse">
                      Re-parsing as {forcedType === "gi_map" ? "GI-MAP" : "DUTCH"}…
                    </span>
                  )}
                </div>
              )}
            </div>
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
