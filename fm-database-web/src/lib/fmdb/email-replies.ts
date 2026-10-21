/**
 * Reading a prospect's email reply: what they actually wrote (not the quoted
 * email below it) and whether it asks us to stop.
 *
 * Coach (2026-10-21): "make the no more reply catch automatically". Every
 * content note ends "If you'd rather not get notes like this, just reply 'no
 * more' and I'll stop." — so a reply saying so must stop everything without
 * her lifting a finger.
 *
 * Deliberately careful in BOTH directions:
 *   - "no more bloating since I tried the seeds!" is good news, not an
 *     opt-out — "no more" counts only on its own or followed by emails /
 *     messages / notes;
 *   - "not interested" counts only as (most of) a short reply — inside a
 *     paragraph it is usually about something else ("not interested in
 *     medication") and a person writing a paragraph deserves a personal reply.
 * Whatever is caught is visible to the coach (thread + panel), and she can
 * undo it with one tap.
 *
 * Pure: no I/O.
 */

/** Lines that begin the quoted original in common mail clients. */
const QUOTE_START = [
  /^On .{0,200}wrote:\s*$/i, // Gmail / Apple Mail (one line)
  /^-{2,}\s*Original Message\s*-{2,}/i, // Outlook
  /^_{5,}\s*$/, // Outlook web separator
  /^From:\s.+/i, // Outlook header block
  /^Sent from my (iPhone|iPad|Android|phone|mobile)/i,
  /^Get Outlook for /i,
];

/** What the person typed, without the quoted email or signature boilerplate. */
export function replyBody(text: string | null | undefined): string {
  if (typeof text !== "string") return "";
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    // "On Tue, 20 Oct 2026 at 10:00, Shivani Hari <x@y>" + "wrote:" on the next line.
    if (/^On .{0,200}$/i.test(t) && /^wrote:\s*$/i.test((lines[i + 1] ?? "").trim())) break;
    if (QUOTE_START.some((re) => re.test(t))) break;
    if (t.startsWith(">")) continue;
    kept.push(line);
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

const SHORT_REPLY_CHARS = 80;

const ANYWHERE: RegExp[] = [
  /\bunsubscribe\b/,
  /\bopt (me )?out\b/,
  /\bremove me\b/,
  /\btake me off\b/,
  /\bno more (e-?mails?|mails?|messages?|notes?|of (these|this)|newsletters?)\b/,
  /\b(please )?stop (sending|e-?mailing|mailing|messaging|contacting|these|this)\b/,
  /\b(do not|don'?t|dont) (e-?mail|mail|contact|message|send)( me)?\b/,
];

const WHOLE_REPLY = /^(please\s+)?(no more|stop|no thanks?|not interested|unsubscribe)(\s+(please|thanks?|thank you))?[\s.!🙏😊]*$/u;

/**
 * The phrase that makes this reply an opt-out, or null. Checks only what they
 * typed (pass `replyBody(...)`), lower-cased.
 */
export function optOutPhrase(body: string | null | undefined): string | null {
  if (typeof body !== "string") return null;
  const t = body.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (WHOLE_REPLY.test(t)) return t.replace(/[\s.!🙏😊]+$/u, "");
  for (const re of ANYWHERE) {
    const m = t.match(re);
    if (m) return m[0];
  }
  if (t.length <= SHORT_REPLY_CHARS) {
    const m = t.match(/\bnot interested\b/);
    if (m) return m[0];
  }
  return null;
}
