/**
 * The Rs 500 voucher a person earns by finishing the body age check (Shivani, 21 Nov 2026).
 *
 * Her rules: Rs 500 off either report, for ONE person (the price for two is already reduced), one code per
 * person, tied to the email they signed up with, valid for 14 days and never extended. No timers, no reminders.
 *
 * The check runs on the marketing site and the order page on this one, and they share no database, so a code
 * carries its own proof: `BA-<last valid day, YYMMDD>-<6 letters>`, where the letters are an HMAC of the email
 * and that day under `BODY_AGE_VOUCHER_SECRET`. Whoever knows the secret can issue; this side only checks.
 * The marketing site must build codes with exactly `issueVoucher` below (same secret on both apps).
 * "One per person" holds because the code is a pure function of email + day, and the order route refuses a
 * code that a paid order has already used.
 *
 * Pure: no fs, no env. Every `error` is safe to show the buyer.
 */
import crypto from "node:crypto";

export const VOUCHER_OFF_INR = 500;
export const VOUCHER_DAYS = 14;

const ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789"; // no I, L, O, U, 0, 1: easy to read back and type
const CODE = /^BA-(\d{6})-([A-Z2-9]{6})$/;

function tag(email: string, yymmdd: string, secret: string): string {
  const mac = crypto.createHmac("sha256", secret).update(`${email.trim().toLowerCase()}|${yymmdd}`).digest();
  let out = "";
  for (let i = 0; i < 6; i++) out += ALPHABET[mac[i] % ALPHABET.length];
  return out;
}

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The code for someone who finished the check on `todayYmd` (India date). Its last valid day is 14 days on. */
export function issueVoucher(email: string, todayYmd: string, secret: string): { code: string; validUntilYmd: string } {
  const until = addDays(todayYmd, VOUCHER_DAYS);
  const yymmdd = until.slice(2).replace(/-/g, "");
  return { code: `BA-${yymmdd}-${tag(email, yymmdd, secret)}`, validUntilYmd: until };
}

/** What the buyer typed, tidied: spaces out, capitals, the two easy slips (O for 0 is not in a code) left alone. */
export function tidyVoucher(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(/\s+/g, "").toUpperCase().slice(0, 24) : "";
}

export type VoucherCheck = { ok: true; offInr: number } | { ok: false; error: string };

export function checkVoucher(
  code: string,
  o: { email: string; people: number; todayYmd: string; secret: string | undefined },
): VoucherCheck {
  const m = CODE.exec(code);
  if (!m) return { ok: false, error: "That voucher code does not look right. Please check it, or leave the box empty." };
  if (!o.secret) return { ok: false, error: "Voucher codes cannot be used right now. Please leave the box empty." };
  if (o.people !== 1) return { ok: false, error: "A voucher code is for one person's report. The price for two is already reduced." };
  const until = `20${m[1].slice(0, 2)}-${m[1].slice(2, 4)}-${m[1].slice(4, 6)}`;
  const want = tag(o.email, m[1], o.secret);
  const same = want.length === m[2].length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(m[2]));
  if (!same) return { ok: false, error: "That voucher code does not match this email address. Please use the email you gave in the body age check." };
  if (o.todayYmd > until) return { ok: false, error: "That voucher code has passed its last day." };
  return { ok: true, offInr: VOUCHER_OFF_INR };
}
