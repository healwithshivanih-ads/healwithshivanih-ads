/**
 * Pure helpers for "deferred / revisit-later" plan items.
 *
 * When the assess AI deliberately holds something back (e.g. seed cycling
 * pending a day-21 progesterone result), it writes a `## Revisit later`
 * section into plan.notes_for_coach as prose — there's no structured field.
 * These helpers extract those items so the dashboard can surface them, and
 * match a deferral's "revisit gate" (a lab marker) against what's on file.
 *
 * Pure module (no "use server", no IO) so both the dashboard server action
 * and any future caller can share the parse/match logic.
 */

export interface DeferredItem {
  itemKey: string; // slug of the title — stable id for sidecar state
  title: string; // "Seed cycling"
  body: string; // full prose of the bullet
  gateText: string; // the "Revisit AFTER …" sentence, if any
  gateMarkers: string[]; // lab markers to watch for, parsed from the gate
}

// Lab/hormone markers a deferral might gate on. Longest-first so "free t3"
// is tried before "t3".
const MARKER_KEYWORDS = [
  "progesterone",
  "oestradiol",
  "estradiol",
  "oestrogen",
  "estrogen",
  "free t3",
  "free t4",
  "reverse t3",
  "testosterone",
  "prolactin",
  "cortisol",
  "insulin",
  "ferritin",
  "vitamin d",
  "hba1c",
  "homa-ir",
  "homa",
  "dhea-s",
  "dhea",
  "dutch",
  "tpo",
  "amh",
  "lh",
  "fsh",
  "tsh",
  "b12",
];

function esc(s: string): string {
  return s.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "item"
  );
}

function normaliseTitle(s: string): string {
  const t = s.trim().replace(/[.,;:]+$/, "");
  // ALL CAPS or all-lower → Sentence case; keep mixed case as authored
  if (t && (t === t.toUpperCase() || t === t.toLowerCase())) {
    return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
  }
  return t;
}

/** Extract deferred items from a plan's notes_for_coach markdown. */
export function parseDeferredItems(notes: string): DeferredItem[] {
  if (!notes) return [];
  const lines = notes.split(/\r?\n/);

  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*#{1,3}\s*revisit\b/i.test(lines[i])) {
      start = i + 1;
      break;
    }
  }
  if (start < 0) return [];

  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    if (/^\s*#{1,3}\s+\S/.test(lines[i])) {
      end = i;
      break;
    }
  }
  const section = lines.slice(start, end);

  // Group wrapped lines into bullets (each bullet starts with - or *).
  const bullets: string[] = [];
  let cur = "";
  for (const raw of section) {
    const line = raw.trim();
    if (/^[-*]\s+/.test(line)) {
      if (cur.trim()) bullets.push(cur.trim());
      cur = line.replace(/^[-*]\s+/, "");
    } else if (line) {
      cur += " " + line;
    }
  }
  if (cur.trim()) bullets.push(cur.trim());
  if (bullets.length === 0) {
    const prose = section.join(" ").trim();
    if (prose) bullets.push(prose);
  }

  return bullets.map((b) => {
    // Title = a short "LABEL:" prefix if present, else first few words.
    const colon = b.indexOf(":");
    let title: string;
    if (colon > 0 && colon <= 44 && b.slice(0, colon).split(/\s+/).length <= 6) {
      title = normaliseTitle(b.slice(0, colon));
    } else {
      title = normaliseTitle(b.split(/\s+/).slice(0, 5).join(" "));
    }

    // Gate sentence: the one mentioning revisit/after/until/once/when.
    const sentences = b.split(/(?<=[.;])\s+/);
    const gateText =
      sentences.find((s) => /\brevisit\b|\bafter\b|\buntil\b|\bonce\b|\bwhen\b/i.test(s))?.trim() || "";

    // Markers to watch — scanned from the GATE CLAUSE only (the part before any
    // "if … → …" decision rule, separated by a colon), so descriptive mentions
    // like "estrogen-dominant" in the rule aren't mistaken for labs to watch.
    const scanFor = gateText ? gateText.split(":")[0] || gateText : b;
    const gateMarkers: string[] = [];
    for (const kw of MARKER_KEYWORDS) {
      if (new RegExp(`\\b${esc(kw)}\\b`, "i").test(scanFor) && !gateMarkers.includes(kw)) {
        gateMarkers.push(kw);
      }
    }

    return { itemKey: slugify(title), title, body: b, gateText, gateMarkers };
  });
}

/** Every lab-marker name on file for a client (current list + legacy snapshots). */
export function collectMarkerNames(client: unknown): string[] {
  const c = client as
    | {
        lab_markers?: Array<{ marker_name?: unknown }>;
        health_snapshots?: Array<{ lab_values?: Array<{ test_name?: unknown }> }>;
      }
    | null
    | undefined;
  const out: string[] = [];
  for (const m of c?.lab_markers ?? []) {
    if (m?.marker_name) out.push(String(m.marker_name));
  }
  for (const snap of c?.health_snapshots ?? []) {
    for (const lv of snap?.lab_values ?? []) {
      if (lv?.test_name) out.push(String(lv.test_name));
    }
  }
  return out;
}

/** Is any watched gate marker present among the client's marker names? */
export function markerPresent(markerNames: string[], gateMarkers: string[]): boolean {
  return gateMarkers.some((g) =>
    markerNames.some((n) => new RegExp(`\\b${esc(g)}\\b`, "i").test(n)),
  );
}
