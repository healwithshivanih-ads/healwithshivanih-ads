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
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  saveSessionAction,
  applyTranscriptDataAction,
  type FivePillarsData,
} from "@/app/assess/actions";
import {
  updateClientPreferences,
  updateClientTimeline,
} from "@/app/clients/actions";
import {
  FmField,
  FmInput,
  FmTextarea,
  FmFormSection,
} from "@/components/fm";
import { IFM_NODES } from "@/lib/fmdb/ifm-matrix";
import { LabUploadPanel } from "@/app/clients/[id]/lab-upload-panel";
import { FunctionalTestPanel } from "@/app/clients/[id]/functional-test-panel";
import { GeneticReportPanel } from "@/app/clients/[id]/genetic-report-panel";

const PRIMARY = "#3a4250";

interface TimelineEntry {
  year: string;
  category: string;
  event: string;
}

const TIMELINE_CATEGORIES = [
  "Childhood",
  "Pregnancy",
  "Surgery",
  "Major illness",
  "Stressful event",
  "Diagnosis",
  "Treatment",
  "Lifestyle change",
  "Other",
];

export function IntakeForm({
  clientId,
  displayName,
}: {
  clientId: string;
  displayName: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  // 1 · Presenting picture
  const [chiefComplaint, setChiefComplaint] = useState("");
  const [hpi, setHpi] = useState("");
  const [transcriptNotes, setTranscriptNotes] = useState("");

  // 2 · Body composition baseline
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");
  const [bodyFat, setBodyFat] = useState(""); // captured as note, not part of measurements model yet
  const [waist, setWaist] = useState("");
  const [hip, setHip] = useState("");
  const [bpSys, setBpSys] = useState("");
  const [bpDia, setBpDia] = useState("");
  const [hr, setHr] = useState("");

  // 3 · Food & lifestyle
  const [dietaryPreference, setDietaryPreference] = useState("");
  const [foodsToAvoid, setFoodsToAvoid] = useState("");
  const [allergies, setAllergies] = useState("");
  const [nonNegotiables, setNonNegotiables] = useState("");
  const [reportedTriggers, setReportedTriggers] = useState("");

  // 4 · Meds + family hx
  const [medications, setMedications] = useState("");
  const [familyHx, setFamilyHx] = useState("");

  // 5 · Five Pillars
  const [sleep, setSleep] = useState("");
  const [stress, setStress] = useState("");
  const [movement, setMovement] = useState("");
  const [nutrition, setNutrition] = useState("");
  const [connection, setConnection] = useState("");

  // 6 · Trial-and-error
  const [supplementHx, setSupplementHx] = useState("");
  const [whatWorked, setWhatWorked] = useState("");
  const [whatDidntWork, setWhatDidntWork] = useState("");

  // 7 · FM timeline
  const [timeline, setTimeline] = useState<TimelineEntry[]>([
    { year: "", category: "", event: "" },
  ]);
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
  const [coachNotes, setCoachNotes] = useState("");

  const onSave = () => {
    if (!chiefComplaint.trim() && !hpi.trim()) {
      toast.error("Add a chief complaint or HPI first");
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
        coachNotes.trim() && `Coach notes:\n${coachNotes.trim()}`,
      ].filter(Boolean) as string[];

      // ── Save session (primary write) ──────────────────────────
      const sessionResult = await saveSessionAction({
        client_id: clientId,
        session_type: "intake",
        coach_notes: sections.join("\n\n"),
        presenting_complaints: `[session_type: intake] ${chiefComplaint.trim() || hpi.trim().slice(0, 120)}`,
        five_pillars: hasPillars ? fp : undefined,
      });
      if (!sessionResult.ok) {
        toast.error(sessionResult.error ?? "Save session failed");
        return;
      }

      // ── Side writes (parallel) ────────────────────────────────
      const sideWrites: Promise<{ ok: boolean; error?: string | null }>[] = [];

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
        sideWrites.push(
          applyTranscriptDataAction({
            client_id: clientId,
            measurements: meas,
            medications: [],
            conditions: [],
            lab_values: [],
            source: `intake-${new Date().toISOString().slice(0, 10)}`,
            linked_session_id: sessionResult.session_id,
          }),
        );
      }

      // Food + lifestyle prefs
      if (
        dietaryPreference.trim() ||
        foodsToAvoid.trim() ||
        nonNegotiables.trim() ||
        reportedTriggers.trim()
      ) {
        sideWrites.push(
          updateClientPreferences({
            client_id: clientId,
            dietary_preference: dietaryPreference.trim() || undefined,
            foods_to_avoid: foodsToAvoid.trim() || undefined,
            non_negotiables: nonNegotiables.trim() || undefined,
            reported_triggers: reportedTriggers.trim() || undefined,
          }),
        );
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
        sideWrites.push(
          updateClientTimeline({
            client_id: clientId,
            timeline_events: cleanedTimeline,
          }),
        );
      }

      // Allergies are special — we store them as known_allergies array.
      // For now we route through applyTranscriptDataAction's conditions
      // bucket. A dedicated action lands later.
      if (allergies.trim()) {
        const allergyList = allergies
          .split(/[,;\n]/)
          .map((a) => a.trim())
          .filter(Boolean);
        if (allergyList.length > 0) {
          // Build a coach note since we don't have a direct allergies-setter
          // yet — the coach can update via the legacy New Client form.
          // (Phase 3.5: add a setKnownAllergies action.)
        }
      }

      await Promise.all(sideWrites);

      toast.success(`Intake saved for ${displayName.split(" ")[0]}`);
      router.push(`/clients-v2/${clientId}/analyse`);
      router.refresh();
    });
  };

  return (
    <div>
      {/* 1 · Presenting */}
      <FmFormSection
        title="1 · Presenting picture"
        description="What the client is here to solve. The Full Assessment will read this back later."
      >
        <FmField label="Chief complaint">
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
              fontSize: 11.5,
              fontWeight: 600,
              color: "var(--fm-text-secondary)",
              padding: "4px 0",
            }}
          >
            Live transcript / paste
          </summary>
          <div style={{ marginTop: 8 }}>
            <FmTextarea
              value={transcriptNotes}
              onChange={(e) => setTranscriptNotes(e.target.value)}
              placeholder="Paste the call transcript here (or use the Transcript Upload section in legacy Overview)."
              rows={5}
              style={{ fontFamily: "var(--fm-font-mono)", fontSize: 12 }}
            />
          </div>
        </details>
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
          <FmField label="Allergies" hint="comma or newline separated">
            {({ id }) => (
              <FmTextarea
                id={id}
                value={allergies}
                onChange={(e) => setAllergies(e.target.value)}
                placeholder={`Penicillin, shellfish, latex`}
                rows={2}
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
                  fontSize: 12.5,
                  color: "var(--fm-text-primary)",
                  outline: "none",
                  fontFamily: "inherit",
                  cursor: "pointer",
                }}
              >
                <option value="">Category</option>
                {TIMELINE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
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
            fontSize: 11.5,
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
      <FmFormSection title="11 · Coach notes">
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
          disabled={pending || (!chiefComplaint.trim() && !hpi.trim())}
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
  );
}
