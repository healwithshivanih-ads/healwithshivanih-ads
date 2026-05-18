/**
 * plan-version-compare.ts — structured diff between any two PLAN VERSIONS
 * for the "Compare versions" panel in the v2 plan editor's Plan actions tab.
 *
 * Replaces the unified-diff terminal output with human-readable cards
 * grouped by clinical section.
 *
 * Distinct from:
 *   - plan-diff.ts             (AI patch vs current plan, for chat UI)
 *   - plan-version-diff.ts     (active vs draft severity scoring + AI nudge gate)
 *
 * This file is the deep field-by-field viewer the coach uses for visual
 * comparison. Loads both YAMLs as plain objects, walks both trees, emits
 * a SectionDiff[] grouped by clinical area.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export type ChangeKind = "added" | "removed" | "modified";

export interface FieldChange {
  /** Display label for this row (e.g. "Dose amount", "Timing"). */
  label: string;
  path: string;
  before: unknown;
  after: unknown;
}

export interface ItemChange {
  kind: ChangeKind;
  /** Human-readable item identity ("L-Glutamine", "Post-meal walking"). */
  title: string;
  subtitle?: string;
  fields?: FieldChange[];
  snapshot?: Record<string, unknown>;
}

export interface SectionDiff {
  id: string;
  icon: string;
  label: string;
  items: ItemChange[];
  fields?: FieldChange[];
}

// ─────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────

/** Fields suppressed from the diff (provenance / audit / token plumbing). */
const NOISE_FIELDS = new Set<string>([
  "updated_at",
  "updated_by",
  "version",
  "status_history",
  "catalogue_snapshot",
  "status",
  "git_sha",
  "snapshot_date",
  "start_confirmation_token",
  "start_confirmation_expires_at",
  "start_confirmation_used_at",
  "supersedes",
  "superseded_by",
  "meal_plan_started_on",
  "supplements_started_on",
  "intake_evidence",
]);

interface SectionConfig {
  id: string;
  icon: string;
  label: string;
  key: string;
  identityKey?: string;
  titleField?: string;
  subtitleField?: string;
}

const SECTIONS: SectionConfig[] = [
  { id: "topics", icon: "🎯", label: "Primary topics", key: "primary_topics" },
  { id: "contributing-topics", icon: "🔗", label: "Contributing topics", key: "contributing_topics" },
  { id: "symptoms-addressed", icon: "🩺", label: "Symptoms addressed", key: "symptoms_addressed" },
  { id: "presenting-symptoms", icon: "🩺", label: "Presenting symptoms", key: "presenting_symptoms" },
  {
    id: "drivers",
    icon: "🧠",
    label: "Hypothesized drivers",
    key: "hypothesized_drivers",
    identityKey: "mechanism",
    titleField: "mechanism",
    subtitleField: "category",
  },
  {
    id: "supplements",
    icon: "💊",
    label: "Supplement protocol",
    key: "supplement_protocol",
    identityKey: "supplement_slug",
    titleField: "supplement_slug",
    subtitleField: "form",
  },
  {
    id: "lifestyle",
    icon: "🧘",
    label: "Lifestyle practices",
    key: "lifestyle_practices",
    identityKey: "name",
    titleField: "name",
    subtitleField: "cadence",
  },
  { id: "nutrition", icon: "🥗", label: "Nutrition", key: "nutrition" },
  {
    id: "education",
    icon: "📚",
    label: "Education modules",
    key: "education_modules",
    identityKey: "target_slug",
    titleField: "target_slug",
    subtitleField: "target_kind",
  },
  {
    id: "labs",
    icon: "🧪",
    label: "Lab orders",
    key: "lab_orders",
    identityKey: "test",
    titleField: "test",
    subtitleField: "urgency",
  },
  {
    id: "referrals",
    icon: "👩‍⚕️",
    label: "Referrals",
    key: "referrals",
    identityKey: "to",
    titleField: "to",
    subtitleField: "urgency",
  },
  { id: "tracking", icon: "📊", label: "Tracking", key: "tracking" },
  { id: "resources", icon: "🧰", label: "Attached resources", key: "attached_resources" },
  { id: "notes-coach", icon: "📝", label: "Coach notes", key: "notes_for_coach" },
  { id: "notes-client", icon: "📨", label: "Client notes", key: "notes_for_client" },
];

const PLAN_META_KEYS = ["plan_period_weeks", "plan_period_recheck_date", "client_id"];

// ─────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────

export function compareTwoPlanVersions(
  before: Record<string, any> | null,
  after: Record<string, any> | null
): SectionDiff[] {
  if (!before || !after) return [];

  const out: SectionDiff[] = [];

  const meta = diffPlanMeta(before, after);
  if (meta.length > 0) {
    out.push({ id: "plan-info", icon: "📋", label: "Plan info", items: [], fields: meta });
  }

  for (const sec of SECTIONS) {
    const section = diffSection(sec, before, after);
    if (section && (section.items.length > 0 || (section.fields?.length ?? 0) > 0)) {
      out.push(section);
    }
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────

function diffPlanMeta(a: Record<string, any>, b: Record<string, any>): FieldChange[] {
  const out: FieldChange[] = [];
  for (const k of PLAN_META_KEYS) {
    if (!deepEqual(a[k], b[k])) {
      out.push({ label: humanizeKey(k), path: k, before: a[k], after: b[k] });
    }
  }
  return out;
}

function diffSection(
  cfg: SectionConfig,
  before: Record<string, any>,
  after: Record<string, any>
): SectionDiff | null {
  const a = before[cfg.key];
  const b = after[cfg.key];

  if (a == null && b == null) return null;

  if (Array.isArray(a) || Array.isArray(b)) {
    const items = diffArraySection(cfg, (a as unknown[]) ?? [], (b as unknown[]) ?? []);
    if (items.length === 0) return null;
    return { id: cfg.id, icon: cfg.icon, label: cfg.label, items };
  }

  if (typeof a === "string" || typeof b === "string") {
    if (deepEqual(a, b)) return null;
    return {
      id: cfg.id,
      icon: cfg.icon,
      label: cfg.label,
      items: [],
      fields: [{ label: cfg.label, path: cfg.key, before: a, after: b }],
    };
  }

  if (typeof a === "object" || typeof b === "object") {
    const fields = diffFlatObject(
      (a as Record<string, any>) ?? {},
      (b as Record<string, any>) ?? {},
      cfg.key
    );
    if (fields.length === 0) return null;
    return { id: cfg.id, icon: cfg.icon, label: cfg.label, items: [], fields };
  }

  return null;
}

function diffArraySection(cfg: SectionConfig, a: unknown[], b: unknown[]): ItemChange[] {
  const out: ItemChange[] = [];

  // List of primitives (slugs)
  if (a.every((x) => typeof x !== "object") && b.every((x) => typeof x !== "object")) {
    const aSet = new Set(a.map((x) => String(x)));
    const bSet = new Set(b.map((x) => String(x)));
    for (const v of bSet) if (!aSet.has(v)) out.push({ kind: "added", title: v });
    for (const v of aSet) if (!bSet.has(v)) out.push({ kind: "removed", title: v });
    return out;
  }

  // List of objects — match by identity
  const identityKey = cfg.identityKey ?? "name";
  const aMap = new Map<string, Record<string, any>>();
  const bMap = new Map<string, Record<string, any>>();
  for (const x of a as Record<string, any>[]) {
    const id = String(x?.[identityKey] ?? JSON.stringify(x));
    aMap.set(id, x);
  }
  for (const x of b as Record<string, any>[]) {
    const id = String(x?.[identityKey] ?? JSON.stringify(x));
    bMap.set(id, x);
  }

  for (const [id, item] of bMap) {
    const prior = aMap.get(id);
    if (!prior) {
      out.push({
        kind: "added",
        title: String(item[cfg.titleField ?? identityKey] ?? id),
        subtitle: cfg.subtitleField ? safeStr(item[cfg.subtitleField]) : undefined,
        snapshot: item,
      });
    } else {
      const fieldChanges = diffFlatObject(prior, item, "");
      if (fieldChanges.length > 0) {
        out.push({
          kind: "modified",
          title: String(item[cfg.titleField ?? identityKey] ?? id),
          subtitle: cfg.subtitleField ? safeStr(item[cfg.subtitleField]) : undefined,
          fields: fieldChanges,
        });
      }
    }
  }
  for (const [id, item] of aMap) {
    if (!bMap.has(id)) {
      out.push({
        kind: "removed",
        title: String(item[cfg.titleField ?? identityKey] ?? id),
        subtitle: cfg.subtitleField ? safeStr(item[cfg.subtitleField]) : undefined,
        snapshot: item,
      });
    }
  }
  return out;
}

function diffFlatObject(
  a: Record<string, any>,
  b: Record<string, any>,
  pathPrefix: string
): FieldChange[] {
  const out: FieldChange[] = [];
  const keys = new Set<string>([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (NOISE_FIELDS.has(k)) continue;
    const before = a[k];
    const after = b[k];
    if (deepEqual(before, after)) continue;
    out.push({
      label: humanizeKey(k),
      path: pathPrefix ? `${pathPrefix}.${k}` : k,
      before,
      after,
    });
  }
  return out;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => deepEqual((a as any)[k], (b as any)[k]));
  }
  return false;
}

function humanizeKey(k: string): string {
  return k
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function safeStr(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return undefined;
}
