/**
 * Supplement supply — the pure half (no node imports).
 *
 * WHAT IT IS: the client taps "I've ordered it" and then "It's arrived" on the
 * order sheet. From the arrival day, the product's pack size
 * (supplement_links.yaml#pack_size, filled by hand from the shop pages) and the
 * plan's dose give a run-out date. About a week before it, Home shows a
 * "running low" card with the same Buy link, and a phone notification goes
 * out ONLY if the client switched app reminders on. Nothing here messages the
 * client on the coach's behalf: it is the client's own reminder about the
 * client's own supply.
 *
 * STORAGE: `_supply.<host>.jsonl` in the client's folder, one JSON line per
 * tap, append-only, one file per writing host (the food-diary trick), so the
 * Fly copy (client taps) and the Mac copy never conflict. The coach reads the
 * folded result.
 *
 * NEVER GUESS: no pack size, or a dose we cannot turn into units a day →
 * no date and no card. A wrong "runs out on" is worse than none.
 */

/** "have" = the client already has it (no arrival day, so no countdown). */
export type SupplyOp = "ordered" | "arrived" | "have" | "undo";

export interface SupplyLine {
  op: SupplyOp;
  /** The order-sheet row id ("s-magnesium-glycinate", "rx-triphala"). */
  item: string;
  ts: string;
  /** Client's local day for "arrived" (YYYY-MM-DD). */
  date?: string;
}

export interface ItemSupply {
  /** Last "ordered" tap still standing (ISO). */
  orderedAt?: string;
  /** Day the latest pack arrived. */
  arrivedOn?: string;
  /** "I already have it": in stock, day unknown. */
  have?: boolean;
}

export function parseSupplyLines(raw: string): SupplyLine[] {
  const out: SupplyLine[] = [];
  for (const l of raw.split("\n")) {
    const t = l.trim();
    if (!t) continue;
    try {
      const o = JSON.parse(t) as Partial<SupplyLine>;
      if ((o.op === "ordered" || o.op === "arrived" || o.op === "have" || o.op === "undo") && typeof o.item === "string" && typeof o.ts === "string")
        out.push({ op: o.op, item: o.item, ts: o.ts, ...(typeof o.date === "string" ? { date: o.date } : {}) });
    } catch {
      /* torn line */
    }
  }
  return out;
}

/** Fold every host's lines, oldest first. "undo" steps the item back one tap:
 *  arrived → ordered, ordered → nothing. */
export function foldSupply(lines: readonly SupplyLine[]): Record<string, ItemSupply> {
  const sorted = [...lines].sort((a, b) => a.ts.localeCompare(b.ts));
  const hist: Record<string, SupplyLine[]> = {};
  for (const l of sorted) {
    const h = (hist[l.item] ??= []);
    if (l.op === "undo") h.pop();
    else h.push(l);
  }
  const out: Record<string, ItemSupply> = {};
  for (const [item, h] of Object.entries(hist)) {
    const s: ItemSupply = {};
    for (const l of h) {
      if (l.op === "ordered") {
        s.orderedAt = l.ts;
      } else if (l.op === "arrived" && l.date) {
        s.arrivedOn = l.date;
        // An order placed before this arrival is the one that arrived.
        if (s.orderedAt && s.orderedAt <= l.ts) delete s.orderedAt;
        delete s.have;
      } else if (l.op === "have") {
        s.have = true;
        delete s.arrivedOn;
        delete s.orderedAt;
      }
    }
    if (s.orderedAt || s.arrivedOn || s.have) out[item] = s;
  }
  return out;
}

export interface PackSize {
  count: number;
  unit: string;
}

export function parsePackSize(raw: unknown): PackSize | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const count = typeof o.count === "number" ? o.count : NaN;
  const unit = typeof o.unit === "string" ? o.unit : "";
  if (!Number.isFinite(count) || count <= 0 || !unit) return null;
  return { count, unit };
}

const COUNT_UNIT = /(capsules?|caps?|tablets?|tabs?|softgels?|gel ?caps?|pills?|lozenges?|chewables?)/i;
const WORD_NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, half: 0.5 };

function num(s: string): number {
  const w = WORD_NUM[s.toLowerCase()];
  return w ?? parseFloat(s.replace(",", "."));
}

/** How many times a day the timing says. Unknown → 1. */
export function timesPerDay(timing: string): number {
  const t = timing.toLowerCase();
  if (/three times|thrice|\btid\b|3x|3 times/.test(t)) return 3;
  if (/twice|\bbid\b|2x|2 times|two times/.test(t)) return 2;
  const meals = ["breakfast", "lunch", "dinner"].filter((m) => t.includes(m)).length;
  if (meals >= 2 && /\band\b|,|\+/.test(t)) return meals;
  if (/morning/.test(t) && /(evening|night|bed)/.test(t) && /\band\b|,|\+/.test(t)) return 2;
  return 1;
}

function mg(s: string): number | null {
  const m = s.match(/(\d+(?:[.,]\d+)?)\s*(mg|mcg|µg|g)\b/i);
  if (!m) return null;
  const v = parseFloat(m[1].replace(",", "."));
  const u = m[2].toLowerCase();
  return u === "g" ? v * 1000 : u === "mg" ? v : v / 1000;
}

/**
 * Units a day for a pack counted in capsules / tablets / softgels.
 *  1. The dose names a count ("2 capsules") → that, × times a day.
 *  2. The dose is a strength ("200 mg") and the product says its strength per
 *     unit ("100 mg per capsule") → dose ÷ strength, rounded up to a whole
 *     unit, × times a day.
 *  3. Otherwise → null. We do not assume "one a day".
 * Packs counted in g / ml return null: a scoop size is never reliable enough.
 */
export function unitsPerDay(dose: string, timing: string, unitStrength: string | undefined, pack: PackSize): number | null {
  if (!COUNT_UNIT.test(pack.unit)) return null;
  if (/as.?needed|prn\b|weekly|alternate days?|every other day/i.test(`${dose} ${timing}`)) return null;
  const n = timesPerDay(timing);
  const c = dose.match(new RegExp(`(\\d+(?:[.,]\\d+)?|one|two|three|four|half)(?:\\s*(?:-|–|to)\\s*(\\d+))?\\s*(?:x\\s*)?${COUNT_UNIT.source}`, "i"));
  if (c) {
    const per = num(c[2] ?? c[1]); // a range "1-2 capsules" plans for the top
    return Number.isFinite(per) && per > 0 ? per * n : null;
  }
  const want = mg(dose);
  if (want && unitStrength) {
    // "1000 mg per 2-cap serving" or "715 mg … per 2 softgels" → per ONE unit.
    const head = unitStrength.split(/[(;]/)[0];
    const per = head.match(/per\s+(\d+)[\s-]*(?:veg(?:gie)?\s+)?(?:caps?|capsules?|tablets?|tabs?|softgels?)/i);
    const strength = mg(head);
    if (strength) {
      const perUnit = per ? strength / parseInt(per[1], 10) : strength;
      if (perUnit > 0) return Math.max(1, Math.ceil(want / perUnit - 0.01)) * n;
    }
  }
  return null;
}

function addDays(ymd: string, d: number): string {
  const t = new Date(`${ymd}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + d);
  return t.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

/** Days before running out when the Home card shows. Shops here take 3–7 days. */
export const LOW_DAYS = 7;

export interface SupplyStatus {
  state: "none" | "ordered" | "arrived" | "low" | "out";
  /** Last day there is enough, when we can count it. */
  runsOutOn?: string;
  daysLeft?: number;
}

export function supplyStatus(
  s: ItemSupply | undefined,
  pack: PackSize | null | undefined,
  perDay: number | null | undefined,
  todayYmd: string,
): SupplyStatus {
  if (!s) return { state: "none" };
  if (!s.arrivedOn) return { state: s.orderedAt ? "ordered" : "arrived" };
  // From here an orderedAt is a REORDER placed while a pack is running
  // (foldSupply drops the order a later arrival filled): still count the pack.
  if (!pack || !perDay) return { state: s.orderedAt ? "ordered" : "arrived" };
  const lasts = Math.floor(pack.count / perDay);
  const runsOutOn = addDays(s.arrivedOn, lasts - 1);
  const daysLeft = daysBetween(todayYmd, runsOutOn);
  if (s.orderedAt) return { state: "ordered", runsOutOn, daysLeft };
  if (daysLeft < 0) return { state: "out", runsOutOn, daysLeft };
  if (daysLeft <= LOW_DAYS) return { state: "low", runsOutOn, daysLeft };
  return { state: "arrived", runsOutOn, daysLeft };
}

/** "28 Nov" */
export function shortDay(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}
