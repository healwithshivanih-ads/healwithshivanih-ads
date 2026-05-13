"use client";

/**
 * useFormDraft — auto-persist any client-side form to localStorage so
 * the coach's typing is recoverable across 404s, timeouts, tab closes,
 * browser crashes, and accidental refreshes.
 *
 * Usage:
 *
 *   const { hydrated, clearDraft, hasSavedDraft } = useFormDraft(
 *     "fm-intake-draft-cl-001",
 *     { displayName, intakeDate, ... },
 *     {
 *       displayName: setDisplayName,
 *       intakeDate: setIntakeDate,
 *       ...
 *     },
 *   );
 *
 *   // Render a clear button anywhere:
 *   <FormDraftClearButton onClear={clearDraft} hasDraft={hasSavedDraft} />
 *
 * Behaviour:
 * - On mount: reads localStorage[key], runs each setter with the saved
 *   value if the field exists + type matches. Fires a toast ("Restored
 *   your in-progress draft") so the coach knows.
 * - On every state change: snapshots the full `fields` object back
 *   to localStorage. No debouncing — the cost is one tiny JSON.stringify
 *   per change.
 * - `clearDraft()` removes the localStorage entry. Callers typically
 *   wire this to a "✕ Clear all" button + to their submit-success path.
 *
 * Type discipline:
 * - The hook is generic so any field shape compiles. We don't enforce
 *   schema validation on the saved blob — instead the loader uses
 *   `typeof` / Array.isArray checks per-field so missing or corrupt
 *   keys are silently ignored.
 * - DraftValue is `unknown`-shaped on disk, but the React state types
 *   stay precise via the setter map.
 */
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export type DraftSetters<F> = {
  [K in keyof F]?: (v: F[K]) => void;
};

export interface UseFormDraftOptions {
  /** Custom toast message when a draft is restored. */
  restoreMessage?: string;
  /** Suppress the toast (useful for forms inside modals where it's noisy). */
  silent?: boolean;
}

export function useFormDraft<F extends Record<string, unknown>>(
  key: string,
  fields: F,
  setters: DraftSetters<F>,
  options: UseFormDraftOptions = {},
): {
  hydrated: boolean;
  clearDraft: () => void;
  hasSavedDraft: boolean;
} {
  const [hydrated, setHydrated] = useState(false);
  const [hasSavedDraft, setHasSavedDraft] = useState(false);
  const hydratedRef = useRef(false);

  // ── Hydrate ────────────────────────────────────────────────────────
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    setHydrated(true);
    let restored = 0;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const saved = JSON.parse(raw) as Record<string, unknown>;
      for (const k of Object.keys(saved) as (keyof F)[]) {
        const setter = setters[k];
        const value = saved[k as string];
        if (!setter || value === undefined || value === null) continue;
        const orig = fields[k];
        // Loose type-match: same JS typeof, OR both arrays. This catches the
        // common cases (string ↔ string, number ↔ number, array ↔ array).
        // Mismatched primitives are dropped silently so a stale schema
        // doesn't crash the form.
        const sameType =
          typeof orig === typeof value ||
          (Array.isArray(orig) && Array.isArray(value));
        if (sameType) {
          try {
            (setter as (v: unknown) => void)(value);
            restored += 1;
          } catch {
            /* setter rejected — skip */
          }
        }
      }
      if (restored > 0) {
        setHasSavedDraft(true);
        if (!options.silent) {
          toast.message(
            options.restoreMessage ?? "📋 Restored your in-progress draft",
            {
              description:
                "Last unsaved entries were recovered. Submit when ready, or click ✕ Clear all to start fresh.",
              duration: 6000,
            },
          );
        }
      }
    } catch {
      // Corrupt blob — drop it.
      try { localStorage.removeItem(key); } catch { /* noop */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Persist ────────────────────────────────────────────────────────
  // Re-runs on every render after hydration so any field change writes
  // through. Cheap — one stringify + setItem.
  useEffect(() => {
    if (!hydratedRef.current) return;
    try {
      localStorage.setItem(key, JSON.stringify(fields));
      // Keep the "has draft" indicator current so the UI can render the
      // dot / badge on the Clear button.
      const exists = !!localStorage.getItem(key);
      if (exists !== hasSavedDraft) setHasSavedDraft(exists);
    } catch {
      /* quota / privacy mode — silent */
    }
  });

  // ── Clear ──────────────────────────────────────────────────────────
  const clearDraft = () => {
    try { localStorage.removeItem(key); } catch { /* noop */ }
    setHasSavedDraft(false);
  };

  return { hydrated, clearDraft, hasSavedDraft };
}
