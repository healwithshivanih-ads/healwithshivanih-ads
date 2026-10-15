import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { getPlansRoot } from "./paths";
import { effectiveRecheckDate } from "./plan-timing";
import {
  summariseFeedback,
  type FeedbackRow,
  type FeedbackStage,
  type FeedbackSummary,
  type TestimonialConsent,
} from "./programme-feedback";

/**
 * Coach-side read of programme feedback (see programme-feedback.ts).
 *
 * Two things for the dashboard's "How are we doing" panel:
 *   - every feedback response on file, rolled up;
 *   - the clients who FINISHED a programme and were never asked — each with
 *     a ready WhatsApp message carrying their `/app/<token>?feedback=1` link.
 *     This is how clients who ended before the form existed (or lapsed
 *     without opening the app again) get asked at all.
 */

/** Finished more than this long ago → no longer worth chasing for an
 *  end-of-programme verdict. */
const ASK_WINDOW_DAYS = 365;

interface ClientLike {
  client_id: string;
  display_name?: string;
  mobile_number?: string;
  app_token?: string;
  archived?: boolean;
}

interface PlanLike {
  status?: string;
  _bucket?: string;
  plan_period_start?: string | Date;
  plan_period_weeks?: number;
  plan_period_recheck_date?: string | Date;
  meal_plan_started_on?: string | Date | null;
}

export interface FeedbackAsk {
  client_id: string;
  display_name: string;
  ended_on: string;
  /** wa.me deep link with the message pre-filled; null without a phone */
  whatsapp: string | null;
  /** the raw feedback link, for copy-paste */
  link: string;
}

export interface ProgrammeFeedbackData {
  rows: FeedbackRow[];
  summary: FeedbackSummary;
  asks: FeedbackAsk[];
}

function appOrigin(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "https://intake.theochretree.com").trim().replace(/\/$/, "");
}

/** Digits for wa.me: a bare 10-digit Indian mobile gets the 91 prefix. */
export function waDigits(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const d = raw.replace(/\D/g, "");
  if (d.length === 10) return `91${d}`;
  if (d.length >= 11 && d.length <= 15) return d;
  return null;
}

export function feedbackAskMessage(firstName: string, link: string): string {
  return (
    `Hi ${firstName}, it's Shivani. Now that your programme has finished, I'd really value ` +
    `three minutes of your honest feedback: what helped, what didn't, and what you'd change. ` +
    `It comes straight to me.\n\n${link}`
  );
}

function asText(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function toRow(clientId: string, clientName: string, s: Record<string, unknown>): FeedbackRow | null {
  const fb = s.feedback_response as Record<string, unknown> | undefined;
  if (!fb) return null;
  const stage = fb.stage as FeedbackStage;
  if (stage !== "midpoint" && stage !== "graduation" && stage !== "followup") return null;
  const date = s.date instanceof Date ? s.date.toISOString().slice(0, 10) : asText(s.date).slice(0, 10);
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  const parts: Record<string, number | null> = {};
  for (const [k, v] of Object.entries((fb.parts as Record<string, unknown>) ?? {})) parts[k] = num(v);
  return {
    clientId,
    clientName,
    date,
    stage,
    week: num(fb.week) ?? 0,
    goals: Array.isArray(fb.goals)
      ? (fb.goals as Record<string, unknown>[]).map((g) => ({ goal: asText(g?.goal), change: num(g?.change) }))
      : [],
    parts,
    recommend: num(fb.recommend),
    biggest_change: asText(fb.biggest_change),
    hardest: asText(fb.hardest),
    change_one_thing: asText(fb.change_one_thing),
    testimonial: (["named", "anonymous"].includes(asText(fb.testimonial)) ? fb.testimonial : "no") as TestimonialConsent,
  };
}

async function readFeedbackRows(client: ClientLike): Promise<FeedbackRow[]> {
  const dir = path.join(getPlansRoot(), "clients", client.client_id, "sessions");
  let names: string[];
  try {
    names = (await fs.readdir(dir)).filter((n) => n.endsWith("-app-feedback.yaml"));
  } catch {
    return [];
  }
  const out: FeedbackRow[] = [];
  for (const n of names) {
    try {
      const s = yaml.load(await fs.readFile(path.join(dir, n), "utf-8")) as Record<string, unknown>;
      const row = s && toRow(client.client_id, client.display_name || client.client_id, s);
      if (row) out.push(row);
    } catch {
      /* unreadable session — skip, never break the dashboard */
    }
  }
  return out;
}

function planEnd(p: PlanLike): string | null {
  const eff = effectiveRecheckDate(p as Parameters<typeof effectiveRecheckDate>[0]);
  if (eff) return eff;
  const stored = p.plan_period_recheck_date;
  if (stored instanceof Date) return stored.toISOString().slice(0, 10);
  return typeof stored === "string" && stored ? stored.slice(0, 10) : null;
}

/** The latest end date of a client's programme IF it has ended — every
 *  published plan is past its end. null while any plan is still running. */
export function endedProgrammeOn(plans: readonly PlanLike[], todayStr: string): string | null {
  const published = plans.filter((p) => (p._bucket ?? p.status) === "published");
  let latest: string | null = null;
  for (const p of published) {
    const end = planEnd(p);
    if (!end || end >= todayStr) return null;
    if (!latest || end > latest) latest = end;
  }
  return latest;
}

export async function loadProgrammeFeedback(
  clients: readonly ClientLike[],
  plansByClient: Map<string, PlanLike[]>,
  todayStr: string,
): Promise<ProgrammeFeedbackData> {
  const perClient = await Promise.all(clients.map((c) => readFeedbackRows(c)));
  const rows = perClient.flat().sort((a, b) => b.date.localeCompare(a.date));

  const answeredEnd = new Set(rows.filter((r) => r.stage !== "midpoint").map((r) => r.clientId));
  const cutoff = new Date(`${todayStr}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - ASK_WINDOW_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const asks: FeedbackAsk[] = [];
  for (const c of clients) {
    if (c.archived === true || answeredEnd.has(c.client_id)) continue;
    if (typeof c.app_token !== "string" || c.app_token.length < 16) continue;
    const ended = endedProgrammeOn(plansByClient.get(c.client_id) ?? [], todayStr);
    if (!ended || ended < cutoffStr) continue;
    const name = c.display_name || c.client_id;
    const link = `${appOrigin()}/app/${c.app_token}?feedback=1`;
    const phone = waDigits(c.mobile_number);
    asks.push({
      client_id: c.client_id,
      display_name: name,
      ended_on: ended,
      link,
      whatsapp: phone
        ? `https://wa.me/${phone}?text=${encodeURIComponent(feedbackAskMessage(name.split(" ")[0], link))}`
        : null,
    });
  }
  asks.sort((a, b) => b.ended_on.localeCompare(a.ended_on));

  return { rows, summary: summariseFeedback(rows), asks };
}
