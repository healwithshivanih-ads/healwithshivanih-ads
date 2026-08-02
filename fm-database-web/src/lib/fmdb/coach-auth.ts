/**
 * Password store for the /m coach mobile app.
 *
 * WHY A FILE AND NOT JUST AN ENV VAR: the coach changes her password from
 * inside the app on her phone. A web request cannot rewrite an env var (or a
 * Fly secret) and have it take effect without a redeploy, so the credential
 * has to live somewhere writable. It is stored HASHED, which is also strictly
 * better than a plaintext env var sitting in the process environment.
 *
 * BOOTSTRAP: COACH_MOBILE_PASSWORD seeds the store the first time it is
 * needed. After that the FILE is authoritative — changing the env var will not
 * silently revert a password the coach set from her phone. (Deleting the file
 * re-bootstraps from the env var; that is the documented recovery path when
 * she is locked out.)
 *
 * TWO SECRETS, DIFFERENT JOBS:
 *   - passwordHash/salt — scrypt. Verifies what she types.
 *   - signingSecret     — random. HMAC key for the session cookie.
 * They are separate because the raw password is never retained, so it cannot
 * key the cookie. Rotating the signing secret on password change is what logs
 * other devices out.
 *
 * scrypt + randomBytes come from node:crypto — no new dependency.
 */
import fs from "node:fs";
import path from "node:path";
import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { getPlansRoot } from "./paths";

export type CoachAuthRecord = {
  version: 1;
  salt: string; // hex
  passwordHash: string; // hex, scrypt(password, salt)
  signingSecret: string; // hex, HMAC key for session cookies
  updatedAt: string; // ISO
};

const SCRYPT_KEYLEN = 64;
const SALT_BYTES = 16;
const SECRET_BYTES = 32;

/** Where the store lives. Must be on the Fly VOLUME (not the image) or every
 *  deploy would wipe a password the coach set. Defaults under the plans root,
 *  which is already volume-mounted on Fly (FMDB_PLANS_DIR=/data/...). */
export function authFilePath(): string {
  const env = process.env.COACH_MOBILE_AUTH_FILE;
  if (env && env.length > 0) return path.resolve(env);
  return path.join(getPlansRoot(), "_coach_mobile_auth.json");
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
}

function buildRecord(password: string): CoachAuthRecord {
  const salt = randomBytes(SALT_BYTES).toString("hex");
  return {
    version: 1,
    salt,
    passwordHash: hashPassword(password, salt),
    signingSecret: randomBytes(SECRET_BYTES).toString("hex"),
    updatedAt: new Date().toISOString(),
  };
}

function readRecord(): CoachAuthRecord | null {
  try {
    const raw = fs.readFileSync(authFilePath(), "utf8");
    const parsed = JSON.parse(raw) as CoachAuthRecord;
    if (
      parsed?.version !== 1 ||
      !parsed.salt ||
      !parsed.passwordHash ||
      !parsed.signingSecret
    ) {
      return null;
    }
    return parsed;
  } catch {
    // Missing or corrupt → treated as "not set up yet", so the env-var
    // bootstrap can take over rather than locking the coach out.
    return null;
  }
}

function writeRecord(rec: CoachAuthRecord): void {
  const file = authFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Write-then-rename so a crash mid-write can't leave a half file that
  // would lock her out. 0600: the hash is not world-readable.
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(rec, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/**
 * The active auth record, bootstrapping from COACH_MOBILE_PASSWORD on first
 * use. Returns null when /m is not configured at all (no file, no env var) —
 * callers must treat that as "the app does not exist".
 */
export function loadAuth(): CoachAuthRecord | null {
  const existing = readRecord();
  if (existing) return existing;

  const bootstrap = process.env.COACH_MOBILE_PASSWORD;
  if (!bootstrap) return null;

  const rec = buildRecord(bootstrap);
  try {
    writeRecord(rec);
  } catch {
    // Read-only filesystem: still return the record so login works; it just
    // re-derives (with a new signing secret) next boot, logging her out.
  }
  return rec;
}

/** HMAC key for session cookies, or null when /m is unconfigured. */
export function sessionSigningKey(): string | null {
  return loadAuth()?.signingSecret ?? null;
}

/** Constant-time password check against the stored hash. */
export function verifyPassword(supplied: string): boolean {
  const rec = loadAuth();
  if (!rec || !supplied) return false;
  const candidate = Buffer.from(hashPassword(supplied, rec.salt), "hex");
  const expected = Buffer.from(rec.passwordHash, "hex");
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

export type ChangeResult =
  | { ok: true; signingSecret: string }
  | { ok: false; error: string };

/**
 * Change the password. Requires the CURRENT one — this is a change flow, not
 * a reset flow: there is deliberately no recovery channel (email/SMS), because
 * that channel would be a second, weaker door into every client record.
 * Locked out → delete the auth file / reset COACH_MOBILE_PASSWORD on the host.
 *
 * Rotates the signing secret, so every other signed-in device is logged out.
 */
export function changePassword(current: string, next: string): ChangeResult {
  if (!loadAuth()) return { ok: false, error: "not_configured" };
  if (!verifyPassword(current)) return { ok: false, error: "wrong_password" };
  if (next.length < 8) return { ok: false, error: "too_short" };
  if (next === current) return { ok: false, error: "unchanged" };

  const rec = buildRecord(next);
  try {
    writeRecord(rec);
  } catch {
    return { ok: false, error: "write_failed" };
  }
  return { ok: true, signingSecret: rec.signingSecret };
}
