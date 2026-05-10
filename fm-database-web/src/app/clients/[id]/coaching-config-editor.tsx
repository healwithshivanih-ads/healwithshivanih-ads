"use client";

import { useEffect, useState } from "react";
import {
  loadCoachingSequencesAction,
  updateClientCoachingAction,
  type Cadence,
  type CoachingSequence,
} from "@/app/coaching/actions";

interface Props {
  clientId: string;
  initial: {
    coaching_cadence?: Cadence;
    coaching_sequence_slug?: string;
    coaching_started_at?: string;
  };
}

export function CoachingConfigEditor({ clientId, initial }: Props) {
  const [cadence, setCadence] = useState<Cadence>(initial.coaching_cadence ?? "off");
  const [sequenceSlug, setSequenceSlug] = useState(initial.coaching_sequence_slug ?? "foundations");
  const [startedAt, setStartedAt] = useState(initial.coaching_started_at ?? "");
  const [sequences, setSequences] = useState<CoachingSequence[]>([]);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    loadCoachingSequencesAction().then(setSequences).catch(() => setSequences([]));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setStatus("idle");
    const res = await updateClientCoachingAction(clientId, {
      coaching_cadence: cadence,
      coaching_sequence_slug: sequenceSlug,
      coaching_started_at: cadence === "off" ? "" : (startedAt || new Date().toISOString().slice(0, 10)),
    });
    setSaving(false);
    if (res.ok) {
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2000);
    } else {
      setStatus("error");
      setError(res.error);
    }
  };

  const selectedSeq = sequences.find((s) => s.slug === sequenceSlug);

  return (
    <details className="rounded-xl border border-border bg-emerald-50/30 group">
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold flex items-center gap-2 list-none">
        <span>🌱</span>
        <span>Coaching nudges</span>
        <span className="text-xs text-muted-foreground font-normal">
          {cadence === "off" ? "off" : `${cadence} · ${selectedSeq?.name ?? sequenceSlug}`}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">▾</span>
      </summary>

      <div className="px-4 pb-4 space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <label className="space-y-1">
            <span className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wide">Cadence</span>
            <select
              value={cadence}
              onChange={(e) => setCadence(e.target.value as Cadence)}
              className="w-full rounded-md border border-input bg-white px-2 py-1.5 text-xs"
            >
              <option value="off">Off</option>
              <option value="weekly">Weekly</option>
              <option value="biweekly">Every 2 weeks</option>
            </select>
          </label>

          <label className="space-y-1">
            <span className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wide">Sequence</span>
            <select
              value={sequenceSlug}
              onChange={(e) => setSequenceSlug(e.target.value)}
              disabled={cadence === "off"}
              className="w-full rounded-md border border-input bg-white px-2 py-1.5 text-xs disabled:opacity-40"
            >
              {sequences.map((s) => (
                <option key={s.slug} value={s.slug}>{s.name}</option>
              ))}
            </select>
          </label>

          <label className="space-y-1">
            <span className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wide">Started</span>
            <input
              type="date"
              value={startedAt}
              onChange={(e) => setStartedAt(e.target.value)}
              disabled={cadence === "off"}
              className="w-full rounded-md border border-input bg-white px-2 py-1.5 text-xs disabled:opacity-40"
            />
          </label>
        </div>

        {selectedSeq && cadence !== "off" && (
          <p className="text-[11px] text-muted-foreground italic">
            {selectedSeq.description ?? `${selectedSeq.messages.length} messages`}
            {" · "}
            <span>Default template: <code className="font-mono">{selectedSeq.default_campaign_name}</code></span>
          </p>
        )}

        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-emerald-600 hover:bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
          >
            {saving ? "Saving…" : "💾 Save"}
          </button>
          {status === "saved" && <span className="text-xs text-emerald-700">✓ Saved</span>}
          {status === "error" && <span className="text-xs text-red-600">⚠ {error}</span>}
        </div>
      </div>
    </details>
  );
}
