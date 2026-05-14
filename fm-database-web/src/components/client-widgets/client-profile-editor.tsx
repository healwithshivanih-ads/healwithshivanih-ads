"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { updateClientProfile } from "@/lib/server-actions/clients";

interface Props {
  clientId: string;
  initial: {
    active_conditions: string[];
    medications: string[];
    medical_history: string[];
    allergies: string[];
    goals: string[];
    notes: string;
  };
}

/** Editable comma/newline-separated list field → array on save */
function ListField({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <div>
      <label className="text-xs font-medium block mb-1">{label}</label>
      {hint && <p className="text-[11px] text-muted-foreground mb-1">{hint}</p>}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        placeholder={placeholder}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-y font-mono"
      />
    </div>
  );
}

function toLines(arr: string[]) {
  return arr.join("\n");
}

function fromLines(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function ClientProfileEditor({ clientId, initial }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const [conditions, setConditions] = useState(toLines(initial.active_conditions));
  const [medications, setMedications] = useState(toLines(initial.medications));
  const [history, setHistory] = useState(toLines(initial.medical_history));
  const [allergies, setAllergies] = useState(toLines(initial.allergies));
  const [goals, setGoals] = useState(toLines(initial.goals));
  const [notes, setNotes] = useState(initial.notes);

  const save = () => {
    startTransition(async () => {
      const res = await updateClientProfile({
        client_id: clientId,
        active_conditions: fromLines(conditions),
        medications: fromLines(medications),
        medical_history: fromLines(history),
        allergies: fromLines(allergies),
        goals: fromLines(goals),
        notes: notes.trim(),
      });
      if (res.ok) {
        toast.success("Client profile updated");
        setOpen(false);
      } else {
        toast.error(res.error ?? "Save failed");
      }
    });
  };

  const cancel = () => {
    // reset to original
    setConditions(toLines(initial.active_conditions));
    setMedications(toLines(initial.medications));
    setHistory(toLines(initial.medical_history));
    setAllergies(toLines(initial.allergies));
    setGoals(toLines(initial.goals));
    setNotes(initial.notes);
    setOpen(false);
  };

  return (
    <div className="mt-1">
      {!open ? (
        <Button
          size="sm"
          variant="outline"
          className="text-xs h-7 gap-1"
          onClick={() => setOpen(true)}
        >
          ✏️ Edit clinical info
        </Button>
      ) : (
        <div className="border rounded-lg p-4 bg-white space-y-4 mt-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Editing clinical profile — one item per line (or comma-separated)
          </p>

          <ListField
            label="Active conditions"
            value={conditions}
            onChange={setConditions}
            placeholder={"Hashimoto's thyroiditis\nPerimenopause\nGut permeability issues"}
            hint="One condition per line."
          />

          <ListField
            label="Medications & supplements currently taking"
            value={medications}
            onChange={setMedications}
            placeholder={"Levothyroxine 50mcg\nVitamin D (weekly)\nIron supplementation"}
            hint="One per line. Include dose if known."
          />

          <ListField
            label="Medical history"
            value={history}
            onChange={setHistory}
            placeholder={"Hashimoto's diagnosed 2018, antibodies normalised 2023\nPerimenopause onset 2024"}
            hint="Past diagnoses, resolved conditions, key clinical events."
          />

          <ListField
            label="Allergies & intolerances"
            value={allergies}
            onChange={setAllergies}
            placeholder={"Gluten sensitivity\nDairy intolerance"}
          />

          <ListField
            label="Goals"
            value={goals}
            onChange={setGoals}
            placeholder={"Improve energy levels\nLose weight\nReduce brain fog"}
          />

          <div>
            <label className="text-xs font-medium block mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Any free-form clinical notes about this client…"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-y"
            />
          </div>

          <div className="flex gap-2 pt-1">
            <Button size="sm" onClick={save} disabled={pending}>
              {pending ? "Saving…" : "💾 Save changes"}
            </Button>
            <Button size="sm" variant="outline" onClick={cancel} disabled={pending}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
