/**
 * RESULTS THE COACH HAS RELEASED to the client's app (new front, step 5).
 *
 * Nothing reaches the app until the coach presses "Share results"
 * (client.yaml#results_shared_on). Then: body age, from the computed
 * PhenoAge marker in client.lab_markers, and the lab numbers already in the
 * lab vault, each with a plain tag — within, above or below the usual range.
 * Meaning stays with the coach: this file adds no interpretation text.
 */

import type { LabMarker, LabVault } from "./lab-vault";

export interface AppBodyAge {
  /** years, one decimal */
  value: number;
  /** calendar age when the test was taken, when the record says */
  calendarAge: number | null;
  /** the test date, YYYY-MM-DD, when known */
  date: string | null;
}

export type RangeTag = "within" | "above" | "below" | "none";

export interface AppResultRow {
  name: string;
  value: number;
  unit: string;
  date: string;
  tag: RangeTag;
  /** "3.5 to 5.5 mmol/L"; "" when there is no usual range */
  range: string;
}

export interface AppResults {
  sharedOn: string;
  note: string;
  bodyAge: AppBodyAge | null;
  groups: { system: string; rows: AppResultRow[] }[];
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

/** Body age from the computed markers, or null when it was never worked out. */
export function bodyAgeOf(labMarkers: unknown, labMarkersDate: unknown): AppBodyAge | null {
  if (!Array.isArray(labMarkers)) return null;
  const m = labMarkers.find((x) => x && typeof x === "object" && /phenoage/i.test(String((x as Record<string, unknown>).marker_name ?? "")));
  if (!m) return null;
  const r = m as Record<string, unknown>;
  const value = num(r.value);
  if (value === null) return null;
  const said = String(r.fm_interpretation ?? "").match(/calendar age (\d{1,3})/i);
  return {
    value: Math.round(value * 10) / 10,
    calendarAge: said ? Number(said[1]) : null,
    date: typeof labMarkersDate === "string" && labMarkersDate ? labMarkersDate.slice(0, 10) : null,
  };
}

/** Within, above or below the usual range — never a word more. */
export function rangeTag(m: Pick<LabMarker, "latestValue" | "conventional" | "unitMismatch">): RangeTag {
  const band = m.conventional;
  if (!band || m.unitMismatch || (band.low === undefined && band.high === undefined)) return "none";
  if (band.low !== undefined && m.latestValue < band.low) return "below";
  if (band.high !== undefined && m.latestValue > band.high) return "above";
  return "within";
}

function rangeText(m: Pick<LabMarker, "conventional" | "unit">): string {
  const b = m.conventional;
  if (!b) return "";
  const u = b.unit || m.unit;
  if (b.low !== undefined && b.high !== undefined) return `${b.low} to ${b.high}${u ? ` ${u}` : ""}`;
  if (b.high !== undefined) return `up to ${b.high}${u ? ` ${u}` : ""}`;
  if (b.low !== undefined) return `${b.low} or more${u ? ` ${u}` : ""}`;
  return "";
}

/** What the app may show, or null when the coach has not shared results. */
export function releasedResults(client: Record<string, unknown>, vault: LabVault | null): AppResults | null {
  const sharedOn = typeof client.results_shared_on === "string" ? client.results_shared_on.trim() : "";
  if (!sharedOn) return null;
  const groups = (vault?.groups ?? [])
    .map((g) => ({
      system: g.system,
      rows: g.markers.map((m) => ({ name: m.displayName, value: m.latestValue, unit: m.unit, date: m.latestDate, tag: rangeTag(m), range: rangeText(m) })),
    }))
    .filter((g) => g.rows.length > 0);
  return {
    sharedOn,
    note: typeof client.results_shared_note === "string" ? client.results_shared_note.trim() : "",
    bodyAge: bodyAgeOf(client.lab_markers, client.lab_markers_date),
    groups,
  };
}

export const TAG_WORDS: Record<RangeTag, string> = {
  within: "Within the usual range",
  above: "Above the usual range",
  below: "Below the usual range",
  none: "No usual range to compare",
};
