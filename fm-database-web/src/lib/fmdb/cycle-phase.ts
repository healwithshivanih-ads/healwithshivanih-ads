/** Menstrual-cycle phase computation — the TypeScript twin of
 *  `Client.cycle_context()` (fm-database/fmdb/plan/models.py).
 *
 *  The Python method is the source of truth; this port exists so the coach
 *  UI (phase chips) and the client app (today's phase card) can show a phase
 *  without a shim round-trip. The thresholds MUST stay byte-identical to the
 *  Python side — `cycle-phase.test.ts` pins them with shared fixtures, so a
 *  change to either implementation fails the suite until both move.
 *
 *  Phase model (1-based cycleDay, f = cycleDay / cycleLength):
 *    menstrual     cycleDay <= 5
 *    follicular    f <= 0.45
 *    ovulatory     f <= 0.55
 *    early_luteal  f <= 0.78
 *    late_luteal   otherwise
 *
 *  Confidence drops to "low" for perimenopausal status, irregular cycles,
 *  and a stale LMP (older than two cycle lengths — the modulo would happily
 *  wrap a months-old date into a plausible-looking cycle day otherwise).
 *  Phase-keyed BEHAVIOUR must gate on confidence === "high"; display
 *  surfaces may show low-confidence context with a softening note.
 *
 *  NOT consulted here (mirror of the Python caveat): pregnancy_status.
 *  `cyclePhaseForDisplay` applies that guard; raw callers must do likewise.
 */

export type CyclePhaseName =
  | "menstrual"
  | "follicular"
  | "ovulatory"
  | "early_luteal"
  | "late_luteal"
  | "postmenopausal";

export interface CycleContext {
  status: string;
  phase: CyclePhaseName | null;
  cycleDay: number | null;
  cycleLength: number;
  daysUntilNextPeriod: number | null;
  daysSinceLmp: number | null;
  regularity: string | null;
  confidence: "high" | "low";
  note: string;
}

/** Human labels for chips — client-safe wording. */
export const PHASE_LABELS: Record<CyclePhaseName, string> = {
  menstrual: "Menstrual",
  follicular: "Follicular",
  ovulatory: "Ovulatory",
  early_luteal: "Early luteal",
  late_luteal: "Late luteal",
  postmenopausal: "Post-menopause",
};

/** One-line, client-safe guidance per phase — mirrors the Python
 *  phase_notes spirit without clinical jargon. */
export const PHASE_NOTES: Record<CyclePhaseName, string> = {
  menstrual:
    "Gentle days — warm, iron-rich food and restful movement do the most now.",
  follicular:
    "Rising energy — lighter, fresher meals land well and harder workouts fit here.",
  ovulatory:
    "Peak energy — bright fresh meals; a great window for your most intense training.",
  early_luteal:
    "Steadier pace — heartier meals with slow-burning carbs keep energy even.",
  late_luteal:
    "Pre-period week — eat properly and often, keep movement steady, guard your sleep.",
  postmenopausal:
    "Steady rhythm — consistent meals, strength work and good sleep carry the day.",
};

interface CycleFields {
  sex?: unknown;
  cycle_status?: unknown;
  last_menstrual_period?: unknown;
  cycle_length_days?: unknown;
  cycle_regularity?: unknown;
  pregnancy_status?: unknown;
  lactation_started?: unknown;
}

/** A YAML date field as a UTC midnight Date, whether YAML gave us a string or
 *  a Date — the same defensive boundary read `asDayStr` in client-app.ts
 *  exists for, and for the same reason.
 *
 *  `last_menstrual_period: '2026-07-28'` (quoted) parses as a string; written
 *  UNQUOTED it parses as a JS Date, because js-yaml resolves the YAML
 *  timestamp type — and PyYAML on the Python side emits these bare, which is
 *  how every real client record is written. `String(dateObject).slice(0, 10)`
 *  yields "Thu Jul 28", which fails an ISO test, so the field read as absent
 *  and NO client ever got a phase. Silent, and correct-looking in the file.
 *
 *  Two YAML parsers, one file, different types out. Read defensively here
 *  rather than trusting every writer to quote. */
function asDateUTC(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) {
    return Number.isNaN(v.getTime())
      ? null
      : new Date(`${v.toISOString().slice(0, 10)}T00:00:00Z`);
  }
  if (typeof v !== "string") return null;
  const s = v.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return isNaN(d.getTime()) ? null : d;
}

/** Port of Client.cycle_context(). `onDateUTC` defaults to the current UTC
 *  date; pass the client-timezone "today" where one exists (the app payload
 *  builder does). Returns null exactly when Python returns None. */
export function computeCycleContext(
  client: CycleFields,
  onDateUTC?: Date,
): CycleContext | null {
  const sex = String(client.sex ?? "").toUpperCase();
  if (sex !== "F" && sex !== "FEMALE") return null;
  const status = String(client.cycle_status ?? "").trim().toLowerCase();
  if (!status || status === "not_applicable") return null;

  const rawLen = Number(client.cycle_length_days);
  const cycleLength =
    Number.isFinite(rawLen) && rawLen > 0 ? Math.trunc(rawLen) : 28;
  const regularity = String(client.cycle_regularity ?? "") || "regular";

  if (status === "postmenopausal") {
    return {
      status,
      phase: "postmenopausal",
      cycleDay: null,
      cycleLength,
      daysUntilNextPeriod: null,
      daysSinceLmp: null,
      regularity: null,
      confidence: "high",
      note: PHASE_NOTES.postmenopausal,
    };
  }

  const lmp = asDateUTC(client.last_menstrual_period);
  if (!lmp) {
    return {
      status,
      phase: null,
      cycleDay: null,
      cycleLength,
      daysUntilNextPeriod: null,
      daysSinceLmp: null,
      regularity,
      confidence: "low",
      note: "No period start date on record yet.",
    };
  }

  const today = onDateUTC ?? new Date();
  const todayMid = new Date(
    `${today.toISOString().slice(0, 10)}T00:00:00Z`,
  );
  const daysSinceLmp = Math.floor(
    (todayMid.getTime() - lmp.getTime()) / 86_400_000,
  );
  if (daysSinceLmp < 0) return null; // LMP in the future — data error

  const cycleDay = (daysSinceLmp % cycleLength) + 1;
  const daysUntilNextPeriod = cycleLength - cycleDay + 1;
  const staleLmp = daysSinceLmp > cycleLength * 2;

  const f = cycleDay / cycleLength;
  const phase: CyclePhaseName =
    cycleDay <= 5
      ? "menstrual"
      : f <= 0.45
        ? "follicular"
        : f <= 0.55
          ? "ovulatory"
          : f <= 0.78
            ? "early_luteal"
            : "late_luteal";

  const confidence: "high" | "low" =
    status === "perimenopausal" || regularity !== "regular" || staleLmp
      ? "low"
      : "high";

  let note = PHASE_NOTES[phase];
  if (staleLmp) {
    note = `Period date is ${daysSinceLmp} days old — this phase is an estimate until it's refreshed. ${note}`;
  }

  return {
    status,
    phase,
    cycleDay,
    cycleLength,
    daysUntilNextPeriod,
    daysSinceLmp,
    regularity,
    confidence,
    note,
  };
}

/** Display-surface wrapper: the same context, but null for pregnant or
 *  lactating clients — a stale "menstruating" status must not put a cycle
 *  chip on a pregnant client's record. */
export function cyclePhaseForDisplay(
  client: CycleFields,
  onDateUTC?: Date,
): CycleContext | null {
  if (
    String(client.pregnancy_status ?? "")
      .trim()
      .toLowerCase()
      .startsWith("pregnant")
  ) {
    return null;
  }
  if (client.lactation_started) return null;
  return computeCycleContext(client, onDateUTC);
}
