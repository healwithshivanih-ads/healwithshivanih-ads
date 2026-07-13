"use client";

/**
 * MealPlanDripPanel — dashboard widget that reminds the coach which clients
 * need their next fortnight meal-plan letter sent.
 *
 * Coach rule (2026-06-04): protocol = 12 weeks, sent 2 weeks at a time,
 * anchored to the first meal-plan send date. Each fortnight goes out 3 days
 * before the active one expires. This panel surfaces the next un-sent
 * fortnight that's due now (red) or coming up within 7 days (amber).
 *
 * Remind-and-approve only — nothing auto-sends. Each row links to the
 * client's Communicate page where the coach generates + sends the
 * `meal_plan_phase` letter. Once sent (logged to _send_log.yaml), the row
 * advances to the next fortnight automatically on refresh.
 *
 * Self-hides when there's nothing due or upcoming.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { FmPanel, FmChip } from "@/components/fm";
import type { FortnightDue } from "@/lib/server-actions/meal-plan-drip";

function formatHuman(ymd: string): string {
  try {
    return new Date(ymd + "T00:00:00").toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
    });
  } catch {
    return ymd;
  }
}

function whenLabel(days: number): string {
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return "send today";
  if (days === 1) return "send tomorrow";
  return `in ${days}d`;
}

export function MealPlanDripPanel() {
  const [rows, setRows] = useState<FortnightDue[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const { listMealPlanFortnightsDueAction } = await import(
        "@/lib/server-actions/meal-plan-drip"
      );
      const r = await listMealPlanFortnightsDueAction(7);
      if (!r.ok) setError(r.error);
      else setRows(r.rows);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Error is visible (durable rule: never silently swallow a server-action
  // failure in a client component).
  if (error) {
    return (
      <FmPanel title="🍽 Fortnight meal plans">
        <p className="text-sm text-rose-600">
          Couldn&apos;t load the fortnight schedule: {error}{" "}
          <button onClick={load} className="underline">
            retry
          </button>
        </p>
      </FmPanel>
    );
  }

  // Self-hide while loading or when nothing is due/upcoming.
  if (!rows || rows.length === 0) return null;

  return (
    <FmPanel
      title="🍽 Fortnight meal plans"
      subtitle="Next menu update due per client — review from the Plan tab"
    >
      <ul className="space-y-2">
        {rows.map((r) => {
          const overdue = r.days_until_send <= 0;
          return (
            <li
              key={`${r.client_id}-${r.fortnight_number}`}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border/60 px-3 py-2 text-sm"
            >
              <Link
                href={`/clients-v2/${r.client_id}/communicate`}
                className="font-medium hover:underline"
              >
                {r.display_name ?? r.client_id}
              </Link>
              <FmChip>
                {r.weeks_label} · of {r.total_fortnights * 2} wks
              </FmChip>
              <span className="text-muted-foreground">
                covers {formatHuman(r.covers_start)}–{formatHuman(r.covers_end)}
              </span>
              <span
                className={`ml-auto rounded px-2 py-0.5 text-xs font-medium ${
                  overdue
                    ? "bg-rose-100 text-rose-700"
                    : "bg-amber-100 text-amber-700"
                }`}
              >
                {whenLabel(r.days_until_send)} · {formatHuman(r.send_on)}
              </span>
            </li>
          );
        })}
      </ul>
    </FmPanel>
  );
}
