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

function AutoBadge() {
  return (
    <span className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 border border-violet-200 ml-1.5">
      ✨ transcript
    </span>
  );
}

type AutoFilled = Set<string>;

// Pillar rating selector (1–5)
function PillarRating({
  label, emoji, value, onChange, lowLabel, highLabel,
}: {
  label: string; emoji: string; value: number; onChange: (v: number) => void;
  lowLabel: string; highLabel: string;
}) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium">{emoji} {label}</div>
      <div className="flex gap-1">
        {[1,2,3,4,5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={`flex-1 py-1.5 rounded text-xs font-semibold border transition-all ${
              value === n
                ? "bg-indigo-600 text-white border-indigo-600"
                : "bg-white text-muted-foreground border-gray-200 hover:border-indigo-300"
            }`}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{lowLabel}</span><span>{highLabel}</span>
      </div>
    </div>
  );
}

// Collapsible section
function Section({
  title, emoji, defaultOpen = false, children,
}: {
  title: string; emoji: string; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold bg-gray-50 hover:bg-gray-100 transition-colors text-left"
      >
        <span>{emoji} {title}</span>
        <span className="text-muted-foreground text-xs">{open ? "▲ collapse" : "▼ expand"}</span>
      </button>
      {open && <div className="p-4 space-y-4">{children}</div>}
    </div>
  );
}

export function NewClientForm({ initialOpen = false }: { initialOpen?: boolean } = {}) {
  const router = useRouter();
  const [open, setOpen] = useState(initialOpen);
  const [pending, startTransition] = useTransition();
  const [isParsing, startParseTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  // Transcript
  const [transcriptUrl, setTranscriptUrl] = useState("");
  const [transcriptFileName, setTranscriptFileName] = useState("");
  const [autoFilled, setAutoFilled] = useState<AutoFilled>(new Set());
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsedSymptoms, setParsedSymptoms] = useState<string[]>([]);

  // ── Basic info ──
  const [displayName, setDisplayName] = useState("");
  const [intakeDate, setIntakeDate] = useState(today());
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [sex, setSex] = useState<"F" | "M" | "other">("F");
  const [mobileNumber, setMobileNumber] = useState("");
  const [email, setEmail] = useState("");

  // ── Address / location ──
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [pincode, setPincode] = useState("");
  const [country, setCountry] = useState("India");

  // ── Clinical ──
  const [conditions, setConditions] = useState("");
  const [medications, setMedications] = useState("");
  const [allergies, setAllergies] = useState("");
  const [goals, setGoals] = useState("");
  const [notes, setNotes] = useState("");
  const [familyHistory, setFamilyHistory] = useState("");

  // ── Diet & lifestyle ──
  const [dietaryPreference, setDietaryPreference] = useState("");
  const [foodsToAvoid, setFoodsToAvoid] = useState("");
  const [nonNegotiables, setNonNegotiables] = useState("");

  // ── FM Intake sections ──
  const [digestionNotes, setDigestionNotes] = useState("");
  const [sleepNotes, setSleepNotes] = useState("");
  const [energyPattern, setEnergyPattern] = useState("");
  const [menstrualNotes, setMenstrualNotes] = useState("");

  // Cycle sync (women only — gated by sex === 'F')
  const [cycleStatus, setCycleStatus] = useState<"menstruating" | "perimenopausal" | "postmenopausal" | "not_applicable" | "">("");
  const [lastMenstrualPeriod, setLastMenstrualPeriod] = useState("");
  const [cycleLengthDays, setCycleLengthDays] = useState("");
  const [cycleRegularity, setCycleRegularity] = useState<"regular" | "irregular" | "very_irregular" | "">("");
  const [menopauseStarted, setMenopauseStarted] = useState("");
  const [stressResponse, setStressResponse] = useState("");
  const [childhoodHistory, setChildhoodHistory] = useState("");
  const [toxicExposures, setToxicExposures] = useState("");
  const [whatHasWorked, setWhatHasWorked] = useState("");
  const [whatHasntWorked, setWhatHasntWorked] = useState("");

  // ── Five pillars ──
  const [sleepQuality, setSleepQuality] = useState(0);
  const [sleepHours, setSleepHours] = useState("");
  const [stressLevel, setStressLevel] = useState(0);
  const [movementDays, setMovementDays] = useState("");
  const [movementType, setMovementType] = useState("");
  const [nutritionQuality, setNutritionQuality] = useState(0);
  const [connectionQuality, setConnectionQuality] = useState(0);

  // ── Health timeline ──
  type TimelineEntry = { year: string; event: string; category: string };
  const [timelineEvents, setTimelineEvents] = useState<TimelineEntry[]>([]);
  const [newTimelineYear, setNewTimelineYear] = useState("");
  const [newTimelineEvent, setNewTimelineEvent] = useState("");
  const [newTimelineCategory, setNewTimelineCategory] = useState("life_event");

  const addTimelineEvent = () => {
    if (!newTimelineEvent.trim()) return;
    setTimelineEvents((prev) => [
      ...prev,
      { year: newTimelineYear, event: newTimelineEvent.trim(), category: newTimelineCategory },
    ]);
    setNewTimelineYear("");
    setNewTimelineEvent("");
    setNewTimelineCategory("life_event");
  };

  const removeTimelineEvent = (idx: number) => {
    setTimelineEvents((prev) => prev.filter((_, i) => i !== idx));
  };

  const reset = () => {
    setDisplayName(""); setIntakeDate(today()); setDateOfBirth(""); setSex("F");
    setMobileNumber(""); setEmail("");
    setAddressLine1(""); setAddressLine2(""); setCity(""); setState(""); setPincode(""); setCountry("India");
    setConditions(""); setMedications(""); setAllergies(""); setGoals(""); setNotes(""); setFamilyHistory("");
    setDietaryPreference(""); setFoodsToAvoid(""); setNonNegotiables("");
    setDigestionNotes(""); setSleepNotes(""); setEnergyPattern(""); setMenstrualNotes("");
    setStressResponse(""); setChildhoodHistory(""); setToxicExposures("");
    setWhatHasWorked(""); setWhatHasntWorked("");
    setSleepQuality(0); setSleepHours(""); setStressLevel(0); setMovementDays(""); setMovementType("");
    setNutritionQuality(0); setConnectionQuality(0);
    setTimelineEvents([]);
    setAutoFilled(new Set()); setParseError(null); setParsedSymptoms([]);
    setTranscriptUrl(""); setTranscriptFileName("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const splitLines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

  const applyParsed = (data: ParsedClientData) => {
    const filled = new Set<string>();
    // ── Basic info ──
    if (data.display_name) { setDisplayName(data.display_name); filled.add("displayName"); }
    if (data.date_of_birth) { setDateOfBirth(data.date_of_birth); filled.add("dateOfBirth"); }
    if (data.sex) { setSex(data.sex); filled.add("sex"); }
    if (data.mobile_number) { setMobileNumber(data.mobile_number); filled.add("mobileNumber"); }
    if (data.email) { setEmail(data.email); filled.add("email"); }
    if (data.intake_date) { setIntakeDate(data.intake_date); filled.add("intakeDate"); }
    // ── Location ──
    if (data.city) { setCity(data.city); filled.add("city"); }
    if (data.state) { setState(data.state); filled.add("state"); }
    if (data.country) { setCountry(data.country); filled.add("country"); }
    // ── Clinical ──
    if (data.active_conditions.length > 0) { setConditions(data.active_conditions.join("\n")); filled.add("conditions"); }
    if (data.current_medications.length > 0) { setMedications(data.current_medications.join("\n")); filled.add("medications"); }
    if (data.known_allergies.length > 0) { setAllergies(data.known_allergies.join("\n")); filled.add("allergies"); }
    if (data.goals.length > 0) { setGoals(data.goals.join("\n")); filled.add("goals"); }
    if (data.family_history) { setFamilyHistory(data.family_history); filled.add("familyHistory"); }
    if (data.notes) { setNotes(data.notes); filled.add("notes"); }
    if (data.key_symptoms.length > 0) { setParsedSymptoms(data.key_symptoms); }
    // ── Diet & lifestyle ──
    if (data.dietary_preference) { setDietaryPreference(data.dietary_preference); filled.add("dietaryPreference"); }
    if (data.foods_to_avoid) { setFoodsToAvoid(data.foods_to_avoid); filled.add("foodsToAvoid"); }
    if (data.non_negotiables) { setNonNegotiables(data.non_negotiables); filled.add("nonNegotiables"); }
    // ── FM Intake ──
    if (data.digestion_notes) { setDigestionNotes(data.digestion_notes); filled.add("digestionNotes"); }
    if (data.sleep_notes) { setSleepNotes(data.sleep_notes); filled.add("sleepNotes"); }
    if (data.energy_pattern) { setEnergyPattern(data.energy_pattern); filled.add("energyPattern"); }
    if (data.menstrual_notes) { setMenstrualNotes(data.menstrual_notes); filled.add("menstrualNotes"); }
    if (data.stress_response) { setStressResponse(data.stress_response); filled.add("stressResponse"); }
    if (data.childhood_history) { setChildhoodHistory(data.childhood_history); filled.add("childhoodHistory"); }
    if (data.toxic_exposures) { setToxicExposures(data.toxic_exposures); filled.add("toxicExposures"); }
    if (data.what_has_worked) { setWhatHasWorked(data.what_has_worked); filled.add("whatHasWorked"); }
    if (data.what_hasnt_worked) { setWhatHasntWorked(data.what_hasnt_worked); filled.add("whatHasntWorked"); }
    // ── Five pillars ──
    if (data.five_pillars) {
      const fp = data.five_pillars;
      if (fp.sleep_quality) { setSleepQuality(fp.sleep_quality); filled.add("sleepQuality"); }
      if (fp.sleep_hours) { setSleepHours(String(fp.sleep_hours)); filled.add("sleepHours"); }
      if (fp.stress_level) { setStressLevel(fp.stress_level); filled.add("stressLevel"); }
      if (fp.movement_days_per_week) { setMovementDays(String(fp.movement_days_per_week)); filled.add("movementDays"); }
      if (fp.movement_type) { setMovementType(fp.movement_type); filled.add("movementType"); }
      if (fp.nutrition_quality) { setNutritionQuality(fp.nutrition_quality); filled.add("nutritionQuality"); }
      if (fp.connection_quality) { setConnectionQuality(fp.connection_quality); filled.add("connectionQuality"); }
    }
    // ── Timeline events ──
    if (data.timeline_events && data.timeline_events.length > 0) {
      setTimelineEvents(data.timeline_events.map((ev) => ({
        year: ev.year ? String(ev.year) : "",
        event: ev.event,
        category: ev.category ?? "life_event",
      })));
      filled.add("timelineEvents");
    }
    // ── Fallback for missing DOB ──
    if (!data.date_of_birth && data.estimated_age) {
      const hint = `Approximate age mentioned: ${data.estimated_age} years`;
      setNotes((prev) => prev ? `${prev}\n${hint}` : hint);
      filled.add("notes");
    }
    setAutoFilled(filled);
  };

  const onParseTranscript = () => {
    const file = fileRef.current?.files?.[0];
    if (!file && !transcriptUrl.trim()) { toast.error("Upload a file or paste a URL first"); return; }
    setParseError(null);
    startParseTransition(async () => {
      const fd = new FormData();
      if (file) fd.append("file", file);
      if (transcriptUrl.trim()) fd.append("url", transcriptUrl.trim());
      const res = await parseTranscriptForClient(fd);
      if (!res.ok) { setParseError(res.error); toast.error(`Parse failed: ${res.error}`); return; }
      applyParsed(res.data);
      toast.success(`Pre-filled ${res.data.fields_found} field${res.data.fields_found !== 1 ? "s" : ""} from transcript`);
    });
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!mobileNumber.trim()) { toast.error("Mobile number is required"); return; }
    if (!dateOfBirth) { toast.error("Date of birth is required"); return; }

    // Build five pillars if any rated
    const anyPillar = sleepQuality || stressLevel || nutritionQuality || connectionQuality;
    const fivePillars = anyPillar ? {
      sleep_quality: sleepQuality || undefined,
      sleep_hours: sleepHours ? parseFloat(sleepHours) : undefined,
      stress_level: stressLevel || undefined,
      movement_days_per_week: movementDays ? parseInt(movementDays) : undefined,
      movement_type: movementType || undefined,
      nutrition_quality: nutritionQuality || undefined,
      connection_quality: connectionQuality || undefined,
    } : undefined;

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
        // Address
        address_line1: addressLine1.trim() || undefined,
        address_line2: addressLine2.trim() || undefined,
        city: city.trim() || undefined,
        state: state.trim() || undefined,
        pincode: pincode.trim() || undefined,
        country: country.trim() || undefined,
        // FM intake
        digestion_notes: digestionNotes.trim() || undefined,
        sleep_notes: sleepNotes.trim() || undefined,
        energy_pattern: energyPattern.trim() || undefined,
        menstrual_notes: sex === "F" ? (menstrualNotes.trim() || undefined) : undefined,

        // Cycle sync (women only — backend ignores when sex !== F)
        cycle_status: sex === "F" ? (cycleStatus || undefined) : undefined,
        last_menstrual_period: sex === "F" && lastMenstrualPeriod ? lastMenstrualPeriod : undefined,
        cycle_length_days: sex === "F" && cycleLengthDays
          ? parseInt(cycleLengthDays, 10) || undefined
          : undefined,
        cycle_regularity: sex === "F" ? (cycleRegularity || undefined) : undefined,
        menopause_started: sex === "F" && menopauseStarted ? menopauseStarted : undefined,
        stress_response: stressResponse.trim() || undefined,
        childhood_history: childhoodHistory.trim() || undefined,
        toxic_exposures: toxicExposures.trim() || undefined,
        what_has_worked: whatHasWorked.trim() || undefined,
        what_hasnt_worked: whatHasntWorked.trim() || undefined,
        // Five pillars
        five_pillars: fivePillars,
        // Timeline
        timeline_events: timelineEvents.length > 0
          ? timelineEvents.map((ev) => ({
              year: ev.year ? parseInt(ev.year, 10) : undefined,
              event: ev.event,
              category: ev.category || undefined,
            }))
          : undefined,
      });
      if (res.ok) {
        toast.success(`Created ${res.client_id}`);
        reset();
        setOpen(false);
        router.push(`/clients-v2/${res.client_id}`);
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
        <CardTitle>New client intake</CardTitle>
        <Button variant="ghost" size="sm" onClick={() => { setOpen(false); reset(); }}>Cancel</Button>
      </CardHeader>
      <CardContent className="space-y-6">

        {/* ── Transcript import ── */}
        <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-lg">📋</span>
            <div>
              <div className="font-medium text-sm">Pre-fill from consultation transcript</div>
              <div className="text-xs text-muted-foreground">
                Upload a recording transcript or paste a link. Form fields will be auto-populated — review and fill gaps.
              </div>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr]">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Upload file (.txt, .md or .pdf)</label>
              <input ref={fileRef} type="file" accept=".txt,.pdf,.md,text/plain,application/pdf,text/markdown"
                onChange={(e) => { setTranscriptFileName(e.target.files?.[0]?.name ?? ""); setTranscriptUrl(""); }}
                className="block w-full text-sm text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:font-medium file:bg-violet-100 file:text-violet-700 hover:file:bg-violet-200 cursor-pointer" />
              {transcriptFileName && <p className="text-xs text-violet-700">📄 {transcriptFileName}</p>}
            </div>
            <div className="flex items-center justify-center text-xs text-muted-foreground font-medium">OR</div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Paste a link</label>
              <Input type="url" placeholder="https://docs.google.com/document/d/…" value={transcriptUrl}
                onChange={(e) => { setTranscriptUrl(e.target.value); if (e.target.value && fileRef.current) { fileRef.current.value = ""; setTranscriptFileName(""); } }} className="text-sm" />
            </div>
          </div>
          {parseError && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{parseError}</p>}
          <div className="flex items-center gap-3">
            <Button type="button" onClick={onParseTranscript}
              disabled={isParsing || (!transcriptUrl.trim() && !transcriptFileName)}
              variant="outline" className="border-violet-300 text-violet-800 hover:bg-violet-100">
              {isParsing ? "Parsing…" : "✨ Parse transcript"}
            </Button>
            {autoFilled.size > 0 && <span className="text-xs text-violet-700 font-medium">✓ {autoFilled.size} fields pre-filled</span>}
          </div>
          {parsedSymptoms.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">Symptoms mentioned:</p>
              <div className="flex flex-wrap gap-1.5">
                {parsedSymptoms.map((s) => (
                  <Badge key={s} variant="secondary" className="text-xs bg-violet-100 text-violet-800 border-violet-200">{s}</Badge>
                ))}
              </div>
            </div>
          )}
        </div>

        <form onSubmit={onSubmit} className="space-y-6">

          {/* ── Section 1: Basic info ── */}
          <Section title="Basic information" emoji="👤" defaultOpen>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={<>Display name{isAuto("displayName") && <AutoBadge />}</>} hint="for coach reference; can be a pseudonym">
                <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Anjali R." />
              </Field>
              <Field label={<>Intake date{isAuto("intakeDate") && <AutoBadge />}</>}>
                <Input type="date" value={intakeDate} onChange={(e) => setIntakeDate(e.target.value)} required />
              </Field>
              <Field label={<>Date of birth *{isAuto("dateOfBirth") && <AutoBadge />}</>} hint="age calculated automatically">
                <Input type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} required max={today()} />
              </Field>
              <Field label={<>Sex *{isAuto("sex") && <AutoBadge />}</>}>
                <select value={sex} onChange={(e) => setSex(e.target.value as "F" | "M" | "other")}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs" required>
                  <option value="F">Female</option>
                  <option value="M">Male</option>
                  <option value="other">Other</option>
                </select>
              </Field>
              <Field label={<>Mobile number *{isAuto("mobileNumber") && <AutoBadge />}</>} hint="required — duplicate check">
                <Input type="tel" value={mobileNumber} onChange={(e) => setMobileNumber(e.target.value)} placeholder="+91 98765 43210" required />
              </Field>
              <Field label={<>Email{isAuto("email") && <AutoBadge />}</>} hint="for sending client letters">
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="anjali@example.com" />
              </Field>
            </div>
          </Section>

          {/* ── Section 2: Address / location ── */}
          <Section title="Address & location" emoji="📍">
            <p className="text-xs text-muted-foreground -mt-2">Used for regional meal planning, seasonal produce, and CRM.</p>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Address line 1" hint="street / building / area">
                <Input value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} placeholder="14 Sundar Nagar, Sector 7" />
              </Field>
              <Field label="Address line 2" hint="apartment, landmark, wing">
                <Input value={addressLine2} onChange={(e) => setAddressLine2(e.target.value)} placeholder="B Wing, Flat 402" />
              </Field>
              <Field label="City">
                <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Mumbai" />
              </Field>
              <Field label="State / Province">
                <Input value={state} onChange={(e) => setState(e.target.value)} placeholder="Maharashtra" />
              </Field>
              <Field label="Pincode / ZIP">
                <Input value={pincode} onChange={(e) => setPincode(e.target.value)} placeholder="400001" />
              </Field>
              <Field label="Country">
                <Input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="India" />
              </Field>
            </div>
          </Section>

          {/* ── Section 3: Clinical picture ── */}
          <Section title="Clinical picture" emoji="🩺" defaultOpen>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={<>Active conditions{isAuto("conditions") && <AutoBadge />}</>} hint="one per line">
                <Textarea value={conditions} onChange={setConditions} placeholder={"hashimoto's\npcos\nprediabetes"} />
              </Field>
              <Field label={<>Current medications{isAuto("medications") && <AutoBadge />}</>} hint="one per line, with dose">
                <Textarea value={medications} onChange={setMedications} placeholder="levothyroxine 75mcg\nmetformin 500mg" />
              </Field>
              <Field label={<>Known allergies{isAuto("allergies") && <AutoBadge />}</>} hint="one per line">
                <Textarea value={allergies} onChange={setAllergies} placeholder="sulfa\npenicillin" />
              </Field>
              <Field label={<>Client goals{isAuto("goals") && <AutoBadge />}</>} hint="one per line — in their words">
                <Textarea value={goals} onChange={setGoals} placeholder={"lose weight\nmore energy\nfix hormones"} />
              </Field>
              <Field label={<>Coach notes{isAuto("notes") && <AutoBadge />}</>}>
                <Textarea value={notes} onChange={setNotes} rows={3} placeholder="anything that doesn't fit elsewhere" />
              </Field>
              <Field label="Family / hereditary history" hint="conditions in the family — used in AI assessment">
                <Textarea value={familyHistory} onChange={setFamilyHistory} rows={3}
                  placeholder={"diabetes (mother)\nheart disease (father)\nthyroid (maternal side)"} />
              </Field>
            </div>
          </Section>

          {/* ── Section 4: Health timeline ── */}
          <Section title="Health timeline" emoji="📅">
            <p className="text-xs text-muted-foreground -mt-2">
              When did things start? What was happening in their life? This is often where the root cause becomes obvious.
            </p>
            <div className="space-y-3">
              {timelineEvents.length > 0 && (
                <div className="space-y-2">
                  {timelineEvents.map((ev, i) => (
                    <div key={i} className="flex items-start gap-2 bg-gray-50 rounded-lg px-3 py-2">
                      <span className="text-xs font-mono text-muted-foreground shrink-0 mt-0.5 w-12">{ev.year || "—"}</span>
                      <span className="text-xs flex-1">{ev.event}</span>
                      <Badge variant="outline" className="text-[10px] shrink-0">{ev.category.replace(/_/g, " ")}</Badge>
                      <button type="button" onClick={() => removeTimelineEvent(i)} className="text-xs text-red-400 hover:text-red-600 shrink-0">✕</button>
                    </div>
                  ))}
                </div>
              )}
              <div className="grid gap-2 sm:grid-cols-[80px_1fr_140px_auto] items-end">
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">Year</label>
                  <Input value={newTimelineYear} onChange={(e) => setNewTimelineYear(e.target.value)} placeholder="2020" className="text-sm" />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">Event</label>
                  <Input value={newTimelineEvent} onChange={(e) => setNewTimelineEvent(e.target.value)}
                    placeholder="Major work stress began, divorce, started new medication…" className="text-sm" />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">Category</label>
                  <select value={newTimelineCategory} onChange={(e) => setNewTimelineCategory(e.target.value)}
                    className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm">
                    <option value="life_event">Life event</option>
                    <option value="symptom_onset">Symptom onset</option>
                    <option value="diagnosis">Diagnosis</option>
                    <option value="stress">Stress / trauma</option>
                    <option value="treatment">Treatment tried</option>
                    <option value="recovery">Recovery / improvement</option>
                    <option value="surgery">Surgery / procedure</option>
                    <option value="medication_change">Medication change</option>
                  </select>
                </div>
                <Button type="button" onClick={addTimelineEvent} disabled={!newTimelineEvent.trim()} variant="outline" size="sm">
                  + Add
                </Button>
              </div>
            </div>
          </Section>

          {/* ── Section 5: Five Pillars baseline ── */}
          <Section title="Five pillars baseline" emoji="🏛️">
            <p className="text-xs text-muted-foreground -mt-2">
              Quick assessment of the foundations. Rate 1 (poor) to 5 (excellent). These inform the AI about where to focus first.
            </p>
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <PillarRating label="Sleep quality" emoji="😴" value={sleepQuality} onChange={setSleepQuality} lowLabel="Very poor" highLabel="Excellent" />
                <Field label="Hours per night (average)">
                  <Input type="number" min="0" max="12" step="0.5" value={sleepHours} onChange={(e) => setSleepHours(e.target.value)} placeholder="e.g. 6.5" className="text-sm" />
                </Field>
              </div>
              <PillarRating label="Stress level" emoji="🧠" value={stressLevel} onChange={setStressLevel} lowLabel="Very low" highLabel="Extreme" />
              <div className="space-y-2">
                <Field label="Movement — days per week">
                  <Input type="number" min="0" max="7" value={movementDays} onChange={(e) => setMovementDays(e.target.value)} placeholder="e.g. 3" className="text-sm" />
                </Field>
                <Field label="Type of movement">
                  <Input value={movementType} onChange={(e) => setMovementType(e.target.value)} placeholder="walking, gym, yoga, sedentary…" className="text-sm" />
                </Field>
              </div>
              <PillarRating label="Nutrition quality (current)" emoji="🥗" value={nutritionQuality} onChange={setNutritionQuality} lowLabel="Very poor" highLabel="Excellent" />
              <PillarRating label="Relationships / connection / purpose" emoji="🤝" value={connectionQuality} onChange={setConnectionQuality} lowLabel="Isolated / lost" highLabel="Strong & purposeful" />
            </div>
          </Section>

          {/* ── Section 6: FM Intake — deeper clinical picture ── */}
          <Section title="Deep FM intake" emoji="🔬">
            <p className="text-xs text-muted-foreground -mt-2">
              These go beyond conditions to capture the context the AI needs for root-cause reasoning. Fill what you know — all fields optional.
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Digestion" hint="bowel frequency, consistency, bloating (when?), reflux, burping">
                <Textarea value={digestionNotes} onChange={setDigestionNotes} rows={3}
                  placeholder={"Once a day, loose. Bloating after lunch, not dinner. No reflux. Occasional burping."} />
              </Field>
              <Field label="Sleep patterns" hint="timing, night waking (what time?), dream recall, morning energy">
                <Textarea value={sleepNotes} onChange={setSleepNotes} rows={3}
                  placeholder={"In bed 11pm, asleep by midnight. Wakes 3-4am, can't fall back. Groggy until 10am."} />
              </Field>
              <Field label="Energy pattern" hint="morning vs afternoon vs evening; crashes; second wind at night?">
                <Textarea value={energyPattern} onChange={setEnergyPattern} rows={3}
                  placeholder={"Low in morning, crashes hard at 3pm, then gets a second wind at 10pm. Can't get up."} />
              </Field>
              {sex === "F" && (
                <Field label="Menstrual cycle" hint="cycle length, PMS symptoms + timing, pain, flow, mood shifts">
                  <Textarea value={menstrualNotes} onChange={setMenstrualNotes} rows={3}
                    placeholder={"28-day cycle. PMS week before: irritable, bloated, crave sugar. Day 1-2 heavy with cramps."} />
                </Field>
              )}
              {sex === "F" && (
                <div className="rounded-lg border border-rose-200 bg-rose-50/40 p-3 space-y-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-rose-800">
                    🌙 Cycle sync — drives phase-synced meal & exercise plans
                  </div>
                  <Field label="Cycle status" hint="determines whether the plan generator phase-syncs nutrition + movement">
                    <select
                      value={cycleStatus}
                      onChange={(e) => setCycleStatus(e.target.value as typeof cycleStatus)}
                      className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                    >
                      <option value="">(not specified)</option>
                      <option value="menstruating">Menstruating — regular or irregular cycles</option>
                      <option value="perimenopausal">Perimenopausal — cycles getting irregular / hot flashes / etc.</option>
                      <option value="postmenopausal">Postmenopausal — 12+ months without a period</option>
                      <option value="not_applicable">Not applicable / prefer not to say</option>
                    </select>
                  </Field>
                  {(cycleStatus === "menstruating" || cycleStatus === "perimenopausal") && (
                    <>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Field label="Last menstrual period (LMP)" hint="day 1 of most recent cycle">
                          <Input type="date" value={lastMenstrualPeriod} onChange={(e) => setLastMenstrualPeriod(e.target.value)} className="text-sm" />
                        </Field>
                        <Field label="Cycle length (days)" hint="default 28 — count from day 1 to next day 1">
                          <Input type="number" min="20" max="60" value={cycleLengthDays} onChange={(e) => setCycleLengthDays(e.target.value)} placeholder="28" className="text-sm" />
                        </Field>
                      </div>
                      <Field label="Cycle regularity">
                        <select
                          value={cycleRegularity}
                          onChange={(e) => setCycleRegularity(e.target.value as typeof cycleRegularity)}
                          className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                        >
                          <option value="">(not specified)</option>
                          <option value="regular">Regular (within 2 days each cycle)</option>
                          <option value="irregular">Irregular (varies by 3-7 days)</option>
                          <option value="very_irregular">Very irregular (varies by &gt;7 days, sometimes skipped)</option>
                        </select>
                      </Field>
                    </>
                  )}
                  {cycleStatus === "postmenopausal" && (
                    <Field label="Menopause started" hint="approximate date of last period — used to track years post-meno">
                      <Input type="date" value={menopauseStarted} onChange={(e) => setMenopauseStarted(e.target.value)} className="text-sm" />
                    </Field>
                  )}
                </div>
              )}
              <Field label="Stress response" hint="fight/flight (anxious, wired, can't sleep) vs freeze (exhausted, numb, can't function)">
                <Textarea value={stressResponse} onChange={setStressResponse} rows={2}
                  placeholder={"Goes into freeze — shuts down, can't make decisions, very exhausted. Used to be anxious type."} />
              </Field>
              <Field label="Childhood history" hint="antibiotic use, gut infections, trauma, chronic childhood illness">
                <Textarea value={childhoodHistory} onChange={setChildhoodHistory} rows={2}
                  placeholder={"Multiple courses of antibiotics age 8-12. Parents divorced age 10. Tonsils removed age 6."} />
              </Field>
              <Field label="Toxic exposures" hint="mold, heavy metals, chemical exposures, long-term medication use">
                <Textarea value={toxicExposures} onChange={setToxicExposures} rows={2}
                  placeholder={"Lived in damp flat for 3 years (possible mold). OCP for 8 years."} />
              </Field>
              <Field label="What has worked" hint="past interventions — diet, supplements, lifestyle — that actually helped">
                <Textarea value={whatHasWorked} onChange={setWhatHasWorked} rows={2}
                  placeholder={"Cutting sugar helped mood. Walking 30 mins daily gave her more energy."} />
              </Field>
              <Field label="What hasn't worked" hint="things tried that made no difference or made things worse">
                <Textarea value={whatHasntWorked} onChange={setWhatHasntWorked} rows={2}
                  placeholder={"Metformin made her feel sick. High-intensity exercise worsened fatigue."} />
              </Field>
            </div>
          </Section>

          {/* ── Section 7: Food & lifestyle preferences ── */}
          <Section title="Food & lifestyle preferences" emoji="🥗" defaultOpen>
            <p className="text-xs text-muted-foreground -mt-2">Used when generating the personalised meal plan and supplement letter.</p>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Dietary preference">
                <select value={dietaryPreference} onChange={(e) => setDietaryPreference(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
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
              <div /> {/* spacer */}
              <Field label="Foods they will NOT eat" hint="be specific — used to filter meal plan">
                <Textarea value={foodsToAvoid} onChange={setFoodsToAvoid} rows={2} placeholder="brinjal, bitter gourd, raw onion, mushrooms" />
              </Field>
              <Field label="Non-negotiables (won't give up)" hint="incorporate these into the plan">
                <Textarea value={nonNegotiables} onChange={setNonNegotiables} rows={2} placeholder="morning chai with milk and sugar, rice at dinner" />
              </Field>
            </div>
          </Section>

          <p className="text-xs text-muted-foreground">Client ID is assigned automatically (cl-001, cl-002, …)</p>

          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create client"}</Button>
            <Button type="button" variant="outline" onClick={() => { setOpen(false); reset(); }}>Cancel</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function Field({ label, hint, children }: { label: React.ReactNode; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <div className="text-sm font-medium flex items-center flex-wrap">{label}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      {children}
    </label>
  );
}

function Textarea({ value, onChange, rows = 2, placeholder }: {
  value: string; onChange: (v: string) => void; rows?: number; placeholder?: string;
}) {
  return (
    <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={rows} placeholder={placeholder}
      className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs" />
  );
}
