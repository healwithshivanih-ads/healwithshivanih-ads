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
 * Parses [session_type: xxx] tag from presenting_complaints.
 * Falls back to "intake" for old sessions without the marker.
 *
 * Backward-compat aliasing for sessions saved before the v0.63 rename:
 *   pre_intake, discovery_consultation → discovery (same first-call concept)
 *   full_assessment                   → intake     (renamed)
 *
 * Scans for [session_type: ...] ANYWHERE in the string — not just at
 * the start. WhatsApp webhook prepends [plan: X] [window: Y] tags
 * BEFORE [session_type: quick_note], so a start-anchored regex was
 * returning "intake" by default for every inbound WhatsApp message.
 * Bug surfaced 2026-05-18 on cl-004: SOAPNotePanel was pulling the
 * 16 May WhatsApp message as the latest intake and rendering its body
 * as the SOAP Subjective section.
 */
export function parseSessionType(presenting_complaints?: string): SessionType {
  const m = (presenting_complaints ?? "").match(/\[session_type:\s*(\w+)\]/);
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

/**
 * Scan an array of session records for the most-recent send of a given
 * WhatsApp/email template, returning the ISO timestamp or null.
 *
 * Source of truth: `recordOutboundMessageAction` appends a line tagged
 *   [source: whatsapp_outbound] [template: <name>] [sent_at: <ISO>]
 * into a quick_note session's `presenting_complaints` (often multiple
 * lines within the same day's session). This helper extracts the
 * latest `sent_at` across all sessions for a given template name.
 *
 * Used by every coach-side "send X to client" button to render a
 * persisted "✓ Sent X ago · Resend" idle state, instead of looking
 * fresh after every page reload. See the durable-rule memory
 * `feedback-send-buttons-persist-state`.
 *
 * Pass `Sessions[]` from `loadClientSessions(id)` — the raw record
 * carries `presenting_complaints` directly.
 */
export function lastTemplateSentAt(
  sessions: ReadonlyArray<{ presenting_complaints?: string | null }>,
  templateName: string,
): string | null {
  const re = new RegExp(
    `\\[template:\\s*${templateName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\][^\\[]*\\[sent_at:\\s*([^\\]]+)\\]`,
    "g",
  );
  const stamps: string[] = [];
  for (const s of sessions) {
    const pc = s.presenting_complaints;
    if (typeof pc !== "string") continue;
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(pc)) !== null) stamps.push(m[1].trim());
  }
  if (stamps.length === 0) return null;
  stamps.sort();
  return stamps[stamps.length - 1];
}

/**
 * Human-readable "3 hrs ago" / "2 days ago" for a UTC ISO timestamp.
 * Returns "" for null / unparseable. Used in idle "✓ Sent X ago" badges.
 */
export function relativeTimeShort(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    const diffMs = Date.now() - new Date(iso).getTime();
    if (diffMs < 0) return "just now";
    const mins = Math.round(diffMs / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs} hr${hrs === 1 ? "" : "s"} ago`;
    const days = Math.round(hrs / 24);
    if (days < 14) return `${days} day${days === 1 ? "" : "s"} ago`;
    return new Date(iso).toLocaleDateString();
  } catch {
    return "";
  }
}
