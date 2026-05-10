"use client";

/**
 * ExpectedReportsCheckboxes — coach checks which reports the client is being
 * asked to bring back. Late-arriving reports (genetics, GI-MAP, DUTCH, blood
 * panels) link to the session via `linked_session_id` so they show up in the
 * right place even if they arrive weeks later.
 */

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}

interface ReportType {
  slug: string;
  label: string;
  hint: string;
}

const REPORT_TYPES: ReportType[] = [
  { slug: "blood_panel_basic",    label: "Blood panel — basic",     hint: "CBC, lipids, fasting glucose, TSH, ferritin, B12, vit D" },
  { slug: "blood_panel_advanced", label: "Blood panel — advanced",  hint: "Adds ApoB, hsCRP, HOMA-IR, hormones, antibodies" },
  { slug: "thyroid_full",         label: "Thyroid full panel",      hint: "TSH, fT4, fT3, rT3, TPO + Tg antibodies" },
  { slug: "gi_map",               label: "GI-MAP / stool panel",    hint: "Comprehensive PCR-based gut panel" },
  { slug: "dutch_complete",       label: "DUTCH complete",          hint: "Adrenal + sex hormone metabolites (urine)" },
  { slug: "genetics",             label: "Genetics / SNP panel",    hint: "MTHFR, COMT, APOE, MTRR, GST etc." },
  { slug: "food_sensitivity",     label: "Food sensitivity",        hint: "IgG / IgA panel for elimination guidance" },
  { slug: "food_journal",         label: "Food journal",            hint: "3-7 days of meals + symptoms" },
  { slug: "other",                label: "Other",                   hint: "Imaging, biopsy, specialist letter etc." },
];

export function ExpectedReportsCheckboxes({ value, onChange, disabled }: Props) {
  const set = new Set(value);
  const toggle = (slug: string) => {
    const next = new Set(set);
    if (next.has(slug)) next.delete(slug);
    else next.add(slug);
    onChange([...next]);
  };

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {REPORT_TYPES.map((r) => {
          const checked = set.has(r.slug);
          return (
            <label
              key={r.slug}
              className={`flex items-start gap-2 rounded border px-3 py-2 text-xs cursor-pointer transition-colors ${
                checked
                  ? "border-emerald-500 bg-emerald-50/60"
                  : "border-border hover:bg-muted/40"
              } ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
            >
              <input
                type="checkbox"
                className="mt-0.5"
                checked={checked}
                disabled={disabled}
                onChange={() => toggle(r.slug)}
              />
              <span className="space-y-0.5">
                <span className="block font-medium">{r.label}</span>
                <span className="block text-muted-foreground">{r.hint}</span>
              </span>
            </label>
          );
        })}
      </div>
      {value.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          {value.length} report{value.length === 1 ? "" : "s"} expected — late-arriving uploads will auto-link to this session.
        </p>
      )}
    </div>
  );
}

/** Look up the human-readable label for a report slug. Falls back to the slug. */
export function reportTypeLabel(slug: string): string {
  return REPORT_TYPES.find((r) => r.slug === slug)?.label ?? slug;
}

/** Full list of supported report types, exported for other components (link-to-session dropdowns). */
export const ALL_REPORT_TYPES = REPORT_TYPES;
