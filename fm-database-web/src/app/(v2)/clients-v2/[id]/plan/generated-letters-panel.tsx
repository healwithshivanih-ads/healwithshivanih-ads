"use client";

/**
 * GeneratedLettersPanel — shows the actual meal plan the client received
 * (week-by-week menus + supplement schedule), inline on the coach plan
 * tab. No letter chooser, no consolidated/lifestyle/exercise variants —
 * just the meal plan content.
 *
 * Coach feedback 2026-05-14:
 *   "I want only the meal plan visible not the whole letter"
 *
 * So this panel renders just the meal plan source: prefer the dedicated
 * `meal_plan` letter type if a saved copy exists, otherwise fall back to
 * the `consolidated` letter (which contains the same week sections + the
 * supplement schedule). Either way, the inline viewer slices out only
 * the per-week menus + the supplement schedule via the existing
 * `body[data-print-week]` / `body[data-print-supplement]` brand CSS
 * isolation rules — never shows education / lifestyle narrative / etc.
 *
 * Each week + supplements is its own collapsible iframe. First week opens
 * by default; the rest are click-to-expand.
 */

import { useEffect, useState } from "react";
import { FmPanel, FmChip } from "@/components/fm";
import {
  getLetterStalenessAction,
  type LetterStalenessEntry,
  type LetterType,
} from "@/lib/server-actions/plan-lifecycle";
import { LetterInlineViewer } from "./letter-inline-viewer";
import { LetterRefinementChat } from "@/components/client-widgets/letter-refinement-chat";

/** Letter types that contain a 7-day meal plan. Ordered by preference —
 * the panel uses the first match that has a saved file.
 *
 * `consolidated` is FIRST on purpose. It's the canonical letter the coach
 * actually generates — it carries both the markdown and the branded HTML,
 * with weeks 1+2 + supplement schedule + everything else inside. The
 * `meal_plan` letter is a sidecar that gets auto-extracted from the
 * consolidated source, BUT only as markdown (no HTML wrapper). Since the
 * inline viewer relies on the HTML's `body[data-print-week]` CSS rules
 * to slice out sections, we always want consolidated when available.
 */
const MEAL_PLAN_SOURCES: LetterType[] = ["consolidated", "meal_plan"];

interface Props {
  clientId: string;
  planSlug: string;
  /** Used by the "Regenerate" link to deep-link into the active client's communicate tab. */
  communicateHref: string;
}

function relativeDate(iso: string): string {
  try {
    const d = new Date(iso);
    const days = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
    if (days === 0) return "today";
    if (days === 1) return "yesterday";
    if (days < 7) return `${days} days ago`;
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  } catch {
    return iso.slice(0, 10);
  }
}

export function GeneratedLettersPanel({ clientId, planSlug, communicateHref }: Props) {
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<LetterStalenessEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped after every MealPlanChat refine; key on the inline viewer
  // forces it to re-mount + re-fetch the freshly-saved markdown/HTML.
  const [viewerVersion, setViewerVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getLetterStalenessAction(planSlug, clientId)
      .then((r) => {
        if (cancelled) return;
        if (!r.ok) {
          setError("Failed to load letters");
          return;
        }
        // Pick the highest-preference letter type that's actually been saved.
        const byType = new Map(r.entries.map((e) => [e.type, e]));
        let chosen: LetterStalenessEntry | null = null;
        for (const t of MEAL_PLAN_SOURCES) {
          const e = byType.get(t);
          if (e) {
            chosen = e;
            break;
          }
        }
        setPicked(chosen);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load letters");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, planSlug]);

  return (
    <FmPanel
      title="🍽 Meal plan the client received"
      subtitle="Week-by-week menus + supplement schedule, inline. Click any week to expand."
    >
      {loading && (
        <div style={{ fontSize: 13, color: "var(--fm-text-secondary)" }}>Loading…</div>
      )}

      {error && (
        <div style={{ fontSize: 13, color: "var(--fm-danger, #dc2626)" }}>{error}</div>
      )}

      {!loading && !error && !picked && (
        <div
          style={{
            padding: "12px 14px",
            background: "var(--fm-bg-subtle, rgba(0,0,0,0.03))",
            borderRadius: 6,
            fontSize: 13,
            color: "var(--fm-text-secondary)",
            lineHeight: 1.5,
          }}
        >
          No meal plan generated yet for this plan.{" "}
          <a href={communicateHref} style={{ color: "var(--fm-primary)", fontWeight: 500 }}>
            Generate from Communicate →
          </a>
        </div>
      )}

      {picked && (
        <div style={{ display: "grid", gap: 10 }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 8,
              fontSize: 12,
              color: "var(--fm-text-tertiary, #9ca3af)",
              flexWrap: "wrap",
            }}
          >
            <span>extracted from the full client letter</span>
            <span aria-hidden style={{ opacity: 0.5 }}>·</span>
            <span>generated {relativeDate(picked.savedAt)}</span>
            {picked.stale && (
              <FmChip tone="warning">⚠ Stale — plan edited after this</FmChip>
            )}
            <a
              href={communicateHref}
              style={{
                marginLeft: "auto",
                fontSize: 12,
                color: "var(--fm-text-secondary)",
                textDecoration: "none",
                border: "1px dashed var(--fm-border)",
                borderRadius: 4,
                padding: "3px 8px",
              }}
            >
              ✏️ Regenerate ↗
            </a>
          </div>

          {/* Inline viewer — renders only week sections + supplement schedule
              from the chosen letter, never the welcome / education / lifestyle
              narrative. Each section is its own collapsible iframe.
              `key` bumps after a refine so the iframes re-fetch the new HTML. */}
          <LetterInlineViewer
            key={`viewer-${viewerVersion}`}
            clientId={clientId}
            planSlug={planSlug}
            letterType={picked.type}
          />

          {/* 💬 Discuss → finalise edit chat. Coach proposes edits in
              chat (Haiku, conversational, no save); a running pending-
              changes list appears; clicking "Finalise & apply" runs
              Sonnet once to commit every queued change to disk. */}
          <LetterRefinementChat
            clientId={clientId}
            planSlug={planSlug}
            letterType={picked.type}
            onSaved={() => setViewerVersion((v) => v + 1)}
          />
        </div>
      )}
    </FmPanel>
  );
}
