"use client";

/**
 * UnifiedProtocolPanel — single entry point for choosing which FM protocol
 * this plan follows.
 *
 * Replaces two previously-separate components:
 *   • AttachedProtocolsPanel  — catalogue-based multi-select (metadata only)
 *   • ProtocolTemplatePicker  — JS-template content seeder (inside plan editor)
 *
 * One action now does both:
 *   1. Sets plan.attached_protocols = [tpl.id]   ← letter generator reads this
 *   2. Seeds supplement / nutrition / lifestyle content from the template
 *      (only when the plan has no existing content, or when the coach
 *      explicitly checks "Re-seed content from template")
 *
 * Primary = single selection (radio-style). An optional secondary protocol
 * can be layered on top (checkbox, additive merge).
 *
 * Persists immediately via updatePlan — no separate Save step.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FmPanel } from "@/components/fm";
import { updatePlan } from "@/lib/server-actions/plans";
import {
  PROTOCOL_TEMPLATES,
  type ProtocolTemplate,
  type ProtocolSupplement,
} from "@/lib/fmdb/protocol-templates";

// ─── Template groupings ───────────────────────────────────────────────────────

const TEMPLATE_GROUPS: { label: string; ids: string[] }[] = [
  {
    label: "Gut & Digestion",
    ids: ["5r-gut-protocol", "leaky-gut", "sibo", "low-fodmap", "nafld", "histamine-intolerance"],
  },
  {
    label: "Hormones",
    ids: [
      "thyroid-hashimotos",
      "perimenopause-hormonal",
      "pcos",
      "estrogen-dominance",
      "low-progesterone",
      "premenstrual-syndrome",
      "endometriosis",
      "preconception-fertility",
    ],
  },
  {
    label: "Metabolic & Cardiovascular",
    ids: ["blood-sugar-insulin-resistance", "dyslipidemia", "cardiovascular-hypertension", "iron-deficiency"],
  },
  {
    label: "Immune & Inflammation",
    ids: ["aip-autoimmune", "mold-cirs", "long-covid-postviral", "chronic-fatigue-fibromyalgia", "skin-eczema-rosacea-acne"],
  },
  {
    label: "Neurological & Mood",
    ids: ["anxiety-nervous-system", "insomnia", "migraine", "depression-mood-disorder"],
  },
  {
    label: "Energy & Recovery",
    ids: ["adrenal-stress", "mito-plan", "bone-health", "methylation-mthfr", "hair-loss-women"],
  },
  {
    label: "Nutrition Approaches",
    ids: ["elimination-diet", "mediterranean", "detox-plan"],
  },
];

const TPL_BY_ID = Object.fromEntries(PROTOCOL_TEMPLATES.map((t) => [t.id, t]));

// ─── Types ────────────────────────────────────────────────────────────────────

interface PlanSnapshot {
  attached_protocols?: string[] | null;
  supplement_protocol?: unknown[] | null;
  lifestyle_practices?: unknown[] | null;
  primary_topics?: string[] | null;
  nutrition?: {
    add?: string[] | null;
    reduce?: string[] | null;
    pattern?: string | null;
  } | null;
  tracking?: {
    habits?: unknown[] | null;
    symptoms_to_monitor?: string[] | null;
  } | null;
  lab_orders?: unknown[] | null;
}

interface Props {
  planSlug: string;
  locked: boolean;
  /** Serialised subset of the current plan — used for content merging. */
  plan: PlanSnapshot;
}

// ─── Merge helpers ────────────────────────────────────────────────────────────

function dedup(arr: string[]): string[] {
  const seen = new Set<string>();
  return arr.filter((s) => {
    const k = s.toLowerCase().trim();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Build the content patch for a set of templates (primary + optional
 * secondary). Merges additively — nothing already in the plan is removed.
 */
function buildContentPatch(
  current: PlanSnapshot,
  templates: ProtocolTemplate[],
): Partial<PlanSnapshot> {
  let primaryTopics: string[] = (current.primary_topics ?? []) as string[];
  let supplements: unknown[] = (current.supplement_protocol ?? []) as unknown[];
  let lifestylePractices: unknown[] = (current.lifestyle_practices ?? []) as unknown[];
  let nutritionAdd: string[] = (current.nutrition?.add ?? []) as string[];
  let nutritionReduce: string[] = (current.nutrition?.reduce ?? []) as string[];
  let nutritionPattern: string = (current.nutrition?.pattern ?? "") as string;
  let habits: unknown[] = (current.tracking?.habits ?? []) as unknown[];
  let symptomsToMonitor: string[] = (current.tracking?.symptoms_to_monitor ?? []) as string[];
  let labOrders: unknown[] = (current.lab_orders ?? []) as unknown[];

  for (const tpl of templates) {
    // Topics
    primaryTopics = dedup([...primaryTopics, ...tpl.primary_topics]);

    // Supplements — no duplicates by slug
    const existingSlugs = new Set(
      (supplements as Array<{ supplement_slug?: string }>).map((s) => s.supplement_slug ?? ""),
    );
    const newSupps: ProtocolSupplement[] = tpl.supplements.filter(
      (s) => !existingSlugs.has(s.supplement_slug),
    );
    supplements = [...supplements, ...newSupps];

    // Nutrition
    nutritionAdd = dedup([...nutritionAdd, ...tpl.nutrition_add]);
    nutritionReduce = dedup([...nutritionReduce, ...tpl.nutrition_reduce]);
    if (!nutritionPattern && tpl.nutrition_pattern) nutritionPattern = tpl.nutrition_pattern;

    // Lifestyle
    const existingLifestyleNames = new Set(
      (lifestylePractices as Array<{ name?: string }>).map((p) =>
        (p.name ?? "").toLowerCase(),
      ),
    );
    const newLifestyle = tpl.lifestyle_practices.filter(
      (p) => !existingLifestyleNames.has(p.name.toLowerCase()),
    );
    lifestylePractices = [...lifestylePractices, ...newLifestyle];

    // Tracking habits
    const existingHabitNames = new Set(
      (habits as Array<{ name?: string }>).map((h) => (h.name ?? "").toLowerCase()),
    );
    const newHabits = tpl.tracking_habits.filter(
      (h) => !existingHabitNames.has(h.name.toLowerCase()),
    );
    habits = [...habits, ...newHabits];
    symptomsToMonitor = dedup([...symptomsToMonitor, ...(tpl.tracking_symptoms ?? [])]);

    // Lab orders
    const existingLabTests = new Set(
      (labOrders as Array<{ test?: string }>).map((l) => (l.test ?? "").toLowerCase()),
    );
    const newLabs = (tpl.lab_orders ?? []).filter(
      (l) => !existingLabTests.has(l.test.toLowerCase()),
    );
    labOrders = [...labOrders, ...newLabs];
  }

  return {
    primary_topics: primaryTopics,
    supplement_protocol: supplements,
    lifestyle_practices: lifestylePractices,
    nutrition: {
      ...(current.nutrition ?? {}),
      add: nutritionAdd,
      reduce: nutritionReduce,
      pattern: nutritionPattern,
    },
    tracking: {
      ...(current.tracking ?? {}),
      habits,
      symptoms_to_monitor: symptomsToMonitor,
    },
    lab_orders: labOrders,
  };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TemplateCard({
  tpl,
  selected,
  onClick,
}: {
  tpl: ProtocolTemplate;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: "8px 10px",
        background: selected ? "rgba(20, 83, 45, 0.07)" : "var(--fm-surface)",
        border: `1.5px solid ${selected ? "var(--fm-primary)" : "var(--fm-border)"}`,
        borderRadius: "var(--fm-radius-sm)",
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 12 }}>
        {tpl.icon} {tpl.display_name}
      </div>
      <div style={{ fontSize: 11, color: "var(--fm-text-secondary)", marginTop: 2, lineHeight: 1.3 }}>
        {tpl.description}
      </div>
    </button>
  );
}

function PreviewPanel({ tpl }: { tpl: ProtocolTemplate }) {
  return (
    <div
      style={{
        padding: "12px 14px",
        background: "var(--fm-bg-cool)",
        border: "1px solid var(--fm-border-light)",
        borderRadius: "var(--fm-radius-sm)",
        fontSize: 12,
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 13 }}>
        {tpl.icon} {tpl.display_name}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <div style={{ fontWeight: 600, marginBottom: 4, color: "var(--fm-text-secondary)", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>
            Supplements ({tpl.supplements.length})
          </div>
          <ul style={{ margin: 0, paddingLeft: 14, color: "var(--fm-text-secondary)", lineHeight: 1.5 }}>
            {tpl.supplements.slice(0, 6).map((s) => (
              <li key={s.supplement_slug}>
                {s.display_name}
                {s.dose_display ? <span style={{ color: "var(--fm-text-tertiary)" }}> — {s.dose_display}</span> : null}
              </li>
            ))}
            {tpl.supplements.length > 6 && (
              <li style={{ fontStyle: "italic", color: "var(--fm-text-tertiary)" }}>
                + {tpl.supplements.length - 6} more
              </li>
            )}
          </ul>
        </div>
        <div>
          <div style={{ fontWeight: 600, marginBottom: 4, color: "var(--fm-text-secondary)", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>
            Lifestyle ({tpl.lifestyle_practices.length})
          </div>
          <ul style={{ margin: 0, paddingLeft: 14, color: "var(--fm-text-secondary)", lineHeight: 1.5 }}>
            {tpl.lifestyle_practices.slice(0, 4).map((p) => (
              <li key={p.name}>{p.name}</li>
            ))}
          </ul>
        </div>
        {tpl.nutrition_add.length > 0 && (
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4, color: "var(--fm-text-secondary)", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>
              Foods to add
            </div>
            <ul style={{ margin: 0, paddingLeft: 14, color: "var(--fm-text-secondary)", lineHeight: 1.5 }}>
              {tpl.nutrition_add.slice(0, 4).map((f) => (
                <li key={f}>{f}</li>
              ))}
              {tpl.nutrition_add.length > 4 && (
                <li style={{ fontStyle: "italic", color: "var(--fm-text-tertiary)" }}>
                  + {tpl.nutrition_add.length - 4} more
                </li>
              )}
            </ul>
          </div>
        )}
        {(tpl.lab_orders?.length ?? 0) > 0 && (
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4, color: "var(--fm-text-secondary)", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>
              Lab orders
            </div>
            <ul style={{ margin: 0, paddingLeft: 14, color: "var(--fm-text-secondary)", lineHeight: 1.5 }}>
              {tpl.lab_orders!.slice(0, 4).map((l) => (
                <li key={l.test}>{l.test}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AttachedProtocolsPanel({ planSlug, locked, plan }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const currentAttached = (plan.attached_protocols ?? []) as string[];
  const planHasContent =
    ((plan.supplement_protocol as unknown[]) ?? []).length > 0 ||
    ((plan.lifestyle_practices as unknown[]) ?? []).length > 0;

  // Editing state
  const [editing, setEditing] = useState(false);
  const [primaryId, setPrimaryId] = useState<string | null>(
    currentAttached[0] ?? null,
  );
  const [secondaryId, setSecondaryId] = useState<string | null>(
    currentAttached[1] ?? null,
  );
  const [reseed, setReseed] = useState(!planHasContent);
  const [preview, setPreview] = useState<ProtocolTemplate | null>(
    primaryId ? (TPL_BY_ID[primaryId] ?? null) : null,
  );

  const currentPrimaryTpl = currentAttached[0] ? TPL_BY_ID[currentAttached[0]] : null;
  const currentSecondaryTpl = currentAttached[1] ? TPL_BY_ID[currentAttached[1]] : null;

  function handlePrimaryClick(id: string) {
    const tpl = TPL_BY_ID[id];
    if (!tpl) return;
    setPrimaryId(id);
    setPreview(tpl);
    // Auto-clear secondary if it's the same
    if (secondaryId === id) setSecondaryId(null);
  }

  function handleApply() {
    if (!primaryId) {
      toast.error("Pick a primary protocol first");
      return;
    }

    const templates: ProtocolTemplate[] = [TPL_BY_ID[primaryId]!];
    if (secondaryId && TPL_BY_ID[secondaryId]) {
      templates.push(TPL_BY_ID[secondaryId]!);
    }

    const newAttached = secondaryId ? [primaryId, secondaryId] : [primaryId];

    const patch: Record<string, unknown> = {
      attached_protocols: newAttached,
    };

    // Seed content only when plan is empty OR coach explicitly asked for reseed
    if (reseed) {
      const contentPatch = buildContentPatch(plan, templates);
      Object.assign(patch, contentPatch);
    }

    start(async () => {
      const r = await updatePlan(
        planSlug,
        patch as Parameters<typeof updatePlan>[1],
      );
      if (r.ok) {
        const name = TPL_BY_ID[primaryId]?.display_name ?? primaryId;
        toast.success(
          reseed
            ? `${name} applied — content seeded, review and save`
            : `Protocol set to ${name}`,
        );
        setEditing(false);
        router.refresh();
      } else {
        toast.error(r.error ?? "Save failed");
      }
    });
  }

  function handleClear() {
    start(async () => {
      const r = await updatePlan(planSlug, {
        attached_protocols: [],
      } as Parameters<typeof updatePlan>[1]);
      if (r.ok) {
        toast.success("Protocol detached");
        setEditing(false);
        setPrimaryId(null);
        setSecondaryId(null);
        setPreview(null);
        router.refresh();
      } else {
        toast.error(r.error ?? "Save failed");
      }
    });
  }

  // ── Read-only display ────────────────────────────────────────────────────

  if (!editing) {
    return (
      <FmPanel
        title="🧭 Healing protocol"
        subtitle={
          currentAttached.length > 0
            ? "The FM protocol this plan is anchored to. The plan references this for phase structure."
            : "Pick the primary FM protocol for this plan — seeds content and structures the plan."
        }
        rightSlot={
          !locked ? (
            <button
              onClick={() => {
                setEditing(true);
                setPrimaryId(currentAttached[0] ?? null);
                setSecondaryId(currentAttached[1] ?? null);
                setReseed(!planHasContent);
                setPreview(
                  currentAttached[0] ? (TPL_BY_ID[currentAttached[0]] ?? null) : null,
                );
              }}
              style={{
                fontSize: 11,
                color: "var(--fm-primary)",
                textDecoration: "underline",
                cursor: "pointer",
                background: "transparent",
                border: 0,
                fontFamily: "inherit",
              }}
            >
              {currentAttached.length > 0 ? "✏️ Change" : "✏️ Choose"}
            </button>
          ) : undefined
        }
      >
        {currentAttached.length === 0 ? (
          <p style={{ fontSize: 12, color: "var(--fm-text-tertiary)", fontStyle: "italic", margin: 0 }}>
            No protocol chosen yet.{locked ? " To set one, create a successor draft." : " Click Choose above."}
          </p>
        ) : (
          <div style={{ display: "grid", gap: 6 }}>
            {currentPrimaryTpl && (
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px", background: "var(--fm-bg-cool)", border: "1px solid var(--fm-border)", borderRadius: "var(--fm-radius-sm)" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>
                      {currentPrimaryTpl.icon} {currentPrimaryTpl.display_name}
                    </span>
                    <span style={{ fontSize: 10, fontWeight: 600, padding: "1px 6px", background: "rgba(20,83,45,0.1)", color: "var(--fm-primary)", borderRadius: "var(--fm-radius-pill)", border: "1px solid rgba(20,83,45,0.2)" }}>
                      Primary
                    </span>
                  </div>
                  <p style={{ fontSize: 11, color: "var(--fm-text-secondary)", margin: "3px 0 0", lineHeight: 1.4 }}>
                    {currentPrimaryTpl.description}
                  </p>
                </div>
              </div>
            )}
            {currentSecondaryTpl && (
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px", background: "var(--fm-surface)", border: "1px solid var(--fm-border-light)", borderRadius: "var(--fm-radius-sm)" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>
                      {currentSecondaryTpl.icon} {currentSecondaryTpl.display_name}
                    </span>
                    <span style={{ fontSize: 10, fontWeight: 500, padding: "1px 6px", background: "var(--fm-bg-cool)", color: "var(--fm-text-secondary)", borderRadius: "var(--fm-radius-pill)", border: "1px solid var(--fm-border-light)" }}>
                      Secondary
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </FmPanel>
    );
  }

  // ── Edit mode ────────────────────────────────────────────────────────────

  return (
    <FmPanel
      title="🧭 Choose healing protocol"
      subtitle="Primary sets the plan spine. Secondary adds content on top (rare)."
    >
      <div style={{ display: "grid", gap: 16 }}>

        {/* Template grid */}
        <div style={{ display: "grid", gap: 14 }}>
          {TEMPLATE_GROUPS.map((group) => {
            const groupTemplates = group.ids
              .map((id) => TPL_BY_ID[id])
              .filter(Boolean) as ProtocolTemplate[];
            if (groupTemplates.length === 0) return null;
            return (
              <div key={group.label}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6, color: "var(--fm-text-tertiary)", marginBottom: 6 }}>
                  {group.label}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                  {groupTemplates.map((tpl) => (
                    <TemplateCard
                      key={tpl.id}
                      tpl={tpl}
                      selected={primaryId === tpl.id}
                      onClick={() => handlePrimaryClick(tpl.id)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Preview */}
        {preview && <PreviewPanel tpl={preview} />}

        {/* Secondary protocol */}
        {primaryId && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--fm-text-secondary)", marginBottom: 6 }}>
              Layer a second protocol on top? (optional — most clients need only one)
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
              {PROTOCOL_TEMPLATES.filter((t) => t.id !== primaryId).map((tpl) => (
                <label
                  key={tpl.id}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 7,
                    padding: "7px 10px",
                    background: secondaryId === tpl.id ? "rgba(20,83,45,0.05)" : "var(--fm-surface)",
                    border: `1px solid ${secondaryId === tpl.id ? "var(--fm-primary)" : "var(--fm-border-light)"}`,
                    borderRadius: "var(--fm-radius-sm)",
                    cursor: "pointer",
                    fontSize: 11,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={secondaryId === tpl.id}
                    onChange={() => setSecondaryId(secondaryId === tpl.id ? null : tpl.id)}
                    style={{ marginTop: 2, flexShrink: 0 }}
                  />
                  <span>{tpl.icon} {tpl.display_name}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Content seeding option */}
        {primaryId && planHasContent && (
          <label
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              padding: "10px 12px",
              background: "rgba(245,158,11,0.06)",
              border: "1px solid rgba(245,158,11,0.25)",
              borderRadius: "var(--fm-radius-sm)",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            <input
              type="checkbox"
              checked={reseed}
              onChange={(e) => setReseed(e.target.checked)}
              style={{ marginTop: 2, flexShrink: 0 }}
            />
            <div>
              <span style={{ fontWeight: 600 }}>Also merge template content into the plan</span>
              <p style={{ margin: "2px 0 0", color: "var(--fm-text-secondary)", lineHeight: 1.4 }}>
                Plan already has supplements and lifestyle practices. Leave unchecked to only update the protocol pointer without changing content.
              </p>
            </div>
          </label>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: 8, justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", gap: 8 }}>
            {currentAttached.length > 0 && (
              <button
                onClick={handleClear}
                disabled={pending}
                style={{ fontSize: 12, padding: "6px 12px", background: "transparent", border: "1px solid var(--fm-border)", borderRadius: "var(--fm-radius-sm)", cursor: pending ? "wait" : "pointer", fontFamily: "inherit", color: "var(--fm-text-secondary)" }}
              >
                Clear
              </button>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => { setEditing(false); setPrimaryId(currentAttached[0] ?? null); setSecondaryId(currentAttached[1] ?? null); setPreview(null); }}
              disabled={pending}
              style={{ fontSize: 12, padding: "6px 12px", background: "transparent", border: "1px solid var(--fm-border)", borderRadius: "var(--fm-radius-sm)", cursor: pending ? "wait" : "pointer", fontFamily: "inherit" }}
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              disabled={!primaryId || pending}
              style={{ fontSize: 12, padding: "6px 16px", background: primaryId ? "var(--fm-primary)" : "var(--fm-border)", color: primaryId ? "#fff" : "var(--fm-text-tertiary)", border: 0, borderRadius: "var(--fm-radius-sm)", cursor: (!primaryId || pending) ? "not-allowed" : "pointer", fontWeight: 700, fontFamily: "inherit" }}
            >
              {pending ? "Saving…" : reseed ? "Apply & Seed Content" : "Set Protocol"}
            </button>
          </div>
        </div>

      </div>
    </FmPanel>
  );
}
