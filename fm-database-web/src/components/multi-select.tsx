"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

export interface MultiSelectOption {
  /** The value stored on submit (e.g. catalogue slug). */
  value: string;
  /** What the human sees in the picker. */
  label: string;
  /** Optional alternate names that should match the search query. Used by
   * Assess to surface "anxiety" when the user types "panic", etc. */
  aliases?: string[];
}

interface MultiSelectProps {
  options: MultiSelectOption[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  /** Max suggestions shown while filtering. */
  limit?: number;
  /** Optional label rendered above the search box. */
  label?: string;
  /** When true, shows up to `limit` options on an empty query (Assess
   * pattern). When false (default), the dropdown is hidden until the user
   * types — better for the plan-editor's wide catalogues. */
  showOnEmpty?: boolean;
}

/**
 * Search-as-you-type picker that stores slugs but displays human labels.
 * Selected items render as removable Badge chips above the search box.
 *
 * Used across the plan editor for: primary_topics, contributing_topics,
 * presenting_symptoms, nutrition.cooking_adjustments, nutrition.home_remedies,
 * tracking.symptoms_to_monitor, attached_resources — and on the Assess
 * page for symptoms + topics (alias-aware).
 */
export function MultiSelect({
  options,
  value,
  onChange,
  placeholder = "Search…",
  limit = 12,
  label,
  showOnEmpty = false,
}: MultiSelectProps) {
  const [query, setQuery] = useState("");

  const labelByValue = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of options) m.set(o.value, o.label);
    return m;
  }, [options]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      if (!showOnEmpty) return [];
      return options.filter((o) => !value.includes(o.value)).slice(0, limit);
    }
    return options
      .filter(
        (o) =>
          !value.includes(o.value) &&
          (o.value.toLowerCase().includes(q) ||
            o.label.toLowerCase().includes(q) ||
            (o.aliases ?? []).some((a) => a.toLowerCase().includes(q)))
      )
      .slice(0, limit);
  }, [query, options, value, limit, showOnEmpty]);

  function add(v: string) {
    if (value.includes(v)) return;
    onChange([...value, v]);
    setQuery("");
  }

  function remove(v: string) {
    onChange(value.filter((x) => x !== v));
  }

  return (
    <div className="space-y-2">
      {label && (
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">{label}</label>
          <span className="text-xs text-muted-foreground">
            {value.length} selected
          </span>
        </div>
      )}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((v) => (
            <Badge
              key={v}
              variant="secondary"
              className="font-mono text-xs gap-1.5 pr-1"
            >
              <span>{labelByValue.get(v) ?? v}</span>
              <button
                type="button"
                onClick={() => remove(v)}
                className="hover:bg-foreground/10 rounded-sm size-4 inline-flex items-center justify-center"
                aria-label={`Remove ${v}`}
              >
                ×
              </button>
            </Badge>
          ))}
        </div>
      )}
      <div className="relative">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
        />
        {filtered.length > 0 && (
          <div className="absolute z-10 mt-1 w-full max-h-64 overflow-y-auto rounded-md border bg-popover shadow-md">
            {filtered.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => add(o.value)}
                className="block w-full text-left px-3 py-1.5 text-sm hover:bg-accent"
              >
                <span>{o.label}</span>
                <span className="ml-2 text-xs text-muted-foreground font-mono">
                  {o.value}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
