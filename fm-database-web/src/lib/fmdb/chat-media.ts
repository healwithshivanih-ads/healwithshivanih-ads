import "server-only";

/**
 * Photos sent in the client chat.
 *
 * THREE THINGS DECIDE THE SHAPE OF THIS FILE.
 *
 * 1. EVERY PHOTO IS RE-ENCODED, NEVER STORED AS RECEIVED. A meal photographed
 *    at home carries the client's home GPS coordinates in its EXIF, plus the
 *    device serial on some phones. That is the most sensitive data this app
 *    would ever hold, it would sync to two hosts, and nobody asked to share
 *    it. sharp re-encodes to plain JPEG and drops all metadata. Re-encoding
 *    is also the validation: a file sharp cannot decode is not an image,
 *    whatever it claims in its Content-Type.
 *
 * 2. FILENAMES ARE OURS. A client-supplied name is an attacker-supplied
 *    path. Names are random and the extension follows what we encoded, not
 *    what was uploaded.
 *
 * 3. CHAT MEDIA LIVES IN ITS OWN DIRECTORY. clients/<id>/files/ already
 *    holds lab PDFs and coach uploads that must be kept indefinitely. The
 *    retention sweep below deletes things; pointing it at a directory
 *    containing lab reports is how you lose a client's bloodwork. Chat
 *    photos go to files/chat/ and the sweep never looks anywhere else.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { getPlansRoot } from "./paths";

/** Longest edge. Enough to read a plate or a label; small on Indian mobile data. */
const MAX_EDGE = 1600;
const QUALITY = 80;
/** Refuse before decoding — a decoder is a good place to hide a bomb. */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/**
 * How long a chat photo is kept.
 *
 * Not a cost measure — at ~300 KB a photo, storage is free for years. This
 * is exposure: photos of bodies, skin and lab reports are the most sensitive
 * thing here, and the cheapest way to not leak something is to not still
 * have it. Anything the coach pins to the record is exempt.
 */
export const MEDIA_RETAIN_DAYS = 365;

const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/i;
/** Only ever the names WE generate. */
const SAFE_FILE = /^[a-f0-9-]{36}\.jpg$/;

function chatDir(clientId: string): string | null {
  if (!SAFE_ID.test(clientId)) return null;
  return path.join(getPlansRoot(), "clients", clientId, "files", "chat");
}

/** Resolve a stored photo, refusing anything that escapes its client. */
export function mediaPath(clientId: string, file: string): string | null {
  const dir = chatDir(clientId);
  if (!dir || !SAFE_FILE.test(file)) return null;
  const full = path.join(dir, file);
  // Belt and braces: the regex already forbids separators, but a resolved
  // path outside the directory must never be served regardless of how it
  // got there.
  if (path.dirname(path.resolve(full)) !== path.resolve(dir)) return null;
  return full;
}

export type SavedMedia = { file: string; bytes: number; width: number; height: number };

/**
 * Validate, strip, shrink and store. Returns null when the bytes are not a
 * usable image — the caller reports that rather than storing a message
 * pointing at nothing.
 */
export async function saveChatPhoto(
  clientId: string,
  input: Buffer,
): Promise<SavedMedia | null> {
  const dir = chatDir(clientId);
  if (!dir || input.byteLength === 0 || input.byteLength > MAX_UPLOAD_BYTES) return null;

  let out: Buffer;
  let width = 0;
  let height = 0;
  try {
    const pipeline = sharp(input, { failOn: "error" })
      // Honour the orientation flag before discarding metadata, or photos
      // taken in portrait arrive sideways.
      .rotate()
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: QUALITY, mozjpeg: true });
    const result = await pipeline.toBuffer({ resolveWithObject: true });
    out = result.data;
    width = result.info.width;
    height = result.info.height;
  } catch {
    return null; // not an image, or one we refuse to trust
  }

  const file = `${randomUUID()}.jpg`;
  await fs.mkdir(dir, { recursive: true });
  const full = path.join(dir, file);
  const tmp = `${full}.tmp`;
  await fs.writeFile(tmp, out, { mode: 0o600 });
  await fs.rename(tmp, full);
  return { file, bytes: out.byteLength, width, height };
}

export async function readChatPhoto(clientId: string, file: string): Promise<Buffer | null> {
  const full = mediaPath(clientId, file);
  if (!full) return null;
  try {
    return await fs.readFile(full);
  } catch {
    return null;
  }
}

/**
 * Delete chat photos past the retention window, except ones the coach kept.
 *
 * `keep` is the set of filenames still referenced by a pinned message. A
 * photo the coach pinned into the record is evidence and outlives the
 * window; everything else is a snapshot of a Tuesday lunch.
 */
export async function purgeOldChatMedia(
  clientId: string,
  keep: Set<string>,
  now = Date.now(),
): Promise<{ deleted: number; kept: number }> {
  const dir = chatDir(clientId);
  if (!dir) return { deleted: 0, kept: 0 };
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return { deleted: 0, kept: 0 };
  }
  const cutoff = now - MEDIA_RETAIN_DAYS * 24 * 60 * 60 * 1000;
  let deleted = 0;
  let kept = 0;
  for (const name of names) {
    if (!SAFE_FILE.test(name)) continue; // never touch anything we didn't write
    if (keep.has(name)) {
      kept += 1;
      continue;
    }
    const full = path.join(dir, name);
    try {
      const st = await fs.stat(full);
      if (st.mtimeMs < cutoff) {
        await fs.unlink(full);
        deleted += 1;
      } else {
        kept += 1;
      }
    } catch {
      /* vanished under us — nothing to do */
    }
  }
  return { deleted, kept };
}
