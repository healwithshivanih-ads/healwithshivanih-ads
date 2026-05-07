"use client";

import { useState, useTransition, useRef } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  parseTranscriptForClient,
  updateClientFromTranscriptAction,
  type ParsedClientData,
} from "@/app/clients/actions";

interface Props {
  clientId: string;
}

function FieldRow({ label, value }: { label: string; value: string | string[] | null | undefined }) {
  if (!value || (Array.isArray(value) && value.length === 0)) return null;
  const display = Array.isArray(value) ? value.join(", ") : value;
  return (
    <div className="grid grid-cols-[120px_1fr] gap-2 text-xs py-1 border-b border-gray-100 last:border-0">
      <span className="text-muted-foreground font-medium shrink-0">{label}</span>
      <span className="break-words">{display}</span>
    </div>
  );
}

function PillarsRow({ fp }: { fp: ParsedClientData["five_pillars"] }) {
  if (!fp) return null;
  const items = [
    fp.sleep_hours ? `Sleep: ${fp.sleep_hours}h` : null,
    fp.sleep_quality ? `Quality: ${fp.sleep_quality}/5` : null,
    fp.stress_level ? `Stress: ${fp.stress_level}/5` : null,
    fp.movement_days_per_week ? `Movement: ${fp.movement_days_per_week}d/wk` : null,
    fp.nutrition_quality ? `Nutrition: ${fp.nutrition_quality}/5` : null,
    fp.connection_quality ? `Connection: ${fp.connection_quality}/5` : null,
  ].filter(Boolean);
  if (items.length === 0) return null;
  return (
    <div className="grid grid-cols-[120px_1fr] gap-2 text-xs py-1 border-b border-gray-100 last:border-0">
      <span className="text-muted-foreground font-medium shrink-0">Five pillars</span>
      <span>{items.join(" · ")}</span>
    </div>
  );
}

export function TranscriptUpdatePanel({ clientId }: Props) {
  const [open, setOpen] = useState(false);
  const [isParsing, startParse] = useTransition();
  const [isApplying, startApply] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const [transcriptUrl, setTranscriptUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedClientData | null>(null);

  const onParse = () => {
    const file = fileRef.current?.files?.[0];
    if (!file && !transcriptUrl.trim()) {
      toast.error("Upload a file or paste a URL first");
      return;
    }
    setParseError(null);
    setParsed(null);
    startParse(async () => {
      const fd = new FormData();
      if (file) fd.append("file", file);
      if (transcriptUrl.trim()) fd.append("url", transcriptUrl.trim());
      const res = await parseTranscriptForClient(fd);
      if (!res.ok) {
        setParseError(res.error);
        toast.error(`Parse failed: ${res.error}`);
        return;
      }
      setParsed(res.data);
    });
  };

  const onApply = () => {
    if (!parsed) return;
    startApply(async () => {
      const res = await updateClientFromTranscriptAction(clientId, parsed);
      if (!res.ok) {
        toast.error(`Failed: ${res.error}`);
        return;
      }
      const n = res.updated_fields?.length ?? 0;
      toast.success(`✓ Updated ${n} field${n !== 1 ? "s" : ""} from transcript`);
      setParsed(null);
      setTranscriptUrl("");
      setFileName("");
      if (fileRef.current) fileRef.current.value = "";
      setOpen(false);
    });
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
      >
        📋 Update from transcript
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50/40 p-4 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-medium text-sm flex items-center gap-1.5">
            📋 Update client from transcript
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Upload a session recording or paste a link. AI extracts FM intake fields and previews what will change.
          </p>
        </div>
        <button onClick={() => { setOpen(false); setParsed(null); setParseError(null); }}
          className="text-muted-foreground hover:text-foreground text-xs shrink-0">✕ close</button>
      </div>

      {/* File / URL inputs */}
      {!parsed && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr]">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Upload file (.txt or .pdf)</label>
              <input
                ref={fileRef}
                type="file"
                accept=".txt,.pdf,text/plain,application/pdf"
                onChange={(e) => { setFileName(e.target.files?.[0]?.name ?? ""); setTranscriptUrl(""); }}
                className="block w-full text-sm text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:font-medium file:bg-violet-100 file:text-violet-700 hover:file:bg-violet-200 cursor-pointer"
              />
              {fileName && <p className="text-xs text-violet-700">📄 {fileName}</p>}
            </div>
            <div className="flex items-center justify-center text-xs text-muted-foreground font-medium">OR</div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Paste a link</label>
              <Input
                type="url"
                placeholder="https://docs.google.com/document/d/…"
                value={transcriptUrl}
                onChange={(e) => { setTranscriptUrl(e.target.value); if (e.target.value && fileRef.current) { fileRef.current.value = ""; setFileName(""); } }}
                className="text-sm"
              />
            </div>
          </div>
          {parseError && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{parseError}</p>
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              onClick={onParse}
              disabled={isParsing || (!transcriptUrl.trim() && !fileName)}
              variant="outline"
              className="border-violet-300 text-violet-800 hover:bg-violet-100 text-sm"
            >
              {isParsing ? "Parsing…" : "✨ Extract from transcript"}
            </Button>
          </div>
        </div>
      )}

      {/* Preview extracted data */}
      {parsed && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="bg-violet-100 text-violet-800 border-violet-200 text-xs">
              {parsed.fields_found} fields found
            </Badge>
            <span className="text-xs text-muted-foreground">Review before applying:</span>
          </div>

          <div className="rounded-lg border bg-white p-3 space-y-0 max-h-80 overflow-y-auto text-xs">
            {/* Basic */}
            <FieldRow label="Name" value={parsed.display_name} />
            <FieldRow label="Email" value={parsed.email} />
            <FieldRow label="DOB" value={parsed.date_of_birth ?? (parsed.estimated_age ? `~${parsed.estimated_age} yrs` : null)} />
            <FieldRow label="Mobile" value={parsed.mobile_number} />
            <FieldRow label="Location" value={[parsed.city, parsed.state, parsed.country].filter(Boolean).join(", ") || null} />
            {/* Clinical */}
            <FieldRow label="Conditions" value={parsed.active_conditions} />
            <FieldRow label="Medications" value={parsed.current_medications} />
            <FieldRow label="Allergies" value={parsed.known_allergies} />
            <FieldRow label="Goals" value={parsed.goals} />
            <FieldRow label="Key symptoms" value={parsed.key_symptoms} />
            <FieldRow label="Family history" value={parsed.family_history} />
            {/* Diet */}
            <FieldRow label="Diet" value={parsed.dietary_preference} />
            <FieldRow label="Avoid" value={parsed.foods_to_avoid} />
            <FieldRow label="Non-negot." value={parsed.non_negotiables} />
            <FieldRow label="Triggers" value={parsed.reported_triggers} />
            {/* FM Intake */}
            <FieldRow label="Digestion" value={parsed.digestion_notes} />
            <FieldRow label="Sleep" value={parsed.sleep_notes} />
            <FieldRow label="Energy" value={parsed.energy_pattern} />
            <FieldRow label="Menstrual" value={parsed.menstrual_notes} />
            <FieldRow label="Stress resp." value={parsed.stress_response} />
            <FieldRow label="Childhood" value={parsed.childhood_history} />
            <FieldRow label="Exposures" value={parsed.toxic_exposures} />
            <FieldRow label="What worked" value={parsed.what_has_worked} />
            <FieldRow label="Didn't work" value={parsed.what_hasnt_worked} />
            {/* Five pillars */}
            <PillarsRow fp={parsed.five_pillars} />
            {/* Timeline */}
            {parsed.timeline_events && parsed.timeline_events.length > 0 && (
              <div className="grid grid-cols-[120px_1fr] gap-2 text-xs py-1 border-b border-gray-100 last:border-0">
                <span className="text-muted-foreground font-medium shrink-0">Timeline</span>
                <div className="space-y-0.5">
                  {parsed.timeline_events.map((ev, i) => (
                    <div key={i} className="flex items-start gap-1.5">
                      <span className="font-mono text-muted-foreground shrink-0 w-10">{ev.year ?? "—"}</span>
                      <span>{ev.event}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* Notes */}
            <FieldRow label="Notes" value={parsed.notes} />
          </div>

          <div className="flex gap-2 flex-wrap">
            <Button
              type="button"
              onClick={onApply}
              disabled={isApplying}
              className="text-sm"
            >
              {isApplying ? "Applying…" : "✅ Apply to client profile"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => { setParsed(null); setFileName(""); setTranscriptUrl(""); if (fileRef.current) fileRef.current.value = ""; }}
              className="text-sm"
            >
              ↩ Try another transcript
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
