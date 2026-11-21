/**
 * The day row on Today (coach's request, 21 Nov 2026): today and the next
 * six days of the menu, so a client can prep tonight's dinner in the morning,
 * plan two or three days at a time, and see a day's groceries on tap.
 *
 * Pure functions only; sq-day.tsx draws them.
 */

import type { AppWeekMenu, WeekMenuSlot } from "@/lib/fmdb/client-app";

export interface SqDay {
  /** "Today", or "Sun 22 Nov" / "Sun" */
  label: string;
  /** short form for the row: "Today", "Sun 22" */
  chip: string;
  isToday: boolean;
  slots: WeekMenuSlot[];
}

/** Today and the next six days that have a menu, in order. */
export function upcomingDays(menus: AppWeekMenu[], max = 7): SqDay[] {
  const out: SqDay[] = [];
  const start = menus.findIndex((w) => w.current);
  if (start < 0) return out;
  for (let wi = start; wi < menus.length && out.length < max; wi++) {
    const days = menus[wi].days;
    const from = wi === start ? Math.max(0, days.findIndex((d) => d.today)) : 0;
    for (let di = from; di < days.length && out.length < max; di++) {
      const d = days[di];
      if (d.slots.length === 0) continue;
      const isToday = out.length === 0 && !!d.today;
      const date = d.dateLabel ? ` ${d.dateLabel}` : "";
      out.push({
        label: isToday ? "Today" : `${d.dow}${date}`,
        chip: isToday ? "Today" : `${d.dow}${d.dateLabel ? " " + d.dateLabel.split(" ")[0] : ""}`,
        isToday,
        slots: d.slots,
      });
    }
  }
  return out;
}

/** What the day's cooking needs: each meal's recipe ingredients, in meal
 *  order. Read from the recipes themselves, so the amounts are that day's,
 *  not the week's shopping totals. Meals with no written recipe are named
 *  so nothing is silently missing. */
export function dayGroceries(day: SqDay): { meal: string; dish: string; items: string[] }[] {
  return day.slots.flatMap((s) => [
    { meal: s.slot, dish: s.recipe?.title ?? s.dish, items: s.recipe?.ingredients ?? [] },
    ...(s.recipe?.more ?? []).filter((c) => c.ingredients.length > 0).map((c) => ({ meal: s.slot, dish: c.title, items: c.ingredients })),
  ]);
}

const PREP_RE = /\b(soak|soaked|overnight|ferment|marinate|sprout)/i;

/** A step that has to start ahead of time (soak, ferment, marinate) for a
 *  dish on this day: shown on the day before. */
export function prepFor(day: SqDay): { dish: string; step: string } | null {
  for (const s of day.slots) {
    const step = s.recipe?.method.find((m) => PREP_RE.test(m));
    if (step) return { dish: s.recipe?.title ?? s.dish, step };
  }
  return null;
}
