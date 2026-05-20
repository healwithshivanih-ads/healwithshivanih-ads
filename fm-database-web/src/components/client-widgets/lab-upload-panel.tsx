"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { detectLabPatterns, IFM_NODES } from "@/lib/fmdb/ifm-matrix";
import {
  uploadFileAction,
  extractTranscriptAction,
  applyTranscriptDataAction,
  loadLatestLabSnapshotAction,
  checkDuplicateUploadAction,
} from "@/lib/server-actions/assess";
import { findExpectingSessionAction, assessReworkBenefitAction } from "@/lib/server-actions/clients";
import type { ExtractedLabValue, ExtractedMeasurements } from "@/lib/fmdb/anthropic";
import type { ComputedRatio, ExtractedLab } from "@/lib/fmdb/anthropic-types";

interface Props {
  clientId: string;
}

// Minimal symptom catalogue needed by extractTranscriptAction — empty is fine
// for lab-only extraction; the script still extracts health_data regardless.
const EMPTY_CATALOGUE: never[] = [];

// ── Lab value table ────────────────────────────────────────────────────────────

function LabTable({ labs }: { labs: ExtractedLabValue[] }) {
  if (labs.length === 0) return null;
  return (
    <table className="w-full text-xs border-collapse">
      <thead>
        <tr className="border-b text-muted-foreground">
          <th className="text-left py-1 pr-3 font-medium">Test</th>
          <th className="text-left py-1 pr-3 font-medium">Value</th>
          <th className="text-left py-1 font-medium">Unit</th>
        </tr>
      </thead>
      <tbody>
        {labs.map((l, i) => (
          <tr key={i} className="border-b border-muted/40">
            <td className="py-1 pr-3 font-medium">{l.test_name}</td>
            <td className="py-1 pr-3 tabular-nums">{l.value}</td>
            <td className="py-1 text-muted-foreground">{l.unit}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Measurements row ───────────────────────────────────────────────────────────

function MeasurementChips({ m }: { m: ExtractedMeasurements }) {
  const items: [string, unknown][] = Object.entries(m).filter(([, v]) => v != null);
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map(([k, v]) => (
        <span key={k} className="text-[11px] bg-muted/60 rounded px-2 py-0.5">
          {k.replace(/_/g, " ")}: <strong>{String(v)}</strong>
        </span>
      ))}
    </div>
  );
}

// ── FM pattern banners (mini version) ─────────────────────────────────────────

function PatternBanners({ labs }: { labs: ExtractedLabValue[] }) {
  // Map to ExtractedLab shape expected by detectLabPatterns
  const typed: ExtractedLab[] = labs.map((l) => ({
    test_name: l.test_name,
    value: l.value,
    unit: l.unit,
    date_drawn: l.date_drawn ?? null,
  }));
  const patterns = detectLabPatterns(typed, [] as ComputedRatio[]);
  if (patterns.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <p className="text-[10px] uppercase tracking-wide font-medium text-muted-foreground">FM pattern flags</p>
      {patterns.map((p) => {
        const node = IFM_NODES.find((n) => n.id === p.node)!;
        const bg = p.severity === "flag" ? "bg-red-50 border-red-200" : p.severity === "warning" ? "bg-amber-50 border-amber-200" : "bg-blue-50 border-blue-200";
        const icon = p.severity === "flag" ? "🚩" : p.severity === "warning" ? "⚠️" : "ℹ️";
        return (
          <div key={p.id} className={`rounded-lg border px-3 py-2 text-xs ${bg}`}>
            <div className="flex items-center gap-2 flex-wrap">
              <span>{icon}</span>
              <span className="font-semibold">{p.title}</span>
              {p.value && <code className="text-[10px] bg-white/60 px-1 rounded font-mono">{p.value}</code>}
              <span className="text-[10px] text-muted-foreground">{node.emoji} {node.label}</span>
            </div>
            <p className="text-muted-foreground mt-0.5 leading-snug">{p.detail}</p>
          </div>
        );
      })}
    </div>
  );
}

// ── Extraction error banner ────────────────────────────────────────────────────
// Translates raw error strings into a coach-readable message. Two cases get
// special treatment:
//   1. Anthropic monthly API cap reached — amber, not red; it's a billing
//      state, not a bug. Tells the coach extraction is paused + resets date.
//   2. The generic Next.js production error ("An error occurred in the
//      Server Components render…") — that text leaks nothing useful, so we
//      replace it with a plain-English "server hiccup, retry" message.
function ExtractErrorBanner({ error }: { error: string }) {
  const low = error.toLowerCase();
  const isApiLimit =
    low.includes("monthly limit") ||
    low.includes("usage limit") ||
    low.includes("usage limits");
  const isGenericServer =
    low.includes("server components render") ||
    low.includes("an error occurred in the server");

  if (isApiLimit) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-900 space-y-1">
        <div className="font-semibold flex items-center gap-1.5">
          🔒 AI extraction paused — monthly API limit reached
        </div>
        <p className="leading-snug">
          {error.replace(/^API call failed:\s*/i, "")}
        </p>
        <p className="leading-snug text-amber-700">
          The lab PDF is still saved on file — you can type the key values
          into the client&apos;s markers manually, or re-run extraction once
          the limit resets.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700 space-y-1">
      <div className="font-semibold">⚠️ Extraction failed</div>
      <p className="leading-snug">
        {isGenericServer
          ? "The server hit an unexpected error processing this file. Try again — if it keeps failing, the file may be corrupt or password-protected."
          : error}
      </p>
    </div>
  );
}

// ── Main panel ─────────────────────────────────────────────────────────────────

export function LabUploadPanel({ clientId }: Props) {
  const [open, setOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [isExtracting, startExtract] = useTransition();
  const [isSaving, startSave] = useTransition();

  const [extractedLabs, setExtractedLabs] = useState<ExtractedLabValue[]>([]);
  const [extractedMeasurements, setExtractedMeasurements] = useState<ExtractedMeasurements | null>(null);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [savedSnapshotDate, setSavedSnapshotDate] = useState<string | null>(null);

  // Rehydrate the most recent saved lab snapshot on mount. Without this the
  // widget reset to empty on every refresh, making the coach think the
  // extraction had vanished even though it was persisted to client.yaml.
  useEffect(() => {
    let stale = false;
    (async () => {
      const r = await loadLatestLabSnapshotAction(clientId);
      if (stale || !r.ok || r.lab_values.length === 0) return;
      const labs = r.lab_values.map((lv) => ({
        test_name: lv.test_name,
        value: String(lv.value ?? ""),
        unit: lv.unit ?? "",
        date_drawn: lv.date_drawn ?? null,
      })) as ExtractedLabValue[];
      setExtractedLabs(labs);
      setSavedSnapshotDate(r.date);
      setSaved(true);
      if (r.measurements) {
        setExtractedMeasurements(r.measurements as ExtractedMeasurements);
      }
    })();
    return () => { stale = true; };
  }, [clientId]);

  const reset = () => {
    setExtractedLabs([]);
    setExtractedMeasurements(null);
    setExtractError(null);
    setFilePath(null);
    setSaved(false);
    setFileName("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const onExtract = () => {
    const file = fileRef.current?.files?.[0];
    if (!file) { toast.error("Select a file first"); return; }
    setExtractError(null);
    setExtractedLabs([]);
    setExtractedMeasurements(null);
    setSaved(false);

    startExtract(async () => {
      try {
        // 0. Pre-upload duplicate check by SHA-256 of the bytes. Catches
        // re-uploads of the same lab PDF across renames so the coach
        // doesn't burn another extraction call or end up with two
        // contradictory copies on file.
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
            `This file (or an identical copy) was already uploaded for this client as:\n\n` +
            `  📄 ${dupCheck.existing_filename}\n` +
            `  uploaded ${dupCheck.existing_uploaded_at?.slice(0, 10) ?? "earlier"}\n\n` +
            `OK = re-extract this upload anyway (uses a fresh API call)\n` +
            `Cancel = leave the existing record as-is`,
          );
          if (!proceed) {
            setExtractError(null);
            return;
          }
        }

        // 1. Upload file to client's files directory via FormData
        // (Next 16 RSC can't serialize multi-MB Uint8Array — FormData streams.)
        const fd = new FormData();
        fd.append("client_id", clientId);
        fd.append("file", file);
        const savedPath = await uploadFileAction(fd);
        setFilePath(savedPath);

        // 2. Extract lab values using existing transcript extractor
        const result = await extractTranscriptAction(
          savedPath,
          file.type || "application/pdf",
          EMPTY_CATALOGUE,
          false
        );

        if (!result.ok) {
          setExtractError(result.error ?? "Extraction failed");
          toast.error("Extraction failed");
          return;
        }

        const labs = result.extracted_data?.lab_values ?? [];
        const measurements = result.extracted_data?.measurements ?? null;

        if (labs.length === 0 && !measurements) {
          setExtractError("No lab values or measurements found in this file.");
          return;
        }

        setExtractedLabs(labs);
        setExtractedMeasurements(measurements);
        toast.success(`Extracted ${labs.length} lab value${labs.length !== 1 ? "s" : ""}${measurements ? " + measurements" : ""}`);
      } catch (e) {
        setExtractError(String(e).slice(0, 300));
        toast.error("Upload failed");
      }
    });
  };

  const onSave = () => {
    startSave(async () => {
      // Try to link this snapshot to the session that ordered it.
      const linkRes = await findExpectingSessionAction(clientId, "blood_panel_basic");
      const linkedSessionId = linkRes.ok ? linkRes.session_id ?? null : null;

      const res = await applyTranscriptDataAction({
        client_id: clientId,
        lab_values: extractedLabs.map((l) => ({
          test_name: l.test_name,
          value: l.value,
          unit: l.unit,
          date_drawn: l.date_drawn ?? null,
        })),
        measurements: extractedMeasurements ?? undefined,
        source: "lab_report",
        linked_session_id: linkedSessionId,
      });
      if (!res.ok) {
        toast.error(`Save failed: ${res.error}`);
        return;
      }
      setSaved(true);
      toast.success(`✓ Saved ${extractedLabs.length} lab values as health snapshot`);

      // Fire-and-forget AI rework assessment using flagged labs as the trigger.
      const flaggedLabs = extractedLabs.slice(0, 8).map((l) => `${l.test_name} ${l.value} ${l.unit}`.trim()).join("; ");
      if (flaggedLabs) {
        void assessReworkBenefitAction({
          clientId,
          triggeredBy: "lab_snapshot",
          eventSummary: `New lab snapshot: ${flaggedLabs}`,
        });
      }
    });
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
      >
        🧪 Upload labs
      </button>
    );
  }

  const hasData = extractedLabs.length > 0 || extractedMeasurements != null;

  return (
    <div className="rounded-lg border border-teal-200 bg-teal-50/40 p-4 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-medium text-sm flex items-center gap-1.5">🧪 Upload lab report</div>
          <p className="text-xs text-muted-foreground mt-0.5">
            PDF, image, or markdown/text → extracts lab values → saves as health snapshot + flags FM patterns.
          </p>
        </div>
        <button
          onClick={() => { setOpen(false); reset(); }}
          className="text-muted-foreground hover:text-foreground text-xs shrink-0"
        >
          ✕ close
        </button>
      </div>

      {!hasData && (
        <div className="space-y-3">
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.webp,.md,.txt,application/pdf,image/*,text/markdown,text/plain"
            disabled={isExtracting}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setFileName(f.name);
              // Auto-fire extraction. Coach was getting tripped up clicking a
              // separate "Extract" button after the file picker already closed
              // (every other upload widget in the app auto-extracts on pick).
              onExtract();
            }}
            className="block w-full text-sm text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:font-medium file:bg-teal-100 file:text-teal-700 hover:file:bg-teal-200 cursor-pointer"
          />
          {fileName && (
            <p className="text-xs text-teal-700">
              📄 {fileName}
              {isExtracting && <span className="ml-2 animate-pulse">⏳ Extracting…</span>}
            </p>
          )}
          {extractError && <ExtractErrorBanner error={extractError} />}
          {extractError && fileName && !isExtracting && (
            <Button
              type="button"
              onClick={onExtract}
              variant="outline"
              className="border-teal-300 text-teal-800 hover:bg-teal-100 text-sm"
            >
              🔁 Retry extraction
            </Button>
          )}
        </div>
      )}

      {hasData && (
        <div className="space-y-4">
          {extractedMeasurements && (
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-wide font-medium text-muted-foreground">Measurements</p>
              <MeasurementChips m={extractedMeasurements} />
            </div>
          )}

          {extractedLabs.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-wide font-medium text-muted-foreground">
                Lab values ({extractedLabs.length})
              </p>
              <div className="rounded-lg border bg-white p-3 max-h-64 overflow-y-auto">
                <LabTable labs={extractedLabs} />
              </div>
            </div>
          )}

          <PatternBanners labs={extractedLabs} />

          {!saved ? (
            <div className="flex gap-2">
              <Button type="button" onClick={onSave} disabled={isSaving} className="text-sm">
                {isSaving ? "Saving…" : "💾 Save as health snapshot"}
              </Button>
              <Button type="button" variant="outline" onClick={reset} className="text-sm">
                ↩ Different file
              </Button>
            </div>
          ) : (
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-800 flex items-center gap-2 flex-wrap">
              <span>
                ✓ {extractedLabs.length} lab value{extractedLabs.length === 1 ? "" : "s"} saved
                {savedSnapshotDate ? ` (drawn ${savedSnapshotDate})` : ""}.
              </span>
              <button onClick={reset} className="underline">↩ Upload a new report</button>
              <button onClick={() => setOpen(false)} className="underline">Close</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
