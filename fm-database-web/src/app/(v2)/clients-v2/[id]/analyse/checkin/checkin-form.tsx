"use client";

/**
 * CheckInForm v2 — design C5.
 *
 * 5-point adherence scale · 5 measurement tiles · Five Pillars row ·
 * quick lab orders · coach notes. Saves through saveSessionAction with
 * session_type "check_in".
 *
 * Active plan slug, if any, is recorded in coach_notes so the timeline
 * view shows context. Five Pillars values are passed through so the
 * OutcomeProgressCard on Overview can chart them.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  saveSessionAction,
  appendCheckInToPlanAction,
  type FivePillarsData,
} from "@/lib/server-actions/assess";
import { addMeasurementAction } from "@/lib/server-actions/clients";
import {
  FmField,
  FmInput,
  FmTextarea,
  FmFormSection,
} from "@/components/fm";

const PRIMARY = "#1E8449";

const ADHERENCE_OPTIONS = [
  { value: 5, label: "All on", color: "#1E8449" },
  { value: 4, label: "Mostly", color: "#27AE60" },
  { value: 3, label: "Half", color: "#F39C12" },
  { value: 2, label: "Started slipping", color: "#E67E22" },
  { value: 1, label: "Off-plan", color: "#E74C3C" },
] as const;

const QUICK_LABS = [
  "fT3 / rT3 only",
  "TPO / TgAb recheck",
  "Fasting insulin",
  "HbA1c",
  "Vit D 25-OH",
  "Ferritin",
  "hsCRP",
  "Homocysteine",
  "DUTCH cortisol",
];

/** Read-only snapshot of the client's last-known measurements, surfaced
 *  above the input fields so the coach can compare and decide whether
 *  values reported on this call (e.g. "I'm 1 kg down") look plausible
 *  before typing them in. Date strings are YYYY-MM-DD. */
export interface PreviousMeasurementSnapshot {
  date?: string;             // when the previous reading was logged
  weight_kg?: number;
  waist_cm?: number;
  hip_cm?: number;
  bp_systolic?: number;
  bp_diastolic?: number;
  hr_bpm?: number;
}

export function CheckInForm({
  clientId,
  displayName,
  activePlanSlug,
  activePlanRecheckDate,
  previousMeasurements,
}: {
  clientId: string;
  displayName: string;
  activePlanSlug?: string;
  /** ISO YYYY-MM-DD recheck date for the active plan (when one is set).
   *  Used to surface a "Generate follow-up now?" prompt after check-in
   *  save when the recheck falls within 7 days. */
  activePlanRecheckDate?: string;
  /** Last-known measurements for this client. Surfaced as read-only
   *  context above the input fields — coach types the new values in
   *  manually, never auto-applied. */
  previousMeasurements?: PreviousMeasurementSnapshot | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const [sessionDate, setSessionDate] = useState(
    () => new Date().toISOString().slice(0, 10),
  );

  const [adherence, setAdherence] = useState<number | null>(4); // default "mostly"
  const [adherenceNotes, setAdherenceNotes] = useState("");

  const [weight, setWeight] = useState("");
  const [waist, setWaist] = useState("");
  const [bpSys, setBpSys] = useState("");
  const [bpDia, setBpDia] = useState("");
  const [hr, setHr] = useState("");

  const [sleep, setSleep] = useState(""); // hours
  const [stress, setStress] = useState(""); // /5
  const [movement, setMovement] = useState(""); // days/wk
  const [nutrition, setNutrition] = useState(""); // /5
  const [connection, setConnection] = useState(""); // /5

  const [labs, setLabs] = useState<string[]>([]);
  const [customLab, setCustomLab] = useState("");
  const [notes, setNotes] = useState("");

  const toggleLab = (l: string) =>
    setLabs((cur) => (cur.includes(l) ? cur.filter((x) => x !== l) : [...cur, l]));
  const addCustomLab = () => {
    const c = customLab.trim();
    if (!c || labs.includes(c)) return;
    setLabs((cur) => [...cur, c]);
    setCustomLab("");
  };

  const onSave = () => {
    if (adherence == null) {
      toast.error("Pick an adherence rating first");
      return;
    }
    start(async () => {
      const adhLabel = ADHERENCE_OPTIONS.find((o) => o.value === adherence)?.label;
      const meas: string[] = [];
      if (weight) meas.push(`weight ${weight} kg`);
      if (waist) meas.push(`waist ${waist} cm`);
      if (bpSys && bpDia) meas.push(`BP ${bpSys}/${bpDia} mmHg`);
      if (hr) meas.push(`HR ${hr} bpm`);

      const sections: string[] = [
        `Adherence: ${adherence}/5 — ${adhLabel}`,
        activePlanSlug ? `Active plan: ${activePlanSlug}` : "",
        adherenceNotes.trim() ? `Adherence notes: ${adherenceNotes.trim()}` : "",
        meas.length ? `Measurements: ${meas.join(", ")}` : "",
        labs.length ? `Labs requested: ${labs.join(", ")}` : "",
        notes.trim() ? `Coach notes: ${notes.trim()}` : "",
      ].filter(Boolean);

      const fp: FivePillarsData = {};
      if (sleep) fp.sleep_hours = Number(sleep);
      if (stress) fp.stress_level = Number(stress);
      if (movement) fp.movement_days_per_week = Number(movement);
      if (nutrition) fp.nutrition_quality = Number(nutrition);
      if (connection) fp.connection_quality = Number(connection);
      const hasPillars = Object.keys(fp).length > 0;

      const result = await saveSessionAction({
        client_id: clientId,
        session_type: "check_in",
        session_date: sessionDate,
        coach_notes: sections.join("\n\n"),
        presenting_complaints: `[session_type: check_in] adherence ${adherence}/5`,
        requested_labs: labs.length ? labs : undefined,
        five_pillars: hasPillars ? fp : undefined,
      });
      if (result.ok) {
        toast.success(`Check-in saved for ${displayName.split(" ")[0]}`);

        // Also flow measurements into client.measurements_log so the body
        // composition trend tile + plan-outcomes panel + dashboard health
        // signals all see the new value. Without this, check-in
        // measurements live as text inside coach_notes and are invisible
        // to every numeric/trend surface. Fired in parallel with the
        // plan-notes append below — both are best-effort: if they fail,
        // the session itself is still saved.
        const hasMeasurement =
          weight || waist || bpSys || bpDia || hr;
        if (hasMeasurement) {
          const w = weight ? parseFloat(weight) : undefined;
          const wc = waist ? parseFloat(waist) : undefined;
          const bps = bpSys ? parseFloat(bpSys) : undefined;
          const bpd = bpDia ? parseFloat(bpDia) : undefined;
          const hrate = hr ? parseFloat(hr) : undefined;
          const measResult = await addMeasurementAction({
            client_id: clientId,
            date: sessionDate,
            weight_kg: Number.isFinite(w) ? w : undefined,
            waist_cm: Number.isFinite(wc) ? wc : undefined,
            blood_pressure_systolic: Number.isFinite(bps) ? bps : undefined,
            blood_pressure_diastolic: Number.isFinite(bpd) ? bpd : undefined,
            resting_heart_rate: Number.isFinite(hrate) ? hrate : undefined,
            notes: `from check-in ${result.session_id ?? sessionDate}`,
          });
          if (!measResult.ok) {
            toast.warning(
              `Measurements not added to log: ${measResult.error}`,
            );
          }
        }

        // Also append to plan.notes_for_coach so the next letter generation
        // (week 3-4 phase, supplement plan, lifestyle guide, etc.) sees this
        // check-in baked into the plan itself — not just in the session
        // file. This was the v0.56 spec; V2 redesign dropped the call.
        // Re-added 2026-05-18 after cl-004 phase letter would have missed
        // travel + supplement adjustments.
        if (activePlanSlug) {
          const planNote = sections.join("\n");
          const appendResult = await appendCheckInToPlanAction(
            activePlanSlug,
            planNote,
            sessionDate,
          );
          if (!appendResult.ok) {
            // Don't block on append failure — session is saved either way.
            toast.warning(
              `Session saved, but plan note append failed: ${appendResult.error}`,
            );
          }
        }

        // If the active plan's recheck date is within 7 days, surface a
        // toast inviting the coach to generate the follow-up draft right
        // now — saves her having to navigate to /plan + scroll to the
        // FollowUpPanel. Toast click deep-links to /plan where the panel
        // lives. Window of 7 days = the "due soon" bucket the dashboard
        // already uses.
        let followUpPromptFired = false;
        if (activePlanSlug && activePlanRecheckDate) {
          try {
            const recheckMs = Date.parse(activePlanRecheckDate);
            const todayMs = Date.parse(new Date().toISOString().slice(0, 10));
            const daysUntilRecheck = Math.round(
              (recheckMs - todayMs) / 86_400_000,
            );
            if (
              Number.isFinite(daysUntilRecheck) &&
              daysUntilRecheck <= 7
            ) {
              const overdue = daysUntilRecheck < 0;
              toast.message(
                overdue
                  ? `⏰ Recheck is ${Math.abs(daysUntilRecheck)} day${Math.abs(daysUntilRecheck) === 1 ? "" : "s"} overdue`
                  : daysUntilRecheck === 0
                    ? `⏰ Recheck is due today`
                    : `⏰ Recheck is ${daysUntilRecheck} day${daysUntilRecheck === 1 ? "" : "s"} away`,
                {
                  description:
                    "Generate the follow-up draft now while this check-in is fresh.",
                  duration: 12000,
                  action: {
                    label: "Generate →",
                    onClick: () => {
                      router.push(`/clients-v2/${clientId}/plan#follow-up`);
                    },
                  },
                },
              );
              followUpPromptFired = true;
            }
          } catch {
            // Recheck date parsing failed — silent fallback, skip prompt.
          }
        }

        router.push(`/clients-v2/${clientId}/analyse`);
        router.refresh();
        void followUpPromptFired;
      } else {
        toast.error(result.error ?? "Save failed");
      }
    });
  };

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
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
      </div>

      {/* Adherence + measurements */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 14,
          marginBottom: 14,
        }}
      >
        <FmFormSection title="Plan adherence (last 2 weeks)">
          <div style={{ display: "flex", gap: 4 }}>
            {ADHERENCE_OPTIONS.map((o) => {
              const sel = adherence === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setAdherence(o.value)}
                  style={{
                    flex: 1,
                    padding: "10px 4px",
                    borderRadius: "var(--fm-radius-sm)",
                    border: `1.5px solid ${sel ? o.color : "var(--fm-border-light)"}`,
                    background: sel ? `${o.color}10` : "var(--fm-surface)",
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  <div
                    style={{
                      fontSize: 18,
                      fontWeight: 700,
                      color: o.color,
                      lineHeight: 1,
                    }}
                  >
                    {o.value}
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      color: "var(--fm-text-secondary)",
                      fontWeight: 600,
                      marginTop: 4,
                    }}
                  >
                    {o.label}
                  </div>
                </button>
              );
            })}
          </div>
          <FmField label="What slipped, what stuck?">
            {({ id }) => (
              <FmTextarea
                id={id}
                value={adherenceNotes}
                onChange={(e) => setAdherenceNotes(e.target.value)}
                placeholder={`e.g. Mostly · skipped magnesium on travel days (3). Levo/calcium timing — figured out the 4-hr gap. Saffron tolerated well.`}
                rows={3}
              />
            )}
          </FmField>
        </FmFormSection>

        <FmFormSection
          title="Quick measurements"
          description="Whatever you took this call. Leave blank if not measured."
        >
          {previousMeasurements && (
            <div
              style={{
                marginBottom: 12,
                padding: "8px 10px",
                background: "var(--fm-bg-cool)",
                border: "1px solid var(--fm-border-light)",
                borderRadius: "var(--fm-radius-sm)",
                fontSize: 11,
                color: "var(--fm-text-secondary)",
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: 0.6,
                  fontWeight: 700,
                  color: "var(--fm-text-tertiary)",
                  marginBottom: 4,
                }}
              >
                Previous reading
                {previousMeasurements.date
                  ? ` · ${previousMeasurements.date}`
                  : ""}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px" }}>
                {previousMeasurements.weight_kg != null && (
                  <span>
                    Weight <strong>{previousMeasurements.weight_kg} kg</strong>
                  </span>
                )}
                {previousMeasurements.waist_cm != null && (
                  <span>
                    Waist <strong>{previousMeasurements.waist_cm} cm</strong>
                  </span>
                )}
                {previousMeasurements.hip_cm != null && (
                  <span>
                    Hip <strong>{previousMeasurements.hip_cm} cm</strong>
                  </span>
                )}
                {previousMeasurements.bp_systolic != null &&
                  previousMeasurements.bp_diastolic != null && (
                    <span>
                      BP{" "}
                      <strong>
                        {previousMeasurements.bp_systolic}/
                        {previousMeasurements.bp_diastolic} mmHg
                      </strong>
                    </span>
                  )}
                {previousMeasurements.hr_bpm != null && (
                  <span>
                    HR <strong>{previousMeasurements.hr_bpm} bpm</strong>
                  </span>
                )}
                {previousMeasurements.weight_kg == null &&
                  previousMeasurements.waist_cm == null &&
                  previousMeasurements.bp_systolic == null &&
                  previousMeasurements.hr_bpm == null && (
                    <span style={{ fontStyle: "italic" }}>
                      No previous measurements on file — this will be the first
                      reading.
                    </span>
                  )}
              </div>
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <FmField label="Weight" hint="kg">
              {({ id }) => (
                <FmInput
                  id={id}
                  type="number"
                  step="0.1"
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                  placeholder="68.4"
                />
              )}
            </FmField>
            <FmField label="Waist" hint="cm">
              {({ id }) => (
                <FmInput
                  id={id}
                  type="number"
                  step="0.1"
                  value={waist}
                  onChange={(e) => setWaist(e.target.value)}
                  placeholder="82"
                />
              )}
            </FmField>
            <FmField label="BP systolic" hint="mmHg">
              {({ id }) => (
                <FmInput
                  id={id}
                  type="number"
                  value={bpSys}
                  onChange={(e) => setBpSys(e.target.value)}
                  placeholder="118"
                />
              )}
            </FmField>
            <FmField label="BP diastolic" hint="mmHg">
              {({ id }) => (
                <FmInput
                  id={id}
                  type="number"
                  value={bpDia}
                  onChange={(e) => setBpDia(e.target.value)}
                  placeholder="76"
                />
              )}
            </FmField>
            <FmField label="Resting HR" hint="bpm">
              {({ id }) => (
                <FmInput
                  id={id}
                  type="number"
                  value={hr}
                  onChange={(e) => setHr(e.target.value)}
                  placeholder="68"
                />
              )}
            </FmField>
          </div>
        </FmFormSection>
      </div>

      <FmFormSection
        title="Five Pillars this fortnight"
        description="Sleep · stress · movement · nutrition · connection. Leave blank if not asked."
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
                min={0}
                max={24}
                value={sleep}
                onChange={(e) => setSleep(e.target.value)}
                placeholder="7.5"
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
                placeholder="3"
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
                placeholder="4"
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
                placeholder="4"
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

      <FmFormSection
        title="New lab orders (optional)"
        description="Pick from quick-add, or add a custom marker."
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {QUICK_LABS.map((l) => {
            const sel = labs.includes(l);
            return (
              <button
                key={l}
                type="button"
                onClick={() => toggleLab(l)}
                style={{
                  padding: "5px 12px",
                  borderRadius: "var(--fm-radius-pill)",
                  fontSize: 12,
                  fontWeight: 600,
                  background: sel ? PRIMARY : "var(--fm-surface)",
                  color: sel ? "#fff" : "var(--fm-text-secondary)",
                  border: sel
                    ? "1px solid transparent"
                    : "1px solid var(--fm-border-light)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {l}
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <FmInput
            value={customLab}
            onChange={(e) => setCustomLab(e.target.value)}
            placeholder="Add custom lab marker…"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCustomLab();
              }
            }}
            style={{ flex: 1 }}
          />
          <button
            type="button"
            onClick={addCustomLab}
            disabled={!customLab.trim()}
            style={{
              padding: "8px 14px",
              fontSize: 12,
              fontWeight: 600,
              background: "var(--fm-surface)",
              border: "1px solid var(--fm-border)",
              borderRadius: "var(--fm-radius-sm)",
              cursor: customLab.trim() ? "pointer" : "not-allowed",
              opacity: customLab.trim() ? 1 : 0.5,
              fontFamily: "inherit",
            }}
          >
            + Add
          </button>
        </div>
        {labs.length > 0 && (
          <div style={{ fontSize: 11, color: "var(--fm-text-tertiary)" }}>
            {labs.length} lab{labs.length === 1 ? "" : "s"} queued.
          </div>
        )}
      </FmFormSection>

      <FmFormSection title="Coach notes">
        <FmField label="Free text">
          {({ id }) => (
            <FmTextarea
              id={id}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Sleep is the keystone — when she gets 7+ hr every pillar lifts. Consider glycine 3 g pre-bed."
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
          disabled={pending || adherence == null}
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
          {pending ? "Saving…" : "💾 Save check-in →"}
        </button>
      </div>
    </div>
  );
}
