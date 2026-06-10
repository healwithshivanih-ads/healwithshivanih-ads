"use client";

/**
 * FormChrome — sticky top bar for the intake form.
 *
 * Renders the brand pill + autosave indicator on row 1, and a row of section
 * dots on row 2. Dots show: done (any data filled), current (in viewport),
 * untouched (faded). Click a dot to scroll to that section.
 *
 * Total section count is variable (10 or 11 depending on sex). The design
 * mocked a 16-dot row; we adapt to whatever count the form passes in.
 */
export function FormChrome({
  currentSection,
  totalSections,
  savedTime,
  saving,
  savedSections,
  onSectionClick,
}: {
  currentSection: number;
  totalSections: number;
  savedTime: string;
  saving: boolean;
  savedSections: number[];
  onSectionClick?: (n: number) => void;
}) {
  return (
    <div className="fm-chrome">
      <div className="fm-chrome__row">
        <div className="fm-chrome__brand">
          <span className="pulse pulse--ringed" aria-hidden="true" />
          <span>Intake · The Ochre Tree</span>
        </div>
        <div
          className={"fm-save" + (saving ? " fm-save--saving" : "")}
          aria-live="polite"
        >
          <span className="fm-save__dot" aria-hidden="true" />
          <span>{saving ? "Saving…" : savedTime ? `Saved · ${savedTime}` : "Auto-saves"}</span>
        </div>
      </div>
      <div className="fm-progress" role="navigation" aria-label="Form sections">
        <span className="fm-progress__num">
          {String(currentSection).padStart(2, "0")} / {String(totalSections).padStart(2, "0")}
        </span>
        {Array.from({ length: totalSections }, (_, i) => i + 1).map((n) => {
          const cls =
            n === currentSection
              ? "fm-progress__dot fm-progress__dot--current"
              : savedSections.includes(n)
                ? "fm-progress__dot fm-progress__dot--done"
                : "fm-progress__dot";
          return (
            <button
              key={n}
              type="button"
              className={cls}
              aria-label={`Section ${n}`}
              aria-current={n === currentSection ? "step" : undefined}
              onClick={() => onSectionClick?.(n)}
            />
          );
        })}
      </div>
    </div>
  );
}
