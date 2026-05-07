"use client";

/**
 * CheckInForm — lightweight progress check-in.
 * Records how the client is responding to the current plan,
 * current measurements, new symptoms, and coach notes.
 * No AI. Saves a session record.
 */

import { useState } from "react";
import { toast } from "sonner";
import { saveSessionAction, appendCheckInToPlanAction } from "@/app/assess/actions";
import { updateClientPreferences } from "@/app/clients/actions";

// ── Progress rating options ──────────────────────────────────────────────────

const PROGRESS_OPTIONS = [
  { value: "thriving",   label: "Thriving",   icon: "🌟", desc: "Significant improvement across most symptoms", color: "bg-emerald-50 border-emerald-300 text-emerald-800" },
  { value: "improving",  label: "Improving",  icon: "📈", desc: "Noticeable progress, heading in right direction", color: "bg-blue-50 border-blue-300 text-blue-800" },
  { value: "stable",     label: "Stable",     icon: "➡️", desc: "Holding steady, some areas improving slowly", color: "bg-amber-50 border-amber-300 text-amber-800" },
  { value: "struggling", label: "Struggling", icon: "⚠️", desc: "Limited progress or new challenges emerging", color: "bg-orange-50 border-orange-300 text-orange-800" },
  { value: "worsening",  label: "Worsening",  icon: "🔴", desc: "Symptoms deteriorating — protocol review needed", color: "bg-red-50 border-red-300 text-red-800" },
];

// ── Protocol adherence options ────────────────────────────────────────────────

const ADHERENCE_OPTIONS = [
  { value: "full",    label: "Fully",    icon: "✅", desc: "90–100% — taking everything as prescribed",  color: "bg-emerald-50 border-emerald-300 text-emerald-800" },
  { value: "mostly",  label: "Mostly",   icon: "🟢", desc: "75–90% — missing occasionally",              color: "bg-blue-50 border-blue-300 text-blue-800" },
  { value: "partial", label: "Partial",  icon: "🟡", desc: "25–75% — following some but not all",        color: "bg-amber-50 border-amber-300 text-amber-800" },
  { value: "low",     label: "Low",      icon: "🔴", desc: "Under 25% — struggling to follow protocol",  color: "bg-red-50 border-red-300 text-red-800" },
] as const;

// ── Common new symptoms for quick-add ─────────────────────────────────────────

const QUICK_SYMPTOMS = [
  "New headaches", "Increased fatigue", "Bloating worse", "Sleep disrupted",
  "Mood dip", "New joint pain", "Skin breakout", "Digestive upset",
  "Heart palpitations", "Brain fog worse", "Nausea", "Constipation",
];

// ── Common lab panels for mid-protocol re-order ───────────────────────────────

const QUICK_LABS = [
  { group: "Thyroid",     items: ["TSH, fT3, fT4", "Reverse T3", "TPO + TgAb antibodies"] },
  { group: "Hormones",    items: ["Estradiol, Progesterone, Testosterone", "DHEA-S, Cortisol (AM)", "DUTCH hormone panel"] },
  { group: "Metabolic",   items: ["HbA1c + Fasting Insulin", "Lipid Panel + ApoB", "hsCRP + Homocysteine"] },
  { group: "Nutrients",   items: ["Vitamin D (25-OH)", "B12 + Folate + MMA", "Ferritin + Iron panel"] },
  { group: "Gut",         items: ["GI Map stool analysis", "Organic acids test (OAT)", "SIBO breath test"] },
  { group: "General",     items: ["CBC with differential", "Comprehensive metabolic panel (CMP)", "Food sensitivity panel (IgG)"] },
];

// ── Component ────────────────────────────────────────────────────────────────

interface CheckInFormProps {
  clientId: string;
  currentPlanSlug?: string;
  currentReportedTriggers?: string;
  onSaved?: (sessionId: string) => void;
}

export function CheckInForm({ clientId, currentPlanSlug, currentReportedTriggers, onSaved }: CheckInFormProps) {
  const [progress, setProgress] = useState<string>("");
  const [sessionDate, setSessionDate] = useState<string>(
    new Date().toISOString().slice(0, 10)
  );
  const [newSymptoms, setNewSymptoms] = useState<string[]>([]);
  const [customSymptom, setCustomSymptom] = useState("");
  const [measurements, setMeasurements] = useState({
    weight_kg: "",
    bp_systolic: "",
    bp_diastolic: "",
    hr_bpm: "",
    waist_cm: "",
  });
  const [adherence, setAdherence] = useState<string>("");
  const [clientFeedback, setClientFeedback] = useState("");
  const [coachNotes, setCoachNotes] = useState("");
  const [sessionTriggers, setSessionTriggers] = useState("");
  const [triggersSaved, setTriggersSaved] = useState(false);
  const [requestedLabs, setRequestedLabs] = useState<string[]>([]);
  const [customLab, setCustomLab] = useState("");
  const [saving, setSaving] = useState(false);

  function toggleSymptom(s: string) {
    setNewSymptoms((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );
  }

  function addCustomSymptom() {
    if (customSymptom.trim() && !newSymptoms.includes(customSymptom.trim())) {
      setNewSymptoms((prev) => [...prev, customSymptom.trim()]);
      setCustomSymptom("");
    }
  }

  function toggleLab(lab: string) {
    setRequestedLabs((prev) =>
      prev.includes(lab) ? prev.filter((x) => x !== lab) : [...prev, lab]
    );
  }

  function addCustomLab() {
    if (customLab.trim() && !requestedLabs.includes(customLab.trim())) {
      setRequestedLabs((prev) => [...prev, customLab.trim()]);
      setCustomLab("");
    }
  }

  async function handleSave() {
    if (!progress) {
      toast.error("Please select a progress rating.");
      return;
    }
    setSaving(true);

    // Build presenting complaints from all check-in data
    const parts: string[] = [];
    const ratingOption = PROGRESS_OPTIONS.find((o) => o.value === progress);
    if (ratingOption) {
      parts.push(`Progress: ${ratingOption.label} ${ratingOption.icon} — ${ratingOption.desc}`);
    }
    if (currentPlanSlug) parts.push(`Active plan: ${currentPlanSlug}`);
    if (newSymptoms.length > 0) parts.push(`New/changed symptoms: ${newSymptoms.join(", ")}`);
    if (clientFeedback.trim()) parts.push(`Client feedback: ${clientFeedback}`);

    // Measurements string for notes
    const measParts: string[] = [];
    if (measurements.weight_kg)   measParts.push(`weight ${measurements.weight_kg}kg`);
    if (measurements.bp_systolic && measurements.bp_diastolic)
      measParts.push(`BP ${measurements.bp_systolic}/${measurements.bp_diastolic} mmHg`);
    if (measurements.hr_bpm)      measParts.push(`HR ${measurements.hr_bpm} bpm`);
    if (measurements.waist_cm)    measParts.push(`waist ${measurements.waist_cm}cm`);
    if (measParts.length > 0) parts.push(`Measurements: ${measParts.join(", ")}`);

    const fullComplaints = parts.join("\n");
    const noteParts: string[] = [];
    if (coachNotes.trim()) noteParts.push(coachNotes);

    try {
      const result = await saveSessionAction({
        client_id: clientId,
        session_type: "check_in",
        session_date: sessionDate,
        selected_symptoms: newSymptoms.filter((s) =>
          // only slugs (no spaces) go into selected_symptoms; custom text goes to notes
          !s.includes(" ")
        ),
        presenting_complaints: fullComplaints,
        coach_notes: noteParts.join("\n"),
        requested_labs: requestedLabs.length > 0 ? requestedLabs : undefined,
      });

      if (result.ok && result.session_id) {
        toast.success(`Check-in saved — ${result.session_id}`);
        onSaved?.(result.session_id);

        // Save reported triggers to client profile if any were entered this session
        if (sessionTriggers.trim()) {
          const existingTriggers = currentReportedTriggers?.trim() ?? "";
          const newEntry = sessionTriggers.trim();
          const merged = existingTriggers
            ? `${existingTriggers}, ${newEntry}`
            : newEntry;
          const trigRes = await updateClientPreferences({
            client_id: clientId,
            reported_triggers: merged,
          });
          if (trigRes.ok) {
            setTriggersSaved(true);
            toast.success(`Trigger saved to profile: "${newEntry}"`);
          } else {
            toast.error(`Check-in saved, but couldn't update triggers: ${trigRes.error}`);
          }
        }

        // If there's an active plan, append a structured note to its notes_for_coach
        if (currentPlanSlug) {
          const noteSections: string[] = [];
          const ratingOption = PROGRESS_OPTIONS.find((o) => o.value === progress);
          if (ratingOption) {
            noteSections.push(`**Progress:** ${ratingOption.icon} ${ratingOption.label} — ${ratingOption.desc}`);
          }
          const adherenceOption = ADHERENCE_OPTIONS.find((o) => o.value === adherence);
          if (adherenceOption) {
            noteSections.push(`**Protocol adherence:** ${adherenceOption.icon} ${adherenceOption.label} — ${adherenceOption.desc}`);
          }
          if (newSymptoms.length > 0) {
            noteSections.push(`**New/changed symptoms:** ${newSymptoms.join(", ")}`);
          }
          if (measParts.length > 0) {
            noteSections.push(`**Measurements:** ${measParts.join(", ")}`);
          }
          if (requestedLabs.length > 0) {
            noteSections.push(`**Labs ordered:** ${requestedLabs.join(", ")}`);
          }
          if (sessionTriggers.trim()) {
            noteSections.push(`**⚠ Food reaction reported:** ${sessionTriggers.trim()} — added to client trigger profile`);
          }
          if (clientFeedback.trim()) {
            noteSections.push(`**Client feedback:** ${clientFeedback.trim()}`);
          }
          if (coachNotes.trim()) {
            noteSections.push(`**Coach notes:** ${coachNotes.trim()}`);
          }

          const planNote = noteSections.join("\n");
          const appendResult = await appendCheckInToPlanAction(
            currentPlanSlug,
            planNote,
            sessionDate,
          );
          if (appendResult.ok) {
            toast.success(`Also logged to plan: ${currentPlanSlug}`);
          } else {
            toast.error(`Saved session, but couldn't update plan: ${appendResult.error}`);
          }
        }
      } else {
        toast.error(result.error ?? "Failed to save check-in.");
      }
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div
        className="rounded-xl px-5 py-4"
        style={{ background: "var(--brand-bone)" }}
      >
        <h3
          className="font-brand text-lg font-bold mb-0.5"
          style={{ color: "var(--brand-indigo)" }}
        >
          💬 Check-in — Progress Review
        </h3>
        <p className="text-xs" style={{ color: "var(--brand-lavender)" }}>
          {currentPlanSlug
            ? `Reviewing progress on plan: ${currentPlanSlug}`
            : "Record how the client is responding to the current protocol."}
        </p>
      </div>

      {/* Date */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium shrink-0">📅 Session date</label>
        <input
          type="date"
          value={sessionDate}
          onChange={(e) => setSessionDate(e.target.value)}
          max={new Date().toISOString().slice(0, 10)}
          className="rounded-md border border-input bg-background px-2 py-1 text-sm"
        />
        <span className="text-xs text-muted-foreground">
          {sessionDate === new Date().toISOString().slice(0, 10) ? "Today" : "Past session"}
        </span>
      </div>

      {/* Progress rating */}
      <div className="space-y-2">
        <label
          className="text-sm font-semibold block"
          style={{ color: "var(--brand-indigo)" }}
        >
          How is the client responding to the current plan?
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
          {PROGRESS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setProgress(opt.value)}
              className={[
                "relative text-left rounded-xl border-2 px-3 py-3 transition-all",
                progress === opt.value
                  ? `${opt.color} border-2`
                  : "bg-card border-border hover:border-muted-foreground",
              ].join(" ")}
            >
              <div className="text-xl mb-1">{opt.icon}</div>
              <div className="text-xs font-semibold leading-tight">{opt.label}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{opt.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Protocol adherence */}
      {currentPlanSlug && (
        <div className="space-y-2">
          <label
            className="text-sm font-semibold block"
            style={{ color: "var(--brand-indigo)" }}
          >
            Protocol adherence{" "}
            <span className="font-normal text-muted-foreground text-xs">(how closely following the supplement plan?)</span>
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {ADHERENCE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setAdherence(adherence === opt.value ? "" : opt.value)}
                className={[
                  "text-left rounded-xl border-2 px-3 py-2.5 transition-all",
                  adherence === opt.value
                    ? `${opt.color} border-2`
                    : "bg-card border-border hover:border-muted-foreground",
                ].join(" ")}
              >
                <div className="text-lg mb-0.5">{opt.icon}</div>
                <div className="text-xs font-semibold leading-tight">{opt.label}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{opt.desc}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Measurements */}
      <div className="space-y-2">
        <label
          className="text-sm font-semibold block"
          style={{ color: "var(--brand-indigo)" }}
        >
          Measurements <span className="font-normal text-muted-foreground text-xs">(fill what you have)</span>
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {([
            { key: "weight_kg",   label: "Weight",  unit: "kg",     placeholder: "68.5" },
            { key: "waist_cm",    label: "Waist",   unit: "cm",     placeholder: "82" },
            { key: "bp_systolic", label: "BP Sys",  unit: "mmHg",   placeholder: "118" },
            { key: "hr_bpm",      label: "HR",      unit: "bpm",    placeholder: "72" },
          ] as { key: keyof typeof measurements; label: string; unit: string; placeholder: string }[]).map(
            ({ key, label, unit, placeholder }) => (
              <div key={key} className="space-y-1">
                <label className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">
                  {label} ({unit})
                </label>
                <input
                  type="number"
                  value={measurements[key]}
                  onChange={(e) =>
                    setMeasurements((prev) => ({ ...prev, [key]: e.target.value }))
                  }
                  placeholder={placeholder}
                  className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none"
                />
              </div>
            )
          )}
        </div>
      </div>

      {/* New / changed symptoms */}
      <div className="space-y-2">
        <label
          className="text-sm font-semibold block"
          style={{ color: "var(--brand-indigo)" }}
        >
          New or changed symptoms <span className="font-normal text-muted-foreground text-xs">(select all that apply)</span>
        </label>
        <div className="flex flex-wrap gap-2">
          {QUICK_SYMPTOMS.map((s) => (
            <button
              key={s}
              onClick={() => toggleSymptom(s)}
              className={[
                "text-xs px-2.5 py-1 rounded-full border transition-all",
                newSymptoms.includes(s)
                  ? "bg-[var(--brand-rose)]/15 border-[var(--brand-rose)] text-[#7A3D3D] font-medium"
                  : "border-border text-muted-foreground hover:border-[var(--brand-lavender)]",
              ].join(" ")}
            >
              {s}
            </button>
          ))}
        </div>
        {/* Custom symptom */}
        <div className="flex gap-2 mt-2">
          <input
            type="text"
            value={customSymptom}
            onChange={(e) => setCustomSymptom(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addCustomSymptom(); }}
            placeholder="Add a symptom not listed above…"
            className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none"
          />
          <button
            onClick={addCustomSymptom}
            className="text-xs px-3 py-1 rounded-md border font-medium hover:bg-muted"
          >
            Add
          </button>
        </div>
        {newSymptoms.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1">
            {newSymptoms.map((s) => (
              <span
                key={s}
                className="text-xs px-2.5 py-1 rounded-full font-medium flex items-center gap-1"
                style={{
                  background: "var(--brand-rose)",
                  color: "#4A1919",
                  opacity: 0.85,
                }}
              >
                {s}
                <button
                  onClick={() => toggleSymptom(s)}
                  className="hover:opacity-70"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Client feedback */}
      <div className="space-y-1.5">
        <label
          className="text-sm font-semibold block"
          style={{ color: "var(--brand-indigo)" }}
        >
          Client feedback <span className="font-normal text-muted-foreground text-xs">(their words)</span>
        </label>
        <textarea
          value={clientFeedback}
          onChange={(e) => setClientFeedback(e.target.value)}
          rows={2}
          placeholder="How the client described their experience…"
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none placeholder:text-muted-foreground/60 focus:outline-none"
        />
      </div>

      {/* Coach notes */}
      <div className="space-y-1.5">
        <label
          className="text-sm font-semibold block"
          style={{ color: "var(--brand-indigo)" }}
        >
          Coach notes <span className="font-normal text-muted-foreground text-xs">(internal)</span>
        </label>
        <textarea
          value={coachNotes}
          onChange={(e) => setCoachNotes(e.target.value)}
          rows={2}
          placeholder="Protocol adjustments to consider, follow-up actions, flags…"
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none placeholder:text-muted-foreground/60 focus:outline-none"
        />
      </div>

      {/* ── Reported food triggers ───────────────────────────────────────────── */}
      <div className="rounded-xl border-2 border-amber-300 bg-amber-50/40 p-4 space-y-2">
        <label className="text-sm font-semibold block text-amber-900">
          ⚠ Food reactions / triggers this session
        </label>
        {currentReportedTriggers && (
          <p className="text-xs text-amber-700">
            Already on profile: <span className="font-medium">{currentReportedTriggers}</span>
          </p>
        )}
        <textarea
          value={sessionTriggers}
          onChange={(e) => { setSessionTriggers(e.target.value); setTriggersSaved(false); }}
          rows={2}
          placeholder="e.g. wheat causes bloating, dairy made skin worse, coffee triggered palpitations"
          className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm resize-none placeholder:text-amber-400/70 focus:outline-none focus:ring-1 focus:ring-amber-400"
        />
        <p className="text-[11px] text-amber-700">
          {triggersSaved
            ? "✅ Saved to client profile — will be excluded from all future meal plans."
            : "If filled in, this will be appended to the client's trigger profile and excluded from all future meal plans automatically."}
        </p>
      </div>

      {/* Labs to order */}
      <div className="space-y-2">
        <label
          className="text-sm font-semibold block"
          style={{ color: "var(--brand-indigo)" }}
        >
          🧪 Order labs for next visit{" "}
          <span className="font-normal text-muted-foreground text-xs">(optional — triggers lab pending badge)</span>
        </label>
        <div className="space-y-2">
          {QUICK_LABS.map(({ group, items }) => (
            <div key={group}>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
                {group}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {items.map((lab) => (
                  <button
                    key={lab}
                    type="button"
                    onClick={() => toggleLab(lab)}
                    className={[
                      "text-xs px-2.5 py-1 rounded-full border transition-all",
                      requestedLabs.includes(lab)
                        ? "bg-amber-50 border-amber-400 text-amber-900 font-medium"
                        : "border-border text-muted-foreground hover:border-amber-300",
                    ].join(" ")}
                  >
                    {requestedLabs.includes(lab) ? "✓ " : ""}{lab}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        {/* Custom lab */}
        <div className="flex gap-2 mt-1">
          <input
            type="text"
            value={customLab}
            onChange={(e) => setCustomLab(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustomLab(); } }}
            placeholder="Add a specific test not listed…"
            className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none"
          />
          <button
            type="button"
            onClick={addCustomLab}
            className="text-xs px-3 py-1 rounded-md border font-medium hover:bg-muted"
          >
            Add
          </button>
        </div>
        {requestedLabs.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1 p-2.5 rounded-lg border border-amber-200 bg-amber-50/60">
            <span className="text-[11px] text-amber-700 font-semibold w-full mb-0.5">
              🧪 {requestedLabs.length} test{requestedLabs.length !== 1 ? "s" : ""} ordered:
            </span>
            {requestedLabs.map((lab) => (
              <span
                key={lab}
                className="text-xs px-2.5 py-1 rounded-full font-medium flex items-center gap-1 bg-amber-100 text-amber-900 border border-amber-300"
              >
                {lab}
                <button
                  type="button"
                  onClick={() => toggleLab(lab)}
                  className="hover:opacity-70 ml-0.5"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Save */}
      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={handleSave}
          disabled={saving}
          className={[
            "inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all",
            saving ? "opacity-60 cursor-not-allowed" : "hover:opacity-90 active:scale-[0.98]",
          ].join(" ")}
          style={{ background: "var(--brand-indigo)", color: "#fff" }}
        >
          {saving ? (
            <><span className="animate-spin">⏳</span> Saving…</>
          ) : (
            <>💾 Save check-in</>
          )}
        </button>
        <p className="text-xs text-muted-foreground">
          No AI used · record added to session history
          {requestedLabs.length > 0 && (
            <> · <span className="text-amber-700 font-medium">🧪 {requestedLabs.length} lab{requestedLabs.length !== 1 ? "s" : ""} flagged pending</span></>
          )}
        </p>
      </div>
    </div>
  );
}
