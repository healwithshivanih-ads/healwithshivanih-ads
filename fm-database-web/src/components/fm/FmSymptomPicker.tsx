"use client";

/**
 * FmSymptomPicker — autocomplete chip multi-select bound to the symptoms
 * catalogue.
 *
 * Layout:
 *   - Selected chips at the top (click × to remove)
 *   - Search input below (type to filter the catalogue)
 *   - Dropdown of catalogue matches grouped by category
 *   - Custom free-text symptoms accepted via "Press Enter to add"
 *
 * Catalogue source is passed in as a flat list of {slug, label, aliases?,
 * category?}. The parent route loads them server-side and hands them down.
 * Coach values are stored as slugs; aliases drive the fuzzy match.
 */
import { useMemo, useState } from "react";

export interface FmSymptomOption {
  /** Catalogue slug. */
  slug: string;
  /** Display label (or the slug if no display_name). */
  label: string;
  aliases?: string[];
  category?: string;
  severity?: "common" | "concerning" | "red_flag";
}

export interface FmSymptomPickerProps {
  /** Full catalogue — loaded server-side. */
  catalogue: FmSymptomOption[];
  /** Currently-selected slugs OR free-text strings. */
  value: string[];
  onChange: (next: string[]) => void;
  /** Max chips shown in dropdown per search. Default 20. */
  maxResults?: number;
  /** Placeholder for the search input. */
  placeholder?: string;
}

const SEVERITY_COLOR: Record<string, string> = {
  red_flag: "var(--fm-danger)",
  concerning: "var(--fm-warning)",
  common: "var(--fm-text-secondary)",
};

export function FmSymptomPicker({
  catalogue,
  value,
  onChange,
  maxResults = 20,
  placeholder = "Type to search · press Enter for free text",
}: FmSymptomPickerProps) {
  const [q, setQ] = useState("");
  const [focused, setFocused] = useState(false);

  const selectedSet = useMemo(() => new Set(value), [value]);

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    return catalogue
      .filter((opt) => {
        if (selectedSet.has(opt.slug)) return false;
        if (opt.slug.toLowerCase().includes(needle)) return true;
        if (opt.label.toLowerCase().includes(needle)) return true;
        if (opt.aliases?.some((a) => a.toLowerCase().includes(needle))) return true;
        return false;
      })
      .slice(0, maxResults);
  }, [catalogue, q, maxResults, selectedSet]);

  const addSlug = (slug: string) => {
    if (!slug.trim() || selectedSet.has(slug)) return;
    onChange([...value, slug]);
    setQ("");
  };

  const removeAt = (i: number) => {
    onChange(value.filter((_, idx) => idx !== i));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      // If there's exactly one match, pick that. Else treat as freeform.
      const first = matches[0];
      if (first) addSlug(first.slug);
      else if (q.trim()) addSlug(q.trim());
    }
    if (e.key === "Backspace" && q === "" && value.length > 0) {
      removeAt(value.length - 1);
    }
  };

  const labelFor = (entry: string) => {
    const opt = catalogue.find((o) => o.slug === entry);
    return opt?.label ?? entry;
  };

  return (
    <div
      style={{
        position: "relative",
        background: "var(--fm-surface)",
        border: "1px solid var(--fm-border)",
        borderRadius: "var(--fm-radius-sm)",
        padding: 6,
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
        {value.map((entry, i) => {
          const opt = catalogue.find((o) => o.slug === entry);
          const sevColor = opt?.severity ? SEVERITY_COLOR[opt.severity] : null;
          return (
            <span
              key={`${entry}-${i}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "3px 8px",
                background: opt
                  ? "rgba(255, 107, 53, 0.10)"
                  : "var(--fm-bg-cool)",
                color: opt ? "var(--fm-primary)" : "var(--fm-text-secondary)",
                border: opt
                  ? "1px solid transparent"
                  : "1px dashed var(--fm-border-light)",
                borderRadius: "var(--fm-radius-pill)",
                fontSize: 11,
                fontWeight: 600,
              }}
              title={
                opt
                  ? `${opt.category ?? "symptom"}${opt.severity ? ` · ${opt.severity}` : ""}`
                  : "free-text"
              }
            >
              {sevColor && (
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: sevColor,
                    flexShrink: 0,
                  }}
                />
              )}
              {labelFor(entry)}
              <button
                type="button"
                onClick={() => removeAt(i)}
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
                aria-label={`Remove ${labelFor(entry)}`}
              >
                ×
              </button>
            </span>
          );
        })}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholder={value.length === 0 ? placeholder : ""}
          style={{
            flex: 1,
            minWidth: 140,
            padding: "4px 6px",
            border: 0,
            outline: "none",
            background: "transparent",
            fontSize: 12,
            color: "var(--fm-text-primary)",
            fontFamily: "inherit",
          }}
        />
      </div>

      {focused && q.trim().length > 0 && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            zIndex: 30,
            background: "var(--fm-surface)",
            border: "1px solid var(--fm-border)",
            borderRadius: "var(--fm-radius-sm)",
            maxHeight: 260,
            overflowY: "auto",
            boxShadow: "0 4px 18px rgba(0,0,0,0.08)",
          }}
        >
          {matches.length === 0 ? (
            <div
              style={{
                padding: "8px 12px",
                fontSize: 12,
                color: "var(--fm-text-tertiary)",
              }}
            >
              No catalogue match — press <kbd>Enter</kbd> to add{" "}
              <strong style={{ color: "var(--fm-text-primary)" }}>
                {q.trim()}
              </strong>{" "}
              as free-text
            </div>
          ) : (
            matches.map((opt) => (
              <button
                key={opt.slug}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  addSlug(opt.slug);
                }}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 10px",
                  background: "transparent",
                  border: 0,
                  borderBottom: "1px solid var(--fm-border-light)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  textAlign: "left",
                }}
              >
                {opt.severity && (
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: SEVERITY_COLOR[opt.severity],
                    }}
                  />
                )}
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--fm-text-primary)",
                  }}
                >
                  {opt.label}
                </span>
                {opt.category && (
                  <span
                    style={{
                      fontSize: 10,
                      color: "var(--fm-text-tertiary)",
                      textTransform: "uppercase",
                      letterSpacing: 0.5,
                      fontWeight: 700,
                      marginLeft: "auto",
                    }}
                  >
                    {opt.category}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
