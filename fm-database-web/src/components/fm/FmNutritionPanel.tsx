"use client";

/**
 * FmNutritionPanel — surfaces the plan's nutrition block on the Plan tab.
 *
 * Today the AI synthesis writes a structured nutrition object onto every
 * plan:
 *
 *   nutrition:
 *     pattern: "Low-glycaemic Indian non-vegetarian metabolic reset…"
 *     add:    ["wild-caught salmon", "leafy greens", "fermented foods", …]
 *     reduce: ["refined sugar", "white rice", "ultra-processed snacks", …]
 *     meal_timing: "12-hour eating window; first bite after 09:00…"
 *     cooking_adjustments: ["use-cast-iron", "swap-to-ghee-or-coconut-oil"]
 *     home_remedies: ["triphala-churan", "cumin-coriander-fennel-tea"]
 *
 * Before this primitive the Plan tab v2 didn't show ANY of that — the
 * coach had to drop into the classic editor to read what the AI had
 * suggested.  This panel surfaces every field with FM v2 typography.
 *
 * Design reference: FM Backlog Explorations Group D5 — the locked
 * design called for a 7-day × meal grid with featured-recipe sidecar.
 * That grid now lives on the plan as `plan.app_menu` (authored + approved
 * in the Menu studio / AppPreviewPanel and delivered by the client app —
 * letters are retired).  This primitive renders the structured nutrition
 * fields (pattern / add / reduce / timing / cooking / remedies) with FM v2
 * typography, plus a pointer to the Menu studio where the 7-day menu lives.
 */
import { useState } from "react";

export interface FmNutritionPanelProps {
  /** Raw plan.nutrition object — any shape from the plan YAML. */
  nutrition: Record<string, unknown> | null | undefined;
}

function asList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function prettySlug(slug: string): string {
  return slug
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function FmNutritionPanel({ nutrition }: FmNutritionPanelProps) {
  const [showFullPattern, setShowFullPattern] = useState(false);

  const pattern = asString(nutrition?.pattern);
  const add = asList(nutrition?.add);
  const reduce = asList(nutrition?.reduce);
  const mealTiming = asString(nutrition?.meal_timing);
  const cookingAdjs = asList(nutrition?.cooking_adjustments);
  const homeRemedies = asList(nutrition?.home_remedies);

  const hasAnything =
    !!pattern ||
    add.length > 0 ||
    reduce.length > 0 ||
    !!mealTiming ||
    cookingAdjs.length > 0 ||
    homeRemedies.length > 0;

  if (!hasAnything) {
    return (
      <div
        style={{
          padding: "10px 12px",
          background: "var(--fm-bg-cool)",
          borderRadius: "var(--fm-radius-sm)",
          fontSize: 12,
          color: "var(--fm-text-tertiary)",
        }}
      >
        No nutrition guidance on the plan yet. The next Full Assessment will
        populate this — pattern + foods to add / reduce + meal timing +
        cooking adjustments + home remedies.
      </div>
    );
  }

  const patternIsLong = pattern.length > 220;
  const patternDisplay =
    showFullPattern || !patternIsLong ? pattern : pattern.slice(0, 220).trim() + "…";

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {/* Pattern + meal timing — narrative cards */}
      {pattern && (
        <div
          style={{
            padding: "12px 14px",
            background: "var(--fm-bg-warm)",
            border: "1px solid rgba(255, 107, 53, 0.18)",
            borderRadius: "var(--fm-radius-sm)",
          }}
        >
          <div
            style={{
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: 0.6,
              fontWeight: 700,
              color: "var(--fm-primary)",
              marginBottom: 4,
            }}
          >
            Dietary pattern
          </div>
          <div
            style={{
              fontSize: 13,
              lineHeight: 1.6,
              color: "var(--fm-text-primary)",
              whiteSpace: "pre-wrap",
            }}
          >
            {patternDisplay}
          </div>
          {patternIsLong && (
            <button
              type="button"
              onClick={() => setShowFullPattern((v) => !v)}
              style={{
                marginTop: 6,
                background: "transparent",
                border: 0,
                color: "var(--fm-text-secondary)",
                fontSize: 11,
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
                padding: 0,
              }}
            >
              {showFullPattern ? "Show less" : "Show full pattern →"}
            </button>
          )}
        </div>
      )}

      {/* Add / Reduce chip lists */}
      {(add.length > 0 || reduce.length > 0) && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 10,
          }}
        >
          {add.length > 0 && (
            <ChipBlock
              icon="✅"
              label={`Add (${add.length})`}
              accent="green"
              items={add}
            />
          )}
          {reduce.length > 0 && (
            <ChipBlock
              icon="⚠"
              label={`Reduce / avoid (${reduce.length})`}
              accent="amber"
              items={reduce}
            />
          )}
        </div>
      )}

      {/* Meal timing */}
      {mealTiming && (
        <div
          style={{
            padding: "10px 12px",
            background: "var(--fm-surface)",
            border: "1px solid var(--fm-border-light)",
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
              marginBottom: 4,
            }}
          >
            ⏰ Meal timing
          </div>
          <div
            style={{
              fontSize: 12,
              lineHeight: 1.55,
              color: "var(--fm-text-primary)",
              whiteSpace: "pre-wrap",
            }}
          >
            {mealTiming}
          </div>
        </div>
      )}

      {/* Cooking adjustments + Home remedies (slug → pretty label) */}
      {(cookingAdjs.length > 0 || homeRemedies.length > 0) && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 10,
          }}
        >
          {cookingAdjs.length > 0 && (
            <ChipBlock
              icon="🍳"
              label={`Cooking adjustments (${cookingAdjs.length})`}
              items={cookingAdjs.map(prettySlug)}
            />
          )}
          {homeRemedies.length > 0 && (
            <ChipBlock
              icon="🌿"
              label={`Home remedies (${homeRemedies.length})`}
              items={homeRemedies.map(prettySlug)}
            />
          )}
        </div>
      )}

      {/* Info — the full 7-day menu lives on the plan, delivered in-app */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "10px 14px",
          background: "var(--fm-bg-cool)",
          borderRadius: "var(--fm-radius-sm)",
          fontSize: 12,
          color: "var(--fm-text-secondary)",
        }}
      >
        <span style={{ fontSize: 18 }}>🍽</span>
        <div style={{ flex: 1, lineHeight: 1.5 }}>
          The full 7-day menu grid + Indian recipe collection lives on the
          plan — generate and approve it in the Menu studio (the app preview
          further down this tab). The client&apos;s app delivers it from the
          published plan; there&apos;s no separate letter to send.
        </div>
      </div>
    </div>
  );
}

function ChipBlock({
  icon,
  label,
  items,
  accent,
}: {
  icon: string;
  label: string;
  items: string[];
  accent?: "green" | "amber";
}) {
  const palette =
    accent === "green"
      ? {
          bg: "rgba(46, 204, 113, 0.08)",
          border: "rgba(46, 204, 113, 0.30)",
          chipBg: "rgba(46, 204, 113, 0.12)",
          chipFg: "#1e8449",
        }
      : accent === "amber"
        ? {
            bg: "rgba(184, 119, 10, 0.06)",
            border: "rgba(184, 119, 10, 0.30)",
            chipBg: "rgba(184, 119, 10, 0.12)",
            chipFg: "#8a560a",
          }
        : {
            bg: "var(--fm-surface)",
            border: "var(--fm-border-light)",
            chipBg: "var(--fm-bg-cool)",
            chipFg: "var(--fm-text-secondary)",
          };
  return (
    <div
      style={{
        padding: "10px 12px",
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        borderRadius: "var(--fm-radius-sm)",
      }}
    >
      <div
        style={{
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: 0.6,
          fontWeight: 700,
          color: "var(--fm-text-secondary)",
          marginBottom: 6,
        }}
      >
        {icon} {label}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {items.map((it, i) => (
          <span
            key={`${it}-${i}`}
            style={{
              display: "inline-block",
              padding: "3px 9px",
              background: palette.chipBg,
              color: palette.chipFg,
              borderRadius: "var(--fm-radius-pill)",
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            {it}
          </span>
        ))}
      </div>
    </div>
  );
}
