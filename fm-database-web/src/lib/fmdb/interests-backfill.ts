import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { getPlansRoot } from "./paths";
import { bookingConcern, bookingFreeText, parseBookingFormNote } from "./booking-form";
import { signalsFromText, type InterestSignal } from "./interests";
import { addInterestSignals } from "./interests-store";

/**
 * Tag the interests of people who were already on file before interest
 * tracking existed (2026-10-21), from what they already told us:
 *
 *   - booking-form notes   → source booking_form
 *   - discovery sessions   → source discovery_call (complaints + the record's
 *                            active_conditions and goals)
 *
 * Only people who are not signed up (prospects, declined, never set). Safe to
 * re-run: addInterestSignals skips anything already there and never revives a
 * concern the coach dismissed.
 */

type Dict = Record<string, unknown>;

export interface BackfillRow {
  clientId: string;
  name: string;
  bucket: "clients" | "prospects";
  signals: InterestSignal[];
}

async function readYaml(f: string): Promise<Dict | null> {
  try {
    const d = yaml.load(await fs.readFile(f, "utf-8"));
    return d && typeof d === "object" ? (d as Dict) : null;
  } catch {
    return null;
  }
}

function ymdOf(v: unknown, fallback: string): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  return fallback;
}

function listText(v: unknown): string {
  return Array.isArray(v) ? v.filter((x) => typeof x === "string").join("\n") : typeof v === "string" ? v : "";
}

export async function planInterestBackfill(): Promise<BackfillRow[]> {
  const root = getPlansRoot();
  const rows: BackfillRow[] = [];
  for (const bucket of ["clients", "prospects"] as const) {
    let ids: string[] = [];
    try {
      ids = await fs.readdir(path.join(root, bucket));
    } catch {
      continue;
    }
    for (const id of ids) {
      if (!/^[A-Za-z0-9_-]+$/.test(id)) continue;
      const dir = path.join(root, bucket, id);
      const doc = await readYaml(path.join(dir, "client.yaml"));
      if (!doc) continue;
      const es = String(doc.engagement_status ?? "").trim();
      if (es === "signed_up" || es === "lapsed") continue;

      const fallbackDate = ymdOf(doc.intake_date ?? doc.created_at, new Date().toISOString().slice(0, 10));
      const signals: InterestSignal[] = [];
      let names: string[] = [];
      try {
        names = (await fs.readdir(path.join(dir, "sessions"))).filter((n) => /\.ya?ml$/.test(n)).sort();
      } catch {
        /* no sessions */
      }
      let sawDiscovery = false;
      for (const n of names) {
        const s = await readYaml(path.join(dir, "sessions", n));
        if (!s) continue;
        const pc = String(s.presenting_complaints ?? "");
        const at = ymdOf(s.date ?? s.session_date, n.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? fallbackDate);
        if (pc.includes("[source: booking_form]")) {
          const fields = parseBookingFormNote(String(s.coach_notes ?? ""));
          const words = fields.length
            ? bookingFreeText(fields)
            : pc.replace(/\[[^\]]*\]/g, "").trim();
          const detail = bookingConcern(fields) ?? bookingConcern([{ question: "", answer: words }]);
          signals.push(...signalsFromText(words, "booking_form", at, detail));
        } else if (/discovery_consultation/.test(pc) || s.session_type === "discovery_consultation") {
          sawDiscovery = true;
          const words = pc.replace(/\[[^\]]*\]/g, " ").trim();
          signals.push(...signalsFromText(words, "discovery_call", at, words.slice(0, 160)));
        }
      }
      if (sawDiscovery || signals.length === 0) {
        // What the coach wrote on the record after talking to them.
        const words = [listText(doc.active_conditions), listText(doc.goals)].filter(Boolean).join("\n");
        signals.push(...signalsFromText(words, "discovery_call", fallbackDate, words.replace(/\n/g, "; ").slice(0, 160)));
      }
      rows.push({ clientId: id, name: String(doc.display_name ?? id), bucket, signals });
    }
  }
  return rows;
}

export async function applyInterestBackfill(rows: readonly BackfillRow[]): Promise<{ people: number; added: number }> {
  let people = 0;
  let added = 0;
  for (const r of rows) {
    const res = await addInterestSignals(r.clientId, r.signals);
    if (res.added) {
      people++;
      added += res.added;
    }
  }
  return { people, added };
}
