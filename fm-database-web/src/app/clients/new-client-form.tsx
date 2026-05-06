"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "./actions";

const today = () => new Date().toISOString().slice(0, 10);

export function NewClientForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  // Form state
  const [clientId, setClientId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [intakeDate, setIntakeDate] = useState(today());
  const [ageBand, setAgeBand] = useState("");
  const [sex, setSex] = useState<"F" | "M" | "other">("F");
  const [conditions, setConditions] = useState("");
  const [medications, setMedications] = useState("");
  const [allergies, setAllergies] = useState("");
  const [goals, setGoals] = useState("");
  const [notes, setNotes] = useState("");

  const reset = () => {
    setClientId("");
    setDisplayName("");
    setIntakeDate(today());
    setAgeBand("");
    setSex("F");
    setConditions("");
    setMedications("");
    setAllergies("");
    setGoals("");
    setNotes("");
  };

  const splitLines = (s: string) =>
    s
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const res = await createClient({
        client_id: clientId.trim().toLowerCase(),
        display_name: displayName.trim() || undefined,
        intake_date: intakeDate,
        age_band: ageBand.trim(),
        sex,
        conditions: splitLines(conditions),
        medications: splitLines(medications),
        allergies: splitLines(allergies),
        goals: splitLines(goals),
        notes: notes.trim() || undefined,
      });
      if (res.ok) {
        toast.success(`Created ${res.client_id}`);
        reset();
        setOpen(false);
        router.push(`/clients/${res.client_id}`);
      } else {
        toast.error(res.error);
      }
    });
  };

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} variant="default">
        + New client
      </Button>
    );
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>New client</CardTitle>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Client ID *" hint="lowercase, hyphens (e.g. cl-004)">
              <Input
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="cl-004"
                required
                pattern="[a-z0-9-]+"
              />
            </Field>
            <Field label="Display name" hint="for coach reference; can be a pseudonym">
              <Input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Anjali R."
              />
            </Field>
            <Field label="Intake date *">
              <Input
                type="date"
                value={intakeDate}
                onChange={(e) => setIntakeDate(e.target.value)}
                required
              />
            </Field>
            <Field label="Age band *" hint="e.g. 45-50">
              <Input
                value={ageBand}
                onChange={(e) => setAgeBand(e.target.value)}
                placeholder="45-50"
                required
              />
            </Field>
            <Field label="Sex *">
              <select
                value={sex}
                onChange={(e) => setSex(e.target.value as "F" | "M" | "other")}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs"
                required
              >
                <option value="F">F</option>
                <option value="M">M</option>
                <option value="other">other</option>
              </select>
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Active conditions" hint="one per line">
              <Textarea
                value={conditions}
                onChange={setConditions}
                placeholder="hashimoto&#10;perimenopause"
              />
            </Field>
            <Field label="Current medications" hint="one per line">
              <Textarea
                value={medications}
                onChange={setMedications}
                placeholder="levothyroxine 75mcg"
              />
            </Field>
            <Field label="Known allergies" hint="one per line">
              <Textarea
                value={allergies}
                onChange={setAllergies}
                placeholder="sulfa"
              />
            </Field>
            <Field label="Goals" hint="one per line">
              <Textarea
                value={goals}
                onChange={setGoals}
                placeholder="reduce TPO antibodies&#10;sleep through the night"
              />
            </Field>
          </div>

          <Field label="Notes">
            <Textarea
              value={notes}
              onChange={setNotes}
              rows={3}
              placeholder="anything that doesn't fit elsewhere"
            />
          </Field>

          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create client"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <div className="text-sm font-medium">{label}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      {children}
    </label>
  );
}

function Textarea({
  value,
  onChange,
  rows = 2,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      placeholder={placeholder}
      className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs"
    />
  );
}
