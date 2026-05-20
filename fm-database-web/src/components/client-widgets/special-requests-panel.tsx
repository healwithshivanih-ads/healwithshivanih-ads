"use client";

/**
 * SpecialRequestsPanel — gathers per-letter context the coach wants the AI
 * to honour BEFORE generation. Produces a structured note block that's
 * appended to coach_notes and passed straight through to the prompt.
 *
 * Three flavours:
 *   1. Meal preference chips (eggs at breakfast, IF until 11am, …) —
 *      one-click toggles.
 *   2. Travel window — date range + destination + cooking access. The
 *      prompt builder uses this to insert a dedicated "Travel week"
 *      subsection with restaurant-ordering guidance for the named
 *      destination (works for any city / country — AI is FM-trained
 *      and knows local cuisine).
 *   3. Freeform — coach types anything else.
 *
 * Output (single string) appended to coach notes:
 *
 *   === SPECIAL REQUESTS ===
 *   Meal preferences: 🍳 Eggs at breakfast · ⏰ IF until 11am
 *   🧳 Travel: 22 May → 26 May to Bangkok (restaurants only)
 *   Freeform: Family staying with us — extra portions, kid-friendly options.
 *   === END SPECIAL REQUESTS ===
 *
 * Cost impact: ~500-1000 extra input tokens (~$0.003 per letter at Sonnet
 * rates). Output may grow 10-15% if travel section is added (~$0.015).
 * Total ~2¢ per letter — see SpecialRequestsPanel docstring decision log.
 */

import { useEffect, useMemo, useState } from "react";

const MEAL_CHIPS: { id: string; label: string }[] = [
  { id: "eggs_breakfast", label: "🍳 Eggs at breakfast" },
  { id: "if_11am", label: "⏰ IF until 11am" },
  { id: "no_weekend_brekkie", label: "🌅 No breakfast on weekends" },
  { id: "skip_evening_snack", label: "🚫 Skip evening snack" },
  { id: "vegan_saturday", label: "🌱 Vegan one day/week" },
  { id: "detox_week", label: "🍵 Detox week (no coffee/sugar/alcohol)" },
  { id: "festival_flex", label: "🎉 Festival week — flexibility" },
  { id: "family_visiting", label: "👨‍👩‍👧 Family visiting — extra portions" },
];

type CookingStyle = "simple" | "standard" | "elaborate";
type Variety = "daily" | "rotation" | "minimal";

const COOKING_STYLE_OPTIONS: { value: CookingStyle; label: string; desc: string }[] = [
  { value: "simple",    label: "⏱️ Quick & simple", desc: "≤20 min prep · minimal ingredients · one-pot meals OK" },
  { value: "standard",  label: "🍳 Standard",       desc: "Normal home cooking · 30-40 min OK" },
  { value: "elaborate", label: "🥘 Happy to cook",   desc: "Anything goes · weekend projects fine" },
];

const VARIETY_OPTIONS: { value: Variety; label: string; desc: string }[] = [
  { value: "daily",    label: "🌈 Different every day",   desc: "7 distinct meals per slot per week" },
  { value: "rotation", label: "🔁 Limited rotation",     desc: "Max 3-4 variations per slot · rotate through the week" },
  { value: "minimal",  label: "🍱 Minimal variety",       desc: "Same 2 breakfasts, 2 lunches, 2 dinners rotated · meal-prep friendly" },
];

export interface SpecialRequests {
  block: string;       // the full formatted block to append to coach notes
  isEmpty: boolean;
}

interface TravelBlock {
  enabled: boolean;
  fromDate: string;
  toDate: string;
  destination: string;
  cookingAccess: "cook" | "restaurants" | "mixed";
}

interface Props {
  onChange: (req: SpecialRequests) => void;
  disabled?: boolean;
}

export function SpecialRequestsPanel({ onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [chips, setChips] = useState<Set<string>>(new Set());
  const [freeform, setFreeform] = useState("");
  const [cookingStyle, setCookingStyle] = useState<CookingStyle | null>(null);
  const [variety, setVariety] = useState<Variety | null>(null);
  const [maxVarieties, setMaxVarieties] = useState<number | "">(""); // optional fine-tune
  const [travel, setTravel] = useState<TravelBlock>({
    enabled: false,
    fromDate: "",
    toDate: "",
    destination: "",
    cookingAccess: "restaurants",
  });

  const block = useMemo(() => {
    const parts: string[] = [];
    const mealLabels = MEAL_CHIPS.filter((c) => chips.has(c.id)).map((c) => c.label);
    if (mealLabels.length > 0) {
      parts.push(`Meal preferences: ${mealLabels.join(" · ")}`);
    }
    if (cookingStyle) {
      const opt = COOKING_STYLE_OPTIONS.find((o) => o.value === cookingStyle)!;
      const cookingRule =
        cookingStyle === "simple"
          ? "Every meal MUST be ≤20 min hands-on prep. Use one-pot dishes, " +
            "quick-cook grains (oats, poha, upma), pre-cooked dals, simple stir-fries. " +
            "No layered curries, no overnight soaks unless trivial (overnight oats fine). " +
            "Mention prep time in the meal plan rationale when picking dishes."
          : cookingStyle === "elaborate"
            ? "Client is happy to spend time cooking — weekend project meals, slow-cooked " +
              "dals, fermented preps, multi-step recipes are all welcome. Use it as an opportunity " +
              "for nutrient-dense traditional preparations."
            : "Standard home cooking — 30-40 min meals are fine. No need to optimise for " +
              "speed but don't get elaborate either.";
      parts.push(`Cooking style: ${opt.label} (${opt.desc}). ${cookingRule}`);
    }
    if (variety) {
      const opt = VARIETY_OPTIONS.find((o) => o.value === variety)!;
      const varietyRule =
        variety === "minimal"
          ? "Use only 2 breakfast variants, 2 lunch variants, 2 dinner variants for the whole week — " +
            "rotate them (e.g. Mon/Wed/Fri = variant A, Tue/Thu/Sat = variant B, Sun = either). " +
            "This is intentional — meal prep + grocery shopping efficiency. Don't apologise for repetition."
          : variety === "rotation"
            ? `Max ${maxVarieties && Number(maxVarieties) > 0 ? maxVarieties : "3-4"} distinct dish variants per meal slot per week — ` +
              "rotate them through the days rather than inventing 7 new things. " +
              "Pick variants that share base ingredients (e.g. all 3 breakfasts use rolled oats + different toppings) " +
              "to minimise grocery + prep overhead."
            : "7 distinct dish variations per meal slot — full variety, treat the week as a discovery palette.";
      parts.push(`Meal variety: ${opt.label} — ${varietyRule}`);
    }
    if (travel.enabled && travel.destination.trim() && travel.fromDate && travel.toDate) {
      const access =
        travel.cookingAccess === "cook"
          ? "kitchen access — can cook"
          : travel.cookingAccess === "restaurants"
            ? "restaurants only — no cooking"
            : "mixed — some cooking, some eating out";
      parts.push(
        `🧳 TRAVEL: ${travel.fromDate} → ${travel.toDate} to ${travel.destination.trim()} (${access}). ` +
          `Add a dedicated "Travel week" subsection to the meal plan for these exact dates: ` +
          `restaurant-ordering rules for ${travel.destination.trim()} cuisine that fit the client's ` +
          `protocol (respect allergies, glycaemic load, dietary preference, reported triggers). ` +
          `List 6-10 specific dishes to order + 2-3 to avoid. Keep it warm and practical, not a lecture.`,
      );
    }
    const ff = freeform.trim();
    if (ff) parts.push(`Freeform: ${ff}`);
    if (parts.length === 0) return "";
    return [
      "=== SPECIAL REQUESTS ===",
      ...parts,
      "=== END SPECIAL REQUESTS ===",
    ].join("\n");
  }, [chips, freeform, travel, cookingStyle, variety, maxVarieties]);

  useEffect(() => {
    onChange({ block, isEmpty: block === "" });
  }, [block, onChange]);

  const toggleChip = (id: string) => {
    setChips((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const activeCount =
    chips.size +
    (cookingStyle ? 1 : 0) +
    (variety ? 1 : 0) +
    (travel.enabled && travel.destination.trim() ? 1 : 0) +
    (freeform.trim() ? 1 : 0);

  return (
    <div
      style={{
        border: "1px dashed var(--fm-border)",
        borderRadius: "var(--fm-radius-md)",
        background: "rgba(43, 45, 66, 0.02)",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        style={{
          width: "100%",
          padding: "8px 12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          background: "transparent",
          border: 0,
          cursor: disabled ? "not-allowed" : "pointer",
          textAlign: "left",
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--fm-text-primary)" }}>
          🧳 Special requests + travel{" "}
          {activeCount > 0 && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: "1px 6px",
                borderRadius: 999,
                background: "var(--fm-primary)",
                color: "#fff",
                marginLeft: 4,
              }}
            >
              {activeCount}
            </span>
          )}
        </span>
        <span style={{ fontSize: 11, color: "var(--fm-text-tertiary)" }}>
          {open ? "▲" : "▼"}
        </span>
      </button>

      {open && (
        <div style={{ padding: "0 12px 12px", display: "grid", gap: 14 }}>
          {/* Meal preference chips */}
          <div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: 0.6,
                color: "var(--fm-text-tertiary)",
                marginBottom: 6,
              }}
            >
              Meal preferences (toggle any)
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {MEAL_CHIPS.map((c) => {
                const on = chips.has(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleChip(c.id)}
                    disabled={disabled}
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
                      cursor: disabled ? "not-allowed" : "pointer",
                    }}
                  >
                    {on ? "✓ " : ""}
                    {c.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Cooking style — Quick / Standard / Elaborate. Single-select.
              Click again to clear (returns to "no preference set"). */}
          <div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: 0.6,
                color: "var(--fm-text-tertiary)",
                marginBottom: 6,
              }}
            >
              Cooking style
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {COOKING_STYLE_OPTIONS.map((o) => {
                const on = cookingStyle === o.value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => setCookingStyle(on ? null : o.value)}
                    disabled={disabled}
                    title={o.desc}
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
                      cursor: disabled ? "not-allowed" : "pointer",
                    }}
                  >
                    {on ? "✓ " : ""}
                    {o.label}
                  </button>
                );
              })}
            </div>
            {cookingStyle && (
              <div style={{ fontSize: 11, color: "var(--fm-text-tertiary)", marginTop: 4 }}>
                {COOKING_STYLE_OPTIONS.find((o) => o.value === cookingStyle)?.desc}
              </div>
            )}
          </div>

          {/* Meal variety — Different daily / Limited rotation / Minimal.
              Optional fine-tune: "max varieties per slot" number when
              Limited rotation is selected. */}
          <div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: 0.6,
                color: "var(--fm-text-tertiary)",
                marginBottom: 6,
              }}
            >
              Meal variety
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {VARIETY_OPTIONS.map((o) => {
                const on = variety === o.value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => setVariety(on ? null : o.value)}
                    disabled={disabled}
                    title={o.desc}
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
                      cursor: disabled ? "not-allowed" : "pointer",
                    }}
                  >
                    {on ? "✓ " : ""}
                    {o.label}
                  </button>
                );
              })}
            </div>
            {variety && (
              <div style={{ fontSize: 11, color: "var(--fm-text-tertiary)", marginTop: 4 }}>
                {VARIETY_OPTIONS.find((o) => o.value === variety)?.desc}
              </div>
            )}
            {variety === "rotation" && (
              <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8 }}>
                <label style={{ fontSize: 11, color: "var(--fm-text-secondary)" }}>
                  Max varieties per meal slot:
                </label>
                <input
                  type="number"
                  min={2}
                  max={7}
                  value={maxVarieties}
                  onChange={(e) =>
                    setMaxVarieties(e.target.value === "" ? "" : Math.max(2, Math.min(7, Number(e.target.value))))
                  }
                  disabled={disabled}
                  placeholder="3-4"
                  style={{
                    width: 60,
                    fontSize: 12,
                    padding: "3px 8px",
                    border: "1px solid var(--fm-border)",
                    borderRadius: "var(--fm-radius-sm)",
                    textAlign: "center",
                  }}
                />
                <span style={{ fontSize: 11, color: "var(--fm-text-tertiary)" }}>
                  (default 3-4)
                </span>
              </div>
            )}
          </div>

          {/* Travel window */}
          <div>
            <label
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "var(--fm-text-primary)",
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginBottom: travel.enabled ? 8 : 0,
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={travel.enabled}
                onChange={(e) => setTravel((t) => ({ ...t, enabled: e.target.checked }))}
                disabled={disabled}
              />
              🧳 Client traveling during this plan window
            </label>
            {travel.enabled && (
              <div
                style={{
                  display: "grid",
                  gap: 8,
                  padding: "8px 10px",
                  background: "var(--fm-surface)",
                  border: "1px solid var(--fm-border-light)",
                  borderRadius: "var(--fm-radius-sm)",
                }}
              >
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div>
                    <label style={kvLabel()}>From</label>
                    <input
                      type="date"
                      value={travel.fromDate}
                      onChange={(e) => setTravel((t) => ({ ...t, fromDate: e.target.value }))}
                      disabled={disabled}
                      style={dateInput()}
                    />
                  </div>
                  <div>
                    <label style={kvLabel()}>To</label>
                    <input
                      type="date"
                      value={travel.toDate}
                      onChange={(e) => setTravel((t) => ({ ...t, toDate: e.target.value }))}
                      disabled={disabled}
                      style={dateInput()}
                    />
                  </div>
                </div>
                <div>
                  <label style={kvLabel()}>Destination</label>
                  <input
                    type="text"
                    value={travel.destination}
                    onChange={(e) =>
                      setTravel((t) => ({ ...t, destination: e.target.value }))
                    }
                    placeholder="e.g. Bangkok · Goa · London · Chennai"
                    disabled={disabled}
                    style={dateInput()}
                  />
                </div>
                <div>
                  <label style={kvLabel()}>Cooking access</label>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {(["restaurants", "cook", "mixed"] as const).map((mode) => {
                      const on = travel.cookingAccess === mode;
                      const labelText =
                        mode === "restaurants"
                          ? "Restaurants only"
                          : mode === "cook"
                            ? "Can cook (Airbnb/family)"
                            : "Mixed";
                      return (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setTravel((t) => ({ ...t, cookingAccess: mode }))}
                          disabled={disabled}
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
                            cursor: disabled ? "not-allowed" : "pointer",
                          }}
                        >
                          {on ? "✓ " : ""}
                          {labelText}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Freeform */}
          <div>
            <label
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "var(--fm-text-primary)",
                display: "block",
                marginBottom: 4,
              }}
            >
              Anything else for the AI
            </label>
            <textarea
              rows={2}
              value={freeform}
              onChange={(e) => setFreeform(e.target.value)}
              disabled={disabled}
              placeholder="e.g. Daughter's wedding 12 June — relaxed plan that week. Or: client is fasting Tue/Thu — no breakfast on those days."
              style={{
                width: "100%",
                fontSize: 12,
                padding: "6px 8px",
                border: "1px solid var(--fm-border)",
                borderRadius: "var(--fm-radius-sm)",
                resize: "none",
                background: "var(--fm-surface)",
              }}
            />
          </div>

          {block && (
            <div
              style={{
                fontSize: 11,
                color: "var(--fm-text-tertiary)",
                fontFamily: "var(--fm-font-mono)",
                whiteSpace: "pre-wrap",
                padding: "6px 8px",
                background: "var(--fm-bg-warm, rgba(255,107,53,0.04))",
                border: "1px dashed rgba(255,107,53,0.25)",
                borderRadius: "var(--fm-radius-sm)",
              }}
            >
              {block}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function kvLabel(): React.CSSProperties {
  return {
    fontSize: 10,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: "var(--fm-text-tertiary)",
    marginBottom: 3,
    display: "block",
  };
}

function dateInput(): React.CSSProperties {
  return {
    width: "100%",
    fontSize: 12,
    padding: "4px 8px",
    border: "1px solid var(--fm-border)",
    borderRadius: "var(--fm-radius-sm)",
    background: "var(--fm-surface)",
  };
}
