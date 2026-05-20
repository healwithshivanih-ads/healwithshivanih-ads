"use client";

/**
 * NewCommunicatePanel — Phase 3a of the V2 Communicate redesign.
 *
 * Renders the new design HTML structure (hero CTA, weekly menus track,
 * letters & guides list, special requests collapsible, send history
 * sidebar) ABOVE the legacy widgets. State-driven from real data:
 *
 *   - currentWeek      = (today - planPeriodStart) / 7 (clamped)
 *   - weekStates[]     = fortnight cards, derived from sendLog entries
 *                        whose letter_types include "phase_meal_plan"
 *                        (or matching slug heuristic).
 *   - docStates[5]     = sent / drafted / idle, derived from sendLog
 *                        letter_types across the whole log.
 *   - activeOverride   = weight_loss.week_overrides entry whose date
 *                        range overlaps today.
 *   - hero             = picks tone/title from the strongest signal:
 *                          • staleness.anyStale  → warning
 *                          • activeOverride      → secondary
 *                          • no sendLog yet      → primary "send initial"
 *                          • today > planEnd     → danger
 *                          • else                → primary "generate next"
 *
 * Phase 3b will wire generation/send actions to the buttons; for now
 * they're visual placeholders that link to the existing CommunicateClient
 * (rendered below this panel) so the coach can act.
 *
 * Styling: every selector in `src/styles/fm-v2-communicate.css` is scoped
 * under `.fm-v2`, so this whole panel is wrapped in a `.fm-v2` div.
 */
import { useState } from "react";
import type { LetterSendEntry } from "@/app/api/email/actions";
import type {
  Client,
  WeightLossGoal,
  WeightLossWeekOverride,
} from "@/lib/fmdb/types";
import type {
  LetterType,
  SavedPhase,
} from "@/lib/server-actions/plan-lifecycle";
import { LetterGenerateTrigger } from "./letter-generate-modal";

// ───────────────────────────────────────────────────────────────────
// Document types in the order the design specifies.
// ───────────────────────────────────────────────────────────────────
// `standalone` — true when this letter type can be generated on its own
// via a single AI call (mode="single"). False for supplement/lifestyle:
// those are SECTIONS of the consolidated wellness letter, not separate
// generations — they extract from it for free, so their row shows
// "In the wellness letter" instead of a misleading Generate button.
const DOC_TYPES: ReadonlyArray<{
  id: string;
  label: string;
  desc: string;
  kind: string;
  letter: LetterType;
  standalone: boolean;
}> = [
  {
    id: "consolidated",
    label: "Full wellness letter",
    desc: "Consolidated phase letter — story, why, what changed",
    kind: "wellness",
    letter: "consolidated",
    standalone: true,
  },
  {
    id: "supplement",
    label: "Supplement plan",
    desc: "Dosing, timing, brands — a section of the wellness letter",
    kind: "supplement",
    letter: "supplement_plan",
    standalone: false,
  },
  {
    id: "lifestyle",
    label: "Lifestyle guide",
    desc: "Sleep, stress, movement habits — a section of the wellness letter",
    kind: "lifestyle",
    letter: "lifestyle_guide",
    standalone: false,
  },
  {
    id: "exercise",
    label: "Exercise plan",
    desc: "Optional standalone movement scaffold — respects limitations",
    kind: "exercise",
    letter: "exercise_plan",
    standalone: true,
  },
  {
    id: "recipes",
    label: "Recipe pack",
    desc: "Optional standalone recipe collection for ✦ dishes",
    kind: "recipes",
    letter: "recipes",
    standalone: true,
  },
];

const DOC_ICON: Record<string, string> = {
  wellness: "W",
  supplement: "S",
  lifestyle: "L",
  exercise: "E",
  recipes: "R",
  menu: "M",
};

// ───────────────────────────────────────────────────────────────────
// Date helpers.
// ───────────────────────────────────────────────────────────────────
function parseIso(s: string | Date | undefined | null): Date | null {
  if (!s) return null;
  // js-yaml's default CORE_SCHEMA parses ISO date strings (e.g.
  // `plan_period_start: '2026-05-12'`) into JS Date objects on load.
  // The prop type says `string` but at runtime we can receive a Date.
  // Coach reported 2026-05-19 that fortnight labels showed today's
  // date as the Wks 1-2 start — root cause was the Date object not
  // being recognised here and falling back to `today`.
  if (s instanceof Date) {
    return isNaN(s.getTime()) ? null : s;
  }
  const raw = String(s);
  const d = new Date(raw.length === 10 ? `${raw}T00:00:00` : raw);
  return isNaN(d.getTime()) ? null : d;
}

function fmtRangeDM(from: Date, to: Date): string {
  const opts: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short" };
  return `${from.toLocaleDateString("en-IN", opts)} – ${to.toLocaleDateString(
    "en-IN",
    opts,
  )}`;
}

function fmtDateTime(s: string): string {
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000);
}

/** Convert a Date to YYYY-MM-DD in local time (NOT toISOString — that
 *  shifts by timezone offset and pushes evening-IST dates back a day). */
function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ───────────────────────────────────────────────────────────────────
// Build fortnight week cards from the plan start date + plan length.
// We chunk plan_period_weeks into 2-week fortnights (rounded up).
// ───────────────────────────────────────────────────────────────────
type WeekCard = {
  index: number;            // 0-based fortnight index
  weekStart: number;        // first protocol week number (1-indexed)
  weekEnd: number;          // last protocol week number
  label: string;            // "Wks 1–2"
  dateFrom: Date;
  dateTo: Date;
  dates: string;            // "06–19 May"
  phase: string;            // "Initial" | "Phase letter" | "Wind-down"
};

function buildFortnights(planStart: Date, planWeeks: number): WeekCard[] {
  const out: WeekCard[] = [];
  const totalFortnights = Math.ceil(planWeeks / 2);
  for (let i = 0; i < totalFortnights; i++) {
    const ws = i * 2 + 1;
    const we = Math.min(ws + 1, planWeeks);
    const from = new Date(planStart.getTime() + (ws - 1) * 7 * 86_400_000);
    const to = new Date(
      planStart.getTime() + (we * 7 - 1) * 86_400_000,
    );
    out.push({
      index: i,
      weekStart: ws,
      weekEnd: we,
      label: ws === we ? `Wk ${ws}` : `Wks ${ws}–${we}`,
      dateFrom: from,
      dateTo: to,
      dates: fmtRangeDM(from, to),
      phase:
        i === 0 ? "Initial" : i === totalFortnights - 1 ? "Wind-down" : "Phase letter",
    });
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────
// Map sendLog → per-fortnight status.
//
// We look for sends whose letter_types include "phase_meal_plan" (or
// "consolidated" for the initial-package case) and whose sent_at falls
// inside that fortnight's window — OR is within the 7 days before
// dateFrom (typical case: coach sends Friday for Monday start).
// ───────────────────────────────────────────────────────────────────
type WeekState =
  | { kind: "sent"; pillLabel: string; note: string; stamp: string }
  | { kind: "drafted"; pillLabel: string; note: string }
  | { kind: "stale"; pillLabel: string; note: string }
  | { kind: "override"; pillLabel: string; note: string }
  | { kind: "idle"; pillLabel: string; note: string }
  | { kind: "na"; pillLabel: string; note: string };

/** Per-fortnight derivation. Inputs are date-only strings (YYYY-MM-DD)
 *  so timezones can't shift comparisons. `cursorWeekIdx` is decided
 *  upstream — this function just paints each card. */
function deriveWeekStates(
  weeks: WeekCard[],
  sendsByWeek: (LetterSendEntry | null)[],
  draftsByWeek: (SavedPhase | null)[],
  override: WeightLossWeekOverride | null,
  todayIso: string,
  cursorWeekIdx: number,
): WeekState[] {
  return weeks.map((wk, i) => {
    const fromIso = isoDay(wk.dateFrom);
    const toIso = isoDay(wk.dateTo);

    // Override window covering this fortnight? Date-only compare.
    if (override?.date_from && override?.date_to) {
      if (!(override.date_to < fromIso || override.date_from > toIso)) {
        const label =
          override.mode === "maintenance"
            ? "Maintenance"
            : override.mode === "skip"
              ? "Skip"
              : "Deeper deficit";
        return {
          kind: "override",
          pillLabel: label,
          note:
            override.context === "travel" && override.location
              ? `Override · ${override.location}.`
              : "Override active for these dates.",
        };
      }
    }

    // Sent? (matched upstream — see deriveSendsByWeek.)
    const send = sendsByWeek[i];
    if (send) {
      return {
        kind: "sent",
        pillLabel: "Sent",
        stamp: fmtDateTime(send.sent_at),
        note: `Delivered ${fmtDateTime(send.sent_at)}.`,
      };
    }

    // Drafted on disk but not yet sent?
    const draft = draftsByWeek[i];
    if (draft) {
      return {
        kind: "drafted",
        pillLabel: "Drafted",
        note: `Saved ${fmtDateTime(draft.savedAt)} — ready to send.`,
      };
    }

    // Future fortnight (hasn't started yet)
    if (todayIso < fromIso) {
      const dDays = Math.max(0, daysBetween(parseIso(todayIso)!, wk.dateFrom));
      if (i === cursorWeekIdx) {
        return {
          kind: "idle",
          pillLabel: "Not generated",
          note:
            dDays === 0
              ? "Due today."
              : dDays <= 14
                ? `Due in ${dDays} day${dDays === 1 ? "" : "s"}.`
                : `Due ${wk.dates}.`,
        };
      }
      return {
        kind: "idle",
        pillLabel: "Not generated",
        note: `Starts ${wk.dates}.`,
      };
    }

    // Inside or past this fortnight, nothing sent yet.
    if (i === cursorWeekIdx) {
      return {
        kind: "idle",
        pillLabel: "Not generated",
        note: todayIso <= toIso
          ? "Due now — check-in folds in automatically."
          : "Overdue — generate now.",
      };
    }
    // Past fortnight, never sent, but a later one IS the cursor — i.e.
    // we intentionally moved past it.
    return {
      kind: "idle",
      pillLabel: "Not generated",
      note: "No meal plan was sent for this window.",
    };
  });
}

/** Match each fortnight to a sendLog entry (or null).
 *
 *  Two send categories:
 *  - INITIAL PACKAGE — letter_types includes consolidated / supplement_plan /
 *    lifestyle_guide / exercise_plan / recipes. Counts as the send for
 *    FORTNIGHT 1 ONLY. (Was incorrectly matching every fortnight within
 *    ±14 days, so a 12 May initial send was making Wks 1–2 AND Wks 3–4
 *    both look "Sent" with identical content. Fixed 2026-05-19.)
 *  - PHASE LETTER — letter_types includes meal_plan_phase / phase_meal_plan
 *    / meal_plan. Matches the fortnight whose date window covers sent_at
 *    (±14d for advance sends).
 */
function deriveSendsByWeek(
  weeks: WeekCard[],
  sendLog: LetterSendEntry[],
): (LetterSendEntry | null)[] {
  const INITIAL_TYPES = new Set([
    "consolidated",
    "supplement_plan",
    "lifestyle_guide",
    "exercise_plan",
    "recipes",
  ]);
  const PHASE_TYPES = new Set([
    "meal_plan_phase",
    "phase_meal_plan",
    "meal_plan",
  ]);

  return weeks.map((wk, idx) => {
    const earliestIso = isoDay(
      new Date(wk.dateFrom.getTime() - 14 * 86_400_000),
    );
    const latestIso = isoDay(
      new Date(wk.dateTo.getTime() + 86_400_000),
    );
    return (
      sendLog.find((e) => {
        const sentIso = e.sent_at.slice(0, 10);
        if (sentIso < earliestIso || sentIso > latestIso) return false;
        const hasPhase = e.letter_types.some((t) => PHASE_TYPES.has(t));
        if (hasPhase) return true;
        // Initial-package sends only count for fortnight 1.
        const hasInitial = e.letter_types.some((t) => INITIAL_TYPES.has(t));
        return hasInitial && idx === 0;
      }) ?? null
    );
  });
}

/** Cursor = "the next fortnight that needs action". Skip fortnights
 *  that already have a send OR a draft saved (those move forward on
 *  the Send button, not Generate). */
function deriveCursorWeek(
  sendsByWeek: (LetterSendEntry | null)[],
  draftsByWeek: (SavedPhase | null)[],
): number {
  const idx = sendsByWeek.findIndex(
    (s, i) => s == null && draftsByWeek[i] == null,
  );
  return idx === -1 ? sendsByWeek.length : idx;
}

/** Match each fortnight to a saved phase letter (or null). The phase
 *  filename pattern `<planSlug>-meal_plan-wk<start>-<end>.md` carries
 *  exact week numbers, so we match on weekStart/weekEnd intersection. */
function deriveDraftsByWeek(
  weeks: WeekCard[],
  savedPhases: SavedPhase[],
): (SavedPhase | null)[] {
  return weeks.map((wk) => {
    return (
      savedPhases.find(
        (p) =>
          !(p.endWeek < wk.weekStart || p.startWeek > wk.weekEnd),
      ) ?? null
    );
  });
}

// ───────────────────────────────────────────────────────────────────
// Map sendLog → per-doc-type status (5 docs).
// ───────────────────────────────────────────────────────────────────
type DocState = {
  kind: "sent" | "drafted" | "idle";
  pillLabel: string;
  stamp: string;
  action: string;
};

/** Doc status priority: sent (sendLog hit) > drafted (file on disk) > idle.
 *  "Drafted" means the letter exists in ~/fm-plans/clients/<id>/meal-plans/
 *  but hasn't been emailed yet. Loaded server-side via loadMealPlan probes. */
function deriveDocStates(
  sendLog: LetterSendEntry[],
  savedLetters: Partial<Record<LetterType, { savedAt: string }>>,
): DocState[] {
  return DOC_TYPES.map((d) => {
    const lastSend = sendLog
      .filter((e) => e.letter_types.includes(d.letter))
      .sort(
        (a, b) =>
          new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime(),
      )[0];
    if (lastSend) {
      return {
        kind: "sent",
        pillLabel: "Sent",
        stamp: fmtDateTime(lastSend.sent_at),
        action: "Open",
      };
    }
    const saved = savedLetters[d.letter];
    if (saved) {
      return {
        kind: "drafted",
        pillLabel: "Drafted",
        stamp: fmtDateTime(saved.savedAt),
        action: "Review",
      };
    }
    return {
      kind: "idle",
      pillLabel: "Not generated",
      stamp: "—",
      action: "Generate",
    };
  });
}

// ───────────────────────────────────────────────────────────────────
// Pick the override entry whose date window covers today.
// ───────────────────────────────────────────────────────────────────
function pickActiveOverride(
  wl: WeightLossGoal | undefined,
  today: Date,
): WeightLossWeekOverride | null {
  if (!wl || !wl.week_overrides) return null;
  for (const o of wl.week_overrides) {
    const from = parseIso(o.date_from);
    const to = parseIso(o.date_to);
    if (from && to && today >= from && today <= to) return o;
  }
  return null;
}

// ───────────────────────────────────────────────────────────────────
// Hero CTA derivation.
// ───────────────────────────────────────────────────────────────────
type HeroCfg = {
  tone: "primary" | "warning" | "secondary" | "danger";
  eyebrow: string;
  title: string;
  sub: string;
  cta: string;
  /** If set, hero CTA navigates (used for danger/recheck CTAs that go
   *  to /plan etc). Mutually exclusive with `generateMode`. */
  href?: string;
  /** If set, hero CTA opens the generation modal instead of navigating. */
  generateMode?: "initial" | "phase";
  /** Required when generateMode === "phase". */
  phase?: { startWeek: number; endWeek: number };
};

function deriveHero({
  clientId,
  displayName,
  planSlug,
  weeks,
  cursorWeek,
  sendLog,
  staleness,
  override,
  today,
  planEnd,
  consolidatedDrafted,
}: {
  clientId: string;
  displayName: string;
  planSlug: string | null;
  weeks: WeekCard[];
  cursorWeek: number;
  sendLog: LetterSendEntry[];
  staleness: { anyStale?: boolean; staleCount?: number } | null;
  override: WeightLossWeekOverride | null;
  today: Date;
  planEnd: Date | null;
  consolidatedDrafted: boolean;
}): HeroCfg {
  const first = displayName.split(" ")[0];
  const cursor = weeks[cursorWeek];

  // Staleness no longer hijacks the hero (2026-05-19 fix). The hero
  // was using `cursor.label` for the "regenerate" title which pointed at
  // an UN-generated fortnight, totally wrong — e.g. it told the coach
  // "Regenerate Wks 5-6" when Wks 5-6 didn't exist yet (the stale one
  // was consolidated, which gets surfaced separately by the dedicated
  // amber stale-letters banner above this panel via
  // `getLetterStalenessAction` + `RegenerateStaleButton`).
  //
  // Hero now always leads with the natural next action (send initial /
  // generate next phase / overdue / etc.). Staleness handling stays
  // where it makes sense: as a top-of-page banner listing the actual
  // stale letter types with one-click regeneration.

  if (planEnd && today > planEnd) {
    const overdueDays = daysBetween(planEnd, today);
    return {
      tone: "danger",
      eyebrow: `Overdue · ${overdueDays} day${overdueDays === 1 ? "" : "s"}`,
      title: `Plan ended — spin up ${first}'s next plan`,
      sub: "Weight-loss config carries over to the next plan. Use the latest measurements + check-in as the starting point.",
      cta: "Start next plan",
      href: `/clients-v2/${clientId}/plan`,
    };
  }

  if (override && planSlug && cursor) {
    return {
      tone: "secondary",
      eyebrow:
        override.mode === "maintenance"
          ? "Maintenance window"
          : override.mode === "skip"
            ? "Skip window"
            : "Deeper-deficit window",
      title:
        override.context === "travel" && override.location
          ? `Generate ${cursor.label} — ${override.mode} (${override.location})`
          : `Generate ${cursor.label} — ${override.mode} override`,
      sub: "Override is set on the Overview tab. The letter will use override calorie tables + restaurant-friendly options when traveling.",
      cta: `Generate (${override.mode})`,
      generateMode: "phase",
      phase: { startWeek: cursor.weekStart, endWeek: cursor.weekEnd },
    };
  }

  if (sendLog.length === 0 && planSlug) {
    // No emails sent yet. But — is the consolidated letter already
    // drafted on disk? If yes, skip generation and push the coach to
    // review + send via the letter editor.
    if (consolidatedDrafted) {
      return {
        tone: "primary",
        eyebrow: "Ready to send",
        title: `${first}'s initial letter is drafted`,
        sub: "Wellness letter is on disk. Review in the letter editor, then send via Send package.",
        cta: "Open in letter editor",
        href: `/clients-v2/${clientId}/letter-editor?plan=${planSlug}&type=consolidated`,
      };
    }
    return {
      tone: "primary",
      eyebrow: "Up next",
      title: `Send initial package to ${first}`,
      sub: "One Sonnet call drafts the wellness letter — supplement plan + lifestyle guide auto-extract from it. Exercise plan + recipes are optional add-ons.",
      cta: "Generate initial package",
      generateMode: "initial",
    };
  }

  if (planSlug && cursor) {
    return {
      tone: "primary",
      eyebrow: "Up next",
      title: `Generate ${cursor.label} menu`,
      sub: "Supplements + lifestyle + exercise stay locked — only the meal tables change. The last check-in + 14 days of WhatsApp fold in automatically.",
      cta: `Generate ${cursor.label}`,
      generateMode: "phase",
      phase: { startWeek: cursor.weekStart, endWeek: cursor.weekEnd },
    };
  }

  // No active plan or everything sent — fall back to a navigation CTA.
  return {
    tone: "primary",
    eyebrow: "Nothing pending",
    title: `${first}'s letters are up to date`,
    sub: "Nothing to generate right now. Use the panels below for one-off messaging.",
    cta: "Open client",
    href: `/clients-v2/${clientId}`,
  };
}

// ───────────────────────────────────────────────────────────────────
// Props.
// ───────────────────────────────────────────────────────────────────
export interface NewCommunicatePanelProps {
  clientId: string;
  displayName: string;
  client: Client;
  activePlanSlug: string | null;
  planPeriodWeeks: number;
  // js-yaml's CORE_SCHEMA can return either a string OR a Date for
  // ISO-looking values, depending on whether the YAML quoted them.
  // parseIso() handles both.
  planPeriodStart: string | Date | null;
  sendLog: LetterSendEntry[];
  staleness?: {
    anyStale?: boolean;
    staleCount?: number;
  } | null;
  /** Per-letter-type "saved on disk" probe results — drives the
   *  Drafted state on doc rows when nothing has been sent yet. */
  savedLetters?: Partial<Record<LetterType, { savedAt: string }>>;
  /** Per-fortnight phase letters saved on disk — drives Drafted state
   *  on weekly menu cards. */
  savedPhases?: SavedPhase[];
  /** Rendered immediately AFTER the big orange hero CTA. Used to slot the
   *  travel-overrides panel right under the hero so it's seen, not
   *  missed above it (coach feedback 2026-05-20). */
  slotAfterHero?: React.ReactNode;
}

// ───────────────────────────────────────────────────────────────────
// Component.
// ───────────────────────────────────────────────────────────────────
export function NewCommunicatePanel({
  clientId,
  displayName,
  client,
  activePlanSlug,
  planPeriodWeeks,
  planPeriodStart,
  sendLog,
  staleness,
  savedLetters = {},
  savedPhases = [],
  slotAfterHero,
}: NewCommunicatePanelProps) {
  const today = new Date();
  const startDate =
    parseIso(planPeriodStart) ??
    parseIso((client as unknown as { intake_date?: string }).intake_date) ??
    today;
  const planEnd = new Date(
    startDate.getTime() + planPeriodWeeks * 7 * 86_400_000,
  );

  const weeks = buildFortnights(startDate, planPeriodWeeks);
  const todayIso = isoDay(today);

  // Match each fortnight to a real send (or null).
  const sendsByWeek = deriveSendsByWeek(weeks, sendLog);
  // Match each fortnight to a saved phase letter on disk (or null).
  const draftsByWeek = deriveDraftsByWeek(weeks, savedPhases);

  // Cursor = the next fortnight that needs action (first one with
  // neither a send nor a draft). If everything is already drafted or
  // sent, derivedCursor === weeks.length → no cursor.
  const derivedCursor = deriveCursorWeek(sendsByWeek, draftsByWeek);
  const cursorWeek =
    derivedCursor < weeks.length ? derivedCursor : -1;

  const currentWeekNum =
    Math.min(planPeriodWeeks, Math.max(1, Math.ceil((daysBetween(startDate, today) + 1) / 7)));

  const wl = (client as unknown as { weight_loss?: WeightLossGoal })
    .weight_loss;
  const override = pickActiveOverride(wl, today);

  const weekStates = deriveWeekStates(
    weeks,
    sendsByWeek,
    draftsByWeek,
    override,
    todayIso,
    cursorWeek,
  );
  const docStates = deriveDocStates(sendLog, savedLetters);

  // 🎯 Selected fortnight — drives the Letters & guides panel.
  // Default priority (2026-05-19 coach feedback "highlight current
  // active letters by default"):
  //   1. Fortnight containing TODAY → coach sees what's live right now.
  //   2. If today falls before the plan starts → fortnight 0.
  //   3. If today is past the plan window → last fortnight.
  //   4. Cursor as last fallback (shouldn't be needed given 1-3).
  const defaultFortnight = (() => {
    const idx = weeks.findIndex(
      (w) => todayIso >= isoDay(w.dateFrom) && todayIso <= isoDay(w.dateTo),
    );
    if (idx !== -1) return idx;
    // Today is outside any fortnight window.
    if (weeks.length === 0) return 0;
    if (todayIso < isoDay(weeks[0].dateFrom)) return 0;
    if (todayIso > isoDay(weeks[weeks.length - 1].dateTo)) {
      return weeks.length - 1;
    }
    return cursorWeek >= 0 ? cursorWeek : 0;
  })();
  const [selectedFortnight, setSelectedFortnight] = useState<number>(
    defaultFortnight,
  );
  const selWk = weeks[selectedFortnight];
  const selDraft = draftsByWeek[selectedFortnight] ?? null;
  const selSend = sendsByWeek[selectedFortnight] ?? null;
  const hero = deriveHero({
    clientId,
    displayName,
    planSlug: activePlanSlug,
    weeks,
    cursorWeek,
    sendLog,
    staleness: staleness ?? null,
    override,
    today,
    planEnd,
    consolidatedDrafted: !!savedLetters["consolidated"],
  });

  return (
    <div
      className="fm-v2"
      style={{
        marginBottom: 24,
        padding: "16px 18px 4px",
        background: "var(--fm-bg-warm, #FAF8F4)",
        border: "1px dashed var(--fm-border-strong, #D9D4CC)",
        borderRadius: 14,
      }}
    >
      {/* Week indicator — kept as a small marker; dropped the "preview"
          eyebrow per UI audit 2026-05-20 (the layout is no longer a preview). */}
      <div
        style={{
          textAlign: "right",
          marginBottom: 14,
          fontSize: 11,
          color: "var(--fm-text-3, #999)",
          letterSpacing: 0.3,
          textTransform: "uppercase",
          fontWeight: 700,
          fontFamily: "var(--fm-font-mono, monospace)",
        }}
      >
        week {currentWeekNum} of {planPeriodWeeks}
      </div>

      {/* Hero CTA */}
      <div className={`hero ${hero.tone === "primary" ? "" : `hero--${hero.tone}`}`}>
        <div className="hero-body">
          <div className="hero-eyebrow">
            <span className="dot" />
            {hero.eyebrow}
          </div>
          <h2 className="hero-title">{hero.title}</h2>
          <p className="hero-sub">{hero.sub}</p>
        </div>
        {hero.generateMode && activePlanSlug ? (
          <LetterGenerateTrigger
            clientId={clientId}
            planSlug={activePlanSlug}
            mode={hero.generateMode}
            label={hero.cta}
            tone={hero.tone}
            phase={hero.phase}
          />
        ) : hero.href ? (
          <a href={hero.href} className="hero-cta" style={{ textDecoration: "none" }}>
            {hero.cta}
            <span className="chev">→</span>
          </a>
        ) : (
          <button className="hero-cta" disabled>
            {hero.cta}
            <span className="chev">→</span>
          </button>
        )}
      </div>

      {/* Slot right under the hero — travel-overrides panel lives here so
          it's seen after the big orange CTA, not missed above it. */}
      {slotAfterHero && (
        <div style={{ marginTop: 14 }}>{slotAfterHero}</div>
      )}

      {/* WL config readout */}
      {wl?.enabled && (
        <div className="wl-ctx" style={{ marginTop: 14 }}>
          <div className="label">
            <span className="dot" /> Using weight loss config
          </div>
          <div>
            <strong>
              {wl.goal_kg} kg by{" "}
              {parseIso(wl.goal_target_date)?.toLocaleDateString("en-IN", {
                day: "2-digit",
                month: "short",
              }) ?? wl.goal_target_date}
            </strong>{" "}
            <span className="sep">·</span> {wl.pace} pace
          </div>
          {override && (
            <>
              <span className="sep">·</span>
              <span className="override-tag">
                {override.mode}
                {override.context === "travel" && override.location
                  ? ` (${override.location})`
                  : ""}
              </span>
            </>
          )}
          <a className="right" href={`/clients-v2/${clientId}`}>
            Edit on Overview ↗
          </a>
        </div>
      )}

      {/* Main 2-col body */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 320px",
          gap: 24,
          marginTop: 18,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {/* Weekly menus track */}
          <section className="FmPanel FmPanel--flush">
            <header className="FmPanel-head">
              <div>
                <div className="FmPanel-eyebrow">
                  AXIS B · Weekly menus · fortnightly
                </div>
                <h2 className="FmPanel-title">Meal-plan rollout</h2>
              </div>
            </header>
            <div style={{ padding: "8px 22px 20px" }}>
              <div className="wk-track">
                {weeks.map((wk, i) => {
                  const st = weekStates[i];
                  const isCursor = cursorWeek === i;
                  const isSelected = selectedFortnight === i;
                  return (
                    <button
                      key={wk.index}
                      type="button"
                      onClick={() => setSelectedFortnight(i)}
                      className="wk-card"
                      data-state={st.kind}
                      data-cursor={isCursor ? 1 : 0}
                      data-selected={isSelected ? 1 : 0}
                      // Buttons need explicit reset for native chrome to
                      // not bleed into the wk-card design.
                      style={{
                        textAlign: "left",
                        font: "inherit",
                        color: "inherit",
                        cursor: "pointer",
                        outline: isSelected
                          ? "2px solid var(--fm-primary, #FF6B35)"
                          : "none",
                        outlineOffset: 2,
                      }}
                    >
                      {isCursor && <span className="wk-card-cursor">Up next</span>}
                      <div className="wk-card-head">
                        <span className="wk-card-num">{i + 1}</span>
                        <div>
                          <div className="wk-card-title">{wk.label}</div>
                          <div className="wk-card-dates">{wk.dates}</div>
                        </div>
                      </div>
                      <div>
                        <span className={`pill pill--${st.kind}`}>
                          <span className="dot" />
                          {st.pillLabel}
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--fm-text-2, #5A5A5A)",
                          lineHeight: 1.45,
                        }}
                      >
                        {st.note}
                      </div>
                      {isSelected && (
                        <div
                          style={{
                            fontSize: 10,
                            fontWeight: 800,
                            letterSpacing: 0.6,
                            textTransform: "uppercase",
                            color: "var(--fm-primary, #FF6B35)",
                            marginTop: "auto",
                          }}
                        >
                          ▼ Showing letters below
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          {/* Letters & guides */}
          <section className="FmPanel FmPanel--flush">
            <header className="FmPanel-head">
              <div>
                <div className="FmPanel-eyebrow">
                  AXIS A · Letters for {selWk?.label ?? "this plan"}
                </div>
                <h2 className="FmPanel-title">
                  Letters &amp; guides
                  {selWk && (
                    <span
                      style={{
                        marginLeft: 8,
                        fontSize: 12,
                        fontWeight: 600,
                        color: "var(--fm-primary, #FF6B35)",
                      }}
                    >
                      · {selWk.label} ({selWk.dates})
                    </span>
                  )}
                </h2>
              </div>
              <div className="FmPanel-sub">
                {selectedFortnight === 0
                  ? "Initial package — the Full wellness letter is the core document (supplement + lifestyle are sections of it). Exercise plan + recipes are optional."
                  : "Phase letter for this fortnight + standing documents from initial package"}
              </div>
            </header>

            {selectedFortnight !== 0 && (
              <>
                {/* Phase meal-plan card for the selected fortnight */}
                {(() => {
                  const phaseHref = activePlanSlug
                    ? `/clients-v2/${clientId}/letter-editor?plan=${activePlanSlug}&type=meal_plan_phase&phase_start=${selWk?.weekStart}&phase_end=${selWk?.weekEnd}`
                    : null;
                  const phaseKind = selSend
                    ? "sent"
                    : selDraft
                      ? "drafted"
                      : "idle";
                  const phasePill = selSend
                    ? "Sent"
                    : selDraft
                      ? "Drafted"
                      : "Not generated";
                  const phaseStamp = selSend
                    ? fmtDateTime(selSend.sent_at)
                    : selDraft
                      ? fmtDateTime(selDraft.savedAt)
                      : "—";
                  return (
                    <div className="doc-list">
                      <div className="doc-row" data-state={phaseKind}>
                        <span className="doc-icon">M</span>
                        <div>
                          <div className="doc-title">
                            Meal plan · {selWk?.label}
                          </div>
                          <div className="doc-sub">
                            Fortnight-specific meal tables for {selWk?.dates}. Supplements + lifestyle stay locked.
                          </div>
                        </div>
                        <span className={`pill pill--${phaseKind}`}>
                          <span className="dot" />
                          {phasePill}
                        </span>
                        <div className="doc-stamp">{phaseStamp}</div>
                        <div className="doc-actions">
                          {phaseKind === "idle" ? (
                            activePlanSlug && selWk ? (
                              <LetterGenerateTrigger
                                clientId={clientId}
                                planSlug={activePlanSlug}
                                mode="phase"
                                label="Generate"
                                tone="primary"
                                phase={{
                                  startWeek: selWk.weekStart,
                                  endWeek: selWk.weekEnd,
                                }}
                              />
                            ) : (
                              <span
                                className="FmBtn FmBtn--sm"
                                style={{ opacity: 0.55, pointerEvents: "none" }}
                              >
                                Generate
                              </span>
                            )
                          ) : phaseHref ? (
                            <a
                              href={phaseHref}
                              className="FmBtn FmBtn--sm"
                              style={{
                                textDecoration: "none",
                                display: "inline-block",
                                padding: "5px 11px",
                                borderRadius: 6,
                                background:
                                  phaseKind === "sent"
                                    ? "rgba(16, 185, 129, 0.15)"
                                    : "var(--fm-primary, #FF6B35)",
                                color: phaseKind === "sent" ? "#047857" : "#fff",
                                fontSize: 12,
                                fontWeight: 700,
                              }}
                            >
                              {phaseKind === "sent" ? "Open" : "Review"} →
                            </a>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Initial-package standing documents — read-only links */}
                <div
                  style={{
                    margin: "10px 22px 18px",
                    padding: "10px 12px",
                    background: "var(--fm-bg-warm, #FAF8F4)",
                    border: "1px dashed var(--fm-border-light, #E5E2DD)",
                    borderRadius: 8,
                    fontSize: 12,
                    color: "var(--fm-text-2, #5A5A5A)",
                    lineHeight: 1.55,
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      letterSpacing: 0.6,
                      textTransform: "uppercase",
                      color: "var(--fm-text-3, #999)",
                      marginBottom: 6,
                    }}
                  >
                    Still applies from initial package
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 6,
                      alignItems: "center",
                    }}
                  >
                    {(["supplement_plan", "lifestyle_guide", "exercise_plan"] as const).map(
                      (t) => {
                        const saved = savedLetters[t];
                        if (!saved && !sendLog.some((e) => e.letter_types.includes(t)))
                          return null;
                        const href = activePlanSlug
                          ? `/clients-v2/${clientId}/letter-editor?plan=${activePlanSlug}&type=${t}`
                          : null;
                        const label =
                          t === "supplement_plan"
                            ? "Supplement plan"
                            : t === "lifestyle_guide"
                              ? "Lifestyle guide"
                              : "Exercise plan";
                        return href ? (
                          <a
                            key={t}
                            href={href}
                            style={{
                              fontSize: 11,
                              padding: "3px 9px",
                              background: "var(--fm-surface, #fff)",
                              border: "1px solid var(--fm-border, #E5E2DD)",
                              borderRadius: 999,
                              color: "var(--fm-text-secondary, #5A5A5A)",
                              textDecoration: "none",
                              fontWeight: 600,
                            }}
                          >
                            {label} ↗
                          </a>
                        ) : null;
                      },
                    )}
                  </div>
                </div>
              </>
            )}

            {selectedFortnight === 0 && (
            <div className="doc-list">
              {DOC_TYPES.map((d, i) => {
                const st = docStates[i];
                // For sent/drafted rows → link straight to the letter-
                // editor pre-loaded with this letter type. For idle
                // rows → coach must use the hero CTA (initial package)
                // or the LetterGenerateTrigger inline below.
                const editorHref = activePlanSlug
                  ? `/clients-v2/${clientId}/letter-editor?plan=${activePlanSlug}&type=${d.letter}`
                  : null;
                return (
                  <div key={d.id} className="doc-row" data-state={st.kind}>
                    <span className="doc-icon">{DOC_ICON[d.kind]}</span>
                    <div>
                      <div className="doc-title">{d.label}</div>
                      <div className="doc-sub">{d.desc}</div>
                    </div>
                    <span className={`pill pill--${st.kind}`}>
                      <span className="dot" />
                      {st.pillLabel}
                    </span>
                    <div className="doc-stamp">{st.stamp}</div>
                    <div className="doc-actions">
                      {st.kind === "idle" ? (
                        !activePlanSlug ? (
                          <span
                            className="FmBtn FmBtn--sm"
                            style={{ opacity: 0.55, pointerEvents: "none" }}
                          >
                            {st.action}
                          </span>
                        ) : d.standalone ? (
                          // Standalone letter type — generate just this
                          // one document via mode="single". One AI call,
                          // generates exactly d.letter (not a meal plan).
                          <LetterGenerateTrigger
                            clientId={clientId}
                            planSlug={activePlanSlug}
                            mode="single"
                            letterType={d.letter}
                            letterLabel={d.label}
                            label="Generate"
                            tone="primary"
                          />
                        ) : (
                          // Supplement / lifestyle — these are SECTIONS of
                          // the consolidated wellness letter, not separate
                          // generations. Generating the wellness letter
                          // produces them. No standalone Generate button.
                          <span
                            title="This is part of the Full wellness letter — generate that and this is included."
                            style={{
                              fontSize: 11,
                              color: "var(--fm-text-tertiary, #999)",
                              fontStyle: "italic",
                              whiteSpace: "nowrap",
                            }}
                          >
                            In wellness letter
                          </span>
                        )
                      ) : editorHref ? (
                        <a
                          href={editorHref}
                          className="FmBtn FmBtn--sm"
                          style={{
                            textDecoration: "none",
                            display: "inline-block",
                            padding: "5px 11px",
                            borderRadius: 6,
                            background:
                              st.kind === "sent"
                                ? "rgba(16, 185, 129, 0.15)"
                                : "var(--fm-primary, #FF6B35)",
                            color:
                              st.kind === "sent"
                                ? "#047857"
                                : "#fff",
                            fontSize: 12,
                            fontWeight: 700,
                          }}
                        >
                          {st.action} →
                        </a>
                      ) : (
                        <span
                          className="FmBtn FmBtn--sm"
                          style={{ opacity: 0.55, pointerEvents: "none" }}
                        >
                          {st.action}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            )}
          </section>

          {/* "Special requests + travel" dead stub removed 2026-05-20 —
              it was a never-wired Phase-3b placeholder, redundant with the
              real TravelOverridesPanel (now slotted right under the hero). */}
        </div>

        {/* Send history sidebar */}
        <section
          className="FmPanel FmPanel--flush"
          style={{ alignSelf: "start", position: "sticky", top: 16 }}
        >
          <header className="FmPanel-head">
            <div>
              <div className="FmPanel-eyebrow">History</div>
              <h2 className="FmPanel-title">Send log</h2>
            </div>
          </header>
          <div style={{ padding: "4px 22px 18px" }}>
            {sendLog.length === 0 ? (
              <div
                style={{
                  fontSize: 12,
                  color: "var(--fm-text-3, #999)",
                  padding: "12px 0",
                }}
              >
                No letters sent yet.
              </div>
            ) : (
              sendLog.slice(0, 8).map((e, i) => (
                <div key={`${e.sent_at}-${i}`} className="sh-row">
                  <span className="marker" />
                  <div>
                    <div className="sh-line">
                      Letter sent
                      {e.letter_types.length > 0 && (
                        <span className="secondary">
                          {" · "}
                          {e.letter_types
                            .slice(0, 2)
                            .map((t) => t.replace(/_/g, " "))
                            .join(", ")}
                          {e.letter_types.length > 2
                            ? ` +${e.letter_types.length - 2}`
                            : ""}
                        </span>
                      )}
                    </div>
                    <div className="sh-when">{fmtDateTime(e.sent_at)}</div>
                  </div>
                  <div className="sh-medium">Email</div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
