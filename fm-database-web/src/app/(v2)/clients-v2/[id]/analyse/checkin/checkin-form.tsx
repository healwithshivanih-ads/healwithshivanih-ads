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
import { saveSessionAction, type FivePillarsData } from "@/app/assess/actions";
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

export function CheckInForm({
  clientId,
  displayName,
  activePlanSlug,
}: {
  clientId: string;
  displayName: string;
  activePlanSlug?: string;
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
        router.push(`/clients-v2/${clientId}/analyse`);
        router.refresh();
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
                      fontSize: 9.5,
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
                  fontSize: 11.5,
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
