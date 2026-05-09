/**
 * Pure utility functions for parsing session metadata from stored YAML fields.
 * Safe to import from both server components and "use server" action files.
 */

export type SessionType =
  | "discovery"
  | "intake"
  | "check_in"
  | "quick_note";

/**
 * Parses [session_type: xxx] prefix from presenting_complaints.
 * Falls back to "intake" for old sessions without the marker.
 *
 * Backward-compat aliasing for sessions saved before the v0.63 rename:
 *   pre_intake, discovery_consultation → discovery (same first-call concept)
 *   full_assessment                   → intake     (renamed)
 */
export function parseSessionType(presenting_complaints?: string): SessionType {
  const m = (presenting_complaints ?? "").match(/^\[session_type:\s*(\w+)\]/);
  if (!m) return "intake";
  const t = m[1];
  if (t === "discovery" || t === "pre_intake" || t === "discovery_consultation") return "discovery";
  if (t === "intake" || t === "full_assessment") return "intake";
  if (t === "check_in") return "check_in";
  if (t === "quick_note") return "quick_note";
  return "intake";
}

/**
 * Parses [Requested labs: lab1, lab2, ...] from coach_notes.
 * Returns empty array if not found.
 */
export function parseRequestedLabs(coach_notes?: string): string[] {
  const m = (coach_notes ?? "").match(/\[Requested labs:\s*([^\]]+)\]/);
  if (!m) return [];
  return m[1].split(",").map((s) => s.trim()).filter(Boolean);
}
