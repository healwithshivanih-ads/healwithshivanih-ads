"use client";

/**
 * GroceryPanel — coach-side generate/refresh for the client app's
 * 🛒 weekly grocery list.
 *
 * One Haiku call (~₹2) builds a structured, categorised shopping list from
 * the client's CURRENT fortnight menu (same letter-parity loader the app
 * uses) + the recipe pack's ingredient lists. The result is written to
 * meal-plans/<planSlug>-grocery.yaml; the app reads it on next open and the
 * staging cron mirrors it to Fly. Send-state persists on disk per the
 * send-buttons-persist-state rule — status is read from the file itself.
 */

import { useEffect, useState } from "react";
import { FmPanel } from "@/components/fm";
import {
  generateGroceryListAction,
  groceryStatusAction,
} from "@/lib/server-actions/grocery";

export function GroceryPanel({ clientId, planSlug }: { clientId: string; planSlug: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [weekCount, setWeekCount] = useState(0);

  useEffect(() => {
    let ignore = false;
    groceryStatusAction(clientId, planSlug)
      .then((s) => {
        if (ignore) return;
        if (s.exists) {
          setGeneratedAt(s.generatedAt ?? "");
          setWeekCount(s.weeks ?? 0);
        }
      })
      .catch(() => {
        /* status is cosmetic; generate still works */
      });
    return () => {
      ignore = true;
    };
  }, [clientId, planSlug]);

  const generate = async () => {
    setBusy(true);
    setError("");
    try {
      const out = await generateGroceryListAction(clientId, planSlug);
      if (!out.ok) {
        setError(out.error ?? "Generation failed");
      } else {
        setGeneratedAt(out.generatedAt ?? new Date().toISOString());
        setWeekCount(out.weeks?.length ?? 0);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
    }
    setBusy(false);
  };

  const dateLabel = generatedAt
    ? new Date(generatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
    : null;

  return (
    <FmPanel title="🛒 App grocery list">
      <div style={{ display: "grid", gap: 10, fontSize: 13 }}>
        <div style={{ color: "var(--fm-text-secondary)", lineHeight: 1.5 }}>
          Builds the weekly shopping list the client sees on their app&apos;s menu view —
          categorised, with quantities, from this fortnight&apos;s meals. Regenerate after
          each new fortnight&apos;s menu.
        </div>
        {error && (
          <div style={{ color: "#c0392b", fontSize: 12.5 }}>{error}</div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button
            onClick={generate}
            disabled={busy}
            style={{
              padding: "8px 14px",
              borderRadius: "var(--fm-radius-md, 10px)",
              border: "1px solid var(--fm-border, rgba(120,113,108,0.3))",
              background: generatedAt ? "var(--fm-surface, #fff)" : "var(--fm-primary, #4a6152)",
              color: generatedAt ? "var(--fm-text-primary)" : "#fff",
              fontSize: 12.5,
              fontWeight: 600,
              cursor: busy ? "wait" : "pointer",
            }}
          >
            {busy ? "Generating… (~30s)" : generatedAt ? "🔄 Regenerate" : "🛒 Generate grocery list"}
          </button>
          {generatedAt && !busy && (
            <span style={{ fontSize: 12, color: "var(--fm-text-secondary)" }}>
              ✓ Generated {dateLabel}
              {weekCount ? ` · ${weekCount} week${weekCount > 1 ? "s" : ""}` : ""} — live on the app
            </span>
          )}
        </div>
      </div>
    </FmPanel>
  );
}
