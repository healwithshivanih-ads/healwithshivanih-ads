/**
 * Form primitives for Phase 3 v2 session forms.
 *
 * Lifted from the design's reusable bits in fm-explorations-5.jsx:
 *   FmFieldLabel · FmInput · FmTextarea · FmPillGroup · FmFormSection
 *
 * Kept deliberately thin so the 5 session forms can compose them quickly.
 * No state inside — all controlled by the parent form's React state.
 */
import { useId } from "react";

// ─── Label ────────────────────────────────────────────────────────────────

export function FmFieldLabel({
  children,
  hint,
  htmlFor,
}: {
  children: React.ReactNode;
  hint?: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <label htmlFor={htmlFor} style={{ display: "block", marginBottom: 5 }}>
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: 0.8,
          color: "var(--fm-text-secondary)",
        }}
      >
        {children}
      </span>
      {hint && (
        <span
          style={{
            fontSize: 11,
            color: "var(--fm-text-tertiary)",
            marginLeft: 8,
            fontWeight: 500,
          }}
        >
          {hint}
        </span>
      )}
    </label>
  );
}

// ─── Input ────────────────────────────────────────────────────────────────

export interface FmInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  /** Render in error state. */
  invalid?: boolean;
}

export function FmInput({ invalid, style, ...rest }: FmInputProps) {
  return (
    <input
      {...rest}
      style={{
        padding: "8px 10px",
        background: "var(--fm-surface)",
        border: `1px solid ${invalid ? "var(--fm-danger)" : "var(--fm-border)"}`,
        borderRadius: "var(--fm-radius-sm)",
        fontSize: 13,
        color: "var(--fm-text-primary)",
        outline: "none",
        width: "100%",
        fontFamily: "inherit",
        ...style,
      }}
    />
  );
}

// ─── Textarea ─────────────────────────────────────────────────────────────

export interface FmTextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export function FmTextarea({ invalid, style, ...rest }: FmTextareaProps) {
  return (
    <textarea
      {...rest}
      style={{
        padding: "10px 12px",
        background: "var(--fm-surface)",
        border: `1px solid ${invalid ? "var(--fm-danger)" : "var(--fm-border)"}`,
        borderRadius: "var(--fm-radius-sm)",
        fontSize: 13,
        color: "var(--fm-text-primary)",
        outline: "none",
        width: "100%",
        minHeight: 80,
        lineHeight: 1.55,
        resize: "vertical",
        fontFamily: "inherit",
        ...style,
      }}
    />
  );
}

// ─── Pill group (single or multi-select) ──────────────────────────────────

export interface FmPillOption<T extends string = string> {
  value: T;
  label: React.ReactNode;
  /** Optional override colour for the active state. */
  tint?: string;
}

export interface FmPillGroupProps<T extends string = string> {
  options: FmPillOption<T>[];
  /** Single-select OR multi-select via array. */
  value: T | T[] | null;
  onChange: (v: T) => void;
  /** When true, the same value can be re-clicked to toggle off. Default false. */
  toggleable?: boolean;
}

export function FmPillGroup<T extends string = string>({
  options,
  value,
  onChange,
  toggleable = false,
}: FmPillGroupProps<T>) {
  const isSelected = (v: T): boolean => {
    if (Array.isArray(value)) return (value as T[]).includes(v);
    return value === v;
  };
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {options.map((opt) => {
        const sel = isSelected(opt.value);
        const tint = opt.tint ?? "var(--fm-primary)";
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => {
              if (sel && !toggleable && !Array.isArray(value)) return;
              onChange(opt.value);
            }}
            style={{
              padding: "5px 12px",
              borderRadius: "var(--fm-radius-pill)",
              fontSize: 12,
              fontWeight: 600,
              background: sel ? tint : "var(--fm-surface)",
              color: sel ? "#fff" : "var(--fm-text-secondary)",
              border: sel ? "1px solid transparent" : "1px solid var(--fm-border-light)",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── Form section (titled card around a group of fields) ─────────────────

export function FmFormSection({
  title,
  description,
  children,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        padding: 18,
        background: "var(--fm-surface)",
        border: "1px solid var(--fm-border-light)",
        borderRadius: "var(--fm-radius-lg)",
        marginBottom: 14,
      }}
    >
      {title && (
        <h3
          style={{
            margin: 0,
            fontSize: 13,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: 1,
            color: "var(--fm-text-primary)",
            marginBottom: description ? 4 : 14,
          }}
        >
          {title}
        </h3>
      )}
      {description && (
        <p
          style={{
            margin: "0 0 14px",
            fontSize: 12,
            color: "var(--fm-text-secondary)",
            lineHeight: 1.55,
          }}
        >
          {description}
        </p>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {children}
      </div>
    </section>
  );
}

// ─── Field (label + control + optional hint/error) ────────────────────────

export function FmField({
  label,
  hint,
  error,
  children,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  children: (props: { id: string }) => React.ReactNode;
}) {
  const id = useId();
  return (
    <div>
      <FmFieldLabel htmlFor={id} hint={hint}>
        {label}
      </FmFieldLabel>
      {children({ id })}
      {error && (
        <div
          style={{
            marginTop: 4,
            fontSize: 11,
            color: "var(--fm-danger)",
            fontWeight: 500,
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
