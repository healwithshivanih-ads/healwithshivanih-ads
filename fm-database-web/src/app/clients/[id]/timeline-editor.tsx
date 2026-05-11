"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  updateClientTimeline,
  type ClientTimelineEvent,
} from "@/app/clients/actions";

/** Post-intake editor for the client's structured timeline. Clients keep
 *  remembering events later — "oh, I had glandular fever when I was 17",
 *  "I started the SSRI two years ago", "my dad had Hashimoto's". Coach
 *  adds them here and they flow into the next assessment (IFM timeline
 *  ATM analysis reads client.timeline_events). */

const CATEGORIES: { value: string; label: string }[] = [
  { value: "life_event", label: "Life event" },
  { value: "symptom_onset", label: "Symptom onset" },
  { value: "diagnosis", label: "Diagnosis" },
  { value: "surgery", label: "Surgery" },
  { value: "medication_change", label: "Medication change" },
  { value: "family_history", label: "Family history" },
  { value: "other", label: "Other" },
];

interface Props {
  clientId: string;
  initialEvents: ClientTimelineEvent[];
}

export function TimelineEditor({ clientId, initialEvents }: Props) {
  const [events, setEvents] = useState<ClientTimelineEvent[]>(initialEvents ?? []);
  const [savePending, startSave] = useTransition();
  const [dirty, setDirty] = useState(false);

  // New-event form state
  const [newYear, setNewYear] = useState<string>("");
  const [newEvent, setNewEvent] = useState<string>("");
  const [newCategory, setNewCategory] = useState<string>("life_event");

  const addEvent = () => {
    const trimmed = newEvent.trim();
    if (!trimmed) return;
    const yearNum = newYear.trim() ? parseInt(newYear, 10) : undefined;
    const next: ClientTimelineEvent = {
      event: trimmed,
      category: newCategory || undefined,
      ...(yearNum && !isNaN(yearNum) ? { year: yearNum } : {}),
    };
    setEvents((es) => [...es, next]);
    setNewYear("");
    setNewEvent("");
    setDirty(true);
  };

  const removeEvent = (i: number) => {
    setEvents((es) => es.filter((_, j) => j !== i));
    setDirty(true);
  };

  const updateEvent = (i: number, patch: Partial<ClientTimelineEvent>) => {
    setEvents((es) => es.map((e, j) => (j === i ? { ...e, ...patch } : e)));
    setDirty(true);
  };

  const save = () => {
    startSave(async () => {
      const res = await updateClientTimeline({ client_id: clientId, timeline_events: events });
      if (res.ok) {
        toast.success(`Timeline saved (${events.length} event${events.length === 1 ? "" : "s"})`);
        setDirty(false);
      } else {
        toast.error(res.error);
      }
    });
  };

  // Sort displayed events by year ascending, undated last
  const sorted = [...events]
    .map((e, originalIdx) => ({ e, originalIdx }))
    .sort((a, b) => {
      const ya = a.e.year ?? 9999;
      const yb = b.e.year ?? 9999;
      return ya - yb;
    });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span>🕰 Timeline ({events.length})</span>
          {dirty && (
            <Button size="sm" variant="default" onClick={save} disabled={savePending}>
              {savePending ? "Saving…" : "💾 Save changes"}
            </Button>
          )}
        </CardTitle>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          Life events / diagnoses / symptom onsets / medication changes. Used by the AI for ATM (antecedent-trigger-mediator) analysis.
        </p>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {/* Existing events */}
        {sorted.length === 0 && (
          <p className="text-xs text-muted-foreground italic">No events recorded yet. Add one below.</p>
        )}
        <ul className="space-y-1.5">
          {sorted.map(({ e, originalIdx }) => (
            <li key={originalIdx} className="flex items-center gap-2 border rounded-md p-1.5">
              <Input
                type="number"
                placeholder="Year"
                value={e.year ?? ""}
                onChange={(ev) => {
                  const v = ev.target.value;
                  updateEvent(originalIdx, { year: v ? parseInt(v, 10) : undefined });
                }}
                className="w-20 text-xs"
              />
              <Input
                value={e.event}
                onChange={(ev) => updateEvent(originalIdx, { event: ev.target.value })}
                className="flex-1 text-xs"
                placeholder="e.g. Hashimoto's diagnosed"
              />
              <select
                value={e.category ?? "other"}
                onChange={(ev) => updateEvent(originalIdx, { category: ev.target.value })}
                className="text-xs border rounded px-1 py-1 bg-background"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => removeEvent(originalIdx)}
                className="text-xs text-red-400 hover:text-red-600 px-1"
                title="Remove"
              >✕</button>
            </li>
          ))}
        </ul>

        {/* New event row */}
        <div className="flex items-center gap-2 border-2 border-dashed rounded-md p-1.5 bg-muted/30">
          <Input
            type="number"
            placeholder="Year"
            value={newYear}
            onChange={(e) => setNewYear(e.target.value)}
            className="w-20 text-xs"
          />
          <Input
            value={newEvent}
            onChange={(e) => setNewEvent(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addEvent(); }}
            placeholder="What happened?  e.g. Started SSRI, glandular fever, parent diagnosed with Hashimoto's"
            className="flex-1 text-xs"
          />
          <select
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            className="text-xs border rounded px-1 py-1 bg-background"
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={addEvent}
            disabled={!newEvent.trim()}
          >+ Add</Button>
        </div>
      </CardContent>
    </Card>
  );
}
