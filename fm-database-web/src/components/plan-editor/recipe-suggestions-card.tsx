"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  suggestRecipesAction,
  listRecipesAction,
  type RecipeCard,
} from "@/lib/server-actions/plans";

/**
 * Recipes for a client's plan — the coach PRUNES, never hand-picks.
 *
 * On first open: if the plan already has nutrition.recipes, those are hydrated
 * and shown; otherwise the matching engine auto-suggests a personalized,
 * meal-balanced set (dosha / season / diet / conditions) and adopts it so the
 * coach only has to click × on the few they don't want. "↻ Re-suggest" recomputes.
 *
 * The kept slugs are written back via onChange -> patchNutrition("recipes", …).
 * The meal-plan letter uses this set as the palette and the AI stays free to
 * compose other dishes (⚠-marked) — see recipe_select.py.
 */
export function RecipeSuggestionsCard({
  planSlug,
  value,
  onChange,
  locked,
}: {
  planSlug: string;
  value: string[];
  onChange: (slugs: string[]) => void;
  locked?: boolean;
}) {
  const [cards, setCards] = useState<RecipeCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const initialized = useRef(false);

  function orderBy(list: RecipeCard[], slugs: string[]): RecipeCard[] {
    const map = new Map(list.map((c) => [c.slug, c] as const));
    return slugs
      .map((s) => map.get(s))
      .filter((c): c is RecipeCard => Boolean(c));
  }

  // First mount: hydrate existing pins, or auto-suggest if none yet.
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    setLoading(true);
    void (async () => {
      try {
        if (value.length > 0) {
          const res = await listRecipesAction({ slugs: value });
          if (res.ok) setCards(orderBy(res.recipes, value));
          else setError(res.error ?? "Could not load recipes");
        } else {
          const res = await suggestRecipesAction(planSlug);
          if (res.ok) {
            setCards(res.recipes);
            if (res.recipes.length && !locked) {
              onChange(res.recipes.map((r) => r.slug)); // adopt suggestions
            }
          } else {
            setError(res.error ?? "Could not suggest recipes");
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
    // run once for this plan
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planSlug]);

  function remove(slug: string) {
    if (locked) return;
    onChange(value.filter((s) => s !== slug));
  }

  function reSuggest() {
    if (locked) return;
    setLoading(true);
    setError(null);
    startTransition(async () => {
      const res = await suggestRecipesAction(planSlug);
      if (res.ok) {
        setCards(res.recipes);
        onChange(res.recipes.map((r) => r.slug));
      } else {
        setError(res.error ?? "Could not suggest recipes");
      }
      setLoading(false);
    });
  }

  const shown = cards.filter((c) => value.includes(c.slug));

  return (
    <div className="rounded-md border border-border bg-muted/30 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <span className="text-sm font-medium">🍲 Recipes for this client</span>
          <span className="ml-2 text-xs text-muted-foreground">
            AI-suggested · remove any you don&apos;t want
          </span>
        </div>
        {!locked && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={reSuggest}
            disabled={loading}
          >
            ↻ Re-suggest
          </Button>
        )}
      </div>

      {loading && (
        <p className="text-xs text-muted-foreground">Loading suggestions…</p>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
      {!loading && !error && shown.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No recipes selected — the meal-plan letter will auto-suggest from the
          library.
        </p>
      )}

      <div className="flex flex-wrap gap-1.5">
        {shown.map((c) => (
          <span
            key={c.slug}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-xs"
            title={c.one_line}
          >
            <span>{c.name}</span>
            {c.meal_type.length > 0 && (
              <span className="text-muted-foreground">
                · {c.meal_type.join("/")}
              </span>
            )}
            {!locked && (
              <button
                type="button"
                aria-label={`Remove ${c.name}`}
                className="ml-0.5 text-muted-foreground hover:text-red-600"
                onClick={() => remove(c.slug)}
              >
                ×
              </button>
            )}
          </span>
        ))}
      </div>

      {shown.length > 0 && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          {shown.length} recipe{shown.length === 1 ? "" : "s"} · the AI can still
          add other dishes in the letter (⚠-marked for your review).
        </p>
      )}
    </div>
  );
}
