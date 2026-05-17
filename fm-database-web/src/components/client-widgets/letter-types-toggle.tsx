"use client";

/**
 * Inline letter-types toggle — sits at the top of the Communicate "Client
 * letters" panel so the coach can pick which letters this client receives
 * without jumping to the Overview > Preferences card.
 *
 * Optimistic update + save via updateClientPreferences. Default
 * ["consolidated"] when nothing on disk yet.
 */

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { updateClientPreferences } from "@/lib/server-actions/clients";

const LETTER_TYPES: { value: string; label: string }[] = [
  { value: "consolidated", label: "📄 Consolidated" },
  { value: "meal_plan", label: "🍽 Meal plan" },
  { value: "supplement_plan", label: "💊 Supplements" },
  { value: "lifestyle_guide", label: "🌿 Lifestyle" },
  { value: "exercise_plan", label: "🏃 Exercise" },
  { value: "recipes", label: "✦ Recipes" },
];

interface Props {
  clientId: string;
  initial?: string[];
  onChange?: (next: string[]) => void;
}

export function LetterTypesToggle({ clientId, initial, onChange }: Props) {
  const seed = initial && initial.length > 0 ? initial : ["consolidated"];
  const [active, setActive] = useState<string[]>(seed);
  const [pending, start] = useTransition();

  const toggle = (v: string) => {
    const next = active.includes(v)
      ? active.filter((x) => x !== v)
      : [...active, v];
    const finalNext = next.length > 0 ? next : ["consolidated"];
    setActive(finalNext);
    onChange?.(finalNext);
    start(async () => {
      const r = await updateClientPreferences({
        client_id: clientId,
        letter_types_active: finalNext,
      });
      if (!r.ok) {
        toast.error(r.error ?? "Save failed — refreshing");
        setActive(active);
        onChange?.(active);
      }
    });
  };

  return (
    <div
      style={{
        padding: "8px 12px",
        marginBottom: 10,
        background: "rgba(255, 107, 53, 0.04)",
        border: "1px dashed rgba(255, 107, 53, 0.30)",
        borderRadius: "var(--fm-radius-sm)",
      }}
    >
      <div
        style={{
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: 0.6,
          fontWeight: 700,
          color: "var(--fm-text-tertiary)",
          marginBottom: 6,
          display: "flex",
          gap: 8,
          alignItems: "center",
        }}
      >
        📤 Letters this client receives
        {pending && (
          <span style={{ fontSize: 10, fontWeight: 500, opacity: 0.7 }}>
            saving…
          </span>
        )}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {LETTER_TYPES.map((t) => {
          const on = active.includes(t.value);
          return (
            <button
              key={t.value}
              onClick={() => toggle(t.value)}
              disabled={pending}
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: "4px 10px",
                borderRadius: 999,
                border: on
                  ? "1.5px solid var(--fm-primary)"
                  : "1px solid var(--fm-border)",
                background: on ? "var(--fm-primary)" : "var(--fm-surface)",
                color: on ? "#fff" : "var(--fm-text-secondary)",
                cursor: pending ? "wait" : "pointer",
                transition: "all 0.15s",
              }}
              title={on ? "Click to hide this letter type" : "Click to enable"}
            >
              {on ? "✓ " : ""}
              {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
