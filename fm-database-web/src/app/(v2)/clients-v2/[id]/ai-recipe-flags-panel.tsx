"use client";

import { useEffect, useState } from "react";
import {
  getMenuAiRecipesAction,
  promoteGeneratedRecipeAction,
} from "@/lib/server-actions/ai-recipes";
import type { AiRecipeFlag } from "@/lib/fmdb/ai-recipes-types";

type RowState = "idle" | "busy" | "added" | "dup" | "error";

/**
 * Coach Plan-tab flag: lists every menu dish whose recipe the client app serves
 * from the AI-generated pack (not the catalogue), with one-click "Add to
 * catalogue". Self-hides when the menu has no AI recipes. The AI writer keeps
 * running — this just lets the coach promote the good ones into the library.
 */
export function AiRecipeFlagsPanel({ clientId }: { clientId: string }) {
  const [recipes, setRecipes] = useState<AiRecipeFlag[] | null>(null);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<Record<string, RowState>>({});
  const [msg, setMsg] = useState<Record<string, string>>({});

  useEffect(() => {
    let ignore = false;
    getMenuAiRecipesAction(clientId)
      .then((r) => {
        if (!ignore) setRecipes(r.recipes);
      })
      .catch(() => {
        if (!ignore) setRecipes([]);
      });
    return () => {
      ignore = true;
    };
  }, [clientId]);

  if (!recipes || recipes.length === 0) return null;

  const notInCat = recipes.filter((r) => !r.alreadyInCatalogue && state[r.dish] !== "added");

  async function add(r: AiRecipeFlag, force = false) {
    setState((s) => ({ ...s, [r.dish]: "busy" }));
    const res = await promoteGeneratedRecipeAction({
      name: r.title,
      ingredients: r.ingredients,
      steps: r.method,
      force,
    }).catch((e) => ({ ok: false, error: String(e) }) as Awaited<ReturnType<typeof promoteGeneratedRecipeAction>>);
    if (res.ok) {
      setState((s) => ({ ...s, [r.dish]: "added" }));
      setMsg((m) => ({ ...m, [r.dish]: res.slug ? `✓ added as ${res.slug}` : "✓ added" }));
    } else if (res.needsConfirm) {
      setState((s) => ({ ...s, [r.dish]: "dup" }));
      setMsg((m) => ({ ...m, [r.dish]: res.warnings?.[0] ?? "A similar recipe exists." }));
    } else {
      setState((s) => ({ ...s, [r.dish]: "error" }));
      setMsg((m) => ({ ...m, [r.dish]: res.error ?? "failed" }));
    }
  }

  return (
    <div
      style={{
        background: "rgba(99, 102, 241, 0.06)",
        border: "1px solid rgba(99, 102, 241, 0.35)",
        borderRadius: "var(--fm-radius-md, 10px)",
        padding: "8px 12px",
        fontSize: 12,
      }}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          all: "unset",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 6,
          width: "100%",
          color: "#4338ca",
          fontWeight: 600,
        }}
      >
        <span>{open ? "▾" : "▸"}</span>
        <span>
          🤖 {recipes.length} dish{recipes.length === 1 ? "" : "es"} use an AI-generated recipe
          {notInCat.length > 0 ? ` · ${notInCat.length} not in the catalogue yet` : " · all in catalogue"}
        </span>
      </button>

      {open && (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ color: "var(--fm-text-secondary)", fontSize: 11, marginBottom: 2 }}>
            The AI writes a recipe for these menu dishes on the fly. Add the good ones to the
            catalogue so they become curated + reusable (a photo can be added later).
          </div>
          {recipes.map((r) => {
            const st = state[r.dish] ?? "idle";
            const inCat = r.alreadyInCatalogue || st === "added";
            return (
              <div
                key={r.dish}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  padding: "5px 8px",
                  background: "var(--fm-surface, #fff)",
                  border: "1px solid var(--fm-border, rgba(0,0,0,0.08))",
                  borderRadius: 8,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: "var(--fm-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.title}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--fm-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.ingredients.length} ingredients · {r.method.length} steps
                    {msg[r.dish] ? ` · ${msg[r.dish]}` : ""}
                  </div>
                </div>
                {inCat ? (
                  <span style={{ flexShrink: 0, color: "#15803d", fontWeight: 600, whiteSpace: "nowrap" }}>
                    ✓ in catalogue
                  </span>
                ) : st === "busy" ? (
                  <span style={{ flexShrink: 0, color: "var(--fm-text-secondary)" }}>adding…</span>
                ) : st === "dup" ? (
                  <button
                    onClick={() => add(r, true)}
                    style={{ all: "unset", cursor: "pointer", flexShrink: 0, color: "#b45309", fontWeight: 600, whiteSpace: "nowrap" }}
                  >
                    Add anyway →
                  </button>
                ) : (
                  <button
                    onClick={() => add(r)}
                    style={{
                      all: "unset",
                      cursor: "pointer",
                      flexShrink: 0,
                      color: "#4338ca",
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {st === "error" ? "Retry" : "➕ Add to catalogue"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
