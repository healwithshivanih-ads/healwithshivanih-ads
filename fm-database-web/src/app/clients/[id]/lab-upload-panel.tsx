"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { detectLabPatterns, IFM_NODES } from "@/lib/fmdb/ifm-matrix";
import {
  uploadFileAction,
  extractTranscriptAction,
  applyTranscriptDataAction,
} from "@/app/assess/actions";
import { findExpectingSessionAction, assessReworkBenefitAction } from "@/app/clients/actions";
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
            PDF or image → extracts lab values → saves as health snapshot + flags FM patterns.
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
            accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/*"
            onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")}
            className="block w-full text-sm text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:font-medium file:bg-teal-100 file:text-teal-700 hover:file:bg-teal-200 cursor-pointer"
          />
          {fileName && <p className="text-xs text-teal-700">📄 {fileName}</p>}
          {extractError && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{extractError}</p>
          )}
          <Button
            type="button"
            onClick={onExtract}
            disabled={isExtracting || !fileName}
            variant="outline"
            className="border-teal-300 text-teal-800 hover:bg-teal-100 text-sm"
          >
            {isExtracting ? "Extracting…" : "✨ Extract lab values"}
          </Button>
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
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-800">
              ✓ Saved to health history. Trends will update on next page load.
              <button onClick={() => { reset(); setOpen(false); }} className="ml-2 underline">Close</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
