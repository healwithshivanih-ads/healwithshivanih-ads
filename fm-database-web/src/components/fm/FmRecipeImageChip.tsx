"use client";

/**
 * FmRecipeImageChip — standing guardrail for recipe-image coverage.
 *
 * Two views, one chip:
 *  • Live menus — dishes on PUBLISHED plans that won't resolve to a recipe with
 *    a photo, so a client would see a plain gradient tile. The direct
 *    "what clients see" check (per client → dish).
 *  • Recipe catalogue — recipes in _recipes/ missing a real image. The upstream
 *    preventive view (newly generated recipes land here until a photo is added).
 *
 * Per coach decision it's a FLAG, not a block: everything still works, it just
 * needs a picture. Self-loading like FmCatalogueOrphanChip; renders nothing
 * until loaded and hides entirely when both views are clean.
 */
import { useEffect, useState, useTransition } from "react";
import {
  getRecipeImageCoverage,
  getMenuImageCoverage,
  getMenuRecipeCoverage,
  type RecipeImageCoverage,
  type RecipeImageGap,
  type MenuImageCoverage,
  type MenuRecipeCoverage,
} from "@/app/recipe-image-coverage-action";

const REASON_LABEL: Record<RecipeImageGap["reason"], string> = {
  file_missing: "image file missing on disk",
  no_image_block: "no image set",
  rights_none: "image hidden (rights: none)",
};

const btn: React.CSSProperties = {
  background: "transparent",
  border: "1px solid rgba(0,0,0,0.10)",
  padding: "6px 12px",
  fontSize: 12,
  fontWeight: 600,
  color: "#92400e",
  borderRadius: "var(--fm-radius-sm)",
  cursor: "pointer",
  fontFamily: "inherit",
};

const slugChip: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: 8,
  padding: "5px 8px",
  background: "var(--fm-bg-cool)",
  border: "1px solid var(--fm-border-light)",
  borderRadius: "var(--fm-radius-sm)",
  fontSize: 12,
};

const sectionLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: "var(--fm-text-secondary)",
  marginBottom: 6,
};

export function FmRecipeImageChip() {
  const [recipes, setRecipes] = useState<RecipeImageCoverage | null>(null);
  const [menus, setMenus] = useState<MenuImageCoverage | null>(null);
  const [badRecipes, setBadRecipes] = useState<MenuRecipeCoverage | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  const fetchAll = async () => {
    const [r, m, b] = await Promise.all([
      getRecipeImageCoverage(),
      getMenuImageCoverage(),
      getMenuRecipeCoverage(),
    ]);
    setRecipes(r);
    setMenus(m);
    setBadRecipes(b);
  };
  const load = () => start(() => fetchAll());

  useEffect(() => {
    void fetchAll();
  }, []);

  // Render nothing until loaded; hide when all views are clean.
  if (!recipes || !menus || !badRecipes) return null;
  const menuGaps = menus.dishGaps;
  const recipeGaps = recipes.gaps.length;
  const wrongGaps = badRecipes.dishGaps;
  if (menuGaps === 0 && recipeGaps === 0 && wrongGaps === 0) return null;

  // Group catalogue gaps by reason for the disclosure.
  const byReason = new Map<RecipeImageGap["reason"], RecipeImageGap[]>();
  for (const g of recipes.gaps) {
    const arr = byReason.get(g.reason) ?? [];
    arr.push(g);
    byReason.set(g.reason, arr);
  }

  // Headline prioritises the TRUST-critical signal — a wrong/garbled recipe was
  // caught — over the gentler photo gaps.
  const headline =
    wrongGaps > 0
      ? `${wrongGaps} live menu dish${wrongGaps === 1 ? "" : "es"} would show a wrong recipe`
      : menuGaps > 0
        ? `${menuGaps} live menu dish${menuGaps === 1 ? "" : "es"} would show no photo`
        : `${recipeGaps} recipe${recipeGaps === 1 ? "" : "s"} need${recipeGaps === 1 ? "s" : ""} a photo`;
  const subline =
    wrongGaps > 0
      ? `across ${badRecipes.menus.length} client${badRecipes.menus.length === 1 ? "" : "s"} — the app now hides these; fix the menu wording or add a matching recipe` +
        (menuGaps > 0 ? ` · ${menuGaps} also missing a photo` : "")
      : menuGaps > 0
        ? `across ${menus.menus.length} client${menus.menus.length === 1 ? "" : "s"}` +
          (recipeGaps > 0 ? ` · ${recipeGaps} catalogue recipe${recipeGaps === 1 ? "" : "s"} also missing an image` : "")
        : `${recipes.imaged}/${recipes.total} catalogue recipes have an image — these would show a plain tile`;

  return (
    <section
      style={{
        padding: "14px 16px",
        borderRadius: "var(--fm-radius-lg)",
        background: "linear-gradient(135deg, rgba(217,119,6,0.08), rgba(180,83,9,0.13))",
        border: "1.5px solid rgba(217,119,6,0.35)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 22 }}>🖼️</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#92400e" }}>{headline}</div>
          <div style={{ fontSize: 12, color: "var(--fm-text-secondary)" }}>{subline}</div>
        </div>
        <button type="button" onClick={() => setOpen((v) => !v)} style={btn}>
          {open ? "Hide list" : "Review"}
        </button>
        <button
          type="button"
          onClick={load}
          disabled={pending}
          title="Re-scan"
          style={{ ...btn, padding: "6px 10px", color: "#b45309", cursor: pending ? "wait" : "pointer", opacity: pending ? 0.6 : 1 }}
        >
          ↻
        </button>
      </div>

      {open && (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            background: "var(--fm-surface)",
            border: "1px solid var(--fm-border-light)",
            borderRadius: "var(--fm-radius-md)",
          }}
        >
          {/* Wrong/garbled recipe caught — the trust-critical view, first. */}
          {badRecipes.menus.length > 0 && (
            <div style={{ marginBottom: menuGaps > 0 || recipeGaps > 0 ? 16 : 0 }}>
              <div
                style={{
                  fontSize: 11,
                  color: "#b91c1c",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: 0.7,
                  marginBottom: 10,
                }}
              >
                Wrong recipe caught — the app hides these; fix the dish wording or add a recipe
              </div>
              {badRecipes.menus.map((m) => (
                <div key={m.planSlug} style={{ marginBottom: 12 }}>
                  <div style={sectionLabel}>
                    {m.clientName} ({m.dishes.length})
                  </div>
                  <div style={{ display: "grid", gap: 4, maxHeight: 220, overflowY: "auto" }}>
                    {m.dishes.map((dish) => (
                      <div
                        key={dish}
                        style={{ ...slugChip, background: "rgba(185,28,28,0.06)", border: "1px solid rgba(185,28,28,0.20)" }}
                      >
                        <span style={{ color: "var(--fm-text-secondary)", minWidth: 0 }}>{dish}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Live menus — the client-facing gaps, grouped by client. */}
          {menus.menus.length > 0 && (
            <div style={{ marginBottom: recipeGaps > 0 ? 16 : 0 }}>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--fm-text-tertiary)",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: 0.7,
                  marginBottom: 10,
                }}
              >
                Live menus — clients would see a plain tile for these dishes
              </div>
              {menus.menus.map((m) => (
                <div key={m.planSlug} style={{ marginBottom: 12 }}>
                  <div style={sectionLabel}>
                    {m.clientName} ({m.dishes.length})
                  </div>
                  <div style={{ display: "grid", gap: 4, maxHeight: 220, overflowY: "auto" }}>
                    {m.dishes.map((dish) => (
                      <div key={dish} style={slugChip}>
                        <span style={{ color: "var(--fm-text-secondary)", minWidth: 0 }}>{dish}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Recipe catalogue — upstream, grouped by reason. */}
          {recipeGaps > 0 && (
            <div>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--fm-text-tertiary)",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: 0.7,
                  marginBottom: 10,
                }}
              >
                Recipe catalogue — recipes missing an image
              </div>
              {[...byReason.entries()].map(([reason, items]) => (
                <div key={reason} style={{ marginBottom: 12 }}>
                  <div style={sectionLabel}>
                    {REASON_LABEL[reason]} ({items.length})
                  </div>
                  <div style={{ display: "grid", gap: 4, maxHeight: 220, overflowY: "auto" }}>
                    {items.map((g) => (
                      <div key={g.slug} style={slugChip}>
                        <span
                          style={{
                            fontFamily: "var(--fm-font-mono, ui-monospace, Menlo, monospace)",
                            fontWeight: 600,
                            color: "#b45309",
                          }}
                        >
                          {g.slug}
                        </span>
                        <span style={{ color: "var(--fm-text-tertiary)", minWidth: 0 }}>{g.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
