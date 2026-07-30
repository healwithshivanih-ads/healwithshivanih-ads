/**
 * Pure helpers for retiring a condition. Deliberately NOT in the server-action
 * file: `"use server"` modules may only export async functions, and a sync
 * export there fails the Next build (the same trap `classifyPollReply` hit).
 */

/** "Constipation" → "Constipation — resolved Jul 2026" */
export function resolvedLabel(condition: string, when: Date): string {
  const stamp = when.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
  return `${condition.trim()} — resolved ${stamp}`;
}

/** Strip the stamp this module added, so reactivating restores the original. */
export function stripResolvedStamp(entry: string): string {
  return entry.replace(/\s*[—–-]\s*resolved\s+[A-Za-z]{3}\s+\d{4}\s*$/i, "").trim();
}

/** Did we retire this entry (vs the coach hand-writing a history line)? */
export function isResolvedEntry(entry: string): boolean {
  return /[—–-]\s*resolved\s+[A-Za-z]{3}\s+\d{4}\s*$/i.test(entry);
}
