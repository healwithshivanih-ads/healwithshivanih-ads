"use client";

/**
 * PlanVersionDiffView — renders the structured SectionDiff[] from
 * plan-version-compare.ts as human-readable cards grouped by clinical
 * section.
 *
 * Replaces the unified-diff terminal output in the "Compare versions"
 * panel. Each section is collapsible. Within a section, items are
 * rendered as:
 *   - Added (green border + ⊕ icon)
 *   - Removed (rose border + ⊖ icon)
 *   - Modified (slate border + ✎ icon, with per-field before/after rows)
 * Scalar field changes (e.g. Plan info) render as inline before → after rows.
 */

import type { SectionDiff, FieldChange, ItemChange } from "@/lib/fmdb/plan-version-compare";

interface Props {
  sections: SectionDiff[];
  labelA: string;
  labelB: string;
}

export function PlanVersionDiffView({ sections, labelA, labelB }: Props) {
  if (sections.length === 0) {
    return (
      <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
        No structural differences — the two plans are equivalent (timestamps and
        version numbers excluded).
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-[10px] uppercase tracking-wide text-muted-foreground">
        <div>
          <span className="text-rose-700">A:</span> <span className="font-mono">{labelA}</span>
        </div>
        <div className="text-muted-foreground/40">vs</div>
        <div>
          <span className="text-emerald-700">B:</span> <span className="font-mono">{labelB}</span>
        </div>
        <div className="ml-auto text-muted-foreground">
          <span className="text-rose-700">removed</span>
          {" · "}
          <span className="text-emerald-700">added</span>
          {" · "}
          <span className="text-slate-700">modified</span>
        </div>
      </div>

      {sections.map((sec) => (
        <SectionCard key={sec.id} section={sec} />
      ))}
    </div>
  );
}

function SectionCard({ section }: { section: SectionDiff }) {
  const totalItems = section.items.length;
  const totalFields = section.fields?.length ?? 0;
  const total = totalItems + totalFields;

  return (
    <details open className="group/sec rounded-md border bg-card">
      <summary className="flex items-center gap-2 cursor-pointer select-none list-none px-3 py-2 text-xs font-semibold hover:bg-muted/40">
        <span className="transition-transform group-open/sec:rotate-90 text-muted-foreground text-[10px]">▶</span>
        <span className="text-base leading-none">{section.icon}</span>
        <span>{section.label}</span>
        <span className="ml-auto text-[10px] font-normal text-muted-foreground">
          {total} {total === 1 ? "change" : "changes"}
        </span>
      </summary>
      <div className="border-t bg-muted/10 px-3 py-2 space-y-2">
        {/* Scalar / field-level changes shown first */}
        {section.fields && section.fields.length > 0 && (
          <div className="space-y-1.5">
            {section.fields.map((f) => (
              <FieldRow key={f.path} field={f} />
            ))}
          </div>
        )}

        {/* Object item changes */}
        {section.items.map((item, i) => (
          <ItemCard key={`${item.kind}-${item.title}-${i}`} item={item} />
        ))}
      </div>
    </details>
  );
}

function ItemCard({ item }: { item: ItemChange }) {
  const palette = paletteFor(item.kind);
  return (
    <div className={`rounded-md border ${palette.border} ${palette.bg} p-2.5`}>
      <div className="flex items-baseline gap-2">
        <span className={`text-xs font-bold ${palette.text}`}>{palette.icon}</span>
        <span className={`text-xs font-semibold ${palette.text}`}>
          {prettifyTitle(item.title)}
        </span>
        {item.subtitle && (
          <span className="text-[10px] text-muted-foreground font-mono">
            · {item.subtitle}
          </span>
        )}
        <span className={`ml-auto text-[10px] uppercase tracking-wide ${palette.text}`}>
          {item.kind}
        </span>
      </div>

      {/* For added / removed: show key fields from the snapshot */}
      {item.snapshot && (item.kind === "added" || item.kind === "removed") && (
        <div className="mt-1.5 pl-5 text-[11px] text-foreground/80 space-y-0.5">
          {snapshotPreview(item.snapshot).map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <span className="text-muted-foreground min-w-[80px]">{prettifyKey(k)}:</span>
              <span className="font-mono break-words">{formatValue(v)}</span>
            </div>
          ))}
        </div>
      )}

      {/* For modified: show field-level before/after */}
      {item.kind === "modified" && item.fields && item.fields.length > 0 && (
        <div className="mt-2 space-y-1.5 pl-5">
          {item.fields.map((f) => (
            <FieldRow key={f.path} field={f} compact />
          ))}
        </div>
      )}
    </div>
  );
}

function FieldRow({ field, compact = false }: { field: FieldChange; compact?: boolean }) {
  return (
    <div className={`grid grid-cols-[110px_1fr] gap-2 ${compact ? "text-[11px]" : "text-xs"}`}>
      <div className="text-muted-foreground font-medium pt-0.5">{field.label}</div>
      <div className="space-y-0.5 min-w-0">
        {field.before !== undefined && field.before !== null && field.before !== "" && (
          <div className="rounded bg-rose-50 border border-rose-200 px-2 py-1 text-rose-900 line-through decoration-rose-400/60 decoration-1 break-words">
            <span className="text-rose-500 mr-1 font-mono">−</span>
            {formatValue(field.before)}
          </div>
        )}
        {field.after !== undefined && field.after !== null && field.after !== "" && (
          <div className="rounded bg-emerald-50 border border-emerald-200 px-2 py-1 text-emerald-900 break-words">
            <span className="text-emerald-500 mr-1 font-mono">+</span>
            {formatValue(field.after)}
          </div>
        )}
        {/* Both falsy = field was cleared on B side */}
        {(field.after === undefined || field.after === null || field.after === "") &&
          (field.before === undefined || field.before === null || field.before === "") && (
            <div className="text-muted-foreground italic text-[11px]">(cleared)</div>
          )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────────

function paletteFor(kind: ItemChange["kind"]) {
  switch (kind) {
    case "added":
      return {
        border: "border-emerald-200",
        bg: "bg-emerald-50/50",
        text: "text-emerald-900",
        icon: "⊕",
      };
    case "removed":
      return {
        border: "border-rose-200",
        bg: "bg-rose-50/50",
        text: "text-rose-900",
        icon: "⊖",
      };
    case "modified":
      return {
        border: "border-slate-200",
        bg: "bg-slate-50/50",
        text: "text-slate-900",
        icon: "✎",
      };
  }
}

function prettifyTitle(s: string): string {
  // Convert hyphenated slugs to title case for display: "l-glutamine" → "L-Glutamine"
  if (s.includes(" ")) return s; // already prose
  return s
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("-");
}

function prettifyKey(k: string): string {
  return k.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Pick the most useful 4-6 fields from an added/removed snapshot for a
 * compact preview card. Skip noise + array/object fields.
 */
function snapshotPreview(item: Record<string, unknown>): Array<[string, unknown]> {
  const priority = [
    "dose_amount",
    "dose_unit",
    "dose",
    "dose_display",
    "form",
    "timing",
    "duration_weeks",
    "coach_rationale",
    "rationale",
    "cadence",
    "details",
    "reason",
    "urgency",
    "client_facing_summary",
    "category",
  ];
  const out: Array<[string, unknown]> = [];
  for (const k of priority) {
    if (k in item && item[k] != null && item[k] !== "") {
      out.push([k, item[k]]);
      if (out.length >= 5) break;
    }
  }
  return out;
}

function formatValue(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "string") {
    return v.length > 280 ? v.slice(0, 277) + "…" : v;
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x !== "object")) return v.join(", ");
    return `[${v.length} items]`;
  }
  if (typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch {
      return "[object]";
    }
  }
  return String(v);
}
