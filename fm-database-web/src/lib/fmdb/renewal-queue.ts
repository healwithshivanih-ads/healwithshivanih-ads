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

    // Same effective-start rule the rest of the app uses: the coach-asserted
    // date if she has one, else publish + 3 days for shopping and prep.
    const eff = meal ?? (start ? new Date(start.getTime() + 3 * 864e5) : null);
    if (!eff) continue;
    const end = new Date(eff.getTime() + weeks * 7 * 864e5);
    const daysLeft = Math.round((end.getTime() - today.getTime()) / 864e5);
    if (daysLeft > lookahead || daysLeft < -30) continue;

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
