"use client";

/**
 * The exercise session block inside a lifestyle practice row.
 *
 * A practice row that carries exercises IS a session: an ordered list done
 * together, at the row's cadence. See PracticeItem.exercises in
 * fmdb/plan/models.py for why a session is one row rather than one row per
 * exercise — briefly, Otago is a programme rather than eight habits, and the
 * load check counts rows.
 *
 * ORDER IS THE PRESCRIPTION, so this list never sorts itself. Warm-up first,
 * strength last; a warm-up moved below the strength work is a different
 * instruction, not a cosmetic difference. Reordering is manual and explicit.
 *
 * BLOCKED ENTRIES ARE SHOWN, DISABLED, WITH THE REASON. The assess payload
 * withholds them from the model — a model shown a flag will reason past it —
 * but the coach is exactly the person who should see that sit-to-stand is off
 * the table for this client and why. Hiding them would look like the catalogue
 * is short, and she would go looking for the entry she knows exists.
 */

import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  loadExerciseOptions,
  type ExerciseOption,
} from "@/lib/server-actions/exercise-options";

export interface PrescribedExerciseItem {
  exercise: string;
  level?: string | null;
  note?: string;
}

const VERDICT_META: Record<
  string,
  { label: string; tone: string; short: string }
> = {
  blocked: {
    label: "Blocked",
    tone: "border-rose-300 bg-rose-50 text-rose-900",
    short: "not safe for this client",
  },
  caution: {
    label: "Caution",
    tone: "border-amber-300 bg-amber-50 text-amber-900",
    short: "fine with the modification",
  },
  watch: {
    label: "Watch",
    tone: "border-sky-300 bg-sky-50 text-sky-900",
    short: "nothing authored — your call",
  },
  clear: { label: "Clear", tone: "border-emerald-200 bg-emerald-50 text-emerald-900", short: "" },
};

export function ExerciseSessionEditor({
  clientId,
  value,
  locked = false,
  onChange,
}: {
  clientId?: string;
  value?: PrescribedExerciseItem[];
  locked?: boolean;
  onChange: (next: PrescribedExerciseItem[]) => void;
}) {
  const items = value ?? [];
  const [options, setOptions] = useState<ExerciseOption[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  // Options are loaded once, on demand — screening the catalogue for a client
  // is not free, and most practice rows are not sessions.
  useEffect(() => {
    if (!picking || options || loading || !clientId) return;
    setLoading(true);
    loadExerciseOptions(clientId)
      .then((r) => {
        if (r.ok) setOptions(r.options);
        else setError(r.error);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [picking, options, loading, clientId]);

  const bySlug = new Map((options ?? []).map((o) => [o.slug, o]));
  const chosen = new Set(items.map((i) => i.exercise));

  function move(from: number, to: number) {
    if (to < 0 || to >= items.length) return;
    const next = [...items];
    const [row] = next.splice(from, 1);
    next.splice(to, 0, row);
    onChange(next);
  }

  if (items.length === 0 && !picking) {
    return (
      <div className="pt-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={locked || !clientId}
          onClick={() => setPicking(true)}
          title={
            clientId
              ? "Turn this practice into an exercise session"
              : "Needs a client to screen against"
          }
        >
          🏃 Make this an exercise session
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-md border bg-background/60 p-2 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold">Exercise session</span>
        <span className="text-[10px] text-muted-foreground">
          in order — warm-up first, strength last
        </span>
        {items.length > 0 && (
          <Badge variant="secondary" className="ml-auto text-[10px]">
            {items.length}
          </Badge>
        )}
      </div>

      {items.map((it, i) => {
        const opt = bySlug.get(it.exercise);
        const meta = VERDICT_META[opt?.verdict ?? "clear"];
        const levels = opt?.levels ?? [];
        return (
          <div
            key={`${it.exercise}-${i}`}
            className="flex flex-wrap items-center gap-2 rounded border bg-muted/20 px-2 py-1.5"
          >
            <span className="text-[10px] text-muted-foreground w-4 shrink-0">{i + 1}</span>
            <span className="text-xs font-medium">
              {opt?.name ?? it.exercise.replace(/-/g, " ")}
            </span>
            {opt && opt.verdict !== "clear" && (
              <Badge variant="outline" className={`text-[9px] ${meta.tone}`}>
                {meta.label}
              </Badge>
            )}

            {/* Level. Blank means "let the screen decide", which is usually
                right — it starts a client with a falls signal or an
                osteoporosis caution at the first rung naming support. */}
            {levels.length > 0 ? (
              <select
                value={it.level ?? ""}
                disabled={locked}
                title="Which rung of this exercise's own ladder"
                className="text-[11px] border rounded px-1 py-0.5 bg-background"
                onChange={(e) => {
                  const next = [...items];
                  next[i] = { ...next[i], level: e.target.value || null };
                  onChange(next);
                }}
              >
                <option value="">
                  {opt?.startLevel ? `auto — ${opt.startLevel}` : "auto"}
                </option>
                {levels.map((l) => (
                  <option key={l.level} value={l.level}>
                    {l.level} — {l.prescription}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-[10px] text-muted-foreground italic">no levels</span>
            )}

            <div className="ml-auto flex items-center gap-1">
              <Button
                type="button" variant="ghost" size="sm" disabled={locked || i === 0}
                title="Move earlier in the session"
                onClick={() => move(i, i - 1)}
              >
                ↑
              </Button>
              <Button
                type="button" variant="ghost" size="sm"
                disabled={locked || i === items.length - 1}
                title="Move later in the session"
                onClick={() => move(i, i + 1)}
              >
                ↓
              </Button>
              <Button
                type="button" variant="ghost" size="sm" disabled={locked}
                onClick={() => onChange(items.filter((_, j) => j !== i))}
              >
                ✕
              </Button>
            </div>

            {/* The caution's own modification — the reason a caution is offered
                rather than withheld. Worth reading before prescribing. */}
            {opt?.notes?.some((n) => n.modification) && (
              <p className="w-full text-[10px] text-amber-800 leading-snug">
                {opt.notes.filter((n) => n.modification).map((n) => n.modification).join(" ")}
              </p>
            )}
          </div>
        );
      })}

      {!picking && (
        <Button
          type="button" variant="outline" size="sm" disabled={locked}
          onClick={() => setPicking(true)}
        >
          + Add exercise
        </Button>
      )}

      {picking && (
        <div className="rounded border bg-muted/30 p-2 space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold">
              Screened for this client
            </span>
            <Button
              type="button" variant="ghost" size="sm" className="ml-auto"
              onClick={() => setPicking(false)}
            >
              Close
            </Button>
          </div>
          {loading && <p className="text-[11px] text-muted-foreground">Screening…</p>}
          {error && <p className="text-[11px] text-rose-700">{error}</p>}
          {options && options.length === 0 && (
            <p className="text-[11px] text-muted-foreground">
              No exercises in the catalogue.
            </p>
          )}
          <div className="max-h-72 overflow-y-auto space-y-1">
            {(options ?? [])
              .filter((o) => !chosen.has(o.slug))
              .map((o) => {
                const meta = VERDICT_META[o.verdict];
                const blocked = o.verdict === "blocked";
                return (
                  <button
                    key={o.slug}
                    type="button"
                    disabled={blocked || locked}
                    title={blocked ? "Blocked for this client" : o.summary}
                    onClick={() =>
                      onChange([...items, { exercise: o.slug, level: null, note: "" }])
                    }
                    className={`w-full text-left rounded border px-2 py-1.5 text-xs ${
                      blocked
                        ? "opacity-70 cursor-not-allowed " + meta.tone
                        : "bg-background hover:bg-muted/60"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="font-medium">{o.name}</span>
                      {o.verdict !== "clear" && (
                        <Badge variant="outline" className={`text-[9px] ${meta.tone}`}>
                          {meta.label}
                        </Badge>
                      )}
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        {o.modality}
                      </span>
                    </span>
                    {/* For a blocked entry the REASON is the whole point of
                        still showing it. */}
                    {blocked && o.notes[0] && (
                      <span className="block text-[10px] mt-0.5 leading-snug">
                        {o.notes[0].detail}
                      </span>
                    )}
                  </button>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
