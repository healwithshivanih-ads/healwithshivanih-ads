"use client";

/**
 * IntakeForm v2 — full FM-style intake.
 *
 * Captures the structured surfaces a real FM intake call covers:
 *
 *   1. Presenting picture — chief complaint, HPI, transcript paste
 *   2. Body composition baseline (height/weight/BMI/waist/hip/BP/HR)
 *   3. Food & lifestyle preferences (dietary preference, foods to avoid,
 *      allergies, non-negotiables, reported triggers)
 *   4. Current medications + Family history (2-col)
 *   5. Five Pillars baseline (sleep/stress/movement/nutrition/connection)
 *   6. Supplement history · what's worked · what hasn't
 *   7. Client FM timeline (chronological life events)
 *   8. 7 IFM nodes coach assessment (gut/immune/energy/detox/transport/
 *      communication/structural — score 1–5 each)
 *   9. Lab reports upload (PDF/image; uses LabUploadPanel)
 *  10. Special FM reports upload (DUTCH/GI-MAP/genetic; uses
 *      FunctionalTestPanel + GeneticReportPanel)
 *  11. Coach notes
 *
 * On save we fan out into:
 *  - saveSessionAction (session record + Five Pillars)
 *  - applyTranscriptDataAction (body comp → client.measurements +
 *    appends to health_snapshots)
 *  - updateClientPreferences (dietary preference + foods_to_avoid +
 *    non_negotiables + reported_triggers)
 *  - updateClientTimeline (timeline_events)
 *
 * Lab + special-report uploads save inline through their own panel
 * components — they don't wait for the form save.
 */
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  saveSessionAction,
  applyTranscriptDataAction,
  parseHealthTextAction,
  extractTranscriptAction,
  uploadFileAction,
  type FivePillarsData,
} from "@/lib/server-actions/assess";
/** Inline shape mirroring ExtractedHealthData from lib/fmdb/anthropic.ts
 *  (which is "use server" — types from there don't cross the boundary
 *  cleanly into this client component). */
interface ExtractedHealthData {
  lab_values: Array<{ test_name: string; value: string; unit: string; date_drawn?: string | null }>;
  measurements: {
    height_cm?: number | null;
    weight_kg?: number | null;
    bp_systolic?: number | null;
    bp_diastolic?: number | null;
    hr_bpm?: number | null;
    waist_cm?: number | null;
    hip_cm?: number | null;
  };
  medications: string[];
  conditions: string[];
}
import {
  updateClientPreferences,
  updateClientTimeline,
  updateClientProfile,
  uploadReportAction,
  checkMedsAgainstCatalogueAction,
} from "@/lib/server-actions/clients";
import {
  FmField,
  FmInput,
  FmTextarea,
  FmFormSection,
  FmSymptomPicker,
  FmFormDraftClear,
  type FmSymptomOption,
} from "@/components/fm";
import { useFormDraft } from "@/lib/fmdb/use-form-draft";
import { IFM_NODES, computeIFMMatrix, type IFMNodeId } from "@/lib/fmdb/ifm-matrix";
import { LabUploadPanel } from "@/components/client-widgets/lab-upload-panel";
import { FunctionalTestPanel } from "@/components/client-widgets/functional-test-panel";
import { GeneticReportPanel } from "@/components/client-widgets/genetic-report-panel";
import { VerifyChecklist, useVerifyChecklist } from "./verify-checklist";

const PRIMARY = "#3a4250";

interface TimelineEntry {
  year: string;
  category: string;
  event: string;
}

// Canonical timeline-category vocabulary. `value` is the snake_case enum
// the client intake form + AI extraction actually store; `label` is the
// human text. The old list used Title-Case strings as BOTH value and
// label, so a <select> bound to a stored value like "life_event" matched
// no option and rendered blank "Category" — the AI *was* categorising,
// the form just couldn't display it. Superset of the client-form list +
// the extra values the extraction emits (childhood / other).
const TIMELINE_CATEGORIES: Array<{ value: string; label: string }> = [
  { value: "childhood", label: "Childhood" },
  { value: "life_event", label: "Life event / stress" },
  { value: "symptom_onset", label: "Symptom started" },
  { value: "diagnosis", label: "Diagnosis" },
  { value: "medication_change", label: "Medication change" },
  { value: "treatment", label: "Treatment" },
  { value: "surgery", label: "Surgery" },
  { value: "pregnancy", label: "Pregnancy" },
  { value: "stress", label: "Stress" },
  { value: "recovery", label: "Recovery" },
  { value: "other", label: "Other" },
];

interface FmIntakeFields {
  digestion_notes: string;
  sleep_notes: string;
  energy_pattern: string;
  menstrual_notes: string;
  stress_response: string;
  childhood_history: string;
  toxic_exposures: string;
}

interface CycleContext {
  cycle_status: string | null;
  last_menstrual_period: string;
  cycle_length_days: number | null;
  cycle_regularity: string | null;
  menopause_started: string;
}

interface PregnancyContext {
  pregnancy_status: string | null;
  pregnancy_due_date: string;
  lactation_started: string;
}

interface ExistingMeasurements {
  height_cm: string;
  weight_kg: string;
  waist_cm: string;
  hip_cm: string;
  bp_systolic: string;
  bp_diastolic: string;
  hr_bpm: string;
}

interface ExistingPrefs {
  dietary_preference: string;
  foods_to_avoid: string;
  non_negotiables: string;
  reported_triggers: string;
}

interface ExistingTimelineRow {
  year: string;
  category: string;
  event: string;
}

export type DiscoveryContext = {
  date: string;
  chief_concern: string;
  coach_notes: string;
  requested_labs: string[];
} | null;

export function IntakeForm({
  clientId,
  displayName,
  clientSex,
  symptomCatalogue,
  discoveryContext,
  existingConditions,
  existingAllergies,
  existingGoals,
  existingMedicalHistory,
  existingFm,
  existingCycle,
  existingPregnancy,
  existingMeasurements,
  existingMedications,
  existingFamilyHistory,
  existingPrefs,
  existingTimeline,
  existingWhatWorked,
  existingWhatDidntWork,
  existingNotes,
  verifyInSession,
  insightsModelLabel,
}: {
  clientId: string;
  displayName: string;
  clientSex?: "F" | "M" | null;
  symptomCatalogue: FmSymptomOption[];
  discoveryContext: DiscoveryContext;
  existingConditions: string[];
  existingAllergies: string[];
  existingGoals: string[];
  existingMedicalHistory: string[];
  existingFm: FmIntakeFields;
  existingCycle: CycleContext;
  existingPregnancy: PregnancyContext;
  existingMeasurements: ExistingMeasurements;
  existingMedications: string;
  existingFamilyHistory: string;
  existingPrefs: ExistingPrefs;
  existingTimeline: ExistingTimelineRow[];
  existingWhatWorked: string;
  existingWhatDidntWork: string;
  existingNotes: string;
  // v0.72: AI-generated questions to ask in person, sourced from
  // Client.intake_insights.verify_in_session. Empty array when no
  // insights have been generated yet (or the client hasn't submitted
  // intake). Rendered in a sticky sidebar by VerifyChecklist; Q+A
  // responses are auto-appended to session.coach_notes on save.
  verifyInSession: string[];
  insightsModelLabel?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  // v0.72: AI-generated questions to ask in this session. Sticky sidebar
  // panel + Q+A responses get appended to session.coach_notes on save.
  // See verify-checklist.tsx for the component + hook.
  const verifyState = useVerifyChecklist(verifyInSession);

  // 0 · Catalogue picks
  const [sessionDate, setSessionDate] = useState(
    () => new Date().toISOString().slice(0, 10),
  );
  const [symptoms, setSymptoms] = useState<string[]>([]);
  const [conditions, setConditions] = useState<string[]>(existingConditions);
  const [allergiesArr, setAllergiesArr] = useState<string[]>(existingAllergies);
  const [goals, setGoals] = useState<string[]>(existingGoals);
  const [medicalHistory, setMedicalHistory] = useState<string[]>(existingMedicalHistory);
  const [goalDraft, setGoalDraft] = useState("");
  const [mhDraft, setMhDraft] = useState("");
  const addGoal = (v: string) => {
    const t = v.trim();
    if (!t || goals.includes(t)) return;
    setGoals((c) => [...c, t]);
    setGoalDraft("");
  };
  const addMh = (v: string) => {
    const t = v.trim();
    if (!t || medicalHistory.includes(t)) return;
    setMedicalHistory((c) => [...c, t]);
    setMhDraft("");
  };

  // FM body-systems review — preload existing
  const [digestionNotes, setDigestionNotes] = useState(existingFm.digestion_notes);
  const [sleepNotes, setSleepNotes] = useState(existingFm.sleep_notes);
  const [energyPattern, setEnergyPattern] = useState(existingFm.energy_pattern);
  const [menstrualNotes, setMenstrualNotes] = useState(existingFm.menstrual_notes);
  const [stressResponse, setStressResponse] = useState(existingFm.stress_response);
  const [childhoodHistory, setChildhoodHistory] = useState(existingFm.childhood_history);
  const [toxicExposures, setToxicExposures] = useState(existingFm.toxic_exposures);

  // Cycle (women)
  const [cycleStatus, setCycleStatus] = useState<string>(existingCycle.cycle_status ?? "");
  const [lmp, setLmp] = useState(existingCycle.last_menstrual_period);
  const [cycleLen, setCycleLen] = useState(
    existingCycle.cycle_length_days ? String(existingCycle.cycle_length_days) : "",
  );
  const [cycleReg, setCycleReg] = useState<string>(existingCycle.cycle_regularity ?? "");
  const [menopauseStarted, setMenopauseStarted] = useState(existingCycle.menopause_started);

  // Pregnancy / lactation
  const [pregnancyStatus, setPregnancyStatus] = useState<string>(
    existingPregnancy.pregnancy_status ?? "",
  );
  const [pregnancyDueDate, setPregnancyDueDate] = useState(existingPregnancy.pregnancy_due_date);
  const [lactationStarted, setLactationStarted] = useState(existingPregnancy.lactation_started);

  // Inline medication depletion preview (fires on debounced medications change)
  const [depletionMatches, setDepletionMatches] = useState<
    Array<{ drug_name: string; depletes: Array<{ nutrient: string; severity?: string }> }>
  >([]);

  // Helpers to manage simple text-chip arrays (conditions, allergies)
  const [conditionDraft, setConditionDraft] = useState("");
  const [allergyDraft, setAllergyDraft] = useState("");
  const addCondition = (v: string) => {
    const t = v.trim();
    if (!t || conditions.includes(t)) return;
    setConditions((c) => [...c, t]);
    setConditionDraft("");
  };
  const addAllergy = (v: string) => {
    const t = v.trim();
    if (!t || allergiesArr.includes(t)) return;
    setAllergiesArr((c) => [...c, t]);
    setAllergyDraft("");
  };

  // 9b · Food journal upload state
  const [foodJournalFiles, setFoodJournalFiles] = useState<string[]>([]);
  const [foodJournalUploading, setFoodJournalUploading] = useState(false);

  // 9c · Manual health-data paste state
  const [healthText, setHealthText] = useState("");
  const [healthExtracted, setHealthExtracted] = useState<ExtractedHealthData | null>(null);
  const [healthParsing, setHealthParsing] = useState(false);

  // 1 · Presenting picture
  // Chief complaint pre-fills from the most recent discovery session so
  // the coach doesn't re-type what was captured 15 minutes ago. Coach
  // can still edit freely; the "✨ Pre-filled" badge in the section
  // header tells her it came from discovery (vs typed fresh).
  const discoveryChiefConcernSeed = discoveryContext?.chief_concern ?? "";
  const [chiefComplaint, setChiefComplaint] = useState(
    discoveryChiefConcernSeed,
  );
  const chiefComplaintFromDiscovery =
    discoveryChiefConcernSeed.length > 0 &&
    chiefComplaint === discoveryChiefConcernSeed;
  const [hpi, setHpi] = useState("");
  // Seed transcript notes with discovery-call context so the AI synthesis
  // pass has the chief concern + labs requested before this intake.
  const [transcriptNotes, setTranscriptNotes] = useState(() => {
    if (!discoveryContext) return "";
    const lines = [
      `[Discovery call · ${discoveryContext.date || "earlier"}]`,
      discoveryContext.chief_concern
        ? `Chief concern: ${discoveryContext.chief_concern}`
        : "",
      discoveryContext.requested_labs.length > 0
        ? `Labs ordered: ${discoveryContext.requested_labs.join(", ")}`
        : "",
    ].filter(Boolean);
    return lines.join("\n");
  });

  // 2 · Body composition baseline — pre-filled from client.measurements +
  //     latest health_snapshot (snapshot wins per-field when present).
  const [height, setHeight] = useState(existingMeasurements.height_cm);
  const [weight, setWeight] = useState(existingMeasurements.weight_kg);
  const [bodyFat, setBodyFat] = useState(""); // captured as note, not part of measurements model yet
  const [waist, setWaist] = useState(existingMeasurements.waist_cm);
  const [hip, setHip] = useState(existingMeasurements.hip_cm);
  const [bpSys, setBpSys] = useState(existingMeasurements.bp_systolic);
  const [bpDia, setBpDia] = useState(existingMeasurements.bp_diastolic);
  const [hr, setHr] = useState(existingMeasurements.hr_bpm);

  // 3 · Food & lifestyle — pre-filled from client.yaml
  const [dietaryPreference, setDietaryPreference] = useState(existingPrefs.dietary_preference);
  const [foodsToAvoid, setFoodsToAvoid] = useState(existingPrefs.foods_to_avoid);
  const [nonNegotiables, setNonNegotiables] = useState(existingPrefs.non_negotiables);
  const [reportedTriggers, setReportedTriggers] = useState(existingPrefs.reported_triggers);

  // 4 · Meds + family hx — pre-filled
  const [medications, setMedications] = useState(existingMedications);
  const [familyHx, setFamilyHx] = useState(existingFamilyHistory);

  // Debounced depletion check — fires 600 ms after coach stops typing
  // medications. Catches metformin → B12, PPIs → Mg / B12, OCPs → folate
  // / B6, levothyroxine ↔ Ca/Fe timing, etc.
  useEffect(() => {
    const lines = medications
      .split("\n")
      .map((l) => l.split("·")[0].trim()) // drop dose/timing tail
      .filter(Boolean);
    if (lines.length === 0) {
      setDepletionMatches([]);
      return;
    }
    const t = setTimeout(async () => {
      const r = await checkMedsAgainstCatalogueAction(lines);
      if (r.ok) {
        setDepletionMatches(
          r.matches.map((m) => ({
            drug_name: m.drug_name,
            depletes: m.depletes.map((d) => ({
              nutrient: d.nutrient,
              severity: d.severity,
            })),
          })),
        );
      }
    }, 600);
    return () => clearTimeout(t);
  }, [medications]);

  // 5 · Five Pillars
  const [sleep, setSleep] = useState("");
  const [stress, setStress] = useState("");
  const [movement, setMovement] = useState("");
  const [nutrition, setNutrition] = useState("");
  const [connection, setConnection] = useState("");

  // 6 · Trial-and-error
  // Supplement-history textarea is session-scoped (different supplements
  // come up between visits) — left empty. "What worked / didn't" lives
  // on client.yaml so we pre-fill from there.
  const [supplementHx, setSupplementHx] = useState("");
  const [whatWorked, setWhatWorked] = useState(existingWhatWorked);
  const [whatDidntWork, setWhatDidntWork] = useState(existingWhatDidntWork);
  // `notes` on client.yaml is rendered into the Coach notes textarea
  // (initialised at coachNotes useState below).

  // 7 · FM timeline — seed with saved events, else a blank row
  const [timeline, setTimeline] = useState<TimelineEntry[]>(
    existingTimeline.length > 0
      ? existingTimeline.map((r) => ({ year: r.year, category: r.category, event: r.event }))
      : [{ year: "", category: "", event: "" }],
  );
  const addTimelineRow = () =>
    setTimeline((t) => [...t, { year: "", category: "", event: "" }]);
  const updateTimelineRow = (i: number, patch: Partial<TimelineEntry>) =>
    setTimeline((t) => t.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  const removeTimelineRow = (i: number) =>
    setTimeline((t) => t.filter((_, idx) => idx !== i));

  // 8 · IFM 7 nodes baseline scores 1–5
  const [ifmScores, setIfmScores] = useState<Record<string, number>>({});
  const [ifmNotes, setIfmNotes] = useState<Record<string, string>>({});

  // 11 · Coach notes
  const [coachNotes, setCoachNotes] = useState(existingNotes);

  // ── Draft persistence ──────────────────────────────────────────────
  // Snapshots every text/number/array form field to localStorage on every
  // change. Per-client key so each client's intake has its own draft.
  // Survives 404s, refreshes, tab closes, browser crashes. Cleared on
  // successful save.
  const { clearDraft, hasSavedDraft } = useFormDraft(
    `fm-intake-draft-${clientId}`,
    {
      symptoms, conditions, allergiesArr, goals, medicalHistory,
      digestionNotes, sleepNotes, energyPattern, menstrualNotes,
      stressResponse, childhoodHistory, toxicExposures,
      cycleStatus, lmp, cycleLen, cycleReg, menopauseStarted,
      pregnancyStatus, pregnancyDueDate, lactationStarted,
      chiefComplaint, hpi, transcriptNotes,
      height, weight, bodyFat, waist, hip, bpSys, bpDia, hr,
      dietaryPreference, foodsToAvoid, nonNegotiables, reportedTriggers,
      medications, familyHx,
      sleep, stress, movement, nutrition, connection,
      supplementHx, whatWorked, whatDidntWork,
      timeline, ifmScores, ifmNotes,
      coachNotes,
    },
    {
      symptoms: setSymptoms, conditions: setConditions,
      allergiesArr: setAllergiesArr, goals: setGoals,
      medicalHistory: setMedicalHistory,
      digestionNotes: setDigestionNotes, sleepNotes: setSleepNotes,
      energyPattern: setEnergyPattern, menstrualNotes: setMenstrualNotes,
      stressResponse: setStressResponse,
      childhoodHistory: setChildhoodHistory,
      toxicExposures: setToxicExposures,
      cycleStatus: setCycleStatus, lmp: setLmp, cycleLen: setCycleLen,
      cycleReg: setCycleReg, menopauseStarted: setMenopauseStarted,
      pregnancyStatus: setPregnancyStatus,
      pregnancyDueDate: setPregnancyDueDate,
      lactationStarted: setLactationStarted,
      chiefComplaint: setChiefComplaint, hpi: setHpi,
      transcriptNotes: setTranscriptNotes,
      height: setHeight, weight: setWeight, bodyFat: setBodyFat,
      waist: setWaist, hip: setHip, bpSys: setBpSys, bpDia: setBpDia,
      hr: setHr,
      dietaryPreference: setDietaryPreference,
      foodsToAvoid: setFoodsToAvoid,
      nonNegotiables: setNonNegotiables,
      reportedTriggers: setReportedTriggers,
      medications: setMedications, familyHx: setFamilyHx,
      sleep: setSleep, stress: setStress, movement: setMovement,
      nutrition: setNutrition, connection: setConnection,
      supplementHx: setSupplementHx, whatWorked: setWhatWorked,
      whatDidntWork: setWhatDidntWork,
      timeline: setTimeline, ifmScores: setIfmScores,
      ifmNotes: setIfmNotes,
      coachNotes: setCoachNotes,
    },
  );

  const onSave = () => {
    // Detect whether the coach actually changed anything. An intake
    // update doesn't need a chief complaint — many edits are just body
    // comp / cycle / FM body-systems / meds. Block only the truly
    // empty case (no fields touched, no chips changed).
    const hasAnyTextField =
      !!(
        chiefComplaint.trim() ||
        hpi.trim() ||
        transcriptNotes.trim() ||
        medications.trim() ||
        supplementHx.trim() ||
        familyHx.trim() ||
        whatWorked.trim() ||
        whatDidntWork.trim() ||
        coachNotes.trim() ||
        digestionNotes.trim() ||
        sleepNotes.trim() ||
        energyPattern.trim() ||
        menstrualNotes.trim() ||
        stressResponse.trim() ||
        childhoodHistory.trim() ||
        toxicExposures.trim() ||
        dietaryPreference.trim() ||
        foodsToAvoid.trim() ||
        nonNegotiables.trim() ||
        reportedTriggers.trim()
      );
    const hasAnyMeasurement = !!(
      height || weight || bodyFat || waist || hip || bpSys || bpDia || hr
    );
    const hasAnyCycle = !!(
      cycleStatus ||
      lmp ||
      cycleLen ||
      cycleReg ||
      menopauseStarted ||
      pregnancyStatus ||
      pregnancyDueDate ||
      lactationStarted
    );
    const hasAnyChip =
      symptoms.length > 0 ||
      conditions.length > 0 ||
      allergiesArr.length > 0 ||
      goals.length > 0 ||
      medicalHistory.length > 0;
    const hasAnyTimeline = timeline.some((e) => e.event.trim().length > 0);
    const hasAnyIfm =
      Object.values(ifmScores).some(Boolean) ||
      Object.values(ifmNotes).some((v) => v.trim().length > 0);
    const hasAnyPillar = !!(
      sleep || stress || movement || nutrition || connection
    );

    if (
      !hasAnyTextField &&
      !hasAnyMeasurement &&
      !hasAnyCycle &&
      !hasAnyChip &&
      !hasAnyTimeline &&
      !hasAnyIfm &&
      !hasAnyPillar
    ) {
      toast.error(
        "Nothing to save yet — fill in at least one field (body comp, meds, cycle, symptoms, …).",
      );
      return;
    }
    start(async () => {
      // ── Build Five Pillars payload ────────────────────────────
      const fp: FivePillarsData = {};
      if (sleep) fp.sleep_hours = Number(sleep);
      if (stress) fp.stress_level = Number(stress);
      if (movement) fp.movement_days_per_week = Number(movement);
      if (nutrition) fp.nutrition_quality = Number(nutrition);
      if (connection) fp.connection_quality = Number(connection);
      const hasPillars = Object.keys(fp).length > 0;

      // ── Build IFM section ─────────────────────────────────────
      const ifmLines = IFM_NODES.flatMap((n) => {
        const score = ifmScores[n.id];
        const note = ifmNotes[n.id]?.trim();
        if (!score && !note) return [];
        return [`${n.emoji} ${n.label}${score ? ` · ${score}/5` : ""}${note ? ` — ${note}` : ""}`];
      });

      // ── Build session coach_notes ─────────────────────────────
      // v0.72: append the verify-in-session Q+A audit trail. Block is "" when
      // coach didn't tick any question, so it falls out of the filter naturally.
      const verifyBlock = verifyState.getNotesBlock();
      const sections: string[] = [
        chiefComplaint.trim() && `Chief complaint:\n${chiefComplaint.trim()}`,
        hpi.trim() && `History of present illness:\n${hpi.trim()}`,
        transcriptNotes.trim() && `Transcript / live notes:\n${transcriptNotes.trim()}`,
        medications.trim() && `Current medications:\n${medications.trim()}`,
        supplementHx.trim() && `Supplement history:\n${supplementHx.trim()}`,
        familyHx.trim() && `Family history:\n${familyHx.trim()}`,
        whatWorked.trim() && `What's worked: ${whatWorked.trim()}`,
        whatDidntWork.trim() && `What hasn't worked: ${whatDidntWork.trim()}`,
        ifmLines.length > 0 && `IFM 7-node baseline:\n${ifmLines.join("\n")}`,
        bodyFat && `Body fat (manual): ${bodyFat}%`,
        verifyBlock,
        coachNotes.trim() && `Coach notes:\n${coachNotes.trim()}`,
      ].filter(Boolean) as string[];

      // ── Save session (primary write) ──────────────────────────
      const sessionResult = await saveSessionAction({
        client_id: clientId,
        session_type: "intake",
        session_date: sessionDate,
        coach_notes: sections.join("\n\n"),
        presenting_complaints: `[session_type: intake] ${chiefComplaint.trim() || hpi.trim().slice(0, 120)}`,
        five_pillars: hasPillars ? fp : undefined,
        selected_symptoms: symptoms.length > 0 ? symptoms : undefined,
      });
      if (!sessionResult.ok) {
        toast.error(sessionResult.error ?? "Save session failed");
        return;
      }

      // ── Side writes (SEQUENTIAL on purpose) ──────────────────
      // Every entry below does a read-modify-write on the same
      // ~/fm-plans/clients/<id>/client.yaml file. Running them in
      // parallel races them — last writer wins, so e.g. body-comp
      // writes can clobber a freshly-saved menstrual_notes (coach
      // reported this happening). Serialise the queue: each write
      // sees the result of every earlier one.
      const sideWrites: Array<{
        label: string;
        run: () => Promise<{ ok: boolean; error?: string | null }>;
      }> = [];

      // Body composition → client.measurements + new health_snapshot
      const meas: Record<string, number> = {};
      if (height) meas.height_cm = Number(height);
      if (weight) meas.weight_kg = Number(weight);
      if (waist) meas.waist_cm = Number(waist);
      if (hip) meas.hip_cm = Number(hip);
      if (bpSys) meas.bp_systolic = Number(bpSys);
      if (bpDia) meas.bp_diastolic = Number(bpDia);
      if (hr) meas.hr_bpm = Number(hr);
      if (Object.keys(meas).length > 0) {
        sideWrites.push({
          label: "body composition",
          run: () =>
            applyTranscriptDataAction({
              client_id: clientId,
              measurements: meas,
              medications: [],
              conditions: [],
              lab_values: [],
              source: `intake-${new Date().toISOString().slice(0, 10)}`,
              linked_session_id: sessionResult.session_id,
            }),
        });
      }

      // Food + lifestyle prefs + FM body-systems narratives + cycle + pregnancy
      // — all live as text fields on client.yaml. One call writes them all.
      const prefsPayload: Parameters<typeof updateClientPreferences>[0] = {
        client_id: clientId,
      };
      if (dietaryPreference.trim()) prefsPayload.dietary_preference = dietaryPreference.trim();
      if (foodsToAvoid.trim()) prefsPayload.foods_to_avoid = foodsToAvoid.trim();
      if (nonNegotiables.trim()) prefsPayload.non_negotiables = nonNegotiables.trim();
      if (reportedTriggers.trim()) prefsPayload.reported_triggers = reportedTriggers.trim();
      // FM body-systems
      if (digestionNotes.trim()) prefsPayload.digestion_notes = digestionNotes.trim();
      if (sleepNotes.trim()) prefsPayload.sleep_notes = sleepNotes.trim();
      if (energyPattern.trim()) prefsPayload.energy_pattern = energyPattern.trim();
      if (menstrualNotes.trim()) prefsPayload.menstrual_notes = menstrualNotes.trim();
      if (stressResponse.trim()) prefsPayload.stress_response = stressResponse.trim();
      if (childhoodHistory.trim()) prefsPayload.childhood_history = childhoodHistory.trim();
      if (toxicExposures.trim()) prefsPayload.toxic_exposures = toxicExposures.trim();
      // Cycle
      if (cycleStatus) prefsPayload.cycle_status = cycleStatus as typeof prefsPayload.cycle_status;
      if (lmp) prefsPayload.last_menstrual_period = lmp;
      if (cycleLen) prefsPayload.cycle_length_days = Number(cycleLen);
      if (cycleReg) prefsPayload.cycle_regularity = cycleReg as typeof prefsPayload.cycle_regularity;
      if (menopauseStarted) prefsPayload.menopause_started = menopauseStarted;
      // Pregnancy
      if (pregnancyStatus) prefsPayload.pregnancy_status = pregnancyStatus as typeof prefsPayload.pregnancy_status;
      if (pregnancyDueDate) prefsPayload.pregnancy_due_date = pregnancyDueDate;
      if (lactationStarted) prefsPayload.lactation_started = lactationStarted;
      // Family history — only write if the coach actually changed it
      if (familyHx.trim() !== existingFamilyHistory.trim())
        prefsPayload.family_history = familyHx.trim();
      // What worked / didn't — same diff guard so we don't overwrite
      // existing values with stale form state.
      if (whatWorked.trim() !== existingWhatWorked.trim())
        prefsPayload.what_has_worked = whatWorked.trim();
      if (whatDidntWork.trim() !== existingWhatDidntWork.trim())
        prefsPayload.what_hasnt_worked = whatDidntWork.trim();

      // Only fire if any field is set beyond client_id.
      if (Object.keys(prefsPayload).length > 1) {
        sideWrites.push({
          label: "preferences + FM body-systems + cycle / pregnancy",
          run: () => updateClientPreferences(prefsPayload),
        });
      }

      // FM timeline
      const cleanedTimeline = timeline
        .filter((e) => e.event.trim().length > 0)
        .map((e) => ({
          year: e.year ? parseInt(e.year, 10) : undefined,
          category: e.category || undefined,
          event: e.event.trim(),
        }));
      if (cleanedTimeline.length > 0) {
        sideWrites.push({
          label: "FM timeline events",
          run: () =>
            updateClientTimeline({
              client_id: clientId,
              timeline_events: cleanedTimeline,
            }),
        });
      }

      // Active conditions + allergies + goals + medical history →
      // client.yaml via updateClientProfile. Write only the lists the
      // coach actually changed (avoids stomping fields she didn't touch).
      const arrChanged = (a: string[], b: string[]) =>
        a.length !== b.length || a.some((x, i) => x !== b[i]);
      const profilePatch: Parameters<typeof updateClientProfile>[0] = {
        client_id: clientId,
      };
      if (arrChanged(conditions, existingConditions))
        profilePatch.active_conditions = conditions;
      if (arrChanged(allergiesArr, existingAllergies))
        profilePatch.allergies = allergiesArr;
      if (arrChanged(goals, existingGoals)) profilePatch.goals = goals;
      if (arrChanged(medicalHistory, existingMedicalHistory))
        profilePatch.medical_history = medicalHistory;
      // Current medications list — split textarea back into an array and
      // only persist if it actually differs from what's on disk.
      const medsArr = medications
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      const existingMedsArr = existingMedications
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      if (arrChanged(medsArr, existingMedsArr))
        profilePatch.medications = medsArr;
      if (Object.keys(profilePatch).length > 1) {
        sideWrites.push({
          label: "conditions / meds / allergies / goals / medical history",
          run: () => updateClientProfile(profilePatch),
        });
      }

      // Run side-writes one at a time. If any fails, surface the
      // failing step's label in a toast so the coach knows which
      // field group didn't persist — much better than silent loss.
      const failures: string[] = [];
      for (const sw of sideWrites) {
        try {
          const r = await sw.run();
          if (!r.ok) {
            failures.push(`${sw.label}: ${r.error ?? "unknown error"}`);
          }
        } catch (e) {
          failures.push(`${sw.label}: ${(e as Error).message}`);
        }
      }

      if (failures.length > 0) {
        toast.error(
          `Saved session but ${failures.length} write failed: ${failures.join(" · ").slice(0, 240)}`,
          { duration: 12000 },
        );
      } else {
        toast.success(`Intake saved for ${displayName.split(" ")[0]}`);
      }
      // Session was saved successfully (we early-returned otherwise) — drop
      // the in-progress draft so the next intake on this client starts clean.
      clearDraft();
      router.push(`/clients-v2/${clientId}/analyse`);
      router.refresh();
    });
  };

  return (
    // v0.72: two-column grid — main intake form on the left, sticky
    // VerifyChecklist sidebar on the right. Single-column on mobile
    // (<900px), with the checklist appearing as a regular block above
    // the form. The grid syntax + media-query inline is awkward; we
    // use a class so the @media rule below works via a <style> tag.
    <div
      className="intake-with-verify"
      style={{
        display: "grid",
        gap: 20,
        gridTemplateColumns: verifyState.questions.length > 0 ? "minmax(0, 1fr) 300px" : "1fr",
        alignItems: "start",
      }}
    >
      <style>{`
        @media (max-width: 900px) {
          .intake-with-verify { grid-template-columns: 1fr !important; }
          .intake-with-verify > aside.intake-verify-rail {
            position: static !important;
            order: -1;
          }
        }
      `}</style>
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <FmFormDraftClear
          onClear={clearDraft}
          hasDraft={hasSavedDraft}
          title="Discard the saved in-progress intake draft (does not clear fields already on the page)"
        />
      </div>
      {discoveryContext && (
        <div
          style={{
            border: "1px solid var(--fm-border)",
            borderLeft: "3px solid var(--fm-primary)",
            background: "var(--fm-bg-subtle)",
            borderRadius: "var(--fm-radius-sm)",
            padding: "10px 14px",
            marginBottom: 14,
            fontSize: 13,
            display: "grid",
            gap: 6,
          }}
        >
          <div style={{ fontWeight: 700, color: "var(--fm-text)" }}>
            📞 From the discovery call · {discoveryContext.date || "earlier"}
          </div>
          {discoveryContext.chief_concern && (
            <div>
              <span style={{ fontWeight: 600 }}>Chief concern: </span>
              {discoveryContext.chief_concern}
            </div>
          )}
          {discoveryContext.requested_labs.length > 0 && (
            <div>
              <span style={{ fontWeight: 600 }}>
                Labs ordered ({discoveryContext.requested_labs.length}):
              </span>{" "}
              <span style={{ color: "var(--fm-text-muted)" }}>
                {discoveryContext.requested_labs.slice(0, 8).join(", ")}
                {discoveryContext.requested_labs.length > 8
                  ? ` + ${discoveryContext.requested_labs.length - 8} more`
                  : ""}
              </span>
            </div>
          )}
          {discoveryContext.coach_notes && (
            <details>
              <summary
                style={{
                  cursor: "pointer",
                  fontSize: 12,
                  color: "var(--fm-text-secondary)",
                }}
              >
                Full coach notes from discovery
              </summary>
              <pre
                style={{
                  whiteSpace: "pre-wrap",
                  fontFamily: "var(--fm-font-mono)",
                  fontSize: 11,
                  marginTop: 6,
                  color: "var(--fm-text-muted)",
                }}
              >
                {discoveryContext.coach_notes}
              </pre>
            </details>
          )}
          <div style={{ fontSize: 11, color: "var(--fm-text-muted)" }}>
            The discovery context has been seeded into the transcript field
            below — edit or replace as you go through the intake call.
          </div>
        </div>
      )}
      {/* 1 · Presenting */}
      <FmFormSection
        title="1 · Presenting picture"
        description="What the client is here to solve. The Full Assessment will read this back later."
      >
        <FmField
          label="Date of session"
          hint="Defaults to today — change if you're logging a past session. This date is what shows as 'Last contact'."
        >
          {({ id }) => (
            <FmInput
              id={id}
              type="date"
              value={sessionDate}
              onChange={(e) => setSessionDate(e.target.value)}
              style={{ maxWidth: 200 }}
            />
          )}
        </FmField>
        <FmField
          label={
            chiefComplaintFromDiscovery ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                Chief complaint
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    padding: "2px 6px",
                    background: "rgba(184, 119, 10, 0.12)",
                    color: "#B8770A",
                    border: "1px solid rgba(184, 119, 10, 0.30)",
                    borderRadius: "var(--fm-radius-pill)",
                  }}
                >
                  ✨ from Discovery
                </span>
              </span>
            ) : (
              "Chief complaint"
            )
          }
          hint={
            chiefComplaintFromDiscovery
              ? "Carried forward from the discovery call — edit if today's framing is different."
              : undefined
          }
        >
          {({ id }) => (
            <FmTextarea
              id={id}
              value={chiefComplaint}
              onChange={(e) => setChiefComplaint(e.target.value)}
              placeholder="e.g. Fatigue + weight gain × 9 months. Foggy in afternoon. Heavier cycles."
              rows={3}
            />
          )}
        </FmField>
        <FmField label="History of present illness" hint="onset · triggers · what helps / makes worse">
          {({ id }) => (
            <FmTextarea
              id={id}
              value={hpi}
              onChange={(e) => setHpi(e.target.value)}
              placeholder="Onset 6 months postpartum. Sleep started fragmenting in winter. Energy crash at 3 PM."
              rows={4}
            />
          )}
        </FmField>
        <details>
          <summary
            style={{
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 600,
              color: "var(--fm-text-secondary)",
              padding: "4px 0",
            }}
          >
            Live transcript / paste / upload
          </summary>
          <div style={{ marginTop: 8, display: "grid", gap: 10 }}>
            <FmTextarea
              value={transcriptNotes}
              onChange={(e) => setTranscriptNotes(e.target.value)}
              placeholder="Paste the call transcript here, OR drop a file below (PDF / TXT / MD / image). The AI will pre-populate the symptoms picker below."
              rows={5}
              style={{ fontFamily: "var(--fm-font-mono)", fontSize: 12 }}
            />
            <TranscriptUploadBox
              clientId={clientId}
              symptomCatalogue={symptomCatalogue}
              onExtracted={(matched, paths) => {
                // Merge matched symptoms into the picker — dedup.
                const next = Array.from(new Set([...symptoms, ...matched]));
                setSymptoms(next);
                // Append a marker into transcript notes so the AI synthesis
                // pass downstream knows transcripts were ingested + where
                // they live on disk.
                setTranscriptNotes((prev) =>
                  [
                    prev.trim(),
                    paths.length > 0
                      ? `[transcripts ingested: ${paths.join(", ")}]`
                      : "",
                  ]
                    .filter(Boolean)
                    .join("\n\n"),
                );
              }}
            />
          </div>
        </details>
      </FmFormSection>

      {/* 1b · Symptoms · conditions */}
      <FmFormSection
        title="1b · Symptoms & active conditions"
        description="Picked symptoms drive the Full Assessment's catalogue subgraph + AI synthesis. Active conditions go to client.active_conditions for the dashboard signal + meal plan generation."
      >
        <FmField
          label="Symptoms (catalogue + free-text)"
          hint="type to search 378-symptom catalogue — Enter for free-text"
        >
          {() => (
            <FmSymptomPicker
              catalogue={symptomCatalogue}
              value={symptoms}
              onChange={setSymptoms}
              placeholder="bloating, brain fog, joint pain…"
            />
          )}
        </FmField>
        <FmField
          label="Active conditions"
          hint="Enter to add — saves to client.active_conditions"
        >
          {() => (
            <ChipListInput
              values={conditions}
              draft={conditionDraft}
              setDraft={setConditionDraft}
              onAdd={addCondition}
              onRemove={(v) =>
                setConditions((arr) => arr.filter((c) => c !== v))
              }
              placeholder="Hashimoto's, PCOS, IBS, anxiety…"
              tone="primary"
            />
          )}
        </FmField>
      </FmFormSection>

      {/* 1c · Goals & medical history */}
      <FmFormSection
        title="1c · Goals & medical history"
        description="What does success look like for this client + every past diagnosis worth carrying forward. Both lists live on client.yaml."
      >
        <FmField
          label="Client goals"
          hint="Enter / comma to add — saves to client.goals"
        >
          {() => (
            <ChipListInput
              values={goals}
              draft={goalDraft}
              setDraft={setGoalDraft}
              onAdd={addGoal}
              onRemove={(v) => setGoals((arr) => arr.filter((g) => g !== v))}
              placeholder="lose 6kg in 6 mo · resolve afternoon brain fog · cycle stays regular…"
              tone="primary"
            />
          )}
        </FmField>
        <FmField
          label="Medical history"
          hint="Past diagnoses with status — saves to client.medical_history"
        >
          {() => (
            <ChipListInput
              values={medicalHistory}
              draft={mhDraft}
              setDraft={setMhDraft}
              onAdd={addMh}
              onRemove={(v) =>
                setMedicalHistory((arr) => arr.filter((m) => m !== v))
              }
              placeholder="Hashimoto's dx 2018 · D&C 2021 · gestational diabetes 2019…"
              tone="primary"
            />
          )}
        </FmField>
      </FmFormSection>

      {/* 2 · Body composition baseline */}
      <FmFormSection
        title="2 · Body composition baseline"
        description="Take these on the call. Drives the Body comp grid on Overview and is the comparator every check-in measures against."
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 8,
          }}
        >
          <FmField label="Height" hint="cm">
            {({ id }) => (
              <FmInput id={id} type="number" step="0.5" value={height} onChange={(e) => setHeight(e.target.value)} placeholder="168" />
            )}
          </FmField>
          <FmField label="Weight" hint="kg">
            {({ id }) => (
              <FmInput id={id} type="number" step="0.1" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="68.4" />
            )}
          </FmField>
          <FmField label="Body fat" hint="% (manual)">
            {({ id }) => (
              <FmInput id={id} type="number" step="0.1" value={bodyFat} onChange={(e) => setBodyFat(e.target.value)} placeholder="28.0" />
            )}
          </FmField>
          <FmField label="Waist" hint="cm">
            {({ id }) => (
              <FmInput id={id} type="number" step="0.5" value={waist} onChange={(e) => setWaist(e.target.value)} placeholder="84" />
            )}
          </FmField>
          <FmField label="Hip" hint="cm">
            {({ id }) => (
              <FmInput id={id} type="number" step="0.5" value={hip} onChange={(e) => setHip(e.target.value)} placeholder="102" />
            )}
          </FmField>
          <FmField label="BP systolic" hint="mmHg">
            {({ id }) => (
              <FmInput id={id} type="number" value={bpSys} onChange={(e) => setBpSys(e.target.value)} placeholder="118" />
            )}
          </FmField>
          <FmField label="BP diastolic" hint="mmHg">
            {({ id }) => (
              <FmInput id={id} type="number" value={bpDia} onChange={(e) => setBpDia(e.target.value)} placeholder="76" />
            )}
          </FmField>
          <FmField label="Resting HR" hint="bpm">
            {({ id }) => (
              <FmInput id={id} type="number" value={hr} onChange={(e) => setHr(e.target.value)} placeholder="68" />
            )}
          </FmField>
        </div>
      </FmFormSection>

      {/* 3 · Food + lifestyle */}
      <FmFormSection
        title="3 · Food & lifestyle preferences"
        description="Drives every meal plan, supplement contraindication check, and client letter. Sets once at intake; coach edits over time."
      >
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <FmField label="Dietary preference" hint="e.g. Lacto-vegetarian · Eggetarian · Jain · Vegan · Pescatarian · Omnivore">
            {({ id }) => (
              <FmInput
                id={id}
                value={dietaryPreference}
                onChange={(e) => setDietaryPreference(e.target.value)}
                placeholder="Lacto-vegetarian · no eggs"
              />
            )}
          </FmField>
          <FmField label="Allergies" hint="Enter to add — saves to client.known_allergies">
            {() => (
              <ChipListInput
                values={allergiesArr}
                draft={allergyDraft}
                setDraft={setAllergyDraft}
                onAdd={addAllergy}
                onRemove={(v) =>
                  setAllergiesArr((arr) => arr.filter((a) => a !== v))
                }
                placeholder="Penicillin, shellfish, latex…"
                tone="warning"
              />
            )}
          </FmField>
        </div>
        <FmField label="Foods to avoid" hint="religious / cultural / inflammatory / suspected sensitivities">
          {({ id }) => (
            <FmTextarea
              id={id}
              value={foodsToAvoid}
              onChange={(e) => setFoodsToAvoid(e.target.value)}
              placeholder="Onion, garlic (Jain) · gluten trial since Mar · suspects dairy"
              rows={2}
            />
          )}
        </FmField>
        <FmField label="Non-negotiables" hint="cultural anchors the plan must work around">
          {({ id }) => (
            <FmTextarea
              id={id}
              value={nonNegotiables}
              onChange={(e) => setNonNegotiables(e.target.value)}
              placeholder="Family dinners at 8 PM · evening walk with husband · weekend chai with parents"
              rows={2}
            />
          )}
        </FmField>
        <FmField label="Reported triggers" hint="what the client thinks makes things worse">
          {({ id }) => (
            <FmTextarea
              id={id}
              value={reportedTriggers}
              onChange={(e) => setReportedTriggers(e.target.value)}
              placeholder="Late dinners · stress at work · sugar in afternoon"
              rows={2}
            />
          )}
        </FmField>
      </FmFormSection>

      {/* 4 · Meds + family */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 14,
          marginBottom: 14,
        }}
      >
        <FmFormSection title="4a · Current medications" description="One per line: name · dose · how long.">
          <FmTextarea
            value={medications}
            onChange={(e) => setMedications(e.target.value)}
            placeholder={`Levothyroxine · 50 mcg AM empty stomach · 2 yrs\nVitamin D3 · 60 000 IU weekly · 6 mo\nOCP — Yasmin · discontinued 4 mo ago`}
            rows={7}
            style={{ fontFamily: "var(--fm-font-mono)", fontSize: 12 }}
          />
          {depletionMatches.length > 0 && (
            <div
              style={{
                padding: "10px 12px",
                background:
                  "linear-gradient(135deg, rgba(243,156,18,0.10), rgba(247,147,30,0.06))",
                border: "1.5px solid rgba(243,156,18,0.35)",
                borderRadius: "var(--fm-radius-md)",
                fontSize: 12,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#8a5a08",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginBottom: 6,
                }}
              >
                💊 {depletionMatches.length} drug-nutrient depletion
                {depletionMatches.length === 1 ? "" : "s"} flagged
                <span
                  style={{
                    fontSize: 10,
                    padding: "1px 6px",
                    borderRadius: 3,
                    background: "rgba(0,0,0,0.06)",
                    color: "#B8770A",
                    letterSpacing: 0.6,
                    textTransform: "uppercase",
                  }}
                >
                  catalogue
                </span>
              </div>
              <div style={{ display: "grid", gap: 4 }}>
                {depletionMatches.map((m) => (
                  <div
                    key={m.drug_name}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: m.depletes.some(
                          (d) => d.severity === "high" || d.severity === "severe",
                        )
                          ? "var(--fm-danger)"
                          : "#B8770A",
                      }}
                    />
                    <strong style={{ color: "var(--fm-text-primary)" }}>
                      {m.drug_name}
                    </strong>
                    <span style={{ color: "var(--fm-text-tertiary)", fontSize: 10 }}>
                      depletes
                    </span>
                    <span style={{ color: "var(--fm-text-secondary)" }}>
                      {m.depletes.map((d) => d.nutrient).join(" · ")}
                    </span>
                  </div>
                ))}
              </div>
              <div
                style={{
                  marginTop: 6,
                  fontSize: 11,
                  color: "var(--fm-text-tertiary)",
                  fontStyle: "italic",
                }}
              >
                Order these lab markers in section 9 or surface in the next
                check-in. Same banner re-appears on the Overview tab once the
                intake is saved.
              </div>
            </div>
          )}
        </FmFormSection>
        <FmFormSection title="4b · Family history" description="Genetic and FM-relevant patterns.">
          <FmTextarea
            value={familyHx}
            onChange={(e) => setFamilyHx(e.target.value)}
            placeholder={`Mother — Hashimoto's dx at 38\nMaternal grandmother — T2D\nFather — anxiety\nNo cancer or autoimmune history`}
            rows={7}
          />
        </FmFormSection>
      </div>

      {/* 5 · Five Pillars */}
      <FmFormSection
        title="5 · Five Pillars baseline"
        description="Where the client sits today, before any intervention. Becomes the comparator for every future check-in."
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
          <FmField label="Sleep" hint="hr/night">
            {({ id }) => <FmInput id={id} type="number" step="0.5" value={sleep} onChange={(e) => setSleep(e.target.value)} placeholder="6.5" />}
          </FmField>
          <FmField label="Stress" hint="1–5">
            {({ id }) => <FmInput id={id} type="number" min={1} max={5} value={stress} onChange={(e) => setStress(e.target.value)} placeholder="4" />}
          </FmField>
          <FmField label="Movement" hint="days/wk">
            {({ id }) => <FmInput id={id} type="number" min={0} max={7} value={movement} onChange={(e) => setMovement(e.target.value)} placeholder="2" />}
          </FmField>
          <FmField label="Nutrition" hint="1–5">
            {({ id }) => <FmInput id={id} type="number" min={1} max={5} value={nutrition} onChange={(e) => setNutrition(e.target.value)} placeholder="3" />}
          </FmField>
          <FmField label="Connection" hint="1–5">
            {({ id }) => <FmInput id={id} type="number" min={1} max={5} value={connection} onChange={(e) => setConnection(e.target.value)} placeholder="4" />}
          </FmField>
        </div>
      </FmFormSection>

      {/* 6 · Trial-and-error */}
      <FmFormSection title="6 · History of trial-and-error">
        <FmField label="Supplement history" hint="brand · dose · duration · effect">
          {({ id }) => (
            <FmTextarea
              id={id}
              value={supplementHx}
              onChange={(e) => setSupplementHx(e.target.value)}
              placeholder={`Magnesium glycinate 400 mg bedtime · 2 mo, helped sleep\nAshwagandha — tried 1 mo, made wired\nB-complex · still taking`}
              rows={4}
            />
          )}
        </FmField>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <FmField label="What's worked">
            {({ id }) => (
              <FmTextarea
                id={id}
                value={whatWorked}
                onChange={(e) => setWhatWorked(e.target.value)}
                placeholder="Walking 30 min after lunch · sleeping at 10 PM · cutting alcohol"
                rows={3}
              />
            )}
          </FmField>
          <FmField label="What hasn't worked">
            {({ id }) => (
              <FmTextarea
                id={id}
                value={whatDidntWork}
                onChange={(e) => setWhatDidntWork(e.target.value)}
                placeholder="Keto · intermittent fasting · CBT-i app"
                rows={3}
              />
            )}
          </FmField>
        </div>
      </FmFormSection>

      {/* 6b · FM body-systems review */}
      <FmFormSection
        title="6b · FM body-systems review"
        description="Qualitative narratives the AI synthesis reads. Quick paragraph each; leave blank if not asked."
      >
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <FmField
            label="Digestion"
            hint="bowel pattern · bloating · reflux · gas · transit time"
          >
            {({ id }) => (
              <FmTextarea
                id={id}
                value={digestionNotes}
                onChange={(e) => setDigestionNotes(e.target.value)}
                placeholder="BM 1×/day morning, type 4 Bristol. Bloating after meals 4 PM. No reflux. Mild gas legumes."
                rows={4}
              />
            )}
          </FmField>
          <FmField
            label="Sleep narrative"
            hint="onset · maintenance · wake-time · dreams · daytime nap"
          >
            {({ id }) => (
              <FmTextarea
                id={id}
                value={sleepNotes}
                onChange={(e) => setSleepNotes(e.target.value)}
                placeholder="Falls asleep 11 PM, wakes 3 AM each night for 45 min, then back. No daytime nap. Vivid dreams since postpartum."
                rows={4}
              />
            )}
          </FmField>
          <FmField
            label="Energy pattern"
            hint="when peaks · when crashes · post-meal · post-exercise"
          >
            {({ id }) => (
              <FmTextarea
                id={id}
                value={energyPattern}
                onChange={(e) => setEnergyPattern(e.target.value)}
                placeholder="Best at 10 AM, crash 3-4 PM, second wind 8 PM. Coffee at 11 AM helps; needed by 1 PM = bad day."
                rows={4}
              />
            )}
          </FmField>
          <FmField
            label="Stress response"
            hint="how stress shows up · coping baseline"
          >
            {({ id }) => (
              <FmTextarea
                id={id}
                value={stressResponse}
                onChange={(e) => setStressResponse(e.target.value)}
                placeholder="Stress → sugar cravings + jaw clenching at night. Yoga 1×/wk. No alcohol since OCP came off."
                rows={4}
              />
            )}
          </FmField>
          {clientSex === "F" && (
            <FmField
              label="Menstrual narrative"
              hint="cycle pattern · PMS · flow · pain · perimenopause"
            >
              {({ id }) => (
                <FmTextarea
                  id={id}
                  value={menstrualNotes}
                  onChange={(e) => setMenstrualNotes(e.target.value)}
                  placeholder="Regular 28-day. Heavier since 6 mo postpartum. PMS — irritable + bloated 4 days before. No clotting."
                  rows={4}
                />
              )}
            </FmField>
          )}
          <FmField
            label="Childhood / ACEs"
            hint="adverse childhood events worth carrying forward"
          >
            {({ id }) => (
              <FmTextarea
                id={id}
                value={childhoodHistory}
                onChange={(e) => setChildhoodHistory(e.target.value)}
                placeholder="Parental divorce age 9. No major illness. Strict diet rules in teens. Mother emotionally absent during stress."
                rows={4}
              />
            )}
          </FmField>
          <FmField
            label="Toxic exposures"
            hint="mould · pesticides · solvents · heavy metals · workplace"
          >
            {({ id }) => (
              <FmTextarea
                id={id}
                value={toxicExposures}
                onChange={(e) => setToxicExposures(e.target.value)}
                placeholder="Lived in damp house 2019-21 (suspected mould). No occupational chemical exposure. Amalgam fillings × 3."
                rows={4}
              />
            )}
          </FmField>
        </div>
      </FmFormSection>

      {/* 6c · Cycle + pregnancy / lactation (women only) */}
      {clientSex === "F" && (
        <FmFormSection
          title="6c · Cycle · pregnancy · lactation"
          description="Drives cycle-synced meal plans + supplement safety overlay. Sets once at intake, coach updates over time."
        >
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <FmField label="Cycle status">
              {({ id }) => (
                <select
                  id={id}
                  value={cycleStatus}
                  onChange={(e) => setCycleStatus(e.target.value)}
                  style={{
                    padding: "8px 10px",
                    background: "var(--fm-surface)",
                    border: "1px solid var(--fm-border)",
                    borderRadius: "var(--fm-radius-sm)",
                    fontSize: 13,
                    fontFamily: "inherit",
                    outline: "none",
                    width: "100%",
                  }}
                >
                  <option value="">—</option>
                  <option value="menstruating">Menstruating</option>
                  <option value="perimenopausal">Perimenopausal</option>
                  <option value="postmenopausal">Postmenopausal</option>
                  <option value="not_applicable">Not applicable</option>
                </select>
              )}
            </FmField>
            <FmField label="Cycle regularity">
              {({ id }) => (
                <select
                  id={id}
                  value={cycleReg}
                  onChange={(e) => setCycleReg(e.target.value)}
                  style={{
                    padding: "8px 10px",
                    background: "var(--fm-surface)",
                    border: "1px solid var(--fm-border)",
                    borderRadius: "var(--fm-radius-sm)",
                    fontSize: 13,
                    fontFamily: "inherit",
                    outline: "none",
                    width: "100%",
                  }}
                >
                  <option value="">—</option>
                  <option value="regular">Regular</option>
                  <option value="irregular">Irregular</option>
                  <option value="very_irregular">Very irregular</option>
                </select>
              )}
            </FmField>
            <FmField label="LMP" hint="last menstrual period (YYYY-MM-DD)">
              {({ id }) => (
                <FmInput
                  id={id}
                  type="date"
                  value={lmp}
                  onChange={(e) => setLmp(e.target.value)}
                />
              )}
            </FmField>
            <FmField label="Cycle length" hint="days, defaults 28">
              {({ id }) => (
                <FmInput
                  id={id}
                  type="number"
                  min={20}
                  max={60}
                  value={cycleLen}
                  onChange={(e) => setCycleLen(e.target.value)}
                  placeholder="28"
                />
              )}
            </FmField>
            <FmField
              label="Menopause started"
              hint="if postmenopausal — first date of 12-mo flow-free"
            >
              {({ id }) => (
                <FmInput
                  id={id}
                  type="date"
                  value={menopauseStarted}
                  onChange={(e) => setMenopauseStarted(e.target.value)}
                />
              )}
            </FmField>
            <FmField label="Pregnancy status">
              {({ id }) => (
                <select
                  id={id}
                  value={pregnancyStatus}
                  onChange={(e) => setPregnancyStatus(e.target.value)}
                  style={{
                    padding: "8px 10px",
                    background: "var(--fm-surface)",
                    border: "1px solid var(--fm-border)",
                    borderRadius: "var(--fm-radius-sm)",
                    fontSize: 13,
                    fontFamily: "inherit",
                    outline: "none",
                    width: "100%",
                  }}
                >
                  <option value="">—</option>
                  <option value="not_applicable">Not applicable</option>
                  <option value="not_pregnant">Not pregnant</option>
                  <option value="trying_to_conceive">Trying to conceive</option>
                  <option value="pregnant_first_trimester">Pregnant · T1</option>
                  <option value="pregnant_second_trimester">Pregnant · T2</option>
                  <option value="pregnant_third_trimester">Pregnant · T3</option>
                  <option value="lactating">Lactating</option>
                </select>
              )}
            </FmField>
            {pregnancyStatus.startsWith("pregnant") && (
              <FmField label="Due date">
                {({ id }) => (
                  <FmInput
                    id={id}
                    type="date"
                    value={pregnancyDueDate}
                    onChange={(e) => setPregnancyDueDate(e.target.value)}
                  />
                )}
              </FmField>
            )}
            {pregnancyStatus === "lactating" && (
              <FmField label="Lactation started">
                {({ id }) => (
                  <FmInput
                    id={id}
                    type="date"
                    value={lactationStarted}
                    onChange={(e) => setLactationStarted(e.target.value)}
                  />
                )}
              </FmField>
            )}
          </div>
          <div
            style={{
              fontSize: 11,
              color: "var(--fm-text-tertiary)",
              fontStyle: "italic",
              marginTop: 8,
            }}
          >
            Pregnancy / lactation gates the Pregnancy Safety panel on Overview
            — any supplement contraindicated for the current trimester will
            light up red.
          </div>
        </FmFormSection>
      )}

      {/* 7 · FM timeline */}
      <FmFormSection
        title="7 · Client FM timeline"
        description="Chronology of life events that may matter — births, surgeries, divorces, illnesses, prolonged stress. Builds context the Full Assessment uses to pattern-match."
      >
        <div style={{ display: "grid", gap: 8 }}>
          {timeline.map((row, i) => (
            <div
              key={i}
              style={{
                display: "grid",
                gridTemplateColumns: "80px 160px 1fr 32px",
                gap: 8,
                alignItems: "center",
              }}
            >
              <FmInput
                type="number"
                placeholder="Year"
                value={row.year}
                onChange={(e) => updateTimelineRow(i, { year: e.target.value })}
              />
              <select
                value={row.category}
                onChange={(e) => updateTimelineRow(i, { category: e.target.value })}
                style={{
                  padding: "8px 10px",
                  background: "var(--fm-surface)",
                  border: "1px solid var(--fm-border)",
                  borderRadius: "var(--fm-radius-sm)",
                  fontSize: 13,
                  color: "var(--fm-text-primary)",
                  outline: "none",
                  fontFamily: "inherit",
                  cursor: "pointer",
                }}
              >
                <option value="">Category</option>
                {TIMELINE_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
                {/* Preserve any stored category not in the canonical list
                    so it never silently renders as a blank "Category". */}
                {row.category &&
                  !TIMELINE_CATEGORIES.some((c) => c.value === row.category) && (
                    <option value={row.category}>{row.category}</option>
                  )}
              </select>
              <FmInput
                placeholder="Event — e.g. Postpartum diagnosis of Hashimoto's"
                value={row.event}
                onChange={(e) => updateTimelineRow(i, { event: e.target.value })}
              />
              {timeline.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeTimelineRow(i)}
                  title="Remove"
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: "var(--fm-radius-sm)",
                    background: "transparent",
                    border: "1px solid var(--fm-border-light)",
                    color: "var(--fm-text-tertiary)",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    fontSize: 14,
                  }}
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addTimelineRow}
          style={{
            padding: "6px 12px",
            background: "var(--fm-surface)",
            border: "1px dashed var(--fm-border)",
            borderRadius: "var(--fm-radius-sm)",
            fontSize: 12,
            fontWeight: 600,
            color: "var(--fm-text-secondary)",
            cursor: "pointer",
            fontFamily: "inherit",
            alignSelf: "flex-start",
          }}
        >
          + Add timeline event
        </button>
      </FmFormSection>

      {/* 8 · IFM 7 nodes baseline */}
      <FmFormSection
        title="8 · 7 IFM nodes — baseline assessment"
        description="Score each functional-medicine node 1–5 based on the call. Becomes the baseline for the IFM Matrix card. Leave blank if not assessed."
      >
        {/* ✨ Auto-score from the symptoms / conditions captured above.
            Local computation (no API call) — runs computeIFMMatrix on the
            current symptoms + active_conditions, buckets the 0–100 burden
            score into 1–5, and only fills nodes the coach hasn't already
            scored manually. Coach can override any cell after auto-score. */}
        {(symptoms.length > 0 || conditions.length > 0) && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 10px",
              marginBottom: 10,
              background: "rgba(20, 83, 45, 0.04)",
              border: "1px dashed rgba(20, 83, 45, 0.25)",
              borderRadius: "var(--fm-radius-sm)",
            }}
          >
            <button
              type="button"
              onClick={() => {
                // Combine symptom slugs + condition labels (the burden
                // mapper checks both as catalogue slugs / aliases).
                const allSignals = [
                  ...symptoms,
                  ...conditions.map((c) => c.toLowerCase().replace(/\s+/g, "-")),
                ];
                const matrix = computeIFMMatrix([], [], allSignals);
                // 0-100 burden → 1-5 bucket. Higher burden = higher score
                // (matches existing IFM matrix card's "more dysfunction" reading).
                const bucket = (s: number): number => {
                  if (s <= 0) return 0;
                  if (s <= 20) return 1;
                  if (s <= 40) return 2;
                  if (s <= 60) return 3;
                  if (s <= 80) return 4;
                  return 5;
                };
                setIfmScores((prev) => {
                  const next = { ...prev };
                  let filled = 0;
                  for (const n of matrix.nodes) {
                    if (next[n.node] != null) continue; // don't overwrite coach edits
                    const b = bucket(n.score);
                    if (b > 0) {
                      next[n.node as IFMNodeId] = b;
                      filled += 1;
                    }
                  }
                  if (filled === 0) {
                    setIfmNotes((notes) => notes || "");
                  }
                  return next;
                });
              }}
              style={{
                fontSize: 12,
                fontWeight: 700,
                padding: "6px 12px",
                background: "var(--fm-success, #14532d)",
                color: "white",
                border: 0,
                borderRadius: "var(--fm-radius-sm)",
                cursor: "pointer",
                fontFamily: "inherit",
                whiteSpace: "nowrap",
              }}
            >
              ✨ Auto-score from symptoms
            </button>
            <span style={{ fontSize: 11, color: "var(--fm-text-secondary)" }}>
              Pre-fills any blank nodes from {symptoms.length} symptom
              {symptoms.length === 1 ? "" : "s"}
              {conditions.length > 0 && ` + ${conditions.length} condition${conditions.length === 1 ? "" : "s"}`}.
              Edit any cell after to override.
            </span>
          </div>
        )}
        <div style={{ display: "grid", gap: 8 }}>
          {IFM_NODES.map((n) => {
            const score = ifmScores[n.id];
            return (
              <div
                key={n.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "200px 220px 1fr",
                  gap: 12,
                  alignItems: "center",
                  padding: "8px 10px",
                  background: "var(--fm-surface)",
                  border: "1px solid var(--fm-border-light)",
                  borderRadius: "var(--fm-radius-sm)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 16 }}>{n.emoji}</span>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: n.color }}>
                      {n.label}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--fm-text-tertiary)" }}>
                      {n.description}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  {[1, 2, 3, 4, 5].map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() =>
                        setIfmScores((s) => {
                          const next = { ...s };
                          if (next[n.id] === v) delete next[n.id];
                          else next[n.id] = v;
                          return next;
                        })
                      }
                      style={{
                        flex: 1,
                        padding: "5px 0",
                        background: score === v ? n.color : "var(--fm-surface)",
                        color: score === v ? "#fff" : "var(--fm-text-secondary)",
                        border: `1px solid ${score === v ? n.color : "var(--fm-border-light)"}`,
                        borderRadius: "var(--fm-radius-sm)",
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      {v}
                    </button>
                  ))}
                </div>
                <FmInput
                  value={ifmNotes[n.id] ?? ""}
                  onChange={(e) =>
                    setIfmNotes((s) => ({ ...s, [n.id]: e.target.value }))
                  }
                  placeholder="Optional note…"
                />
              </div>
            );
          })}
        </div>
        <div
          style={{
            marginTop: 8,
            fontSize: 11,
            color: "var(--fm-text-tertiary)",
          }}
        >
          1 = optimal, 5 = severe dysfunction. Scores fold into session
          coach_notes; the IFM Matrix card on Overview will read these for
          first-touch heat-mapping.
        </div>
      </FmFormSection>

      {/* 9 · Lab reports upload — uses existing panel */}
      <FmFormSection
        title="9 · Lab reports already on file"
        description="Drop PDFs of blood work, urine, stool, breath etc. Sonnet extracts the marker values and they show up on the Overview FM markers panel."
      >
        <LabUploadPanel clientId={clientId} />
      </FmFormSection>

      {/* 9b · Food journal upload */}
      <FmFormSection
        title="9b · Food journal"
        description="Upload the food journal the client returned after Discovery. PDFs, images, or markdown. Saves to client reports."
      >
        <FoodJournalUploadSection
          clientId={clientId}
          uploaded={foodJournalFiles}
          uploading={foodJournalUploading}
          setUploading={setFoodJournalUploading}
          setUploaded={setFoodJournalFiles}
        />
      </FmFormSection>

      {/* 9c · Manual health data paste */}
      <FmFormSection
        title="9c · Verbal labs & vitals — paste & parse"
        description="Numbers the client said out loud (weight, BP, “my TSH was 4.2 last week”) that haven't been uploaded as a PDF. Haiku turns them into structured lab values + measurements; review and apply to the client's health snapshot. → Numeric / structured. Coach observations (mood, dynamics, anything non-numeric) go into section 11 instead."
      >
        <FmField
          label="Free-form coach text"
          hint="e.g. 'TSH 4.2 last week, fasting glucose 102, weight 68 kg, BP 118/76. On levothyroxine 50mcg. Diagnosed Hashimoto's 2018.'"
        >
          {({ id }) => (
            <FmTextarea
              id={id}
              value={healthText}
              onChange={(e) => setHealthText(e.target.value)}
              placeholder="Paste or type verbal-report values…"
              rows={4}
            />
          )}
        </FmField>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            type="button"
            disabled={!healthText.trim() || healthParsing}
            onClick={async () => {
              setHealthParsing(true);
              try {
                const r = await parseHealthTextAction({ text: healthText });
                if (r.ok && r.extracted_data) {
                  setHealthExtracted(r.extracted_data);
                  toast.success("Parsed — review below before applying");
                } else {
                  toast.error(r.error ?? "Parse failed");
                }
              } finally {
                setHealthParsing(false);
              }
            }}
            style={{
              padding: "7px 14px",
              background: "var(--fm-secondary)",
              color: "#fff",
              border: 0,
              borderRadius: "var(--fm-radius-sm)",
              fontSize: 12,
              fontWeight: 700,
              cursor: !healthText.trim() || healthParsing ? "not-allowed" : "pointer",
              opacity: !healthText.trim() || healthParsing ? 0.5 : 1,
              fontFamily: "inherit",
            }}
          >
            {healthParsing ? "Parsing…" : "✨ Parse with AI"}
          </button>
          {healthExtracted && (
            <button
              type="button"
              onClick={() => {
                setHealthExtracted(null);
                setHealthText("");
              }}
              style={{
                fontSize: 12,
                color: "var(--fm-text-tertiary)",
                background: "transparent",
                border: 0,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Clear
            </button>
          )}
        </div>
        {healthExtracted && (
          <HealthDataPreview
            data={healthExtracted}
            onApply={async () => {
              const r = await applyTranscriptDataAction({
                client_id: clientId,
                measurements: healthExtracted.measurements,
                lab_values: healthExtracted.lab_values,
                medications: healthExtracted.medications,
                conditions: healthExtracted.conditions,
                source: `intake-manual-${new Date().toISOString().slice(0, 10)}`,
              });
              if (r.ok) {
                toast.success("Health data applied to client profile");
                setHealthExtracted(null);
                setHealthText("");
                router.refresh();
              } else {
                toast.error(r.error ?? "Apply failed");
              }
            }}
          />
        )}
      </FmFormSection>

      {/* 10 · Special FM reports upload */}
      <FmFormSection
        title="10 · Special FM reports"
        description="DUTCH (hormone metabolites) · GI-MAP (gut microbiome) · Genetic / SNP panels. Each parses with a specialised pipeline."
      >
        <div style={{ display: "grid", gap: 14 }}>
          <FunctionalTestPanel clientId={clientId} />
          <GeneticReportPanel clientId={clientId} />
        </div>
      </FmFormSection>

      {/* 11 · Coach notes */}
      <FmFormSection
        title="11 · Coach observations"
        description="Free-text, non-numeric. Mood / affect, body language, relationship dynamics, sense of motivation, anything that won't show up in labs or fit the structured fields above. Gets saved as session.coach_notes — distinct from 9c which captures numeric / structured data."
      >
        <FmField label="Anything else worth recording">
          {({ id }) => (
            <FmTextarea
              id={id}
              value={coachNotes}
              onChange={(e) => setCoachNotes(e.target.value)}
              placeholder="Mood / affect, body language, relationship dynamics, anything that won't show up in labs."
              rows={4}
            />
          )}
        </FmField>
      </FmFormSection>

      <div
        style={{
          display: "flex",
          gap: 8,
          justifyContent: "flex-end",
          padding: "12px 0 24px",
          position: "sticky",
          bottom: 0,
          background: "var(--fm-bg)",
        }}
      >
        <button
          type="button"
          onClick={() => router.push(`/clients-v2/${clientId}/analyse`)}
          style={{
            padding: "8px 14px",
            background: "var(--fm-surface)",
            color: "var(--fm-text-primary)",
            border: "1px solid var(--fm-border)",
            borderRadius: "var(--fm-radius-sm)",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          // The earlier hard gate required chief complaint OR HPI to
          // enable the button — which silently blocked saves when the
          // coach was just updating body comp / cycle / FM body-systems
          // / meds (no chief-complaint change needed for an update).
          // We now disable ONLY while a save is in flight. The onSave
          // handler itself surfaces an inline error if literally
          // nothing was filled in.
          disabled={pending}
          style={{
            padding: "10px 22px",
            background: PRIMARY,
            color: "#fff",
            border: 0,
            borderRadius: "var(--fm-radius-sm)",
            fontSize: 13,
            fontWeight: 700,
            cursor: pending ? "wait" : "pointer",
            fontFamily: "inherit",
            opacity: pending ? 0.6 : 1,
          }}
        >
          {pending ? "Saving…" : "💾 Save intake →"}
        </button>
      </div>
    </div>

      {/* v0.72: sticky sidebar with AI verify-in-session questions.
          Only renders when intake_insights has been generated on the
          client. Width pinned to 300px on desktop; collapses to a normal
          block above the form on mobile (via the .intake-with-verify
          @media rule above). */}
      {verifyState.questions.length > 0 && (
        <aside
          className="intake-verify-rail"
          style={{
            position: "sticky",
            top: 16,
            alignSelf: "start",
            maxHeight: "calc(100vh - 32px)",
            overflowY: "auto",
          }}
        >
          <VerifyChecklist
            state={verifyState}
            modelLabel={insightsModelLabel}
            emptyHint="No verify-in-session questions on file."
          />
        </aside>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — kept in the same file because they're tightly coupled to the form.
// ─────────────────────────────────────────────────────────────────────────────

function ChipListInput({
  values,
  draft,
  setDraft,
  onAdd,
  onRemove,
  placeholder,
  tone = "primary",
}: {
  values: string[];
  draft: string;
  setDraft: (v: string) => void;
  onAdd: (v: string) => void;
  onRemove: (v: string) => void;
  placeholder?: string;
  tone?: "primary" | "warning";
}) {
  const bg =
    tone === "warning"
      ? "rgba(243, 156, 18, 0.10)"
      : "rgba(255, 107, 53, 0.10)";
  const fg =
    tone === "warning"
      ? "#B8770A"
      : "var(--fm-primary)";
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 4,
        alignItems: "center",
        background: "var(--fm-surface)",
        border: "1px solid var(--fm-border)",
        borderRadius: "var(--fm-radius-sm)",
        padding: 6,
      }}
    >
      {values.map((v) => (
        <span
          key={v}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "3px 8px",
            background: bg,
            color: fg,
            borderRadius: "var(--fm-radius-pill)",
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          {v}
          <button
            type="button"
            onClick={() => onRemove(v)}
            style={{
              background: "transparent",
              border: 0,
              cursor: "pointer",
              color: "inherit",
              fontSize: 11,
              padding: 0,
              marginLeft: 2,
              lineHeight: 1,
            }}
            aria-label={`Remove ${v}`}
          >
            ×
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onAdd(draft);
          }
          if (
            e.key === "Backspace" &&
            draft === "" &&
            values.length > 0
          ) {
            onRemove(values[values.length - 1]);
          }
          if (e.key === "," || e.key === ";") {
            // Treat comma/semicolon as a separator
            e.preventDefault();
            onAdd(draft);
          }
        }}
        onBlur={() => draft.trim() && onAdd(draft)}
        placeholder={values.length === 0 ? placeholder : ""}
        style={{
          flex: 1,
          minWidth: 140,
          padding: "4px 6px",
          border: 0,
          outline: "none",
          background: "transparent",
          fontSize: 12,
          fontFamily: "inherit",
          color: "var(--fm-text-primary)",
        }}
      />
    </div>
  );
}

function FoodJournalUploadSection({
  clientId,
  uploaded,
  uploading,
  setUploading,
  setUploaded,
}: {
  clientId: string;
  uploaded: string[];
  uploading: boolean;
  setUploading: (v: boolean) => void;
  setUploaded: React.Dispatch<React.SetStateAction<string[]>>;
}) {
  return (
    <div>
      <label
        style={{
          display: "block",
          padding: 20,
          border: "2px dashed var(--fm-border)",
          borderRadius: "var(--fm-radius-md)",
          background: "rgba(0,78,137,0.04)",
          textAlign: "center",
          cursor: uploading ? "wait" : "pointer",
          fontSize: 12,
          color: "var(--fm-text-secondary)",
        }}
      >
        <div style={{ fontSize: 22, marginBottom: 6 }}>🍽️</div>
        <strong>
          {uploading ? "Uploading…" : "Click or drop food journal files"}
        </strong>
        <div
          style={{
            marginTop: 4,
            fontSize: 11,
            color: "var(--fm-text-tertiary)",
          }}
        >
          PDF · image · markdown · text. Multiple files OK.
        </div>
        <input
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.webp,.md,.txt,application/pdf,image/*,text/markdown,text/plain"
          multiple
          disabled={uploading}
          onChange={async (e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length === 0) return;
            setUploading(true);
            try {
              for (const file of files) {
                const buf = await file.arrayBuffer();
                const fileDataBase64 = Buffer.from(buf).toString("base64");
                const r = await uploadReportAction({
                  clientId,
                  reportType: "food_journal",
                  fileDataBase64,
                  fileName: file.name,
                });
                if (r.ok && r.report) {
                  setUploaded((s) => [...s, r.report!.file_name]);
                  toast.success(`${file.name} uploaded`);
                } else {
                  toast.error(`${file.name}: ${r.error ?? "upload failed"}`);
                }
              }
            } finally {
              setUploading(false);
              e.target.value = "";
            }
          }}
          style={{ display: "none" }}
        />
      </label>
      {uploaded.length > 0 && (
        <div
          style={{
            marginTop: 8,
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
          }}
        >
          {uploaded.map((name) => (
            <span
              key={name}
              style={{
                fontSize: 12,
                padding: "4px 10px",
                background: "rgba(46, 204, 113, 0.10)",
                color: "var(--fm-success)",
                borderRadius: "var(--fm-radius-pill)",
                fontWeight: 600,
              }}
            >
              ✓ {name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function HealthDataPreview({
  data,
  onApply,
}: {
  data: ExtractedHealthData;
  onApply: () => Promise<void>;
}) {
  const labs = data.lab_values ?? [];
  const meds = data.medications ?? [];
  const conds = data.conditions ?? [];
  const meas = data.measurements ?? {};
  const measEntries = Object.entries(meas).filter(([, v]) => v != null);
  const hasAny =
    labs.length > 0 ||
    meds.length > 0 ||
    conds.length > 0 ||
    measEntries.length > 0;

  return (
    <div
      style={{
        marginTop: 8,
        padding: 12,
        background: "var(--fm-bg-cool)",
        border: "1px solid var(--fm-border-light)",
        borderRadius: "var(--fm-radius-md)",
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: 0.7,
          color: "var(--fm-text-tertiary)",
          marginBottom: 8,
        }}
      >
        AI extracted — review before applying
      </div>

      {!hasAny && (
        <div style={{ fontSize: 12, color: "var(--fm-text-tertiary)", fontStyle: "italic" }}>
          Nothing extractable in that text — try adding numbers/units (e.g. &quot;TSH 4.2&quot;).
        </div>
      )}

      {labs.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--fm-text-secondary)",
              marginBottom: 4,
            }}
          >
            Lab values ({labs.length})
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {labs.map((l, i) => (
              <span
                key={i}
                style={{
                  fontSize: 11,
                  padding: "3px 8px",
                  background: "var(--fm-surface)",
                  border: "1px solid var(--fm-border-light)",
                  borderRadius: "var(--fm-radius-sm)",
                }}
              >
                {l.test_name}: <strong>{l.value}</strong> {l.unit}
              </span>
            ))}
          </div>
        </div>
      )}

      {measEntries.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--fm-text-secondary)",
              marginBottom: 4,
            }}
          >
            Measurements
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {measEntries.map(([k, v]) => (
              <span
                key={k}
                style={{
                  fontSize: 11,
                  padding: "3px 8px",
                  background: "var(--fm-surface)",
                  border: "1px solid var(--fm-border-light)",
                  borderRadius: "var(--fm-radius-sm)",
                }}
              >
                {k}: <strong>{String(v)}</strong>
              </span>
            ))}
          </div>
        </div>
      )}

      {meds.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--fm-text-secondary)",
              marginBottom: 4,
            }}
          >
            Medications
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {meds.map((m) => (
              <span
                key={m}
                style={{
                  fontSize: 11,
                  padding: "3px 8px",
                  background: "var(--fm-surface)",
                  border: "1px solid var(--fm-border-light)",
                  borderRadius: "var(--fm-radius-sm)",
                }}
              >
                💊 {m}
              </span>
            ))}
          </div>
        </div>
      )}

      {conds.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--fm-text-secondary)",
              marginBottom: 4,
            }}
          >
            Conditions
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {conds.map((c) => (
              <span
                key={c}
                style={{
                  fontSize: 11,
                  padding: "3px 8px",
                  background: "rgba(255, 107, 53, 0.10)",
                  color: "var(--fm-primary)",
                  borderRadius: "var(--fm-radius-sm)",
                  fontWeight: 600,
                }}
              >
                {c}
              </span>
            ))}
          </div>
        </div>
      )}

      {hasAny && (
        <button
          type="button"
          onClick={onApply}
          style={{
            marginTop: 8,
            padding: "7px 14px",
            background: "var(--fm-primary)",
            color: "#fff",
            border: 0,
            borderRadius: "var(--fm-radius-sm)",
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          ✓ Apply to client profile
        </button>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * TranscriptUploadBox
 * Accepts PDF / TXT / MD / image. Streams file → uploadFileAction →
 * extractTranscriptAction. Calls onExtracted with matched symptom slugs
 * and the saved file path so the intake form can merge symptoms + record
 * the on-disk path in transcript_notes.
 * ──────────────────────────────────────────────────────────────────────── */
function TranscriptUploadBox({
  clientId,
  symptomCatalogue,
  onExtracted,
}: {
  clientId: string;
  symptomCatalogue: FmSymptomOption[];
  onExtracted: (matchedSlugs: string[], savedPaths: string[]) => void;
}) {
  const [fileName, setFileName] = useState("");
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [matched, setMatched] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, startBusy] = useTransition();

  const catalogueForExtract = symptomCatalogue.map((s) => ({
    slug: s.slug,
    label: s.label ?? s.slug,
    aliases: s.aliases ?? [],
  }));

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    setError(null);
    setMatched([]);
    setSavedPath(null);

    startBusy(async () => {
      try {
        const fd = new FormData();
        fd.append("client_id", clientId);
        fd.append("file", f);
        const path = await uploadFileAction(fd);
        setSavedPath(path);

        const result = await extractTranscriptAction(
          path,
          f.type || "application/octet-stream",
          catalogueForExtract,
          false,
        );
        if (!result.ok) {
          setError(result.error ?? "Extraction failed");
          toast.error("Transcript extraction failed");
          return;
        }
        const slugs = result.matched_slugs ?? [];
        setMatched(slugs);
        onExtracted(slugs, [path]);
        toast.success(
          `Transcript ingested · ${slugs.length} symptom${slugs.length === 1 ? "" : "s"} matched`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg.slice(0, 300));
        toast.error("Upload failed");
      }
    });
  };

  return (
    <div
      style={{
        border: "1px dashed var(--fm-border)",
        borderRadius: "var(--fm-radius-sm)",
        padding: 12,
        background: "var(--fm-bg-subtle)",
        display: "grid",
        gap: 8,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--fm-text)" }}>
        📎 Or upload a transcript file
      </div>
      <div style={{ fontSize: 11, color: "var(--fm-text-muted)" }}>
        PDF, TXT, MD, or image. The AI reads it and pre-populates the symptoms
        picker below. File is saved to{" "}
        <code style={{ fontSize: 10 }}>~/fm-plans/clients/{clientId}/files/</code>.
      </div>
      <input
        type="file"
        accept=".pdf,.txt,.md,.markdown,image/*,application/pdf,text/plain,text/markdown"
        onChange={onPick}
        disabled={busy}
        style={{ fontSize: 12 }}
      />
      {busy && (
        <div style={{ fontSize: 11, color: "var(--fm-text-muted)" }}>
          Extracting symptoms from {fileName}…
        </div>
      )}
      {savedPath && !busy && (
        <div style={{ fontSize: 11, color: "var(--fm-success, #15803d)" }}>
          ✓ Saved to {savedPath}
          {matched.length > 0 && (
            <> · {matched.length} symptom{matched.length === 1 ? "" : "s"} added to picker</>
          )}
        </div>
      )}
      {error && (
        <div style={{ fontSize: 11, color: "var(--fm-danger, #b91c1c)" }}>
          ✗ {error}
        </div>
      )}
    </div>
  );
}
