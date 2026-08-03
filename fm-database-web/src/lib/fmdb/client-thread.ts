/**
 * In-app chat between a client and the coach.
 *
 * WHY THIS EXISTS: WhatsApp becomes paid per message from October, and the
 * client app is already on 14 of 21 home screens. This carries the same
 * conversation without the per-message cost. WhatsApp keeps working — the two
 * are MERGED for display so history is never split and nothing is migrated.
 *
 * STORAGE — one append-only JSONL file PER WRITING HOST:
 *
 *     clients/<id>/_thread.fly.jsonl     written only on Fly
 *     clients/<id>/_thread.mac.jsonl     written only on the Mac
 *
 * That split is the whole trick. Both hosts write to this conversation — the
 * client messages from Fly, the coach replies from her phone (Fly) or her
 * desk (Mac) — and the two trees are reconciled by Mutagen. A single shared
 * file would therefore conflict on any concurrent exchange, and the coach
 * would lose replies to a sync conflict she never sees. Because no host ever
 * writes another host's file, a conflict is not "unlikely" here, it is
 * structurally impossible. Reads merge every `_thread.*.jsonl` present.
 *
 * Append-only, one JSON object per line: a message is added by appending
 * bytes, never by rewriting the file, so a partial write can lose at most the
 * last line rather than corrupting the history.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getPlansRoot } from "./paths";

export type ThreadDirection = "inbound" | "outbound";

/** A message in the in-app thread. `kind` is text-only for now; photo and
 *  voice land in later phases and the reader already tolerates them. */
export type ThreadMessage = {
  id: string;
  at: string; // ISO
  dir: ThreadDirection; // inbound = from the client
  kind: "text" | "photo" | "voice";
  text: string;
  /** Filename under clients/<id>/files/ — photo/voice only. */
  file?: string;
  /** When the RECIPIENT read it. Inbound → the coach read it; outbound →
   *  the client read it. One field, because "read" only ever means
   *  "read by whoever it was sent to". */
  read_at?: string | null;
  /**
   * When the recipient's DEVICE confirmed it arrived — reported by the
   * service worker as it draws the notification, not inferred from the push
   * service returning 201.
   *
   * The difference is the whole point. A push service accepting a message
   * says the message left; it says nothing about whether a phone ever showed
   * it. Hariharan's phone has been accepting every send with a 201 while
   * displaying none of them, and without this there is no way to tell a push
   * that never arrived from one that arrived and was silently swallowed by a
   * battery setting. Those have completely different fixes.
   */
  delivered_at?: string | null;
};

/** Origin-scoped filename. Anything that writes must go through this. */
export function threadFileName(host: string): string {
  const safe = host.replace(/[^a-z0-9]/gi, "").toLowerCase() || "unknown";
  return `_thread.${safe}.jsonl`;
}

/**
 * Which host are we? Fly sets FLY_APP_NAME (and we set FLY_INTAKE_ONLY);
 * anything else is treated as the Mac. Wrong-but-consistent is harmless —
 * the only requirement is that a given host always picks the same name, so
 * it always appends to its own file.
 */
export function currentHost(): string {
  if (process.env.FLY_APP_NAME || process.env.FLY_INTAKE_ONLY === "1") return "fly";
  return "mac";
}

/** Signed-up clients live in clients/, people who never signed up in
 *  prospects/ — mirrors fmdb.plan.storage.client_dir. */
export function clientDir(clientId: string): string | null {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/i.test(clientId)) return null;
  const root = getPlansRoot();
  for (const bucket of ["clients", "prospects"]) {
    const dir = path.join(root, bucket, clientId);
    if (fs.existsSync(dir)) return dir;
  }
  return null;
}

function parseLines(raw: string): ThreadMessage[] {
  const out: ThreadMessage[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const m = JSON.parse(t) as ThreadMessage;
      // A line missing its identity or timestamp cannot be ordered or
      // de-duplicated, so it is dropped rather than shown out of place.
      if (m && m.id && m.at && (m.dir === "inbound" || m.dir === "outbound")) {
        out.push(m);
      }
    } catch {
      // A torn final line from an interrupted append. Skip it; the rest of
      // the history is still perfectly readable, which is the point of JSONL.
    }
  }
  return out;
}

/** Every in-app message for a client, from ALL hosts, oldest first. */
export function readThread(clientId: string): ThreadMessage[] {
  const dir = clientDir(clientId);
  if (!dir) return [];
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const msgs: ThreadMessage[] = [];
  for (const name of names) {
    if (!/^_thread\.[a-z0-9]+\.jsonl$/i.test(name)) continue;
    try {
      msgs.push(...parseLines(fs.readFileSync(path.join(dir, name), "utf8")));
    } catch {
      // Unreadable file → skip it rather than losing the other hosts'.
    }
  }
  return dedupeSort(msgs);
}

/** Stable order + id-dedup. Ids are unique per message, so a file copied
 *  twice by a sync hiccup cannot double a message in the view. */
export function dedupeSort(msgs: ThreadMessage[]): ThreadMessage[] {
  const seen = new Map<string, ThreadMessage>();
  for (const m of msgs) {
    // Prefer the copy that carries a read stamp — read state may be written
    // on a different host than the message itself.
    const prev = seen.get(m.id);
    // Keep the richest copy: a later append adds a stamp, never removes one.
    if (!prev) {
      seen.set(m.id, m);
    } else {
      seen.set(m.id, {
        ...prev,
        ...m,
        read_at: m.read_at ?? prev.read_at ?? null,
        delivered_at: m.delivered_at ?? prev.delivered_at ?? null,
      });
    }
  }
  return [...seen.values()].sort((a, b) =>
    a.at === b.at ? a.id.localeCompare(b.id) : a.at.localeCompare(b.at),
  );
}

/**
 * Append one message to THIS host's file. Returns the stored message.
 *
 * Never rewrites, never touches another host's file. `appendFileSync` with a
 * single write is atomic enough for the line sizes involved here; the reader
 * tolerates a torn tail regardless.
 */
export function appendMessage(
  clientId: string,
  msg: Omit<ThreadMessage, "id" | "at"> & { id?: string; at?: string },
): ThreadMessage | null {
  const dir = clientDir(clientId);
  if (!dir) return null;
  const full: ThreadMessage = {
    id: msg.id ?? randomUUID(),
    at: msg.at ?? new Date().toISOString(),
    dir: msg.dir,
    kind: msg.kind ?? "text",
    text: msg.text ?? "",
    ...(msg.file ? { file: msg.file } : {}),
    read_at: msg.read_at ?? null,
    delivered_at: msg.delivered_at ?? null,
  };
  try {
    fs.appendFileSync(
      path.join(dir, threadFileName(currentHost())),
      JSON.stringify(full) + "\n",
      { mode: 0o600 },
    );
  } catch {
    return null;
  }
  return full;
}

/**
 * Mark every message in a direction as read, up to now.
 *
 * Written as NEW lines rather than by editing the originals — the file stays
 * append-only, and a read stamp made on one host merges with the message
 * written on another (see dedupeSort's preference for the stamped copy).
 */
export function markRead(clientId: string, dir: ThreadDirection): number {
  const unread = readThread(clientId).filter((m) => m.dir === dir && !m.read_at);
  if (!unread.length) return 0;
  const at = new Date().toISOString();
  let n = 0;
  for (const m of unread) {
    if (appendMessage(clientId, { ...m, read_at: at })) n += 1;
  }
  return n;
}

/** Unread count in a direction — inbound is "waiting on the coach". */
/**
 * Record that a message reached the recipient's device.
 *
 * Idempotent and monotonic: the first confirmation wins, later ones are
 * ignored, so a notification redrawn after a phone reboot cannot move the
 * timestamp forward and make delivery look later than it was.
 */
export function markDelivered(clientId: string, messageId: string): boolean {
  const msg = readThread(clientId).find((m) => m.id === messageId);
  if (!msg || msg.delivered_at) return false;
  return !!appendMessage(clientId, { ...msg, delivered_at: new Date().toISOString() });
}

export function unreadCount(clientId: string, dir: ThreadDirection): number {
  return readThread(clientId).filter((m) => m.dir === dir && !m.read_at).length;
}

/* ── Merged view: in-app + WhatsApp ─────────────────────────────────────── */

/**
 * One row of the conversation as displayed, whichever channel carried it.
 *
 * `via` is kept because it changes what the coach can do: a WhatsApp reply is
 * bound by Meta's 24-hour window and costs money, an in-app reply is neither.
 * Hiding the channel would hide that.
 */
export type ThreadView = {
  /** Device-confirmed arrival. Absent on WhatsApp rows — we have no such
   *  signal for them and must not imply one. */
  delivered_at?: string | null;
  id: string;
  at: string;
  dir: ThreadDirection;
  text: string;
  via: "app" | "whatsapp";
  kind: string;
  file?: string;
  read_at?: string | null;
  template_name?: string;
};

/** The shape the existing WhatsApp loader returns (api/whatsapp/actions.ts).
 *  Declared structurally so this module stays free of Next imports. */
export type WhatsAppMessageLike = {
  direction: ThreadDirection;
  date: string;
  text: string;
  template_name?: string;
  session_id?: string;
  attachment?: { name: string; kind: string };
};

/**
 * Merge the in-app thread with WhatsApp history into one chronological
 * conversation.
 *
 * Nothing is migrated and the WhatsApp side is never rewritten — it stays the
 * source of truth for what it already holds, and the dashboard's existing
 * panel keeps working untouched. This only decides display order.
 *
 * WhatsApp messages have no stable id, so one is derived from channel +
 * timestamp + a slice of the text. That is stable across reloads (the inputs
 * don't change) which is what React keys and dedup need; it is not a
 * guarantee of global uniqueness, and nothing depends on it being one.
 */
export function mergeForDisplay(
  app: ThreadMessage[],
  whatsapp: WhatsAppMessageLike[],
): ThreadView[] {
  const rows: ThreadView[] = app.map((m) => ({
    id: m.id,
    at: m.at,
    dir: m.dir,
    text: m.text,
    via: "app" as const,
    kind: m.kind,
    ...(m.file ? { file: m.file } : {}),
    read_at: m.read_at ?? null,
    delivered_at: m.delivered_at ?? null,
  }));

  for (const w of whatsapp) {
    if (!w?.date) continue;
    const key = `wa:${w.date}:${(w.text || "").slice(0, 24)}`;
    rows.push({
      id: key,
      at: w.date,
      dir: w.direction,
      text: w.text ?? "",
      via: "whatsapp",
      kind: w.attachment?.kind ?? "text",
      ...(w.attachment?.name ? { file: w.attachment.name } : {}),
      // WhatsApp carries no read state we can see, and inventing one would
      // make "unread" mean two different things in the same list.
      read_at: undefined,
      // WhatsApp history carries no receipts of ours — showing ticks on it
      // would be inventing a fact.
      delivered_at: undefined,
      ...(w.template_name ? { template_name: w.template_name } : {}),
    });
  }

  const seen = new Set<string>();
  return rows
    .filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
    .sort((a, b) => (a.at === b.at ? a.id.localeCompare(b.id) : a.at.localeCompare(b.at)));
}
