"use client";

/**
 * Milk-protein allergy vs lactose intolerance, for the coach.
 *
 * Shows what every menu, recipe filter and supplement check is currently
 * doing with dairy for this client, the client's own answers behind it, and
 * lets the coach record what she learned on the call. See
 * lib/fmdb/dairy-reaction.ts for why the distinction matters.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DAIRY_SYMPTOMS,
  DAIRY_TIMING,
  DAIRY_TOLERANCE,
  DAIRY_TYPE_GUIDANCE,
  DAIRY_TYPE_LABEL,
  type DairyReactionType,
  type ResolvedDairy,
} from "@/lib/fmdb/dairy-reaction";
import { setDairyReactionType } from "@/lib/server-actions/dairy-reaction";

const labelOf = (list: ReadonlyArray<{ key: string; label: string }>, k: unknown) =>
  list.find((x) => x.key === k)?.label ?? null;

const TONE: Record<DairyReactionType, string> = {
  lactose_intolerance: "border-emerald-200 bg-emerald-50",
  milk_protein_allergy: "border-rose-200 bg-rose-50",
  unsure: "border-amber-200 bg-amber-50",
};

export function DairyReactionPanel({
  clientId,
  resolved,
  recordedSource,
  answers,
}: {
  clientId: string;
  resolved: ResolvedDairy;
  /** `dairy_reaction_source` on the record: intake | coach | undefined. */
  recordedSource?: string;
  answers: {
    symptoms: string[];
    timing?: string;
    curd?: string;
    paneer?: string;
    ghee?: string;
  };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const save = (t: DairyReactionType | null) =>
    start(async () => {
      setError(null);
      const res = await setDairyReactionType(clientId, t);
      if (!res.ok) setError(res.error);
      else router.refresh();
    });

  const source =
    resolved.source === "inferred"
      ? "Dairy is on the allergy / avoid list, but the type was never asked."
      : recordedSource === "coach"
        ? "Set by you."
        : "From the client's intake answers.";

  const symptomLabels = answers.symptoms
    .map((k) => DAIRY_SYMPTOMS.find((s) => s.key === k))
    .filter(Boolean) as typeof DAIRY_SYMPTOMS[number][];
  const hasAnswers =
    symptomLabels.length > 0 || answers.timing || answers.curd || answers.paneer || answers.ghee;

  return (
    <section className={`rounded-lg border px-5 py-4 ${TONE[resolved.kind]}`}>
      <h2 className="text-base font-semibold text-stone-900">🥛 Dairy: {DAIRY_TYPE_LABEL[resolved.kind]}</h2>
      <p className="text-sm text-stone-700 mt-1">{DAIRY_TYPE_GUIDANCE[resolved.kind]}</p>
      {resolved.kind !== "lactose_intolerance" && (
        <p className="text-xs text-stone-600 mt-1">
          Ghee: {resolved.gheeOk ? "allowed (the client said ghee is fine)" : "left out as well"}.
        </p>
      )}
      <p className="text-xs text-stone-500 mt-1">{source}</p>

      {hasAnswers ? (
        <dl className="mt-3 grid grid-cols-[140px_1fr] gap-x-3 gap-y-1 text-sm">
          {symptomLabels.length > 0 && (
            <>
              <dt className="text-xs uppercase tracking-wide text-stone-500 pt-0.5">What happens</dt>
              <dd className="text-stone-800">
                {symptomLabels.map((s) => (
                  <span
                    key={s.key}
                    className={
                      "inline-block mr-1.5 mb-1 px-2 py-0.5 rounded text-xs " +
                      (s.allergySign ? "bg-rose-100 text-rose-800" : "bg-stone-100 text-stone-700")
                    }
                  >
                    {s.label}
                  </span>
                ))}
              </dd>
            </>
          )}
          {answers.timing && (
            <>
              <dt className="text-xs uppercase tracking-wide text-stone-500 pt-0.5">How soon</dt>
              <dd className="text-stone-800">{labelOf(DAIRY_TIMING, answers.timing)}</dd>
            </>
          )}
          {(["curd", "paneer", "ghee"] as const).map((k) =>
            answers[k] ? (
              <div key={k} className="contents">
                <dt className="text-xs uppercase tracking-wide text-stone-500 pt-0.5 capitalize">{k}</dt>
                <dd className="text-stone-800">{labelOf(DAIRY_TOLERANCE, answers[k])}</dd>
              </div>
            ) : null,
          )}
        </dl>
      ) : (
        <p className="text-xs text-stone-600 mt-2">
          No follow-up answers on file. Ask: does curd, paneer or ghee cause symptoms? Curd fine →
          lactose intolerance. Hives, swelling, wheeze or vomiting, or curd <em>and</em> paneer both
          react → milk-protein allergy.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-xs text-stone-600">Confirmed on the call:</span>
        {(["lactose_intolerance", "milk_protein_allergy", "unsure"] as const).map((t) => (
          <button
            key={t}
            type="button"
            disabled={pending}
            onClick={() => save(t)}
            aria-pressed={recordedSource === "coach" && resolved.kind === t}
            className={
              "text-xs px-2.5 py-1 rounded border " +
              (recordedSource === "coach" && resolved.kind === t
                ? "bg-stone-900 text-white border-stone-900"
                : "bg-white text-stone-800 border-stone-300 hover:border-stone-500")
            }
          >
            {DAIRY_TYPE_LABEL[t]}
          </button>
        ))}
        {recordedSource === "coach" && (
          <button
            type="button"
            disabled={pending}
            onClick={() => save(null)}
            className="text-xs text-stone-600 underline"
          >
            Go back to the intake answers
          </button>
        )}
      </div>
      {error && <p className="text-xs text-rose-700 mt-2">{error}</p>}
    </section>
  );
}
