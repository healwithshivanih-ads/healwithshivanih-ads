/**
 * Which grocery weeks to (re)generate — the pure half of the grocery refresh.
 *
 * Every approved menu week now stays live on the plan (menu-weeks.ts), so the
 * live menu is no longer "the two weeks to shop for"; a 12-week client carries
 * all twelve. Rebuilding the grocery list for every live week on each approval
 * would be one Haiku call per week, every week, for lists nobody will shop
 * from again — and would silently throw away the lists already on disk.
 *
 * So the refresh is INCREMENTAL and keyed:
 *
 *   - A list is owed for the weeks the client is about to shop for: the
 *     current plan week and everything live ahead of it. When none of those is
 *     live (she is frozen past her last approval) the latest live week stands
 *     in — that is the menu the app shows her.
 *   - Each stored week carries `menu_key`, a fingerprint of the dishes it was
 *     built from. A week is regenerated only when it is missing, its key has
 *     changed (the coach edited a dish), or the caller forces it.
 *   - Lists for earlier weeks are kept as long as that week is still on the
 *     menu, so the app's grocery picker keeps offering them; a list for a week
 *     the menu no longer has is dropped with it.
 *
 * Keys are computed from the plan's RAW `app_menu.weeks` everywhere (the
 * refresh action and the backfill cron), never from the app loader's view of
 * the menu, so the two can never disagree about what "changed" means.
 */

export interface RawMenuSlot {
  slot?: unknown;
  dish?: unknown;
}
export interface RawMenuDay {
  slots?: RawMenuSlot[] | null;
}
export interface RawMenuWeek {
  week?: unknown;
  days?: RawMenuDay[] | null;
}

export interface GroceryWeekEntry {
  week?: unknown;
  menu_key?: unknown;
  [k: string]: unknown;
}

export interface GroceryRefreshPlan<E extends GroceryWeekEntry> {
  /** Existing entries to carry forward unchanged, ascending by week. */
  keep: E[];
  /** Week numbers that need a fresh list, ascending. */
  generate: number[];
  /** Week numbers whose stored list is dropped (no longer on the menu). */
  dropped: number[];
  /** Expected `menu_key` per week to generate (stamped onto the new entry). */
  keys: Record<number, string>;
}

/** FNV-1a over the week's slot|dish strings — short, stable, dependency-free. */
export function menuWeekKey(week: RawMenuWeek): string {
  const parts: string[] = [];
  for (const d of week.days ?? []) {
    const slots = (d?.slots ?? []).map(
      (s) => `${String(s?.slot ?? "").trim().toLowerCase()}|${String(s?.dish ?? "").trim()}`,
    );
    parts.push(slots.join(""));
  }
  const text = parts.join("");
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function weekNo(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function planGroceryRefresh<E extends GroceryWeekEntry>(
  menuWeeks: RawMenuWeek[],
  existing: E[],
  currentWeek: number,
  force = false,
): GroceryRefreshPlan<E> {
  const live = new Map<number, RawMenuWeek>();
  for (const w of menuWeeks) {
    const n = weekNo(w?.week);
    if (n !== null) live.set(n, w);
  }
  const liveNums = [...live.keys()].sort((a, b) => a - b);

  // Weeks a list is owed for.
  let wanted = liveNums.filter((n) => n >= currentWeek);
  if (!wanted.length && liveNums.length) wanted = [liveNums[liveNums.length - 1]];

  const byWeek = new Map<number, E>();
  for (const e of existing) {
    const n = weekNo(e?.week);
    if (n !== null && !byWeek.has(n)) byWeek.set(n, e);
  }

  const keep: E[] = [];
  const generate: number[] = [];
  const dropped: number[] = [];
  const keys: Record<number, string> = {};

  for (const n of liveNums) {
    const have = byWeek.get(n);
    if (wanted.includes(n)) {
      const key = menuWeekKey(live.get(n)!);
      const fresh = have && !force && String(have.menu_key ?? "") === key;
      if (fresh) keep.push(have);
      else {
        generate.push(n);
        keys[n] = key;
      }
    } else if (have) {
      keep.push(have); // an earlier week still on the menu — stays browsable
    }
  }
  for (const [n] of byWeek) if (!live.has(n)) dropped.push(n);

  keep.sort((a, b) => Number(a.week) - Number(b.week));
  generate.sort((a, b) => a - b);
  dropped.sort((a, b) => a - b);
  return { keep, generate, dropped, keys };
}
