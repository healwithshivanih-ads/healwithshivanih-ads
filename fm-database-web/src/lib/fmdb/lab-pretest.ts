/**
 * "Before your test" lines for one client's lab order.
 *
 * The lines themselves are the lab's, one set per provider (`pretest_instructions`
 * in the provider yaml), so every client reads the same list. Some lines matter
 * more for one person: "pause biotin" is the one that bites a client whose own
 * supplement contains it, and a general line does not tell them it is theirs.
 *
 * A PRETEST FLAG is the coach's personal addition to one of those lines. It is
 * stored on the order (`pretest_flags`), so it travels with that client's order
 * and nobody else's:
 *
 *   pretest_flags:
 *     - match: biotin
 *       note: Your Meganeuron OD Plus contains biotin, so pause it for these 3 days.
 *
 * `match` is a word; the lab line that contains it (any case) is drawn
 * highlighted, with `note` under it, and moves to the top of the list. A flag
 * whose word is in no line is drawn as a highlighted line of its own: rewording
 * the lab's list must never silently drop a personal instruction.
 *
 * Pure: no I/O, safe in a client component.
 */

export interface PretestFlag {
  match: string;
  note: string;
}

export interface PretestLine {
  text: string;
  /** The coach's personal addition, when this line is flagged. */
  note: string | null;
  flagged: boolean;
}

const MAX_FLAGS = 5;
const MAX_NOTE = 240;

/** Order YAML is hand-editable, so read the field defensively: anything that
 *  is not a `{match, note}` pair of non-empty strings is ignored. */
export function sanitizePretestFlags(raw: unknown): PretestFlag[] {
  if (!Array.isArray(raw)) return [];
  const out: PretestFlag[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const match = typeof r.match === "string" ? r.match.trim() : "";
    const note = typeof r.note === "string" ? r.note.trim().slice(0, MAX_NOTE) : "";
    if (!match || !note) continue;
    out.push({ match, note });
    if (out.length === MAX_FLAGS) break;
  }
  return out;
}

/** The lines to draw, flagged ones first. */
export function pretestLines(instructions: readonly string[] | null | undefined, rawFlags: unknown): PretestLine[] {
  const flags = sanitizePretestFlags(rawFlags);
  const used = new Set<number>();
  const flagged: PretestLine[] = [];
  const plain: PretestLine[] = [];
  for (const text of instructions ?? []) {
    const lower = text.toLowerCase();
    const notes: string[] = [];
    flags.forEach((f, i) => {
      if (lower.includes(f.match.toLowerCase())) {
        used.add(i);
        notes.push(f.note);
      }
    });
    if (notes.length) flagged.push({ text, note: notes.join(" "), flagged: true });
    else plain.push({ text, note: null, flagged: false });
  }
  const orphans: PretestLine[] = flags
    .filter((_, i) => !used.has(i))
    .map((f) => ({ text: f.note, note: null, flagged: true }));
  return [...flagged, ...orphans, ...plain];
}
