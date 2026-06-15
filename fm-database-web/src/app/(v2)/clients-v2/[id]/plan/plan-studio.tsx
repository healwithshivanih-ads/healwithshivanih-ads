"use client";

/**
 * PlanStudio — the 2-pane Plan-tab studio (2026-06-15 redesign).
 *
 *   LEFT  — sticky section-nav pills + a one-open-at-a-time accordion of
 *           the editable plan sections. The coach jumps via the pills
 *           instead of scrolling an 11-panel wall.
 *   RIGHT — the LIVE phone preview (the real /app iframe), sticky and
 *           collapsible. It remounts on every edit so what the coach
 *           sees is exactly what the client sees.
 *
 * The first section is the app-suggestion / weekly-menu studio
 * (AppPreviewPanel). Its internal phone is lifted out to the right rail
 * (`phone="none"`); its edit handlers call `onEdited`, which bumps the
 * shared `previewVersion` so the lifted phone re-renders the change —
 * the "edits appear instantly" guarantee is preserved across the split.
 *
 * Every other section is a server-rendered panel passed in via `sections`
 * — no data flow changes, the existing server actions still own all
 * mutations.
 */

import { useCallback, useRef, useState } from "react";
import { AppPreviewPanel } from "../app-preview-panel";
import { StudioPhoneRail } from "./studio-phone-rail";

export interface StudioSection {
  id: string;
  /** Pill + header label, e.g. "🍽 Menu & Nutrition". */
  label: string;
  /** Small count/status chip shown in the header (optional). */
  badge?: React.ReactNode;
  /** Server-rendered panel for this section's body. */
  node: React.ReactNode;
  /** DOM id to set on the section (e.g. preserve "follow-up-panel" anchor). */
  anchorId?: string;
}

const APP_SECTION_ID = "app-studio";

export function PlanStudio({
  clientId,
  sections,
  defaultOpenId = APP_SECTION_ID,
}: {
  clientId: string;
  sections: StudioSection[];
  defaultOpenId?: string;
}) {
  const [openId, setOpenId] = useState<string>(defaultOpenId);
  const [phoneOpen, setPhoneOpen] = useState(false);
  // Bumps on every successful app-preview edit so the lifted phone iframe
  // re-renders the real app with the change applied.
  const [previewVersion, setPreviewVersion] = useState(0);
  const bumpPreview = useCallback(() => setPreviewVersion((v) => v + 1), []);

  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // The app-studio section is rendered by PlanStudio itself (it owns the
  // phone-remount wiring); it always leads the accordion + nav. It shows
  // ONLY the remedy/supplement-suggestion zones — the weekly-menu approval
  // and dish-by-dish editor moved into the "Menu" section (below) so meals
  // are edited where the coach expects them.
  const appSection: StudioSection = {
    id: APP_SECTION_ID,
    label: "🌿 App suggestions & remedies",
    badge: undefined,
    node: (
      <AppPreviewPanel
        clientId={clientId}
        phone="none"
        onEdited={bumpPreview}
        show="remedies"
      />
    ),
  };
  const allSections = [appSection, ...sections];

  const jump = (id: string) => {
    setOpenId(id);
    // After the section expands, scroll its header into view.
    requestAnimationFrame(() => {
      const el = sectionRefs.current[id];
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  return (
    <div className={`fm-plan-studio${phoneOpen ? "" : " phone-collapsed"}`}>
      {/* LEFT — section nav + accordion */}
      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="fm-studio-nav">
          {allSections.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`fm-studio-pill${openId === s.id ? " active" : ""}`}
              onClick={() => jump(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>

        {allSections.map((s) => {
          const open = openId === s.id;
          return (
            <div
              key={s.id}
              id={s.anchorId}
              ref={(el) => {
                sectionRefs.current[s.id] = el;
              }}
              className={`fm-studio-section${open ? " open" : ""}`}
              style={{ scrollMarginTop: 60 }}
            >
              <button
                type="button"
                className="fm-studio-section-head"
                onClick={() => setOpenId(open ? "" : s.id)}
                aria-expanded={open}
              >
                <span className="fm-studio-section-caret">▸</span>
                <span className="fm-studio-section-title">{s.label}</span>
                {s.badge}
                <span className="fm-studio-section-hint">
                  {open ? "" : "✎ edit"}
                </span>
              </button>
              {open && (
                <div className="fm-studio-section-body">
                  {/* Menu section leads with the live weekly-menu approval +
                      click-to-edit dish grid (the AppPreviewPanel "menu"
                      zone), then the nutrition-guidance panel. So the coach
                      edits individual meals right here. */}
                  {s.id === "menu" && (
                    <div style={{ marginBottom: 14 }}>
                      <AppPreviewPanel
                        clientId={clientId}
                        phone="none"
                        onEdited={bumpPreview}
                        show="menu"
                      />
                    </div>
                  )}
                  {s.node}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* RIGHT — live phone preview, sticky + collapsible */}
      <div className="fm-plan-studio-rail">
        <StudioPhoneRail
          clientId={clientId}
          open={phoneOpen}
          onToggle={() => setPhoneOpen((o) => !o)}
          version={previewVersion}
          onRefresh={bumpPreview}
        />
      </div>
    </div>
  );
}
