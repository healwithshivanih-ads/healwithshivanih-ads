/**
 * Pure utility functions for parsing session metadata from stored YAML fields.
 * Safe to import from both server components and "use server" action files.
 */

export type SessionType =
  | "discovery_consultation"
  | "pre_intake"
  | "full_assessment"
  | "check_in"
  | "quick_note";

/**
 * Parses [session_type: xxx] prefix from presenting_complaints.
 * Falls back to "full_assessment" for old sessions without the marker.
 */
export function parseSessionType(presenting_complaints?: string): SessionType {
  const m = (presenting_complaints ?? "").match(/^\[session_type:\s*(\w+)\]/);
  if (!m) return "full_assessment";
  const t = m[1];
  if (t === "discovery_consultation") return "discovery_consultation";
  if (t === "pre_intake") return "pre_intake";
  if (t === "check_in") return "check_in";
  if (t === "quick_note") return "quick_note";
  return "full_assessment";
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
