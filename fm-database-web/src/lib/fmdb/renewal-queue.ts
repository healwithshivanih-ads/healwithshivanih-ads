import "server-only";

/**
 * Who is coming to the end of their plan.
 *
 * WHY THIS EXISTS: on 3 Aug 2026 six plans were inside their final fortnight
 * and nothing had surfaced any of them. Two were caught by the coach asking a
 * passing question; one client's own renewal fell six days after an email
 * asking her to pay for her daughter's, because nobody had checked the
 * household. The end of a plan is the most commercially significant moment in
 * the relationship and it was the one moment nothing watched.
 *
 * Deterministic and free — dates and files only, never a model. It reports;
 * it never writes to a client. Drafting is a separate, coach-approved step.
 *
 * DECISIONS ARE RECORDED SO THE QUEUE CAN SHUT UP. A client who has said no
 * must stop appearing, or the digest trains the coach to skim past it — which
 * is how the one person who WOULD have renewed gets missed. Decisions live in
 * _renewal_decisions.yaml keyed by plan slug, because the decision is about a
 * plan ending rather than about the person.
 */
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { getPlansRoot } from "./paths";

/** How far ahead to look. The first touch is the labs-and-heads-up one, and
 *  bloods need turnaround time before a next phase can be built on them. */
export const LOOKAHEAD_DAYS = 15;

/**
 * How long a plan that has already ended keeps appearing in the queue.
 *
 * Was 30 days. Shortened to 14 (coach's call, 2026-08-28) when the win-back
 * drip was built: the drip auto-drafts client emails for people who ended and
 * were never resolved, and its correctness property is that it NEVER touches
 * anyone the coach is still being asked about. With a 30-day tail that property
 * was unsatisfiable — every drip touch inside six weeks fell inside the queue.
 *
 * Fourteen days is also the point the roster itself already treats as decisive:
 * `RENEWAL_GRACE_DAYS` in fmdb/plan/renewals.py lapses a client at exactly the
 * same mark. So the queue now stops asking on the same day the system concludes
 * they have lapsed, and the drip picks them up from there.
 *
 * The week between this tail and the drip's first touch is NOT a blind spot:
 * those clients render in the win-back panel as scheduled rows, and the day-16
 * graduation notice reaches them meanwhile.
 */
export const OVERDUE_TAIL_DAYS = 14;

export type RenewalDecision = "not_renewing" | "renewed" | "deferred";

export type RenewalRow = {
  clientId: string;
  clientName: string;
  planSlug: string;
  endsOn: string;
  daysLeft: number;
  weeks: number;
  /** Which drip touch is due: 15 days out, 7 days out, or overdue. */
  stage: "heads_up" | "offer" | "overdue";
  /** Other clients in the same household, so two asks do not collide. */
  household: string[];
  decision: RenewalDecision | null;
};

function asDate(v: unknown): Date | null {
  if (v instanceof Date) return v;
  if (typeof v === "string") {
    const d = new Date(v.slice(0, 10));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/**
 * When a plan's window actually closes.
 *
 * Exported because the win-back drip must agree with this queue to the DAY: the
 * drip's whole safety property is "never touch anyone still in the queue", and
 * two independent end-date computations would make that property accidental
 * rather than structural. There is already one such divergence in the tree —
 * fmdb/plan/renewals.py omits the +3 day adoption lag that this and
 * renewal-brief.py both apply — and it is not worth a third.
 *
 * The rule: the coach-asserted start if she has one, else publish + 3 days for
 * shopping and prep. Returns null when the plan carries no datable start.
 */
export function planEndDate(
  mealStartedOn: Date | null,
  periodStart: Date | null,
  weeks: number,
): Date | null {
  const eff = mealStartedOn ?? (periodStart ? new Date(periodStart.getTime() + 3 * 864e5) : null);
  if (!eff || !weeks) return null;
  return new Date(eff.getTime() + weeks * 7 * 864e5);
}

/** Parse a YAML date field the same way the queue does. Exported for reuse. */
export const toDate = asDate;

function decisionsFile(): string {
  return path.join(getPlansRoot(), "_renewal_decisions.yaml");
}

/** planSlug → decision. */
export function loadDecisions(): Record<string, { decision: RenewalDecision; at: string; note?: string }> {
  try {
    const doc = yaml.load(fs.readFileSync(decisionsFile(), "utf-8"));
    return (doc && typeof doc === "object" ? doc : {}) as Record<
      string,
      { decision: RenewalDecision; at: string; note?: string }
    >;
  } catch {
    return {};
  }
}

/** Record that a plan's ending has been dealt with. */
export function setDecision(planSlug: string, decision: RenewalDecision, note?: string): boolean {
  if (!/^[a-z0-9][a-z0-9-]{0,120}$/i.test(planSlug)) return false;
  const all = loadDecisions();
  all[planSlug] = { decision, at: new Date().toISOString(), ...(note ? { note } : {}) };
  try {
    const f = decisionsFile();
    const tmp = `${f}.tmp`;
    fs.writeFileSync(tmp, yaml.dump(all, { sortKeys: true }), { mode: 0o600 });
    fs.renameSync(tmp, f);
    return true;
  } catch {
    return false;
  }
}

/**
 * Undo a recorded decision — the row comes back into the queue.
 *
 * Exists because the failure mode of a mis-click is SILENT: the wrong client
 * stops appearing and stays gone for the rest of the 30-day window, which is
 * exactly the disappearance this queue was built to prevent. A one-way button
 * on a row that vanishes when you press it needs a way back.
 */
export function clearDecision(planSlug: string): boolean {
  if (!/^[a-z0-9][a-z0-9-]{0,120}$/i.test(planSlug)) return false;
  const all = loadDecisions();
  if (!(planSlug in all)) return true; // already absent — the desired end state
  delete all[planSlug];
  try {
    const f = decisionsFile();
    const tmp = `${f}.tmp`;
    fs.writeFileSync(tmp, yaml.dump(all, { sortKeys: true }), { mode: 0o600 });
    fs.renameSync(tmp, f);
    return true;
  } catch {
    return false;
  }
}

/**
 * Surname-based household grouping.
 *
 * Crude on purpose. It exists to stop two renewal asks landing on one family
 * in the same week, and for that a false grouping costs a glance while a
 * missed one costs the thing that already happened.
 */
function householdKey(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
}

export function loadRenewalQueue(
  today = new Date(),
  lookahead = LOOKAHEAD_DAYS,
): RenewalRow[] {
  const root = getPlansRoot();
  const decisions = loadDecisions();
  let files: string[] = [];
  try {
    files = fs.readdirSync(path.join(root, "published")).filter((f) => f.endsWith(".yaml"));
  } catch {
    return [];
  }

  const names = new Map<string, string>();
  const rows: RenewalRow[] = [];

  for (const f of files) {
    let plan: Record<string, unknown>;
    try {
      plan = (yaml.load(fs.readFileSync(path.join(root, "published", f), "utf-8")) ?? {}) as Record<
        string,
        unknown
      >;
    } catch {
      continue; // one unreadable plan must not empty the queue
    }
    const clientId = String(plan.client_id ?? "");
    const weeks = Number(plan.plan_period_weeks ?? 0);
    const start = asDate(plan.plan_period_start);
    const meal = asDate(plan.meal_plan_started_on);
    if (!clientId || !weeks) continue;

    const end = planEndDate(meal, start, weeks);
    if (!end) continue;
    const daysLeft = Math.round((end.getTime() - today.getTime()) / 864e5);
    if (daysLeft > lookahead || daysLeft < -OVERDUE_TAIL_DAYS) continue;

    if (!names.has(clientId)) {
      let n = clientId;
      try {
        const doc = yaml.load(
          fs.readFileSync(path.join(root, "clients", clientId, "client.yaml"), "utf-8"),
        ) as { display_name?: string };
        n = doc?.display_name?.trim() || clientId;
      } catch {
        /* prospects and moved records fall back to the id */
      }
      names.set(clientId, n);
    }

    const planSlug = f.replace(/-v\d+\.yaml$/, "").replace(/\.yaml$/, "");
    rows.push({
      clientId,
      clientName: names.get(clientId)!,
      planSlug,
      endsOn: ymd(end),
      daysLeft,
      weeks,
      stage: daysLeft < 0 ? "overdue" : daysLeft <= 7 ? "offer" : "heads_up",
      household: [],
      decision: decisions[planSlug]?.decision ?? null,
    });
  }

  // Household links, so the digest can show that two asks would collide.
  const byHouse = new Map<string, string[]>();
  for (const r of rows) {
    const k = householdKey(r.clientName);
    if (!k) continue;
    byHouse.set(k, [...(byHouse.get(k) ?? []), r.clientName]);
  }
  for (const r of rows) {
    const k = householdKey(r.clientName);
    r.household = (byHouse.get(k) ?? []).filter((n) => n !== r.clientName);
  }

  rows.sort((a, b) => a.daysLeft - b.daysLeft);
  return rows;
}

/** The queue minus anyone already decided — what the digest should show. */
export function openRenewals(today = new Date()): RenewalRow[] {
  return loadRenewalQueue(today).filter((r) => r.decision === null);
}
