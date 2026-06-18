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
  type RecipeImageCoverage,
  type RecipeImageGap,
  type MenuImageCoverage,
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
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  const load = () =>
    start(async () => {
      const [r, m] = await Promise.all([getRecipeImageCoverage(), getMenuImageCoverage()]);
      setRecipes(r);
      setMenus(m);
    });

  useEffect(() => {
    void (async () => {
      const [r, m] = await Promise.all([getRecipeImageCoverage(), getMenuImageCoverage()]);
      setRecipes(r);
      setMenus(m);
    })();
  }, []);

  // Render nothing until loaded; hide when both views are clean.
  if (!recipes || !menus) return null;
  const menuGaps = menus.dishGaps;
  const recipeGaps = recipes.gaps.length;
  if (menuGaps === 0 && recipeGaps === 0) return null;

  // Group catalogue gaps by reason for the disclosure.
  const byReason = new Map<RecipeImageGap["reason"], RecipeImageGap[]>();
  for (const g of recipes.gaps) {
    const arr = byReason.get(g.reason) ?? [];
    arr.push(g);
    byReason.set(g.reason, arr);
  }

  // Headline = the client-facing number when there is one, else catalogue.
  const headline =
    menuGaps > 0
      ? `${menuGaps} live menu dish${menuGaps === 1 ? "" : "es"} would show no photo`
      : `${recipeGaps} recipe${recipeGaps === 1 ? "" : "s"} need${recipeGaps === 1 ? "s" : ""} a photo`;
  const subline =
    menuGaps > 0
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
