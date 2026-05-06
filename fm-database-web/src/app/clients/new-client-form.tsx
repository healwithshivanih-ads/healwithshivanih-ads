"use client";

import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { createClient, parseTranscriptForClient, type ParsedClientData } from "./actions";

const today = () => new Date().toISOString().slice(0, 10);

// Fields that were auto-filled from transcript get a small badge
function AutoBadge() {
  return (
    <span className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 border border-violet-200 ml-1.5">
      ✨ transcript
    </span>
  );
}

type AutoFilled = Set<string>;

export function NewClientForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [isParsing, startParseTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  // Transcript input state
  const [transcriptUrl, setTranscriptUrl] = useState("");
  const [transcriptFileName, setTranscriptFileName] = useState("");
  const [autoFilled, setAutoFilled] = useState<AutoFilled>(new Set());
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsedSymptoms, setParsedSymptoms] = useState<string[]>([]);

  // Form state
  const [displayName, setDisplayName] = useState("");
  const [intakeDate, setIntakeDate] = useState(today());
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [sex, setSex] = useState<"F" | "M" | "other">("F");
  const [mobileNumber, setMobileNumber] = useState("");
  const [email, setEmail] = useState("");
  const [conditions, setConditions] = useState("");
  const [medications, setMedications] = useState("");
  const [allergies, setAllergies] = useState("");
  const [goals, setGoals] = useState("");
  const [notes, setNotes] = useState("");
  const [familyHistory, setFamilyHistory] = useState("");
  const [dietaryPreference, setDietaryPreference] = useState("");
  const [foodsToAvoid, setFoodsToAvoid] = useState("");
  const [nonNegotiables, setNonNegotiables] = useState("");

  const reset = () => {
    setDisplayName("");
    setIntakeDate(today());
    setDateOfBirth("");
    setSex("F");
    setMobileNumber("");
    setEmail("");
    setConditions("");
    setMedications("");
    setDietaryPreference("");
    setFoodsToAvoid("");
    setNonNegotiables("");
    setAllergies("");
    setGoals("");
    setNotes("");
    setFamilyHistory("");
    setAutoFilled(new Set());
    setParseError(null);
    setParsedSymptoms([]);
    setTranscriptUrl("");
    setTranscriptFileName("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const splitLines = (s: string) =>
    s.split("\n").map((x) => x.trim()).filter(Boolean);

  /** Apply parsed transcript data to form fields */
  const applyParsed = (data: ParsedClientData) => {
    const filled = new Set<string>();

    if (data.display_name) { setDisplayName(data.display_name); filled.add("displayName"); }
    if (data.date_of_birth) { setDateOfBirth(data.date_of_birth); filled.add("dateOfBirth"); }
    if (data.sex) { setSex(data.sex); filled.add("sex"); }
    if (data.mobile_number) { setMobileNumber(data.mobile_number); filled.add("mobileNumber"); }
    if ((data as { email?: string }).email) { setEmail((data as { email?: string }).email!); filled.add("email"); }
    if (data.intake_date) { setIntakeDate(data.intake_date); filled.add("intakeDate"); }

    if (data.active_conditions.length > 0) {
      setConditions(data.active_conditions.join("\n")); filled.add("conditions");
    }
    if (data.current_medications.length > 0) {
      setMedications(data.current_medications.join("\n")); filled.add("medications");
    }
    if (data.known_allergies.length > 0) {
      setAllergies(data.known_allergies.join("\n")); filled.add("allergies");
    }
    if (data.goals.length > 0) {
      setGoals(data.goals.join("\n")); filled.add("goals");
    }
    if (data.notes) {
      setNotes(data.notes); filled.add("notes");
    }
    if (data.key_symptoms.length > 0) {
      setParsedSymptoms(data.key_symptoms);
    }

    // If DOB not found but age mentioned, note it for the coach
    if (!data.date_of_birth && data.estimated_age) {
      const hint = `Approximate age mentioned: ${data.estimated_age} years`;
      setNotes((prev) => prev ? `${prev}\n${hint}` : hint);
      filled.add("notes");
    }

    setAutoFilled(filled);
  };

  const onParseTranscript = () => {
    const file = fileRef.current?.files?.[0];
    if (!file && !transcriptUrl.trim()) {
      toast.error("Upload a file or paste a URL first");
      return;
    }
    setParseError(null);
    startParseTransition(async () => {
      const fd = new FormData();
      if (file) fd.append("file", file);
      if (transcriptUrl.trim()) fd.append("url", transcriptUrl.trim());

      const res = await parseTranscriptForClient(fd);
      if (!res.ok) {
        setParseError(res.error);
        toast.error(`Parse failed: ${res.error}`);
        return;
      }
      applyParsed(res.data);
      const n = res.data.fields_found;
      toast.success(`Pre-filled ${n} field${n !== 1 ? "s" : ""} from transcript`);
    });
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!mobileNumber.trim()) { toast.error("Mobile number is required"); return; }
    if (!dateOfBirth) { toast.error("Date of birth is required"); return; }
    startTransition(async () => {
      const res = await createClient({
        display_name: displayName.trim() || undefined,
        intake_date: intakeDate,
        date_of_birth: dateOfBirth,
        sex,
        mobile_number: mobileNumber.trim(),
        email: email.trim() || undefined,
        conditions: splitLines(conditions),
        medications: splitLines(medications),
        allergies: splitLines(allergies),
        goals: splitLines(goals),
        notes: notes.trim() || undefined,
        family_history: familyHistory.trim() || undefined,
        dietary_preference: dietaryPreference || undefined,
        foods_to_avoid: foodsToAvoid.trim() || undefined,
        non_negotiables: nonNegotiables.trim() || undefined,
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
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)} variant="default">+ New client</Button>
      </div>
    );
  }

  const isAuto = (field: string) => autoFilled.has(field);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>New client</CardTitle>
        <Button variant="ghost" size="sm" onClick={() => { setOpen(false); reset(); }}>Cancel</Button>
      </CardHeader>
      <CardContent className="space-y-6">

        {/* ── Transcript import panel ── */}
        <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-lg">📋</span>
            <div>
              <div className="font-medium text-sm">Pre-fill from consultation transcript</div>
              <div className="text-xs text-muted-foreground">
                Upload a call recording transcript or paste a link (Google Doc, any URL).
                The form fields below will be auto-populated — review and fill any gaps.
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr]">
            {/* File upload */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Upload file (.txt or .pdf)
              </label>
              <input
                ref={fileRef}
                type="file"
                accept=".txt,.pdf,text/plain,application/pdf"
                onChange={(e) => {
                  setTranscriptFileName(e.target.files?.[0]?.name ?? "");
                  setTranscriptUrl(""); // clear URL if file selected
                }}
                className="block w-full text-sm text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:font-medium file:bg-violet-100 file:text-violet-700 hover:file:bg-violet-200 cursor-pointer"
              />
              {transcriptFileName && (
                <p className="text-xs text-violet-700">📄 {transcriptFileName}</p>
              )}
            </div>

            {/* OR divider */}
            <div className="flex items-center justify-center text-xs text-muted-foreground font-medium">
              OR
            </div>

            {/* URL */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Paste a link
              </label>
              <Input
                type="url"
                placeholder="https://docs.google.com/document/d/…"
                value={transcriptUrl}
                onChange={(e) => {
                  setTranscriptUrl(e.target.value);
                  if (e.target.value && fileRef.current) {
                    fileRef.current.value = "";
                    setTranscriptFileName("");
                  }
                }}
                className="text-sm"
              />
              <p className="text-[11px] text-muted-foreground">
                Google Docs, Notion exports, any public text URL
              </p>
            </div>
          </div>

          {parseError && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
              {parseError}
            </p>
          )}

          <div className="flex items-center gap-3">
            <Button
              type="button"
              onClick={onParseTranscript}
              disabled={isParsing || (!transcriptUrl.trim() && !transcriptFileName)}
              variant="outline"
              className="border-violet-300 text-violet-800 hover:bg-violet-100"
            >
              {isParsing ? "Parsing…" : "✨ Parse transcript"}
            </Button>
            {autoFilled.size > 0 && (
              <span className="text-xs text-violet-700 font-medium">
                ✓ {autoFilled.size} fields pre-filled
              </span>
            )}
          </div>

          {/* Extracted symptoms preview (informational — saved in notes implicitly) */}
          {parsedSymptoms.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">
                Symptoms mentioned (will be available in next assessment):
              </p>
              <div className="flex flex-wrap gap-1.5">
                {parsedSymptoms.map((s) => (
                  <Badge key={s} variant="secondary" className="text-xs bg-violet-100 text-violet-800 border-violet-200">
                    {s}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Intake form ── */}
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={<>Display name{isAuto("displayName") && <AutoBadge />}</>} hint="for coach reference; can be a pseudonym">
              <Input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Anjali R."
              />
            </Field>
            <Field label={<>Intake date{isAuto("intakeDate") && <AutoBadge />}</>}>
              <Input
                type="date"
                value={intakeDate}
                onChange={(e) => setIntakeDate(e.target.value)}
                required
              />
            </Field>
            <Field
              label={<>Date of birth *{isAuto("dateOfBirth") && <AutoBadge />}</>}
              hint="system calculates age automatically"
            >
              <Input
                type="date"
                value={dateOfBirth}
                onChange={(e) => setDateOfBirth(e.target.value)}
                required
                max={today()}
              />
            </Field>
            <Field label={<>Sex *{isAuto("sex") && <AutoBadge />}</>}>
              <select
                value={sex}
                onChange={(e) => setSex(e.target.value as "F" | "M" | "other")}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs"
                required
              >
                <option value="F">Female</option>
                <option value="M">Male</option>
                <option value="other">Other</option>
              </select>
            </Field>
            <Field
              label={<>Mobile number *{isAuto("mobileNumber") && <AutoBadge />}</>}
              hint="required — used to detect duplicates, not shared"
            >
              <Input
                type="tel"
                value={mobileNumber}
                onChange={(e) => setMobileNumber(e.target.value)}
                placeholder="+91 98765 43210"
                required
              />
            </Field>
            <Field
              label={<>Email{isAuto("email") && <AutoBadge />}</>}
              hint="for sending client letters and reports"
            >
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="anjali@example.com"
              />
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label={<>Active conditions{isAuto("conditions") && <AutoBadge />}</>} hint="one per line">
              <Textarea value={conditions} onChange={setConditions} placeholder={"hashimoto\nperimenopause"} />
            </Field>
            <Field label={<>Current medications{isAuto("medications") && <AutoBadge />}</>} hint="one per line">
              <Textarea value={medications} onChange={setMedications} placeholder="levothyroxine 75mcg" />
            </Field>
            <Field label={<>Known allergies{isAuto("allergies") && <AutoBadge />}</>} hint="one per line">
              <Textarea value={allergies} onChange={setAllergies} placeholder="sulfa" />
            </Field>
            <Field label={<>Goals{isAuto("goals") && <AutoBadge />}</>} hint="one per line">
              <Textarea value={goals} onChange={setGoals} placeholder={"reduce TPO antibodies\nsleep through the night"} />
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label={<>Notes{isAuto("notes") && <AutoBadge />}</>}>
              <Textarea value={notes} onChange={setNotes} rows={3} placeholder="anything that doesn't fit elsewhere" />
            </Field>
            <Field label="Family / hereditary history" hint="conditions running in the family — used in assessment">
              <Textarea
                value={familyHistory}
                onChange={setFamilyHistory}
                rows={3}
                placeholder={"diabetes (mother)\nheart disease (father)\nthyroid conditions (maternal side)"}
              />
            </Field>
          </div>

          {/* ── Food & lifestyle preferences (used for client meal plan letter) ── */}
          <div className="rounded-md border border-amber-200 bg-amber-50/40 p-3 space-y-3">
            <p className="text-xs font-semibold text-amber-800">🥗 Food &amp; lifestyle preferences</p>
            <p className="text-[11px] text-muted-foreground">Used when generating the personalised client plan letter with meal ideas and recipes.</p>
            <Field label="Dietary preference">
              <select
                value={dietaryPreference}
                onChange={(e) => setDietaryPreference(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">— select —</option>
                <option value="Vegetarian">Vegetarian</option>
                <option value="Vegetarian Jain">Vegetarian Jain</option>
                <option value="Eggetarian">Eggetarian (veg + eggs)</option>
                <option value="Non-vegetarian">Non-vegetarian</option>
                <option value="Vegan">Vegan</option>
                <option value="Pescatarian">Pescatarian (fish, no meat)</option>
                <option value="Other">Other (specify in notes)</option>
              </select>
            </Field>
            <Field label="Foods they will NOT eat" hint="free form — be specific">
              <Textarea
                value={foodsToAvoid}
                onChange={setFoodsToAvoid}
                rows={2}
                placeholder="e.g. brinjal, bitter gourd, raw onion, mushrooms"
              />
            </Field>
            <Field label="Non-negotiables (won't give up)" hint="incorporate these into the plan">
              <Textarea
                value={nonNegotiables}
                onChange={setNonNegotiables}
                rows={2}
                placeholder="e.g. morning chai with milk and sugar, one cup of coffee a day, rice at dinner"
              />
            </Field>
          </div>

          <p className="text-xs text-muted-foreground">
            Client ID is assigned automatically (cl-001, cl-002, …)
          </p>

          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create client"}
            </Button>
            <Button type="button" variant="outline" onClick={() => { setOpen(false); reset(); }}>
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
  label: React.ReactNode;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <div className="text-sm font-medium flex items-center flex-wrap">{label}</div>
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
