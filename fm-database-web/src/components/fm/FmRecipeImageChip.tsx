"use client";

/**
 * FmRecipeImageChip — standing guardrail for recipe-image coverage.
 *
 * The client app shows a dish's photo by resolving it to its catalogue recipe.
 * A recipe with no suitable image falls back to a plain gradient tile — which
 * the coach doesn't want clients to see. This chip flags every catalogue
 * recipe missing a real, on-disk photo so new images get generated
 * periodically. Per coach decision it's a FLAG, not a block: the recipes still
 * work, they just need a picture.
 *
 * Self-loading (like FmCatalogueOrphanChip): fetches its own status on mount,
 * renders nothing until it has data, and hides entirely when coverage is 100%.
 */
import { useEffect, useState, useTransition } from "react";
import {
  getRecipeImageCoverage,
  type RecipeImageCoverage,
  type RecipeImageGap,
} from "@/app/recipe-image-coverage-action";

const REASON_LABEL: Record<RecipeImageGap["reason"], string> = {
  file_missing: "image file missing on disk",
  no_image_block: "no image set",
  rights_none: "image hidden (rights: none)",
};

export function FmRecipeImageChip() {
  const [status, setStatus] = useState<RecipeImageCoverage | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  const load = () =>
    start(async () => {
      setStatus(await getRecipeImageCoverage());
    });

  useEffect(() => {
    void (async () => setStatus(await getRecipeImageCoverage()))();
  }, []);

  // Render nothing until loaded, and hide when every recipe has a photo.
  if (!status || status.gaps.length === 0) return null;

  const n = status.gaps.length;
  // Group the actionable list by reason for the disclosure.
  const byReason = new Map<RecipeImageGap["reason"], RecipeImageGap[]>();
  for (const g of status.gaps) {
    const arr = byReason.get(g.reason) ?? [];
    arr.push(g);
    byReason.set(g.reason, arr);
  }

  return (
    <section
      style={{
        padding: "14px 16px",
        borderRadius: "var(--fm-radius-lg)",
        background:
          "linear-gradient(135deg, rgba(217,119,6,0.08), rgba(180,83,9,0.13))",
        border: "1.5px solid rgba(217,119,6,0.35)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 22 }}>🖼️</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#92400e" }}>
            {n} recipe{n === 1 ? "" : "s"} need{n === 1 ? "s" : ""} a photo
          </div>
          <div style={{ fontSize: 12, color: "var(--fm-text-secondary)" }}>
            {status.imaged}/{status.total} recipes have an image — these would show a
            plain tile in the client app until one is added
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          style={{
            background: "transparent",
            border: "1px solid rgba(0,0,0,0.10)",
            padding: "6px 12px",
            fontSize: 12,
            fontWeight: 600,
            color: "#92400e",
            borderRadius: "var(--fm-radius-sm)",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          {open ? "Hide list" : "Review"}
        </button>
        <button
          type="button"
          onClick={load}
          disabled={pending}
          title="Re-scan"
          style={{
            background: "transparent",
            border: "1px solid rgba(0,0,0,0.10)",
            padding: "6px 10px",
            fontSize: 12,
            color: "#b45309",
            borderRadius: "var(--fm-radius-sm)",
            cursor: pending ? "wait" : "pointer",
            fontFamily: "inherit",
            opacity: pending ? 0.6 : 1,
          }}
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
          {[...byReason.entries()].map(([reason, items]) => (
            <div key={reason} style={{ marginBottom: 12 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--fm-text-secondary)",
                  marginBottom: 6,
                }}
              >
                {REASON_LABEL[reason]} ({items.length})
              </div>
              <div style={{ display: "grid", gap: 4, maxHeight: 260, overflowY: "auto" }}>
                {items.map((g) => (
                  <div
                    key={g.slug}
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: 8,
                      padding: "5px 8px",
                      background: "var(--fm-bg-cool)",
                      border: "1px solid var(--fm-border-light)",
                      borderRadius: "var(--fm-radius-sm)",
                      fontSize: 12,
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "var(--fm-font-mono, ui-monospace, Menlo, monospace)",
                        fontWeight: 600,
                        color: "#b45309",
                      }}
                    >
                      {g.slug}
                    </span>
                    <span style={{ color: "var(--fm-text-tertiary)", minWidth: 0 }}>
                      {g.name}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
