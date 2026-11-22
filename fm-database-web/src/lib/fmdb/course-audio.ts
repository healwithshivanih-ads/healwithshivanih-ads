/**
 * Private course audio: short-lived links, only for a valid course token.
 * PRODUCTION = the private S3 bucket (setup steps: docs/claude/
 * invariants-v0.81-v0.91.md, "Calm Gut audio course"). Local disk = testing.
 *
 * The paid audio is NEVER public: no public-read bucket, nothing under
 * public/. Two storage modes, chosen by env:
 *
 *   s3    — COURSE_AUDIO_S3_BUCKET (+ _REGION, _KEY_ID, _SECRET). A PRIVATE
 *           bucket (Block Public Access on). The app hands out SigV4
 *           presigned GET links that expire (default 6 h). Never the
 *           marketing bucket (healwithshivanih-public-media): that one is
 *           public by design. For "Save for offline" the bucket needs CORS
 *           GET from the app origin (the phone fetches the file itself).
 *   local — COURSE_AUDIO_DIR: files on the server's disk (on Fly, the volume;
 *           keep it OUTSIDE the Mutagen-synced plans root). The app hands out
 *           an HMAC-signed, expiring ticket for /api/app-course/stream/<ticket>,
 *           which serves the file with Range support. Also the dev/test mode.
 *
 * Neither → "off": the app shows the tracks but says audio is not ready.
 *
 * Signing keys never leave the server, and links carry no app token, so a
 * shared link dies on its own within hours.
 */

import crypto from "node:crypto";
import path from "node:path";

export type CourseAudioMode = "s3" | "local" | "off";

export const DEFAULT_LINK_TTL_SEC = 6 * 60 * 60;

/** The env vars this module reads (process.env satisfies it). */
type Env = Record<string, string | undefined>;

/**
 * Production uses the private S3 bucket and nothing else (Shivani chose it,
 * 22 Nov 2026). Local disk is for testing on a Mac: on Fly (FLY_INTAKE_ONLY)
 * it is refused unless COURSE_AUDIO_ALLOW_LOCAL=1 says so on purpose, so a
 * stray COURSE_AUDIO_DIR can never quietly become the production store.
 */
export function courseAudioMode(env: Env = process.env): CourseAudioMode {
  if (env.COURSE_AUDIO_S3_BUCKET && env.COURSE_AUDIO_S3_KEY_ID && env.COURSE_AUDIO_S3_SECRET) return "s3";
  const production = !!env.FLY_INTAKE_ONLY && env.COURSE_AUDIO_ALLOW_LOCAL !== "1";
  if (!production && env.COURSE_AUDIO_DIR && ticketSecret(env)) return "local";
  return "off";
}

/** Object keys we will ever sign or serve: `calm-gut/d1/s3-music.m4a`. */
// Track ids may hold a hyphen (daily-short); never a slash or a dot, so no path can escape.
const KEY_RE = /^[a-z0-9-]{1,40}\/[a-z0-9]{1,12}\/[a-z0-9][a-z0-9-]{0,24}-(music|voice)\.m4a$/;
export function isValidAudioKey(key: string): boolean {
  return KEY_RE.test(key);
}

// ── S3 SigV4 query presign (GET, UNSIGNED-PAYLOAD) ───────────────────────────

function rfc3986(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function hmac(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data, "utf8").digest();
}

export interface PresignInput {
  bucket: string;
  region: string;
  keyId: string;
  secret: string;
  key: string;
  expiresSec: number;
  now?: Date;
  /** Override the host (tests use the AWS docs example's legacy host). */
  host?: string;
  /** Signed `response-content-type`: S3 answers with this type whatever the
   *  object's stored metadata says. The console stored the Calm Gut files
   *  as audio/x-m4a; Safari / Media Session are surest with audio/mp4. */
  responseContentType?: string;
}

/** AWS Signature V4 presigned GET URL for one S3 object. */
export function presignS3Get(i: PresignInput): string {
  const now = i.now ?? new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""); // 20130524T000000Z
  const date = amzDate.slice(0, 8);
  const host = i.host ?? `${i.bucket}.s3.${i.region}.amazonaws.com`;
  const canonicalPath = "/" + i.key.split("/").map(rfc3986).join("/");
  const scope = `${date}/${i.region}/s3/aws4_request`;
  const params: [string, string][] = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${i.keyId}/${scope}`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(Math.max(1, Math.min(604_800, Math.floor(i.expiresSec))))],
    ["X-Amz-SignedHeaders", "host"],
    ...(i.responseContentType ? ([["response-content-type", i.responseContentType]] as [string, string][]) : []),
  ];
  const query = params
    .map(([k, v]) => [rfc3986(k), rfc3986(v)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const canonicalRequest = ["GET", canonicalPath, query, `host:${host}`, "", "host", "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    crypto.createHash("sha256").update(canonicalRequest, "utf8").digest("hex"),
  ].join("\n");
  const kDate = hmac(`AWS4${i.secret}`, date);
  const kRegion = hmac(kDate, i.region);
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const signature = crypto.createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");
  return `https://${host}${canonicalPath}?${query}&X-Amz-Signature=${signature}`;
}

// ── local mode: signed, expiring tickets ─────────────────────────────────────

function ticketSecret(env: Env = process.env): string {
  return env.COURSE_AUDIO_SECRET || env.GUIDED_ENROLL_SECRET || "";
}

function b64u(s: string | Buffer): string {
  return Buffer.from(s).toString("base64url");
}

/** `<payload>.<mac>` where payload = base64url(JSON{k,e,s}). */
export function makeTicket(
  key: string,
  subscriberId: string,
  expiresAtSec: number,
  secret = ticketSecret(),
): string {
  if (!secret) throw new Error("COURSE_AUDIO_SECRET not set");
  const payload = b64u(JSON.stringify({ k: key, e: expiresAtSec, s: subscriberId }));
  const mac = b64u(crypto.createHmac("sha256", secret).update(payload).digest());
  return `${payload}.${mac}`;
}

/** The object key a valid, unexpired ticket grants; null otherwise. */
export function readTicket(
  ticket: string,
  nowSec = Math.floor(Date.now() / 1000),
  secret = ticketSecret(),
): { key: string; subscriberId: string } | null {
  if (!secret || typeof ticket !== "string" || ticket.length > 600) return null;
  const [payload, mac, extra] = ticket.split(".");
  if (!payload || !mac || extra !== undefined) return null;
  const want = crypto.createHmac("sha256", secret).update(payload).digest();
  let got: Buffer;
  try {
    got = Buffer.from(mac, "base64url");
  } catch {
    return null;
  }
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  try {
    const d = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { k?: unknown; e?: unknown; s?: unknown };
    if (typeof d.k !== "string" || typeof d.e !== "number" || typeof d.s !== "string") return null;
    if (d.e < nowSec) return null;
    if (!isValidAudioKey(d.k)) return null;
    return { key: d.k, subscriberId: d.s };
  } catch {
    return null;
  }
}

/** Absolute path of a key under COURSE_AUDIO_DIR, refusing anything that
 *  would escape it. */
export function localAudioPath(key: string, env: Env = process.env): string | null {
  const root = env.COURSE_AUDIO_DIR;
  if (!root || !isValidAudioKey(key)) return null;
  const abs = path.resolve(root, key);
  return abs.startsWith(path.resolve(root) + path.sep) ? abs : null;
}

// ── the one entry point the API uses ─────────────────────────────────────────

export interface AudioLink {
  url: string;
  expiresAt: string;
  mode: Exclude<CourseAudioMode, "off">;
}

export function audioLinkFor(
  key: string,
  subscriberId: string,
  opts: { env?: Env; now?: Date; ttlSec?: number } = {},
): AudioLink | null {
  const env = opts.env ?? process.env;
  const now = opts.now ?? new Date();
  const ttl = opts.ttlSec ?? DEFAULT_LINK_TTL_SEC;
  if (!isValidAudioKey(key)) return null;
  const mode = courseAudioMode(env);
  const expiresAt = new Date(now.getTime() + ttl * 1000).toISOString();
  if (mode === "s3") {
    return {
      mode,
      expiresAt,
      url: presignS3Get({
        bucket: env.COURSE_AUDIO_S3_BUCKET!,
        region: env.COURSE_AUDIO_S3_REGION || "ap-south-1",
        keyId: env.COURSE_AUDIO_S3_KEY_ID!,
        secret: env.COURSE_AUDIO_S3_SECRET!,
        key,
        expiresSec: ttl,
        now,
        responseContentType: "audio/mp4",
      }),
    };
  }
  if (mode === "local") {
    const t = makeTicket(key, subscriberId, Math.floor(now.getTime() / 1000) + ttl, ticketSecret(env));
    return { mode, expiresAt, url: `/api/app-course/stream/${t}` };
  }
  return null;
}

/** Parse a single-range `Range: bytes=a-b` header against a file size. */
export function parseRange(header: string | null, size: number): { start: number; end: number } | "invalid" | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return "invalid";
  let start: number;
  let end: number;
  if (m[1] === "") {
    // suffix range: last N bytes
    const n = Number(m[2]);
    if (n === 0) return "invalid";
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return "invalid";
  return { start, end };
}
