"use client";

/**
 * StartConfirmForm — client opens /start/<token> from WhatsApp; this form
 * shows the default start date (plan_period_start + 3d) and lets her either
 * confirm with one tap OR pick a different day.
 *
 * Pattern C of the three-pattern brainstorm (the others being a coach-side
 * manual entry panel and a WhatsApp-webhook auto-capture). This one needs
 * no auth, no webhook plumbing, no Pydantic round-trip — the shim writes
 * meal_plan_started_on + clears the token in one safe yaml.safe_dump.
 *
 * After a successful confirm we replace the form with a thank-you card
 * rather than navigating — the client closes the tab and returns to
 * WhatsApp.
 */

import { useState } from "react";
import { confirmStartDate } from "@/lib/server-actions/plans";

interface Props {
  token: string;
  planSlug: string;
  displayName: string;
  defaultStart: string | null;            // YYYY-MM-DD or null
  currentMealPlanStartedOn: string | null;
  planPeriodStart: string | null;
  planPeriodWeeks: number | null;
}

function formatHuman(ymd: string | null): string {
  if (!ymd) return "—";
  try {
    const d = new Date(ymd + "T00:00:00");
    return d.toLocaleDateString(undefined, {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return ymd;
  }
}

export function StartConfirmForm({
  token,
  displayName,
  defaultStart,
  currentMealPlanStartedOn,
}: Props) {
  // Suggested confirmation date: the coach-asserted value if it exists,
  // otherwise plan_period_start + 3 days. Either way, we pre-fill the
  // editable input so a coach who already typed a date in the panel still
  // gets a sensible default here.
  const suggestedStart = currentMealPlanStartedOn || defaultStart || "";
  const [pickedDate, setPickedDate] = useState<string>(suggestedStart);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmedDate, setConfirmedDate] = useState<string | null>(null);

  const greetingName = (displayName || "").split(/\s+/)[0] || "there";

  async function handleConfirm(date: string) {
    if (!date) {
      setError("Please pick a date first.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await confirmStartDate(token, date);
      if (!res.ok) {
        setError(res.error || "Something went wrong. Please try again.");
        return;
      }
      setConfirmedDate(date);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  if (confirmedDate) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="text-4xl">🌿</div>
        <h2 className="mt-3 text-xl font-semibold text-emerald-900 sm:text-2xl">
          Got it!
        </h2>
        <p className="mt-3 text-base leading-relaxed text-stone-700">
          Your plan starts on <strong>{formatHuman(confirmedDate)}</strong>.
        </p>
        <p className="mt-4 text-sm leading-relaxed text-stone-600">
          Talk soon — Shivani x
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm sm:p-8">
      <h2 className="text-xl font-semibold text-stone-800 sm:text-2xl">
        Hi {greetingName} <span aria-hidden>👋</span>
      </h2>
      <p className="mt-4 text-base leading-relaxed text-stone-700">
        Your plan is set to begin on{" "}
        <strong className="text-emerald-900">
          {formatHuman(suggestedStart)}
        </strong>
        .
      </p>

      <div className="mt-6 grid gap-4">
        {/* Primary action: one-tap confirm. Big, sage-green, generous touch
            target for mobile. */}
        <button
          type="button"
          onClick={() => handleConfirm(suggestedStart)}
          disabled={submitting || !suggestedStart}
          className="w-full rounded-xl bg-emerald-600 px-5 py-4 text-base font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60 sm:text-lg"
        >
          {submitting
            ? "Saving…"
            : suggestedStart
              ? `✓ Yes, that works — confirm ${formatHuman(suggestedStart).replace(/, \d{4}$/, "")}`
              : "Confirm"}
        </button>

        <div className="text-center text-xs uppercase tracking-wide text-stone-400">
          or
        </div>

        {/* Secondary path: pick a different day. */}
        <div className="rounded-xl border border-stone-200 p-4">
          <label className="block text-sm font-medium text-stone-700">
            Pick a different day:
          </label>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row">
            <input
              type="date"
              value={pickedDate}
              onChange={(e) => setPickedDate(e.target.value)}
              className="flex-1 rounded-lg border border-stone-300 px-3 py-3 text-base focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
              disabled={submitting}
            />
            <button
              type="button"
              onClick={() => handleConfirm(pickedDate)}
              disabled={submitting || !pickedDate}
              className="rounded-lg border border-emerald-600 bg-white px-5 py-3 text-base font-semibold text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Confirm
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        )}
      </div>

      <p className="mt-6 text-xs italic leading-relaxed text-stone-500">
        Confirming this just means I know when to start counting your 12 weeks.
        You're free to actually start whenever feels right — no judgment.
      </p>
    </div>
  );
}
