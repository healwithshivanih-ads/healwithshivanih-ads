/**
 * Practice overview — the cross-client MIS model for the dashboard (Phase 3).
 *
 * PURE: takes data the dashboard has already loaded (lifecycle buckets,
 * dormant/plateau/regression sets, published-plan set, client conditions) and
 * derives three management views — client status, pipeline, composition. No
 * fs, no new scans; it just re-shapes signals the page already computed.
 *
 * The "on track" rule is intentionally composed from signals that exist today:
 *   - engagement   (dormant → no contact in 14d)
 *   - body trend   (regressed / plateaued weight)
 *   - lifecycle    (recheck overdue, review overdue, follow-up due, labs pending)
 * Adherence (weekly polls) and MSQ trajectory fold in as inputs once that data
 * accrues — see attachAdherence / MSQ trajectory TODOs. Until then the band is
 * honest about what it knows: a client with no negative signal is "on track",
 * not "verified improving".
 */

export interface StatusEntry {
  clientId: string;
  name: string;
  why: string;
}

export interface PracticeOverview {
  /** Clients in active care (have a published plan). */
  activeCare: number;
  onTrack: number;
  watch: number;
  stalled: number;
  onTrackPct: number | null;
  /** Amber/red clients (the exceptions worth clicking), capped + name-resolved. */
  watchList: StatusEntry[];
  stalledList: StatusEntry[];
  /** Lifecycle funnel — every non-declined client lands in exactly one stage. */
  pipeline: { prospect: number; onboarding: number; active: number };
  /** Most common active conditions across the whole roster. */
  composition: { label: string; count: number }[];
}

interface OverviewInput {
  clients: {
    client_id: string;
    display_name?: string;
    active_conditions?: string[];
    engagement_status?: string;
  }[];
  /** client_id → its single triage bucket kind (from `grouped`). */
  bucketOf: Map<string, string>;
  /** client_ids that have at least one published plan. */
  publishedPlanIds: Set<string>;
  dormantIds: Set<string>;
  plateauedIds: Set<string>;
  regressedIds: Set<string>;
}

const EXCEPTION_CAP = 8;
const COMPOSITION_CAP = 6;

const AMBER_BUCKETS = new Set([
  "protocol_complete", // recheck overdue
  "plan_review_due",
  "follow_up_due",
  "labs_pending",
]);

const PROSPECT_BUCKETS = new Set(["new_lead", "returning", "awaiting_signup", "booking_link_pending"]);
const ONBOARDING_BUCKETS = new Set(["intake_to_do", "plan_to_build"]);
const ACTIVE_BUCKETS = new Set([
  "active",
  "protocol_complete",
  "phase_letter_due",
  "plan_review_due",
  "follow_up_due",
  "labs_pending",
]);

export function computePracticeOverview(input: OverviewInput): PracticeOverview {
  const { clients, bucketOf, publishedPlanIds, dormantIds, plateauedIds, regressedIds } = input;
  const nameOf = (id: string) => clients.find((c) => c.client_id === id)?.display_name || id;

  // ── Client status (active-care clients only) ──────────────────────────────
  let onTrack = 0;
  const watchList: StatusEntry[] = [];
  const stalledList: StatusEntry[] = [];
  const activeCareClients = clients.filter((c) => publishedPlanIds.has(c.client_id));

  for (const c of activeCareClients) {
    const id = c.client_id;
    const bucket = bucketOf.get(id) ?? "";
    if (regressedIds.has(id)) {
      stalledList.push({ clientId: id, name: nameOf(id), why: "weight regressing" });
    } else if (dormantIds.has(id)) {
      stalledList.push({ clientId: id, name: nameOf(id), why: "silent 14d+" });
    } else if (plateauedIds.has(id)) {
      watchList.push({ clientId: id, name: nameOf(id), why: "weight plateaued" });
    } else if (bucket === "protocol_complete") {
      watchList.push({ clientId: id, name: nameOf(id), why: "recheck overdue" });
    } else if (bucket === "plan_review_due") {
      watchList.push({ clientId: id, name: nameOf(id), why: "review overdue" });
    } else if (bucket === "follow_up_due") {
      watchList.push({ clientId: id, name: nameOf(id), why: "follow-up due" });
    } else if (bucket === "labs_pending") {
      watchList.push({ clientId: id, name: nameOf(id), why: "labs pending" });
    } else {
      onTrack += 1;
    }
  }

  const activeCare = activeCareClients.length;
  const stalled = stalledList.length;
  const watch = watchList.length;
  const onTrackPct = activeCare > 0 ? Math.round((onTrack / activeCare) * 100) : null;

  // ── Pipeline (every non-declined client, one stage each) ──────────────────
  let prospect = 0;
  let onboarding = 0;
  let active = 0;
  for (const c of clients) {
    if (c.engagement_status === "declined") continue;
    const bucket = bucketOf.get(c.client_id) ?? "";
    if (ACTIVE_BUCKETS.has(bucket)) active += 1;
    else if (ONBOARDING_BUCKETS.has(bucket)) onboarding += 1;
    else if (PROSPECT_BUCKETS.has(bucket)) prospect += 1;
  }

  // ── Composition (top active conditions across roster) ─────────────────────
  const counts = new Map<string, { label: string; count: number }>();
  for (const c of clients) {
    for (const raw of c.active_conditions ?? []) {
      const label = String(raw).trim();
      if (!label) continue;
      const key = label.toLowerCase();
      const ex = counts.get(key);
      if (ex) ex.count += 1;
      else counts.set(key, { label, count: 1 });
    }
  }
  const composition = [...counts.values()].sort((a, b) => b.count - a.count).slice(0, COMPOSITION_CAP);

  return {
    activeCare,
    onTrack,
    watch,
    stalled,
    onTrackPct,
    watchList: watchList.slice(0, EXCEPTION_CAP),
    stalledList: stalledList.slice(0, EXCEPTION_CAP),
    pipeline: { prospect, onboarding, active },
    composition,
  };
}
