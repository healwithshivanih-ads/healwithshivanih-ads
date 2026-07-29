"use server";

/**
 * Roster review — records marked `signed_up` with nothing to show for it.
 *
 * Companion to `fmdb prospects-sweep`, which only ever looks at people who are
 * NOT signed up. A record wrongly marked signed_up is invisible to the sweep
 * and silently inflates the active roster. Anita Pansari (cl-020) was exactly
 * that: a discovery consult, no submitted intake, no plan, 24 days quiet — and
 * still counted as an active client.
 *
 * Report only. No mutation, by design (see findUnevidencedSignups).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { getPlansRoot } from "@/lib/fmdb/paths";
import { loadAllClients, loadAllPlans } from "@/lib/fmdb/loader";
import {
  findUnevidencedSignups,
  type UnevidencedSignup,
} from "@/lib/fmdb/engagement";

export interface RosterReviewStatus {
  /** How many signed-up records lack any evidence of being a client. */
  flagged: number;
  items: UnevidencedSignup[];
  /** Size of the active roster, for context in the chip. */
  rosterSize: number;
}

/**
 * Newest session date for a person, taken from the session FILENAMES
 * (`<id>-YYYY-MM-DD-NNN.yaml`) so we never parse a directory of YAML just to
 * read a date. Mirrors `_newest_session_date` in fmdb/plan/prospects.py.
 */
async function newestSessionYmd(clientId: string): Promise<string | null> {
  const dir = path.join(getPlansRoot(), "clients", clientId, "sessions");
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return null;
  }
  let best: string | null = null;
  for (const n of names) {
    if (!n.endsWith(".yaml")) continue;
    const m = /(\d{4}-\d{2}-\d{2})/.exec(n);
    if (m && (best === null || m[1] > best)) best = m[1];
  }
  return best;
}

export async function getRosterReviewStatus(): Promise<RosterReviewStatus> {
  const [clients, plans] = await Promise.all([loadAllClients(), loadAllPlans()]);

  // Any plan in any bucket counts as evidence — a revoked or superseded plan
  // still means this person was once a real client.
  const withPlan = new Set<string>();
  for (const p of plans as Array<Record<string, unknown>>) {
    const id = p.client_id;
    if (typeof id === "string" && id) withPlan.add(id);
  }

  const rows = clients as unknown as Array<Record<string, unknown>>;

  // Only stat sessions for records that already fail the intake+plan test —
  // typically a handful, so this stays cheap on a full dashboard render.
  const candidates = rows.filter(
    (c) =>
      typeof c.client_id === "string" &&
      !withPlan.has(c.client_id as string) &&
      !(typeof c.intake_submitted_at === "string" && c.intake_submitted_at.trim())
  );
  const touchById = new Map<string, string | null>(
    await Promise.all(
      candidates.map(
        async (c) =>
          [c.client_id as string, await newestSessionYmd(c.client_id as string)] as const
      )
    )
  );

  const todayYmd = new Date().toISOString().slice(0, 10);
  const items = findUnevidencedSignups(
    rows.map((c) => {
      const id = c.client_id as string;
      // Same clock as the sweep: newest session, else intake date, else
      // creation. Never `updated_at` — background jobs bump it, which would
      // make a stale record look freshly touched forever.
      const fallback =
        (typeof c.intake_date === "string" && c.intake_date) ||
        (typeof c.created_at === "string" && c.created_at) ||
        null;
      const session = touchById.get(id) ?? null;
      const last =
        session && fallback ? (session > fallback.slice(0, 10) ? session : fallback) : session || fallback;
      return {
        client_id: id,
        display_name: (c.display_name as string) ?? null,
        engagement_status: c.engagement_status,
        intake_submitted_at: c.intake_submitted_at,
        last_touch: last ? String(last).slice(0, 10) : null,
      };
    }),
    withPlan,
    todayYmd
  );

  return { flagged: items.length, items, rosterSize: rows.length };
}
