"use client";

/**
 * PreIntakeForm — lightweight first-contact session form.
 * Collects: symptoms, chief complaint, notes.
 * Derives a suggested lab order from symptom patterns.
 * Saves a session record (no AI).
 */

import { useState } from "react";
import { toast } from "sonner";
import { saveSessionAction } from "@/app/assess/actions";

// ── Symptom categories (simplified, matching catalogue) ─────────────────────

const SYMPTOM_GROUPS: { label: string; icon: string; slugs: string[]; names: string[] }[] = [
  {
    label: "GI & Digestive",
    icon: "🫁",
    slugs: ["bloating", "gas", "constipation", "loose-stools", "acid-reflux", "food-sensitivities", "nausea"],
    names: ["Bloating", "Gas / Flatulence", "Constipation", "Loose stools / Diarrhea", "Acid reflux / Heartburn", "Food sensitivities", "Nausea"],
  },
  {
    label: "Energy & Fatigue",
    icon: "⚡",
    slugs: ["fatigue", "brain-fog", "post-meal-fatigue", "energy-crashes", "poor-concentration"],
    names: ["Fatigue / Low energy", "Brain fog", "Post-meal fatigue", "Energy crashes", "Poor concentration"],
  },
  {
    label: "Mood & Mental",
    icon: "🧠",
    slugs: ["anxiety", "depression", "mood-swings", "irritability", "emotional-numbness"],
    names: ["Anxiety", "Depression / Low mood", "Mood swings", "Irritability", "Emotional numbness"],
  },
  {
    label: "Hormonal",
    icon: "🌙",
    slugs: ["irregular-periods", "heavy-periods", "decreased-libido", "hot-flashes", "night-sweats", "pms-symptoms"],
    names: ["Irregular periods", "Heavy periods", "Low libido", "Hot flashes", "Night sweats", "PMS symptoms"],
  },
  {
    label: "Metabolic & Weight",
    icon: "⚖️",
    slugs: ["weight-gain", "abdominal-weight-gain", "blood-sugar-spikes", "sugar-cravings", "insulin-resistance-symptom"],
    names: ["Weight gain", "Belly / central weight gain", "Blood sugar spikes", "Sugar cravings", "Insulin resistance signs"],
  },
  {
    label: "Sleep",
    icon: "😴",
    slugs: ["insomnia", "poor-sleep", "sleep-disruption", "waking-at-night", "non-restorative-sleep"],
    names: ["Insomnia / Can't fall asleep", "Poor sleep quality", "Waking at night", "Waking multiple times", "Unrefreshed on waking"],
  },
  {
    label: "Thyroid / Adrenal",
    icon: "🦋",
    slugs: ["cold-intolerance", "hair-loss", "dry-skin", "constipation-thyroid", "slow-metabolism", "palpitations"],
    names: ["Cold intolerance", "Hair loss / thinning", "Dry skin / hair", "Sluggish digestion (thyroid)", "Slow metabolism", "Heart palpitations"],
  },
  {
    label: "Pain & Inflammation",
    icon: "🔥",
    slugs: ["joint-pain", "muscle-pain", "headache", "chronic-pain", "muscle-cramps", "skin-rash"],
    names: ["Joint pain", "Muscle pain / aches", "Frequent headaches", "Chronic pain", "Muscle cramps", "Skin rashes / hives"],
  },
];

// ── Symptom → suggested labs mapping ─────────────────────────────────────────

const SYMPTOM_LAB_MAP: Record<string, string[]> = {
  "fatigue":              ["CBC", "Ferritin + Iron studies", "Vitamin D", "B12", "TSH + fT3 + fT4", "CRP"],
  "brain-fog":            ["Thyroid panel", "Vitamin D", "B12", "HbA1c + fasting insulin", "CRP"],
  "bloating":             ["H. pylori breath test", "SIBO breath test", "Stool microbiome PCR", "IgA/IgG food panel"],
  "food-sensitivities":   ["IgA/IgG food sensitivity panel", "Zonulin (leaky gut marker)", "Coeliac antibodies (tTG-IgA)"],
  "constipation":         ["Thyroid panel", "Magnesium", "Stool microbiome PCR"],
  "loose-stools":         ["Stool microbiome PCR", "Calprotectin", "IgA anti-tTG (coeliac)", "SIBO breath test"],
  "irregular-periods":    ["Oestrogen E2 + progesterone + LH + FSH", "Testosterone total + free", "DHEA-S", "AMH"],
  "heavy-periods":        ["Ferritin + iron studies", "Progesterone (Day 21)", "Ultrasound (pelvic)"],
  "weight-gain":          ["HbA1c + fasting insulin", "Fasting glucose", "Lipid panel", "TSH", "Cortisol AM"],
  "insulin-resistance-symptom": ["HbA1c + fasting insulin", "Fasting glucose", "Lipid panel (TG/HDL ratio)"],
  "blood-sugar-spikes":   ["HbA1c + fasting insulin", "Fasting glucose", "Continuous glucose monitor trial"],
  "anxiety":              ["Cortisol 4-point (saliva)", "DHEA-S", "Magnesium RBC", "Vitamin D", "Thyroid panel"],
  "depression":           ["Vitamin D", "B12 + folate", "Iron + ferritin", "Thyroid panel", "CRP"],
  "insomnia":             ["Cortisol 4-point (saliva)", "Melatonin urine", "Magnesium RBC"],
  "poor-sleep":           ["Cortisol 4-point (saliva)", "Progesterone"],
  "hair-loss":            ["Ferritin", "TSH + fT3 + fT4", "Zinc", "DHEA-S", "Testosterone"],
  "joint-pain":           ["CRP + ESR", "Uric acid", "Vitamin D", "ANA screen"],
  "hot-flashes":          ["Oestrogen E2", "FSH", "LH", "Progesterone"],
  "cold-intolerance":     ["TSH + fT3 + fT4 + rT3", "Ferritin"],
  "skin-rash":            ["ANA + anti-dsDNA", "CRP + ESR", "IgE total", "IgA/IgG food panel"],
  "headache":             ["Magnesium RBC", "Vitamin D", "BP check", "CRP"],
};

function deriveLabSuggestions(selectedSlugs: string[]): string[] {
  const labSet = new Set<string>();
  for (const slug of selectedSlugs) {
    const labs = SYMPTOM_LAB_MAP[slug] ?? [];
    for (const lab of labs) labSet.add(lab);
  }
  // Always include a baseline panel
  labSet.add("CBC (Full blood count)");
  labSet.add("Comprehensive metabolic panel (CMP)");
  return Array.from(labSet);
}

// ── Component ────────────────────────────────────────────────────────────────

interface PreIntakeFormProps {
  clientId: string;
  onSaved?: (sessionId: string) => void;
}

export function PreIntakeForm({ clientId, onSaved }: PreIntakeFormProps) {
  const [selectedSlugs, setSelectedSlugs] = useState<Set<string>>(new Set());
  const [complaints, setComplaints] = useState("");
  const [coachNotes, setCoachNotes] = useState("");
  const [sessionDate, setSessionDate] = useState<string>(
    new Date().toISOString().slice(0, 10)
  );
  const [showLabSuggestions, setShowLabSuggestions] = useState(false);
  const [customLab, setCustomLab] = useState("");
  const [extraLabs, setExtraLabs] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const suggestedLabs = deriveLabSuggestions([...selectedSlugs]);
  const allRequestedLabs = [...suggestedLabs, ...extraLabs];

  function toggleSlug(slug: string) {
    setSelectedSlugs((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  async function handleSave() {
    if (selectedSlugs.size === 0 && !complaints.trim()) {
      toast.error("Please note at least one symptom or a chief complaint.");
      return;
    }
    setSaving(true);
    try {
      const result = await saveSessionAction({
        client_id: clientId,
        session_type: "pre_intake",
        session_date: sessionDate,
        selected_symptoms: [...selectedSlugs],
        presenting_complaints: complaints,
        coach_notes: coachNotes,
        requested_labs: allRequestedLabs,
      });
      if (result.ok && result.session_id) {
        toast.success(`Pre-intake session saved — ${result.session_id}`);
        onSaved?.(result.session_id);
      } else {
        toast.error(result.error ?? "Failed to save session.");
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
          📋 Pre-Intake — First Contact
        </h3>
        <p className="text-xs" style={{ color: "var(--brand-lavender)" }}>
          Collect presenting symptoms and notes, then generate a targeted lab
          order to send before the full assessment.
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
          {sessionDate === new Date().toISOString().slice(0, 10)
            ? "Today"
            : "Past session"}
        </span>
      </div>

      {/* Chief complaint */}
      <div className="space-y-1.5">
        <label className="text-sm font-semibold block" style={{ color: "var(--brand-indigo)" }}>
          Chief complaint <span className="font-normal text-muted-foreground text-xs">(in client's own words)</span>
        </label>
        <textarea
          value={complaints}
          onChange={(e) => setComplaints(e.target.value)}
          rows={3}
          placeholder="e.g. 'I've been exhausted for months, can't lose weight no matter what I do, hair falling out…'"
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2"
          style={{ "--tw-ring-color": "var(--brand-lavender)" } as React.CSSProperties}
        />
      </div>

      {/* Symptom picker */}
      <div className="space-y-2">
        <div className="flex items-baseline gap-2">
          <label className="text-sm font-semibold" style={{ color: "var(--brand-indigo)" }}>
            Presenting symptoms
          </label>
          {selectedSlugs.size > 0 && (
            <span
              className="text-xs font-medium px-2 py-0.5 rounded-full"
              style={{ background: "var(--brand-indigo)", color: "#fff" }}
            >
              {selectedSlugs.size} selected
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {SYMPTOM_GROUPS.map((group) => (
            <div
              key={group.label}
              className="rounded-lg border bg-card p-3 space-y-2"
            >
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <span>{group.icon}</span>
                <span>{group.label}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {group.slugs.map((slug, i) => {
                  const selected = selectedSlugs.has(slug);
                  return (
                    <button
                      key={slug}
                      onClick={() => toggleSlug(slug)}
                      className={[
                        "text-xs px-2.5 py-1 rounded-full border transition-all",
                        selected
                          ? "font-medium border-[var(--brand-indigo)] text-[var(--brand-indigo)] bg-[var(--brand-indigo)]/8"
                          : "border-border text-muted-foreground hover:border-[var(--brand-lavender)] hover:text-foreground",
                      ].join(" ")}
                    >
                      {group.names[i]}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Coach notes */}
      <div className="space-y-1.5">
        <label className="text-sm font-semibold block" style={{ color: "var(--brand-indigo)" }}>
          Coach notes <span className="font-normal text-muted-foreground text-xs">(internal only)</span>
        </label>
        <textarea
          value={coachNotes}
          onChange={(e) => setCoachNotes(e.target.value)}
          rows={2}
          placeholder="Referral context, impressions, urgency notes…"
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2"
          style={{ "--tw-ring-color": "var(--brand-lavender)" } as React.CSSProperties}
        />
      </div>

      {/* Lab suggestions panel */}
      {selectedSlugs.size > 0 && (
        <div
          className="rounded-xl border-2 overflow-hidden"
          style={{ borderColor: "var(--brand-lavender)" }}
        >
          <button
            onClick={() => setShowLabSuggestions(!showLabSuggestions)}
            className="w-full flex items-center justify-between px-4 py-3 text-left"
            style={{ background: "var(--brand-bone)" }}
          >
            <div>
              <span
                className="font-brand font-bold text-sm"
                style={{ color: "var(--brand-indigo)" }}
              >
                🧪 Suggested Lab Order ({allRequestedLabs.length} tests)
              </span>
              <p className="text-[11px] mt-0.5" style={{ color: "var(--brand-lavender)" }}>
                Auto-derived from selected symptoms · click to review
              </p>
            </div>
            <span className="text-muted-foreground text-lg">{showLabSuggestions ? "▲" : "▼"}</span>
          </button>

          {showLabSuggestions && (
            <div className="px-4 py-4 space-y-3 bg-background">
              <div className="flex flex-wrap gap-2">
                {allRequestedLabs.map((lab) => (
                  <span
                    key={lab}
                    className="text-xs px-2.5 py-1 rounded-full border font-medium"
                    style={{
                      borderColor: "var(--brand-lavender)",
                      color: "var(--brand-indigo)",
                      background: "var(--brand-bone)",
                    }}
                  >
                    {lab}
                  </span>
                ))}
              </div>

              {/* Add custom lab */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={customLab}
                  onChange={(e) => setCustomLab(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && customLab.trim()) {
                      setExtraLabs((prev) => [...prev, customLab.trim()]);
                      setCustomLab("");
                    }
                  }}
                  placeholder="Add a custom test and press Enter…"
                  className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none"
                />
                <button
                  onClick={() => {
                    if (customLab.trim()) {
                      setExtraLabs((prev) => [...prev, customLab.trim()]);
                      setCustomLab("");
                    }
                  }}
                  className="text-xs px-3 py-1 rounded-md border font-medium hover:bg-muted"
                >
                  Add
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Save button */}
      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={handleSave}
          disabled={saving}
          className={[
            "inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all",
            saving
              ? "opacity-60 cursor-not-allowed"
              : "hover:opacity-90 active:scale-[0.98]",
          ].join(" ")}
          style={{
            background: "var(--brand-indigo)",
            color: "#fff",
          }}
        >
          {saving ? (
            <>
              <span className="animate-spin">⏳</span> Saving…
            </>
          ) : (
            <>💾 Save pre-intake session</>
          )}
        </button>
        <p className="text-xs text-muted-foreground">
          No AI used · saves symptoms and generates lab order for the coach record
        </p>
      </div>
    </div>
  );
}
