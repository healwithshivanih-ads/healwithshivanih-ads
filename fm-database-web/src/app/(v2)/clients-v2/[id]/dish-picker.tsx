"use client";

/**
 * DishPicker — selectable meal editor for the Plan-tab Menu studio
 * (2026-06-15). Replaces free-text dish editing: a dish is COMPOSED from
 * recipe-library selections (each a component + editable portion), so every
 * dish stays linked to a recipe → method, photo, accurate calories and the
 * grocery list all resolve. The coach picks, never types the dish name; only
 * the portion is free text.
 *
 * Multi-component meals (e.g. "Masoor dal + jowar bhakri + sabzi") parse into
 * rows; the coach swaps any one via search, adds, or removes a component.
 *
 * AI (Step 3) plugs into the search panel: ranked suggestions inline + a
 * "Create new recipe" action when nothing in the library fits.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  searchRecipesAction,
  generateRecipeAction,
  type PickerRecipe,
} from "@/lib/server-actions/recipe-picker";
import { setMealOverrideAction } from "@/lib/server-actions/app-preview";

interface Comp {
  title: string;
  portion: string;
}

// A trailing "(…)" that names a portion (digit or household unit) — used to
// split the editable portion off the recipe title.
const PORTION_RE =
  /\(([^)]*(?:\d|bowls?|cups?|glass|katori|tbsp|tsp|pieces?|small|large|medium|\bml\b|grams?|\bg\b|slice|half|handful)[^)]*)\)/i;

function parseDish(dish: string): Comp[] {
  return dish
    .split(/\s\+\s/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((comp) => {
      const m = comp.match(PORTION_RE);
      if (m) {
        return {
          title: comp.replace(m[0], "").replace(/\s+/g, " ").trim(),
          portion: m[1].trim(),
        };
      }
      return { title: comp, portion: "" };
    });
}

function composeDish(comps: Comp[]): string {
  return comps
    .filter((c) => c.title.trim())
    .map((c) => (c.portion.trim() ? `${c.title.trim()} (${c.portion.trim()})` : c.title.trim()))
    .join(" + ");
}

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(30,24,20,0.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
  padding: 16,
};

export function DishPicker({
  clientId,
  week,
  dayIdx,
  slot,
  currentDish,
  overridden,
  onClose,
  onSaved,
}: {
  clientId: string;
  week: number;
  dayIdx: number;
  slot: string;
  currentDish: string;
  overridden: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [comps, setComps] = useState<Comp[]>(() => parseDish(currentDish));
  const [searchFor, setSearchFor] = useState<number | "new" | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PickerRecipe[]>([]);
  const [searching, setSearching] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [cuisine, setCuisine] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"" | "save" | "reset">("");
  const [error, setError] = useState("");
  const deb = useRef<ReturnType<typeof setTimeout> | null>(null);

  // debounced diet-filtered search
  useEffect(() => {
    if (searchFor === null) return;
    if (deb.current) clearTimeout(deb.current);
    deb.current = setTimeout(async () => {
      setSearching(true);
      const out = await searchRecipesAction(clientId, query).catch(() => ({
        ok: false as const,
        recipes: [],
      }));
      setResults(out.ok ? out.recipes : []);
      setSearching(false);
    }, 250);
    return () => {
      if (deb.current) clearTimeout(deb.current);
    };
  }, [query, searchFor, clientId]);

  const openSearch = (idx: number | "new") => {
    setSearchFor(idx);
    setQuery(idx === "new" ? "" : comps[idx]?.title ?? "");
    setResults([]);
  };

  const pick = useCallback(
    (r: PickerRecipe) => {
      setComps((cs) => {
        if (searchFor === "new") return [...cs, { title: r.title, portion: "1 bowl" }];
        if (typeof searchFor === "number") {
          const next = cs.slice();
          next[searchFor] = { ...next[searchFor], title: r.title };
          return next;
        }
        return cs;
      });
      setSearchFor(null);
      setQuery("");
    },
    [searchFor],
  );

  const generate = async () => {
    const name = query.trim();
    if (!name) return;
    setGenerating(true);
    setError("");
    const out = await generateRecipeAction(clientId, name, {
      slot,
      cuisine: cuisine.trim(),
      note: note.trim(),
    }).catch((e) => ({
      ok: false as const,
      error: String(e),
    }));
    setGenerating(false);
    if (out.ok && out.recipe) pick(out.recipe);
    else setError(out.error ?? "Couldn't create the recipe");
  };

  const save = async () => {
    setBusy("save");
    setError("");
    const dish = composeDish(comps);
    const out = await setMealOverrideAction(clientId, week, dayIdx, slot, dish || null).catch(
      (e) => ({ ok: false as const, error: String(e) }),
    );
    setBusy("");
    if (out.ok) onSaved();
    else setError(out.error ?? "Save failed");
  };

  const reset = async () => {
    setBusy("reset");
    setError("");
    const out = await setMealOverrideAction(clientId, week, dayIdx, slot, null).catch((e) => ({
      ok: false as const,
      error: String(e),
    }));
    setBusy("");
    if (out.ok) onSaved();
    else setError(out.error ?? "Reset failed");
  };

  return (
    <div style={overlay} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--fm-surface, #fff)",
          borderRadius: "var(--fm-radius-lg, 12px)",
          width: "min(560px, 100%)",
          maxHeight: "86vh",
          overflow: "auto",
          boxShadow: "0 24px 60px rgba(30,24,20,0.3)",
        }}
      >
        {/* header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "14px 18px",
            borderBottom: "1px solid var(--fm-border, #eee)",
            position: "sticky",
            top: 0,
            background: "var(--fm-surface, #fff)",
            zIndex: 1,
          }}
        >
          <b style={{ fontSize: 14 }}>🍽 Edit {slot.toLowerCase()}</b>
          <span style={{ fontSize: 11, color: "var(--fm-text-tertiary, #999)" }}>
            pick from the recipe library — keeps the photo, method &amp; calories
          </span>
          <button
            onClick={onClose}
            style={{ marginLeft: "auto", border: "none", background: "none", fontSize: 18, cursor: "pointer", color: "var(--fm-text-tertiary)" }}
          >
            ✕
          </button>
        </div>

        <div style={{ padding: 16, display: "grid", gap: 10 }}>
          {/* component rows */}
          {comps.map((c, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                border: "1px solid var(--fm-border-light, #f0f0f0)",
                borderRadius: "var(--fm-radius-md, 8px)",
                padding: "8px 10px",
              }}
            >
              <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600 }}>
                {c.title || <span style={{ color: "var(--fm-text-tertiary)" }}>—</span>}
              </span>
              <input
                value={c.portion}
                onChange={(e) =>
                  setComps((cs) => cs.map((x, idx) => (idx === i ? { ...x, portion: e.target.value } : x)))
                }
                placeholder="portion"
                style={{
                  flex: "0 0 92px",
                  fontSize: 12,
                  padding: "4px 7px",
                  borderRadius: 6,
                  border: "1px solid var(--fm-border, #e0e0e0)",
                  fontFamily: "inherit",
                }}
              />
              <button
                onClick={() => openSearch(i)}
                style={pillBtn}
                title="Swap this for a library recipe"
              >
                🔍 change
              </button>
              <button
                onClick={() => setComps((cs) => cs.filter((_, idx) => idx !== i))}
                style={{ border: "none", background: "none", color: "#c9a88c", fontSize: 15, cursor: "pointer", padding: "0 4px" }}
              >
                ✕
              </button>
            </div>
          ))}

          <button onClick={() => openSearch("new")} style={dashedBtn}>
            + Add a dish from the library
          </button>

          {/* search panel */}
          {searchFor !== null && (
            <div
              style={{
                border: "1px solid var(--fm-primary, #FF6B35)",
                borderRadius: "var(--fm-radius-md, 8px)",
                padding: 12,
                background: "var(--fm-bg-warm, #FFF5F0)",
                display: "grid",
                gap: 10,
              }}
            >
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search recipes (diet-filtered)…"
                  style={{
                    flex: 1,
                    fontSize: 13,
                    padding: "8px 10px",
                    borderRadius: 7,
                    border: "1px solid var(--fm-border, #e0e0e0)",
                    fontFamily: "inherit",
                  }}
                />
                <button onClick={() => setSearchFor(null)} style={pillBtn}>
                  cancel
                </button>
              </div>
              {/* AI generate placeholder — wired in Step 3 */}
              <div style={{ maxHeight: 260, overflow: "auto", display: "grid", gap: 6 }}>
                {searching && (
                  <div style={{ fontSize: 12, color: "var(--fm-text-tertiary)" }}>Searching…</div>
                )}
                {!searching && results.length === 0 && (
                  <div style={{ fontSize: 12, color: "var(--fm-text-tertiary)" }}>
                    {query ? "No diet-safe match in the library yet." : "Type to search the recipe library."}
                  </div>
                )}
                {results.map((r) => (
                  <button
                    key={r.slug}
                    onClick={() => pick(r)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: 7,
                      border: "1px solid var(--fm-border-light, #f0f0f0)",
                      borderRadius: 8,
                      background: "var(--fm-surface, #fff)",
                      cursor: "pointer",
                      textAlign: "left",
                      fontFamily: "inherit",
                    }}
                  >
                    <span
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 8,
                        flexShrink: 0,
                        background: r.imageUrl
                          ? `center / cover no-repeat url(${r.imageUrl})`
                          : "linear-gradient(140deg,#e3cf9a,#9a8a4f)",
                      }}
                    />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, display: "block" }}>{r.title}</span>
                      <span style={{ fontSize: 11, color: "var(--fm-text-tertiary)" }}>
                        {[r.kcalPerServing ? `${r.kcalPerServing} kcal` : null, r.time].filter(Boolean).join(" · ") || "no nutrition yet"}
                      </span>
                    </span>
                    {r.imageUrl && <span style={{ fontSize: 14 }}>📷</span>}
                  </button>
                ))}
              </div>
              {/* AI generate — for a dish the library doesn't have yet.
                  Optional cuisine + note steer it; foods-to-avoid + diet are
                  honoured automatically server-side. */}
              {query.trim() && (
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input
                      value={cuisine}
                      onChange={(e) => setCuisine(e.target.value)}
                      placeholder="Cuisine / style (optional — default Indian)"
                      style={genField}
                    />
                  </div>
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Note (optional — e.g. high-protein, one-pot, with moong dal)"
                    style={genField}
                  />
                </div>
              )}
              {query.trim() && (
                <button
                  onClick={generate}
                  disabled={generating}
                  style={{
                    fontSize: 12.5,
                    fontWeight: 700,
                    padding: "8px 12px",
                    borderRadius: 8,
                    border: "1px solid var(--fm-primary, #FF6B35)",
                    background: "var(--fm-surface, #fff)",
                    color: "var(--fm-primary, #FF6B35)",
                    cursor: generating ? "wait" : "pointer",
                    fontFamily: "inherit",
                  }}
                  title="Have AI write a diet-safe recipe and add it to the library"
                >
                  {generating
                    ? "✨ Creating recipe…"
                    : `✨ Create “${query.trim()}” with AI`}
                </button>
              )}
            </div>
          )}

          {/* preview + actions */}
          <div style={{ fontSize: 12, color: "var(--fm-text-secondary)", marginTop: 4 }}>
            <b>New dish:</b> {composeDish(comps) || <i>empty</i>}
          </div>
          {error && <div style={{ fontSize: 12, color: "#c0392b" }}>{error}</div>}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button onClick={save} disabled={busy !== ""} style={primaryBtn}>
              {busy === "save" ? "Saving…" : "Save dish"}
            </button>
            {overridden && (
              <button onClick={reset} disabled={busy !== ""} style={pillBtn} title="Restore the plan's original dish">
                {busy === "reset" ? "…" : "Reset to plan default"}
              </button>
            )}
            <button onClick={onClose} disabled={busy !== ""} style={pillBtn}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const pillBtn: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  padding: "5px 11px",
  borderRadius: 999,
  border: "1px solid var(--fm-border, #e0e0e0)",
  background: "var(--fm-surface, #fff)",
  cursor: "pointer",
  fontFamily: "inherit",
  whiteSpace: "nowrap",
};

const dashedBtn: React.CSSProperties = {
  alignSelf: "start",
  fontSize: 12.5,
  fontWeight: 600,
  padding: "7px 12px",
  borderRadius: 8,
  border: "1px dashed var(--fm-border-strong, #D8C8BA)",
  background: "var(--fm-surface, #fff)",
  color: "var(--fm-primary, #9A7B5E)",
  cursor: "pointer",
  fontFamily: "inherit",
};

const genField: React.CSSProperties = {
  flex: 1,
  width: "100%",
  fontSize: 12,
  padding: "6px 9px",
  borderRadius: 7,
  border: "1px solid var(--fm-border, #e0e0e0)",
  background: "var(--fm-surface, #fff)",
  fontFamily: "inherit",
};

const primaryBtn: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  padding: "8px 16px",
  borderRadius: 8,
  border: "none",
  background: "var(--fm-primary, #FF6B35)",
  color: "#fff",
  cursor: "pointer",
  fontFamily: "inherit",
};
