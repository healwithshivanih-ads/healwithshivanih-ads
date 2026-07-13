"use client";

/**
 * ClientMemoryPanel — surfaces what the system "knows" about this client.
 *
 * Specifically the four dietary / lifestyle fields that:
 *   - The new-client form captures.
 *   - The plan-chat AI appends to as the coach mentions things in chat
 *     ("she won't give up coffee" → non_negotiables; "dairy seems to
 *     flare joints" → reported_triggers; etc.).
 *   - render-client-letter.py reads as binding filters when generating
 *     meal plans + supplement letters.
 *
 * Coach pain point (2026-05-13): up to now the AI's writes to these
 * fields only showed as a one-off "👤 saved to profile" chip in the
 * plan-chat turn — never aggregated anywhere coach could review at a
 * glance. This panel is that aggregate view + inline edit.
 *
 * Click any card → expand to a textarea + Save / Cancel. Save writes
 * via updateClientProfile and the page refreshes.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { updateClientProfile } from "@/lib/server-actions/clients";

type MealPlanStyle = "detailed" | "principles" | "hybrid";

interface Props {
  clientId: string;
  initial: {
    dietary_preference?: string;
    animal_derived_supplements_ok?: string;
    foods_to_avoid?: string;
    non_negotiables?: string;
    reported_triggers?: string;
    family_history?: string;
    meal_plan_style?: MealPlanStyle;
  };
  /** ISO timestamp of last update — usually client.updated_at. */
  lastUpdatedAt?: string;
}

type FieldKey =
  | "dietary_preference"
  | "animal_derived_supplements_ok"
  | "foods_to_avoid"
  | "non_negotiables"
  | "reported_triggers"
  | "family_history";

// Diets for which the animal-derived-supplements question is relevant.
// For Non-vegetarian / Pescatarian / Other the field is hidden entirely
// (it would just be irrelevant noise — coach feedback 2026-05-20).
const VEG_SPECTRUM = [
  "vegetarian",
  "vegetarian jain",
  "jain vegetarian",
  "jain",
  "vegan",
  "eggetarian",
];

interface FieldMeta {
  key: FieldKey;
  emoji: string;
  label: string;
  hint: string;
  placeholder: string;
}

const FIELDS: FieldMeta[] = [
  {
    key: "dietary_preference",
    emoji: "🥗",
    label: "Dietary preference",
    hint: "Vegetarian / Jain / Vegan / Eggetarian / Pescatarian / Non-vegetarian — whatever the client follows.",
    placeholder: "Vegetarian",
  },
  {
    key: "animal_derived_supplements_ok",
    emoji: "💊",
    label: "OK with animal-derived supplements?",
    hint: "Whether this veg-spectrum client accepts fish-oil omega-3, gelatin capsules, collagen etc. Type exactly: yes / no / unsure.",
    placeholder: "yes / no / unsure",
  },
  {
    key: "foods_to_avoid",
    emoji: "🚫",
    label: "Foods to avoid",
    hint: "Foods the client doesn't / won't eat (preference or intolerance).",
    placeholder: "e.g. onions, garlic, deep-fried foods",
  },
  {
    key: "non_negotiables",
    emoji: "💖",
    label: "Won't give up",
    hint: "Daily rituals or favourites the client has explicitly said they won't drop. Plan should design around these.",
    placeholder: "e.g. evening tea with milk, weekend chocolate, morning coffee",
  },
  {
    key: "reported_triggers",
    emoji: "⚠️",
    label: "Reported triggers",
    hint: "Foods or behaviours the client has noticed make their symptoms worse.",
    placeholder: "e.g. gluten → bloating; dairy → joint pain",
  },
  {
    key: "family_history",
    emoji: "🧬",
    label: "Family history",
    hint: "Conditions in parents / siblings / grandparents that inform genetic predisposition.",
    placeholder: "e.g. Mother — Type 2 diabetes, hypothyroid",
  },
];

export function ClientMemoryPanel({ clientId, initial, lastUpdatedAt }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState<FieldKey | null>(null);
  const [drafts, setDrafts] = useState<Record<FieldKey, string>>({
    dietary_preference: initial.dietary_preference ?? "",
    animal_derived_supplements_ok: initial.animal_derived_supplements_ok ?? "",
    foods_to_avoid: initial.foods_to_avoid ?? "",
    non_negotiables: initial.non_negotiables ?? "",
    reported_triggers: initial.reported_triggers ?? "",
    family_history: initial.family_history ?? "",
  });
  const [pending, startTransition] = useTransition();

  // Hide the animal-supplements field for non-veg / pescatarian / unset
  // diets — there it is just irrelevant noise.
  const visibleFields = FIELDS.filter((f) => {
    if (f.key !== "animal_derived_supplements_ok") return true;
    return VEG_SPECTRUM.includes(
      (initial.dietary_preference ?? "").trim().toLowerCase(),
    );
  });

  const save = (key: FieldKey) => {
    startTransition(async () => {
      const res = await updateClientProfile({
        client_id: clientId,
        [key]: drafts[key],
      });
      if (res.ok) {
        toast.success(`✓ Saved`);
        setEditing(null);
        router.refresh();
      } else {
        toast.error(res.error ?? "Save failed", { duration: 12000 });
      }
    });
  };

  const cancel = (key: FieldKey) => {
    setDrafts((d) => ({ ...d, [key]: initial[key] ?? "" }));
    setEditing(null);
  };

  const filledCount = visibleFields.filter((f) => initial[f.key]?.trim()).length;

  return (
    <div
      style={{
        background: "var(--fm-surface)",
        border: "1px solid var(--fm-border-light)",
        borderRadius: "var(--fm-radius-md)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "10px 14px",
          borderBottom: "1px solid var(--fm-border-light)",
          background: "var(--fm-bg-cool, #f0f4f8)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontSize: 14 }}>🧠</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--fm-text-primary)" }}>
            Profile memory
          </span>
          <span style={{ fontSize: 11, color: "var(--fm-text-tertiary)" }}>
            {filledCount}/{FIELDS.length} learned
          </span>
        </div>
        {lastUpdatedAt && (
          <span
            style={{
              fontSize: 10,
              color: "var(--fm-text-tertiary)",
              fontFamily: "var(--fm-font-mono)",
            }}
          >
            updated {lastUpdatedAt.slice(0, 10)}
          </span>
        )}
      </div>
      <div style={{ padding: "8px 12px", display: "grid", gap: 6 }}>
        <p
          style={{
            fontSize: 11,
            color: "var(--fm-text-tertiary)",
            fontStyle: "italic",
            margin: "2px 0 4px",
            lineHeight: 1.5,
          }}
        >
          What the system has learned. The plan-chat AI appends to these
          as you mention things in chat; the menu generator
          treats them as hard rules.
        </p>
        {visibleFields.map((f) => {
          const value = initial[f.key]?.trim();
          const isEditing = editing === f.key;
          return (
            <div
              key={f.key}
              style={{
                display: "grid",
                gap: 4,
                padding: "8px 10px",
                background: value ? "var(--fm-surface)" : "var(--fm-bg-warm, #fff5f0)",
                border: `1px solid ${value ? "var(--fm-border-light)" : "var(--fm-border)"}`,
                borderRadius: "var(--fm-radius-sm)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: 0.6,
                    color: value ? "var(--fm-text-secondary)" : "var(--fm-text-tertiary)",
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                  }}
                >
                  <span>{f.emoji}</span>
                  <span>{f.label}</span>
                </div>
                {!isEditing && (
                  <button
                    type="button"
                    onClick={() => setEditing(f.key)}
                    style={{
                      fontSize: 11,
                      color: "var(--fm-primary)",
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      padding: 0,
                      fontWeight: 600,
                      fontFamily: "inherit",
                    }}
                  >
                    {value ? "✏️ edit" : "+ add"}
                  </button>
                )}
              </div>
              {!isEditing && value && (
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--fm-text-primary)",
                    lineHeight: 1.45,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {value}
                </div>
              )}
              {!isEditing && !value && (
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--fm-text-tertiary)",
                    fontStyle: "italic",
                    lineHeight: 1.4,
                  }}
                >
                  Not learned yet — {f.hint.toLowerCase()}
                </div>
              )}
              {isEditing && (
                <div style={{ display: "grid", gap: 6 }}>
                  <textarea
                    value={drafts[f.key]}
                    onChange={(e) =>
                      setDrafts((d) => ({ ...d, [f.key]: e.target.value }))
                    }
                    placeholder={f.placeholder}
                    rows={3}
                    style={{
                      width: "100%",
                      padding: "6px 9px",
                      fontSize: 12,
                      border: "1px solid var(--fm-border)",
                      borderRadius: "var(--fm-radius-sm)",
                      background: "var(--fm-surface)",
                      color: "var(--fm-text-primary)",
                      fontFamily: "inherit",
                      resize: "vertical",
                    }}
                  />
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      type="button"
                      onClick={() => save(f.key)}
                      disabled={pending}
                      style={{
                        padding: "5px 12px",
                        fontSize: 11,
                        fontWeight: 700,
                        background: "var(--fm-primary)",
                        color: "#fff",
                        border: "none",
                        borderRadius: "var(--fm-radius-sm)",
                        cursor: pending ? "wait" : "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      {pending ? "Saving…" : "💾 Save"}
                    </button>
                    <button
                      type="button"
                      onClick={() => cancel(f.key)}
                      disabled={pending}
                      style={{
                        padding: "5px 12px",
                        fontSize: 11,
                        fontWeight: 600,
                        background: "transparent",
                        color: "var(--fm-text-secondary)",
                        border: "1px solid var(--fm-border)",
                        borderRadius: "var(--fm-radius-sm)",
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {/* 🍽 Meal plan type moved to the 🧩 Plan modules panel (2026-06-13)
            so all optional plan layers live in one checklist. */}
      </div>
    </div>
  );
}
