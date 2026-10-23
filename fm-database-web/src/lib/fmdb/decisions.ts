/**
 * decisions.ts — the inbox: every item on the coach dashboard, with the rule
 * that makes it disappear.
 *
 * Replaces the 13 triage buckets + 16 independent "due" clocks that used to
 * run on dashboard-v2 (docs/COACH_APP_RESTRUCTURE_REVIEW.md §3). The rules
 * here are pure: they take rows the existing loaders already produce plus the
 * lifecycle index, and decide which rows are decisions TODAY. Nothing in this
 * file reads disk, so it is unit-testable against roster-shaped fixtures.
 *
 * Two invariants every rule obeys:
 *
 *  1. It applies to named lifecycle states only. A lapsed client never gets a
 *     renewal item; a maintenance client never gets a session item (there is
 *     no session item at all — the coach does not auto-chase clients, decision
 *     2026-10-23); a prospect never gets a win-back.
 *  2. It has an exit. Either the underlying store changes (approved, decided,
 *     replied) or an age cap passes. Nothing may sit on the inbox forever.
 */

import { type Lifecycle, type LifecycleState, PROSPECT_FOLLOWUP_DAYS, LAPSED_WINBACK_DAYS } from "./lifecycle";

/** Days a prospect's follow-up draft may wait before it is dropped. */
export const FOLLOWUP_DRAFT_MAX_AGE_DAYS = PROSPECT_FOLLOWUP_DAYS + 5; // 35
/** Days after the last follow-up touch a prospect stays listed at all. */
export const PROSPECT_LISTED_DAYS = 45;
/** Days a lapsed client's win-back draft may wait. */
export const WINBACK_DRAFT_MAX_AGE_DAYS = LAPSED_WINBACK_DAYS + 14; // 70
/** Days an unanswered client message stays an item. */
export const MESSAGE_MAX_AGE_DAYS = 7;
/** Days a weight plateau / regression flag stays an item. */
export const FLAG_MAX_AGE_DAYS = 14;
/** Days a feedback response stays on the inbox after it lands. */
export const FEEDBACK_LISTED_DAYS = 14;

export type DecisionKind =
  | "message"
  | "renewal"
  | "onboarding"
  | "followup"
  | "winback"
  | "note"
  | "flag"
  | "feedback"
  | "archive";

export interface DecisionItem {
  kind: DecisionKind;
  clientId: string;
  name: string;
  state: LifecycleState;
  /** One line: why this is on the inbox today. */
  why: string;
  /** Where to act. */
  href: string;
  /** Days this item has been waiting (0 = new today). */
  ageDays: number;
  /** Days until the age cap drops it, or null when only an action clears it. */
  expiresInDays: number | null;
}

export interface DecisionCounts {
  total: number;
  byKind: Record<DecisionKind, number>;
}

// ── inputs (the shapes the existing loaders already return) ────────────────

export interface InboundLike {
  client_id: string;
  display_name?: string;
  date: string;
  created_at?: string;
  text: string;
}
export interface RenewalLike {
  clientId: string;
  clientName: string;
  planSlug: string;
  endsOn: string;
  daysLeft: number;
  decision: string | null;
}
export interface FollowupDraftLike {
  clientId: string;
  clientName: string;
  callDate: string;
  daysSinceCall: number;
  touch: number;
}
export interface FollowupScheduledLike {
  clientId: string;
  clientName: string;
  daysSinceCall: number;
  nextDueOn: string | null;
  status: string;
}
export interface FollowupUnanchoredLike {
  clientId: string;
  clientName: string;
  triagePaidOn: string | null;
}
export interface WinbackDraftLike {
  clientId: string;
  clientName: string;
  daysSinceEnd: number;
  touch: number;
}
export interface WinbackScheduledLike {
  clientId: string;
  clientName: string;
  daysSinceEnd: number;
}
export interface NoteLike {
  clientId: string;
  name: string;
  pendingNote: unknown | null;
  lastActivityOn: string | null;
}
export interface FlagLike {
  client_id: string;
  display_name: string;
  latestDate: string;
}
export interface FeedbackLike {
  client_id: string;
  display_name: string;
  stage: string;
  answered_on: string;
}
export interface ArchiveLike {
  client_id: string;
  display_name: string;
  category: string;
  daysInactive: number;
  reason: string;
}

export interface DecisionInputs {
  todayYmd: string;
  lifecycle: ReadonlyMap<string, Lifecycle>;
  nameOf: (clientId: string) => string;
  inbound: readonly InboundLike[];
  /** Client ids whose newest inbound message already has a coach reply after it. */
  repliedTo: ReadonlySet<string>;
  renewals: readonly RenewalLike[];
  followupDrafts: readonly FollowupDraftLike[];
  followupScheduled: readonly FollowupScheduledLike[];
  followupUnanchored: readonly FollowupUnanchoredLike[];
  winbackDrafts: readonly WinbackDraftLike[];
  winbackScheduled: readonly WinbackScheduledLike[];
  notes: readonly NoteLike[];
  plateaued: readonly FlagLike[];
  regressed: readonly FlagLike[];
  feedback: readonly FeedbackLike[];
  archiveCandidates: readonly ArchiveLike[];
  /** Onboarding detail, by client id: what is missing. */
  onboardingStep: ReadonlyMap<string, { why: string; href: string; sinceYmd: string | null }>;
}

export interface DecisionFilters {
  /** Rows the panels should render — the inputs filtered by the same rules. */
  renewals: RenewalLike[];
  followupDrafts: FollowupDraftLike[];
  followupScheduled: FollowupScheduledLike[];
  followupUnanchored: FollowupUnanchoredLike[];
  winbackDrafts: WinbackDraftLike[];
  winbackScheduled: WinbackScheduledLike[];
  noteClientIds: Set<string>;
  archiveCandidates: ArchiveLike[];
}

export interface Decisions {
  items: DecisionItem[];
  counts: DecisionCounts;
  filtered: DecisionFilters;
}

const daysBetween = (fromYmd: string, toYmd: string): number =>
  Math.round(
    (Date.parse(`${toYmd.slice(0, 10)}T00:00:00Z`) - Date.parse(`${fromYmd.slice(0, 10)}T00:00:00Z`)) /
      86_400_000,
  );

const emptyCounts = (): Record<DecisionKind, number> => ({
  message: 0,
  renewal: 0,
  onboarding: 0,
  followup: 0,
  winback: 0,
  note: 0,
  flag: 0,
  feedback: 0,
  archive: 0,
});

/** Who may receive which kind of item. The matrix from the review doc. */
export const KIND_STATES: Record<DecisionKind, ReadonlySet<LifecycleState>> = {
  message: new Set(["prospect", "onboarding", "active", "ending", "maintenance", "lapsed"]),
  renewal: new Set(["ending"]),
  onboarding: new Set(["onboarding"]),
  followup: new Set(["prospect"]),
  winback: new Set(["lapsed"]),
  note: new Set(["prospect"]),
  flag: new Set(["active", "ending", "maintenance"]),
  feedback: new Set(["active", "ending", "maintenance", "lapsed"]),
  archive: new Set(["prospect", "lapsed"]),
};

export function collectDecisions(input: DecisionInputs): Decisions {
  const { todayYmd, lifecycle } = input;
  const items: DecisionItem[] = [];
  const stateOf = (id: string): LifecycleState | null => lifecycle.get(id)?.state ?? null;
  const allowed = (kind: DecisionKind, id: string): LifecycleState | null => {
    const s = stateOf(id);
    return s && KIND_STATES[kind].has(s) ? s : null;
  };
  const filtered: DecisionFilters = {
    renewals: [],
    followupDrafts: [],
    followupScheduled: [],
    followupUnanchored: [],
    winbackDrafts: [],
    winbackScheduled: [],
    noteClientIds: new Set(),
    archiveCandidates: [],
  };

  // 1. Messages — newest unanswered inbound per person, ≤7 days old.
  const newestInbound = new Map<string, InboundLike>();
  for (const m of input.inbound) {
    const prev = newestInbound.get(m.client_id);
    const key = m.created_at ?? m.date;
    if (!prev || key > (prev.created_at ?? prev.date)) newestInbound.set(m.client_id, m);
  }
  for (const [id, m] of newestInbound) {
    if (input.repliedTo.has(id)) continue;
    const s = allowed("message", id);
    if (!s) continue;
    const age = daysBetween(m.date, todayYmd);
    if (age > MESSAGE_MAX_AGE_DAYS) continue;
    items.push({
      kind: "message",
      clientId: id,
      name: m.display_name ?? input.nameOf(id),
      state: s,
      why: m.text.length > 90 ? `${m.text.slice(0, 90)}…` : m.text,
      href: `/clients-v2/${id}/communicate`,
      ageDays: age,
      expiresInDays: MESSAGE_MAX_AGE_DAYS - age,
    });
  }

  // 2. Renewal decision — ending state only; the queue is already window-bounded.
  for (const r of input.renewals) {
    if (r.decision) continue;
    const s = allowed("renewal", r.clientId);
    if (!s) continue;
    filtered.renewals.push(r);
    items.push({
      kind: "renewal",
      clientId: r.clientId,
      name: r.clientName,
      state: s,
      why:
        r.daysLeft < 0
          ? `plan ended ${-r.daysLeft}d ago — decide continue / maintenance / letter / not renewing`
          : `plan ends in ${r.daysLeft}d — decide continue / maintenance / letter / not renewing`,
      href: `/clients-v2/${r.clientId}/plan`,
      ageDays: Math.max(0, 15 - r.daysLeft),
      expiresInDays: null,
    });
  }

  // 3. Onboarding — signed up, something missing. Exits when a plan starts.
  for (const [id, l] of lifecycle) {
    if (l.state !== "onboarding") continue;
    const step = input.onboardingStep.get(id);
    if (!step) continue;
    const age = step.sinceYmd ? Math.max(0, daysBetween(step.sinceYmd, todayYmd)) : 0;
    items.push({
      kind: "onboarding",
      clientId: id,
      name: input.nameOf(id),
      state: "onboarding",
      why: step.why,
      href: step.href,
      ageDays: age,
      expiresInDays: null,
    });
  }

  // 4. Prospect follow-up drafts — ≤35 days after the call; listed ≤45 days.
  for (const d of input.followupDrafts) {
    const s = allowed("followup", d.clientId);
    if (!s) continue;
    if (d.daysSinceCall > FOLLOWUP_DRAFT_MAX_AGE_DAYS) continue;
    filtered.followupDrafts.push(d);
    items.push({
      kind: "followup",
      clientId: d.clientId,
      name: d.clientName,
      state: s,
      why: `follow-up ${d.touch} drafted — approve, edit or stop`,
      href: "/dashboard-v2#followups",
      ageDays: d.daysSinceCall,
      expiresInDays: FOLLOWUP_DRAFT_MAX_AGE_DAYS - d.daysSinceCall,
    });
  }
  for (const r of input.followupScheduled) {
    if (!allowed("followup", r.clientId)) continue;
    if (r.daysSinceCall > PROSPECT_LISTED_DAYS) continue;
    if (!r.nextDueOn) continue; // sequence finished or stopped: nothing to wait for
    filtered.followupScheduled.push(r);
  }
  for (const u of input.followupUnanchored) {
    if (!allowed("followup", u.clientId)) continue;
    const l = lifecycle.get(u.clientId);
    const since = u.triagePaidOn ?? l?.since ?? null;
    if (since && daysBetween(since, todayYmd) > PROSPECT_LISTED_DAYS) continue;
    filtered.followupUnanchored.push(u);
  }

  // 5. Win-back drafts — lapsed only, ≤70 days after the plan ended.
  for (const d of input.winbackDrafts) {
    const s = allowed("winback", d.clientId);
    if (!s) continue;
    if (d.daysSinceEnd > WINBACK_DRAFT_MAX_AGE_DAYS) continue;
    filtered.winbackDrafts.push(d);
    items.push({
      kind: "winback",
      clientId: d.clientId,
      name: d.clientName,
      state: s,
      why: `win-back ${d.touch} drafted — approve or skip`,
      href: "/dashboard-v2#winback",
      ageDays: d.daysSinceEnd,
      expiresInDays: WINBACK_DRAFT_MAX_AGE_DAYS - d.daysSinceEnd,
    });
  }
  for (const r of input.winbackScheduled) {
    if (!allowed("winback", r.clientId)) continue;
    if (r.daysSinceEnd > LAPSED_WINBACK_DAYS) continue;
    filtered.winbackScheduled.push(r);
  }

  // 6. "Thought of you" notes — prospects only, one pending note at a time.
  for (const n of input.notes) {
    const s = allowed("note", n.clientId);
    if (!s) continue;
    filtered.noteClientIds.add(n.clientId);
    if (!n.pendingNote) continue;
    const age = n.lastActivityOn ? Math.max(0, daysBetween(n.lastActivityOn, todayYmd)) : 0;
    items.push({
      kind: "note",
      clientId: n.clientId,
      name: n.name,
      state: s,
      why: "a note with a matching video or guide is drafted — approve or skip",
      href: "/dashboard-v2#interested",
      ageDays: age,
      expiresInDays: null,
    });
  }

  // 7. Flags — plateau / regression for people in care, ≤14 days after the reading.
  const flag = (rows: readonly FlagLike[], why: (f: FlagLike) => string) => {
    for (const f of rows) {
      const s = allowed("flag", f.client_id);
      if (!s) continue;
      const age = Math.max(0, daysBetween(f.latestDate, todayYmd));
      if (age > FLAG_MAX_AGE_DAYS) continue;
      items.push({
        kind: "flag",
        clientId: f.client_id,
        name: f.display_name,
        state: s,
        why: why(f),
        href: `/clients-v2/${f.client_id}`,
        ageDays: age,
        expiresInDays: FLAG_MAX_AGE_DAYS - age,
      });
    }
  };
  flag(input.regressed, () => "weight above starting weight");
  flag(input.plateaued, () => "weight plateaued across the last 3 readings");

  // 8. Feedback received — ≤14 days after it landed.
  for (const f of input.feedback) {
    const s = allowed("feedback", f.client_id);
    if (!s) continue;
    const age = Math.max(0, daysBetween(f.answered_on, todayYmd));
    if (age > FEEDBACK_LISTED_DAYS) continue;
    items.push({
      kind: "feedback",
      clientId: f.client_id,
      name: f.display_name,
      state: s,
      why: `${f.stage} feedback came in — read it`,
      href: "/dashboard-v2#feedback",
      ageDays: age,
      expiresInDays: FEEDBACK_LISTED_DAYS - age,
    });
  }

  // 9. Archive — prospects quiet > 45d, lapsed quiet > 70d (the candidate
  //    scanner's own 21-day floor applies first).
  for (const a of input.archiveCandidates) {
    const s = allowed("archive", a.client_id);
    if (!s) continue;
    const floor = s === "lapsed" ? WINBACK_DRAFT_MAX_AGE_DAYS : PROSPECT_LISTED_DAYS;
    if (a.daysInactive < floor) continue;
    filtered.archiveCandidates.push(a);
    items.push({
      kind: "archive",
      clientId: a.client_id,
      name: a.display_name,
      state: s,
      why: a.reason,
      href: "/dashboard-v2#archive",
      ageDays: a.daysInactive,
      expiresInDays: null,
    });
  }

  const byKind = emptyCounts();
  for (const it of items) byKind[it.kind] += 1;
  return { items, counts: { total: items.length, byKind }, filtered };
}

/** Section order + copy for the inbox page and the digest. */
export const KIND_META: Record<DecisionKind, { label: string; icon: string; blurb: string }> = {
  message: { label: "Messages waiting", icon: "💬", blurb: "Someone wrote and has not heard back." },
  renewal: { label: "Renewal decisions", icon: "📩", blurb: "A plan is ending. Decide what comes next." },
  onboarding: { label: "Onboarding", icon: "🌱", blurb: "Paid, and something is still missing." },
  followup: { label: "Call follow-ups", icon: "🌿", blurb: "Prospects, drafts ready to approve." },
  winback: { label: "Win-back", icon: "✉️", blurb: "Lapsed clients, drafts ready to approve." },
  note: { label: "Thought of you", icon: "💡", blurb: "A video or guide that suits a prospect." },
  flag: { label: "Flags", icon: "🔔", blurb: "Something in the data stands out." },
  feedback: { label: "Feedback", icon: "⭐", blurb: "A client graded the programme." },
  archive: { label: "Archive", icon: "🗄", blurb: "Quiet for long enough to tidy away." },
};

export const KIND_ORDER: DecisionKind[] = [
  "message",
  "renewal",
  "onboarding",
  "followup",
  "winback",
  "note",
  "flag",
  "feedback",
  "archive",
];
