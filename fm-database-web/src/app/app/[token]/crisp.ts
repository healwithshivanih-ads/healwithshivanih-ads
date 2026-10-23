/**
 * One line, read at a glance.
 *
 * Coach-written guidance arrives as full sentences with their reasoning
 * attached ("Plan the festival weeks rather than riding them — decide in
 * advance which days are the indulgent ones"). On a phone home screen a list
 * of those is a wall: Nazneen's maintenance home ran to three screens of prose
 * (2026-10-22, "too verbose and too much to read").
 *
 * `crisp` splits a line into its HEAD — the instruction, up to the first
 * clause break — and the REST, which the screen keeps one tap away. Nothing is
 * dropped: head + rest always carries every word of the original.
 */
export function crisp(text: string): { head: string; rest: string } {
  const t = (text || "").replace(/\s+/g, " ").trim();
  // Clause breaks, in order of preference: a dash aside, a semicolon, a
  // sentence end. A colon only when it comes late (an early colon is usually
  // a label: "Dinner: before 7").
  const m = t.match(/\s[—–-]\s|;\s|\.\s(?=[A-Z])|:\s(?=\S)/);
  if (!m || m.index === undefined) return { head: t, rest: "" };
  if (m[0].startsWith(":") && m.index < 12) return { head: t, rest: "" };
  const head = t.slice(0, m.index).replace(/[.,]$/, "").trim();
  const rest = t.slice(m.index + m[0].length).trim();
  // A head too short to stand alone ("Rest — …") keeps the whole line.
  if (head.split(" ").length < 3) return { head: t, rest: "" };
  return { head, rest: rest ? rest[0].toUpperCase() + rest.slice(1) : "" };
}
