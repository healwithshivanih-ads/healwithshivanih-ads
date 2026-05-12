"use client";

/**
 * IntakeForm v2 — design C3.
 *
 * One-time deep history call. Captures:
 *   - Optional transcript paste / file pointer (free text for now;
 *     file upload + Haiku extraction lands in Phase 3.5)
 *   - Chief complaint + history of present illness
 *   - Current medications list (one per line)
 *   - Family history textarea
 *   - Baseline Five Pillars (sleep / stress / movement / nutrition / connection)
 *   - Supplement history
 *   - What's worked / what hasn't
 *   - Coach notes
 *
 * Saves through saveSessionAction with session_type "intake". Five Pillars
 * captured here become the baseline for the OutcomeProgressCard on
 * Overview — every check-in compares against it.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { saveSessionAction, type FivePillarsData } from "@/app/assess/actions";
import {
  FmField,
  FmInput,
  FmTextarea,
  FmFormSection,
} from "@/components/fm";

const PRIMARY = "#3a4250";

export function IntakeForm({
  clientId,
  displayName,
}: {
  clientId: string;
  displayName: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const [chiefComplaint, setChiefComplaint] = useState("");
  const [hpi, setHpi] = useState("");
  const [transcriptNotes, setTranscriptNotes] = useState("");
  const [medications, setMedications] = useState("");
  const [familyHx, setFamilyHx] = useState("");
  const [supplementHx, setSupplementHx] = useState("");

  const [sleep, setSleep] = useState("");
  const [stress, setStress] = useState("");
  const [movement, setMovement] = useState("");
  const [nutrition, setNutrition] = useState("");
  const [connection, setConnection] = useState("");

  const [whatWorked, setWhatWorked] = useState("");
  const [whatDidntWork, setWhatDidntWork] = useState("");
  const [coachNotes, setCoachNotes] = useState("");

  const onSave = () => {
    if (!chiefComplaint.trim() && !hpi.trim()) {
      toast.error("Add a chief complaint or history of present illness first");
      return;
    }
    start(async () => {
      const fp: FivePillarsData = {};
      if (sleep) fp.sleep_hours = Number(sleep);
      if (stress) fp.stress_level = Number(stress);
      if (movement) fp.movement_days_per_week = Number(movement);
      if (nutrition) fp.nutrition_quality = Number(nutrition);
      if (connection) fp.connection_quality = Number(connection);
      const hasPillars = Object.keys(fp).length > 0;

      const sections: string[] = [
        chiefComplaint.trim() && `Chief complaint:\n${chiefComplaint.trim()}`,
        hpi.trim() && `History of present illness:\n${hpi.trim()}`,
        transcriptNotes.trim() && `Transcript / live notes:\n${transcriptNotes.trim()}`,
        medications.trim() && `Current medications:\n${medications.trim()}`,
        supplementHx.trim() && `Supplement history:\n${supplementHx.trim()}`,
        familyHx.trim() && `Family history:\n${familyHx.trim()}`,
        whatWorked.trim() && `What's worked: ${whatWorked.trim()}`,
        whatDidntWork.trim() && `What hasn't worked: ${whatDidntWork.trim()}`,
        coachNotes.trim() && `Coach notes:\n${coachNotes.trim()}`,
      ].filter(Boolean) as string[];

      const result = await saveSessionAction({
        client_id: clientId,
        session_type: "intake",
        coach_notes: sections.join("\n\n"),
        presenting_complaints: `[session_type: intake] ${chiefComplaint.trim() || hpi.trim().slice(0, 120)}`,
        five_pillars: hasPillars ? fp : undefined,
      });
      if (result.ok) {
        toast.success(`Intake saved for ${displayName.split(" ")[0]}`);
        router.push(`/clients-v2/${clientId}/analyse`);
        router.refresh();
      } else {
        toast.error(result.error ?? "Save failed");
      }
    });
  };

  return (
    <div>
      <FmFormSection
        title="Presenting picture"
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
        <FmField
          label="History of present illness"
          hint="When did it start, what changed, what makes it better/worse?"
        >
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
        <FmField
          label="Transcript / live notes"
          hint="Paste from Otter / Zoom / coach scratch — Phase 3.5 adds file upload + Haiku extraction"
        >
          {({ id }) => (
            <FmTextarea
              id={id}
              value={transcriptNotes}
              onChange={(e) => setTranscriptNotes(e.target.value)}
              placeholder="Paste the call transcript here, or leave blank if you'll upload it later."
              rows={5}
              style={{ fontFamily: "var(--fm-font-mono)", fontSize: 12 }}
            />
          )}
        </FmField>
      </FmFormSection>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 14,
          marginBottom: 14,
        }}
      >
        <FmFormSection title="Current medications" description="One per line: name · dose · how long.">
          <FmTextarea
            value={medications}
            onChange={(e) => setMedications(e.target.value)}
            placeholder={`Levothyroxine · 50 mcg AM empty stomach · 2 yrs\nVitamin D3 · 60 000 IU weekly · 6 mo\nOCP — Yasmin · discontinued 4 mo ago`}
            rows={7}
            style={{ fontFamily: "var(--fm-font-mono)", fontSize: 12 }}
          />
        </FmFormSection>
        <FmFormSection title="Family history" description="Genetic and FM-relevant patterns.">
          <FmTextarea
            value={familyHx}
            onChange={(e) => setFamilyHx(e.target.value)}
            placeholder={`Mother — Hashimoto's dx at 38\nMaternal grandmother — T2D\nFather — anxiety\nNo cancer or autoimmune history`}
            rows={7}
          />
        </FmFormSection>
      </div>

      <FmFormSection
        title="Five Pillars baseline"
        description="Where the client sits today, before any intervention. Becomes the comparator for every future check-in."
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(5, 1fr)",
            gap: 8,
          }}
        >
          <FmField label="Sleep" hint="hr/night">
            {({ id }) => (
              <FmInput
                id={id}
                type="number"
                step="0.5"
                value={sleep}
                onChange={(e) => setSleep(e.target.value)}
                placeholder="6.5"
              />
            )}
          </FmField>
          <FmField label="Stress" hint="1–5">
            {({ id }) => (
              <FmInput
                id={id}
                type="number"
                min={1}
                max={5}
                value={stress}
                onChange={(e) => setStress(e.target.value)}
                placeholder="4"
              />
            )}
          </FmField>
          <FmField label="Movement" hint="days/wk">
            {({ id }) => (
              <FmInput
                id={id}
                type="number"
                min={0}
                max={7}
                value={movement}
                onChange={(e) => setMovement(e.target.value)}
                placeholder="2"
              />
            )}
          </FmField>
          <FmField label="Nutrition" hint="1–5">
            {({ id }) => (
              <FmInput
                id={id}
                type="number"
                min={1}
                max={5}
                value={nutrition}
                onChange={(e) => setNutrition(e.target.value)}
                placeholder="3"
              />
            )}
          </FmField>
          <FmField label="Connection" hint="1–5">
            {({ id }) => (
              <FmInput
                id={id}
                type="number"
                min={1}
                max={5}
                value={connection}
                onChange={(e) => setConnection(e.target.value)}
                placeholder="4"
              />
            )}
          </FmField>
        </div>
      </FmFormSection>

      <FmFormSection title="History of trial-and-error">
        <FmField
          label="Supplement history"
          hint="Anything they've tried recently — what brand, dose, duration."
        >
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

      <FmFormSection title="Coach notes">
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
          padding: "8px 0",
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
            padding: "8px 18px",
            background: PRIMARY,
            color: "#fff",
            border: 0,
            borderRadius: "var(--fm-radius-sm)",
            fontSize: 12,
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
