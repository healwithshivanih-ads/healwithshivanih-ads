"use client";

/**
 * PlanModulesPanel — the one place that lists every optional plan layer/module
 * for a client as a checklist, so nothing is missed when a plan is authored.
 * Registry-driven (src/lib/fmdb/plan-modules.ts).
 *
 * Rows by storage type:
 *   - "ayurveda"       → the existing <AyurvedaToggle> (full constitution + quiz
 *                        controls). Canonical state stays on client.ayurveda_enabled.
 *   - "meal_plan_type" → a 3-way picker bound to client.meal_plan_style (lifted
 *                        from the old Profile-memory panel so there's a single
 *                        home for plan layers).
 *   - "plan_modules"   → generic on/off toggles whose state is membership in
 *                        client.plan_modules. These persist + show as a coach
 *                        reminder; deep generation wiring is a per-module
 *                        follow-on (status: "scaffold").
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  updateClientPreferences,
  updateClientProfile,
} from "@/lib/server-actions/clients";
import { ensureDetailedMenuAction } from "@/lib/server-actions/weekly-menu";
import { PLAN_MODULES, type PlanModuleDef } from "@/lib/fmdb/plan-modules";
import { AyurvedaToggle } from "./ayurveda-toggle";

type MealPlanStyle = "detailed" | "principles" | "hybrid";

interface Props {
  clientId: string;
  ayurvedaEnabled?: boolean;
  ayurvedaConstitution?: string;
  ayurvedaAssessment?: Record<string, unknown> | null;
  /** Decoupled dosha-quiz-in-intake switch (default on for new clients). */
  collectDoshaQuiz?: boolean;
  mealPlanStyle?: MealPlanStyle;
  /** client.plan_modules — enabled ids of the toggle-able modules. */
  planModules?: string[];
}

export function PlanModulesPanel({
  clientId,
  ayurvedaEnabled,
  ayurvedaConstitution,
  ayurvedaAssessment,
  collectDoshaQuiz,
  mealPlanStyle,
  planModules,
}: Props) {
  // Local state for the generic ("plan_modules") toggles — optimistic.
  const [mods, setMods] = useState<string[]>(planModules ?? []);
  const [pending, start] = useTransition();

  const toggleModule = (id: string, next: boolean) => {
    const prev = mods;
    const updated = next
      ? Array.from(new Set([...prev, id]))
      : prev.filter((m) => m !== id);
    setMods(updated);
    start(async () => {
      const r = await updateClientPreferences({
        client_id: clientId,
        plan_modules: updated,
      });
      if (!r.ok) {
        toast.error(r.error ?? "Save failed", { duration: 12000 });
        setMods(prev);
      } else {
        toast.success(next ? "Module enabled for this client" : "Module disabled");
      }
    });
  };

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <p
        style={{
          fontSize: 11.5,
          color: "var(--fm-text-tertiary)",
          fontStyle: "italic",
          margin: 0,
          lineHeight: 1.5,
        }}
      >
        Tick the optional layers to weave into this client&apos;s plan, so none get
        missed when you author it. Enabled layers carry forward to assessment, the
        plan &amp; the app.
      </p>

      {PLAN_MODULES.map((m) => {
        if (m.storage === "ayurveda_enabled") {
          return (
            <AyurvedaToggle
              key={m.id}
              clientId={clientId}
              initialEnabled={ayurvedaEnabled}
              initialConstitution={ayurvedaConstitution}
              initialCollectDoshaQuiz={collectDoshaQuiz}
              assessment={ayurvedaAssessment}
            />
          );
        }
        if (m.storage === "meal_plan_style") {
          return (
            <MealPlanTypeRow
              key={m.id}
              module={m}
              clientId={clientId}
              initial={mealPlanStyle ?? "hybrid"}
            />
          );
        }
        // generic plan_modules toggle
        return (
          <ModuleToggle
            key={m.id}
            module={m}
            checked={mods.includes(m.id)}
            disabled={pending}
            onToggle={(next) => toggleModule(m.id, next)}
          />
        );
      })}
    </div>
  );
}

/* ── Generic on/off module toggle (scaffold modules) ─────────────────────── */

function ModuleToggle({
  module: m,
  checked,
  disabled,
  onToggle,
}: {
  module: PlanModuleDef;
  checked: boolean;
  disabled: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <div
      style={{
        padding: "12px 14px",
        background: checked ? "rgba(59, 130, 130, 0.06)" : "var(--fm-surface)",
        border: `1px solid ${checked ? "rgba(59, 130, 130, 0.32)" : "var(--fm-border-light)"}`,
        borderRadius: "var(--fm-radius-sm)",
      }}
    >
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          cursor: disabled ? "wait" : "pointer",
          fontWeight: 600,
          fontSize: 13,
        }}
      >
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onToggle(e.target.checked)}
        />
        <span>
          {m.icon} {m.label}
        </span>
        {m.status === "scaffold" && (
          <span
            style={{
              fontSize: 9.5,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: 0.5,
              color: "#9a6b1f",
              background: "rgba(217,162,80,0.16)",
              border: "1px solid rgba(217,162,80,0.4)",
              borderRadius: 999,
              padding: "1px 7px",
            }}
            title="The flag is saved on the client now. Full assessment / plan / app wiring for this module is a follow-on build — for now, add the content to the plan yourself."
          >
            flag only
          </span>
        )}
      </label>
      <p
        style={{
          fontSize: 11,
          color: "var(--fm-text-tertiary)",
          margin: "4px 0 0 24px",
          lineHeight: 1.45,
        }}
      >
        {m.blurb}
      </p>
    </div>
  );
}

/* ── Meal plan type (3-way) — bound to client.meal_plan_style ─────────────── */

const MEAL_STYLE_OPTIONS: {
  value: MealPlanStyle;
  emoji: string;
  label: string;
  desc: string;
}[] = [
  {
    value: "detailed",
    emoji: "📅",
    label: "Detailed",
    desc: "Full Mon-Sun tables in the app menu.",
  },
  {
    value: "principles",
    emoji: "🟢",
    label: "Principles",
    desc: "Categories + do's/don'ts + 5 ideas/slot. No grid.",
  },
  {
    value: "hybrid",
    emoji: "🌗",
    label: "Hybrid",
    desc: "Principles first, then ONE sample week. Default.",
  },
];

function MealPlanTypeRow({
  module: m,
  clientId,
  initial,
}: {
  module: PlanModuleDef;
  clientId: string;
  initial: MealPlanStyle;
}) {
  const router = useRouter();
  const [value, setValue] = useState<MealPlanStyle>(initial);
  const [pending, start] = useTransition();

  const onPick = (next: MealPlanStyle) => {
    if (next === value) return;
    const prev = value;
    const switchingToDetailed = next === "detailed" && prev !== "detailed";
    setValue(next);
    start(async () => {
      const res = await updateClientProfile({ client_id: clientId, meal_plan_style: next });
      if (!res.ok) {
        toast.error(res.error ?? "Save failed", { duration: 12000 });
        setValue(prev);
        return;
      }
      toast.success(`Meal plan style → ${next}`);
      if (switchingToDetailed) {
        toast.message("Generating this client's daily menu — ~1-2 min…");
        const gen = await ensureDetailedMenuAction(clientId);
        if (!gen.ok) {
          toast.error(
            `Style saved, but the daily menu didn't generate: ${gen.error ?? "unknown error"}. Try again from the app-preview panel.`,
            { duration: 15000 },
          );
        } else if (gen.alreadyDetailed) {
          toast.success("This client already had a full detailed menu.");
        } else {
          toast.success(`Detailed menu ready — ${gen.weeks} week(s), ${gen.dishes} dishes.`);
        }
      }
      router.refresh();
    });
  };

  return (
    <div
      style={{
        padding: "12px 14px",
        background: "var(--fm-surface)",
        border: "1px solid var(--fm-border-light)",
        borderRadius: "var(--fm-radius-sm)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontWeight: 600,
          fontSize: 13,
        }}
      >
        <span>
          {m.icon} {m.label}
        </span>
        {pending && (
          <span style={{ fontSize: 10, opacity: 0.6, fontWeight: 500 }}>saving…</span>
        )}
      </div>
      <p
        style={{
          fontSize: 11,
          color: "var(--fm-text-tertiary)",
          margin: "4px 0 8px",
          lineHeight: 1.45,
        }}
      >
        {m.blurb}
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
        {MEAL_STYLE_OPTIONS.map((opt) => {
          const checked = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onPick(opt.value)}
              disabled={pending}
              style={{
                display: "grid",
                gap: 2,
                padding: "7px 9px",
                textAlign: "left",
                background: checked ? "rgba(245, 158, 11, 0.12)" : "var(--fm-bg-cool)",
                border: checked
                  ? "1.5px solid rgba(245, 158, 11, 0.65)"
                  : "1px solid var(--fm-border-light)",
                borderRadius: "var(--fm-radius-sm)",
                cursor: pending ? "wait" : "pointer",
                fontFamily: "inherit",
                color: "var(--fm-text-primary)",
              }}
            >
              <span style={{ fontSize: 11, fontWeight: 700 }}>
                {opt.emoji} {opt.label}
              </span>
              <span style={{ fontSize: 10, color: "var(--fm-text-tertiary)", lineHeight: 1.4 }}>
                {opt.desc}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
